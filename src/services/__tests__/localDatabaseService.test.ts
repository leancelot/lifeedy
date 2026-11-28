import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  clearPersistedAppDatabase,
  loadPersistedAppPayload,
  loadSyncLocalStoragePayload,
  LOCAL_STORAGE_DATA_KEY,
  savePersistedAppPayload,
} from '../localDatabaseService';
import { AppDataPayload } from '../../types';

function createLocalStorageMock() {
  const store = new Map<string, string>();
  return {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => {
      store.set(k, String(v));
    },
    removeItem: (k: string) => {
      store.delete(k);
    },
    clear: () => {
      store.clear();
    },
  };
}

function createInMemoryIndexedDbMock() {
  const databases = new Map<string, Map<string, Map<unknown, unknown>>>();

  function ensureStore(dbName: string, storeName: string, keyPath?: string) {
    let db = databases.get(dbName);
    if (!db) {
      db = new Map();
      databases.set(dbName, db);
    }
    if (!db.has(storeName)) {
      db.set(storeName, new Map());
    }
    return { map: db.get(storeName)!, keyPath };
  }

  return {
    open(name: string) {
      const req: Record<string, any> = {
        result: null,
        error: null,
        onupgradeneeded: null,
        onsuccess: null,
        onblocked: null,
        onerror: null,
      };

      const isNew = !databases.has(name);
      if (isNew) {
        databases.set(name, new Map());
      }
      const dbStores = databases.get(name)!;
      const storeMeta = new Map<string, { keyPath?: string }>();

      const dbObj = {
        objectStoreNames: {
          contains: (s: string) => dbStores.has(s),
        },
        createObjectStore: (s: string, opts?: { keyPath?: string }) => {
          ensureStore(name, s, opts?.keyPath);
          storeMeta.set(s, { keyPath: opts?.keyPath });
          return {};
        },
        transaction: (storeNames: string | string[]) => {
          const names = Array.isArray(storeNames) ? storeNames : [storeNames];
          const tx: Record<string, any> = {
            oncomplete: null,
            onerror: null,
            onabort: null,
            error: null,
            objectStore: (storeName: string) => {
              if (!dbStores.has(storeName)) {
                dbStores.set(storeName, new Map());
              }
              const storeMap = dbStores.get(storeName)!;
              const makeAsyncReq = (fn: () => unknown) => {
                const opReq: Record<string, any> = {
                  result: undefined,
                  error: null,
                  onsuccess: null,
                  onerror: null,
                };
                queueMicrotask(() => {
                  try {
                    opReq.result = fn();
                    opReq.onsuccess?.();
                  } catch (e) {
                    opReq.error = e;
                    opReq.onerror?.();
                  }
                });
                return opReq;
              };

              return {
                get: (key: unknown) => makeAsyncReq(() => storeMap.get(key)),
                getAll: () => makeAsyncReq(() => Array.from(storeMap.values())),
                getAllKeys: () => makeAsyncReq(() => Array.from(storeMap.keys())),
                put: (value: any, key?: unknown) =>
                  makeAsyncReq(() => {
                    const resolvedKey =
                      key !== undefined
                        ? key
                        : storeName === 'media' && value?.id
                        ? value.id
                        : storeMeta.get(storeName)?.keyPath
                        ? value?.[storeMeta.get(storeName)!.keyPath!]
                        : undefined;
                    storeMap.set(resolvedKey, value);
                    return resolvedKey;
                  }),
                delete: (key: unknown) =>
                  makeAsyncReq(() => {
                    storeMap.delete(key);
                  }),
                clear: () =>
                  makeAsyncReq(() => {
                    storeMap.clear();
                  }),
              };
            },
          };

          if (names.length > 0) {
            queueMicrotask(() => {
              queueMicrotask(() => {
                tx.oncomplete?.();
              });
            });
          }
          return tx;
        },
        close: () => {},
      };

      req.result = dbObj;
      queueMicrotask(() => {
        if (isNew) {
          req.onupgradeneeded?.();
        }
        req.onsuccess?.();
      });
      return req;
    },
    _dump: databases,
  };
}

function makeSamplePayload(overrides?: Partial<AppDataPayload>): AppDataPayload {
  return {
    version: 4,
    lastUpdated: '2026-11-23T10:00:00.000Z',
    userName: 'Ana',
    onboardingCompleted: true,
    tasks: [
      {
        id: 't-1',
        title: 'Revisar orçamento',
        dueDate: '2026-11-23',
        priority: 'medium',
        category: 'financas',
        completed: false,
        subtasks: [],
      },
    ],
    events: [],
    transactions: [],
    financialGoals: [],
    budgetLimits: [],
    draftNotes: [],
    specialDates: [],
    pendingBankNotifications: [],
    ...overrides,
  };
}

