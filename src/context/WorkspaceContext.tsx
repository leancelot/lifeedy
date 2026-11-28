import { createContext, useContext } from 'react';
import {
  AndroidPermissionsStatus,
  AndroidPermissionTarget,
} from '../services/appHealthBridge';
import { PortableBackupHealth } from '../services/backupShareAndAudit';
import { UpdateCheckResult } from '../services/githubUpdateService';
import { AppDataPayload } from '../types';
import { BackupCountsSummary } from '../utils/backupSummary';
import { AppUpdateDownloadState } from './hooks/useAppUpdater';
import { ConfirmActionInput } from './hooks/useConfirmDialog';
import { UndoToastInfo } from './hooks/useUndoToast';

export interface BackupInspectionResult {
  format: 'encrypted' | 'legacy_json' | 'invalid';
  exportedAt: string | null;
  summary?: BackupCountsSummary;
  error?: string;
}

export interface AutoBackupFolderStatusState {
  supported: boolean;
  configured: boolean;
  accessible: boolean;
  folderName: string | null;
  hasPassphrase: boolean;
  enabled: boolean;
  lastSyncedAt: number | null;
  lastFileName: string | null;
  isSyncing: boolean;
  lastError: string | null;
}

export interface WorkspaceContextType {
  theme: 'light' | 'dark';
  toggleTheme: () => void;
  setThemeMode: (mode: 'light' | 'dark') => void;

  userName: string;
  setUserName: (name: string) => void;
  onboardingCompleted: boolean;
  completeOnboarding: (name: string) => void;

  isStartFromScratchOpen: boolean;
  openStartFromScratchModal: () => void;
  closeStartFromScratchModal: () => void;
  resetWorkspaceToZero: () => Promise<void>;

  exportEncryptedBackup: (
    password: string,
    options?: { share?: boolean }
  ) => Promise<'native_share' | 'web_share' | 'download'>;
  exportBackupJson: (options?: { share?: boolean }) => Promise<void>;
  inspectBackupBeforeImport: (rawText: string) => BackupInspectionResult;
  importBackupFromText: (
    rawText: string,
    password?: string
  ) => Promise<{ ok: boolean; summary?: BackupCountsSummary; error?: string; payload?: Partial<AppDataPayload> }>;
  importBackupJson: (content: string) => boolean;

  lastPortableBackupAt: string | null;
  backupHealth: PortableBackupHealth;
  dismissBackupReminder: () => void;
  autoBackupStatus: AutoBackupFolderStatusState;
  refreshAutoBackupStatus: () => Promise<void>;
  selectAutoBackupFolder: () => Promise<boolean>;
  configureAutoBackupPassphrase: (passphrase: string) => Promise<void>;
  toggleAutoBackupEnabled: (enabled: boolean) => void;
  disconnectAutoBackupFolder: () => Promise<void>;
  runAutoFolderBackupNow: () => Promise<{ ok: boolean; error?: string }>;

  undoToast: UndoToastInfo | null;
  clearUndoToast: () => void;
  confirmDestructiveAction: (config: ConfirmActionInput) => void;

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
}

export const WorkspaceContext = createContext<WorkspaceContextType | null>(null);

export const useWorkspace = (): WorkspaceContextType => {
  const ctx = useContext(WorkspaceContext);
  if (!ctx) {
    throw new Error('useWorkspace must be used within an AppProvider');
  }
  return ctx;
};
