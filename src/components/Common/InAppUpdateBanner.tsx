import React from 'react';
import {
  AlertCircle,
  CheckCircle2,
  Download,
  ExternalLink,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  X,
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { isNativeSelfUpdateSupported } from '../../services/appUpdaterBridge';
import {
  getStoredGitHubConfig,
  refreshAppCache,
  resolveInstallableUpdateTarget,
} from '../../services/githubUpdateService';

const formatBytes = (bytes: number): string => {
  if (!bytes || bytes <= 0) return '';
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

export const InAppUpdateBanner: React.FC = () => {
  const {
    appUpdateResult,
    installedAppVersion,
    installedBuildNumber,
    distributionChannel,
    updateDownloadState,
    isUpdateBannerDismissed,
    startInAppUpdate,
    openPlayStoreUpdate,
    openUnknownSourcesAndAwaitReturn,
    retryInstallPendingApk,
    dismissUpdateBanner,
    resetUpdateDownloadState,
  } = useApp();

  const nativeAndroid = isNativeSelfUpdateSupported();
  const isPlayStoreBuild = distributionChannel === 'playStore';
  const isFlowActive = updateDownloadState.status !== 'idle';
  const hasVisibleUpdate = Boolean(appUpdateResult?.hasUpdate && !isUpdateBannerDismissed);

  if (!hasVisibleUpdate && !isFlowActive) {
    return null;
  }

  const cfg = getStoredGitHubConfig();
  const target = resolveInstallableUpdateTarget(appUpdateResult, cfg.token);
  const canDirectSelfInstall =
    nativeAndroid &&
    !isPlayStoreBuild &&
    Boolean(target && (target.kind === 'release_apk' || target.kind === 'actions_artifact_zip'));

  const isBusy =
    updateDownloadState.status === 'downloading' ||
    updateDownloadState.status === 'extracting' ||
    updateDownloadState.status === 'verifying';

  const latestSummary =
    appUpdateResult?.recentCommits?.[0]?.message ||
    appUpdateResult?.latestRelease?.name ||
    'Melhorias e correções prontas para atualizar sem perder seus dados.';

  const sizeLabel = target?.size ? formatBytes(target.size) : '';

  return (
    <div className="mb-4 p-3.5 sm:p-4 rounded-2xl bg-white dark:bg-zinc-900 border border-indigo-200 dark:border-indigo-800/80 shadow-xs space-y-3 animate-tab-enter">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-2.5 min-w-0">
          <div className="w-9 h-9 rounded-xl bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-400 flex items-center justify-center shrink-0">
            <Sparkles className="w-4 h-4" />
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
              <h3 className="text-xs sm:text-sm font-bold text-zinc-900 dark:text-zinc-100">
                Nova versão disponível: {appUpdateResult?.latestVersion || 'Atualização'}
              </h3>
              <span className="text-[11px] font-mono tabular-nums text-zinc-400">
                Atual: {installedAppVersion}
                {installedBuildNumber > 0 ? ` · #${installedBuildNumber}` : ''}
              </span>
            </div>
            <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5 line-clamp-2">
              {latestSummary}
            </p>
          </div>
        </div>

        {!isBusy && (
          <button
            type="button"
            onClick={() => {
              if (isFlowActive) {
                resetUpdateDownloadState();
              }
              dismissUpdateBanner();
            }}
            aria-label="Dispensar aviso de atualização"
            className="pressable w-8 h-8 rounded-lg text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 flex items-center justify-center shrink-0 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* Download / Extraction / Verification Progress */}
      {isBusy && (
        <div className="space-y-1.5">
          <div className="flex items-center justify-between text-[11px] font-mono tabular-nums text-zinc-600 dark:text-zinc-300">
            <span>
              {updateDownloadState.status === 'extracting'
                ? 'Extraindo APK...'
                : updateDownloadState.status === 'verifying'
                ? 'Validando assinatura e SHA-256...'
                : 'Baixando atualização...'}
            </span>
            <span>
              {updateDownloadState.progress}%
              {updateDownloadState.downloadedBytes > 0
                ? ` · ${formatBytes(updateDownloadState.downloadedBytes)}${
                    updateDownloadState.totalBytes > 0
                      ? ` / ${formatBytes(updateDownloadState.totalBytes)}`
                      : ''
                  }`
                : ''}
            </span>
          </div>
          <div className="w-full h-2 rounded-full bg-zinc-100 dark:bg-zinc-800 overflow-hidden">
            <div
              className="h-full bg-indigo-600 rounded-full transition-all duration-150"
              style={{ width: `${Math.max(4, Math.min(100, updateDownloadState.progress))}%` }}
            />
          </div>
        </div>
      )}

      {/* Unknown sources permission prompt */}
      {updateDownloadState.status === 'permission_required' && !isPlayStoreBuild && (
        <div className="p-3 rounded-xl bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900/60 space-y-2.5">
          <div className="flex items-start gap-2 text-xs text-amber-800 dark:text-amber-200">
            <ShieldCheck className="w-4 h-4 shrink-0 mt-0.5" />
            <span>
              Para instalar atualizações sem sair do app, autorize o Lifeedy a instalar pacotes no Android. Ao voltar, a instalação abrirá automaticamente.
            </span>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void openUnknownSourcesAndAwaitReturn()}
              className="pressable min-h-[38px] px-3.5 rounded-xl bg-amber-600 hover:bg-amber-700 text-white text-xs font-semibold cursor-pointer"
            >
              Permitir instalação
            </button>
            <button
              type="button"
              onClick={() => void retryInstallPendingApk()}
              className="pressable min-h-[38px] px-3.5 rounded-xl border border-amber-300 dark:border-amber-800 text-amber-800 dark:text-amber-200 text-xs font-semibold cursor-pointer"
            >
              Já permiti, instalar
            </button>
          </div>
        </div>
      )}

      {/* Installer launched feedback */}
      {updateDownloadState.status === 'installer_launched' && (
        <div className="p-3 rounded-xl bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-900/60 flex flex-wrap items-center justify-between gap-2">
          <span className="flex items-center gap-2 text-xs font-medium text-emerald-800 dark:text-emerald-200">
            <CheckCircle2 className="w-4 h-4 shrink-0" />
            Instalador do Android aberto. Confirme em &ldquo;Atualizar&rdquo; — seus dados serão mantidos.
          </span>
          <button
            type="button"
            onClick={() => void retryInstallPendingApk()}
            className="pressable min-h-[34px] px-3 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold cursor-pointer"
          >
            Abrir novamente
          </button>
        </div>
      )}

      {/* Error state */}
      {updateDownloadState.status === 'error' && updateDownloadState.error && (
        <div className="p-3 rounded-xl bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-900/60 flex items-start gap-2 text-xs text-rose-700 dark:text-rose-300">
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
          <span>{updateDownloadState.error}</span>
        </div>
      )}

      {/* Action Buttons when idle or error */}
      {!isBusy &&
        updateDownloadState.status !== 'permission_required' &&
        updateDownloadState.status !== 'installer_launched' && (
          <div className="flex flex-wrap items-center gap-2">
            {isPlayStoreBuild ? (
              <button
                type="button"
                onClick={() => void openPlayStoreUpdate()}
                className="pressable min-h-[40px] px-4 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer"
              >
                <ExternalLink className="w-3.5 h-3.5" />
                <span>Atualizar na Play Store</span>
              </button>
            ) : canDirectSelfInstall ? (
              <button
                type="button"
                onClick={() => void startInAppUpdate()}
                className="pressable min-h-[40px] px-4 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer"
              >
                <Download className="w-3.5 h-3.5" />
                <span>
                  Atualizar agora{sizeLabel ? ` (${sizeLabel})` : ''}
                </span>
              </button>
            ) : nativeAndroid && target ? (
              <button
                type="button"
                onClick={() => void startInAppUpdate()}
                className="pressable min-h-[40px] px-4 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer"
              >
                <Download className="w-3.5 h-3.5" />
                <span>Abrir página do APK</span>
              </button>
            ) : (
              <>
                <button
                  type="button"
                  onClick={() => void refreshAppCache()}
                  className="pressable min-h-[40px] px-4 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  <span>Recarregar nova versão</span>
                </button>
                {target && (
                  <button
                    type="button"
                    onClick={() => void startInAppUpdate()}
                    className="pressable min-h-[40px] px-3.5 rounded-xl border border-zinc-200 dark:border-zinc-700 text-zinc-700 dark:text-zinc-200 text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>Baixar APK{sizeLabel ? ` (${sizeLabel})` : ''}</span>
                  </button>
                )}
              </>
            )}
          </div>
        )}
    </div>
  );
};