describe('localDatabaseService', () => {
  const originalIndexedDb = (globalThis as any).indexedDB;

  beforeEach(() => {
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: createLocalStorageMock(),
    });
  });

  afterEach(() => {
    Object.defineProperty(globalThis, 'indexedDB', {
      configurable: true,
      value: originalIndexedDb,
    });
  });

  it('usa fallback em localStorage quando IndexedDB não está disponível', async () => {
    Object.defineProperty(globalThis, 'indexedDB', {
      configurable: true,
      value: undefined,
    });

    const payload = makeSamplePayload();
    const writeRes = await savePersistedAppPayload(payload);
    expect(writeRes.backend).toBe('localstorage');
    expect(writeRes.localShadowWritten).toBe(true);

    const readRes = await loadPersistedAppPayload();
    expect(readRes.source).toBe('localstorage_fallback');
    expect(readRes.payload.userName).toBe('Ana');
    expect(readRes.payload.tasks).toHaveLength(1);
  });

  it('migra dados legados de localStorage para IndexedDB na primeira leitura', async () => {
    const idbMock = createInMemoryIndexedDbMock();
    Object.defineProperty(globalThis, 'indexedDB', {
      configurable: true,
      value: idbMock,
    });

    const legacy = makeSamplePayload({ userName: 'Carlos' });
    localStorage.setItem(LOCAL_STORAGE_DATA_KEY, JSON.stringify(legacy));

    const migrated = await loadPersistedAppPayload();
    expect(migrated.source).toBe('localstorage_migrated');
    expect(migrated.payload.userName).toBe('Carlos');

    const secondRead = await loadPersistedAppPayload();
    expect(secondRead.source).toBe('indexeddb');
    expect(secondRead.payload.userName).toBe('Carlos');
  });

  it('separa imagens e áudios de draftNotes no store media, reidrata na leitura e remove órfãos', async () => {
    const idbMock = createInMemoryIndexedDbMock();
    Object.defineProperty(globalThis, 'indexedDB', {
      configurable: true,
      value: idbMock,
    });

    const largeImageData = 'data:image/jpeg;base64,' + 'A'.repeat(2_000_000);
    const audioData = 'data:audio/webm;base64,BBBB';

    const payloadWithMedia = makeSamplePayload({
      draftNotes: [
        {
          id: 'draft-1',
          title: 'Recibo viagem',
          content: 'Foto e áudio anexados',
          kind: 'media',
          updatedAt: '2026-11-23T10:00:00.000Z',
          images: [{ id: 'img-1', dataUrl: largeImageData }],
          audios: [
            {
              id: 'aud-1',
              dataUrl: audioData,
              mimeType: 'audio/webm',
              durationSec: 4,
              createdAt: '2026-11-23T10:00:00.000Z',
            },
          ],
        },
      ],
    });

    const writeRes = await savePersistedAppPayload(payloadWithMedia);
    expect(writeRes.backend).toBe('indexeddb');
    expect(writeRes.mediaCount).toBe(2);
    expect(writeRes.localShadowWritten).toBe(true);

    // Shadow em localStorage deve ter removido anexos pesados para caber com folga
    const shadow = loadSyncLocalStoragePayload();
    expect(shadow.draftNotes?.[0]?.images).toBeUndefined();
    expect(shadow.draftNotes?.[0]?.audios).toBeUndefined();

    // Leitura assíncrona do IndexedDB deve reidratar completamente as mídias
    const readBack = await loadPersistedAppPayload();
    expect(readBack.source).toBe('indexeddb');
    expect(readBack.payload.draftNotes?.[0]?.images?.[0]?.dataUrl).toBe(largeImageData);
    expect(readBack.payload.draftNotes?.[0]?.audios?.[0]?.dataUrl).toBe(audioData);

    // Ao excluir o rascunho, os registros órfãos do store media devem ser limpos
    await savePersistedAppPayload(makeSamplePayload({ draftNotes: [] }));
    const mediaStore = idbMock._dump.get('lifeedy_local_db')?.get('media');
    expect(mediaStore?.size ?? 0).toBe(0);

    await clearPersistedAppDatabase();
    const afterClear = await loadPersistedAppPayload();
    expect(afterClear.source).toBe('empty');
  });
});
