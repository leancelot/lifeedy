import { useCallback, useEffect, useRef, useState } from 'react';
import { App as CapApp } from '@capacitor/app';
import {
  acknowledgeNativeBankNotifications,
  checkBankNotificationPermission,
  fetchInstalledAndroidApps,
  fetchNativePendingBankNotifications,
  InstalledAppInfo,
  isAndroidNotificationCaptureSupported,
  NativePendingBankEvent,
  openBankNotificationSettings,
  subscribeNativeBankNotifications,
  syncNativeBankCaptureConfig,
} from '../../services/bankNotificationBridge';
import { parseBankNotificationText } from '../../services/bankNotificationParser';
import { hapticImpactLight, hapticSuccess, hapticWarning } from '../../services/hapticsService';
import { NOTIFICATION_CHANNELS, sendWebNotification } from '../../services/notificationService';
import {
  buildPendingNotificationFromScheduledRule,
  evaluateDueScheduledValueMessages,
  formatLocalDateYmd,
} from '../../services/scheduledValueMessageEngine';
import {
  BankCaptureSettings,
  ManualCaptureAppRule,
  PendingBankNotification,
  ScheduledValueMessage,
  Transaction,
} from '../../types';
import {
  DEFAULT_BANK_CAPTURE_SETTINGS,
  normalizeBankCaptureSettings,
  normalizeScheduledValueMessages,
} from '../../utils/storageSanitizer';
import { partitionImmediateBankNotifications } from '../../utils/bankQueueUtils';

const STORAGE_KEY_PENDING_BANK = 'vidaorganizada_pending_bank_v1';
const STORAGE_KEY_BANK_SIGS = 'vidaorganizada_ingested_bank_sigs_v1';
const STORAGE_KEY_CAPTURE_SETTINGS = 'vidaorganizada_bank_capture_settings_v1';
const STORAGE_KEY_SCHEDULED_VALUE_MSGS = 'vidaorganizada_scheduled_value_msgs_v1';
const BANK_DEDUPE_WINDOW_MS = 10 * 60 * 1000;

interface UseBankNotificationQueueOptions {
  initialItems?: PendingBankNotification[];
  initialSettings?: BankCaptureSettings;
  initialScheduledMessages?: ScheduledValueMessage[];
  onApproveTransactions: (newTransactions: Transaction[]) => void;
}

/**
 * Gerencia a fila de notificações bancárias, Google Wallet, SMS e apps manuais no Android,
 * além de mensagens programadas com valores e revisão antes de lançar nas finanças.
 */
