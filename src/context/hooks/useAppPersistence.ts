import { useCallback, useEffect, useRef, useState } from 'react';
import {
  isAndroidNativeHealthSupported,
  loadNativeVaultBackup,
  saveNativeVaultBackup,
  updateNativeWidgetSummary,
} from '../../services/appHealthBridge';
import { recordAppError } from '../../services/errorJournalService';
import {
  clearPersistedAppDatabase,
  loadPersistedAppPayload,
  savePersistedAppPayload,
} from '../../services/localDatabaseService';
import { AppDataPayload, LocalCalendarEvent, TaskItem, Transaction } from '../../types';
import { hasMeaningfulLocalData } from '../../utils/backupSummary';
import { formatLocalDateIso } from '../../utils/dateUtils';
import { sanitizeLegacyPayload, serializeAppPayloadSafely } from '../../utils/storageSanitizer';

export interface VaultStatusState {
  lastSavedAt: string | null;
  checksum: string | null;
  byteSize: number;
  recoveredFromNative: boolean;
}

interface UseAppPersistenceOptions {
  buildCurrentPayload: () => AppDataPayload;
  applySanitizedPayload: (sanitized: Partial<AppDataPayload>) => void;
  tasks: TaskItem[];
  calendarEvents: LocalCalendarEvent[];
  transactions: Transaction[];
  hideValues: boolean;
  financeLockEnabled: boolean;
  onboardingCompleted: boolean;
}

const BRL_WIDGET_FORMATTER = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
});

/**
 * Centraliza a camada de persistência escalável (IndexedDB + fallback compacto em LocalStorage),
 * espelhamento AES-256-GCM no cofre nativo Android e atualização do Widget na tela inicial.
 */
