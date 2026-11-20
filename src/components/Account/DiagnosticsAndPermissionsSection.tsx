import React, { useEffect, useState } from 'react';
import {
  AlertTriangle,
  BellRing,
  Camera,
  CheckCircle2,
  Clock,
  Download,
  FileWarning,
  HardDrive,
  Mail,
  Mic,
  Package,
  RefreshCw,
  Send,
  Settings,
  ShieldCheck,
  Trash2,
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import {
  getWebMediaPermissionsStatus,
  isAndroidNativeHealthSupported,
  MediaPermissionTarget,
  requestMediaPermission,
  WebMediaPermissionsStatus,
} from '../../services/appHealthBridge';
import {
  buildErrorReportMailtoUrl,
  clearErrorJournal,
  ErrorJournalEntry,
  exportErrorJournalText,
  getAutoErrorReportEnabled,
  getErrorJournal,
  sendDiagnosticReport,
  setAutoErrorReportEnabled,
  subscribeErrorJournal,
} from '../../services/errorJournalService';
import { hapticImpactLight, hapticSelection, hapticSuccess } from '../../services/hapticsService';

const formatBytes = (bytes: number): string => {
  if (!bytes || bytes <= 0) return '0 KB';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
};

export type DiagnosticsSectionMode = 'all' | 'permissions' | 'vault' | 'logs';

interface DiagnosticsAndPermissionsSectionProps {
  mode?: DiagnosticsSectionMode;
}

export const DiagnosticsAndPermissionsSection: React.FC<DiagnosticsAndPermissionsSectionProps> = ({
  mode = 'all',
}) => {
  const {
    installedAppVersion,
    installedBuildNumber,
    distributionChannel,
    androidPermissions,
    refreshAndroidPermissions,
    openAndroidSettings,
    notificationPermission,
    enableNotifications,
    vaultStatus,
    isOnline,
  } = useApp();

  const nativeAndroid = isAndroidNativeHealthSupported();
  const [journalEntries, setJournalEntries] = useState<ErrorJournalEntry[]>(() => getErrorJournal());
  const [showErrorLogList, setShowErrorLogList] = useState(false);
  const [autoReport, setAutoReport] = useState<boolean>(() => getAutoErrorReportEnabled());
  const [isSendingReport, setIsSendingReport] = useState(false);
  const [diagMessage, setDiagMessage] = useState<string | null>(null);
  const [webMediaPerms, setWebMediaPerms] = useState<WebMediaPermissionsStatus>({
    microphone: 'unsupported',
    camera: 'unsupported',
  });
  const [requestingMedia, setRequestingMedia] = useState<MediaPermissionTarget | null>(null);

  const refreshWebMedia = async () => {
    if (nativeAndroid) return;
    const status = await getWebMediaPermissionsStatus();
    setWebMediaPerms(status);
  };

  useEffect(() => {
    setJournalEntries(getErrorJournal());
    void refreshWebMedia();
    return subscribeErrorJournal((entries) => {
      setJournalEntries(entries);
    });
  }, []);

  const handleRequestMediaAccess = async (target: MediaPermissionTarget) => {
    hapticImpactLight();
    setRequestingMedia(target);
    setDiagMessage(null);
    const result = await requestMediaPermission(target);
    setRequestingMedia(null);

    if (nativeAndroid) {
      await refreshAndroidPermissions();
    } else {
      await refreshWebMedia();
    }

    if (result.granted) {
      hapticSuccess();
      setDiagMessage(
        target === 'microphone'
          ? 'Permissão de microfone concedida.'
          : 'Permissão de câmera concedida.'
      );
      return;
    }

    if (nativeAndroid) {
      setDiagMessage(
        `Permissão de ${
          target === 'microphone' ? 'microfone' : 'câmera'
        } não concedida. Abrindo ajustes do aplicativo...`
      );
      void openAndroidSettings('appDetails');
    } else if (result.state === 'unsupported') {
      setDiagMessage(
        `Nenhum recurso de ${
          target === 'microphone' ? 'microfone' : 'câmera'
        } disponível neste navegador.`
      );
    } else {
      setDiagMessage(
        `Acesso bloqueado no navegador. Libere o ${
          target === 'microphone' ? 'microfone' : 'câmera'
        } nas configurações do site na barra de endereços.`
      );
    }
  };

  const handleExportLog = () => {
    hapticImpactLight();
    const text = exportErrorJournalText({
      appVersion: installedAppVersion,
      buildNumber: installedBuildNumber,
      distributionChannel,
    });
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `Lifeedy_Diagnostico_${new Date().toISOString().split('T')[0]}.txt`;
    link.click();
    URL.revokeObjectURL(url);
    setDiagMessage('Arquivo de diagnóstico exportado com segurança (sem dados sensíveis).');
  };

  const handleSendReportToServer = async () => {
    hapticImpactLight();
    setIsSendingReport(true);
    setDiagMessage(null);
    const result = await sendDiagnosticReport({
      appVersion: installedAppVersion,
      buildNumber: installedBuildNumber,
      distributionChannel,
    });
    setIsSendingReport(false);
    if (result.ok) {
      hapticSuccess();
      setDiagMessage(`Relatório sanitizado enviado ao servidor (${result.reportId || 'OK'}).`);
    } else {
      setDiagMessage(result.error || 'Não foi possível enviar ao servidor agora.');
    }
  };

  const handleToggleAutoReport = (next: boolean) => {
    hapticSelection();
    setAutoReport(next);
    setAutoErrorReportEnabled(next);
  };

  const mailtoUrl = buildErrorReportMailtoUrl({
    appVersion: installedAppVersion,
    buildNumber: installedBuildNumber,
    distributionChannel,
  });

  const notificationsGranted = nativeAndroid
    ? Boolean(androidPermissions?.notifications ?? notificationPermission === 'granted')
    : notificationPermission === 'granted';

  const exactAlarmsGranted = nativeAndroid ? Boolean(androidPermissions?.exactAlarms ?? true) : true;
  const microphoneGranted = nativeAndroid
    ? Boolean(androidPermissions?.microphone)
    : webMediaPerms.microphone === 'granted';
  const cameraGranted = nativeAndroid
    ? Boolean(androidPermissions?.camera)
    : webMediaPerms.camera === 'granted';
  const bankListenerGranted = nativeAndroid ? Boolean(androidPermissions?.bankListener) : false;
  const installPackagesGranted = nativeAndroid
    ? Boolean(androidPermissions?.installPackages)
    : false;

  const microphoneStatusLabel = microphoneGranted
    ? 'Permitido'
    : !nativeAndroid && webMediaPerms.microphone === 'denied'
    ? 'Bloqueado'
    : 'Pendente';

  const cameraStatusLabel = cameraGranted
    ? 'Permitida'
    : !nativeAndroid && webMediaPerms.camera === 'denied'
    ? 'Bloqueada'
    : 'Pendente';

  const showPermissions = mode === 'all' || mode === 'permissions';
  const showVault = mode === 'all' || mode === 'vault';
  const showLogs = mode === 'all' || mode === 'logs';

  return (
    <section
      className={`${mode === 'all' ? 'pt-4 border-t border-zinc-100 dark:border-zinc-800 ' : ''}space-y-3`}
    >
      {showPermissions && (
        <>
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-semibold text-zinc-500 dark:text-zinc-400">
              {nativeAndroid ? 'Permissões do Android' : 'Permissões do navegador'}
            </span>
            {nativeAndroid && (
              <button
                type="button"
                onClick={() => {
                  hapticSelection();
                  void refreshAndroidPermissions();
                }}
                className="text-xs font-semibold text-indigo-600 dark:text-indigo-400 inline-flex items-center gap-1 cursor-pointer min-h-[32px] px-1.5"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                <span>Atualizar</span>
              </button>
            )}
          </div>

          {/* Permissões Android & Canal de Notificações */}
          <div className="p-3.5 rounded-2xl border border-zinc-200/80 dark:border-zinc-800 space-y-2.5">
        {/* 1. Notificações */}
        <div className="flex items-center justify-between gap-2.5">
          <div className="flex items-center gap-2 min-w-0">
            <BellRing
              className={`w-4 h-4 shrink-0 ${
                notificationsGranted ? 'text-emerald-500' : 'text-amber-500'
              }`}
            />
            <div className="min-w-0">
              <span className="text-xs font-semibold text-zinc-900 dark:text-zinc-100 block">
                Notificações · {notificationsGranted ? 'Permitidas' : 'Bloqueadas'}
              </span>
              <span className="text-[11px] text-zinc-500 dark:text-zinc-400 block truncate">
                Canais separados de tarefas e finanças
              </span>
            </div>
          </div>
          {!notificationsGranted && (
            <button
              type="button"
              onClick={() => {
                if (nativeAndroid && notificationPermission === 'denied') {
                  void openAndroidSettings('notifications');
                } else {
                  void enableNotifications().then((ok) => {
                    if (!ok && nativeAndroid) {
                      void openAndroidSettings('notifications');
                    }
                  });
                }
              }}
              className="pressable min-h-[34px] px-2.5 rounded-lg bg-amber-600 hover:bg-amber-700 text-white text-[11px] font-semibold shrink-0 cursor-pointer"
            >
              {nativeAndroid ? 'Abrir config.' : 'Permitir'}
            </button>
          )}
        </div>

        {/* 2. Alarmes Exatos (Android 12+) */}
        {nativeAndroid && (
          <div className="flex items-center justify-between gap-2.5 pt-2 border-t border-zinc-100 dark:border-zinc-800/80">
            <div className="flex items-center gap-2 min-w-0">
              <Clock
                className={`w-4 h-4 shrink-0 ${
                  exactAlarmsGranted ? 'text-emerald-500' : 'text-amber-500'
                }`}
              />
              <div className="min-w-0">
                <span className="text-xs font-semibold text-zinc-900 dark:text-zinc-100 block">
                  Alarmes em 2º plano · {exactAlarmsGranted ? 'Ativos' : 'Restritos'}
                </span>
                <span className="text-[11px] text-zinc-500 dark:text-zinc-400 block truncate">
                  Garante lembretes na hora exata com tela apagada
                </span>
              </div>
            </div>
            {!exactAlarmsGranted && (
              <button
                type="button"
                onClick={() => void openAndroidSettings('exactAlarms')}
                className="pressable min-h-[34px] px-2.5 rounded-lg bg-amber-600 hover:bg-amber-700 text-white text-[11px] font-semibold shrink-0 cursor-pointer"
              >
                Abrir config.
              </button>
            )}
          </div>
        )}

        {/* 3. Microfone (Notas de voz nos rascunhos) */}
        <div className="flex items-center justify-between gap-2.5 pt-2 border-t border-zinc-100 dark:border-zinc-800/80">
          <div className="flex items-center gap-2 min-w-0">
            <Mic
              className={`w-4 h-4 shrink-0 ${
                microphoneGranted ? 'text-emerald-500' : 'text-amber-500'
              }`}
            />
            <div className="min-w-0">
              <span className="text-xs font-semibold text-zinc-900 dark:text-zinc-100 block">
                Microfone · {microphoneStatusLabel}
              </span>
              <span className="text-[11px] text-zinc-500 dark:text-zinc-400 block truncate">
                Gravação de notas de voz nos rascunhos
              </span>
            </div>
          </div>
          {!microphoneGranted && (
            <button
              type="button"
              disabled={requestingMedia === 'microphone'}
              onClick={() => void handleRequestMediaAccess('microphone')}
              className="pressable min-h-[34px] px-2.5 rounded-lg bg-amber-600 hover:bg-amber-700 disabled:opacity-50 text-white text-[11px] font-semibold shrink-0 cursor-pointer"
            >
              {requestingMedia === 'microphone' ? 'Pedindo...' : 'Permitir'}
            </button>
          )}
        </div>

        {/* 4. Câmera (Notas fiscais e anexos de foto) */}
        <div className="flex items-center justify-between gap-2.5 pt-2 border-t border-zinc-100 dark:border-zinc-800/80">
          <div className="flex items-center gap-2 min-w-0">
            <Camera
              className={`w-4 h-4 shrink-0 ${
                cameraGranted ? 'text-emerald-500' : 'text-zinc-400'
              }`}
            />
            <div className="min-w-0">
              <span className="text-xs font-semibold text-zinc-900 dark:text-zinc-100 block">
                Câmera · {cameraStatusLabel}
              </span>
              <span className="text-[11px] text-zinc-500 dark:text-zinc-400 block truncate">
                Fotos diretas de notas fiscais e anexos
              </span>
            </div>
          </div>
          {!cameraGranted && (
            <button
              type="button"
              disabled={requestingMedia === 'camera'}
              onClick={() => void handleRequestMediaAccess('camera')}
              className="pressable min-h-[34px] px-2.5 rounded-lg border border-zinc-200 dark:border-zinc-700 hover:bg-zinc-50 dark:hover:bg-zinc-800 disabled:opacity-50 text-zinc-700 dark:text-zinc-200 text-[11px] font-semibold shrink-0 cursor-pointer"
            >
              {requestingMedia === 'camera' ? 'Pedindo...' : 'Permitir'}
            </button>
          )}
        </div>

        {/* 3. Leitura Bancária */}
        {nativeAndroid && (
          <div className="flex items-center justify-between gap-2.5 pt-2 border-t border-zinc-100 dark:border-zinc-800/80">
            <div className="flex items-center gap-2 min-w-0">
              <ShieldCheck
                className={`w-4 h-4 shrink-0 ${
                  bankListenerGranted ? 'text-emerald-500' : 'text-zinc-400'
                }`}
              />
              <div className="min-w-0">
                <span className="text-xs font-semibold text-zinc-900 dark:text-zinc-100 block">
                  Leitor bancário · {bankListenerGranted ? 'Ativo' : 'Desativado'}
                </span>
                <span className="text-[11px] text-zinc-500 dark:text-zinc-400 block truncate">
                  Captura opcional de alertas de bancos
                </span>
              </div>
            </div>
            {!bankListenerGranted && (
              <button
                type="button"
                onClick={() => void openAndroidSettings('bankListener')}
                className="pressable min-h-[34px] px-2.5 rounded-lg border border-zinc-200 dark:border-zinc-700 text-zinc-700 dark:text-zinc-200 text-[11px] font-semibold shrink-0 cursor-pointer"
              >
                Abrir config.
              </button>
            )}
          </div>
        )}

        {/* 4. Instalação de Atualizações (apenas variante githubApk) */}
        {nativeAndroid && distributionChannel === 'githubApk' && (
          <div className="flex items-center justify-between gap-2.5 pt-2 border-t border-zinc-100 dark:border-zinc-800/80">
            <div className="flex items-center gap-2 min-w-0">
              <Package
                className={`w-4 h-4 shrink-0 ${
                  installPackagesGranted ? 'text-emerald-500' : 'text-amber-500'
                }`}
              />
              <div className="min-w-0">
                <span className="text-xs font-semibold text-zinc-900 dark:text-zinc-100 block">
                  Instalação in-app · {installPackagesGranted ? 'Permitida' : 'Pendente'}
                </span>
                <span className="text-[11px] text-zinc-500 dark:text-zinc-400 block truncate">
                  Permite atualizar por cima sem desinstalar
                </span>
              </div>
            </div>
            {!installPackagesGranted && (
              <button
                type="button"
                onClick={() => void openAndroidSettings('installPackages')}
                className="pressable min-h-[34px] px-2.5 rounded-lg bg-amber-600 hover:bg-amber-700 text-white text-[11px] font-semibold shrink-0 cursor-pointer"
              >
                Abrir config.
              </button>
            )}
          </div>
        )}

        {nativeAndroid && (
          <div className="pt-2 border-t border-zinc-100 dark:border-zinc-800/80 flex items-center justify-between gap-2">
            <span className="text-[11px] text-zinc-500 dark:text-zinc-400">
              Canal: APK Direto (GitHub)
            </span>
            <button
              type="button"
              onClick={() => void openAndroidSettings('appDetails')}
              className="text-[11px] font-semibold text-zinc-600 dark:text-zinc-300 hover:text-indigo-600 inline-flex items-center gap-1 cursor-pointer"
            >
              <Settings className="w-3 h-3" />
              <span>Ajustes do app no Android</span>
            </button>
          </div>
        )}
          </div>
        </>
      )}

      {/* Cofre & Integridade dos Dados */}
      {showVault && (
        <div className="p-3.5 rounded-2xl border border-zinc-200/80 dark:border-zinc-800 flex items-start gap-2.5">
          <HardDrive className="w-4 h-4 text-indigo-500 shrink-0 mt-0.5" />
          <div className="min-w-0 flex-1 space-y-0.5">
            <div className="flex flex-wrap items-center justify-between gap-1">
              <span className="text-xs font-bold text-zinc-900 dark:text-zinc-100">
                Cofre Local & Integridade
              </span>
              {vaultStatus.checksum && (
                <span className="text-[11px] font-mono tabular-nums text-zinc-400">
                  {formatBytes(vaultStatus.byteSize)} · #{vaultStatus.checksum}
                </span>
              )}
            </div>
            <p className="text-[11px] text-zinc-500 dark:text-zinc-400 leading-relaxed">
              {nativeAndroid
                ? 'Espelhamento atômico cifrado (AES-256-GCM via Android Keystore) no armazenamento privado do aparelho, com backup automático e sem permissão de extração ADB.'
                : 'Validação estrutural em runtime, sanitização e deduplicação automática ativas no armazenamento local.'}
            </p>
            {vaultStatus.recoveredFromNative && (
              <p className="text-[11px] font-medium text-emerald-600 dark:text-emerald-400 flex items-center gap-1 pt-0.5">
                <CheckCircle2 className="w-3.5 h-3.5" />
                <span>Dados recuperados automaticamente do cofre interno nesta sessão.</span>
              </p>
            )}
          </div>
        </div>
      )}

      {/* Diário de Erros Local & Envio de Relatórios */}
      {showLogs && (
        <div className="p-3.5 rounded-2xl border border-zinc-200/80 dark:border-zinc-800 space-y-2.5">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <FileWarning
              className={`w-4 h-4 shrink-0 ${
                journalEntries.length > 0 ? 'text-amber-500' : 'text-emerald-500'
              }`}
            />
            <span className="text-xs font-bold text-zinc-900 dark:text-zinc-100">
              Diário de Erros · {journalEntries.length} registro(s)
            </span>
          </div>
          <button
            type="button"
            onClick={() => {
              hapticSelection();
              setShowErrorLogList((prev) => !prev);
            }}
            className="text-[11px] font-semibold text-indigo-600 dark:text-indigo-400 hover:underline cursor-pointer"
          >
            {showErrorLogList ? 'Ocultar' : 'Ver registros'}
          </button>
        </div>

        <label className="flex items-center justify-between gap-2 text-[11px] text-zinc-600 dark:text-zinc-300 cursor-pointer">
          <span>Enviar relatórios sanitizados automaticamente quando online</span>
          <input
            type="checkbox"
            checked={autoReport}
            onChange={(e) => handleToggleAutoReport(e.target.checked)}
            className="w-4 h-4 rounded accent-indigo-600 shrink-0"
          />
        </label>

        {diagMessage && (
          <p className="text-[11px] font-medium text-indigo-700 dark:text-indigo-300 bg-indigo-50/80 dark:bg-indigo-950/30 border border-indigo-200 dark:border-indigo-800/70 rounded-xl px-3 py-2">
            {diagMessage}
          </p>
        )}

        <div className="flex flex-wrap gap-1.5">
          <button
            type="button"
            onClick={handleExportLog}
            className="pressable min-h-[36px] px-3 rounded-xl border border-zinc-200 dark:border-zinc-700 hover:bg-zinc-50 dark:hover:bg-zinc-800 text-[11px] font-semibold text-zinc-700 dark:text-zinc-200 inline-flex items-center gap-1.5 cursor-pointer"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Exportar log</span>
          </button>

          <button
            type="button"
            onClick={() => void handleSendReportToServer()}
            disabled={isSendingReport || !isOnline}
            className="pressable min-h-[36px] px-3 rounded-xl bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-[11px] font-semibold inline-flex items-center gap-1.5 cursor-pointer"
          >
            <Send className="w-3.5 h-3.5" />
            <span>{isSendingReport ? 'Enviando...' : 'Enviar relatório'}</span>
          </button>

          <a
            href={mailtoUrl}
            className="pressable min-h-[36px] px-3 rounded-xl border border-zinc-200 dark:border-zinc-700 hover:bg-zinc-50 dark:hover:bg-zinc-800 text-[11px] font-semibold text-zinc-700 dark:text-zinc-200 inline-flex items-center gap-1.5"
          >
            <Mail className="w-3.5 h-3.5" />
            <span>E-mail</span>
          </a>

          {journalEntries.length > 0 && (
            <button
              type="button"
              onClick={() => {
                hapticSelection();
                clearErrorJournal();
                setDiagMessage('Diário de erros limpo.');
              }}
              className="pressable min-h-[36px] px-2.5 rounded-xl text-[11px] font-semibold text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/30 inline-flex items-center gap-1 cursor-pointer"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>Limpar</span>
            </button>
          )}
        </div>

        {showErrorLogList && (
          <div className="pt-2 border-t border-zinc-100 dark:border-zinc-800 space-y-2 max-h-48 overflow-y-auto">
            {journalEntries.length === 0 ? (
              <p className="text-[11px] text-zinc-500 dark:text-zinc-400">
                Nenhuma falha registrada localmente.
              </p>
            ) : (
              journalEntries.slice(0, 15).map((item) => (
                <div
                  key={item.id}
                  className="p-2.5 rounded-xl bg-zinc-50 dark:bg-zinc-950/60 border border-zinc-200/70 dark:border-zinc-800 space-y-1"
                >
                  <div className="flex items-center justify-between gap-2 text-[10px] font-mono tabular-nums text-zinc-500">
                    <span className="truncate font-semibold text-amber-600 dark:text-amber-400 inline-flex items-center gap-1">
                      <AlertTriangle className="w-3 h-3 shrink-0" />
                      {item.source}
                    </span>
                    <span className="shrink-0">
                      {new Date(item.timestamp).toLocaleString('pt-BR')}
                    </span>
                  </div>
                  <p className="text-[11px] font-mono text-zinc-700 dark:text-zinc-300 break-words">
                    {item.message}
                  </p>
                </div>
              ))
            )}
          </div>
        )}
        </div>
      )}
    </section>
  );
};
