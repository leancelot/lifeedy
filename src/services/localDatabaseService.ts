import { AppDataPayload, DraftAudioAttachment, DraftImageAttachment, DraftNote } from '../types';
import { sanitizeLegacyPayload } from '../utils/storageSanitizer';

export const LOCAL_STORAGE_DATA_KEY = 'vidaorganizada_local_data_v2';
export const LOCAL_STORAGE_NOTIFS_KEY = 'vidaorganizada_notifications_v2';
export const LOCAL_STORAGE_PENDING_BANK_KEY = 'vidaorganizada_pending_bank_v1';
export const LOCAL_STORAGE_BANK_SIGS_KEY = 'vidaorganizada_ingested_bank_sigs_v1';

const IDB_NAME = 'lifeedy_local_db';
const IDB_VERSION = 1;
const STORE_KV = 'kv';
const STORE_MEDIA = 'media';
const KEY_APP_STATE = 'app_state';
const MEDIA_REF_PREFIX = 'idb-media://';
const SAFE_LOCAL_STORAGE_MAX_BYTES = 1_800_000;

interface MediaRecord {
  id: string;
  dataUrl: string;
  updatedAt: number;
}

export interface PersistenceReadResult {
  payload: Partial<AppDataPayload>;
  source: 'indexeddb' | 'localstorage_migrated' | 'localstorage_fallback' | 'empty';
}

export interface PersistenceWriteResult {
  backend: 'indexeddb' | 'localstorage';
  mediaCount: number;
  localShadowWritten: boolean;
}

function isIndexedDbSupported(): boolean {
  return typeof indexedDB !== 'undefined' && indexedDB !== null;
}

function openLocalDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (!isIndexedDbSupported()) {
      reject(new Error('IndexedDB indisponível neste ambiente.'));
      return;
    }

    try {
      const request = indexedDB.open(IDB_NAME, IDB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE_KV)) {
          db.createObjectStore(STORE_KV);
        }
        if (!db.objectStoreNames.contains(STORE_MEDIA)) {
          db.createObjectStore(STORE_MEDIA, { keyPath: 'id' });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('Falha ao abrir IndexedDB.'));
      request.onblocked = () => reject(new Error('IndexedDB bloqueado por outra aba.'));
    } catch (err) {
      reject(err);
    }
  });
}

function idbGet<T>(db: IDBDatabase, storeName: string, key: IDBValidKey): Promise<T | undefined> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readonly');
    const store = tx.objectStore(storeName);
    const req = store.get(key);
    req.onsuccess = () => resolve(req.result as T | undefined);
    req.onerror = () => reject(req.error);
  });
}

function idbGetAll<T>(db: IDBDatabase, storeName: string): Promise<T[]> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readonly');
    const store = tx.objectStore(storeName);
    const req = store.getAll();
    req.onsuccess = () => resolve((req.result as T[]) || []);
    req.onerror = () => reject(req.error);
  });
}

function extractDraftMediaForStorage(draftNotes: DraftNote[]): {
  dehydratedDrafts: DraftNote[];
  mediaRecords: MediaRecord[];
} {
  const now = Date.now();
  const mediaRecords: MediaRecord[] = [];

  const dehydratedDrafts = draftNotes.map((draft) => {
    let images: DraftImageAttachment[] | undefined = draft.images;
    if (Array.isArray(draft.images) && draft.images.length > 0) {
      images = draft.images.map((img) => {
        if (img.dataUrl && !img.dataUrl.startsWith(MEDIA_REF_PREFIX)) {
          const mediaId = `img:${draft.id}:${img.id}`;
          mediaRecords.push({ id: mediaId, dataUrl: img.dataUrl, updatedAt: now });
          return { ...img, dataUrl: `${MEDIA_REF_PREFIX}${mediaId}` };
        }
        return img;
      });
    }

    let audios: DraftAudioAttachment[] | undefined = draft.audios;
    if (Array.isArray(draft.audios) && draft.audios.length > 0) {
      audios = draft.audios.map((aud) => {
        if (aud.dataUrl && !aud.dataUrl.startsWith(MEDIA_REF_PREFIX)) {
          const mediaId = `aud:${draft.id}:${aud.id}`;
          mediaRecords.push({ id: mediaId, dataUrl: aud.dataUrl, updatedAt: now });
          return { ...aud, dataUrl: `${MEDIA_REF_PREFIX}${mediaId}` };
        }
        return aud;
      });
    }

    return {
      ...draft,
      ...(images ? { images } : {}),
      ...(audios ? { audios } : {}),
    };
  });

  return { dehydratedDrafts, mediaRecords };
}