export function useBankNotificationQueue({
  initialItems,
  initialSettings,
  initialScheduledMessages,
  onApproveTransactions,
}: UseBankNotificationQueueOptions) {
  const bankListenerSupported = isAndroidNotificationCaptureSupported();
  const [bankListenerPermission, setBankListenerPermission] = useState<boolean>(false);
  const [installedAndroidApps, setInstalledAndroidApps] = useState<InstalledAppInfo[]>([]);

  const [pendingBankNotifications, setPendingBankNotifications] = useState<PendingBankNotification[]>(
    () => {
      try {
        const saved = localStorage.getItem(STORAGE_KEY_PENDING_BANK);
        if (saved) {
          const parsed = JSON.parse(saved);
          if (Array.isArray(parsed)) return parsed;
        }
      } catch {
        // ignora erro de leitura
      }
      return Array.isArray(initialItems) ? initialItems : [];
    }
  );

  const [bankCaptureSettings, setBankCaptureSettingsState] = useState<BankCaptureSettings>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY_CAPTURE_SETTINGS);
      if (saved) {
        return normalizeBankCaptureSettings(JSON.parse(saved));
      }
    } catch {
      // ignora erro de leitura
    }
    return normalizeBankCaptureSettings(initialSettings || DEFAULT_BANK_CAPTURE_SETTINGS);
  });

  const [scheduledValueMessages, setScheduledValueMessagesState] = useState<
    ScheduledValueMessage[]
  >(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY_SCHEDULED_VALUE_MSGS);
      if (saved) {
        return normalizeScheduledValueMessages(JSON.parse(saved));
      }
    } catch {
      // ignora erro de leitura
    }
    return normalizeScheduledValueMessages(initialScheduledMessages || []);
  });

  const captureSettingsRef = useRef(bankCaptureSettings);
  captureSettingsRef.current = bankCaptureSettings;

  const scheduledMessagesRef = useRef(scheduledValueMessages);
  scheduledMessagesRef.current = scheduledValueMessages;

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY_PENDING_BANK, JSON.stringify(pendingBankNotifications));
    } catch {
      // ignora erro de gravação
    }
  }, [pendingBankNotifications]);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY_CAPTURE_SETTINGS, JSON.stringify(bankCaptureSettings));
    } catch {
      // ignora erro de gravação
    }
    if (bankListenerSupported) {
      void syncNativeBankCaptureConfig(bankCaptureSettings);
    }
  }, [bankCaptureSettings, bankListenerSupported]);

  useEffect(() => {
    try {
      localStorage.setItem(
        STORAGE_KEY_SCHEDULED_VALUE_MSGS,
        JSON.stringify(scheduledValueMessages)
      );
    } catch {
      // ignora erro de gravação
    }
  }, [scheduledValueMessages]);

  const setBankCaptureSettings = useCallback(
    (
      updater:
        | BankCaptureSettings
        | ((prev: BankCaptureSettings) => BankCaptureSettings)
    ) => {
      setBankCaptureSettingsState((prev) => {
        const next = typeof updater === 'function' ? updater(prev) : updater;
        return normalizeBankCaptureSettings(next);
      });
    },
    []
  );

  const setScheduledValueMessages = useCallback(
    (
      updater:
        | ScheduledValueMessage[]
        | ((prev: ScheduledValueMessage[]) => ScheduledValueMessage[])
    ) => {
      setScheduledValueMessagesState((prev) => {
        const next = typeof updater === 'function' ? updater(prev) : updater;
        return normalizeScheduledValueMessages(next);
      });
    },
    []
  );

  const recordAndCheckSignatureDuplicate = useCallback((signature: string): boolean => {
    const now = Date.now();
    try {
      const raw = localStorage.getItem(STORAGE_KEY_BANK_SIGS);
      const parsed: Record<string, number> = raw ? JSON.parse(raw) : {};
      const cleaned: Record<string, number> = {};
      for (const [k, ts] of Object.entries(parsed)) {
        if (typeof ts === 'number' && now - ts < BANK_DEDUPE_WINDOW_MS) {
          cleaned[k] = ts;
        }
      }
      if (cleaned[signature]) {
        localStorage.setItem(STORAGE_KEY_BANK_SIGS, JSON.stringify(cleaned));
        return true;
      }
      cleaned[signature] = now;
      localStorage.setItem(STORAGE_KEY_BANK_SIGS, JSON.stringify(cleaned));
      return false;
    } catch {
      return false;
    }
  }, []);

  const ingestNativeEvents = useCallback(
    (events: NativePendingBankEvent[]) => {
      if (!events.length) return;
      const cfg = captureSettingsRef.current;
      const newItems: PendingBankNotification[] = [];

      events.forEach((evt) => {
        const isManualOrSms = evt.sourceKind === 'manual_app' || evt.sourceKind === 'sms';
        const parsed = parseBankNotificationText({
          rawText: evt.text || '',
          title: evt.title,
          bankName: evt.bankName,
          packageName: evt.packageName,
          sourceKind: evt.sourceKind,
          timestamp: evt.timestamp,
          source: 'android',
          allowAmbiguous: isManualOrSms,
          includeScheduledMessages: cfg.captureScheduledMessagesEnabled,
        });
        if (!parsed) return;
        if (recordAndCheckSignatureDuplicate(parsed.signature)) return;
        newItems.push({
          ...parsed,
          id: evt.id || `bn-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        });
      });

      if (newItems.length > 0) {
        setPendingBankNotifications((prev) => {
          const existingIds = new Set(prev.map((item) => item.id));
          const existingSigs = new Set(prev.map((item) => item.signature));
          const uniqueIncoming = newItems.filter(
            (item) => !existingIds.has(item.id) && !existingSigs.has(item.signature)
          );
          return uniqueIncoming.length > 0 ? [...uniqueIncoming, ...prev] : prev;
        });
      }
    },
    [recordAndCheckSignatureDuplicate]
  );

  const checkDueScheduledMessages = useCallback(() => {
    const current = scheduledMessagesRef.current;
    if (!current.length) return;
    const now = new Date();
    const { dueMatches, updatedRules, changed } = evaluateDueScheduledValueMessages(current, now);
    if (!changed || dueMatches.length === 0) return;

    setScheduledValueMessagesState(updatedRules);
    const items = dueMatches.map((m) =>
      buildPendingNotificationFromScheduledRule(m.rule, m.occurrenceDate, now.getTime())
    );

    setPendingBankNotifications((prev) => {
      const existingSigs = new Set(prev.map((item) => item.signature));
      const unique = items.filter((item) => !existingSigs.has(item.signature));
      return unique.length > 0 ? [...unique, ...prev] : prev;
    });

    dueMatches.forEach((m) => {
      const formatted = new Intl.NumberFormat('pt-BR', {
        style: 'currency',
        currency: 'BRL',
      }).format(m.rule.amount);
      void sendWebNotification(`Valor programado: ${m.rule.title}`, {
        body: `${formatted} adicionado à fila de revisão financeira.`,
        tag: `sched-msg-${m.rule.id}-${m.triggerKey}`,
        channelId: NOTIFICATION_CHANNELS.FINANCE,
        targetTab: 'financas',
      });
    });
  }, []);

  useEffect(() => {
    checkDueScheduledMessages();
    const timer = window.setInterval(checkDueScheduledMessages, 60_000);
    return () => window.clearInterval(timer);
  }, [checkDueScheduledMessages]);

  const refreshBankListenerPermission = useCallback(async (): Promise<boolean> => {
    if (!bankListenerSupported) {
      setBankListenerPermission(false);
      return false;
    }
    const granted = await checkBankNotificationPermission();
    setBankListenerPermission(granted);
    return granted;
  }, [bankListenerSupported]);

  const openBankListenerSettings = useCallback(async () => {
    await openBankNotificationSettings();
  }, []);

  const loadInstalledAndroidApps = useCallback(async (): Promise<InstalledAppInfo[]> => {
    if (!bankListenerSupported) return [];
    const apps = await fetchInstalledAndroidApps();
    setInstalledAndroidApps(apps);
    return apps;
  }, [bankListenerSupported]);

  const syncNativeBankNotifications = useCallback(async () => {
    if (!bankListenerSupported) return;
    const pending = await fetchNativePendingBankNotifications();
    if (pending.length === 0) return;

    ingestNativeEvents(pending);
    const ids = pending.map((p) => p.id).filter(Boolean);
    await acknowledgeNativeBankNotifications(ids);
  }, [bankListenerSupported, ingestNativeEvents]);

  useEffect(() => {
    if (!bankListenerSupported) return;

    let active = true;
    let removeNativeListener: (() => void) | null = null;
    let appStateHandle: { remove: () => Promise<void> } | null = null;

    void refreshBankListenerPermission();
    void syncNativeBankCaptureConfig(captureSettingsRef.current);
    void syncNativeBankNotifications();

    subscribeNativeBankNotifications((event) => {
      if (!active) return;
      ingestNativeEvents([event]);
      if (event.id) {
        void acknowledgeNativeBankNotifications([event.id]);
      }
    }).then((unsub) => {
      if (active) {
        removeNativeListener = unsub;
      } else if (unsub) {
        unsub();
      }
    });

    CapApp.addListener('appStateChange', ({ isActive }) => {
      if (isActive && active) {
        void refreshBankListenerPermission();
        void syncNativeBankNotifications();
        checkDueScheduledMessages();
      }
    }).then((handle) => {
      appStateHandle = handle;
    });

    return () => {
      active = false;
      if (removeNativeListener) removeNativeListener();
      if (appStateHandle) appStateHandle.remove().catch(() => {});
    };
  }, [
    bankListenerSupported,
    checkDueScheduledMessages,
    ingestNativeEvents,
    refreshBankListenerPermission,
    syncNativeBankNotifications,
  ]);

  const enqueueParsedBankText = useCallback(
    (
      rawText: string,
      bankName?: string,
      options?: { includeScheduledMessages?: boolean; sourceKind?: PendingBankNotification['sourceKind'] }
    ): PendingBankNotification | null => {
      const includeScheduled =
        options?.includeScheduledMessages ??
        captureSettingsRef.current.captureScheduledMessagesEnabled;

      const parsed = parseBankNotificationText({
        rawText,
        bankName,
        source: 'manual',
        sourceKind: options?.sourceKind || 'manual_paste',
        allowAmbiguous: true,
        includeScheduledMessages: includeScheduled,
      });
      if (!parsed) return null;

      const item: PendingBankNotification = {
        ...parsed,
        id: `bn-manual-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      };
      hapticImpactLight();
      setPendingBankNotifications((prev) => [item, ...prev]);
      return item;
    },
    []
  );

  const updateBankCaptureSettings = useCallback(
    (patch: Partial<Omit<BankCaptureSettings, 'manualApps'>>) => {
      hapticImpactLight();
      setBankCaptureSettings((prev) => ({ ...prev, ...patch }));
    },
    [setBankCaptureSettings]
  );

  const addManualCaptureApp = useCallback(
    (packageName: string, label: string) => {
      const cleanPkg = packageName.trim();
      const cleanLabel = label.trim() || cleanPkg;
      if (!cleanPkg) return;
      hapticImpactLight();
      setBankCaptureSettings((prev) => {
        const exists = prev.manualApps.some((a) => a.packageName === cleanPkg);
        if (exists) {
          return {
            ...prev,
            manualApps: prev.manualApps.map((a) =>
              a.packageName === cleanPkg ? { ...a, label: cleanLabel, enabled: true } : a
            ),
          };
        }
        const nextRule: ManualCaptureAppRule = {
          packageName: cleanPkg,
          label: cleanLabel,
          enabled: true,
          addedAt: new Date().toISOString(),
        };
        return {
          ...prev,
          manualApps: [nextRule, ...prev.manualApps],
        };
      });
    },
    [setBankCaptureSettings]
  );

  const toggleManualCaptureApp = useCallback(
    (packageName: string) => {
      hapticImpactLight();
      setBankCaptureSettings((prev) => ({
        ...prev,
        manualApps: prev.manualApps.map((a) =>
          a.packageName === packageName ? { ...a, enabled: !a.enabled } : a
        ),
      }));
    },
    [setBankCaptureSettings]
  );

  const removeManualCaptureApp = useCallback(
    (packageName: string) => {
      hapticWarning();
      setBankCaptureSettings((prev) => ({
        ...prev,
        manualApps: prev.manualApps.filter((a) => a.packageName !== packageName),
      }));
    },
    [setBankCaptureSettings]
  );

  const addScheduledValueMessage = useCallback(
    (
      input: Omit<ScheduledValueMessage, 'id' | 'createdAt' | 'lastTriggeredKey'>
    ): ScheduledValueMessage => {
      const item: ScheduledValueMessage = {
        ...input,
        id: `svm-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        createdAt: new Date().toISOString(),
      };
      hapticSuccess();
      setScheduledValueMessages((prev) => [item, ...prev]);
      return item;
    },
    [setScheduledValueMessages]
  );

  const toggleScheduledValueMessage = useCallback(
    (id: string) => {
      hapticImpactLight();
      setScheduledValueMessages((prev) =>
        prev.map((m) => (m.id === id ? { ...m, enabled: !m.enabled } : m))
      );
    },
    [setScheduledValueMessages]
  );

  const deleteScheduledValueMessage = useCallback(
    (id: string) => {
      hapticWarning();
      setScheduledValueMessages((prev) => prev.filter((m) => m.id !== id));
    },
    [setScheduledValueMessages]
  );

  const triggerScheduledValueMessageNow = useCallback(
    (id: string): PendingBankNotification | null => {
      const target = scheduledMessagesRef.current.find((m) => m.id === id);
      if (!target) return null;
      const now = new Date();
      const pendingItem = buildPendingNotificationFromScheduledRule(
        target,
        formatLocalDateYmd(now),
        now.getTime()
      );
      hapticImpactLight();
      setPendingBankNotifications((prev) => [pendingItem, ...prev]);
      return pendingItem;
    },
    []
  );

  const approvePendingBankNotification = useCallback(
    (id: string, overrides?: Partial<Omit<Transaction, 'id'>>) => {
      const target = pendingBankNotifications.find((item) => item.id === id);
      if (!target) return;

      const newTx: Transaction = {
        id: 'tx-' + Date.now() + '-' + Math.random().toString(36).substring(2, 6),
        type: overrides?.type ?? target.type,
        title: overrides?.title ?? target.title,
        amount: overrides?.amount ?? target.amount,
        category: overrides?.category ?? target.category,
        date: overrides?.date ?? target.date,
        paymentMethod: overrides?.paymentMethod ?? target.paymentMethod,
        notes: overrides?.notes ?? `Origem: ${target.bankName}`,
        recurring: overrides?.recurring ?? false,
      };

      hapticSuccess();
      onApproveTransactions([newTx]);
      setPendingBankNotifications((prev) => prev.filter((item) => item.id !== id));
    },
    [onApproveTransactions, pendingBankNotifications]
  );

  const approveAllPendingBankNotifications = useCallback(() => {
    const { transactions, remainingItems } = partitionImmediateBankNotifications(
      pendingBankNotifications
    );
    if (transactions.length === 0) return;

    hapticSuccess();
    onApproveTransactions(transactions);
    setPendingBankNotifications(remainingItems);
  }, [onApproveTransactions, pendingBankNotifications]);

  const dismissPendingBankNotification = useCallback((id: string) => {
    hapticImpactLight();
    setPendingBankNotifications((prev) => prev.filter((item) => item.id !== id));
  }, []);

  const clearPendingBankNotifications = useCallback(() => {
    hapticWarning();
    setPendingBankNotifications([]);
  }, []);

  return {
    pendingBankNotifications,
    setPendingBankNotifications,
    bankListenerSupported,
    bankListenerPermission,
    refreshBankListenerPermission,
    openBankListenerSettings,
    enqueueParsedBankText,
    approvePendingBankNotification,
    approveAllPendingBankNotifications,
    dismissPendingBankNotification,
    clearPendingBankNotifications,
    bankCaptureSettings,
    setBankCaptureSettings,
    updateBankCaptureSettings,
    addManualCaptureApp,
    toggleManualCaptureApp,
    removeManualCaptureApp,
    installedAndroidApps,
    loadInstalledAndroidApps,
    scheduledValueMessages,
    setScheduledValueMessages,
    addScheduledValueMessage,
    toggleScheduledValueMessage,
    deleteScheduledValueMessage,
    triggerScheduledValueMessageNow,
  };
}
