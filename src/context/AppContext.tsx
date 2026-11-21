import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import { App as CapApp } from '@capacitor/app';
import { Browser } from '@capacitor/browser';
import { User } from 'firebase/auth';
import confetti from 'canvas-confetti';
import {
  CURRENT_DATA_VERSION,
  DEFAULT_WIDGETS,
  sanitizeLegacyPayload,
  serializeAppPayloadSafely,
} from '../utils/storageSanitizer';
import { validateAndParseBackupJson } from '../utils/runtimeValidator';
import {
  BackupCountsSummary,
  hasMeaningfulLocalData,
  summarizePayloadCounts,
} from '../utils/backupSummary';
import {
  AppDataPayload,
  AppNotification,
  BudgetLimit,
  DraftNote,
  DriveSyncInfo,
  FinancialGoal,
  GoogleCalendarEvent,
  LocalSpecialDate,
  PendingBankNotification,
  TaskItem,
  Transaction,
} from '../types';
import {
  completeNativeGoogleAuth,
  consumeRedirectSignInResult,
  getAccessToken,
  googleSignIn,
  initAuth,
  isAccessTokenExpiredOrNearExpiry,
  loadPersistedUserProfile,
  logout as fbLogout,
  mapGoogleAuthError,
  persistedProfileToUser,
  setSessionToken,
} from '../services/firebase';
import { isWorkspaceAuthError } from '../services/googleAuthError';
import {
  DriveFileInfo,
  findDriveBackupFile,
  readDriveFile,
  saveToDrive,
} from '../services/driveService';
import { listCalendarEvents } from '../services/calendarService';
import { NotificationNavigationTarget } from '../services/notificationService';
import { hapticImpactLight, hapticSuccess, hapticWarning } from '../services/hapticsService';
import {
  AndroidPermissionsStatus,
  AndroidPermissionTarget,
  clearNativeVaultBackup,
  getAndroidPermissionsStatus,
  isAndroidNativeHealthSupported,
  loadNativeVaultBackup,
  openAndroidPermissionSettings,
  saveNativeVaultBackup,
} from '../services/appHealthBridge';
import { recordAppError } from '../services/errorJournalService';
import { UpdateCheckResult } from '../services/githubUpdateService';
import { GlobalConfirmModal } from '../components/Common/GlobalConfirmModal';
import { useThemePreference } from './hooks/useThemePreference';
import { UndoToastInfo, useUndoToast } from './hooks/useUndoToast';
import { ConfirmActionInput, useConfirmDialog } from './hooks/useConfirmDialog';
import { AppUpdateDownloadState, useAppUpdater } from './hooks/useAppUpdater';
import { useConnectivityStatus } from './hooks/useConnectivityStatus';
import { useBankNotificationQueue } from './hooks/useBankNotificationQueue';
import { useTasksActions } from './hooks/useTasksActions';
import { useFinanceActions } from './hooks/useFinanceActions';
import { useDraftsActions } from './hooks/useDraftsActions';
import { CalendarEventPayload, useGoogleCalendarActions } from './hooks/useGoogleCalendarActions';
import { useNotificationsEngine } from './hooks/useNotificationsEngine';

export type { AppUpdateDownloadState } from './hooks/useAppUpdater';

const STORAGE_KEY_DATA = 'vidaorganizada_local_data_v2';
const STORAGE_KEY_SYNC = 'vidaorganizada_sync_info_v2';
const STORAGE_KEY_NOTIFS = 'vidaorganizada_notifications_v2';
const STORAGE_KEY_PENDING_BANK = 'vidaorganizada_pending_bank_v1';
const STORAGE_KEY_BANK_SIGS = 'vidaorganizada_ingested_bank_sigs_v1';

function loadInitialLocalPayload(): Partial<AppDataPayload> {
  try {
    const saved = localStorage.getItem(STORAGE_KEY_DATA);
    if (saved) {
      return sanitizeLegacyPayload(JSON.parse(saved));
    }
  } catch (e) {
    console.warn('Erro ao ler dados locais:', e);
  }
  return {};
}

interface AppContextType {
  // Tema visual
  theme: 'light' | 'dark';
  toggleTheme: () => void;
  setThemeMode: (mode: 'light' | 'dark') => void;

  // Perfil e boas-vindas
  userName: string;
  setUserName: (name: string) => void;
  onboardingCompleted: boolean;
  completeOnboarding: (name: string) => void;

  // Conta Google e autenticação
  user: User | null;
  accessToken: string | null;
  workspaceAuthStatus: 'disconnected' | 'connected' | 'refreshing' | 'needs_reauth';
  isAuthenticating: boolean;
  authError: string | null;
  clearAuthError: () => void;
  signInWithGoogle: () => Promise<string | null>;
  refreshWorkspaceSession: (options?: { interactiveIfNeeded?: boolean }) => Promise<string | null>;
  signOut: () => Promise<void>;

  // Dados principais
  tasks: TaskItem[];
  transactions: Transaction[];
  financialGoals: FinancialGoal[];
  budgetLimits: BudgetLimit[];
  draftNotes: DraftNote[];
  specialDates: LocalSpecialDate[];
  dashboardWidgets: string[];
  calendarEvents: GoogleCalendarEvent[];
  isLoadingCalendar: boolean;

  // Ações de tarefas
  addTask: (task: Omit<TaskItem, 'id'>) => void;
  updateTask: (id: string, updates: Partial<TaskItem>) => void;
  toggleTaskCompletion: (id: string) => void;
  snoozeTaskToTomorrow: (id: string) => void;
  deleteTask: (id: string) => void;
  toggleSubtask: (taskId: string, subtaskId: string) => void;

  // Privacidade e bloqueio financeiro
  hideValues: boolean;
  toggleHideValues: () => void;
  formatMoney: (amount: number) => string;
  financeLockEnabled: boolean;
  setFinanceLockEnabled: (enabled: boolean) => void;

  // Ações financeiras
  addTransaction: (tx: Omit<Transaction, 'id'>) => void;
  updateTransaction: (id: string, updates: Partial<Omit<Transaction, 'id'>>) => void;
  deleteTransaction: (id: string) => void;
  addGoal: (goal: Omit<FinancialGoal, 'id'>) => void;
  updateGoal: (id: string, updates: Partial<FinancialGoal>) => void;
  deleteGoal: (id: string) => void;
  updateBudgetLimit: (category: Transaction['category'], limit: number) => void;