function rehydrateDraftMedia(
  draftNotes: DraftNote[],
  mediaById: Map<string, string>
): DraftNote[] {
  return draftNotes.map((draft) => {
    const images = Array.isArray(draft.images)
      ? draft.images
          .map((img) => {
            if (img.dataUrl?.startsWith(MEDIA_REF_PREFIX)) {
              const id = img.dataUrl.slice(MEDIA_REF_PREFIX.length);
              const resolved = mediaById.get(id);
              return resolved ? { ...img, dataUrl: resolved } : null;
            }
            return img;
          })
          .filter((img): img is DraftImageAttachment => Boolean(img))
      : undefined;

    const audios = Array.isArray(draft.audios)
      ? draft.audios
          .map((aud) => {
            if (aud.dataUrl?.startsWith(MEDIA_REF_PREFIX)) {
              const id = aud.dataUrl.slice(MEDIA_REF_PREFIX.length);
              const resolved = mediaById.get(id);
              return resolved ? { ...aud, dataUrl: resolved } : null;
            }
            return aud;
          })
          .filter((aud): aud is DraftAudioAttachment => Boolean(aud))
      : undefined;

    return {
      ...draft,
      ...(images ? { images } : {}),
      ...(audios ? { audios } : {}),
    };
  });
}

function writeCompactLocalStorageShadow(payload: AppDataPayload, fullJson?: string): boolean {
  if (typeof localStorage === 'undefined') return false;
  try {
    const candidateJson = fullJson ?? JSON.stringify(payload);
    if (candidateJson.length <= SAFE_LOCAL_STORAGE_MAX_BYTES) {
      localStorage.setItem(LOCAL_STORAGE_DATA_KEY, candidateJson);
      return true;
    }

    // Keep text/structured records in localStorage without bulky Base64 blobs so ErrorBoundary
    // rescue and fast boot stay within WebView localStorage limits (~5 MB).
    const compactPayload: AppDataPayload = {
      ...payload,
      draftNotes: (payload.draftNotes || []).map((draft) => ({
        ...draft,
        images: undefined,
        audios: undefined,
      })),
    };
    const compactJson = JSON.stringify(compactPayload);
    if (compactJson.length <= SAFE_LOCAL_STORAGE_MAX_BYTES) {
      localStorage.setItem(LOCAL_STORAGE_DATA_KEY, compactJson);
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

export function loadSyncLocalStoragePayload(): Partial<AppDataPayload> {
  if (typeof localStorage === 'undefined') return {};
  try {
    const raw = localStorage.getItem(LOCAL_STORAGE_DATA_KEY);
    if (!raw) return {};
    return sanitizeLegacyPayload(JSON.parse(raw));
  } catch {
    return {};
  }
}

export async function loadPersistedAppPayload(): Promise<PersistenceReadResult> {
  const lsPayload = loadSyncLocalStoragePayload();
  const hasLsData = Boolean(
    lsPayload.onboardingCompleted ||
      lsPayload.userName ||
      (lsPayload.tasks && lsPayload.tasks.length > 0) ||
      (lsPayload.transactions && lsPayload.transactions.length > 0) ||
      (lsPayload.events && lsPayload.events.length > 0) ||
      (lsPayload.financialGoals && lsPayload.financialGoals.length > 0) ||
      (lsPayload.draftNotes && lsPayload.draftNotes.length > 0)
  );

  if (!isIndexedDbSupported()) {
    return {
      payload: lsPayload,
      source: hasLsData ? 'localstorage_fallback' : 'empty',
    };
  }

  let db: IDBDatabase | null = null;
  try {
    db = await openLocalDatabase();
    const storedState = await idbGet<AppDataPayload>(db, STORE_KV, KEY_APP_STATE);

    if (storedState && typeof storedState === 'object') {
      const sanitized = sanitizeLegacyPayload(storedState);
      const mediaList = await idbGetAll<MediaRecord>(db, STORE_MEDIA);
      const mediaMap = new Map<string, string>();
      for (const rec of mediaList) {
        if (rec && typeof rec.id === 'string' && typeof rec.dataUrl === 'string') {
          mediaMap.set(rec.id, rec.dataUrl);
        }
      }
      if (sanitized.draftNotes) {
        sanitized.draftNotes = rehydrateDraftMedia(sanitized.draftNotes, mediaMap);
      }
      return {
        payload: sanitized,
        source: 'indexeddb',
      };
    }

    if (hasLsData) {
      await savePersistedAppPayload(lsPayload as AppDataPayload);
      return {
        payload: lsPayload,
        source: 'localstorage_migrated',
      };
    }

    return { payload: {}, source: 'empty' };
  } catch {
    return {
      payload: lsPayload,
      source: hasLsData ? 'localstorage_fallback' : 'empty',
    };
  } finally {
    if (db) db.close();
  }
}

export async function savePersistedAppPayload(
  payload: AppDataPayload,
  serializedJson?: string
): Promise<PersistenceWriteResult> {
  const localShadowWritten = writeCompactLocalStorageShadow(payload, serializedJson);

  if (!isIndexedDbSupported()) {
    return {
      backend: 'localstorage',
      mediaCount: 0,
      localShadowWritten,
    };
  }

  const { dehydratedDrafts, mediaRecords } = extractDraftMediaForStorage(payload.draftNotes || []);
  const stateToStore: AppDataPayload = {
    ...payload,
    draftNotes: dehydratedDrafts,
  };

  let db: IDBDatabase | null = null;
  try {
    db = await openLocalDatabase();
    const activeIds = new Set(mediaRecords.map((m) => m.id));

    await new Promise<void>((resolve, reject) => {
      const tx = db!.transaction([STORE_KV, STORE_MEDIA], 'readwrite');
      const kvStore = tx.objectStore(STORE_KV);
      const mediaStore = tx.objectStore(STORE_MEDIA);

      kvStore.put(stateToStore, KEY_APP_STATE);

      for (const rec of mediaRecords) {
        mediaStore.put(rec);
      }

      const keysReq = mediaStore.getAllKeys();
      keysReq.onsuccess = () => {
        const existingKeys = keysReq.result || [];
        for (const key of existingKeys) {
          if (typeof key === 'string' && !activeIds.has(key)) {
            mediaStore.delete(key);
          }
        }
      };

      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error || new Error('Falha ao gravar no IndexedDB.'));
      tx.onabort = () => reject(tx.error || new Error('Transação IndexedDB abortada.'));
    });

    return {
      backend: 'indexeddb',
      mediaCount: mediaRecords.length,
      localShadowWritten,
    };
  } catch {
    return {
      backend: 'localstorage',
      mediaCount: 0,
      localShadowWritten,
    };
  } finally {
    if (db) db.close();
  }
}

export async function clearPersistedAppDatabase(): Promise<void> {
  if (typeof localStorage !== 'undefined') {
    try {
      localStorage.removeItem(LOCAL_STORAGE_DATA_KEY);
      localStorage.removeItem(LOCAL_STORAGE_PENDING_BANK_KEY);
      localStorage.removeItem(LOCAL_STORAGE_BANK_SIGS_KEY);
      localStorage.removeItem(LOCAL_STORAGE_NOTIFS_KEY);
    } catch {
      // ignore storage cleanup errors
    }
  }

  if (!isIndexedDbSupported()) return;

  let db: IDBDatabase | null = null;
  try {
    db = await openLocalDatabase();
    await new Promise<void>((resolve, reject) => {
      const tx = db!.transaction([STORE_KV, STORE_MEDIA], 'readwrite');
      tx.objectStore(STORE_KV).clear();
      tx.objectStore(STORE_MEDIA).clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    // ignore IndexedDB clear failures
  } finally {
    if (db) db.close();
  }
}
