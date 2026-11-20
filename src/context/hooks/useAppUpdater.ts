import { useCallback, useEffect, useRef, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import { App as CapApp } from '@capacitor/app';
import { Browser } from '@capacitor/browser';
import {
  addUpdateProgressListener,
  canRequestPackageInstalls,
  clearPendingApk,
  downloadAndInstallApk,
  getInstalledAppInfo,
  installPendingApk,
  isNativeSelfUpdateSupported,
  openInstallUnknownAppsSettings,
} from '../../services/appUpdaterBridge';
import { recordAppError } from '../../services/errorJournalService';
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
} from '../../services/githubUpdateService';
import { hapticImpactLight, hapticSelection, hapticSuccess } from '../../services/hapticsService';
import { checkNativeNotificationPermission } from '../../services/notificationService';

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

const IDLE_DOWNLOAD_STATE: AppUpdateDownloadState = {
  status: 'idle',
  progress: 0,
  downloadedBytes: 0,
  totalBytes: 0,
};

interface UseAppUpdaterOptions {
  refreshAndroidPermissions: () => Promise<unknown>;
  onSyncNativeNotificationPerm: (perm: NotificationPermission) => void;
}

/**
 * Gerencia verificação de novas versões no GitHub, download de APK direto
 * e instalação automática dentro do Android (sem depender da Play Store).
 */
export function useAppUpdater({
  refreshAndroidPermissions,
  onSyncNativeNotificationPerm,
}: UseAppUpdaterOptions) {
  const distributionChannel: 'githubApk' | 'web' = Capacitor.isNativePlatform()
    ? 'githubApk'
    : 'web';

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
  const [updateDownloadState, setUpdateDownloadState] =
    useState<AppUpdateDownloadState>(IDLE_DOWNLOAD_STATE);

  const updateStateStatusRef = useRef(updateDownloadState.status);
  updateStateStatusRef.current = updateDownloadState.status;

  const openExternalSafely = useCallback((url: string) => {
    if (typeof document === 'undefined') return;
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.target = '_blank';
    anchor.rel = 'noopener noreferrer';
    anchor.click();
  }, []);

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

        if (
          result.hasUpdate &&
          result.latestVersion &&
          result.latestVersion !== getDismissedUpdateVersion()
        ) {
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
        setUpdateDownloadState(IDLE_DOWNLOAD_STATE);
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
      if (
        target.kind === 'actions_artifact_zip' &&
        appUpdateResult?.latestBuild?.artifactId &&
        cfg.token
      ) {
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
          setUpdateDownloadState(IDLE_DOWNLOAD_STATE);
        } catch (err: any) {
          recordAppError('updater.artifactDownload', err);
          setUpdateDownloadState({
            ...IDLE_DOWNLOAD_STATE,
            status: 'error',
            error: err?.message || 'Não foi possível baixar o pacote.',
          });
        }
      } else {
        try {
          await Browser.open({ url: target.url });
        } catch {
          openExternalSafely(target.url);
        }
      }
      return;
    }

    if (target.kind === 'external_page') {
      try {
        await Browser.open({ url: target.url });
      } catch {
        openExternalSafely(target.url);
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
        expectedSha256: target.expectedSha256,
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
      recordAppError('updater.nativeInstall', err);
      setUpdateDownloadState({
        ...IDLE_DOWNLOAD_STATE,
        status: 'error',
        error: err?.message || 'Não foi possível baixar a atualização.',
      });
    }
  }, [appUpdateResult, openExternalSafely]);

  const dismissUpdateBanner = useCallback(() => {
    hapticSelection();
    const version = appUpdateResult?.latestVersion || '';
    if (version) {
      dismissUpdateVersion(version);
      setDismissedUpdateVer(version);
    }
    setUpdateDownloadState(IDLE_DOWNLOAD_STATE);
  }, [appUpdateResult]);

  const resetUpdateDownloadState = useCallback(() => {
    setUpdateDownloadState(IDLE_DOWNLOAD_STATE);
  }, []);

  const isUpdateBannerDismissed = Boolean(
    appUpdateResult?.latestVersion && dismissedUpdateVer === appUpdateResult.latestVersion
  );

  // Lê versão instalada, limpa cache antigo pós-atualização e escuta progresso nativo
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

          const cached = getStoredGitHubConfig().lastResult;
          if (cached?.hasUpdate && cached.latestVersion) {
            const cachedBuild =
              parseSemVer(cached.latestVersion)[3] || cached.latestBuild?.runNumber || 0;
            if (cachedBuild > 0 && cachedBuild <= effectiveBuild) {
              setAppUpdateResult(null);
            }
          }
        }

        await refreshAndroidPermissions();

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
          void refreshAndroidPermissions();
          checkNativeNotificationPermission()
            .then((perm) => {
              if (!cancelled) onSyncNativeNotificationPerm(perm);
            })
            .catch(() => {});

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
  }, [
    checkForUpdatesNow,
    onSyncNativeNotificationPerm,
    refreshAndroidPermissions,
    retryInstallPendingApk,
  ]);

  return {
    installedAppVersion,
    installedBuildNumber,
    distributionChannel,
    appUpdateResult,
    setAppUpdateResult,
    isCheckingAppUpdate,
    updateDownloadState,
    isUpdateBannerDismissed,
    checkForUpdatesNow,
    startInAppUpdate,
    openUnknownSourcesAndAwaitReturn,
    retryInstallPendingApk,
    dismissUpdateBanner,
    resetUpdateDownloadState,
  };
}
