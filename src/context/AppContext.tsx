import React, { createContext, useContext, useEffect, useMemo, useState, useRef, useCallback } from 'react';
import { Capacitor } from '@capacitor/core';
import { App as CapApp } from '@capacitor/app';
import { Browser } from '@capacitor/browser';
import { User } from 'firebase/auth';
import { useBackHandler } from './BackNavigationContext';
import {
  CURRENT_DATA_VERSION,
  DEFAULT_WIDGETS,
  sanitizeLegacyPayload,
} from '../utils/storageSanitizer';
import {
  BackupCountsSummary,
  hasMeaningfulLocalData,
  summarizePayloadCounts,
} from '../utils/backupSummary';
import {
  TaskItem,
  Transaction,
  FinancialGoal,
  BudgetLimit,
  DraftNote,
  AppNotification,
  DriveSyncInfo,
  AppDataPayload,
  GoogleCalendarEvent,
  LocalSpecialDate,
  PendingBankNotification,
} from '../types';
import { parseBankNotificationText } from '../services/bankNotificationParser';
import {
  acknowledgeNativeBankNotifications,
  checkBankNotificationPermission,
  fetchNativePendingBankNotifications,
  isAndroidNotificationCaptureSupported,
  NativePendingBankEvent,
  openBankNotificationSettings,
  subscribeNativeBankNotifications,
} from '../services/bankNotificationBridge';
import {
  initAuth,
  googleSignIn,
  consumeRedirectSignInResult,
  completeNativeGoogleAuth,
  loadPersistedUserProfile,
  persistedProfileToUser,
  isAccessTokenExpiredOrNearExpiry,
  mapGoogleAuthError,
  logout as fbLogout,
  getAccessToken,
  setSessionToken,
} from '../services/firebase';
import { isWorkspaceAuthError } from '../services/googleAuthError';
import {
  findDriveBackupFile,
  readDriveFile,
  saveToDrive,
  DriveFileInfo,
} from '../services/driveService';
import {
  listCalendarEvents,
  createCalendarEvent,
  updateCalendarEvent as apiUpdateCalendarEvent,
  deleteCalendarEvent as apiDeleteCalendarEvent,
} from '../services/calendarService';
import {
  expandSpecialDatesToEvents,
  getBrazilianHolidaysInRange,
  mergeAndDeduplicateCalendarEvents,
} from '../services/brazilianHolidaysService';
import {
  checkNativeNotificationPermission,
  isNotificationSupported,
  getNotificationPermission,
  requestNotificationPermission,
  sendWebNotification,
} from '../services/notificationService';
import {
  hapticSuccess,
  hapticWarning,
  hapticImpactLight,
  hapticSelection,
} from '../services/hapticsService';
import {
  addUpdateProgressListener,
  canRequestPackageInstalls,
  clearPendingApk,
  downloadAndInstallApk,
  getInstalledAppInfo,
  installPendingApk,
  isNativeSelfUpdateSupported,
  openInstallUnknownAppsSettings,
} from '../services/appUpdaterBridge';
import {
  checkForGitHubUpdates,
  clearDismissedUpdateVersion,
  CURRENT_APP_VERSION,
  CURRENT_BUILD_NUMBER,
  dismissUpdateVersion,
  downloadActionsArtifactWithToken,
  getDismissedUpdateVersion,
  getLastSeenNativeBuild,
  getStoredGitHubConfig,
  parseSemVer,
  resolveInstallableUpdateTarget,
  setLastSeenNativeBuild,
  shouldRunAutoUpdateCheck,
  UpdateCheckResult,
} from '../services/githubUpdateService';
import confetti from 'canvas-confetti';

const STORAGE_KEY_DATA = 'vidaorganizada_local_data_v2';
const STORAGE_KEY_SYNC = 'vidaorganizada_sync_info_v2';
const STORAGE_KEY_NOTIFS = 'vidaorganizada_notifications_v2';
const STORAGE_KEY_THEME = 'vidaorganizada_theme_v1';
const STORAGE_KEY_HIDE_VALUES = 'vidaorganizada_hide_values_v1';
const STORAGE_KEY_FINANCE_LOCK = 'vidaorganizada_finance_lock_v1';
const STORAGE_KEY_PENDING_BANK = 'vidaorganizada_pending_bank_v1';
const STORAGE_KEY_BANK_SIGS = 'vidaorganizada_ingested_bank_sigs_v1';
const BANK_DEDUPE_WINDOW_MS = 10 * 60 * 1000;

const BRL_FORMATTER = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
});

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

interface UndoToastInfo {
  id: string;
  message: string;
  onUndo: () => void;
}

export interface AppUpdateDownloadState {
  status:
    | 'idle'
    | 'downloading'
    | 'extracting'
    | 'verifying'
    | 'permission_required'
    | 'installer_launched'
    | 'error';
  progress: number;
  downloadedBytes: number;
  totalBytes: number;
  error?: string;
  pendingVersionName?: string;
  pendingVersionCode?: number;
}

interface AppContextType {
  // Theme state
  theme: 'light' | 'dark';
  toggleTheme: () => void;
  setThemeMode: (mode: 'light' | 'dark') => void;

  // Profile & Onboarding state
  userName: string;
  setUserName: (name: string) => void;
  onboardingCompleted: boolean;
  completeOnboarding: (name: string) => void;

  // Auth state
  user: User | null;
  accessToken: string | null;
  workspaceAuthStatus: 'disconnected' | 'connected' | 'refreshing' | 'needs_reauth';
  isAuthenticating: boolean;
  signInWithGoogle: () => Promise<string | null>;
  refreshWorkspaceSession: (options?: { interactiveIfNeeded?: boolean }) => Promise<string | null>;
  signOut: () => Promise<void>;

  // Data
  tasks: TaskItem[];
  transactions: Transaction[];
  financialGoals: FinancialGoal[];
  budgetLimits: BudgetLimit[];
  draftNotes: DraftNote[];
  specialDates: LocalSpecialDate[];
  dashboardWidgets: string[];
  calendarEvents: GoogleCalendarEvent[];
  isLoadingCalendar: boolean;

  // Task actions
  addTask: (task: Omit<TaskItem, 'id'>) => void;
  updateTask: (id: string, updates: Partial<TaskItem>) => void;
  toggleTaskCompletion: (id: string) => void;
  snoozeTaskToTomorrow: (id: string) => void;
  deleteTask: (id: string) => void;
  toggleSubtask: (taskId: string, subtaskId: string) => void;

  // Privacy Mode & Biometric Lock state
  hideValues: boolean;
  toggleHideValues: () => void;
  formatMoney: (amount: number) => string;
  financeLockEnabled: boolean;
  setFinanceLockEnabled: (enabled: boolean) => void;

  // Finance actions
  addTransaction: (tx: Omit<Transaction, 'id'>) => void;
  updateTransaction: (id: string, updates: Partial<Omit<Transaction, 'id'>>) => void;
  deleteTransaction: (id: string) => void;
  addGoal: (goal: Omit<FinancialGoal, 'id'>) => void;
  updateGoal: (id: string, updates: Partial<FinancialGoal>) => void;
  deleteGoal: (id: string) => void;
  updateBudgetLimit: (category: Transaction['category'], limit: number) => void;

  // Bank Notification Review Queue
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

  // Draft / Rascunhos actions
  addDraftNote: (note: Omit<DraftNote, 'id' | 'updatedAt'>) => void;
  updateDraftNote: (id: string, updates: Partial<DraftNote>) => void;
  deleteDraftNote: (id: string) => void;
  togglePinDraft: (id: string) => void;
  toggleDraftChecklistItem: (draftId: string, itemId: string) => void;
  addDraftChecklistItem: (draftId: string, text: string) => void;
  convertDraftToTask: (draft: DraftNote) => void;

  // Modular Dashboard
  toggleDashboardWidget: (widgetId: string) => void;

  // Notifications API (Silencioso)
  notificationPermission: NotificationPermission;
  notificationsList: AppNotification[];
  enableNotifications: () => Promise<boolean>;
  triggerTestNotification: () => void;
  dismissNotification: (id: string) => void;
  clearAllNotifications: () => void;

  // Calendar & Special Dates actions
  refreshCalendar: () => Promise<void>;
  addSpecialDate: (item: Omit<LocalSpecialDate, 'id' | 'createdAt'>) => void;
  deleteSpecialDate: (id: string) => void;
  createTaskFromCalendarEvent: (event: GoogleCalendarEvent) => void;
  addEventToGoogleCalendar: (event: {
    summary: string;
    description?: string;
    location?: string;
    startDateTime: string;
    endDateTime: string;
    allDay?: boolean;
    date?: string;
    calendarId?: string;
  }) => Promise<GoogleCalendarEvent | null>;
  updateGoogleCalendarEvent: (
    eventId: string,
    event: {
      summary: string;
      description?: string;
      location?: string;
      startDateTime: string;
      endDateTime: string;
      allDay?: boolean;
      date?: string;
      calendarId?: string;
    }
  ) => void;
  removeGoogleCalendarEvent: (eventId: string) => Promise<void>;
  scheduleTaskInCalendar: (task: TaskItem, startHour?: string) => Promise<boolean>;

