import { useCallback, useEffect, useState } from 'react';
import { App as CapApp } from '@capacitor/app';
import {
  acknowledgeNativeBankNotifications,
  checkBankNotificationPermission,
  fetchNativePendingBankNotifications,
  isAndroidNotificationCaptureSupported,
  NativePendingBankEvent,
  openBankNotificationSettings,
  subscribeNativeBankNotifications,
} from '../../services/bankNotificationBridge';
import { parseBankNotificationText } from '../../services/bankNotificationParser';
import { hapticImpactLight, hapticSuccess, hapticWarning } from '../../services/hapticsService';
import { PendingBankNotification, Transaction } from '../../types';

const STORAGE_KEY_PENDING_BANK = 'vidaorganizada_pending_bank_v1';
const STORAGE_KEY_BANK_SIGS = 'vidaorganizada_ingested_bank_sigs_v1';
const BANK_DEDUPE_WINDOW_MS = 10 * 60 * 1000;

interface UseBankNotificationQueueOptions {
  initialItems?: PendingBankNotification[];
  onApproveTransactions: (newTransactions: Transaction[]) => void;
}

/**
 * Gerencia a fila de notificações bancárias capturadas no Android (ou coladas na Web),
 * evitando duplicações e convertendo itens aprovados em lançamentos financeiros.
 */
export function useBankNotificationQueue({
  initialItems,
  onApproveTransactions,
}: UseBankNotificationQueueOptions) {
  const bankListenerSupported = isAndroidNotificationCaptureSupported();
  const [bankListenerPermission, setBankListenerPermission] = useState<boolean>(false);

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

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY_PENDING_BANK, JSON.stringify(pendingBankNotifications));
    } catch {
      // ignora erro de gravação
    }
  }, [pendingBankNotifications]);

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
      const newItems: PendingBankNotification[] = [];

      events.forEach((evt) => {
        const parsed = parseBankNotificationText({
          rawText: evt.text || '',
          title: evt.title,
          bankName: evt.bankName,
          timestamp: evt.timestamp,
          source: 'android',
          allowAmbiguous: false,
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
    ingestNativeEvents,
    refreshBankListenerPermission,
    syncNativeBankNotifications,
  ]);

  const enqueueParsedBankText = useCallback(
    (rawText: string, bankName?: string): PendingBankNotification | null => {
      const parsed = parseBankNotificationText({
        rawText,
        bankName,
        source: 'manual',
        allowAmbiguous: true,
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
    if (pendingBankNotifications.length === 0) return;

    const nowBase = Date.now();
    const batch: Transaction[] = pendingBankNotifications.map((item, idx) => ({
      id: `tx-${nowBase}-${idx}-${Math.random().toString(36).substring(2, 5)}`,
      type: item.type,
      title: item.title,
      amount: item.amount,
      category: item.category,
      date: item.date,
      paymentMethod: item.paymentMethod,
      notes: `Origem: ${item.bankName}`,
      recurring: false,
    }));

    hapticSuccess();
    onApproveTransactions(batch);
    setPendingBankNotifications([]);
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
  };
}