  // Fila de notificações bancárias
  pendingBankNotifications: PendingBankNotification[];
  bankListenerSupported: boolean;
  bankListenerPermission: boolean;
  refreshBankListenerPermission: () => Promise<boolean>;
  openBankListenerSettings: () => Promise<void>;
  enqueueParsedBankText: (rawText: string, bankName?: string) => PendingBankNotification | null;
  approvePendingBankNotification: (
    id: string,
    overrides?: Partial<Omit<Transaction, 'id'>>
  ) => void;
  approveAllPendingBankNotifications: () => void;
  dismissPendingBankNotification: (id: string) => void;
  clearPendingBankNotifications: () => void;

  // Ações de rascunhos e listas
  addDraftNote: (note: Omit<DraftNote, 'id' | 'updatedAt'>) => void;
  updateDraftNote: (id: string, updates: Partial<DraftNote>) => void;
  deleteDraftNote: (id: string) => void;
  togglePinDraft: (id: string) => void;
  toggleDraftChecklistItem: (draftId: string, itemId: string) => void;
  addDraftChecklistItem: (draftId: string, text: string) => void;
  convertDraftToTask: (draft: DraftNote) => void;

  // Painel inicial modular
  toggleDashboardWidget: (widgetId: string) => void;

  // Central de notificações e lembretes
  notificationPermission: NotificationPermission;
  notificationsList: AppNotification[];
  enableNotifications: () => Promise<boolean>;
  triggerTestNotification: () => void;
  dismissNotification: (id: string) => void;
  clearAllNotifications: () => void;

  // Agenda e datas especiais
  refreshCalendar: () => Promise<void>;
  addSpecialDate: (item: Omit<LocalSpecialDate, 'id' | 'createdAt'>) => void;
  deleteSpecialDate: (id: string) => void;
  createTaskFromCalendarEvent: (event: GoogleCalendarEvent) => void;
  addEventToGoogleCalendar: (event: CalendarEventPayload) => Promise<GoogleCalendarEvent | null>;
  updateGoogleCalendarEvent: (eventId: string, event: CalendarEventPayload) => void;
  removeGoogleCalendarEvent: (eventId: string) => Promise<void>;
  scheduleTaskInCalendar: (task: TaskItem, startHour?: string) => Promise<boolean>;

  // Sincronização em nuvem (Google Drive) e backup
  driveSyncInfo: DriveSyncInfo;
  isCheckingDriveOnLogin: boolean;
  pendingDriveRestore: {
    driveFile: DriveFileInfo;
    remoteData: AppDataPayload;
    remoteSummary: BackupCountsSummary;
  } | null;
  autoRestoredNotice: {
    summary: BackupCountsSummary;
    driveFile: DriveFileInfo;
  } | null;
  isStartFromScratchOpen: boolean;
  acceptPendingDriveRestore: () => void;
  dismissPendingDriveRestore: () => void;
  dismissAutoRestoredNotice: () => void;
  openStartFromScratchModal: () => void;
  closeStartFromScratchModal: () => void;
  resetWorkspaceToZero: (options?: { alsoResetCloud?: boolean }) => Promise<void>;
  syncToDriveNow: () => Promise<void>;
  restoreFromDriveNow: () => Promise<void>;
  exportBackupJson: () => void;
  importBackupJson: (content: string) => boolean;

  // Aviso rápido Desfazer e confirmações
  undoToast: UndoToastInfo | null;
  clearUndoToast: () => void;
  confirmDestructiveAction: (config: ConfirmActionInput) => void;

  // Atualizador de APK direto (GitHub)
  installedAppVersion: string;
  installedBuildNumber: number;
  distributionChannel: 'githubApk' | 'web';
  appUpdateResult: UpdateCheckResult | null;
  isCheckingAppUpdate: boolean;
  updateDownloadState: AppUpdateDownloadState;
  isUpdateBannerDismissed: boolean;
  checkForUpdatesNow: (options?: {
    repo?: string;
    token?: string;
    force?: boolean;
  }) => Promise<UpdateCheckResult | null>;
  startInAppUpdate: () => Promise<void>;
  openUnknownSourcesAndAwaitReturn: () => Promise<void>;
  retryInstallPendingApk: () => Promise<void>;
  dismissUpdateBanner: () => void;
  resetUpdateDownloadState: () => void;

  // Conectividade, permissões Android e integridade do cofre
  isOnline: boolean;
  justReconnected: boolean;
  dismissReconnectedBanner: () => void;
  androidPermissions: AndroidPermissionsStatus | null;
  refreshAndroidPermissions: () => Promise<AndroidPermissionsStatus | null>;
  openAndroidSettings: (target: AndroidPermissionTarget) => Promise<void>;
  vaultStatus: {
    lastSavedAt: string | null;
    checksum: string | null;
    byteSize: number;
    recoveredFromNative: boolean;
  };
  pendingNotificationTarget: { target: NotificationNavigationTarget; itemId?: string } | null;
  consumeNotificationTarget: () => void;
}

const AppContext = createContext<AppContextType | null>(null);

/**
 * Provedor principal do aplicativo:
 * organiza estado central, autenticação Google, sincronização com Drive e
 * conecta os módulos independentes (tarefas, finanças, agenda, rascunhos e atualizações).
 */
