import React, { useEffect, useRef, useState } from 'react';
import {
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  CloudCheck,
  CloudDownload,
  CloudOff,
  CloudUpload,
  Cpu,
  Download,
  ExternalLink,
  Fingerprint,
  GitBranch,
  GitCommit,
  Key,
  LogOut,
  Moon,
  Package,
  RefreshCw,
  RotateCcw,
  Settings,
  Shield,
  ShieldCheck,
  SlidersHorizontal,
  Smartphone,
  Sparkles,
  Sun,
  Upload,
  User as UserIcon,
  X,
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { useBackHandler } from '../../context/BackNavigationContext';
import {
  authenticateFinanceAccess,
  checkBiometricAvailability,
  isBiometricSupportedOnPlatform,
} from '../../services/biometricLockBridge';
import { isNativeSelfUpdateSupported } from '../../services/appUpdaterBridge';
import {
  DEFAULT_GITHUB_REPO,
  getStoredGitHubConfig,
  refreshAppCache,
  resolveInstallableUpdateTarget,
  saveGitHubConfig,
} from '../../services/githubUpdateService';
import { hapticImpactLight, hapticSelection, hapticSuccess } from '../../services/hapticsService';
import { isFirebaseConfigured } from '../../services/firebase';
import { validateGitHubRepoSlug } from '../../utils/runtimeValidator';
import { DiagnosticsAndPermissionsSection } from './DiagnosticsAndPermissionsSection';

interface AccountSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

type SettingsCategoryTab = 'general' | 'account' | 'security' | 'system';

const CATEGORY_TABS: Array<{
  id: SettingsCategoryTab;
  label: string;
  Icon: React.FC<{ className?: string }>;
}> = [
  { id: 'general', label: 'Geral', Icon: SlidersHorizontal },
  { id: 'account', label: 'Conta', Icon: CloudCheck },
  { id: 'security', label: 'Segurança', Icon: Shield },
  { id: 'system', label: 'Sistema', Icon: Cpu },
];

export const AccountSettingsModal: React.FC<AccountSettingsModalProps> = ({
  isOpen,
  onClose,
}) => {
  const {
    theme,
    toggleTheme,
    userName,
    setUserName,
    user,
    workspaceAuthStatus,
    isAuthenticating,
    signInWithGoogle,
    signOut,
    driveSyncInfo,
    syncToDriveNow,
    restoreFromDriveNow,
    tasks,
    transactions,
    financialGoals,
    draftNotes,
    exportBackupJson,
    importBackupJson,
    confirmDestructiveAction,
    bankListenerSupported,
    bankListenerPermission,
    refreshBankListenerPermission,
    openBankListenerSettings,
    financeLockEnabled,
    setFinanceLockEnabled,
    openStartFromScratchModal,
    installedAppVersion,
    installedBuildNumber,
    distributionChannel,
    appUpdateResult,
    isCheckingAppUpdate,
    updateDownloadState,
    checkForUpdatesNow,
    startInAppUpdate,
    openPlayStoreUpdate,
    openUnknownSourcesAndAwaitReturn,
    retryInstallPendingApk,
  } = useApp();

  const [activeTab, setActiveTab] = useState<SettingsCategoryTab>('general');
  const [isSyncingAction, setIsSyncingAction] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Profile name editor
  const [nameDraft, setNameDraft] = useState(userName || '');
  const [nameSavedFeedback, setNameSavedFeedback] = useState(false);

  // Biometric lock state
  const biometricPlatformSupported = isBiometricSupportedOnPlatform();
  const [biometricAvailable, setBiometricAvailable] = useState(false);
  const [biometricMessage, setBiometricMessage] = useState<string | null>(null);
  const [isCheckingBiometric, setIsCheckingBiometric] = useState(false);

  // Updates & GitHub repo config
  const [showRepoConfig, setShowRepoConfig] = useState(false);
  const [isRefreshingCache, setIsRefreshingCache] = useState(false);
  const [githubRepo, setGithubRepo] = useState<string>(() => getStoredGitHubConfig().repo);
  const [githubToken, setGithubToken] = useState<string>(() => getStoredGitHubConfig().token);
  const [autoCheckUpdates, setAutoCheckUpdates] = useState<boolean>(
    () => getStoredGitHubConfig().autoCheck
  );

  useBackHandler(isOpen, () => {
    if (isSyncingAction) return false;
    onClose();
    return true;
  });

  useEffect(() => {
    setNameDraft(userName || '');
  }, [userName]);

  useEffect(() => {
    if (!isOpen) return;
    setFeedback(null);

    const config = getStoredGitHubConfig();
    setGithubRepo(config.repo);
    setGithubToken(config.token);
    setAutoCheckUpdates(config.autoCheck);

    if (biometricPlatformSupported) {
      checkBiometricAvailability()
        .then((res) => setBiometricAvailable(res.available))
        .catch(() => setBiometricAvailable(false));
    }
  }, [isOpen, biometricPlatformSupported]);

  if (!isOpen) return null;

  const showTempFeedback = (type: 'success' | 'error', text: string) => {
    setFeedback({ type, text });
    setTimeout(() => {
      setFeedback((curr) => (curr?.text === text ? null : curr));
    }, 4500);
  };

  const handleManualSave = async () => {
    setIsSyncingAction(true);
    setFeedback(null);
    try {
      await syncToDriveNow();
      hapticSuccess();
      showTempFeedback('success', 'Dados salvos com sucesso no Google Drive.');
    } catch (err: any) {
      showTempFeedback('error', err?.message || 'Falha ao salvar no Google Drive.');
    } finally {
      setIsSyncingAction(false);
    }
  };

  const handleManualRestore = () => {
    confirmDestructiveAction({
      title: 'Restaurar Dados do Google Drive?',
      message:
        'Esta ação substituirá suas tarefas, agenda, rascunhos e finanças locais pelos dados armazenados no Google Drive.',
      details: [
        'Arquivo na nuvem: Lifeedy_Data.json (compatível com VidaOrganizada_Data.json)',
        driveSyncInfo.remoteModifiedAt
          ? `Última modificação na nuvem: ${new Date(driveSyncInfo.remoteModifiedAt).toLocaleString('pt-BR')}`
          : 'Verificando versão mais recente...',
      ],
      confirmText: 'Restaurar do Drive',
      isDestructive: false,
      onConfirm: async () => {
        setIsSyncingAction(true);
        setFeedback(null);
        try {
          await restoreFromDriveNow();
          hapticSuccess();
          showTempFeedback('success', 'Dados restaurados com sucesso do Google Drive.');
        } catch (err: any) {
          showTempFeedback('error', err?.message || 'Falha ao restaurar dados do Drive.');
        } finally {
          setIsSyncingAction(false);
        }
      },
    });
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const content = event.target?.result as string;
      if (content) {
        confirmDestructiveAction({
          title: 'Importar Arquivo de Backup?',
          message:
            'Os dados locais atuais serão substituídos pelo conteúdo do arquivo JSON selecionado.',
          details: [`Arquivo: ${file.name}`, `Tamanho: ${(file.size / 1024).toFixed(1)} KB`],
          confirmText: 'Importar Backup',
          isDestructive: false,
          onConfirm: () => {
            const success = importBackupJson(content);
            if (success) {
              hapticSuccess();
              showTempFeedback('success', 'Backup JSON importado com sucesso.');
            } else {
              showTempFeedback('error', 'O arquivo de backup é inválido ou está corrompido.');
            }
          },
        });
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  const handleSaveName = (e: React.FormEvent) => {
    e.preventDefault();
    if (!nameDraft.trim()) return;
    setUserName(nameDraft.trim());
    hapticSuccess();
    setNameSavedFeedback(true);
    setTimeout(() => setNameSavedFeedback(false), 2200);
  };

  const handleToggleFinanceLock = async () => {
    setBiometricMessage(null);
    if (!biometricPlatformSupported) {
      setBiometricMessage('Disponível apenas no aplicativo Android instalado (APK).');
      return;
    }

    if (financeLockEnabled) {
      hapticImpactLight();
      setFinanceLockEnabled(false);
      setBiometricMessage('Proteção biométrica desativada.');
      return;
    }

    setIsCheckingBiometric(true);
    try {
      const avail = await checkBiometricAvailability();
      setBiometricAvailable(avail.available);
      if (!avail.available) {
        setBiometricMessage('Configure digital, rosto ou PIN nas configurações do Android primeiro.');
        return;
      }

      const authRes = await authenticateFinanceAccess(
        'Ativar Proteção em Finanças',
        'Confirme sua identidade para proteger seus dados financeiros'
      );
      if (authRes.authenticated) {
        hapticSuccess();
        setFinanceLockEnabled(true);
        setBiometricMessage('Proteção ativada para a aba Finanças.');
      } else {
        setBiometricMessage(authRes.message || 'Autenticação cancelada.');
      }
    } finally {
      setIsCheckingBiometric(false);
    }
  };

  const handleCheckUpdates = async (repoOverride?: string, tokenOverride?: string) => {
    const targetRepo = (repoOverride ?? githubRepo).trim() || DEFAULT_GITHUB_REPO;
    const targetToken = (tokenOverride ?? githubToken).trim();
    const result = await checkForUpdatesNow({
      repo: targetRepo,
      token: targetToken || undefined,
      force: true,
    });
    if (result?.error) setShowRepoConfig(true);
  };

  const handleSaveGitHubConfigAndCheck = async (e: React.FormEvent) => {
    e.preventDefault();
    hapticImpactLight();
    const cleanCandidate = githubRepo.trim() || DEFAULT_GITHUB_REPO;
    const repoCheck = validateGitHubRepoSlug(cleanCandidate);
    if (!repoCheck.ok || !repoCheck.data) {
      showTempFeedback('error', repoCheck.error || 'Repositório GitHub inválido.');
      return;
    }
    saveGitHubConfig(repoCheck.data, githubToken, autoCheckUpdates);
    const updated = getStoredGitHubConfig();
    setGithubRepo(updated.repo);
    await handleCheckUpdates(updated.repo, updated.token);
  };

  const handleHardRefresh = () => {
    confirmDestructiveAction({
      title: 'Recarregar aplicativo?',
      message: 'Deseja recarregar o aplicativo para buscar as últimas atualizações salvas?',
      confirmText: 'Recarregar',
      isDestructive: false,
      onConfirm: async () => {
        setIsRefreshingCache(true);
        await refreshAppCache();
      },
    });
  };

  const formatFileSize = (bytes: number) =>
    bytes < 1024 * 1024
      ? `${(bytes / 1024).toFixed(1)} KB`
      : `${(bytes / (1024 * 1024)).toFixed(1)} MB`;

  const nativeSelfUpdate = isNativeSelfUpdateSupported();
  const installTarget = resolveInstallableUpdateTarget(appUpdateResult, githubToken);
  const isDownloadingNow =
    updateDownloadState.status === 'downloading' ||
    updateDownloadState.status === 'extracting' ||
    updateDownloadState.status === 'verifying';

  return (
    <div
      onClick={(e) => {
        if (e.target === e.currentTarget && !isSyncingAction) {
          hapticSelection();
          onClose();
        }
      }}
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/60 backdrop-blur-xs animate-backdrop-in keyboard-modal-backdrop"
    >
      <div className="w-full sm:max-w-xl max-h-[90dvh] flex flex-col bg-white dark:bg-zinc-900 border-t sm:border border-zinc-200 dark:border-zinc-800 rounded-t-3xl sm:rounded-3xl shadow-2xl overflow-hidden relative animate-bottom-sheet">
        {/* Pinned Header + Category Navigation */}
        <div className="px-5 sm:px-6 pt-3 sm:pt-5 pb-3.5 border-b border-zinc-100 dark:border-zinc-800 shrink-0 space-y-3.5 bg-white dark:bg-zinc-900">
          <div className="sm:hidden w-10 h-1 rounded-full bg-zinc-300 dark:bg-zinc-700 mx-auto" />

          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-10 h-10 rounded-2xl bg-indigo-50 dark:bg-indigo-950/50 text-indigo-600 dark:text-indigo-400 flex items-center justify-center shrink-0">
                {user?.photoURL ? (
                  <img
                    src={user.photoURL}
                    alt={user.displayName || 'Conta'}
                    referrerPolicy="no-referrer"
                    className="w-full h-full rounded-2xl object-cover"
                  />
                ) : (
                  <UserIcon className="w-5 h-5" />
                )}
              </div>
              <div className="min-w-0">
                <h3 className="text-base sm:text-lg font-bold text-zinc-900 dark:text-zinc-100 truncate">
                  Configurações
                </h3>
                <p className="text-xs text-zinc-500 dark:text-zinc-400 truncate">
                  {user ? user.email || user.displayName : userName || 'Preferências, dados e sistema'}
                </p>
              </div>
            </div>

            <button
              type="button"
              onClick={() => {
                hapticSelection();
                onClose();
              }}
              className="pressable w-10 h-10 rounded-full text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 flex items-center justify-center cursor-pointer shrink-0"
              aria-label="Fechar"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* 4-Category Segmented Control */}
          <div
            role="tablist"
            aria-label="Categorias de configurações"
            className="grid grid-cols-4 gap-1 p-1 rounded-xl bg-zinc-100 dark:bg-zinc-800/80"
          >
            {CATEGORY_TABS.map(({ id, label, Icon }) => {
              const isActive = activeTab === id;
              const hasUpdateDot = id === 'system' && Boolean(appUpdateResult?.hasUpdate);
              return (
                <button
                  key={id}
                  role="tab"
                  aria-selected={isActive}
                  type="button"
                  onClick={() => {
                    hapticSelection();
                    setActiveTab(id);
                  }}
                  className={`relative min-h-[40px] px-2 rounded-lg text-xs font-semibold inline-flex items-center justify-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                    isActive
                      ? 'bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 shadow-xs'
                      : 'text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200'
                  }`}
                >
                  <Icon className={`w-3.5 h-3.5 shrink-0 ${isActive ? 'text-indigo-600 dark:text-indigo-400' : ''}`} />
                  <span>{label}</span>
                  {hasUpdateDot && (
                    <span
                      aria-label="Atualização disponível"
                      className="w-1.5 h-1.5 rounded-full bg-indigo-500 shrink-0"
                    />
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {/* Scrollable Category Content */}
        <div className="flex-1 overflow-y-auto px-5 sm:px-6 py-4 pb-[max(1.25rem,env(safe-area-inset-bottom,0px))] sm:pb-6 space-y-5 keyboard-modal-sheet">
          {feedback && (
            <div
              className={`p-3 rounded-2xl border flex items-center gap-2 text-xs font-medium ${
                feedback.type === 'success'
                  ? 'bg-emerald-50 dark:bg-emerald-950/40 border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-emerald-300'
                  : 'bg-rose-50 dark:bg-rose-950/40 border-rose-200 dark:border-rose-800 text-rose-800 dark:text-rose-300'
              }`}
            >
              {feedback.type === 'success' ? (
                <CheckCircle2 className="w-4 h-4 shrink-0" />
              ) : (
                <AlertCircle className="w-4 h-4 shrink-0" />
              )}
              <span>{feedback.text}</span>
            </div>
          )}

          {/* TAB 1: GERAL (Perfil, Aparência & Reinício) */}
          {activeTab === 'general' && (
            <div role="tabpanel" className="space-y-5">
              <section className="space-y-2.5">
                <span className="text-xs font-semibold text-zinc-500 dark:text-zinc-400 block">
                  Perfil de exibição
                </span>
                <form onSubmit={handleSaveName} className="flex gap-2">
                  <input
                    type="text"
                    required
                    value={nameDraft}
                    onChange={(e) => setNameDraft(e.target.value)}
                    placeholder="Seu nome"
                    className="flex-1 h-11 px-3.5 text-sm rounded-xl bg-zinc-50 dark:bg-zinc-800/70 border border-zinc-200 dark:border-zinc-700 text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-indigo-500/30"
                  />
                  <button
                    type="submit"
                    disabled={!nameDraft.trim()}
                    className="pressable h-11 px-4 rounded-xl bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 text-white text-xs font-semibold cursor-pointer shrink-0 whitespace-nowrap"
                  >
                    {nameSavedFeedback ? 'Salvo!' : 'Salvar nome'}
                  </button>
                </form>
              </section>

              <section className="space-y-2.5">
                <span className="text-xs font-semibold text-zinc-500 dark:text-zinc-400 block">
                  Aparência do aplicativo
                </span>
                <div className="p-3.5 rounded-2xl border border-zinc-200/80 dark:border-zinc-800 flex items-center justify-between gap-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-9 h-9 rounded-xl bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center shrink-0">
                      {theme === 'dark' ? (
                        <Moon className="w-4 h-4 text-indigo-400" />
                      ) : (
                        <Sun className="w-4 h-4 text-amber-500" />
                      )}
                    </div>
                    <div className="min-w-0">
                      <span className="text-xs font-bold text-zinc-900 dark:text-zinc-100 block">
                        Tema atual
                      </span>
                      <span className="text-[11px] text-zinc-500 dark:text-zinc-400">
                        {theme === 'dark' ? 'Modo Escuro' : 'Modo Claro'}
                      </span>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      hapticImpactLight();
                      toggleTheme();
                    }}
                    className="pressable min-h-[40px] px-4 rounded-xl border border-zinc-200 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-800 text-xs font-semibold text-zinc-700 dark:text-zinc-200 cursor-pointer shrink-0 whitespace-nowrap"
                  >
                    Alternar tema
                  </button>
                </div>
              </section>

              <section className="pt-4 border-t border-zinc-100 dark:border-zinc-800 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <span className="text-xs font-bold text-zinc-900 dark:text-zinc-100 block">
                    Reiniciar dados locais
                  </span>
                  <span className="text-[11px] text-zinc-500 dark:text-zinc-400 block">
                    Limpa este dispositivo com confirmação prévia
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    hapticSelection();
                    onClose();
                    openStartFromScratchModal();
                  }}
                  className="pressable min-h-[40px] px-3.5 rounded-xl border border-rose-200 dark:border-rose-900/60 text-xs font-semibold text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/30 inline-flex items-center gap-1.5 cursor-pointer shrink-0 whitespace-nowrap"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  <span>Recomeçar do zero</span>
                </button>
              </section>
            </div>
          )}

          {/* TAB 2: CONTA & DADOS (Google Drive, Backup JSON & Cofre) */}
          {activeTab === 'account' && (
            <div role="tabpanel" className="space-y-5">
              <section className="space-y-2.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-semibold text-zinc-500 dark:text-zinc-400">
                    Conta Google & Drive
                  </span>
                  <span
                    className={`inline-flex items-center gap-1 text-xs font-medium ${
                      user ? 'text-emerald-600 dark:text-emerald-400' : 'text-zinc-500 dark:text-zinc-400'
                    }`}
                  >
                    {user ? <CloudCheck className="w-3.5 h-3.5" /> : <CloudOff className="w-3.5 h-3.5" />}
                    <span>{user ? 'Conectada' : 'Offline'}</span>
                  </span>
                </div>

                {user ? (
                  <div className="p-3.5 rounded-2xl border border-zinc-200/80 dark:border-zinc-800 space-y-3">
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-sm font-bold text-zinc-900 dark:text-zinc-100 truncate">
                          {user.displayName || 'Conta Google'}
                        </p>
                        <p className="text-xs text-zinc-500 truncate">{user.email}</p>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          hapticSelection();
                          void signOut();
                          onClose();
                        }}
                        className="pressable min-h-[40px] px-3 rounded-xl border border-zinc-200 dark:border-zinc-700 text-xs font-semibold text-zinc-600 dark:text-zinc-300 hover:text-rose-600 dark:hover:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/30 inline-flex items-center gap-1.5 cursor-pointer shrink-0"
                      >
                        <LogOut className="w-3.5 h-3.5" />
                        <span>Sair</span>
                      </button>
                    </div>

                    {workspaceAuthStatus === 'needs_reauth' && (
                      <div className="p-2.5 rounded-xl bg-amber-50 dark:bg-amber-950/30 border border-amber-200/80 dark:border-amber-900/60 flex items-center justify-between gap-2">
                        <span className="text-[11px] text-amber-800 dark:text-amber-200 leading-snug">
                          Renove a autorização para sincronizar Drive e Agenda.
                        </span>
                        <button
                          type="button"
                          onClick={() => void signInWithGoogle()}
                          className="pressable shrink-0 min-h-[36px] px-3 rounded-lg bg-amber-600 hover:bg-amber-700 text-white text-[11px] font-semibold cursor-pointer"
                        >
                          Renovar
                        </button>
                      </div>
                    )}

                    <div className="grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        onClick={handleManualSave}
                        disabled={isSyncingAction}
                        className="pressable min-h-[44px] px-3 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-semibold text-xs flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-60"
                      >
                        {isSyncingAction ? (
                          <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <CloudUpload className="w-3.5 h-3.5" />
                        )}
                        <span>Salvar no Drive</span>
                      </button>

                      <button
                        type="button"
                        onClick={handleManualRestore}
                        disabled={isSyncingAction}
                        className="pressable min-h-[44px] px-3 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-800 dark:text-zinc-200 font-semibold text-xs flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-60"
                      >
                        <CloudDownload className="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-400" />
                        <span>Restaurar</span>
                      </button>
                    </div>

                    {(driveSyncInfo.lastSyncedAt || driveSyncInfo.remoteModifiedAt) && (
                      <div className="pt-2 border-t border-zinc-100 dark:border-zinc-800 text-[11px] text-zinc-500 flex flex-wrap items-center justify-between gap-1 font-mono tabular-nums">
                        {driveSyncInfo.lastSyncedAt && (
                          <span>
                            Local: {new Date(driveSyncInfo.lastSyncedAt).toLocaleString('pt-BR')}
                          </span>
                        )}
                        {driveSyncInfo.remoteModifiedAt && (
                          <span>
                            Drive: {new Date(driveSyncInfo.remoteModifiedAt).toLocaleString('pt-BR')}
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                ) : !isFirebaseConfigured ? (
                  <div className="p-3.5 rounded-2xl border border-amber-200/80 dark:border-amber-900/50 bg-amber-50/70 dark:bg-amber-950/20 space-y-1.5">
                    <p className="text-xs font-semibold text-amber-800 dark:text-amber-300">
                      Login Google aguardando variáveis de ambiente
                    </p>
                    <p className="text-[11px] text-amber-700/90 dark:text-amber-200/80 leading-relaxed">
                      O app continua 100% funcional localmente. Para ativar o Drive e Agenda, defina as chaves públicas <code className="font-mono">VITE_FIREBASE_*</code> nas variáveis do ambiente/CI sem expor segredos no Git.
                    </p>
                  </div>
                ) : (
                  <div className="p-3.5 rounded-2xl border border-zinc-200/80 dark:border-zinc-800 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <p className="text-xs text-zinc-600 dark:text-zinc-300 leading-relaxed">
                      Conecte sua conta Google para backup automático no Drive e Google Agenda completo.
                    </p>
                    <button
                      type="button"
                      onClick={() => void signInWithGoogle()}
                      disabled={isAuthenticating}
                      className="pressable min-h-[44px] px-4 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold shrink-0 cursor-pointer disabled:opacity-60 whitespace-nowrap"
                    >
                      {isAuthenticating ? 'Conectando...' : 'Conectar Google'}
                    </button>
                  </div>
                )}
              </section>

              <section className="pt-4 border-t border-zinc-100 dark:border-zinc-800 space-y-2.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-xs font-semibold text-zinc-500 dark:text-zinc-400">
                    Backup local (JSON)
                  </span>
                  <span className="text-[11px] font-mono tabular-nums text-zinc-500 dark:text-zinc-400">
                    {tasks.length} tarefas · {transactions.length} lançam. ·{' '}
                    {financialGoals.length + draftNotes.length} metas/notas
                  </span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={exportBackupJson}
                    className="pressable min-h-[44px] px-3 rounded-xl border border-zinc-200 dark:border-zinc-700 hover:bg-zinc-50 dark:hover:bg-zinc-800 text-xs font-semibold text-zinc-700 dark:text-zinc-200 flex items-center justify-center gap-2 cursor-pointer"
                  >
                    <Download className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
                    <span>Baixar JSON</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="pressable min-h-[44px] px-3 rounded-xl border border-zinc-200 dark:border-zinc-700 hover:bg-zinc-50 dark:hover:bg-zinc-800 text-xs font-semibold text-zinc-700 dark:text-zinc-200 flex items-center justify-center gap-2 cursor-pointer"
                  >
                    <Upload className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
                    <span>Importar JSON</span>
                  </button>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".json"
                    onChange={handleFileUpload}
                    className="hidden"
                  />
                </div>
              </section>

              <div className="pt-4 border-t border-zinc-100 dark:border-zinc-800">
                <DiagnosticsAndPermissionsSection mode="vault" />
              </div>
            </div>
          )}

          {/* TAB 3: SEGURANÇA & PERMISSÕES */}
          {activeTab === 'security' && (
            <div role="tabpanel" className="space-y-5">
              <section className="space-y-2.5">
                <span className="text-xs font-semibold text-zinc-500 dark:text-zinc-400 block">
                  Privacidade e automações
                </span>

                {/* Biometria para Finanças */}
                <div className="p-3.5 rounded-2xl border border-zinc-200/80 dark:border-zinc-800 flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <div
                      className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${
                        financeLockEnabled
                          ? 'bg-indigo-100 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-400'
                          : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-500'
                      }`}
                    >
                      <Fingerprint className="w-4 h-4" />
                    </div>
                    <div className="min-w-0">
                      <span className="text-xs font-bold text-zinc-900 dark:text-zinc-100 block">
                        Biometria em Finanças {financeLockEnabled ? '· Ativa' : ''}
                      </span>
                      <span className="text-[11px] text-zinc-500 dark:text-zinc-400 block">
                        {!biometricPlatformSupported
                          ? 'Protege saldos e lançamentos no APK Android'
                          : biometricAvailable
                          ? 'Exige digital, rosto ou senha ao abrir Finanças'
                          : 'Configure digital ou PIN de tela no Android'}
                      </span>
                      {biometricMessage && (
                        <span className="text-[11px] font-medium text-indigo-600 dark:text-indigo-400 block mt-0.5">
                          {biometricMessage}
                        </span>
                      )}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={handleToggleFinanceLock}
                    disabled={isCheckingBiometric}
                    className={`pressable min-h-[40px] px-3.5 rounded-xl text-xs font-semibold cursor-pointer shrink-0 disabled:opacity-60 whitespace-nowrap ${
                      financeLockEnabled
                        ? 'border border-zinc-200 dark:border-zinc-700 text-zinc-700 dark:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800'
                        : 'bg-indigo-600 hover:bg-indigo-700 text-white'
                    }`}
                  >
                    {isCheckingBiometric ? 'Validando...' : financeLockEnabled ? 'Desativar' : 'Ativar'}
                  </button>
                </div>

                {/* Leitura Automática de Bancos */}
                <div className="p-3.5 rounded-2xl border border-zinc-200/80 dark:border-zinc-800 flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <div
                      className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${
                        bankListenerSupported && bankListenerPermission
                          ? 'bg-emerald-100 dark:bg-emerald-950/50 text-emerald-600 dark:text-emerald-400'
                          : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-500'
                      }`}
                    >
                      {bankListenerSupported && bankListenerPermission ? (
                        <ShieldCheck className="w-4 h-4" />
                      ) : (
                        <Smartphone className="w-4 h-4" />
                      )}
                    </div>
                    <div className="min-w-0">
                      <span className="text-xs font-bold text-zinc-900 dark:text-zinc-100 block">
                        Leitura de Bancos {bankListenerSupported ? (bankListenerPermission ? '· Ativa' : '· Inativa') : ''}
                      </span>
                      <span className="text-[11px] text-zinc-500 dark:text-zinc-400 block">
                        {bankListenerSupported
                          ? 'Captura avisos de bancos para revisão em Finanças'
                          : 'Automática no APK Android; na Web cole em Finanças'}
                      </span>
                    </div>
                  </div>
                  {bankListenerSupported && (
                    <div className="flex items-center gap-1.5 shrink-0">
                      <button
                        type="button"
                        onClick={() => void openBankListenerSettings()}
                        className="pressable min-h-[40px] px-3 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold cursor-pointer whitespace-nowrap"
                      >
                        Configurar
                      </button>
                      <button
                        type="button"
                        onClick={() => void refreshBankListenerPermission()}
                        aria-label="Verificar permissão bancária"
                        className="pressable w-10 h-10 rounded-xl border border-zinc-200 dark:border-zinc-700 flex items-center justify-center text-zinc-600 dark:text-zinc-300 cursor-pointer"
                      >
                        <RefreshCw className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  )}
                </div>
              </section>

              <div className="pt-4 border-t border-zinc-100 dark:border-zinc-800">
                <DiagnosticsAndPermissionsSection mode="permissions" />
              </div>
            </div>
          )}

          {/* TAB 4: SISTEMA & LOGS (Versão, Atualizações & Diário de Erros) */}
          {activeTab === 'system' && (
            <div role="tabpanel" className="space-y-5">
              <section className="space-y-2.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-semibold text-zinc-500 dark:text-zinc-400">
                    Versão e atualizações
                  </span>
                  <span className="text-[11px] font-mono tabular-nums text-zinc-500 dark:text-zinc-400">
                    {installedAppVersion}
                    {installedBuildNumber > 0 ? ` · #${installedBuildNumber}` : ''}
                    {' · '}
                    {distributionChannel === 'playStore'
                      ? 'Play Store'
                      : distributionChannel === 'githubApk'
                      ? 'APK Direto'
                      : 'Web'}
                  </span>
                </div>

                <div className="p-3.5 rounded-2xl border border-zinc-200/80 dark:border-zinc-800 space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <Package className="w-4 h-4 text-indigo-500 shrink-0" />
                      <span className="text-xs font-semibold text-zinc-700 dark:text-zinc-300 font-mono truncate">
                        {githubRepo}
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => setShowRepoConfig((prev) => !prev)}
                        className="pressable min-h-[36px] px-2.5 rounded-lg border border-zinc-200 dark:border-zinc-700 text-[11px] font-semibold text-zinc-600 dark:text-zinc-300 inline-flex items-center gap-1 cursor-pointer"
                      >
                        <Settings className="w-3 h-3" />
                        <span>Repo</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleCheckUpdates()}
                        disabled={isCheckingAppUpdate || isDownloadingNow}
                        className="pressable min-h-[36px] px-3 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-[11px] font-semibold inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-60 whitespace-nowrap"
                      >
                        <RefreshCw className={`w-3 h-3 ${isCheckingAppUpdate ? 'animate-spin' : ''}`} />
                        <span>{isCheckingAppUpdate ? 'Buscando...' : 'Buscar atualização'}</span>
                      </button>
                    </div>
                  </div>

                  {showRepoConfig && (
                    <form
                      onSubmit={handleSaveGitHubConfigAndCheck}
                      className="space-y-2.5 pt-2.5 border-t border-zinc-100 dark:border-zinc-800"
                    >
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        <label className="block space-y-1">
                          <span className="text-[11px] font-semibold text-zinc-600 dark:text-zinc-400 flex items-center gap-1">
                            <GitBranch className="w-3 h-3" /> Repositório
                          </span>
                          <input
                            type="text"
                            required
                            value={githubRepo}
                            onChange={(e) => setGithubRepo(e.target.value)}
                            placeholder="usuario/repositorio"
                            className="w-full h-9 px-3 text-xs rounded-lg bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-700 font-mono"
                          />
                        </label>
                        <label className="block space-y-1">
                          <span className="text-[11px] font-semibold text-zinc-600 dark:text-zinc-400 flex items-center gap-1">
                            <Key className="w-3 h-3" /> Token (opcional)
                          </span>
                          <input
                            type="password"
                            value={githubToken}
                            onChange={(e) => setGithubToken(e.target.value)}
                            placeholder="ghp_..."
                            autoComplete="off"
                            className="w-full h-9 px-3 text-xs rounded-lg bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-700 font-mono"
                          />
                        </label>
                      </div>
                      <div className="flex items-center justify-between gap-2">
                        <label className="flex items-center gap-2 text-[11px] text-zinc-600 dark:text-zinc-300 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={autoCheckUpdates}
                            onChange={(e) => setAutoCheckUpdates(e.target.checked)}
                            className="w-4 h-4 rounded accent-indigo-600"
                          />
                          <span>Verificar automaticamente</span>
                        </label>
                        <button
                          type="submit"
                          disabled={isCheckingAppUpdate || !githubRepo.trim()}
                          className="pressable min-h-[36px] px-3 rounded-lg bg-indigo-600 text-white text-[11px] font-semibold cursor-pointer"
                        >
                          Salvar e verificar
                        </button>
                      </div>
                    </form>
                  )}

                  {appUpdateResult?.error ? (
                    <div className="p-3 rounded-xl bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900/60 space-y-2">
                      <div className="flex items-start gap-2 text-xs text-amber-800 dark:text-amber-200">
                        <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                        <span>{appUpdateResult.error}</span>
                      </div>
                      <a
                        href={appUpdateResult.actionsUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="text-[11px] font-semibold text-amber-700 dark:text-amber-300 inline-flex items-center gap-1 hover:underline"
                      >
                        <ExternalLink className="w-3 h-3" /> Abrir GitHub Actions
                      </a>
                    </div>
                  ) : appUpdateResult?.hasUpdate ? (
                    <div className="p-3 rounded-xl bg-indigo-50/70 dark:bg-indigo-950/30 border border-indigo-200 dark:border-indigo-800 space-y-2.5">
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-1.5 text-xs font-bold text-indigo-700 dark:text-indigo-300">
                          <Sparkles className="w-3.5 h-3.5" />
                          <span>Nova versão disponível: {appUpdateResult.latestVersion}</span>
                        </div>
                        {installTarget?.size ? (
                          <span className="text-[11px] font-mono tabular-nums text-indigo-600/80 dark:text-indigo-300/80">
                            {formatFileSize(installTarget.size)}
                          </span>
                        ) : null}
                      </div>

                      {isDownloadingNow && (
                        <div className="space-y-1">
                          <div className="flex items-center justify-between text-[11px] font-mono tabular-nums text-indigo-700 dark:text-indigo-300">
                            <span>
                              {updateDownloadState.status === 'extracting'
                                ? 'Extraindo APK...'
                                : updateDownloadState.status === 'verifying'
                                ? 'Verificando pacote...'
                                : 'Baixando atualização...'}
                            </span>
                            <span>{updateDownloadState.progress}%</span>
                          </div>
                          <div className="w-full h-1.5 rounded-full bg-indigo-200/70 dark:bg-indigo-900 overflow-hidden">
                            <div
                              className="h-full bg-indigo-600 rounded-full transition-all duration-150"
                              style={{
                                width: `${Math.max(4, Math.min(100, updateDownloadState.progress))}%`,
                              }}
                            />
                          </div>
                        </div>
                      )}

                      {updateDownloadState.status === 'permission_required' && (
                        <div className="p-2.5 rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 space-y-2">
                          <p className="text-[11px] text-amber-800 dark:text-amber-200">
                            Autorize o Lifeedy a instalar atualizações nas configurações do Android. Ao voltar, a instalação abrirá sozinha.
                          </p>
                          <div className="flex flex-wrap gap-2">
                            <button
                              type="button"
                              onClick={() => void openUnknownSourcesAndAwaitReturn()}
                              className="pressable min-h-[36px] px-3 rounded-lg bg-amber-600 text-white text-xs font-semibold cursor-pointer"
                            >
                              Permitir instalação
                            </button>
                            <button
                              type="button"
                              onClick={() => void retryInstallPendingApk()}
                              className="pressable min-h-[36px] px-3 rounded-lg border border-amber-300 dark:border-amber-700 text-amber-800 dark:text-amber-200 text-xs font-semibold cursor-pointer"
                            >
                              Já permiti
                            </button>
                          </div>
                        </div>
                      )}

                      {updateDownloadState.status === 'installer_launched' && (
                        <p className="text-[11px] text-emerald-700 dark:text-emerald-300 font-medium">
                          Instalador do Android aberto. Confirme em &ldquo;Atualizar&rdquo; — seus dados serão mantidos.
                        </p>
                      )}

                      {updateDownloadState.status === 'error' && updateDownloadState.error && (
                        <p className="text-[11px] text-rose-600 dark:text-rose-400">
                          {updateDownloadState.error}
                        </p>
                      )}

                      {!isDownloadingNow && updateDownloadState.status !== 'permission_required' && (
                        <div className="flex flex-wrap gap-2">
                          {distributionChannel === 'playStore' ? (
                            <button
                              type="button"
                              onClick={() => void openPlayStoreUpdate()}
                              className="pressable min-h-[38px] px-3.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer"
                            >
                              <ExternalLink className="w-3.5 h-3.5" />
                              <span>Atualizar na Play Store</span>
                            </button>
                          ) : nativeSelfUpdate &&
                            installTarget &&
                            (installTarget.kind === 'release_apk' ||
                              installTarget.kind === 'actions_artifact_zip') ? (
                            <button
                              type="button"
                              onClick={() => void startInAppUpdate()}
                              className="pressable min-h-[38px] px-3.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer"
                            >
                              <Download className="w-3.5 h-3.5" />
                              <span>Atualizar agora</span>
                            </button>
                          ) : installTarget ? (
                            <button
                              type="button"
                              onClick={() => void startInAppUpdate()}
                              className="pressable min-h-[38px] px-3 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer"
                            >
                              <Download className="w-3.5 h-3.5" />
                              <span>
                                {installTarget.kind === 'external_page'
                                  ? 'Abrir página de download'
                                  : `Baixar APK${installTarget.size ? ` (${formatFileSize(installTarget.size)})` : ''}`}
                              </span>
                            </button>
                          ) : null}

                          {appUpdateResult.latestRelease?.html_url && (
                            <a
                              href={appUpdateResult.latestRelease.html_url}
                              target="_blank"
                              rel="noreferrer"
                              className="pressable min-h-[38px] px-3 rounded-lg border border-indigo-300 dark:border-indigo-700 text-indigo-700 dark:text-indigo-300 text-xs font-semibold inline-flex items-center gap-1.5"
                            >
                              <ExternalLink className="w-3.5 h-3.5" />
                              <span>Release</span>
                            </a>
                          )}
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="flex items-center justify-between gap-2 text-xs text-emerald-700 dark:text-emerald-300">
                      <span className="flex items-center gap-1.5 font-medium">
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        {appUpdateResult ? 'Aplicativo atualizado' : 'Versão local pronta'}
                      </span>
                      <button
                        type="button"
                        onClick={handleHardRefresh}
                        disabled={isRefreshingCache}
                        className="text-xs font-semibold hover:underline inline-flex items-center gap-1 cursor-pointer min-h-[32px]"
                      >
                        <RefreshCw className={`w-3.5 h-3.5 ${isRefreshingCache ? 'animate-spin' : ''}`} />
                        <span>Recarregar app</span>
                      </button>
                    </div>
                  )}

                  {appUpdateResult?.recentCommits && appUpdateResult.recentCommits.length > 0 && (
                    <div className="pt-2 border-t border-zinc-100 dark:border-zinc-800 space-y-1">
                      {appUpdateResult.recentCommits.slice(0, 2).map((commit) => (
                        <a
                          key={commit.sha}
                          href={commit.url}
                          target="_blank"
                          rel="noreferrer"
                          className="flex items-center justify-between gap-2 text-[11px] text-zinc-600 dark:text-zinc-300 hover:text-indigo-600"
                        >
                          <span className="truncate flex items-center gap-1.5">
                            <GitCommit className="w-3 h-3 shrink-0 text-zinc-400" />
                            <span className="font-mono text-indigo-600 dark:text-indigo-400">
                              {commit.shortSha}
                            </span>
                            <span className="truncate">{commit.message}</span>
                          </span>
                        </a>
                      ))}
                    </div>
                  )}
                </div>
              </section>

              <div className="pt-4 border-t border-zinc-100 dark:border-zinc-800">
                <DiagnosticsAndPermissionsSection mode="logs" />
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