export function useAppPersistence({
  buildCurrentPayload,
  applySanitizedPayload,
  tasks,
  calendarEvents,
  transactions,
  hideValues,
  financeLockEnabled,
  onboardingCompleted,
}: UseAppPersistenceOptions) {
  const [vaultStatus, setVaultStatus] = useState<VaultStatusState>({
    lastSavedAt: null,
    checksum: null,
    byteSize: 0,
    recoveredFromNative: false,
  });
  const [contentChecksum, setContentChecksum] = useState<string | null>(null);
  const [idbHydrated, setIdbHydrated] = useState(false);

  const nativeVaultTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const widgetSyncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const idbBootDoneRef = useRef(false);
  const applyRef = useRef(applySanitizedPayload);
  applyRef.current = applySanitizedPayload;

  // Hidratação assíncrona inicial via IndexedDB + recuperação do cofre nativo Android se necessário
  useEffect(() => {
    if (idbBootDoneRef.current) return;
    idbBootDoneRef.current = true;
    let active = true;

    const bootstrapStorage = async () => {
      try {
        const readRes = await loadPersistedAppPayload();
        if (!active) return;

        const hasWebData = hasMeaningfulLocalData({
          tasks: readRes.payload.tasks || [],
          events: readRes.payload.events || [],
          transactions: readRes.payload.transactions || [],
          financialGoals: readRes.payload.financialGoals || [],
          draftNotes: readRes.payload.draftNotes || [],
          specialDates: readRes.payload.specialDates || [],
          pendingBankNotifications: readRes.payload.pendingBankNotifications || [],
        });

        if (readRes.source === 'indexeddb' && (hasWebData || readRes.payload.onboardingCompleted)) {
          applyRef.current(readRes.payload);
          setIdbHydrated(true);
          return;
        }

        if (!hasWebData && isAndroidNativeHealthSupported()) {
          const nativeRes = await loadNativeVaultBackup();
          if (!active) return;
          if (nativeRes.found && nativeRes.payloadJson) {
            try {
              const parsed = JSON.parse(nativeRes.payloadJson);
              const sanitized = sanitizeLegacyPayload(parsed);
              const vaultHasData = hasMeaningfulLocalData({
                tasks: sanitized.tasks || [],
                events: sanitized.events || [],
                transactions: sanitized.transactions || [],
                financialGoals: sanitized.financialGoals || [],
                draftNotes: sanitized.draftNotes || [],
                specialDates: sanitized.specialDates || [],
                pendingBankNotifications: sanitized.pendingBankNotifications || [],
              });
              if (vaultHasData || sanitized.onboardingCompleted) {
                applyRef.current(sanitized);
                setVaultStatus((prev) => ({
                  ...prev,
                  recoveredFromNative: true,
                }));
              }
            } catch (err) {
              recordAppError('nativeVault.recover', err);
            }
          }
        }
      } catch (err) {
        recordAppError('indexeddb.bootstrap', err);
      } finally {
        if (active) setIdbHydrated(true);
      }
    };

    void bootstrapStorage();
    return () => {
      active = false;
    };
  }, []);

  // Gravação automática em IndexedDB + shadow compacto + cofre AES-GCM Android
  useEffect(() => {
    if (!idbHydrated) return;

    const payload = buildCurrentPayload();
    const {
      json,
      checksum,
      contentChecksum: nextContentChecksum,
      byteSize,
    } = serializeAppPayloadSafely(payload);
    setContentChecksum(nextContentChecksum);

    void savePersistedAppPayload(payload, json)
      .then(() => {
        setVaultStatus((prev) => ({
          ...prev,
          lastSavedAt: payload.lastUpdated,
          checksum,
          byteSize,
        }));
      })
      .catch((err) => {
        recordAppError('indexeddb.persist', err, `bytes=${byteSize}`);
      });

    if (isAndroidNativeHealthSupported()) {
      if (nativeVaultTimerRef.current) clearTimeout(nativeVaultTimerRef.current);
      nativeVaultTimerRef.current = setTimeout(() => {
        void saveNativeVaultBackup(json);
      }, 450);
    }

    return () => {
      if (nativeVaultTimerRef.current) {
        clearTimeout(nativeVaultTimerRef.current);
      }
    };
  }, [buildCurrentPayload, idbHydrated]);

  // Atualiza resumo do Widget Android na tela inicial sempre que houver alteração relevante
  useEffect(() => {
    if (!isAndroidNativeHealthSupported() || !onboardingCompleted) return;

    if (widgetSyncTimerRef.current) clearTimeout(widgetSyncTimerRef.current);
    widgetSyncTimerRef.current = setTimeout(() => {
      const now = new Date();
      const todayStr = formatLocalDateIso(now);
      const monthKey = todayStr.slice(0, 7);

      const pendingTasksCount = tasks.filter((t) => !t.completed).length;
      const todayEventsCount = calendarEvents.filter((ev) => {
        const key = ev.start?.date
          ? ev.start.date.slice(0, 10)
          : ev.start?.dateTime
          ? formatLocalDateIso(new Date(ev.start.dateTime))
          : '';
        return key === todayStr;
      }).length;

      let monthBalance = 0;
      for (const tx of transactions) {
        if (!tx.date || !tx.date.startsWith(monthKey)) continue;
        monthBalance += tx.type === 'receita' ? tx.amount : -tx.amount;
      }

      const shouldHideBalance = hideValues || financeLockEnabled;
      const balanceFormatted = shouldHideBalance
        ? 'R$ •••••'
        : BRL_WIDGET_FORMATTER.format(monthBalance);

      void updateNativeWidgetSummary({
        pendingTasksCount,
        todayEventsCount,
        balanceFormatted,
        hideValues: shouldHideBalance,
      });
    }, 500);

    return () => {
      if (widgetSyncTimerRef.current) clearTimeout(widgetSyncTimerRef.current);
    };
  }, [tasks, calendarEvents, transactions, hideValues, financeLockEnabled, onboardingCompleted]);

  const clearAllLocalPersistence = useCallback(async () => {
    await clearPersistedAppDatabase();
    setContentChecksum(null);
    setVaultStatus({
      lastSavedAt: null,
      checksum: null,
      byteSize: 0,
      recoveredFromNative: false,
    });
  }, []);

  return {
    vaultStatus,
    contentChecksum,
    clearAllLocalPersistence,
  };
}
