import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { triggerConfetti } from '../utils/confettiEffect';
import { GlobalConfirmModal } from '../components/Common/GlobalConfirmModal';
import {
  AndroidPermissionsStatus,
  AndroidPermissionTarget,
  clearNativeAutoBackupFolder,
  clearNativeVaultBackup,
  getAndroidPermissionsStatus,
  getNativeAutoBackupFolderStatus,
  getNativeAutoBackupPassphrase,
  isAndroidNativeHealthSupported,
  openAndroidPermissionSettings,
  pickNativeAutoBackupFolder,
  saveNativeAutoBackupPassphrase,
  writeNativeAutoBackupFile,
} from '../services/appHealthBridge';
import { loadSyncLocalStoragePayload } from '../services/localDatabaseService';
import {
  AUTO_BACKUP_FILENAME,
  clearAutoFolderChecksumStorage,
  clearBackupAuditStorage,
  evaluatePortableBackupHealth,
  getBackupReminderSnoozedUntil,
  getLastAutoFolderChecksum,
  getLastPortableBackupAt,
  isAutoFolderBackupEnabled,
  recordPortableBackupTimestamp,
  setAutoFolderBackupEnabled,
  setLastAutoFolderChecksum,
  snoozeBackupReminder,
} from '../services/backupShareAndAudit';
import {
  decryptBackupEnvelope,
  detectBackupFormat,
  encryptBackupPayload,
  inspectEncryptedBackupMetadata,
  shareOrDownloadTextFile,
} from '../services/encryptedBackupService';
import { recordAppError } from '../services/errorJournalService';
import { UpdateCheckResult } from '../services/githubUpdateService';
import { hapticImpactLight, hapticSuccess, hapticWarning } from '../services/hapticsService';
import {
  AppDataPayload,
  BudgetLimit,
  DraftNote,
  FinancialGoal,
  LocalCalendarEvent,
  LocalSpecialDate,
  TaskItem,
  Transaction,
} from '../types';
import { hasMeaningfulLocalData, summarizePayloadCounts } from '../utils/backupSummary';
import { formatLocalDateIso } from '../utils/dateUtils';
import { validateAndParseBackupJson } from '../utils/runtimeValidator';
import {
  CURRENT_DATA_VERSION,
  serializeAppPayloadSafely,
} from '../utils/storageSanitizer';
import { FinanceContext, FinanceContextType, useFinance } from './FinanceContext';
import { PlannerContext, PlannerContextType, usePlanner } from './PlannerContext';
import {
  AutoBackupFolderStatusState,
  BackupInspectionResult,
  useWorkspace,
  WorkspaceContext,
  WorkspaceContextType,
} from './WorkspaceContext';
import { useAppPersistence } from './hooks/useAppPersistence';
import { useAppUpdater } from './hooks/useAppUpdater';
import { useBankNotificationQueue } from './hooks/useBankNotificationQueue';
import { useConfirmDialog } from './hooks/useConfirmDialog';
import { useConnectivityStatus } from './hooks/useConnectivityStatus';
import { useDraftsActions } from './hooks/useDraftsActions';
import { useFinanceActions } from './hooks/useFinanceActions';
import { useLocalCalendarActions } from './hooks/useLocalCalendarActions';
import { useNotificationsEngine } from './hooks/useNotificationsEngine';
import { useTasksActions } from './hooks/useTasksActions';
import { useThemePreference } from './hooks/useThemePreference';
import { useUndoToast } from './hooks/useUndoToast';

export type { AppUpdateDownloadState } from './hooks/useAppUpdater';
export type { CalendarEventPayload, IcsImportSummary } from './hooks/useLocalCalendarActions';
export type { BackupInspectionResult, WorkspaceContextType } from './WorkspaceContext';
export type { FinanceContextType } from './FinanceContext';
export type { PlannerContextType } from './PlannerContext';
export { useWorkspace, useFinance, usePlanner };

export type AppContextType = WorkspaceContextType & FinanceContextType & PlannerContextType;

const AppContext = createContext<AppContextType | null>(null);

const NO_OP = () => {};

/**
 * Provedor raiz do Lifeedy (100% local-first):
 * coordena a persistência segura (LocalStorage + cofre nativo AES-256-GCM no Android),
 * backup cifrado portátil (.lifeedy) e injeta os contextos modulares de domínio
 * (WorkspaceContext, FinanceContext e PlannerContext).
 */