  // Cloud Drive Sync & Login Restore Decisions
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

  // Undo Toast state & handler
  undoToast: UndoToastInfo | null;
  clearUndoToast: () => void;

  // Modals / global confirmation helper
  confirmDestructiveAction: (config: {
    title: string;
    message: string;
    details?: string[];
    confirmText?: string;
    isDestructive?: boolean;
    onConfirm: () => Promise<void> | void;
  }) => void;

  // In-app Updater
  installedAppVersion: string;
  installedBuildNumber: number;
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
}

const AppContext = createContext<AppContextType | null>(null);

export const AppProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  // Theme state
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY_THEME);
      if (saved === 'dark' || saved === 'light') return saved;
      if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
        return 'dark';
      }
    } catch (e) {
      // ignore
    }
    return 'dark'; // default to modern dark theme
  });

  useEffect(() => {
    const isDark = theme === 'dark';
    if (isDark) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
    document.documentElement.style.colorScheme = theme;

    const metaThemeColor = document.querySelector('meta[name="theme-color"]');
    if (metaThemeColor) {
      metaThemeColor.setAttribute('content', isDark ? '#1C1715' : '#FAF6F1');
    }

    try {
      localStorage.setItem(STORAGE_KEY_THEME, theme);
    } catch (e) {
      // ignore
    }
  }, [theme]);

  const toggleTheme = () => {
    setTheme((prev) => (prev === 'dark' ? 'light' : 'dark'));
  };

  const setThemeMode = (mode: 'light' | 'dark') => {
    setTheme(mode);
  };

  // Initial sanitized payload (zero fictitious examples)
  const initialPayloadRef = useRef<Partial<AppDataPayload> | null>(null);
  if (initialPayloadRef.current === null) {
    initialPayloadRef.current = loadInitialLocalPayload();
  }
  const initialPayload = initialPayloadRef.current;

  // Profile & Onboarding
  const [userName, setUserNameState] = useState<string>(() => initialPayload.userName || '');
  const [onboardingCompleted, setOnboardingCompleted] = useState<boolean>(
    () => Boolean(initialPayload.onboardingCompleted)
  );

  // Auth (user identity is persisted independently of the 1-hour Workspace access token)
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
  const userRef = useRef<User | null>(user);
  userRef.current = user;

  // App core state (always starts empty if no user data)
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

  // Global Privacy Mode (persisted in localStorage)
  const [hideValues, setHideValues] = useState<boolean>(() => {
    try {
      return localStorage.getItem(STORAGE_KEY_HIDE_VALUES) === 'true';
    } catch {
      return false;
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY_HIDE_VALUES, String(hideValues));
    } catch {
      // ignore
    }
  }, [hideValues]);

  const toggleHideValues = useCallback(() => {
    hapticImpactLight();
    setHideValues((prev) => !prev);
  }, []);

  const formatMoney = useCallback(
    (amount: number) => {
      if (hideValues) return 'R$ •••••';
      return BRL_FORMATTER.format(amount);
    },
    [hideValues]
  );

  // Optional Android Biometric Lock for Finance tab (persisted locally)
  const [financeLockEnabled, setFinanceLockEnabledState] = useState<boolean>(() => {
    try {
      return localStorage.getItem(STORAGE_KEY_FINANCE_LOCK) === 'true';
    } catch {
      return false;
    }
  });

  const setFinanceLockEnabled = useCallback((enabled: boolean) => {
    setFinanceLockEnabledState(enabled);
    try {
      localStorage.setItem(STORAGE_KEY_FINANCE_LOCK, String(enabled));
    } catch {
      // ignore
    }
  }, []);

  // Bank notification review queue & Android listener state
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
        // ignore
      }
      return Array.isArray(initialPayload.pendingBankNotifications)
        ? initialPayload.pendingBankNotifications
        : [];
    }
  );

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY_PENDING_BANK, JSON.stringify(pendingBankNotifications));
    } catch {
      // ignore
    }
  }, [pendingBankNotifications]);

  // Google Calendar events + merged unified events (including offline BR holidays & user birthdays)
  const [googleCalendarEvents, setGoogleCalendarEvents] = useState<GoogleCalendarEvent[]>([]);
  const [isLoadingCalendar, setIsLoadingCalendar] = useState(false);

  const calendarEvents = useMemo(() => {
    const minDate = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);
    const maxDate = new Date(Date.now() + 180 * 24 * 60 * 60 * 1000);
    const brazilHolidays = getBrazilianHolidaysInRange(minDate, maxDate);
    const expandedSpecials = expandSpecialDatesToEvents(specialDates, minDate, maxDate);
    return mergeAndDeduplicateCalendarEvents(googleCalendarEvents, [
      ...expandedSpecials,
      ...brazilHolidays,
    ]);
  }, [googleCalendarEvents, specialDates]);

  // Undo Toast state
  const [undoToast, setUndoToast] = useState<UndoToastInfo | null>(null);
  const undoTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const clearUndoToast = () => {
    if (undoTimeoutRef.current) clearTimeout(undoTimeoutRef.current);
    setUndoToast(null);
  };

  const showUndoToast = (message: string, onUndo: () => void) => {
    if (undoTimeoutRef.current) clearTimeout(undoTimeoutRef.current);
    setUndoToast({ id: 'toast-' + Date.now(), message, onUndo });
    undoTimeoutRef.current = setTimeout(() => {
      setUndoToast(null);
    }, 6000);
  };

  // Drive sync state
  const [driveSyncInfo, setDriveSyncInfo] = useState<DriveSyncInfo>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY_SYNC);
      if (saved) return JSON.parse(saved);
    } catch (e) {
      // ignore
    }
    return {
      fileId: null,
      lastSyncedAt: null,
      remoteModifiedAt: null,
      status: 'idle',
    };
  });

  // Web & Native Android Notifications state
  const [notificationPermission, setNotificationPermission] = useState<NotificationPermission>(() => {
    return getNotificationPermission();
  });

  useEffect(() => {
    if (Capacitor.isNativePlatform()) {
      checkNativeNotificationPermission()
        .then((perm) => setNotificationPermission(perm))
        .catch(() => {});
    }
  }, []);

  // In-app Updater state & lifecycle
  const [installedAppVersion, setInstalledAppVersion] = useState<string>(CURRENT_APP_VERSION);
  const [installedBuildNumber, setInstalledBuildNumber] = useState<number>(CURRENT_BUILD_NUMBER);
  const installedVersionRef = useRef<{ version: string; build: number }>({
    version: CURRENT_APP_VERSION,
    build: CURRENT_BUILD_NUMBER,
  });
  const [appUpdateResult, setAppUpdateResult] = useState<UpdateCheckResult | null>(
    () => getStoredGitHubConfig().lastResult
  );
  const [isCheckingAppUpdate, setIsCheckingAppUpdate] = useState<boolean>(false);
  const [dismissedUpdateVer, setDismissedUpdateVer] = useState<string>(() =>
    getDismissedUpdateVersion()
  );
  const [updateDownloadState, setUpdateDownloadState] = useState<AppUpdateDownloadState>({
    status: 'idle',
    progress: 0,
    downloadedBytes: 0,
    totalBytes: 0,
  });
  const updateStateStatusRef = useRef(updateDownloadState.status);
  updateStateStatusRef.current = updateDownloadState.status;

  const checkForUpdatesNow = useCallback(
    async (options?: {
      repo?: string;
      token?: string;
      force?: boolean;
    }): Promise<UpdateCheckResult | null> => {
      const cfg = getStoredGitHubConfig();
      const targetRepo = (options?.repo ?? cfg.repo).trim();
      const targetToken = (options?.token ?? cfg.token).trim();

      if (!options?.force && !shouldRunAutoUpdateCheck(cfg.lastResult?.checkedAt)) {
        return cfg.lastResult;
      }

      setIsCheckingAppUpdate(true);
      try {
        let effectiveBuild = installedVersionRef.current.build;
        let effectiveVersion = installedVersionRef.current.version;
        if (isNativeSelfUpdateSupported()) {
          const nativeInfo = await getInstalledAppInfo();
          if (nativeInfo) {
            effectiveBuild = Math.max(CURRENT_BUILD_NUMBER, nativeInfo.versionCode || 0);
            if (nativeInfo.versionName) {
              effectiveVersion = nativeInfo.versionName.startsWith('v')
                ? nativeInfo.versionName
                : `v${nativeInfo.versionName}`;
            }
            installedVersionRef.current = { version: effectiveVersion, build: effectiveBuild };
            setInstalledAppVersion(effectiveVersion);
            setInstalledBuildNumber(effectiveBuild);
          }
        }

        const result = await checkForGitHubUpdates(
          targetRepo,
          targetToken || undefined,
          effectiveVersion,
          { currentBuildNumber: effectiveBuild }
        );
        setAppUpdateResult(result);
        if (result.hasUpdate && result.latestVersion && result.latestVersion !== getDismissedUpdateVersion()) {
          clearDismissedUpdateVersion();
          setDismissedUpdateVer('');
        }
        return result;
      } catch (err) {
        console.warn('Erro ao verificar atualizações:', err);
        return null;
      } finally {
        setIsCheckingAppUpdate(false);
      }
    },
    []
  );

  const retryInstallPendingApk = useCallback(async () => {
    try {
      const res = await installPendingApk();
      if (res.status === 'installer_launched') {
        hapticSuccess();
        setUpdateDownloadState((prev) => ({
          ...prev,
          status: 'installer_launched',
          progress: 100,
          error: undefined,
        }));
      } else if (res.status === 'permission_required') {
        setUpdateDownloadState((prev) => ({
          ...prev,
          status: 'permission_required',
          error: undefined,
        }));
      } else {
        setUpdateDownloadState({
          status: 'idle',
          progress: 0,
          downloadedBytes: 0,
          totalBytes: 0,
        });
      }
    } catch (err: any) {
      setUpdateDownloadState((prev) => ({
        ...prev,
        status: 'error',
        error: err?.message || 'Não foi possível abrir o instalador do Android.',
      }));
    }
  }, []);

  const openUnknownSourcesAndAwaitReturn = useCallback(async () => {
    hapticImpactLight();
    await openInstallUnknownAppsSettings();
  }, []);

  const startInAppUpdate = useCallback(async () => {
    const cfg = getStoredGitHubConfig();
    const target = resolveInstallableUpdateTarget(appUpdateResult, cfg.token);
    if (!target) return;

    if (!isNativeSelfUpdateSupported()) {
      if (target.kind === 'actions_artifact_zip' && appUpdateResult?.latestBuild?.artifactId && cfg.token) {
        try {
          setUpdateDownloadState({
            status: 'downloading',
            progress: 40,
            downloadedBytes: 0,
            totalBytes: target.size,
          });
          await downloadActionsArtifactWithToken(
            appUpdateResult.latestBuild.artifactId,
            appUpdateResult.repo,
            cfg.token,
            appUpdateResult.latestBuild.artifactName || 'Lifeedy-APK'
          );
          setUpdateDownloadState({
            status: 'idle',
            progress: 0,
            downloadedBytes: 0,
            totalBytes: 0,
          });
        } catch (err: any) {
          setUpdateDownloadState({
            status: 'error',
            progress: 0,
            downloadedBytes: 0,
            totalBytes: 0,
            error: err?.message || 'Não foi possível baixar o pacote.',
          });
        }
      } else {
        try {
          await Browser.open({ url: target.url });
        } catch {
          window.open(target.url, '_blank', 'noopener,noreferrer');
        }
      }
      return;
    }

    if (target.kind === 'external_page') {
      try {
        await Browser.open({ url: target.url });
      } catch {
        window.open(target.url, '_blank', 'noopener,noreferrer');
      }
      return;
    }

    hapticImpactLight();
    setUpdateDownloadState({
      status: 'downloading',
      progress: 0,
      downloadedBytes: 0,
      totalBytes: target.size,
      error: undefined,
    });

    try {
      const res = await downloadAndInstallApk({
        url: target.url,
        token: target.needsToken ? cfg.token : undefined,
        fileName: target.fileName,
      });

      if (res.status === 'permission_required') {
        setUpdateDownloadState((prev) => ({
          ...prev,
          status: 'permission_required',
          progress: 100,
          pendingVersionName: res.versionName,
          pendingVersionCode: res.versionCode,
          error: undefined,
        }));
      } else if (res.status === 'installer_launched') {
        hapticSuccess();
        setUpdateDownloadState((prev) => ({
          ...prev,
          status: 'installer_launched',
          progress: 100,
          pendingVersionName: res.versionName,
          pendingVersionCode: res.versionCode,
          error: undefined,
        }));
      }
    } catch (err: any) {
      setUpdateDownloadState({
        status: 'error',
        progress: 0,
        downloadedBytes: 0,
        totalBytes: 0,
        error: err?.message || 'Não foi possível baixar a atualização.',
      });
    }
  }, [appUpdateResult]);

  const dismissUpdateBanner = useCallback(() => {
    hapticSelection();
    const version = appUpdateResult?.latestVersion || '';
    if (version) {
      dismissUpdateVersion(version);
      setDismissedUpdateVer(version);
    }
    setUpdateDownloadState({
      status: 'idle',
      progress: 0,
      downloadedBytes: 0,
      totalBytes: 0,
    });
  }, [appUpdateResult]);

  const resetUpdateDownloadState = useCallback(() => {
    setUpdateDownloadState({
      status: 'idle',
      progress: 0,
      downloadedBytes: 0,
      totalBytes: 0,
    });
  }, []);

  const isUpdateBannerDismissed = Boolean(
    appUpdateResult?.latestVersion && dismissedUpdateVer === appUpdateResult.latestVersion
  );

  // Read native installed version, cleanup stale APK cache after upgrade, subscribe progress & auto-check
  useEffect(() => {
    let progressHandle: { remove: () => Promise<void> } | null = null;
    let appStateHandle: { remove: () => Promise<void> } | null = null;
    let startupTimer: ReturnType<typeof setTimeout> | null = null;
    let cancelled = false;

    const initUpdater = async () => {
      let effectiveBuild = CURRENT_BUILD_NUMBER;
      if (isNativeSelfUpdateSupported()) {
        const nativeInfo = await getInstalledAppInfo();
        if (!cancelled && nativeInfo) {
          effectiveBuild = Math.max(CURRENT_BUILD_NUMBER, nativeInfo.versionCode || 0);
          const formattedVer = nativeInfo.versionName
            ? nativeInfo.versionName.startsWith('v')
              ? nativeInfo.versionName
              : `v${nativeInfo.versionName}`
            : CURRENT_APP_VERSION;
          installedVersionRef.current = { version: formattedVer, build: effectiveBuild };
          setInstalledAppVersion(formattedVer);
          setInstalledBuildNumber(effectiveBuild);

          const lastSeen = getLastSeenNativeBuild();
          if (effectiveBuild > lastSeen) {
            setLastSeenNativeBuild(effectiveBuild);
            if (lastSeen > 0) {
              await clearPendingApk();
            }
          }

          // Reconcile stale cached update result if build is already installed
          const cached = getStoredGitHubConfig().lastResult;
          if (cached?.hasUpdate && cached.latestVersion) {
            const cachedBuild = parseSemVer(cached.latestVersion)[3] || cached.latestBuild?.runNumber || 0;
            if (cachedBuild > 0 && cachedBuild <= effectiveBuild) {
              setAppUpdateResult(null);
            }
          }
        }

        progressHandle = await addUpdateProgressListener((ev) => {
          if (cancelled) return;
          setUpdateDownloadState((prev) => ({
            ...prev,
            status: ev.phase === 'installing' ? 'installer_launched' : ev.phase,
            progress: ev.progress,
            downloadedBytes: ev.downloadedBytes,
            totalBytes: ev.totalBytes || prev.totalBytes,
          }));
        });

        appStateHandle = await CapApp.addListener('appStateChange', ({ isActive }) => {
          if (!isActive || cancelled) return;
          if (updateStateStatusRef.current === 'permission_required') {
            canRequestPackageInstalls()
              .then((canInstall) => {
                if (canInstall && !cancelled) {
                  void retryInstallPendingApk();
                }
              })
              .catch(() => {});
          }
          const cfg = getStoredGitHubConfig();
          if (cfg.autoCheck && shouldRunAutoUpdateCheck(cfg.lastResult?.checkedAt)) {
            void checkForUpdatesNow({ force: true });
          }
        });
      }

      const cfg = getStoredGitHubConfig();
      if (cfg.autoCheck && !cancelled) {
        startupTimer = setTimeout(() => {
          if (!cancelled) {
            void checkForUpdatesNow({ force: false });
          }
        }, 2500);
      }
    };

    void initUpdater();

    return () => {
      cancelled = true;
      if (startupTimer) clearTimeout(startupTimer);
      if (progressHandle) void progressHandle.remove();
      if (appStateHandle) void appStateHandle.remove();
    };
  }, [checkForUpdatesNow, retryInstallPendingApk]);

  const [notificationsList, setNotificationsList] = useState<AppNotification[]>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY_NOTIFS);
      if (saved) return JSON.parse(saved);
    } catch (e) {
      // ignore
    }
    return [];
  });

  const notifiedKeysRef = useRef<Set<string>>(new Set());
  const syncTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const inspectedTokensRef = useRef<Set<string>>(new Set());
  const cloudOverwriteGuardRef = useRef<boolean>(false);

  const latestDataRef = useRef({
    tasks,
    transactions,
    financialGoals,
    draftNotes,
    specialDates,
    pendingBankNotifications,
  });
  latestDataRef.current = {
    tasks,
    transactions,
    financialGoals,
    draftNotes,
    specialDates,
    pendingBankNotifications,
  };

  // Post-login Drive inspection & start-from-scratch state
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

  // Global confirmation modal state (strictly required for destructive Workspace operations)
  const [confirmConfig, setConfirmConfig] = useState<{
    isOpen: boolean;
    title: string;
    message: string;
    details?: string[];
    confirmText?: string;
    isDestructive?: boolean;
    isProcessing?: boolean;
    onConfirm?: () => Promise<void> | void;
  }>({
    isOpen: false,
    title: '',
    message: '',
  });

  useBackHandler(confirmConfig.isOpen, () => {
    if (confirmConfig.isProcessing) return false;
    setConfirmConfig((prev) => ({ ...prev, isOpen: false }));
    return true;
  });

  // Save to local storage on changes
  useEffect(() => {
    const payload: AppDataPayload = {
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
      pendingBankNotifications,
    };
    try {
      localStorage.setItem(STORAGE_KEY_DATA, JSON.stringify(payload));
    } catch (e) {
      console.error('Falha ao salvar dados no LocalStorage:', e);
    }
  }, [
    userName,
    onboardingCompleted,
    tasks,
    transactions,
    financialGoals,
    budgetLimits,
    draftNotes,
    specialDates,
    dashboardWidgets,
    pendingBankNotifications,
  ]);

  // Persist notifications
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY_NOTIFS, JSON.stringify(notificationsList.slice(0, 30)));
    } catch (e) {
      // ignore
    }
  }, [notificationsList]);

  // Persist driveSyncInfo to local storage
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY_SYNC, JSON.stringify(driveSyncInfo));
    } catch (e) {
      // ignore
    }
  }, [driveSyncInfo]);

  // Handle Firebase Auth state changes (never log the user out solely because in-memory token expired)
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

  // Bank Notification Listener & Review Queue Ingestion (Android + Resume Sync)
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

    refreshBankListenerPermission();
    syncNativeBankNotifications();

    subscribeNativeBankNotifications((event) => {
      if (!active) return;
      ingestNativeEvents([event]);
      if (event.id) {
        acknowledgeNativeBankNotifications([event.id]);
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
        refreshBankListenerPermission();
        syncNativeBankNotifications();
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

  const processedOAuthUrlsRef = useRef<Set<string>>(new Set());

  // Handle native Android deep-link OAuth callback (warm resume + cold start)
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
          // ignore
        }

        if (token) {
          setIsAuthenticating(true);
          sessionExpiredNotifiedRef.current = false;
          const loggedUser = await completeNativeGoogleAuth(token, idToken, expiresInSec);
          setAccessToken(token);
          setTokenExpiresAt(Date.now() + (expiresInSec && expiresInSec > 60 ? expiresInSec : 3500) * 1000);
          setWorkspaceAuthStatus('connected');
          if (loggedUser) {
            setUser(loggedUser);
          }

          confetti({ particleCount: 35, spread: 60, origin: { y: 0.8 } });

          try {
            await inspectDriveBackupAfterAuth(token);
          } catch (e) {
            console.warn('Erro ao consultar Drive pós deep link:', e);
          }

          try {
            const events = await listCalendarEvents(token);
            setGoogleCalendarEvents(events);
          } catch (e) {
            console.warn('Erro ao consultar Agenda pós deep link:', e);
          }

          const successNotif: AppNotification = {
            id: 'notif-auth-ok-' + Date.now(),
            title: '🎉 Google Conectado com Sucesso',
            body: 'Sua conta Google foi sincronizada. Google Drive e Agenda estão ativos.',
            timestamp: new Date().toISOString(),
            type: 'reminder',
            read: false,
          };
          setNotificationsList((prev) => [successNotif, ...prev]);
        }
      } catch (err: any) {
        console.error('Falha ao processar login nativo do Google:', err);
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

  // Complete web redirect sign-in if main web app ever fell back to redirect
  useEffect(() => {
    if (Capacitor.isNativePlatform()) return;
    if (typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('connect_native') === '1') {
      return;
    }

    let active = true;
    consumeRedirectSignInResult()
      .then((res) => {
        if (!active || !res?.accessToken || !res.user) return;
        sessionExpiredNotifiedRef.current = false;
        setUser(res.user);
        setAccessToken(res.accessToken);
        setTokenExpiresAt(res.expiresAt);
        setWorkspaceAuthStatus('connected');
      })
      .catch((err) => {
        console.warn('Erro ao finalizar login Google via redirecionamento:', err);
      });
    return () => {
      active = false;
    };
  }, []);

  const sessionExpiredNotifiedRef = useRef(false);

  const handleWorkspaceAuthError = useCallback((err: unknown): boolean => {
    if (!isWorkspaceAuthError(err)) return false;

    // Clear only the expired Workspace access token — NEVER sign the user profile out!
    setSessionToken(null);
    setAccessToken(null);
    setTokenExpiresAt(0);
    setWorkspaceAuthStatus(userRef.current ? 'needs_reauth' : 'disconnected');

    if (userRef.current && !sessionExpiredNotifiedRef.current) {
      sessionExpiredNotifiedRef.current = true;
      const expiredNotif: AppNotification = {
        id: 'notif-auth-refresh-' + Date.now(),
        title: 'Sincronização Google em espera',
        body: 'Sua conta continua conectada no Lifeedy. Toque em "Renovar sincronização" nos ajustes ou na nuvem quando quiser atualizar Drive e Agenda.',
        timestamp: new Date().toISOString(),
        type: 'reminder',
        read: false,
      };
      setNotificationsList((prev) => [expiredNotif, ...prev.slice(0, 29)]);
    }

    return true;
  }, []);

  // Fetch Calendar events when accessToken is available
  const refreshCalendar = useCallback(async () => {
    const token = accessToken || (await getAccessToken());
    if (!token) return;

    setIsLoadingCalendar(true);
    try {
      const events = await listCalendarEvents(token);
      setGoogleCalendarEvents(events);
    } catch (err: any) {
      if (!handleWorkspaceAuthError(err)) {
        console.warn('Falha ao carregar calendário:', err);
      }
    } finally {
      setIsLoadingCalendar(false);
    }
  }, [accessToken, handleWorkspaceAuthError]);

  useEffect(() => {
    if (accessToken) {
      refreshCalendar();
    }
  }, [accessToken, refreshCalendar]);

  // Passive expiry & foreground watcher: cleanly transitions token state without calling blocked background popups
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
        if (isActive) {
          markNeedsReauthIfExpired();
        }
      })
        .then((h) => {
          capAppHandle = h;
        })
        .catch(() => {});
    }

    return () => {
      if (expiryTimer) clearTimeout(expiryTimer);
      document.removeEventListener('visibilitychange', handleVisibility);
      if (capAppHandle) {
        capAppHandle.remove().catch(() => {});
      }
    };
  }, [user, accessToken, tokenExpiresAt]);

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
        setPendingBankNotifications(sanitized.pendingBankNotifications);
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
    []
  );

  // Inspect Drive backup right after authentication (auto-restore on empty device, prompt if device has data)
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

  // Trigger initial post-login Drive inspection when accessToken becomes available
  useEffect(() => {
    if (accessToken) {
      void inspectDriveBackupAfterAuth(accessToken);
    }
  }, [accessToken, inspectDriveBackupAfterAuth]);

  // Periodic Drive status polling while signed in
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
            status: isCloudNewer ? 'cloud_newer' : prev.status === 'cloud_newer' ? 'cloud_newer' : 'synced',
          };
        });
      }
    } catch (err) {
      if (!handleWorkspaceAuthError(err)) {
        console.warn('Erro ao verificar status do Google Drive:', err);
      }
    }
  }, [accessToken, handleWorkspaceAuthError]);

  // Real-time synchronization interval (pauses cleanly when Workspace token needs renewal)
  useEffect(() => {
    if (!accessToken || workspaceAuthStatus !== 'connected') return;
    const interval = setInterval(() => {
      void checkDriveStatus();
    }, 45000);
    return () => clearInterval(interval);
  }, [accessToken, workspaceAuthStatus, checkDriveStatus]);

  // Auto-sync debounced after local edits if logged in
  const triggerAutoSync = useCallback(() => {
    if (!accessToken || cloudOverwriteGuardRef.current) return;

    if (syncTimeoutRef.current) {
      clearTimeout(syncTimeoutRef.current);
    }

    syncTimeoutRef.current = setTimeout(async () => {
      if (cloudOverwriteGuardRef.current) return;
      try {
        setDriveSyncInfo((prev) => ({ ...prev, status: 'syncing' }));
        const payload: AppDataPayload = {
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
          pendingBankNotifications,
        };

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
  }, [
    accessToken,
    userName,
    onboardingCompleted,
    tasks,
    transactions,
    financialGoals,
    budgetLimits,
    draftNotes,
    specialDates,
    dashboardWidgets,
    pendingBankNotifications,
    driveSyncInfo.fileId,
    handleWorkspaceAuthError,
  ]);

  const setUserName = (name: string) => {
    const cleaned = name.trim();
    setUserNameState(cleaned);
    triggerAutoSync();
  };

  const completeOnboarding = (name: string) => {
    const cleaned = name.trim();
    if (cleaned) {
      setUserNameState(cleaned);
    }
    setOnboardingCompleted(true);
    hapticSuccess();
    triggerAutoSync();
  };

  // Web Notifications Engine: Silent checks (sem sons)
  useEffect(() => {
    const checkReminders = () => {
      const now = new Date();
      const todayStr = now.toISOString().split('T')[0];
      const currentTimeMs = now.getTime();

      // 1. Check tasks due today with specified dueTime
      tasks.forEach((task) => {
        if (task.completed || task.dueDate !== todayStr || !task.dueTime) return;

        const [hours, minutes] = task.dueTime.split(':').map(Number);
        const taskDueMs = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hours, minutes).getTime();
        const diffMinutes = (taskDueMs - currentTimeMs) / (1000 * 60);

        if (diffMinutes <= 15 && diffMinutes >= -5) {
          const key = `task-${task.id}-${todayStr}-${task.dueTime}`;
          if (!notifiedKeysRef.current.has(key)) {
            notifiedKeysRef.current.add(key);

            const title = `⏰ Lembrete: ${task.title}`;
            const body =
              diffMinutes <= 1
                ? `Horário de vencimento agora (${task.dueTime})!`
                : `Vence em aproximadamente ${Math.ceil(diffMinutes)} minuto(s) às ${task.dueTime}.`;

            sendWebNotification(title, { body, tag: key });

            const newNotif: AppNotification = {
              id: 'notif-' + Date.now() + '-' + Math.random().toString(36).substring(2, 5),
              title,
              body,
              timestamp: new Date().toISOString(),
              type: 'task_deadline',
              read: false,
            };
            setNotificationsList((prev) => [newNotif, ...prev.slice(0, 29)]);
          }
        }
      });

      // 2. Check Google Calendar events starting soon
      calendarEvents.forEach((event) => {
        if (!event.start?.dateTime) return;

        const eventStartMs = new Date(event.start.dateTime).getTime();
        const diffMinutes = (eventStartMs - currentTimeMs) / (1000 * 60);

        if (diffMinutes <= 15 && diffMinutes >= -2) {
          const key = `event-${event.id}-${event.start.dateTime}`;
          if (!notifiedKeysRef.current.has(key)) {
            notifiedKeysRef.current.add(key);

            const startTimeFormatted = new Date(event.start.dateTime).toLocaleTimeString('pt-BR', {
              hour: '2-digit',
              minute: '2-digit',
            });

            const title = `📅 Google Agenda: ${event.summary || 'Compromisso'}`;
            const body =
              diffMinutes <= 1
                ? `Iniciando agora (${startTimeFormatted})!${event.location ? ` • ${event.location}` : ''}`
                : `Inicia em ${Math.ceil(diffMinutes)} minuto(s) às ${startTimeFormatted}.${event.location ? ` Local: ${event.location}` : ''}`;

            sendWebNotification(title, { body, tag: key });

            const newNotif: AppNotification = {
              id: 'notif-' + Date.now() + '-' + Math.random().toString(36).substring(2, 5),
              title,
              body,
              timestamp: new Date().toISOString(),
              type: 'calendar_event',
              read: false,
            };
            setNotificationsList((prev) => [newNotif, ...prev.slice(0, 29)]);
          }
        }
      });
    };

    checkReminders();
    const interval = setInterval(checkReminders, 30000);
    return () => clearInterval(interval);
  }, [tasks, calendarEvents]);

  // Request browser notification permission
  const enableNotifications = async (): Promise<boolean> => {
    const perm = await requestNotificationPermission();
    setNotificationPermission(perm);
    if (perm === 'granted') {
      sendWebNotification('🔔 Notificações Ativadas!', {
        body: 'Você agora receberá alertas visuais sobre prazos e compromissos.',
      });
      return true;
    }
    return false;
  };

  const triggerTestNotification = () => {
    sendWebNotification('🔔 Notificação de Teste', {
      body: 'Seu sistema de notificações visuais está funcionando perfeitamente!',
    });
    const newNotif: AppNotification = {
      id: 'notif-test-' + Date.now(),
      title: '🔔 Teste de Notificação',
      body: 'Alerta visual emitido com sucesso.',
      timestamp: new Date().toISOString(),
      type: 'reminder',
      read: false,
    };
    setNotificationsList((prev) => [newNotif, ...prev]);
  };

  const dismissNotification = (id: string) => {
    setNotificationsList((prev) => prev.filter((n) => n.id !== id));
  };

  const clearAllNotifications = () => {
    setNotificationsList([]);
  };

  // Decision actions for post-login Drive backup & Start from Scratch
  const acceptPendingDriveRestore = useCallback(() => {
    if (!pendingDriveRestore) return;
    const { driveFile, remoteData } = pendingDriveRestore;
    const sanitized = sanitizeLegacyPayload(remoteData);
    applySanitizedPayload(sanitized, driveFile.id, driveFile.modifiedTime);
    setPendingDriveRestore(null);
    hapticSuccess();
    confetti({ particleCount: 50, spread: 70, origin: { y: 0.7 } });
  }, [pendingDriveRestore, applySanitizedPayload]);

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
        if (!token) {
          token = await signInWithGoogle();
        }
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
        } catch (err: any) {
          if (handleWorkspaceAuthError(err)) {
            throw new Error('Permissão temporária do Google em renovação. Tente novamente em instantes.');
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
      setPendingBankNotifications([]);
      setNotificationsList([]);
      setUserNameState('');
      setOnboardingCompleted(false);
      setPendingDriveRestore(null);
      setAutoRestoredNotice(null);
      setUndoToast(null);
      notifiedKeysRef.current.clear();

      try {
        localStorage.removeItem(STORAGE_KEY_DATA);
        localStorage.removeItem(STORAGE_KEY_PENDING_BANK);
        localStorage.removeItem(STORAGE_KEY_BANK_SIGS);
        localStorage.removeItem(STORAGE_KEY_NOTIFS);
        localStorage.removeItem(STORAGE_KEY_SYNC);
      } catch {
        // ignore
      }

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
    [accessToken, driveSyncInfo.fileId, handleWorkspaceAuthError]
  );

  // Manual save to Google Drive
  const syncToDriveNow = async () => {
    let token = accessToken || (await getAccessToken());
    if (!token) {
      token = await signInWithGoogle();
      if (!token) return;
    }

    cloudOverwriteGuardRef.current = false;
    setDriveSyncInfo((prev) => ({ ...prev, status: 'syncing', errorMessage: undefined }));
    try {
      const payload: AppDataPayload = {
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
        pendingBankNotifications,
      };

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
  };

  // Restore data from Google Drive
  const restoreFromDriveNow = async () => {
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
  };

  // Google Sign-in flow (supports both first login and one-tap renewal preserving login_hint)
  const signInWithGoogle = async (): Promise<string | null> => {
    setIsAuthenticating(true);
    try {
      const result = await googleSignIn({
        loginHint: userRef.current?.email || undefined,
      });
      if (!result) return null;

      if (result.isNativeRedirect || result.isWebRedirect) {
        // Redirecionado para Chrome seguro (Custom Tab); o listener appUrlOpen concluirá a autenticação
        return null;
      }

      if (result.user && result.accessToken) {
        sessionExpiredNotifiedRef.current = false;
        cloudOverwriteGuardRef.current = false;
        setUser(result.user);
        setAccessToken(result.accessToken);
        setTokenExpiresAt(result.expiresAt || Date.now() + 3500 * 1000);
        setWorkspaceAuthStatus('connected');
        await inspectDriveBackupAfterAuth(result.accessToken);
        try {
          const events = await listCalendarEvents(result.accessToken);
          setGoogleCalendarEvents(events);
        } catch (e) {
          console.warn('Aviso ao consultar agenda pós login:', e);
        }
        return result.accessToken;
      }
      return null;
    } catch (err: any) {
      console.warn('Aviso de login:', err);
      const userMessage = mapGoogleAuthError(err);

      const newNotif: AppNotification = {
        id: 'notif-auth-' + Date.now(),
        title: 'Aviso de Login',
        body: userMessage,
        timestamp: new Date().toISOString(),
        type: 'reminder',
        read: false,
      };
      setNotificationsList((prev) => [newNotif, ...prev]);
      return null;
    } finally {
      setIsAuthenticating(false);
    }
  };

  const refreshWorkspaceSession = useCallback(
    async (options?: { interactiveIfNeeded?: boolean }): Promise<string | null> => {
      const existing = accessToken || (await getAccessToken());
      if (existing) return existing;

      if (options?.interactiveIfNeeded) {
        return await signInWithGoogle();
      }
      return null;
    },
    [accessToken]
  );

  const signOut = async () => {
    inspectedTokensRef.current.clear();
    cloudOverwriteGuardRef.current = false;
    setPendingDriveRestore(null);
    setAutoRestoredNotice(null);
    await fbLogout();
    setUser(null);
    setAccessToken(null);
    setTokenExpiresAt(0);
    setWorkspaceAuthStatus('disconnected');
    setGoogleCalendarEvents([]);
    setDriveSyncInfo((prev) => ({ ...prev, status: 'idle' }));
  };

  // Task actions with EDITING support & UNDO
  const addTask = (taskData: Omit<TaskItem, 'id'>) => {
    const newTask: TaskItem = {
      ...taskData,
      id: 'task-' + Date.now() + '-' + Math.random().toString(36).substring(2, 6),
    };
    hapticImpactLight();
    setTasks((prev) => [newTask, ...prev]);
    triggerAutoSync();
  };

  const updateTask = (id: string, updates: Partial<TaskItem>) => {
    setTasks((prev) =>
      prev.map((t) => (t.id === id ? { ...t, ...updates } : t))
    );
    triggerAutoSync();
  };

  const toggleTaskCompletion = (id: string) => {
    setTasks((prev) =>
      prev.map((t) => {
        if (t.id === id) {
          const nextCompleted = !t.completed;
          if (nextCompleted) {
            hapticSuccess();
            confetti({ particleCount: 25, spread: 50, origin: { y: 0.85 } });
          } else {
            hapticImpactLight();
          }
          return {
            ...t,
            completed: nextCompleted,
            completedAt: nextCompleted ? new Date().toISOString() : undefined,
          };
        }
        return t;
      })
    );
    triggerAutoSync();
  };

  const snoozeTaskToTomorrow = (id: string) => {
    const taskToSnooze = tasks.find((t) => t.id === id);
    if (!taskToSnooze) return;

    const previousDueDate = taskToSnooze.dueDate;
    const todayNoon = new Date();
    todayNoon.setHours(12, 0, 0, 0);
    const baseDate = previousDueDate ? new Date(`${previousDueDate}T12:00:00`) : new Date(todayNoon);
    const anchor = Number.isNaN(baseDate.getTime()) || baseDate < todayNoon ? new Date(todayNoon) : baseDate;
    anchor.setDate(anchor.getDate() + 1);

    const tomorrowStr = `${anchor.getFullYear()}-${String(anchor.getMonth() + 1).padStart(
      2,
      '0'
    )}-${String(anchor.getDate()).padStart(2, '0')}`;

    hapticImpactLight();
    setTasks((prev) =>
      prev.map((t) => (t.id === id ? { ...t, dueDate: tomorrowStr } : t))
    );
    triggerAutoSync();

    const formattedTarget = new Intl.DateTimeFormat('pt-BR', {
      day: '2-digit',
      month: 'short',
    }).format(anchor);

    showUndoToast(`"${taskToSnooze.title}" adiada para ${formattedTarget}.`, () => {
      hapticImpactLight();
      setTasks((prev) =>
        prev.map((t) => (t.id === id ? { ...t, dueDate: previousDueDate } : t))
      );
      triggerAutoSync();
    });
  };

  const deleteTask = (id: string) => {
    const taskToDelete = tasks.find((t) => t.id === id);
    if (!taskToDelete) return;

    hapticWarning();
    setTasks((prev) => prev.filter((t) => t.id !== id));
    triggerAutoSync();

    showUndoToast(`Tarefa "${taskToDelete.title}" excluída.`, () => {
      setTasks((prev) => [taskToDelete, ...prev]);
      triggerAutoSync();
    });
  };

  const toggleSubtask = (taskId: string, subtaskId: string) => {
    setTasks((prev) =>
      prev.map((t) => {
        if (t.id === taskId) {
          const updatedSubtasks = t.subtasks.map((st) =>
            st.id === subtaskId ? { ...st, completed: !st.completed } : st
          );
          return { ...t, subtasks: updatedSubtasks };
        }
        return t;
      })
    );
    triggerAutoSync();
  };

  // Finance actions with UNDO
  const addTransaction = (txData: Omit<Transaction, 'id'>) => {
    const newTx: Transaction = {
      ...txData,
      id: 'tx-' + Date.now() + '-' + Math.random().toString(36).substring(2, 6),
    };
    hapticImpactLight();
    setTransactions((prev) => [newTx, ...prev]);
    triggerAutoSync();
  };

  const updateTransaction = (id: string, updates: Partial<Omit<Transaction, 'id'>>) => {
    hapticImpactLight();
    setTransactions((prev) =>
      prev.map((tx) => (tx.id === id ? { ...tx, ...updates } : tx))
    );
    triggerAutoSync();
  };

  const deleteTransaction = (id: string) => {
    const txToDelete = transactions.find((tx) => tx.id === id);
    if (!txToDelete) return;

    hapticWarning();
    setTransactions((prev) => prev.filter((tx) => tx.id !== id));
    triggerAutoSync();

    showUndoToast(`Transação "${txToDelete.title}" excluída.`, () => {
      setTransactions((prev) => [txToDelete, ...prev]);
      triggerAutoSync();
    });
  };

  const addGoal = (goalData: Omit<FinancialGoal, 'id'>) => {
    const newGoal: FinancialGoal = {
      ...goalData,
      id: 'goal-' + Date.now(),
    };
    setFinancialGoals((prev) => [...prev, newGoal]);
    triggerAutoSync();
  };

  const updateGoal = (id: string, updates: Partial<FinancialGoal>) => {
    setFinancialGoals((prev) =>
      prev.map((g) => (g.id === id ? { ...g, ...updates } : g))
    );
    triggerAutoSync();
  };

  const deleteGoal = (id: string) => {
    setFinancialGoals((prev) => prev.filter((g) => g.id !== id));
    triggerAutoSync();
  };

  const updateBudgetLimit = (category: Transaction['category'], limit: number) => {
    setBudgetLimits((prev) => {
      if (limit <= 0 || isNaN(limit)) {
        return prev.filter((b) => b.category !== category);
      }
      const exists = prev.find((b) => b.category === category);
      if (exists) {
        return prev.map((b) => (b.category === category ? { ...b, monthlyLimit: limit } : b));
      } else {
        return [...prev, { category, monthlyLimit: limit }];
      }
    });
    triggerAutoSync();
  };

  // Bank Notification Queue actions
  const enqueueParsedBankText = (
    rawText: string,
    bankName?: string
  ): PendingBankNotification | null => {
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
  };

  const approvePendingBankNotification = (
    id: string,
    overrides?: Partial<Omit<Transaction, 'id'>>
  ) => {
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
    setTransactions((prev) => [newTx, ...prev]);
    setPendingBankNotifications((prev) => prev.filter((item) => item.id !== id));
    triggerAutoSync();
  };

  const approveAllPendingBankNotifications = () => {
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
    setTransactions((prev) => [...batch, ...prev]);
    setPendingBankNotifications([]);
    triggerAutoSync();
  };

  const dismissPendingBankNotification = (id: string) => {
    hapticImpactLight();
    setPendingBankNotifications((prev) => prev.filter((item) => item.id !== id));
  };

  const clearPendingBankNotifications = () => {
    hapticWarning();
    setPendingBankNotifications([]);
  };

  // Drafts / Rascunhos actions
  const addDraftNote = (noteData: Omit<DraftNote, 'id' | 'updatedAt'>) => {
    const newNote: DraftNote = {
      ...noteData,
      id: 'draft-' + Date.now(),
      updatedAt: new Date().toISOString(),
    };
    setDraftNotes((prev) => [newNote, ...prev]);
    triggerAutoSync();
  };

  const updateDraftNote = (id: string, updates: Partial<DraftNote>) => {
    setDraftNotes((prev) =>
      prev.map((d) => (d.id === id ? { ...d, ...updates, updatedAt: new Date().toISOString() } : d))
    );
    triggerAutoSync();
  };

  const deleteDraftNote = (id: string) => {
    const draftToDelete = draftNotes.find((d) => d.id === id);
    if (!draftToDelete) return;

    setDraftNotes((prev) => prev.filter((d) => d.id !== id));
    triggerAutoSync();

    showUndoToast(`Rascunho "${draftToDelete.title}" excluído.`, () => {
      setDraftNotes((prev) => [draftToDelete, ...prev]);
      triggerAutoSync();
    });
  };

  const togglePinDraft = (id: string) => {
    setDraftNotes((prev) =>
      prev.map((d) => (d.id === id ? { ...d, isPinned: !d.isPinned } : d))
    );
    triggerAutoSync();
  };

  const toggleDraftChecklistItem = (draftId: string, itemId: string) => {
    setDraftNotes((prev) =>
      prev.map((d) => {
        if (d.id !== draftId || !d.checklistItems) return d;
        const nextItems = d.checklistItems.map((item) => {
          if (item.id !== itemId) return item;
          const nextDone = !item.completed;
          if (nextDone) hapticSuccess();
          else hapticImpactLight();
          return { ...item, completed: nextDone };
        });
        return {
          ...d,
          checklistItems: nextItems,
          updatedAt: new Date().toISOString(),
        };
      })
    );
    triggerAutoSync();
  };

  const addDraftChecklistItem = (draftId: string, text: string) => {
    const cleaned = text.trim();
    if (!cleaned) return;
    hapticImpactLight();
    setDraftNotes((prev) =>
      prev.map((d) => {
        if (d.id !== draftId) return d;
        const nextItems = [
          ...(d.checklistItems || []),
          {
            id: `chk-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            text: cleaned,
            completed: false,
          },
        ];
        return {
          ...d,
          kind: d.kind || 'list',
          checklistItems: nextItems,
          updatedAt: new Date().toISOString(),
        };
      })
    );
    triggerAutoSync();
  };

  const convertDraftToTask = (draft: DraftNote) => {
    const d = new Date();
    const todayStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
      d.getDate()
    ).padStart(2, '0')}`;
    const subtasks = (draft.checklistItems || []).map((item, idx) => ({
      id: `st-draft-${Date.now()}-${idx}`,
      title: item.text,
      completed: item.completed,
    }));
    const newTask: TaskItem = {
      id: 'task-' + Date.now() + '-' + Math.random().toString(36).substring(2, 6),
      title: draft.title.trim() || draft.content.trim().slice(0, 60) || 'Tarefa do rascunho',
      description: draft.content.trim() && draft.content.trim() !== draft.title.trim()
        ? draft.content.trim()
        : undefined,
      dueDate: todayStr,
      priority: 'medium',
      category: 'pessoal',
      completed: false,
      subtasks,
    };
    hapticSuccess();
    setTasks((prev) => [newTask, ...prev]);
    triggerAutoSync();
    showUndoToast(`"${newTask.title}" adicionada às tarefas de hoje.`, () => {
      setTasks((prev) => prev.filter((t) => t.id !== newTask.id));
      triggerAutoSync();
    });
  };

  const addSpecialDate = (item: Omit<LocalSpecialDate, 'id' | 'createdAt'>) => {
    const newItem: LocalSpecialDate = {
      ...item,
      id: 'special-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6),
      createdAt: new Date().toISOString(),
    };
    hapticSuccess();
    setSpecialDates((prev) => [newItem, ...prev]);
    triggerAutoSync();
  };

  const deleteSpecialDate = (id: string) => {
    const target = specialDates.find((s) => s.id === id);
    if (!target) return;
    hapticWarning();
    setSpecialDates((prev) => prev.filter((s) => s.id !== id));
    triggerAutoSync();
    showUndoToast(`Data "${target.title}" removida.`, () => {
      setSpecialDates((prev) => [target, ...prev]);
      triggerAutoSync();
    });
  };

  const createTaskFromCalendarEvent = (ev: GoogleCalendarEvent) => {
    const d = new Date();
    const fallbackToday = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
      d.getDate()
    ).padStart(2, '0')}`;
    const evDate = ev.start?.date
      ? ev.start.date.slice(0, 10)
      : ev.start?.dateTime
      ? ev.start.dateTime.slice(0, 10)
      : fallbackToday;
    const targetDate = evDate >= fallbackToday ? evDate : fallbackToday;
    const prefix =
      ev.eventCategory === 'birthday'
        ? 'Preparar comemoração: '
        : ev.eventCategory === 'holiday'
        ? 'Planejar feriado: '
        : '';
    const newTask: TaskItem = {
      id: 'task-' + Date.now() + '-' + Math.random().toString(36).substring(2, 6),
      title: `${prefix}${ev.summary || 'Compromisso'}`.trim(),
      description: ev.description || (ev.location ? `Local: ${ev.location}` : undefined),
      dueDate: targetDate,
      dueTime: ev.start?.dateTime
        ? new Date(ev.start.dateTime).toLocaleTimeString('pt-BR', {
            hour: '2-digit',
            minute: '2-digit',
            hour12: false,
          })
        : undefined,
      priority: ev.eventCategory === 'birthday' ? 'high' : 'medium',
      category: 'pessoal',
      completed: false,
      subtasks: [],
    };
    hapticSuccess();
    setTasks((prev) => [newTask, ...prev]);
    triggerAutoSync();
    showUndoToast(`Tarefa "${newTask.title}" criada na sua lista.`, () => {
      setTasks((prev) => prev.filter((t) => t.id !== newTask.id));
      triggerAutoSync();
    });
  };

  const toggleDashboardWidget = (widgetId: string) => {
    setDashboardWidgets((prev) => {
      const exists = prev.includes(widgetId);
      const next = exists ? prev.filter((w) => w !== widgetId) : [...prev, widgetId];
      return next;
    });
    triggerAutoSync();
  };

  // Google Calendar Integration actions
  const addEventToGoogleCalendar = async (eventData: {
    summary: string;
    description?: string;
    location?: string;
    startDateTime: string;
    endDateTime: string;
    allDay?: boolean;
    date?: string;
    calendarId?: string;
  }): Promise<GoogleCalendarEvent | null> => {
    const token = accessToken || (await getAccessToken()) || (await signInWithGoogle());
    if (!token) {
      return null;
    }

    try {
      const created = await createCalendarEvent(token, eventData);
      setGoogleCalendarEvents((prev) => [created, ...prev]);
      confetti({ particleCount: 25, spread: 60 });
      return created;
    } catch (err: any) {
      handleWorkspaceAuthError(err);
      console.warn('Falha ao adicionar evento na Google Agenda:', err);
      throw err;
    }
  };

  const updateGoogleCalendarEvent = (
    eventId: string,
    eventData: {
      summary: string;
      description?: string;
      location?: string;
      startDateTime: string;
      endDateTime: string;
      allDay?: boolean;
      date?: string;
      calendarId?: string;
    }
  ) => {
    confirmDestructiveAction({
      title: 'Atualizar Evento na Google Agenda?',
      message: `Confirmar alterações em "${eventData.summary}" no seu Google Calendar?`,
      details: [eventData.allDay && eventData.date ? `Data: ${eventData.date}` : `Horário atualizado`],
      confirmText: 'Salvar Alterações',
      isDestructive: false,
      onConfirm: async () => {
        const token = accessToken || (await getAccessToken()) || (await signInWithGoogle());
        if (!token) return;
        try {
          const updated = await apiUpdateCalendarEvent(token, eventId, eventData);
          setGoogleCalendarEvents((prev) =>
            prev.map((ev) => (ev.id === eventId ? { ...ev, ...updated } : ev))
          );
          hapticSuccess();
        } catch (err) {
          handleWorkspaceAuthError(err);
          throw err;
        }
      },
    });
  };

  const removeGoogleCalendarEvent = async (eventId: string) => {
    const event = calendarEvents.find((e) => e.id === eventId);
    if (event?.source === 'local_special' && event.specialDateId) {
      const specialId = event.specialDateId;
      confirmDestructiveAction({
        title: 'Excluir Data Especial?',
        message: `Deseja remover "${event.summary}" das suas datas e aniversários salvos?`,
        confirmText: 'Excluir Data',
        isDestructive: true,
        onConfirm: () => {
          deleteSpecialDate(specialId);
        },
      });
      return;
    }

    if (event?.editable === false) return;

    const token = accessToken || (await getAccessToken()) || (await signInWithGoogle());
    if (!token) return;

    const summary = event ? event.summary : 'Evento da Google Agenda';
    const targetCalendarId = event?.calendarId || 'primary';

    confirmDestructiveAction({
      title: 'Excluir da Google Agenda?',
      message: `Tem certeza de que deseja remover "${summary}" da sua Google Agenda? Esta ação não pode ser desfeita.`,
      details: [`Calendário: ${event?.calendarSummary || 'Google Agenda'}`],
      confirmText: 'Excluir Evento',
      isDestructive: true,
      onConfirm: async () => {
        try {
          await apiDeleteCalendarEvent(token, eventId, targetCalendarId);
          setGoogleCalendarEvents((prev) => prev.filter((e) => e.id !== eventId));
        } catch (err) {
          handleWorkspaceAuthError(err);
          throw err;
        }
      },
    });
  };

  const scheduleTaskInCalendar = async (task: TaskItem, startHour = '10:00'): Promise<boolean> => {
    const token = accessToken || (await getAccessToken()) || (await signInWithGoogle());
    if (!token) {
      return false;
    }

    try {
      const startIso = `${task.dueDate}T${task.dueTime || startHour}:00`;
      const startDate = new Date(startIso);
      const endDate = new Date(startDate.getTime() + 60 * 60 * 1000);

      const created = await addEventToGoogleCalendar({
        summary: `[Lifeedy] ${task.title}`,
        description: task.description || 'Tarefa agendada via Lifeedy',
        startDateTime: startDate.toISOString(),
        endDateTime: endDate.toISOString(),
      });

      if (created) {
        updateTask(task.id, { googleCalendarEventId: created.id });
        return true;
      }
    } catch (e) {
      handleWorkspaceAuthError(e);
      console.warn('Falha ao agendar tarefa no Google Calendar:', e);
    }
    return false;
  };

  // Export JSON backup
  const exportBackupJson = () => {
    const payload: AppDataPayload = {
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
      pendingBankNotifications,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Lifeedy_Backup_${new Date().toISOString().split('T')[0]}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Import JSON backup
  const importBackupJson = (content: string): boolean => {
    try {
      const parsed = JSON.parse(content);
      const sanitized = sanitizeLegacyPayload(parsed);
      if (sanitized.tasks) setTasks(sanitized.tasks);
      if (sanitized.transactions) setTransactions(sanitized.transactions);
      if (sanitized.financialGoals) setFinancialGoals(sanitized.financialGoals);
      if (sanitized.budgetLimits) setBudgetLimits(sanitized.budgetLimits);
      if (sanitized.draftNotes) setDraftNotes(sanitized.draftNotes);
      if (sanitized.specialDates) setSpecialDates(sanitized.specialDates);
      if (sanitized.dashboardWidgets) setDashboardWidgets(sanitized.dashboardWidgets);
      if (sanitized.pendingBankNotifications) {
        setPendingBankNotifications(sanitized.pendingBankNotifications);
      }
      if (sanitized.userName) setUserNameState(sanitized.userName);
      if (sanitized.onboardingCompleted || sanitized.userName) {
        setOnboardingCompleted(true);
      }
      triggerAutoSync();
      return true;
    } catch (e) {
      console.error('Erro ao importar JSON:', e);
      return false;
    }
  };

  const confirmDestructiveAction = (config: {
    title: string;
    message: string;
    details?: string[];
    confirmText?: string;
    isDestructive?: boolean;
    onConfirm: () => Promise<void> | void;
  }) => {
    setConfirmConfig({
      isOpen: true,
      title: config.title,
      message: config.message,
      details: config.details,
      confirmText: config.confirmText,
      isDestructive: config.isDestructive ?? true,
      isProcessing: false,
      onConfirm: async () => {
        try {
          setConfirmConfig((prev) => ({ ...prev, isProcessing: true }));
          await config.onConfirm();
          setConfirmConfig((prev) => ({ ...prev, isOpen: false, isProcessing: false }));
        } catch (err) {
          console.error('Erro na ação destrutiva:', err);
          setConfirmConfig((prev) => ({ ...prev, isProcessing: false }));
        }
      },
    });
  };

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
        calendarEvents,
        isLoadingCalendar,
        addTask,
        updateTask,
        toggleTaskCompletion,
        snoozeTaskToTomorrow,
        deleteTask,
        toggleSubtask,
        addTransaction,
        updateTransaction,
        deleteTransaction,
        addGoal,
        updateGoal,
        deleteGoal,
        updateBudgetLimit,
        hideValues,
        toggleHideValues,
        formatMoney,
        financeLockEnabled,
        setFinanceLockEnabled,
        pendingBankNotifications,
        bankListenerSupported,
        bankListenerPermission,
        refreshBankListenerPermission,
        openBankListenerSettings,
        enqueueParsedBankText,
        approvePendingBankNotification,
        approveAllPendingBankNotifications,
        dismissPendingBankNotification,
        clearPendingBankNotifications,
        addDraftNote,
        updateDraftNote,
        deleteDraftNote,
        togglePinDraft,
        toggleDraftChecklistItem,
        addDraftChecklistItem,
        convertDraftToTask,
        toggleDashboardWidget,
        notificationPermission,
        notificationsList,
        enableNotifications,
        triggerTestNotification,
        dismissNotification,
        clearAllNotifications,
        refreshCalendar,
        addSpecialDate,
        deleteSpecialDate,
        createTaskFromCalendarEvent,
        addEventToGoogleCalendar,
        updateGoogleCalendarEvent,
        removeGoogleCalendarEvent,
        scheduleTaskInCalendar,
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
        installedAppVersion,
        installedBuildNumber,
        appUpdateResult,
        isCheckingAppUpdate,
        updateDownloadState,
        isUpdateBannerDismissed,
        checkForUpdatesNow,
        startInAppUpdate,
        openUnknownSourcesAndAwaitReturn,
        retryInstallPendingApk,
        dismissUpdateBanner,
        resetUpdateDownloadState,
      }}
    >
      {children}

      {/* Global Confirmation Modal */}
      {confirmConfig.isOpen && (
        <div
          onClick={(e) => {
            if (e.target === e.currentTarget && !confirmConfig.isProcessing) {
              hapticSelection();
              setConfirmConfig((prev) => ({ ...prev, isOpen: false }));
            }
          }}
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/60 backdrop-blur-xs animate-backdrop-in keyboard-modal-backdrop"
        >
          <div className="w-full sm:max-w-md bg-white dark:bg-zinc-900 border-t sm:border border-zinc-200 dark:border-zinc-800 rounded-t-3xl sm:rounded-3xl shadow-2xl p-5 sm:p-6 pb-[max(1.25rem,env(safe-area-inset-bottom,0px))] sm:pb-6 keyboard-modal-sheet overflow-y-auto relative animate-bottom-sheet">
            <div className="sm:hidden w-10 h-1 rounded-full bg-zinc-300 dark:bg-zinc-700 mx-auto mb-3 shrink-0" />
            <h3 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
              {confirmConfig.title}
            </h3>
            <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
              {confirmConfig.message}
            </p>
            {confirmConfig.details && confirmConfig.details.length > 0 && (
              <div className="mt-3 p-3 bg-zinc-50 dark:bg-zinc-800/60 rounded-xl text-xs text-zinc-600 dark:text-zinc-400 space-y-1">
                {confirmConfig.details.map((d, i) => (
                  <div key={i}>• {d}</div>
                ))}
              </div>
            )}
            <div className="mt-6 flex justify-end gap-3 pt-3 border-t border-zinc-100 dark:border-zinc-800">
              <button
                type="button"
                onClick={() => {
                  hapticSelection();
                  setConfirmConfig((prev) => ({ ...prev, isOpen: false }));
                }}
                disabled={confirmConfig.isProcessing}
                className="pressable min-h-[40px] px-4 py-2 rounded-xl text-sm font-medium text-zinc-700 dark:text-zinc-300 bg-zinc-100 hover:bg-zinc-200 dark:bg-zinc-800 dark:hover:bg-zinc-700 cursor-pointer"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={confirmConfig.onConfirm}
                disabled={confirmConfig.isProcessing}
                className={`pressable min-h-[40px] px-4 py-2 rounded-xl text-sm font-medium text-white shadow-xs cursor-pointer ${
                  confirmConfig.isDestructive
                    ? 'bg-rose-600 hover:bg-rose-700'
                    : 'bg-indigo-600 hover:bg-indigo-700'
                } ${confirmConfig.isProcessing ? 'opacity-70 cursor-not-allowed' : ''}`}
              >
                {confirmConfig.isProcessing ? 'Processando...' : confirmConfig.confirmText || 'Confirmar'}
              </button>
            </div>
          </div>
        </div>
      )}
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
