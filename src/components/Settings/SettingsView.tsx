import React, { useEffect, useState, useRef } from 'react';
import {
  AlertTriangle,
  Bell,
  CheckCircle2,
  Cloud,
  CloudCheck,
  CloudOff,
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
  ShieldCheck,
  Sliders,
  Smartphone,
  Sparkles,
  Sun,
  Upload,
  User as UserIcon,
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import {
  authenticateFinanceAccess,
  checkBiometricAvailability,
  isBiometricSupportedOnPlatform,
} from '../../services/biometricLockBridge';
import { hapticImpactLight, hapticSuccess } from '../../services/hapticsService';
import {
  checkForGitHubUpdates,
  CURRENT_APP_VERSION,
  CURRENT_BUILD_NUMBER,
  DEFAULT_GITHUB_REPO,
  downloadActionsArtifactWithToken,
  getStoredGitHubConfig,
  refreshAppCache,
  saveGitHubConfig,
  UpdateCheckResult,
} from '../../services/githubUpdateService';

interface SettingsViewProps {
  openSyncModal: () => void;
  openNotificationCenter: () => void;
}

export const SettingsView: React.FC<SettingsViewProps> = ({
  openSyncModal,
  openNotificationCenter,
}) => {
  const {
    theme,
    toggleTheme,
    userName,
    setUserName,
    user,
    signInWithGoogle,
    signOut,
    driveSyncInfo,
    syncToDriveNow,
    tasks,
    transactions,
    financialGoals,
    draftNotes,
    exportBackupJson,
    importBackupJson,
    notificationPermission,
    confirmDestructiveAction,
    bankListenerSupported,
    bankListenerPermission,
    refreshBankListenerPermission,
    openBankListenerSettings,
    financeLockEnabled,
    setFinanceLockEnabled,
    openStartFromScratchModal,
  } = useApp();

  // Biometric lock state
  const biometricPlatformSupported = isBiometricSupportedOnPlatform();
  const [biometricAvailable, setBiometricAvailable] = useState<boolean>(false);
  const [biometricMessage, setBiometricMessage] = useState<string | null>(null);
  const [isCheckingBiometric, setIsCheckingBiometric] = useState<boolean>(false);

  // Profile name editor
  const [nameDraft, setNameDraft] = useState(userName || '');
  const [nameSavedFeedback, setNameSavedFeedback] = useState(false);

  // Update check & GitHub repository config state
  const [isChecking, setIsChecking] = useState(false);
  const [isRefreshingCache, setIsRefreshingCache] = useState(false);
  const [isDownloadingArtifact, setIsDownloadingArtifact] = useState(false);
  const [artifactDownloadError, setArtifactDownloadError] = useState<string | null>(null);
  const [updateResult, setUpdateResult] = useState<UpdateCheckResult | null>(() => {
    return getStoredGitHubConfig().lastResult;
  });
  const [githubRepo, setGithubRepo] = useState<string>(() => getStoredGitHubConfig().repo);
  const [githubToken, setGithubToken] = useState<string>(() => getStoredGitHubConfig().token);
  const [autoCheckUpdates, setAutoCheckUpdates] = useState<boolean>(
    () => getStoredGitHubConfig().autoCheck
  );
  const [showRepoConfig, setShowRepoConfig] = useState<boolean>(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [backupMessage, setBackupMessage] = useState<string | null>(null);

  // File input for JSON backup import
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setNameDraft(userName || '');
  }, [userName]);

  const handleCheckUpdates = async (repoOverride?: string, tokenOverride?: string) => {
    const targetRepo = (repoOverride ?? githubRepo).trim() || DEFAULT_GITHUB_REPO;
    const targetToken = (tokenOverride ?? githubToken).trim();
    setIsChecking(true);
    setArtifactDownloadError(null);
    try {
      const result = await checkForGitHubUpdates(
        targetRepo,
        targetToken || undefined,
        CURRENT_APP_VERSION
      );
      setUpdateResult(result);
      if (result.error) {
        setShowRepoConfig(true);
      }
    } catch (err: any) {
      console.warn('Falha ao verificar atualizações:', err);
    } finally {
      setIsChecking(false);
    }
  };

  // Load initial settings & auto-check updates
  useEffect(() => {
    const config = getStoredGitHubConfig();
    setGithubRepo(config.repo);
    setGithubToken(config.token);
    setAutoCheckUpdates(config.autoCheck);
    setUpdateResult(config.lastResult);

    if (config.autoCheck) {
      void handleCheckUpdates(config.repo, config.token);
    }

    if (biometricPlatformSupported) {
      checkBiometricAvailability()
        .then((res) => setBiometricAvailable(res.available))
        .catch(() => setBiometricAvailable(false));
    }
  }, [biometricPlatformSupported]);

  const handleSaveGitHubConfigAndCheck = async (e: React.FormEvent) => {
    e.preventDefault();
    hapticImpactLight();
    saveGitHubConfig(githubRepo, githubToken, autoCheckUpdates);
    const updated = getStoredGitHubConfig();
    setGithubRepo(updated.repo);
    await handleCheckUpdates(updated.repo, updated.token);
  };

  const handleDownloadArtifact = async () => {
    if (!updateResult?.latestBuild?.artifactId || !githubToken.trim()) return;
    setIsDownloadingArtifact(true);
    setArtifactDownloadError(null);
    try {
      await downloadActionsArtifactWithToken(
        updateResult.latestBuild.artifactId,
        updateResult.repo,
        githubToken,
        updateResult.latestBuild.artifactName || 'VidaOrganizada-APK'
      );
      hapticSuccess();
    } catch (err: any) {
      setArtifactDownloadError(err?.message || 'Não foi possível baixar o artefato.');
    } finally {
      setIsDownloadingArtifact(false);
    }
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
        setBiometricMessage(
          'Configure uma digital, rosto ou PIN de bloqueio nas configurações do Android primeiro.'
        );
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

  const handleSaveName = (e: React.FormEvent) => {
    e.preventDefault();
    if (!nameDraft.trim()) return;
    setUserName(nameDraft.trim());
    hapticSuccess();
    setNameSavedFeedback(true);
    setTimeout(() => setNameSavedFeedback(false), 2500);
  };

  const handleSyncNow = async () => {
    setIsSyncing(true);
    try {
      await syncToDriveNow();
    } catch (e) {
      // already handled in context
    } finally {
      setIsSyncing(false);
    }
  };

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024 * 1024) {
      return `${(bytes / 1024).toFixed(1)} KB`;
    }
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  return (
    <div className="space-y-6 pb-4">
      {/* Top Header Card */}
      <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-3xl p-6 sm:p-8 shadow-xs">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-[#DC7B62] to-[#BE6272] dark:from-[#F2A68E] dark:to-[#E69BA7] flex items-center justify-center text-white dark:text-[#24120E] shadow-md shadow-indigo-500/20">
              <Sliders className="w-7 h-7" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-2xl font-bold text-zinc-900 dark:text-zinc-100">
                  Ajustes & Preferências
                </h1>
                <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-400 border border-indigo-200 dark:border-indigo-900">
                  {CURRENT_APP_VERSION}
                </span>
              </div>
              <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
                Personalize sua experiência, gerencie backups e sincronize seus dados
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => void handleCheckUpdates()}
              disabled={isChecking}
              className="pressable flex items-center justify-center gap-2 min-h-[44px] px-4 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold shadow-md transition-all cursor-pointer disabled:opacity-60 whitespace-nowrap"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isChecking ? 'animate-spin' : ''}`} />
              <span>{isChecking ? 'Verificando...' : 'Buscar Atualizações'}</span>
            </button>
          </div>
        </div>
      </div>

      {/* Card 0: Perfil do Usuário */}
      <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-3xl p-6 sm:p-8 shadow-xs space-y-4">
        <div className="flex items-center gap-3 border-b border-zinc-100 dark:border-zinc-800/80 pb-4">
          <div className="w-10 h-10 rounded-xl bg-indigo-50 dark:bg-indigo-950/40 text-indigo-600 dark:text-indigo-400 flex items-center justify-center">
            <UserIcon className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-base font-bold text-zinc-900 dark:text-zinc-100">Seu Perfil</h2>
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              Nome exibido nas boas-vindas e no aplicativo
            </p>
          </div>
        </div>

        <form onSubmit={handleSaveName} className="flex flex-col sm:flex-row gap-3">
          <input
            type="text"
            required
            value={nameDraft}
            onChange={(e) => setNameDraft(e.target.value)}
            placeholder="Digite seu nome"
            className="flex-1 h-10 px-4 text-sm rounded-xl bg-zinc-50 dark:bg-zinc-800/60 border border-zinc-200 dark:border-zinc-700 text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-indigo-500/30"
          />
          <button
            type="submit"
            disabled={!nameDraft.trim()}
            className="h-10 px-5 rounded-xl bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 text-white text-xs font-semibold transition-colors cursor-pointer shrink-0 whitespace-nowrap"
          >
            {nameSavedFeedback ? 'Nome salvo!' : 'Salvar Nome'}
          </button>
        </form>
      </div>

      {/* Card 1: Conta & Google Drive */}
      <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-3xl p-6 sm:p-8 shadow-xs space-y-5">
        <div className="flex items-center justify-between border-b border-zinc-100 dark:border-zinc-800/80 pb-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-indigo-50 dark:bg-indigo-950/40 text-indigo-600 dark:text-indigo-400 flex items-center justify-center">
              <Cloud className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-zinc-900 dark:text-zinc-100">
                Sincronização em Nuvem (Google Drive)
              </h2>
              <p className="text-xs text-zinc-500 dark:text-zinc-400">
                Seus dados salvos com total privacidade na sua própria conta do Google
              </p>
            </div>
          </div>

          <button
            onClick={openSyncModal}
            className="h-9 px-3.5 rounded-xl bg-indigo-50 hover:bg-indigo-100 dark:bg-indigo-950/60 dark:hover:bg-indigo-900 text-indigo-600 dark:text-indigo-400 text-xs font-semibold transition-colors cursor-pointer border border-indigo-200 dark:border-indigo-900 whitespace-nowrap shrink-0"
          >
            Abrir Central
          </button>
        </div>

        {/* User Status */}
        {user ? (
          <div className="p-4 rounded-2xl bg-zinc-50 dark:bg-zinc-800/40 border border-zinc-200/80 dark:border-zinc-800 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              {user.photoURL ? (
                <img
                  src={user.photoURL}
                  alt={user.displayName || 'Usuário'}
                  className="w-12 h-12 rounded-2xl object-cover border border-zinc-200 dark:border-zinc-700"
                />
              ) : (
                <div className="w-12 h-12 rounded-2xl bg-indigo-600 text-white font-bold flex items-center justify-center text-lg">
                  {(user.displayName || user.email || 'U')[0].toUpperCase()}
                </div>
              )}
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-bold text-sm text-zinc-900 dark:text-zinc-100">
                    {user.displayName || 'Usuário'}
                  </span>
                  <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/40 px-2 py-0.5 rounded-full border border-emerald-200 dark:border-emerald-800">
                    <CloudCheck className="w-3 h-3" />
                    Conectado
                  </span>
                </div>
                <p className="text-xs text-zinc-500 dark:text-zinc-400">{user.email}</p>
                {driveSyncInfo.lastSyncedAt && (
                  <p className="text-[11px] text-zinc-400 mt-0.5">
                    Última sincronização: {new Date(driveSyncInfo.lastSyncedAt).toLocaleString('pt-BR')}
                  </p>
                )}
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={handleSyncNow}
                disabled={isSyncing}
                className="flex items-center gap-1.5 h-9 px-3.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold shadow-xs transition-colors cursor-pointer disabled:opacity-60 whitespace-nowrap"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isSyncing ? 'animate-spin' : ''}`} />
                <span>{isSyncing ? 'Salvando...' : 'Salvar no Drive'}</span>
              </button>
              <button
                onClick={signOut}
                title="Desconectar conta Google"
                className="w-9 h-9 flex items-center justify-center rounded-xl border border-zinc-200 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-500 hover:text-rose-500 transition-colors cursor-pointer shrink-0"
              >
                <LogOut className="w-4 h-4" />
              </button>
            </div>
          </div>
        ) : (
          <div className="p-4 rounded-2xl bg-zinc-50 dark:bg-zinc-800/40 border border-zinc-200/80 dark:border-zinc-800 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-zinc-200 dark:bg-zinc-700 flex items-center justify-center text-zinc-500">
                <CloudOff className="w-5 h-5" />
              </div>
              <div>
                <p className="text-sm font-bold text-zinc-900 dark:text-zinc-100">
                  Modo Offline Ativo
                </p>
                <p className="text-xs text-zinc-500 dark:text-zinc-400">
                  Conecte sua conta Google para sincronizar automaticamente entre seus aparelhos.
                </p>
              </div>
            </div>

            <button
              onClick={signInWithGoogle}
              className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold shadow-md transition-colors cursor-pointer shrink-0"
            >
              Conectar com Google
            </button>
          </div>
        )}
      </div>

      {/* Card 2: Preferências do Sistema */}
      <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-3xl p-6 sm:p-8 shadow-xs space-y-5">
        <div className="border-b border-zinc-100 dark:border-zinc-800/80 pb-4">
          <h2 className="text-base font-bold text-zinc-900 dark:text-zinc-100">
            Aparência & Notificações
          </h2>
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            Ajustes de visualização e alertas visuais de tarefas
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {/* Theme setting */}
          <div className="p-4 rounded-2xl border border-zinc-200/80 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-800/40 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-zinc-200 dark:bg-zinc-700 flex items-center justify-center text-zinc-800 dark:text-zinc-200">
                {theme === 'dark' ? <Moon className="w-4 h-4 text-indigo-400" /> : <Sun className="w-4 h-4 text-amber-500" />}
              </div>
              <div>
                <span className="text-xs font-bold text-zinc-900 dark:text-zinc-100 block">
                  Aparência
                </span>
                <span className="text-[11px] text-zinc-500 capitalize">
                  {theme === 'dark' ? 'Modo Escuro' : 'Modo Claro'}
                </span>
              </div>
            </div>

            <button
              onClick={toggleTheme}
              className="h-9 px-3.5 rounded-xl border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-xs font-semibold cursor-pointer hover:bg-zinc-100 dark:hover:bg-zinc-700 transition-colors whitespace-nowrap shrink-0"
            >
              Alternar
            </button>
          </div>

          {/* Notifications setting */}
          <div className="p-4 rounded-2xl border border-zinc-200/80 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-800/40 flex items-center justify-between gap-2">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-amber-100 dark:bg-amber-950/50 text-amber-600 flex items-center justify-center shrink-0">
                <Bell className="w-4 h-4" />
              </div>
              <div>
                <span className="text-xs font-bold text-zinc-900 dark:text-zinc-100 block">
                  Lembretes & Alertas
                </span>
                <span className="text-[11px] text-zinc-500">
                  {notificationPermission === 'granted' ? 'Alertas Ativos' : 'Desativadas'}
                </span>
              </div>
            </div>

            <button
              onClick={openNotificationCenter}
              className="h-9 px-3.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold cursor-pointer transition-colors whitespace-nowrap shrink-0"
            >
              Ver Alertas
            </button>
          </div>

          {/* AI Gemini Status */}
          <div className="p-4 rounded-2xl border border-zinc-200/80 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-800/40 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-purple-100 dark:bg-purple-950/50 text-purple-600 flex items-center justify-center">
                <Cpu className="w-4 h-4" />
              </div>
              <div>
                <span className="text-xs font-bold text-zinc-900 dark:text-zinc-100 block">
                  Leitor de Recibos IA
                </span>
                <span className="text-[11px] text-zinc-500">
                  OCR Automático
                </span>
              </div>
            </div>
            <span className="text-[11px] font-bold text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/40 px-2 py-0.5 rounded-md border border-emerald-200 dark:border-emerald-800">
              Ativo
            </span>
          </div>
        </div>

        {/* Bank Notification Capture */}
        <div className="pt-1">
          <div className="p-4 rounded-2xl border border-zinc-200/80 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-800/40 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-start sm:items-center gap-3">
              <div
                className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${
                  bankListenerSupported && bankListenerPermission
                    ? 'bg-emerald-100 dark:bg-emerald-950/50 text-emerald-600 dark:text-emerald-400'
                    : 'bg-zinc-200 dark:bg-zinc-700 text-zinc-600 dark:text-zinc-300'
                }`}
              >
                {bankListenerSupported && bankListenerPermission ? (
                  <ShieldCheck className="w-4 h-4" />
                ) : (
                  <Smartphone className="w-4 h-4" />
                )}
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-xs font-bold text-zinc-900 dark:text-zinc-100">
                    Leitura Automática de Bancos
                  </span>
                  {bankListenerSupported && (
                    <span
                      className={`text-[10px] font-bold px-2 py-0.5 rounded-md border ${
                        bankListenerPermission
                          ? 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400 border-emerald-200 dark:border-emerald-800'
                          : 'bg-amber-50 dark:bg-amber-950/40 text-amber-600 dark:text-amber-400 border-amber-200 dark:border-amber-800'
                      }`}
                    >
                      {bankListenerPermission ? 'Ativo' : 'Inativo'}
                    </span>
                  )}
                </div>
                <span className="text-[11px] text-zinc-500 dark:text-zinc-400 block mt-0.5">
                  {bankListenerSupported
                    ? 'Captura avisos de bancos do Brasil e envia para revisão em Finanças'
                    : 'Captura automática no app Android; na Web use Colar aviso / SMS em Finanças'}
                </span>
              </div>
            </div>

            {bankListenerSupported && (
              <div className="flex items-center gap-2 shrink-0">
                <button
                  onClick={() => openBankListenerSettings()}
                  className="pressable h-9 px-3.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold cursor-pointer whitespace-nowrap"
                >
                  Configurar Acesso
                </button>
                <button
                  onClick={() => refreshBankListenerPermission()}
                  title="Verificar permissão"
                  className="pressable w-9 h-9 flex items-center justify-center rounded-xl border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-700 cursor-pointer shrink-0"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                </button>
              </div>
            )}
          </div>

          {/* Optional Biometric Lock for Finance Tab */}
          <div className="mt-4 p-4 rounded-2xl border border-zinc-200/80 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-800/40 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-start sm:items-center gap-3">
              <div
                className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${
                  financeLockEnabled
                    ? 'bg-indigo-100 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-400'
                    : 'bg-zinc-200 dark:bg-zinc-700 text-zinc-600 dark:text-zinc-300'
                }`}
              >
                <Fingerprint className="w-4 h-4" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-xs font-bold text-zinc-900 dark:text-zinc-100">
                    Biometria para Abrir Finanças
                  </span>
                  {biometricPlatformSupported && (
                    <span
                      className={`text-[10px] font-bold px-2 py-0.5 rounded-md border ${
                        financeLockEnabled
                          ? 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400 border-emerald-200 dark:border-emerald-800'
                          : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400 border-zinc-200 dark:border-zinc-700'
                      }`}
                    >
                      {financeLockEnabled ? 'Ativo' : 'Opcional'}
                    </span>
                  )}
                </div>
                <span className="text-[11px] text-zinc-500 dark:text-zinc-400 block mt-0.5">
                  {!biometricPlatformSupported
                    ? 'Solicita digital, rosto ou PIN ao abrir Finanças no app Android instalado.'
                    : biometricAvailable
                    ? 'Exige digital, rosto ou senha do aparelho ao acessar saldos e lançamentos.'
                    : 'Ative digital ou PIN de tela no Android para habilitar esta proteção.'}
                </span>
                {biometricMessage && (
                  <span className="text-[11px] font-medium text-indigo-600 dark:text-indigo-400 block mt-1">
                    {biometricMessage}
                  </span>
                )}
              </div>
            </div>

            <button
              type="button"
              onClick={handleToggleFinanceLock}
              disabled={isCheckingBiometric}
              className={`pressable h-9 px-3.5 rounded-xl text-xs font-semibold cursor-pointer whitespace-nowrap shrink-0 disabled:opacity-60 ${
                financeLockEnabled
                  ? 'border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-zinc-700 dark:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-700'
                  : 'bg-indigo-600 hover:bg-indigo-700 text-white'
              }`}
            >
              {isCheckingBiometric
                ? 'Validando...'
                : financeLockEnabled
                ? 'Desativar'
                : 'Ativar Proteção'}
            </button>
          </div>
        </div>
      </div>

      {/* Card 3: Cópia de Segurança Local (JSON) */}
      <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-3xl p-6 sm:p-8 shadow-xs space-y-5">
        <div className="border-b border-zinc-100 dark:border-zinc-800/80 pb-4">
          <h2 className="text-base font-bold text-zinc-900 dark:text-zinc-100">
            Cópia de Segurança Local
          </h2>
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            Exporte ou importe seus dados a qualquer momento em arquivo JSON
          </p>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="p-3.5 rounded-2xl bg-zinc-50 dark:bg-zinc-800/40 border border-zinc-200/80 dark:border-zinc-800">
            <span className="text-[11px] font-semibold text-zinc-400 uppercase tracking-wider block mb-1">
              Tarefas
            </span>
            <p className="text-lg font-bold text-zinc-900 dark:text-zinc-100 tabular-nums">
              {tasks.length}
            </p>
          </div>

          <div className="p-3.5 rounded-2xl bg-zinc-50 dark:bg-zinc-800/40 border border-zinc-200/80 dark:border-zinc-800">
            <span className="text-[11px] font-semibold text-zinc-400 uppercase tracking-wider block mb-1">
              Transações
            </span>
            <p className="text-lg font-bold text-zinc-900 dark:text-zinc-100 tabular-nums">
              {transactions.length}
            </p>
          </div>

          <div className="p-3.5 rounded-2xl bg-zinc-50 dark:bg-zinc-800/40 border border-zinc-200/80 dark:border-zinc-800">
            <span className="text-[11px] font-semibold text-zinc-400 uppercase tracking-wider block mb-1">
              Metas & Notas
            </span>
            <p className="text-lg font-bold text-zinc-900 dark:text-zinc-100 tabular-nums">
              {financialGoals.length + draftNotes.length}
            </p>
          </div>

          <div className="p-3.5 rounded-2xl bg-zinc-50 dark:bg-zinc-800/40 border border-zinc-200/80 dark:border-zinc-800">
            <span className="text-[11px] font-semibold text-zinc-400 uppercase tracking-wider block mb-1">
              Privacidade
            </span>
            <p className="text-xs font-bold text-emerald-600 dark:text-emerald-400 mt-1">
              Controle total dos seus dados
            </p>
          </div>
        </div>

        <div className="flex flex-col sm:flex-row gap-3 pt-1">
          <button
            onClick={exportBackupJson}
            className="flex-1 flex items-center justify-center gap-2 h-10 px-4 rounded-xl border border-zinc-200 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-800 text-xs font-semibold text-zinc-700 dark:text-zinc-200 transition-colors cursor-pointer"
          >
            <Download className="w-4 h-4 text-indigo-600 shrink-0" />
            <span>Fazer Download do Backup (JSON)</span>
          </button>

          <button
            onClick={() => fileInputRef.current?.click()}
            className="flex-1 flex items-center justify-center gap-2 h-10 px-4 rounded-xl border border-zinc-200 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-800 text-xs font-semibold text-zinc-700 dark:text-zinc-200 transition-colors cursor-pointer"
          >
            <Upload className="w-4 h-4 text-indigo-600 shrink-0" />
            <span>Restaurar de Arquivo JSON</span>
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".json"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              const reader = new FileReader();
              reader.onload = (ev) => {
                const content = ev.target?.result as string;
                if (content && importBackupJson(content)) {
                  setBackupMessage('Backup importado com sucesso.');
                } else {
                  setBackupMessage('Arquivo de backup inválido.');
                }
                setTimeout(() => setBackupMessage(null), 4000);
              };
              reader.readAsText(file);
              e.target.value = '';
            }}
            className="hidden"
          />
        </div>
        {backupMessage && (
          <p className="text-xs font-medium text-indigo-600 dark:text-indigo-400">{backupMessage}</p>
        )}
      </div>

      {/* Card 4: Versão & Atualizações do App */}
      <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-3xl p-6 sm:p-8 shadow-xs space-y-5">
        <div className="flex items-center justify-between gap-3 flex-wrap border-b border-zinc-100 dark:border-zinc-800/80 pb-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-indigo-50 dark:bg-indigo-950/40 text-indigo-600 dark:text-indigo-400 flex items-center justify-center">
              <Package className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-zinc-900 dark:text-zinc-100">
                Versão & Atualizações
              </h2>
              <p className="text-xs text-zinc-500 dark:text-zinc-400">
                Repositório monitorado: <span className="font-mono">{githubRepo}</span>
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-xs font-bold font-mono tabular-nums text-zinc-600 dark:text-zinc-300 bg-zinc-100 dark:bg-zinc-800 px-3 py-1 rounded-full">
              {CURRENT_APP_VERSION}
              {CURRENT_BUILD_NUMBER > 0 ? ` · #${CURRENT_BUILD_NUMBER}` : ''}
            </span>
            <button
              type="button"
              onClick={() => setShowRepoConfig((prev) => !prev)}
              className="pressable min-h-[38px] px-3 py-1.5 rounded-xl border border-zinc-200 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-800 text-xs font-semibold text-zinc-700 dark:text-zinc-300 flex items-center gap-1.5 cursor-pointer"
            >
              <Settings className="w-3.5 h-3.5" />
              <span>Configurar</span>
            </button>
          </div>
        </div>

        {/* Collapsible GitHub Repository Config */}
        {showRepoConfig && (
          <form
            onSubmit={handleSaveGitHubConfigAndCheck}
            className="p-4 sm:p-5 rounded-2xl bg-zinc-50 dark:bg-zinc-800/50 border border-zinc-200 dark:border-zinc-700/80 space-y-3.5"
          >
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label
                  htmlFor="github-repo-input"
                  className="text-xs font-semibold text-zinc-700 dark:text-zinc-300 flex items-center gap-1.5"
                >
                  <GitBranch className="w-3.5 h-3.5 text-indigo-500" />
                  <span>Repositório GitHub (usuario/repositorio)</span>
                </label>
                <input
                  id="github-repo-input"
                  type="text"
                  required
                  value={githubRepo}
                  onChange={(e) => setGithubRepo(e.target.value)}
                  placeholder="leancelot/meu-vida-organizada"
                  className="w-full h-11 px-3.5 text-xs sm:text-sm rounded-xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 text-zinc-900 dark:text-zinc-100 font-mono focus:outline-none focus:ring-2 focus:ring-indigo-500/30"
                />
              </div>

              <div className="space-y-1.5">
                <label
                  htmlFor="github-token-input"
                  className="text-xs font-semibold text-zinc-700 dark:text-zinc-300 flex items-center gap-1.5"
                >
                  <Key className="w-3.5 h-3.5 text-indigo-500" />
                  <span>Token GitHub (opcional para repo privado)</span>
                </label>
                <input
                  id="github-token-input"
                  type="password"
                  value={githubToken}
                  onChange={(e) => setGithubToken(e.target.value)}
                  placeholder="ghp_... ou github_pat_..."
                  autoComplete="off"
                  className="w-full h-11 px-3.5 text-xs sm:text-sm rounded-xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 text-zinc-900 dark:text-zinc-100 font-mono focus:outline-none focus:ring-2 focus:ring-indigo-500/30"
                />
              </div>
            </div>

            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-1">
              <label className="flex items-center gap-2 text-xs text-zinc-600 dark:text-zinc-300 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={autoCheckUpdates}
                  onChange={(e) => setAutoCheckUpdates(e.target.checked)}
                  className="w-4 h-4 rounded text-indigo-600 cursor-pointer"
                />
                <span>Verificar automaticamente ao abrir Ajustes</span>
              </label>

              <button
                type="submit"
                disabled={isChecking || !githubRepo.trim()}
                className="pressable min-h-[44px] px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold flex items-center justify-center gap-2 cursor-pointer disabled:opacity-60"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isChecking ? 'animate-spin' : ''}`} />
                <span>Salvar e Verificar</span>
              </button>
            </div>
          </form>
        )}

        {/* Update Status Banner */}
        {updateResult?.error ? (
          <div className="p-4 sm:p-5 rounded-2xl bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900/60 space-y-3">
            <div className="flex items-start gap-2.5">
              <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
              <div className="space-y-1">
                <p className="text-xs font-bold text-amber-900 dark:text-amber-200">
                  Não foi possível verificar atualizações
                </p>
                <p className="text-xs text-amber-800 dark:text-amber-300 leading-relaxed">
                  {updateResult.error}
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2 pt-1">
              <button
                type="button"
                onClick={() => void handleCheckUpdates()}
                disabled={isChecking}
                className="pressable min-h-[40px] px-3.5 py-2 rounded-xl bg-amber-600 hover:bg-amber-700 text-white text-xs font-semibold flex items-center gap-1.5 cursor-pointer disabled:opacity-60"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isChecking ? 'animate-spin' : ''}`} />
                <span>Tentar novamente</span>
              </button>

              <a
                href={updateResult.actionsUrl}
                target="_blank"
                rel="noreferrer"
                className="pressable min-h-[40px] px-3.5 py-2 rounded-xl border border-amber-300 dark:border-amber-800 text-amber-900 dark:text-amber-200 text-xs font-semibold inline-flex items-center gap-1.5 hover:bg-amber-100/70 dark:hover:bg-amber-950/50"
              >
                <ExternalLink className="w-3.5 h-3.5" />
                <span>Abrir GitHub Actions</span>
              </a>
            </div>
          </div>
        ) : updateResult?.hasUpdate ? (
          <div className="p-5 rounded-2xl bg-gradient-to-br from-indigo-500/12 via-violet-500/10 to-amber-500/10 border border-indigo-200 dark:border-indigo-800/80 space-y-3">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div className="flex items-center gap-2 text-indigo-700 dark:text-indigo-300 font-bold text-sm">
                <Sparkles className="w-4 h-4 text-indigo-600 shrink-0" />
                <span>
                  {updateResult.updateSource === 'actions_artifact'
                    ? `Novo APK disponível no GitHub Actions (${updateResult.latestVersion})`
                    : `Nova versão disponível: ${updateResult.latestVersion}`}
                </span>
              </div>
              {updateResult.latestBuild?.shortSha && (
                <span className="text-[11px] font-mono tabular-nums text-zinc-500 dark:text-zinc-400">
                  commit {updateResult.latestBuild.shortSha}
                </span>
              )}
            </div>

            <p className="text-xs text-zinc-600 dark:text-zinc-300 leading-relaxed">
              {updateResult.updateSource === 'actions_artifact'
                ? 'Um novo APK foi compilado no workflow do GitHub Actions e está pronto para download.'
                : 'Uma nova versão do VidaOrganizada está publicada e pronta para download.'}
            </p>

            {artifactDownloadError && (
              <p className="text-xs font-medium text-rose-600 dark:text-rose-400">
                {artifactDownloadError}
              </p>
            )}

            <div className="flex flex-wrap items-center gap-2.5 pt-1">
              {updateResult.apkAsset ? (
                <a
                  href={updateResult.apkAsset.browser_download_url}
                  target="_blank"
                  rel="noreferrer"
                  className="pressable min-h-[44px] inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold shadow-md transition-colors"
                >
                  <Download className="w-4 h-4" />
                  <span>Baixar APK ({formatFileSize(updateResult.apkAsset.size)})</span>
                </a>
              ) : updateResult.latestBuild ? (
                <>
                  {githubToken.trim() && updateResult.latestBuild.artifactId ? (
                    <button
                      type="button"
                      onClick={() => void handleDownloadArtifact()}
                      disabled={isDownloadingArtifact}
                      className="pressable min-h-[44px] inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold shadow-md transition-colors cursor-pointer disabled:opacity-60"
                    >
                      <Download className="w-4 h-4" />
                      <span>
                        {isDownloadingArtifact
                          ? 'Baixando APK...'
                          : `Baixar Artefato (${
                              updateResult.latestBuild.artifactSize
                                ? formatFileSize(updateResult.latestBuild.artifactSize)
                                : 'ZIP'
                            })`}
                      </span>
                    </button>
                  ) : null}

                  <a
                    href={updateResult.latestBuild.htmlUrl}
                    target="_blank"
                    rel="noreferrer"
                    className={`pressable min-h-[44px] inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-bold transition-colors ${
                      githubToken.trim() && updateResult.latestBuild.artifactId
                        ? 'border border-indigo-300 dark:border-indigo-700 text-indigo-700 dark:text-indigo-300 hover:bg-indigo-50 dark:hover:bg-indigo-950/40'
                        : 'bg-indigo-600 hover:bg-indigo-700 text-white shadow-md'
                    }`}
                  >
                    <ExternalLink className="w-4 h-4" />
                    <span>
                      Abrir Build #{updateResult.latestBuild.runNumber} no GitHub
                      {updateResult.latestBuild.artifactSize
                        ? ` (${formatFileSize(updateResult.latestBuild.artifactSize)})`
                        : ''}
                    </span>
                  </a>
                </>
              ) : updateResult.latestRelease?.html_url ? (
                <a
                  href={updateResult.latestRelease.html_url}
                  target="_blank"
                  rel="noreferrer"
                  className="pressable min-h-[44px] inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold shadow-md transition-colors"
                >
                  <Download className="w-4 h-4" />
                  <span>Ver Download da Nova Versão</span>
                </a>
              ) : null}
            </div>
          </div>
        ) : updateResult ? (
          <div className="p-4 rounded-2xl bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-900/50 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-start sm:items-center gap-2.5">
              <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5 sm:mt-0" />
              <div>
                <p className="text-xs font-bold text-emerald-900 dark:text-emerald-200">
                  Seu aplicativo está atualizado ({CURRENT_APP_VERSION}
                  {CURRENT_BUILD_NUMBER > 0 ? ` · Build #${CURRENT_BUILD_NUMBER}` : ''})
                </p>
                <p className="text-[11px] text-emerald-700 dark:text-emerald-400">
                  Verificado em{' '}
                  {new Date(updateResult.checkedAt).toLocaleString('pt-BR', {
                    day: '2-digit',
                    month: '2-digit',
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                  {updateResult.latestBuild
                    ? ` · Último build no GitHub: #${updateResult.latestBuild.runNumber}`
                    : ''}
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              {updateResult.latestBuild?.htmlUrl && (
                <a
                  href={updateResult.latestBuild.htmlUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="text-xs font-semibold text-emerald-800 dark:text-emerald-300 hover:underline inline-flex items-center gap-1"
                >
                  <ExternalLink className="w-3 h-3" />
                  <span>Ver Actions</span>
                </a>
              )}
              <button
                type="button"
                onClick={handleHardRefresh}
                disabled={isRefreshingCache}
                className="text-xs font-semibold text-emerald-800 dark:text-emerald-300 hover:underline flex items-center gap-1 cursor-pointer"
              >
                <RefreshCw className={`w-3 h-3 ${isRefreshingCache ? 'animate-spin' : ''}`} />
                <span>Recarregar aplicativo</span>
              </button>
            </div>
          </div>
        ) : (
          <div className="p-4 rounded-2xl bg-zinc-50 dark:bg-zinc-800/40 border border-zinc-200 dark:border-zinc-800 flex items-center justify-between gap-3">
            <p className="text-xs text-zinc-600 dark:text-zinc-400">
              Toque em <strong>Buscar Atualizações</strong> para consultar Releases e APKs compilados no GitHub.
            </p>
          </div>
        )}

        {/* Recent Commits Visibility */}
        {updateResult?.recentCommits && updateResult.recentCommits.length > 0 && (
          <div className="pt-2 border-t border-zinc-100 dark:border-zinc-800/80 space-y-2">
            <div className="flex items-center justify-between text-[11px] font-semibold text-zinc-500 dark:text-zinc-400">
              <span className="flex items-center gap-1.5">
                <GitCommit className="w-3.5 h-3.5" />
                <span>Últimas atualizações em {updateResult.repo}</span>
              </span>
              <div className="flex items-center gap-3">
                <a
                  href={updateResult.releasesUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="hover:text-indigo-600 dark:hover:text-indigo-400 inline-flex items-center gap-1"
                >
                  <span>Releases</span>
                  <ExternalLink className="w-3 h-3" />
                </a>
                <a
                  href={updateResult.actionsUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="hover:text-indigo-600 dark:hover:text-indigo-400 inline-flex items-center gap-1"
                >
                  <span>Actions</span>
                  <ExternalLink className="w-3 h-3" />
                </a>
              </div>
            </div>

            <div className="space-y-1.5">
              {updateResult.recentCommits.slice(0, 3).map((commit) => (
                <a
                  key={commit.sha}
                  href={commit.url}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center justify-between gap-2 px-3 py-2 rounded-xl bg-zinc-50 dark:bg-zinc-800/40 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors text-xs"
                >
                  <span className="truncate text-zinc-700 dark:text-zinc-200 font-medium">
                    <span className="font-mono text-[11px] text-indigo-600 dark:text-indigo-400 mr-2">
                      {commit.shortSha}
                    </span>
                    {commit.message}
                  </span>
                  {commit.date && (
                    <span className="text-[11px] font-mono tabular-nums text-zinc-400 shrink-0">
                      {new Date(commit.date).toLocaleDateString('pt-BR')}
                    </span>
                  )}
                </a>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Card 5: Reiniciar Aplicativo / Recomeçar do Zero */}
      <div className="bg-white dark:bg-zinc-900 border border-rose-200/80 dark:border-rose-900/50 rounded-3xl p-6 sm:p-8 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-start sm:items-center gap-3.5">
          <div className="w-10 h-10 rounded-xl bg-rose-50 dark:bg-rose-950/50 text-rose-600 dark:text-rose-400 flex items-center justify-center shrink-0">
            <RotateCcw className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-base font-bold text-zinc-900 dark:text-zinc-100">
              Recomeçar do Zero
            </h2>
            <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5 leading-relaxed">
              Apague os registros locais e volte para a configuração inicial. Seu backup no Google Drive só é alterado se você autorizar.
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={() => {
            hapticImpactLight();
            openStartFromScratchModal();
          }}
          className="pressable min-h-[44px] px-4 py-2.5 rounded-xl border border-rose-300 dark:border-rose-800 bg-rose-50 hover:bg-rose-100 dark:bg-rose-950/30 dark:hover:bg-rose-950/60 text-rose-700 dark:text-rose-300 text-xs font-semibold flex items-center justify-center gap-2 cursor-pointer whitespace-nowrap shrink-0"
        >
          <RotateCcw className="w-3.5 h-3.5" />
          <span>Recomeçar do zero</span>
        </button>
      </div>
    </div>
  );
};