export const AppProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { theme, toggleTheme, setThemeMode } = useThemePreference();
  const { undoToast, showUndoToast, clearUndoToast } = useUndoToast();
  const { confirmConfig, closeConfirmDialog, confirmDestructiveAction } = useConfirmDialog();

  const initialPayloadRef = useRef<Partial<AppDataPayload> | null>(null);
  if (initialPayloadRef.current === null) {
    initialPayloadRef.current = loadSyncLocalStoragePayload();
  }
  const initialPayload = initialPayloadRef.current;

  const [userName, setUserNameState] = useState<string>(() => initialPayload.userName || '');
  const [onboardingCompleted, setOnboardingCompleted] = useState<boolean>(() =>
    Boolean(initialPayload.onboardingCompleted)
  );
  const [tasks, setTasks] = useState<TaskItem[]>(() => initialPayload.tasks || []);
  const [localEvents, setLocalEvents] = useState<LocalCalendarEvent[]>(
    () => initialPayload.events || []
  );
  const [transactions, setTransactions] = useState<Transaction[]>(
    () => initialPayload.transactions || []
  );
  const [financialGoals, setFinancialGoals] = useState<FinancialGoal[]>(
    () => initialPayload.financialGoals || []
  );
  const [budgetLimits, setBudgetLimits] = useState<BudgetLimit[]>(
    () => initialPayload.budgetLimits || []
  );
  const [draftNotes, setDraftNotes] = useState<DraftNote[]>(
    () => initialPayload.draftNotes || []
  );
  const [specialDates, setSpecialDates] = useState<LocalSpecialDate[]>(
    () => initialPayload.specialDates || []
  );

  const [androidPermissions, setAndroidPermissions] = useState<AndroidPermissionsStatus | null>(null);
  const [isStartFromScratchOpen, setIsStartFromScratchOpen] = useState(false);

  const [lastPortableBackupAt, setLastPortableBackupAt] = useState<string | null>(() =>
    getLastPortableBackupAt()
  );
  const [backupReminderSnoozedUntil, setBackupReminderSnoozedUntil] = useState<string | null>(() =>
    getBackupReminderSnoozedUntil()
  );
  const [autoBackupStatus, setAutoBackupStatus] = useState<AutoBackupFolderStatusState>(() => ({
    supported: isAndroidNativeHealthSupported(),
    configured: false,
    accessible: false,
    folderName: null,
    hasPassphrase: false,
    enabled: isAutoFolderBackupEnabled(),
    lastSyncedAt: null,
    lastFileName: null,
    isSyncing: false,
    lastError: null,
  }));

  const checkUpdatesRef = useRef<
    (options?: { force?: boolean }) => Promise<UpdateCheckResult | null>
  >(async () => null);
  const autoFolderSyncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastAutoSyncedChecksumRef = useRef<string | null>(getLastAutoFolderChecksum());

  const refreshAndroidPermissions = useCallback(async () => {
    if (!isAndroidNativeHealthSupported()) return null;
    const status = await getAndroidPermissionsStatus();
    if (status) {
      setAndroidPermissions(status);
    }
    return status;
  }, []);

  const openAndroidSettings = useCallback(async (target: AndroidPermissionTarget) => {
    hapticImpactLight();
    await openAndroidPermissionSettings(target);
  }, []);

  const handleApproveBankTransactions = useCallback((newTxs: Transaction[]) => {
    setTransactions((prev) => [...newTxs, ...prev]);
  }, []);

  const bankQueue = useBankNotificationQueue({
    initialItems: initialPayload.pendingBankNotifications,
    initialSettings: initialPayload.bankCaptureSettings,
    initialScheduledMessages: initialPayload.scheduledValueMessages,
    onApproveTransactions: handleApproveBankTransactions,
  });

  const tasksActions = useTasksActions({
    tasks,
    setTasks,
    onDataChanged: NO_OP,
    showUndoToast,
  });

  const financeActions = useFinanceActions({
    transactions,
    setTransactions,
    setFinancialGoals,
    setBudgetLimits,
    onDataChanged: NO_OP,
    showUndoToast,
  });

  const draftsActions = useDraftsActions({
    draftNotes,
    setDraftNotes,
    setTasks,
    onDataChanged: NO_OP,
    showUndoToast,
  });

  const calendarActions = useLocalCalendarActions({
    localEvents,
    setLocalEvents,
    specialDates,
    setSpecialDates,
    setTasks,
    updateTask: tasksActions.updateTask,
    confirmDestructiveAction,
    showUndoToast,
    onDataChanged: NO_OP,
  });

  const notificationsEngine = useNotificationsEngine({
    tasks,
    calendarEvents: calendarActions.calendarEvents,
    transactions,
    budgetLimits,
    refreshAndroidPermissions,
  });

  const updater = useAppUpdater({
    refreshAndroidPermissions,
    onSyncNativeNotificationPerm: notificationsEngine.setNotificationPermission,
  });
  checkUpdatesRef.current = updater.checkForUpdatesNow;

  const connectivity = useConnectivityStatus(() => {
    void checkUpdatesRef.current({ force: false });
  });

  const buildCurrentPayload = useCallback(
    (): AppDataPayload => ({
      version: CURRENT_DATA_VERSION,
      lastUpdated: new Date().toISOString(),
      userName,
      onboardingCompleted,
      tasks,
      events: localEvents,
      transactions,
      financialGoals,
      budgetLimits,
      draftNotes,
      specialDates,
      pendingBankNotifications: bankQueue.pendingBankNotifications,
      bankCaptureSettings: bankQueue.bankCaptureSettings,
      scheduledValueMessages: bankQueue.scheduledValueMessages,
    }),
    [
      bankQueue.bankCaptureSettings,
      bankQueue.pendingBankNotifications,
      bankQueue.scheduledValueMessages,
      budgetLimits,
      draftNotes,
      financialGoals,
      localEvents,
      onboardingCompleted,
      specialDates,
      tasks,
      transactions,
      userName,
    ]
  );

  const applySanitizedPayload = useCallback(
    (sanitized: Partial<AppDataPayload>) => {
      if (sanitized.tasks) setTasks(sanitized.tasks);
      if (sanitized.events) setLocalEvents(sanitized.events);
      if (sanitized.transactions) setTransactions(sanitized.transactions);
      if (sanitized.financialGoals) setFinancialGoals(sanitized.financialGoals);
      if (sanitized.budgetLimits) setBudgetLimits(sanitized.budgetLimits);
      if (sanitized.draftNotes) setDraftNotes(sanitized.draftNotes);
      if (sanitized.specialDates) setSpecialDates(sanitized.specialDates);
      if (sanitized.pendingBankNotifications) {
        bankQueue.setPendingBankNotifications(sanitized.pendingBankNotifications);
      }
      if (sanitized.bankCaptureSettings) {
        bankQueue.setBankCaptureSettings(sanitized.bankCaptureSettings);
      }
      if (sanitized.scheduledValueMessages) {
        bankQueue.setScheduledValueMessages(sanitized.scheduledValueMessages);
      }
      if (typeof sanitized.userName === 'string' && sanitized.userName.trim()) {
        setUserNameState(sanitized.userName.trim());
      }

      const restoredHasData = hasMeaningfulLocalData({
        tasks: sanitized.tasks || [],
        events: sanitized.events || [],
        transactions: sanitized.transactions || [],
        financialGoals: sanitized.financialGoals || [],
        draftNotes: sanitized.draftNotes || [],
        specialDates: sanitized.specialDates || [],
        pendingBankNotifications: sanitized.pendingBankNotifications || [],
      });

      if (
        sanitized.onboardingCompleted ||
        (typeof sanitized.userName === 'string' && sanitized.userName.trim()) ||
        restoredHasData
      ) {
        setOnboardingCompleted(true);
      }
    },
    [bankQueue]
  );

  const { vaultStatus, contentChecksum, clearAllLocalPersistence } = useAppPersistence({
    buildCurrentPayload,
    applySanitizedPayload,
    tasks,
    calendarEvents: calendarActions.calendarEvents,
    transactions,
    hideValues: financeActions.hideValues,
    financeLockEnabled: financeActions.financeLockEnabled,
    onboardingCompleted,
  });

  const setUserName = useCallback((name: string) => {
    setUserNameState(name.trim());
  }, []);

  const completeOnboarding = useCallback((name: string) => {
    const cleaned = name.trim();
    if (cleaned) setUserNameState(cleaned);
    setOnboardingCompleted(true);
    hapticSuccess();
  }, []);

  const openStartFromScratchModal = useCallback(() => {
    setIsStartFromScratchOpen(true);
  }, []);

  const closeStartFromScratchModal = useCallback(() => {
    setIsStartFromScratchOpen(false);
  }, []);

  const resetWorkspaceToZero = useCallback(async () => {
    setTasks([]);
    setLocalEvents([]);
    setTransactions([]);
    setFinancialGoals([]);
    setBudgetLimits([]);
    setDraftNotes([]);
    setSpecialDates([]);
    bankQueue.setPendingBankNotifications([]);
    bankQueue.setScheduledValueMessages([]);
    notificationsEngine.resetNotificationMemory();
    setUserNameState('');
    setOnboardingCompleted(false);
    clearUndoToast();

    await clearAllLocalPersistence();
    clearBackupAuditStorage();
    setLastPortableBackupAt(null);
    setBackupReminderSnoozedUntil(null);
    lastAutoSyncedChecksumRef.current = null;
    void clearNativeVaultBackup();
    void clearNativeAutoBackupFolder(false);
    setAutoBackupStatus((prev) => ({
      ...prev,
      configured: false,
      accessible: false,
      folderName: null,
      lastSyncedAt: null,
      lastFileName: null,
      lastError: null,
    }));
    hapticWarning();
  }, [bankQueue, clearAllLocalPersistence, clearUndoToast, notificationsEngine]);

  const refreshAutoBackupStatus = useCallback(async () => {
    if (!isAndroidNativeHealthSupported()) return;
    const status = await getNativeAutoBackupFolderStatus();
    if (!status) return;
    setAutoBackupStatus((prev) => ({
      ...prev,
      supported: true,
      configured: status.configured,
      accessible: status.accessible,
      folderName: status.folderName || null,
      hasPassphrase: status.hasPassphrase,
      lastSyncedAt: status.lastSyncedAt > 0 ? status.lastSyncedAt : null,
      lastFileName: status.lastFileName || null,
    }));
  }, []);

  useEffect(() => {
    void refreshAutoBackupStatus();
  }, [refreshAutoBackupStatus]);

  const runAutoFolderBackupNow = useCallback(async (): Promise<{ ok: boolean; error?: string }> => {
    if (!isAndroidNativeHealthSupported()) {
      return { ok: false, error: 'Disponível apenas no aplicativo Android.' };
    }
    const status = await getNativeAutoBackupFolderStatus();
    if (!status?.configured || !status.accessible) {
      const msg = 'Selecione uma pasta de destino acessível no aparelho primeiro.';
      setAutoBackupStatus((prev) => ({ ...prev, lastError: msg }));
      return { ok: false, error: msg };
    }
    const passphrase = await getNativeAutoBackupPassphrase();
    if (!passphrase || passphrase.trim().length < 4) {
      const msg = 'Defina uma senha para cifrar o backup automático.';
      setAutoBackupStatus((prev) => ({ ...prev, hasPassphrase: false, lastError: msg }));
      return { ok: false, error: msg };
    }

    setAutoBackupStatus((prev) => ({ ...prev, isSyncing: true, lastError: null }));
    try {
      const payload = buildCurrentPayload();
      const { contentChecksum: nextContentChecksum } = serializeAppPayloadSafely(payload);
      const encryptedContent = await encryptBackupPayload(
        payload,
        passphrase,
        updater.installedAppVersion
      );
      const writeRes = await writeNativeAutoBackupFile({
        fileName: AUTO_BACKUP_FILENAME,
        content: encryptedContent,
        mimeType: 'application/octet-stream',
      });
      const recordedIso = recordPortableBackupTimestamp(writeRes.updatedAt);
      lastAutoSyncedChecksumRef.current = nextContentChecksum;
      setLastAutoFolderChecksum(nextContentChecksum);
      setLastPortableBackupAt(recordedIso);
      setBackupReminderSnoozedUntil(null);
      setAutoBackupStatus((prev) => ({
        ...prev,
        isSyncing: false,
        configured: true,
        accessible: true,
        hasPassphrase: true,
        lastSyncedAt: writeRes.updatedAt,
        lastFileName: writeRes.fileName,
        lastError: null,
      }));
      return { ok: true };
    } catch (err: any) {
      const msg = err?.message || 'Erro ao gravar backup automático na pasta.';
      recordAppError('autoFolderBackup.write', err);
      setAutoBackupStatus((prev) => ({
        ...prev,
        isSyncing: false,
        lastError: msg,
      }));
      return { ok: false, error: msg };
    }
  }, [buildCurrentPayload, updater.installedAppVersion]);

  const selectAutoBackupFolder = useCallback(async (): Promise<boolean> => {
    if (!isAndroidNativeHealthSupported()) return false;
    try {
      const res = await pickNativeAutoBackupFolder();
      if (!res.selected) return false;
      lastAutoSyncedChecksumRef.current = null;
      clearAutoFolderChecksumStorage();
      await refreshAutoBackupStatus();
      hapticSuccess();
      return true;
    } catch (err: any) {
      const msg = err?.message || 'Não foi possível selecionar a pasta.';
      setAutoBackupStatus((prev) => ({ ...prev, lastError: msg }));
      return false;
    }
  }, [refreshAutoBackupStatus]);

  const configureAutoBackupPassphrase = useCallback(
    async (passphrase: string): Promise<void> => {
      await saveNativeAutoBackupPassphrase(passphrase);
      lastAutoSyncedChecksumRef.current = null;
      clearAutoFolderChecksumStorage();
      setAutoBackupStatus((prev) => ({
        ...prev,
        hasPassphrase: true,
        lastError: null,
      }));
      await refreshAutoBackupStatus();
    },
    [refreshAutoBackupStatus]
  );

  const toggleAutoBackupEnabled = useCallback((enabled: boolean) => {
    setAutoFolderBackupEnabled(enabled);
    setAutoBackupStatus((prev) => ({ ...prev, enabled }));
  }, []);

  const disconnectAutoBackupFolder = useCallback(async (): Promise<void> => {
    await clearNativeAutoBackupFolder(false);
    lastAutoSyncedChecksumRef.current = null;
    clearAutoFolderChecksumStorage();
    setAutoBackupStatus((prev) => ({
      ...prev,
      configured: false,
      accessible: false,
      folderName: null,
      lastSyncedAt: null,
      lastFileName: null,
      lastError: null,
    }));
  }, []);

  // Espelhamento automático cifrado (.lifeedy) na pasta SAF escolhida no Android
  useEffect(() => {
    if (
      !isAndroidNativeHealthSupported() ||
      !onboardingCompleted ||
      !autoBackupStatus.configured ||
      !autoBackupStatus.accessible ||
      !autoBackupStatus.hasPassphrase ||
      !autoBackupStatus.enabled ||
      !contentChecksum
    ) {
      return;
    }

    if (lastAutoSyncedChecksumRef.current === contentChecksum) {
      return;
    }

    if (autoFolderSyncTimerRef.current) {
      clearTimeout(autoFolderSyncTimerRef.current);
    }

    autoFolderSyncTimerRef.current = setTimeout(() => {
      void runAutoFolderBackupNow();
    }, 3500);

    return () => {
      if (autoFolderSyncTimerRef.current) {
        clearTimeout(autoFolderSyncTimerRef.current);
      }
    };
  }, [
    autoBackupStatus.accessible,
    autoBackupStatus.configured,
    autoBackupStatus.enabled,
    autoBackupStatus.hasPassphrase,
    contentChecksum,
    onboardingCompleted,
    runAutoFolderBackupNow,
  ]);

  const dismissBackupReminder = useCallback(() => {
    const snoozed = snoozeBackupReminder(7);
    setBackupReminderSnoozedUntil(snoozed);
  }, []);

  const backupHealth = useMemo(
    () =>
      evaluatePortableBackupHealth({
        lastPortableBackupAt,
        autoFolderConfigured: autoBackupStatus.configured,
        autoFolderAccessible: autoBackupStatus.accessible,
        hasAutoPassphrase: autoBackupStatus.hasPassphrase,
        autoBackupEnabled: autoBackupStatus.enabled,
        itemCount:
          tasks.length +
          localEvents.length +
          transactions.length +
          financialGoals.length +
          draftNotes.length,
        snoozedUntil: backupReminderSnoozedUntil,
      }),
    [
      autoBackupStatus.accessible,
      autoBackupStatus.configured,
      autoBackupStatus.enabled,
      autoBackupStatus.hasPassphrase,
      backupReminderSnoozedUntil,
      draftNotes.length,
      financialGoals.length,
      lastPortableBackupAt,
      localEvents.length,
      tasks.length,
      transactions.length,
    ]
  );

  const exportEncryptedBackup = useCallback(
    async (
      password: string,
      options?: { share?: boolean }
    ): Promise<'native_share' | 'web_share' | 'download'> => {
      const payload = buildCurrentPayload();
      const encryptedContent = await encryptBackupPayload(
        payload,
        password,
        updater.installedAppVersion
      );
      const today = formatLocalDateIso();
      const delivery = await shareOrDownloadTextFile({
        fileName: `Lifeedy_Backup_${today}.lifeedy`,
        content: encryptedContent,
        mimeType: 'application/octet-stream',
        chooserTitle: 'Compartilhar backup cifrado (.lifeedy)',
        preferShare: Boolean(options?.share),
      });
      const recordedIso = recordPortableBackupTimestamp();
      setLastPortableBackupAt(recordedIso);
      setBackupReminderSnoozedUntil(null);
      hapticSuccess();
      return delivery;
    },
    [buildCurrentPayload, updater.installedAppVersion]
  );

  const exportBackupJson = useCallback(
    async (options?: { share?: boolean }): Promise<void> => {
      const payload = buildCurrentPayload();
      const today = formatLocalDateIso();
      await shareOrDownloadTextFile({
        fileName: `Lifeedy_Backup_${today}.json`,
        content: JSON.stringify(payload, null, 2),
        mimeType: 'application/json',
        chooserTitle: 'Compartilhar backup JSON',
        preferShare: Boolean(options?.share),
      });
      const recordedIso = recordPortableBackupTimestamp();
      setLastPortableBackupAt(recordedIso);
      setBackupReminderSnoozedUntil(null);
      hapticSuccess();
    },
    [buildCurrentPayload]
  );

  const inspectBackupBeforeImport = useCallback((rawText: string): BackupInspectionResult => {
    const format = detectBackupFormat(rawText);
    if (format === 'encrypted') {
      const meta = inspectEncryptedBackupMetadata(rawText);
      return {
        format: 'encrypted',
        exportedAt: meta?.exportedAt || null,
      };
    }

    if (format === 'legacy_json') {
      const validation = validateAndParseBackupJson(rawText);
      if (!validation.ok || !validation.data) {
        return {
          format: 'invalid',
          exportedAt: null,
          error: validation.error || 'Arquivo de backup inválido.',
        };
      }
      const summary = summarizePayloadCounts(validation.data.payload);
      return {
        format: 'legacy_json',
        exportedAt: summary.lastUpdated,
        summary,
      };
    }

    return {
      format: 'invalid',
      exportedAt: null,
      error: 'Formato não reconhecido. Selecione um arquivo .lifeedy ou .json do Lifeedy.',
    };
  }, []);

  const importBackupFromText = useCallback(
    async (rawText: string, password?: string) => {
      const format = detectBackupFormat(rawText);
      if (format === 'encrypted') {
        try {
          const decrypted = await decryptBackupEnvelope(rawText, password || '');
          applySanitizedPayload(decrypted.payload);
          const summary = summarizePayloadCounts(decrypted.payload);
          hapticSuccess();
          triggerConfetti({ particleCount: 45, spread: 65, origin: { y: 0.75 } });
          return { ok: true, summary, payload: decrypted.payload };
        } catch (err: any) {
          recordAppError('backup.importEncrypted', err);
          return {
            ok: false,
            error: err?.message || 'Não foi possível descriptografar o backup.',
          };
        }
      }

      if (format === 'legacy_json') {
        const validation = validateAndParseBackupJson(rawText);
        if (!validation.ok || !validation.data) {
          recordAppError('backup.importJson', validation.error || 'Backup JSON inválido');
          return {
            ok: false,
            error: validation.error || 'Arquivo JSON inválido.',
          };
        }
        applySanitizedPayload(validation.data.payload);
        const summary = summarizePayloadCounts(validation.data.payload);
        hapticSuccess();
        triggerConfetti({ particleCount: 45, spread: 65, origin: { y: 0.75 } });
        return { ok: true, summary, payload: validation.data.payload };
      }

      return {
        ok: false,
        error: 'Arquivo inválido. Selecione um backup .lifeedy ou .json do Lifeedy.',
      };
    },
    [applySanitizedPayload]
  );

  const importBackupJson = useCallback(
    (content: string): boolean => {
      try {
        const validation = validateAndParseBackupJson(content);
        if (!validation.ok || !validation.data) {
          recordAppError('backup.import', validation.error || 'Backup JSON inválido');
          return false;
        }
        applySanitizedPayload(validation.data.payload);
        return true;
      } catch (e) {
        recordAppError('backup.import', e);
        return false;
      }
    },
    [applySanitizedPayload]
  );

  const workspaceValue = useMemo<WorkspaceContextType>(
    () => ({
      theme,
      toggleTheme,
      setThemeMode,
      userName,
      setUserName,
      onboardingCompleted,
      completeOnboarding,
      isStartFromScratchOpen,
      openStartFromScratchModal,
      closeStartFromScratchModal,
      resetWorkspaceToZero,
      exportEncryptedBackup,
      exportBackupJson,
      inspectBackupBeforeImport,
      importBackupFromText,
      importBackupJson,
      lastPortableBackupAt,
      backupHealth,
      dismissBackupReminder,
      autoBackupStatus,
      refreshAutoBackupStatus,
      selectAutoBackupFolder,
      configureAutoBackupPassphrase,
      toggleAutoBackupEnabled,
      disconnectAutoBackupFolder,
      runAutoFolderBackupNow,
      undoToast,
      clearUndoToast,
      confirmDestructiveAction,
      installedAppVersion: updater.installedAppVersion,
      installedBuildNumber: updater.installedBuildNumber,
      distributionChannel: updater.distributionChannel,
      appUpdateResult: updater.appUpdateResult,
      isCheckingAppUpdate: updater.isCheckingAppUpdate,
      updateDownloadState: updater.updateDownloadState,
      isUpdateBannerDismissed: updater.isUpdateBannerDismissed,
      checkForUpdatesNow: updater.checkForUpdatesNow,
      startInAppUpdate: updater.startInAppUpdate,
      openUnknownSourcesAndAwaitReturn: updater.openUnknownSourcesAndAwaitReturn,
      retryInstallPendingApk: updater.retryInstallPendingApk,
      dismissUpdateBanner: updater.dismissUpdateBanner,
      resetUpdateDownloadState: updater.resetUpdateDownloadState,
      isOnline: connectivity.isOnline,
      justReconnected: connectivity.justReconnected,
      dismissReconnectedBanner: connectivity.dismissReconnectedBanner,
      androidPermissions,
      refreshAndroidPermissions,
      openAndroidSettings,
      vaultStatus,
    }),
    [
      androidPermissions,
      autoBackupStatus,
      backupHealth,
      clearUndoToast,
      closeStartFromScratchModal,
      completeOnboarding,
      configureAutoBackupPassphrase,
      confirmDestructiveAction,
      connectivity.dismissReconnectedBanner,
      connectivity.isOnline,
      connectivity.justReconnected,
      disconnectAutoBackupFolder,
      dismissBackupReminder,
      exportBackupJson,
      exportEncryptedBackup,
      importBackupFromText,
      importBackupJson,
      inspectBackupBeforeImport,
      isStartFromScratchOpen,
      lastPortableBackupAt,
      onboardingCompleted,
      openAndroidSettings,
      openStartFromScratchModal,
      refreshAndroidPermissions,
      refreshAutoBackupStatus,
      resetWorkspaceToZero,
      runAutoFolderBackupNow,
      selectAutoBackupFolder,
      setThemeMode,
      setUserName,
      theme,
      toggleAutoBackupEnabled,
      toggleTheme,
      undoToast,
      updater.appUpdateResult,
      updater.checkForUpdatesNow,
      updater.dismissUpdateBanner,
      updater.distributionChannel,
      updater.installedAppVersion,
      updater.installedBuildNumber,
      updater.isCheckingAppUpdate,
      updater.isUpdateBannerDismissed,
      updater.openUnknownSourcesAndAwaitReturn,
      updater.resetUpdateDownloadState,
      updater.retryInstallPendingApk,
      updater.startInAppUpdate,
      updater.updateDownloadState,
      userName,
      vaultStatus,
    ]
  );

  const financeValue = useMemo<FinanceContextType>(
    () => ({
      transactions,
      financialGoals,
      budgetLimits,
      ...financeActions,
      pendingBankNotifications: bankQueue.pendingBankNotifications,
      bankListenerSupported: bankQueue.bankListenerSupported,
      bankListenerPermission: bankQueue.bankListenerPermission,
      refreshBankListenerPermission: bankQueue.refreshBankListenerPermission,
      openBankListenerSettings: bankQueue.openBankListenerSettings,
      enqueueParsedBankText: bankQueue.enqueueParsedBankText,
      approvePendingBankNotification: bankQueue.approvePendingBankNotification,
      approveAllPendingBankNotifications: bankQueue.approveAllPendingBankNotifications,
      dismissPendingBankNotification: bankQueue.dismissPendingBankNotification,
      clearPendingBankNotifications: bankQueue.clearPendingBankNotifications,
      bankCaptureSettings: bankQueue.bankCaptureSettings,
      updateBankCaptureSettings: bankQueue.updateBankCaptureSettings,
      addManualCaptureApp: bankQueue.addManualCaptureApp,
      toggleManualCaptureApp: bankQueue.toggleManualCaptureApp,
      removeManualCaptureApp: bankQueue.removeManualCaptureApp,
      installedAndroidApps: bankQueue.installedAndroidApps,
      loadInstalledAndroidApps: bankQueue.loadInstalledAndroidApps,
      scheduledValueMessages: bankQueue.scheduledValueMessages,
      addScheduledValueMessage: bankQueue.addScheduledValueMessage,
      toggleScheduledValueMessage: bankQueue.toggleScheduledValueMessage,
      deleteScheduledValueMessage: bankQueue.deleteScheduledValueMessage,
      triggerScheduledValueMessageNow: bankQueue.triggerScheduledValueMessageNow,
    }),
    [
      bankQueue.addManualCaptureApp,
      bankQueue.addScheduledValueMessage,
      bankQueue.approveAllPendingBankNotifications,
      bankQueue.approvePendingBankNotification,
      bankQueue.bankCaptureSettings,
      bankQueue.bankListenerPermission,
      bankQueue.bankListenerSupported,
      bankQueue.clearPendingBankNotifications,
      bankQueue.deleteScheduledValueMessage,
      bankQueue.dismissPendingBankNotification,
      bankQueue.enqueueParsedBankText,
      bankQueue.installedAndroidApps,
      bankQueue.loadInstalledAndroidApps,
      bankQueue.openBankListenerSettings,
      bankQueue.pendingBankNotifications,
      bankQueue.refreshBankListenerPermission,
      bankQueue.removeManualCaptureApp,
      bankQueue.scheduledValueMessages,
      bankQueue.toggleManualCaptureApp,
      bankQueue.toggleScheduledValueMessage,
      bankQueue.triggerScheduledValueMessageNow,
      bankQueue.updateBankCaptureSettings,
      financeActions,
      financialGoals,
      budgetLimits,
      transactions,
    ]
  );

  const plannerValue = useMemo<PlannerContextType>(
    () => ({
      tasks,
      localEvents: calendarActions.localEvents,
      specialDates,
      calendarEvents: calendarActions.calendarEvents,
      draftNotes,
      ...tasksActions,
      ...draftsActions,
      addSpecialDate: calendarActions.addSpecialDate,
      deleteSpecialDate: calendarActions.deleteSpecialDate,
      createTaskFromCalendarEvent: calendarActions.createTaskFromCalendarEvent,
      addLocalEvent: calendarActions.addLocalEvent,
      updateLocalEvent: calendarActions.updateLocalEvent,
      removeLocalEvent: calendarActions.removeLocalEvent,
      scheduleTaskInCalendar: calendarActions.scheduleTaskInCalendar,
      importIcsCalendar: calendarActions.importIcsCalendar,
      exportAgendaIcs: calendarActions.exportAgendaIcs,
      notificationPermission: notificationsEngine.notificationPermission,
      notificationsList: notificationsEngine.notificationsList,
      enableNotifications: notificationsEngine.enableNotifications,
      triggerTestNotification: notificationsEngine.triggerTestNotification,
      dismissNotification: notificationsEngine.dismissNotification,
      clearAllNotifications: notificationsEngine.clearAllNotifications,
      pendingNotificationTarget: notificationsEngine.pendingNotificationTarget,
      consumeNotificationTarget: notificationsEngine.consumeNotificationTarget,
    }),
    [
      calendarActions.addLocalEvent,
      calendarActions.addSpecialDate,
      calendarActions.calendarEvents,
      calendarActions.createTaskFromCalendarEvent,
      calendarActions.deleteSpecialDate,
      calendarActions.exportAgendaIcs,
      calendarActions.importIcsCalendar,
      calendarActions.localEvents,
      calendarActions.removeLocalEvent,
      calendarActions.scheduleTaskInCalendar,
      calendarActions.updateLocalEvent,
      draftNotes,
      draftsActions,
      notificationsEngine.clearAllNotifications,
      notificationsEngine.consumeNotificationTarget,
      notificationsEngine.dismissNotification,
      notificationsEngine.enableNotifications,
      notificationsEngine.notificationPermission,
      notificationsEngine.notificationsList,
      notificationsEngine.pendingNotificationTarget,
      notificationsEngine.triggerTestNotification,
      specialDates,
      tasks,
      tasksActions,
    ]
  );

  const combinedValue = useMemo<AppContextType>(
    () => ({
      ...workspaceValue,
      ...financeValue,
      ...plannerValue,
    }),
    [financeValue, plannerValue, workspaceValue]
  );

  return (
    <WorkspaceContext.Provider value={workspaceValue}>
      <FinanceContext.Provider value={financeValue}>
        <PlannerContext.Provider value={plannerValue}>
          <AppContext.Provider value={combinedValue}>
            {children}
            <GlobalConfirmModal config={confirmConfig} onClose={closeConfirmDialog} />
          </AppContext.Provider>
        </PlannerContext.Provider>
      </FinanceContext.Provider>
    </WorkspaceContext.Provider>
  );
};

export const useApp = (): AppContextType => {
  const context = useContext(AppContext);
  if (!context) {
    throw new Error('useApp must be used within an AppProvider');
  }
  return context;
};