export const AppProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  // 1. Tema, avisos Desfazer e modal global de confirmação
  const { theme, toggleTheme, setThemeMode } = useThemePreference();
  const { undoToast, showUndoToast, clearUndoToast } = useUndoToast();
  const { confirmConfig, closeConfirmDialog, confirmDestructiveAction } = useConfirmDialog();

  // 2. Carregamento inicial sanitizado do armazenamento local
  const initialPayloadRef = useRef<Partial<AppDataPayload> | null>(null);
  if (initialPayloadRef.current === null) {
    initialPayloadRef.current = loadInitialLocalPayload();
  }
  const initialPayload = initialPayloadRef.current;

  // 3. Perfil e dados centrais do usuário
  const [userName, setUserNameState] = useState<string>(() => initialPayload.userName || '');
  const [onboardingCompleted, setOnboardingCompleted] = useState<boolean>(() =>
    Boolean(initialPayload.onboardingCompleted)
  );
  const [tasks, setTasks] = useState<TaskItem[]>(() => initialPayload.tasks || []);
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
  const [dashboardWidgets, setDashboardWidgets] = useState<string[]>(
    () => initialPayload.dashboardWidgets || DEFAULT_WIDGETS
  );

  // 4. Estado da conta Google (perfil persiste mesmo após expiração de 1h do token)
  const [user, setUser] = useState<User | null>(() => {
    const restored = loadPersistedUserProfile();
    return restored ? persistedProfileToUser(restored) : null;
  });
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [workspaceAuthStatus, setWorkspaceAuthStatus] = useState<
    'disconnected' | 'connected' | 'refreshing' | 'needs_reauth'
  >(() => (loadPersistedUserProfile() ? 'needs_reauth' : 'disconnected'));
  const [tokenExpiresAt, setTokenExpiresAt] = useState<number>(0);
  const [isAuthenticating, setIsAuthenticating] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const clearAuthError = useCallback(() => setAuthError(null), []);

  const userRef = useRef<User | null>(user);
  userRef.current = user;

  // 5. Estado de sincronização em nuvem e cofre Android
  const [driveSyncInfo, setDriveSyncInfo] = useState<DriveSyncInfo>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY_SYNC);
      if (saved) return JSON.parse(saved);
    } catch {
      // ignora erro de leitura
    }
    return {
      fileId: null,
      lastSyncedAt: null,
      remoteModifiedAt: null,
      status: 'idle',
    };
  });

  const [androidPermissions, setAndroidPermissions] = useState<AndroidPermissionsStatus | null>(null);
  const [vaultStatus, setVaultStatus] = useState({
    lastSavedAt: null as string | null,
    checksum: null as string | null,
    byteSize: 0,
    recoveredFromNative: false,
  });

  const [isCheckingDriveOnLogin, setIsCheckingDriveOnLogin] = useState(false);
  const [pendingDriveRestore, setPendingDriveRestore] = useState<{
    driveFile: DriveFileInfo;
    remoteData: AppDataPayload;
    remoteSummary: BackupCountsSummary;
  } | null>(null);
  const [autoRestoredNotice, setAutoRestoredNotice] = useState<{
    summary: BackupCountsSummary;
    driveFile: DriveFileInfo;
  } | null>(null);
  const [isStartFromScratchOpen, setIsStartFromScratchOpen] = useState(false);

  // Refs pontuais para evitar dependências circulares entre os hooks modulares
  const triggerAutoSyncRef = useRef<() => void>(() => {});
  const signInRef = useRef<() => Promise<string | null>>(async () => null);
  const inspectDriveBackupRef = useRef<(token: string) => Promise<void>>(async () => {});
  const pushNotificationRef = useRef<
    (input: { id?: string; title: string; body: string; type: AppNotification['type'] }) => void
  >(() => {});
  const setGoogleCalendarEventsRef = useRef<React.Dispatch<React.SetStateAction<GoogleCalendarEvent[]>>>(
    () => {}
  );
  const checkUpdatesRef = useRef<
    (options?: { force?: boolean }) => Promise<UpdateCheckResult | null>
  >(async () => null);

  const syncTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inspectedTokensRef = useRef<Set<string>>(new Set());
  const cloudOverwriteGuardRef = useRef<boolean>(false);
  const sessionExpiredNotifiedRef = useRef<boolean>(false);
  const nativeVaultTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const vaultBootRecoveredRef = useRef<boolean>(false);

  const onDataChanged = useCallback(() => {
    triggerAutoSyncRef.current();
  }, []);

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

  const handleWorkspaceAuthError = useCallback((err: unknown): boolean => {
    if (!isWorkspaceAuthError(err)) return false;

    setSessionToken(null);
    setAccessToken(null);
    setTokenExpiresAt(0);
    setWorkspaceAuthStatus(userRef.current ? 'needs_reauth' : 'disconnected');

    if (userRef.current && !sessionExpiredNotifiedRef.current) {
      sessionExpiredNotifiedRef.current = true;
      pushNotificationRef.current({
        id: 'notif-auth-refresh-' + Date.now(),
        title: 'Sincronização Google em espera',
        body: 'Sua conta continua conectada no Lifeedy. Toque em "Renovar sincronização" nos ajustes ou na nuvem quando quiser atualizar Drive e Agenda.',
        type: 'reminder',
      });
    }
    return true;
  }, []);

  const ensureSignedInToken = useCallback(async (): Promise<string | null> => {
    return accessToken || (await getAccessToken()) || (await signInRef.current());
  }, [accessToken]);

  // 6. Módulos de domínio (hooks independentes)
  const handleApproveBankTransactions = useCallback((newTxs: Transaction[]) => {
    setTransactions((prev) => [...newTxs, ...prev]);
    triggerAutoSyncRef.current();
  }, []);

  const bankQueue = useBankNotificationQueue({
    initialItems: initialPayload.pendingBankNotifications,
    onApproveTransactions: handleApproveBankTransactions,
  });

  const tasksActions = useTasksActions({
    tasks,
    setTasks,
    onDataChanged,
    showUndoToast,
  });

  const financeActions = useFinanceActions({
    transactions,
    setTransactions,
    setFinancialGoals,
    setBudgetLimits,
    onDataChanged,
    showUndoToast,
  });

  const draftsActions = useDraftsActions({
    draftNotes,
    setDraftNotes,
    setTasks,
    onDataChanged,
    showUndoToast,
  });

  const calendarActions = useGoogleCalendarActions({
    accessToken,
    specialDates,
    setSpecialDates,
    setTasks,
    updateTask: tasksActions.updateTask,
    ensureSignedInToken,
    handleWorkspaceAuthError,
    confirmDestructiveAction,
    showUndoToast,
    onDataChanged,
  });
  setGoogleCalendarEventsRef.current = calendarActions.setGoogleCalendarEvents;

  const notificationsEngine = useNotificationsEngine({
    tasks,
    calendarEvents: calendarActions.calendarEvents,
    transactions,
    refreshAndroidPermissions,
  });
  pushNotificationRef.current = notificationsEngine.pushAppNotification;

  const updater = useAppUpdater({
    refreshAndroidPermissions,
    onSyncNativeNotificationPerm: notificationsEngine.setNotificationPermission,
  });
  checkUpdatesRef.current = updater.checkForUpdatesNow;

  const connectivity = useConnectivityStatus(() => {
    void checkUpdatesRef.current({ force: false });
  });

  // Snapshot mais recente para comparações seguras pós-login e restauração
  const latestDataRef = useRef({
    tasks,
    transactions,
    financialGoals,
    draftNotes,
    specialDates,
    pendingBankNotifications: bankQueue.pendingBankNotifications,
  });
  latestDataRef.current = {
    tasks,
    transactions,
    financialGoals,
    draftNotes,
    specialDates,
    pendingBankNotifications: bankQueue.pendingBankNotifications,
  };

  const buildCurrentPayload = useCallback(
    (): AppDataPayload => ({
      version: CURRENT_DATA_VERSION,
      lastUpdated: new Date().toISOString(),
      userName,
      onboardingCompleted,
      tasks,
      transactions,
      financialGoals,
      budgetLimits,
      draftNotes,
      specialDates,
      dashboardWidgets,
      pendingBankNotifications: bankQueue.pendingBankNotifications,
    }),
    [
      bankQueue.pendingBankNotifications,
      budgetLimits,
      dashboardWidgets,
      draftNotes,
      financialGoals,
      onboardingCompleted,
      specialDates,
      tasks,
      transactions,
      userName,
    ]
  );

  // 7. Persistência local automática + espelhamento no cofre nativo do Android
  useEffect(() => {
    const payload = buildCurrentPayload();
    const { json, checksum, byteSize } = serializeAppPayloadSafely(payload);

    try {
      localStorage.setItem(STORAGE_KEY_DATA, json);
      setVaultStatus((prev) => ({
        ...prev,
        lastSavedAt: payload.lastUpdated,
        checksum,
        byteSize,
      }));
    } catch (e) {
      recordAppError('localStorage.persist', e, `bytes=${byteSize}`);
      console.error('Falha ao salvar dados no LocalStorage:', e);
    }

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
  }, [buildCurrentPayload]);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY_SYNC, JSON.stringify(driveSyncInfo));
    } catch {
      // ignora erro de gravação
    }
  }, [driveSyncInfo]);

  // 8. Observadores de Autenticação Google (Web + Android nativo)
  useEffect(() => {
    const unsubscribe = initAuth(
      (currentUser, token, expiresAt) => {
        setUser(currentUser);
        if (token) {
          setAccessToken(token);
          setTokenExpiresAt(expiresAt);
          setWorkspaceAuthStatus('connected');
        } else {
          setAccessToken(null);
          setTokenExpiresAt(0);
          setWorkspaceAuthStatus((prev) => (prev === 'refreshing' ? 'refreshing' : 'needs_reauth'));
        }
      },
      () => {
        setUser(null);
        setAccessToken(null);
        setTokenExpiresAt(0);
        setWorkspaceAuthStatus('disconnected');
      }
    );
    return () => unsubscribe();
  }, []);

  // Callback de deep-link OAuth caso algum fluxo abra o navegador externo no Android
  const processedOAuthUrlsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    let isMounted = true;

    const handleNativeOAuthUrl = async (raw?: string | null) => {
      if (!isMounted || !raw) return;
      if (!raw.includes('com.vidaorganizada.app') || !raw.includes('access_token=')) return;
      if (processedOAuthUrlsRef.current.has(raw)) return;
      processedOAuthUrlsRef.current.add(raw);

      try {
        const hashIdx = raw.indexOf('#');
        const queryIdx = raw.indexOf('?');
        const searchStr =
          hashIdx !== -1
            ? raw.substring(hashIdx + 1)
            : queryIdx !== -1
            ? raw.substring(queryIdx + 1)
            : '';
        const params = new URLSearchParams(searchStr);

        const token = params.get('access_token');
        const idToken = params.get('id_token');
        const expiresInParam = params.get('expires_in');
        const expiresInSec = expiresInParam ? parseInt(expiresInParam, 10) : undefined;

        try {
          await Browser.close();
        } catch {
          // ignora
        }

        if (token) {
          setIsAuthenticating(true);
          setAuthError(null);
          sessionExpiredNotifiedRef.current = false;
          const loggedUser = await completeNativeGoogleAuth(token, idToken, expiresInSec);
          setAccessToken(token);
          setTokenExpiresAt(
            Date.now() + (expiresInSec && expiresInSec > 60 ? expiresInSec : 3500) * 1000
          );
          setWorkspaceAuthStatus('connected');
          if (loggedUser) setUser(loggedUser);

          confetti({ particleCount: 35, spread: 60, origin: { y: 0.8 } });

          try {
            await inspectDriveBackupRef.current(token);
          } catch (e) {
            console.warn('Erro ao consultar Drive pós deep link:', e);
          }

          try {
            const events = await listCalendarEvents(token);
            setGoogleCalendarEventsRef.current(events);
          } catch (e) {
            console.warn('Erro ao consultar Agenda pós deep link:', e);
          }

          pushNotificationRef.current({
            id: 'notif-auth-ok-' + Date.now(),
            title: '🎉 Google Conectado com Sucesso',
            body: 'Sua conta Google foi sincronizada. Google Drive e Agenda estão ativos.',
            type: 'reminder',
          });
        }
      } catch (err) {
        console.error('Falha ao processar login nativo do Google:', err);
        setAuthError(mapGoogleAuthError(err));
      } finally {
        if (isMounted) setIsAuthenticating(false);
      }
    };

    CapApp.getLaunchUrl()
      .then((launch) => handleNativeOAuthUrl(launch?.url))
      .catch(() => {});

    const listenerPromise = CapApp.addListener('appUrlOpen', (data) => {
      void handleNativeOAuthUrl(data?.url);
    });

    return () => {
      isMounted = false;
      listenerPromise.then((h) => h?.remove()).catch(() => {});
    };
  }, []);

  // Finaliza redirecionamento na Web caso o popup não tenha sido usado
  useEffect(() => {
    if (Capacitor.isNativePlatform()) return;
    if (
      typeof window !== 'undefined' &&
      new URLSearchParams(window.location.search).get('connect_native') === '1'
    ) {
      return;
    }

    let active = true;
    consumeRedirectSignInResult()
      .then((res) => {
        if (!active || !res?.accessToken || !res.user) return;
        sessionExpiredNotifiedRef.current = false;
        setAuthError(null);
        setUser(res.user);
        setAccessToken(res.accessToken);
        setTokenExpiresAt(res.expiresAt);
        setWorkspaceAuthStatus('connected');
      })
      .catch((err) => {
        console.warn('Erro ao finalizar login Google via redirecionamento:', err);
        if (active) setAuthError(mapGoogleAuthError(err));
      });
    return () => {
      active = false;
    };
  }, []);

  // Monitora expiração do token de 1h sem desconectar o usuário
  useEffect(() => {
    if (!user) return;

    const markNeedsReauthIfExpired = () => {
      if (userRef.current && accessToken && isAccessTokenExpiredOrNearExpiry(30_000)) {
        setSessionToken(null);
        setAccessToken(null);
        setTokenExpiresAt(0);
        setWorkspaceAuthStatus('needs_reauth');
      }
    };

    let expiryTimer: ReturnType<typeof setTimeout> | null = null;
    if (accessToken && tokenExpiresAt > Date.now()) {
      const delayMs = Math.max(5_000, tokenExpiresAt - Date.now() - 30_000);
      expiryTimer = setTimeout(markNeedsReauthIfExpired, delayMs);
    }

    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        markNeedsReauthIfExpired();
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);

    let capAppHandle: { remove: () => Promise<void> } | null = null;
    if (Capacitor.isNativePlatform()) {
      CapApp.addListener('appStateChange', ({ isActive }) => {
        if (isActive) markNeedsReauthIfExpired();
      })
        .then((h) => {
          capAppHandle = h;
        })
        .catch(() => {});
    }

    return () => {
      if (expiryTimer) clearTimeout(expiryTimer);
      document.removeEventListener('visibilitychange', handleVisibility);
      if (capAppHandle) capAppHandle.remove().catch(() => {});
    };
  }, [user, accessToken, tokenExpiresAt]);

  // 9. Restauração de backup e sincronização automática com Google Drive
  const applySanitizedPayload = useCallback(
    (
      sanitized: Partial<AppDataPayload>,
      fileId?: string | null,
      remoteModifiedAt?: string | null
    ) => {
      if (syncTimeoutRef.current) {
        clearTimeout(syncTimeoutRef.current);
        syncTimeoutRef.current = null;
      }
      cloudOverwriteGuardRef.current = false;

      if (sanitized.tasks) setTasks(sanitized.tasks);
      if (sanitized.transactions) setTransactions(sanitized.transactions);
      if (sanitized.financialGoals) setFinancialGoals(sanitized.financialGoals);
      if (sanitized.budgetLimits) setBudgetLimits(sanitized.budgetLimits);
      if (sanitized.draftNotes) setDraftNotes(sanitized.draftNotes);
      if (sanitized.specialDates) setSpecialDates(sanitized.specialDates);
      if (sanitized.dashboardWidgets) setDashboardWidgets(sanitized.dashboardWidgets);
      if (sanitized.pendingBankNotifications) {
        bankQueue.setPendingBankNotifications(sanitized.pendingBankNotifications);
      }
      if (typeof sanitized.userName === 'string' && sanitized.userName.trim()) {
        setUserNameState(sanitized.userName.trim());
      }

      const remoteHasData = hasMeaningfulLocalData({
        tasks: sanitized.tasks || [],
        transactions: sanitized.transactions || [],
        financialGoals: sanitized.financialGoals || [],
        draftNotes: sanitized.draftNotes || [],
        specialDates: sanitized.specialDates || [],
        pendingBankNotifications: sanitized.pendingBankNotifications || [],
      });

      if (
        sanitized.onboardingCompleted ||
        (typeof sanitized.userName === 'string' && sanitized.userName.trim()) ||
        remoteHasData
      ) {
        setOnboardingCompleted(true);
      }

      if (fileId) {
        setDriveSyncInfo({
          fileId,
          lastSyncedAt: new Date().toISOString(),
          remoteModifiedAt: remoteModifiedAt || sanitized.lastUpdated || new Date().toISOString(),
          status: 'synced',
        });
      }
    },
    [bankQueue]
  );

  const inspectDriveBackupAfterAuth = useCallback(
    async (token: string) => {
      if (!token || inspectedTokensRef.current.has(token)) return;
      inspectedTokensRef.current.add(token);
      setIsCheckingDriveOnLogin(true);

      try {
        const driveFile = await findDriveBackupFile(token);
        if (!driveFile) {
          setDriveSyncInfo((prev) => ({
            ...prev,
            status: prev.status === 'error' ? 'idle' : prev.status,
          }));
          return;
        }

        const rawRemote = await readDriveFile(token, driveFile.id);
        if (!rawRemote) {
          setDriveSyncInfo((prev) => ({
            ...prev,
            fileId: driveFile.id,
            remoteModifiedAt: driveFile.modifiedTime,
            status: 'synced',
          }));
          return;
        }

        const sanitized = sanitizeLegacyPayload(rawRemote);
        const remoteSummary = summarizePayloadCounts(sanitized);

        if (remoteSummary.totalItems === 0) {
          setDriveSyncInfo((prev) => ({
            ...prev,
            fileId: driveFile.id,
            remoteModifiedAt: driveFile.modifiedTime,
            status: 'synced',
          }));
          return;
        }

        const localHasData = hasMeaningfulLocalData(latestDataRef.current);
        if (!localHasData) {
          applySanitizedPayload(sanitized, driveFile.id, driveFile.modifiedTime);
          setPendingDriveRestore(null);
          setAutoRestoredNotice({ summary: remoteSummary, driveFile });
          hapticSuccess();
          confetti({ particleCount: 35, spread: 60, origin: { y: 0.75 } });
        } else {
          setDriveSyncInfo((prev) => ({
            ...prev,
            fileId: driveFile.id,
            remoteModifiedAt: driveFile.modifiedTime,
            status: 'cloud_newer',
          }));
          setPendingDriveRestore({
            driveFile,
            remoteData: sanitized as AppDataPayload,
            remoteSummary,
          });
        }
      } catch (err) {
        if (!handleWorkspaceAuthError(err)) {
          console.warn('Erro ao inspecionar backup do Google Drive no login:', err);
        }
      } finally {
        setIsCheckingDriveOnLogin(false);
      }
    },
    [applySanitizedPayload, handleWorkspaceAuthError]
  );
  inspectDriveBackupRef.current = inspectDriveBackupAfterAuth;

  useEffect(() => {
    if (accessToken) {
      void inspectDriveBackupAfterAuth(accessToken);
    }
  }, [accessToken, inspectDriveBackupAfterAuth]);

  const checkDriveStatus = useCallback(async () => {
    if (cloudOverwriteGuardRef.current) return;
    const token = accessToken || (await getAccessToken());
    if (!token) return;

    try {
      const file = await findDriveBackupFile(token);
      if (file) {
        setDriveSyncInfo((prev) => {
          const remoteTime = new Date(file.modifiedTime).getTime();
          const localTime = prev.lastSyncedAt ? new Date(prev.lastSyncedAt).getTime() : 0;
          const isCloudNewer = remoteTime > localTime + 2000;

          return {
            ...prev,
            fileId: file.id,
            remoteModifiedAt: file.modifiedTime,
            status: isCloudNewer
              ? 'cloud_newer'
              : prev.status === 'cloud_newer'
              ? 'cloud_newer'
              : 'synced',
          };
        });
      }
    } catch (err) {
      if (!handleWorkspaceAuthError(err)) {
        console.warn('Erro ao verificar status do Google Drive:', err);
      }
    }
  }, [accessToken, handleWorkspaceAuthError]);

  useEffect(() => {
    if (!accessToken || workspaceAuthStatus !== 'connected') return;
    const interval = setInterval(() => {
      void checkDriveStatus();
    }, 45000);
    return () => clearInterval(interval);
  }, [accessToken, workspaceAuthStatus, checkDriveStatus]);

  const triggerAutoSync = useCallback(() => {
    if (!accessToken || cloudOverwriteGuardRef.current) return;

    if (syncTimeoutRef.current) {
      clearTimeout(syncTimeoutRef.current);
    }

    syncTimeoutRef.current = setTimeout(async () => {
      if (cloudOverwriteGuardRef.current) return;
      try {
        setDriveSyncInfo((prev) => ({ ...prev, status: 'syncing' }));
        const payload = buildCurrentPayload();
        const result: DriveFileInfo = await saveToDrive(accessToken, payload, driveSyncInfo.fileId);
        setDriveSyncInfo({
          fileId: result.id,
          lastSyncedAt: new Date().toISOString(),
          remoteModifiedAt: result.modifiedTime,
          status: 'synced',
        });
      } catch (err: any) {
        if (!handleWorkspaceAuthError(err)) {
          console.warn('Falha na sincronização em segundo plano:', err);
          setDriveSyncInfo((prev) => ({
            ...prev,
            status: 'error',
            errorMessage: err.message || 'Falha ao sincronizar',
          }));
        }
      }
    }, 4000);
  }, [accessToken, buildCurrentPayload, driveSyncInfo.fileId, handleWorkspaceAuthError]);
  triggerAutoSyncRef.current = triggerAutoSync;

  // Recuperação automática do cofre nativo do Android se o WebView iniciar vazio
  useEffect(() => {
    if (vaultBootRecoveredRef.current || !isAndroidNativeHealthSupported()) return;
    vaultBootRecoveredRef.current = true;

    const webHasData = hasMeaningfulLocalData({
      tasks,
      transactions,
      financialGoals,
      draftNotes,
      specialDates,
      pendingBankNotifications: bankQueue.pendingBankNotifications,
    });
    if (webHasData) return;

    loadNativeVaultBackup()
      .then((res) => {
        if (!res.found || !res.payloadJson) return;
        try {
          const parsed = JSON.parse(res.payloadJson);
          const sanitized = sanitizeLegacyPayload(parsed);
          const vaultHasData = hasMeaningfulLocalData({
            tasks: sanitized.tasks || [],
            transactions: sanitized.transactions || [],
            financialGoals: sanitized.financialGoals || [],
            draftNotes: sanitized.draftNotes || [],
            specialDates: sanitized.specialDates || [],
            pendingBankNotifications: sanitized.pendingBankNotifications || [],
          });
          if (vaultHasData || sanitized.onboardingCompleted) {
            applySanitizedPayload(sanitized);
            setVaultStatus((prev) => ({
              ...prev,
              recoveredFromNative: true,
            }));
          }
        } catch (err) {
          recordAppError('nativeVault.recover', err);
        }
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 10. Ações de perfil, login, Drive e backup JSON
  const setUserName = useCallback(
    (name: string) => {
      setUserNameState(name.trim());
      onDataChanged();
    },
    [onDataChanged]
  );

  const completeOnboarding = useCallback(
    (name: string) => {
      const cleaned = name.trim();
      if (cleaned) setUserNameState(cleaned);
      setOnboardingCompleted(true);
      hapticSuccess();
      onDataChanged();
    },
    [onDataChanged]
  );

  const signInWithGoogle = useCallback(async (): Promise<string | null> => {
    setIsAuthenticating(true);
    setAuthError(null);
    try {
      const result = await googleSignIn({
        allowRedirectFallback: !Capacitor.isNativePlatform(),
        loginHint: userRef.current?.email || undefined,
      });

      if (!result) {
        setAuthError('Não foi possível concluir o login com o Google. Tente novamente.');
        return null;
      }

      if (result.cancelled) {
        const cancelMsg = result.sha1
          ? `Login não concluído após selecionar a conta. Se você não cancelou manualmente, cadastre a impressão SHA-1 deste APK (${result.sha1}) no cliente Android (com.vidaorganizada.app) no Google Cloud Console.`
          : 'Login com Google cancelado antes de concluir. Se a janela fechou sozinha, permita pop-ups ou tente novamente.';
        setAuthError(cancelMsg);
        return null;
      }

      if (result.isNativeRedirect || result.isWebRedirect) {
        return null;
      }

      if (result.user && result.accessToken) {
        sessionExpiredNotifiedRef.current = false;
        cloudOverwriteGuardRef.current = false;
        setAuthError(null);
        setUser(result.user);
        setAccessToken(result.accessToken);
        setTokenExpiresAt(result.expiresAt || Date.now() + 3500 * 1000);
        setWorkspaceAuthStatus('connected');
        await inspectDriveBackupAfterAuth(result.accessToken);

        try {
          const events = await listCalendarEvents(result.accessToken);
          calendarActions.setGoogleCalendarEvents(events);
        } catch (e) {
          console.warn('Aviso ao consultar agenda pós login:', e);
        }
        return result.accessToken;
      }
      setAuthError('O Google não retornou a autorização necessária. Tente novamente.');
      return null;
    } catch (err) {
      console.warn('Aviso de login:', err);
      const userMessage = mapGoogleAuthError(err);
      setAuthError(userMessage);
      recordAppError('auth.googleSignIn', err);
      notificationsEngine.pushAppNotification({
        id: 'notif-auth-' + Date.now(),
        title: 'Aviso de Login',
        body: userMessage,
        type: 'reminder',
      });
      return null;
    } finally {
      setIsAuthenticating(false);
    }
  }, [calendarActions, inspectDriveBackupAfterAuth, notificationsEngine]);
  signInRef.current = signInWithGoogle;

  const refreshWorkspaceSession = useCallback(
    async (options?: { interactiveIfNeeded?: boolean }): Promise<string | null> => {
      const existing = accessToken || (await getAccessToken());
      if (existing) return existing;

      if (options?.interactiveIfNeeded) {
        return await signInWithGoogle();
      }
      return null;
    },
    [accessToken, signInWithGoogle]
  );

  const signOut = useCallback(async () => {
    inspectedTokensRef.current.clear();
    cloudOverwriteGuardRef.current = false;
    setAuthError(null);
    setPendingDriveRestore(null);
    setAutoRestoredNotice(null);
    await fbLogout();
    setUser(null);
    setAccessToken(null);
    setTokenExpiresAt(0);
    setWorkspaceAuthStatus('disconnected');
    calendarActions.setGoogleCalendarEvents([]);
    setDriveSyncInfo((prev) => ({ ...prev, status: 'idle' }));
  }, [calendarActions]);

  const acceptPendingDriveRestore = useCallback(() => {
    if (!pendingDriveRestore) return;
    const { driveFile, remoteData } = pendingDriveRestore;
    const sanitized = sanitizeLegacyPayload(remoteData);
    applySanitizedPayload(sanitized, driveFile.id, driveFile.modifiedTime);
    setPendingDriveRestore(null);
    hapticSuccess();
    confetti({ particleCount: 50, spread: 70, origin: { y: 0.7 } });
  }, [applySanitizedPayload, pendingDriveRestore]);

  const dismissPendingDriveRestore = useCallback(() => {
    setPendingDriveRestore(null);
  }, []);

  const dismissAutoRestoredNotice = useCallback(() => {
    setAutoRestoredNotice(null);
  }, []);

  const openStartFromScratchModal = useCallback(() => {
    setIsStartFromScratchOpen(true);
  }, []);

  const closeStartFromScratchModal = useCallback(() => {
    setIsStartFromScratchOpen(false);
  }, []);

  const resetWorkspaceToZero = useCallback(
    async (options?: { alsoResetCloud?: boolean }) => {
      const alsoResetCloud = Boolean(options?.alsoResetCloud);

      if (syncTimeoutRef.current) {
        clearTimeout(syncTimeoutRef.current);
        syncTimeoutRef.current = null;
      }

      let cloudResetResult: DriveFileInfo | null = null;
      if (alsoResetCloud) {
        let token = accessToken || (await getAccessToken());
        if (!token) token = await signInWithGoogle();
        if (!token) {
          throw new Error('Conecte ou renove sua conta Google para reiniciar o backup na nuvem.');
        }

        const cleanPayload: AppDataPayload = {
          version: CURRENT_DATA_VERSION,
          lastUpdated: new Date().toISOString(),
          userName: '',
          onboardingCompleted: false,
          tasks: [],
          transactions: [],
          financialGoals: [],
          budgetLimits: [],
          draftNotes: [],
          specialDates: [],
          dashboardWidgets: DEFAULT_WIDGETS,
          pendingBankNotifications: [],
        };

        try {
          cloudResetResult = await saveToDrive(token, cleanPayload, driveSyncInfo.fileId);
        } catch (err) {
          if (handleWorkspaceAuthError(err)) {
            throw new Error(
              'Permissão temporária do Google em renovação. Tente novamente em instantes.'
            );
          }
          throw err;
        }
      }

      cloudOverwriteGuardRef.current = !alsoResetCloud && Boolean(accessToken);

      setTasks([]);
      setTransactions([]);
      setFinancialGoals([]);
      setBudgetLimits([]);
      setDraftNotes([]);
      setSpecialDates([]);
      setDashboardWidgets(DEFAULT_WIDGETS);
      bankQueue.setPendingBankNotifications([]);
      notificationsEngine.resetNotificationMemory();
      setUserNameState('');
      setOnboardingCompleted(false);
      setPendingDriveRestore(null);
      setAutoRestoredNotice(null);
      clearUndoToast();

      try {
        localStorage.removeItem(STORAGE_KEY_DATA);
        localStorage.removeItem(STORAGE_KEY_PENDING_BANK);
        localStorage.removeItem(STORAGE_KEY_BANK_SIGS);
        localStorage.removeItem(STORAGE_KEY_NOTIFS);
        localStorage.removeItem(STORAGE_KEY_SYNC);
      } catch {
        // ignora
      }
      void clearNativeVaultBackup();

      if (cloudResetResult) {
        setDriveSyncInfo({
          fileId: cloudResetResult.id,
          lastSyncedAt: new Date().toISOString(),
          remoteModifiedAt: cloudResetResult.modifiedTime,
          status: 'synced',
        });
      } else {
        setDriveSyncInfo((prev) => ({
          fileId: accessToken ? prev.fileId : null,
          lastSyncedAt: null,
          remoteModifiedAt: accessToken ? prev.remoteModifiedAt : null,
          status: accessToken && prev.fileId ? 'cloud_newer' : 'idle',
        }));
      }

      hapticWarning();
    },
    [
      accessToken,
      bankQueue,
      clearUndoToast,
      driveSyncInfo.fileId,
      handleWorkspaceAuthError,
      notificationsEngine,
      signInWithGoogle,
    ]
  );

  const syncToDriveNow = useCallback(async () => {
    let token = accessToken || (await getAccessToken());
    if (!token) {
      token = await signInWithGoogle();
      if (!token) return;
    }

    cloudOverwriteGuardRef.current = false;
    setDriveSyncInfo((prev) => ({ ...prev, status: 'syncing', errorMessage: undefined }));
    try {
      const payload = buildCurrentPayload();
      const result = await saveToDrive(token, payload, driveSyncInfo.fileId);
      setDriveSyncInfo({
        fileId: result.id,
        lastSyncedAt: new Date().toISOString(),
        remoteModifiedAt: result.modifiedTime,
        status: 'synced',
      });
      confetti({ particleCount: 30, spread: 60, origin: { y: 0.8 } });
    } catch (err: any) {
      if (handleWorkspaceAuthError(err)) {
        throw new Error('Permissão temporária do Google expirada. Toque em Renovar para continuar.');
      }
      console.warn('Falha ao salvar no Drive:', err);
      setDriveSyncInfo((prev) => ({
        ...prev,
        status: 'error',
        errorMessage: err.message || 'Falha ao sincronizar',
      }));
      throw err;
    }
  }, [accessToken, buildCurrentPayload, driveSyncInfo.fileId, handleWorkspaceAuthError, signInWithGoogle]);

  const restoreFromDriveNow = useCallback(async () => {
    let token = accessToken || (await getAccessToken());
    if (!token) {
      token = await signInWithGoogle();
      if (!token) return;
    }

    setDriveSyncInfo((prev) => ({ ...prev, status: 'syncing' }));
    try {
      let fileId = driveSyncInfo.fileId;
      let remoteModifiedAt = driveSyncInfo.remoteModifiedAt;
      if (!fileId) {
        const file = await findDriveBackupFile(token);
        if (!file) {
          throw new Error('Nenhum backup do Lifeedy foi encontrado no seu Google Drive.');
        }
        fileId = file.id;
        remoteModifiedAt = file.modifiedTime;
      }

      const remoteData = await readDriveFile(token, fileId);
      if (remoteData) {
        const sanitized = sanitizeLegacyPayload(remoteData);
        applySanitizedPayload(sanitized, fileId, remoteModifiedAt);
        setPendingDriveRestore(null);
        setAutoRestoredNotice(null);
        confetti({ particleCount: 50, spread: 70, origin: { y: 0.7 } });
      }
    } catch (err: any) {
      if (handleWorkspaceAuthError(err)) {
        throw new Error('Permissão temporária do Google expirada. Toque em Renovar para continuar.');
      }
      console.warn('Falha ao restaurar do Drive:', err);
      setDriveSyncInfo((prev) => ({
        ...prev,
        status: 'error',
        errorMessage: err.message || 'Falha ao carregar do Google Drive',
      }));
      throw err;
    }
  }, [
    accessToken,
    applySanitizedPayload,
    driveSyncInfo.fileId,
    driveSyncInfo.remoteModifiedAt,
    handleWorkspaceAuthError,
    signInWithGoogle,
  ]);

  const toggleDashboardWidget = useCallback(
    (widgetId: string) => {
      setDashboardWidgets((prev) =>
        prev.includes(widgetId) ? prev.filter((w) => w !== widgetId) : [...prev, widgetId]
      );
      onDataChanged();
    },
    [onDataChanged]
  );

  const exportBackupJson = useCallback(() => {
    const payload = buildCurrentPayload();
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Lifeedy_Backup_${new Date().toISOString().split('T')[0]}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, [buildCurrentPayload]);

  const importBackupJson = useCallback(
    (content: string): boolean => {
      try {
        const validation = validateAndParseBackupJson(content);
        if (!validation.ok || !validation.data) {
          recordAppError('backup.import', validation.error || 'Backup JSON inválido');
          return false;
        }
        const sanitized = validation.data.payload;
        if (sanitized.tasks) setTasks(sanitized.tasks);
        if (sanitized.transactions) setTransactions(sanitized.transactions);
        if (sanitized.financialGoals) setFinancialGoals(sanitized.financialGoals);
        if (sanitized.budgetLimits) setBudgetLimits(sanitized.budgetLimits);
        if (sanitized.draftNotes) setDraftNotes(sanitized.draftNotes);
        if (sanitized.specialDates) setSpecialDates(sanitized.specialDates);
        if (sanitized.dashboardWidgets) setDashboardWidgets(sanitized.dashboardWidgets);
        if (sanitized.pendingBankNotifications) {
          bankQueue.setPendingBankNotifications(sanitized.pendingBankNotifications);
        }
        if (sanitized.userName) setUserNameState(sanitized.userName);
        if (sanitized.onboardingCompleted || sanitized.userName) {
          setOnboardingCompleted(true);
        }
        onDataChanged();
        return true;
      } catch (e) {
        recordAppError('backup.import', e);
        console.error('Erro ao importar JSON:', e);
        return false;
      }
    },
    [bankQueue, onDataChanged]
  );

  return (
    <AppContext.Provider
      value={{
        theme,
        toggleTheme,
        setThemeMode,
        userName,
        setUserName,
        onboardingCompleted,
        completeOnboarding,
        user,
        accessToken,
        workspaceAuthStatus,
        isAuthenticating,
        authError,
        clearAuthError,
        signInWithGoogle,
        refreshWorkspaceSession,
        signOut,
        tasks,
        transactions,
        financialGoals,
        budgetLimits,
        draftNotes,
        specialDates,
        dashboardWidgets,
        calendarEvents: calendarActions.calendarEvents,
        isLoadingCalendar: calendarActions.isLoadingCalendar,
        ...tasksActions,
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
        ...draftsActions,
        toggleDashboardWidget,
        notificationPermission: notificationsEngine.notificationPermission,
        notificationsList: notificationsEngine.notificationsList,
        enableNotifications: notificationsEngine.enableNotifications,
        triggerTestNotification: notificationsEngine.triggerTestNotification,
        dismissNotification: notificationsEngine.dismissNotification,
        clearAllNotifications: notificationsEngine.clearAllNotifications,
        refreshCalendar: calendarActions.refreshCalendar,
        addSpecialDate: calendarActions.addSpecialDate,
        deleteSpecialDate: calendarActions.deleteSpecialDate,
        createTaskFromCalendarEvent: calendarActions.createTaskFromCalendarEvent,
        addEventToGoogleCalendar: calendarActions.addEventToGoogleCalendar,
        updateGoogleCalendarEvent: calendarActions.updateGoogleCalendarEvent,
        removeGoogleCalendarEvent: calendarActions.removeGoogleCalendarEvent,
        scheduleTaskInCalendar: calendarActions.scheduleTaskInCalendar,
        driveSyncInfo,
        isCheckingDriveOnLogin,
        pendingDriveRestore,
        autoRestoredNotice,
        isStartFromScratchOpen,
        acceptPendingDriveRestore,
        dismissPendingDriveRestore,
        dismissAutoRestoredNotice,
        openStartFromScratchModal,
        closeStartFromScratchModal,
        resetWorkspaceToZero,
        syncToDriveNow,
        restoreFromDriveNow,
        exportBackupJson,
        importBackupJson,
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
        pendingNotificationTarget: notificationsEngine.pendingNotificationTarget,
        consumeNotificationTarget: notificationsEngine.consumeNotificationTarget,
      }}
    >
      {children}
      <GlobalConfirmModal config={confirmConfig} onClose={closeConfirmDialog} />
    </AppContext.Provider>
  );
};

export const useApp = () => {
  const context = useContext(AppContext);
  if (!context) {
    throw new Error('useApp must be used within an AppProvider');
  }
  return context;
};
