import React, { useEffect, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import {
  AlertCircle,
  AlertTriangle,
  CalendarPlus,
  Eye,
  EyeOff,
  FileKey2,
  FileText,
  Lock,
  Receipt,
  RefreshCw,
  RotateCcw,
  Share2,
  ShieldCheck,
  Upload,
  Wallet,
  X,
} from 'lucide-react';
import { useApp, useFinance, usePlanner, useWorkspace } from '../../context/AppContext';
import { useBackHandler } from '../../context/BackNavigationContext';
import {
  addIncomingFileListener,
  consumePendingIncomingFile,
  IncomingFilePayload,
} from '../../services/appHealthBridge';
import { classifyIncomingFile } from '../../services/backupShareAndAudit';
import { parseBankNotificationText } from '../../services/bankNotificationParser';
import { hapticImpactLight, hapticSelection, hapticSuccess } from '../../services/hapticsService';
import { parseIcsToLocalEvents } from '../../services/icsCalendarService';
import { BackupCountsSummary } from '../../utils/backupSummary';

export function formatCountSummary(counts: {
  tasksCount: number;
  eventsCount?: number;
  transactionsCount: number;
  goalsCount: number;
  notesCount: number;
}): string {
  const parts: string[] = [];
  if (counts.tasksCount > 0) parts.push(`${counts.tasksCount} tarefa(s)`);
  if ((counts.eventsCount ?? 0) > 0) parts.push(`${counts.eventsCount} compromisso(s)`);
  if (counts.transactionsCount > 0) parts.push(`${counts.transactionsCount} lançamento(s)`);
  if (counts.goalsCount > 0) parts.push(`${counts.goalsCount} meta(s)`);
  if (counts.notesCount > 0) parts.push(`${counts.notesCount} rascunho(s)`);
  return parts.length > 0 ? parts.join(' · ') : 'Nenhum registro salvo';
}

export const StartFromScratchModal: React.FC = () => {
  const {
    isStartFromScratchOpen,
    closeStartFromScratchModal,
    resetWorkspaceToZero,
    tasks,
    localEvents,
    transactions,
    financialGoals,
    draftNotes,
  } = useApp();

  const [isResetting, setIsResetting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    if (isStartFromScratchOpen) {
      setIsResetting(false);
      setErrorMessage(null);
    }
  }, [isStartFromScratchOpen]);

  useBackHandler(isStartFromScratchOpen, () => {
    if (isResetting) return false;
    closeStartFromScratchModal();
    return true;
  });

  if (!isStartFromScratchOpen) return null;

  const localSummary = formatCountSummary({
    tasksCount: tasks.length,
    eventsCount: localEvents.length,
    transactionsCount: transactions.length,
    goalsCount: financialGoals.length,
    notesCount: draftNotes.length,
  });

  const handleConfirmReset = async () => {
    setIsResetting(true);
    setErrorMessage(null);
    try {
      await resetWorkspaceToZero();
      closeStartFromScratchModal();
    } catch (err: any) {
      setErrorMessage(
        err?.message || 'Não foi possível concluir a limpeza agora. Tente novamente.'
      );
    } finally {
      setIsResetting(false);
    }
  };

  return (
    <div
      onClick={(e) => {
        if (e.target === e.currentTarget && !isResetting) {
          hapticSelection();
          closeStartFromScratchModal();
        }
      }}
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/60 backdrop-blur-xs animate-backdrop-in keyboard-modal-backdrop"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="reset-scratch-title"
        className="w-full sm:max-w-md bg-white dark:bg-zinc-900 border-t sm:border border-zinc-200 dark:border-zinc-800 rounded-t-3xl sm:rounded-3xl shadow-2xl p-5 sm:p-6 pb-[max(1.25rem,env(safe-area-inset-bottom,0px))] sm:pb-6 keyboard-modal-sheet overflow-y-auto relative animate-bottom-sheet"
      >
        <div className="sm:hidden w-10 h-1 rounded-full bg-zinc-300 dark:bg-zinc-700 mx-auto mb-3 shrink-0" />
        <button
          type="button"
          onClick={closeStartFromScratchModal}
          disabled={isResetting}
          className="pressable absolute top-4 right-4 min-w-[44px] min-h-[44px] flex items-center justify-center rounded-full text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 cursor-pointer disabled:opacity-50"
          aria-label="Fechar"
        >
          <X className="w-5 h-5" />
        </button>

        <div className="flex items-start gap-3.5 pr-10">
          <div className="w-11 h-11 rounded-2xl bg-rose-100 dark:bg-rose-950/60 text-rose-600 dark:text-rose-400 flex items-center justify-center shrink-0">
            <AlertTriangle className="w-5 h-5" />
          </div>
          <div>
            <h3
              id="reset-scratch-title"
              className="text-lg font-bold text-zinc-900 dark:text-zinc-100 text-balance"
            >
              Recomeçar do zero?
            </h3>
            <p className="mt-1 text-xs sm:text-sm text-zinc-600 dark:text-zinc-400 leading-relaxed">
              Todos os registros salvos neste aparelho (incluindo o cofre local) serão apagados e o aplicativo voltará para a tela inicial.
            </p>
          </div>
        </div>

        <div className="mt-4 p-3.5 rounded-2xl bg-zinc-50 dark:bg-zinc-800/50 border border-zinc-200/80 dark:border-zinc-800 space-y-1 text-xs">
          <span className="font-semibold text-zinc-800 dark:text-zinc-200 block">
            Dados atuais no aparelho
          </span>
          <span className="text-zinc-600 dark:text-zinc-400 block tabular-nums">
            {localSummary}
          </span>
        </div>

        {errorMessage && (
          <p className="mt-3 text-xs font-medium text-rose-600 dark:text-rose-400 bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-900/50 rounded-xl px-3 py-2">
            {errorMessage}
          </p>
        )}

        <div className="mt-5 pt-3 border-t border-zinc-100 dark:border-zinc-800 flex items-center justify-end gap-2.5">
          <button
            type="button"
            onClick={() => {
              hapticSelection();
              closeStartFromScratchModal();
            }}
            disabled={isResetting}
            className="pressable min-h-[44px] px-4 py-2 rounded-xl text-xs sm:text-sm font-medium text-zinc-700 dark:text-zinc-300 bg-zinc-100 hover:bg-zinc-200 dark:bg-zinc-800 dark:hover:bg-zinc-700 cursor-pointer"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={handleConfirmReset}
            disabled={isResetting}
            className="pressable min-h-[44px] px-4 py-2 rounded-xl text-xs sm:text-sm font-semibold text-white bg-rose-600 hover:bg-rose-700 flex items-center gap-2 cursor-pointer disabled:opacity-60"
          >
            {isResetting ? (
              <>
                <RefreshCw className="w-4 h-4 animate-spin" />
                <span>Limpando...</span>
              </>
            ) : (
              <>
                <RotateCcw className="w-4 h-4" />
                <span>Recomeçar do zero</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};

interface EncryptedBackupExportModalProps {
  isOpen: boolean;
  onClose: () => void;
  onExported?: (delivery: 'native_share' | 'web_share' | 'download') => void;
  preferShareByDefault?: boolean;
}

export const EncryptedBackupExportModal: React.FC<EncryptedBackupExportModalProps> = ({
  isOpen,
  onClose,
  onExported,
  preferShareByDefault = false,
}) => {
  const { exportEncryptedBackup } = useWorkspace();
  const { tasks, localEvents, draftNotes } = usePlanner();
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPass, setShowPass] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const isNativeAndroid = Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android';

  useEffect(() => {
    if (isOpen) {
      setPassword('');
      setConfirmPassword('');
      setShowPass(false);
      setIsExporting(false);
      setErrorMsg(null);
    }
  }, [isOpen]);

  useBackHandler(isOpen, () => {
    if (isExporting) return false;
    onClose();
    return true;
  });

  if (!isOpen) return null;

  const runExport = async (share: boolean) => {
    const clean = password.trim();
    if (clean.length < 4) {
      setErrorMsg('Use uma senha de pelo menos 4 caracteres.');
      return;
    }
    if (clean !== confirmPassword.trim()) {
      setErrorMsg('As senhas digitadas não coincidem.');
      return;
    }

    setIsExporting(true);
    setErrorMsg(null);
    try {
      const delivery = await exportEncryptedBackup(clean, { share });
      hapticSuccess();
      onExported?.(delivery);
      onClose();
    } catch (err: any) {
      if (err?.name === 'AbortError') {
        setErrorMsg(null);
        return;
      }
      setErrorMsg(err?.message || 'Erro ao gerar backup cifrado.');
    } finally {
      setIsExporting(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await runExport(isNativeAndroid || preferShareByDefault);
  };

  return (
    <div
      onClick={(e) => {
        if (e.target === e.currentTarget && !isExporting) {
          hapticSelection();
          onClose();
        }
      }}
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/60 backdrop-blur-xs animate-backdrop-in keyboard-modal-backdrop"
    >
      <div className="w-full sm:max-w-md bg-white dark:bg-zinc-900 border-t sm:border border-zinc-200 dark:border-zinc-800 rounded-t-3xl sm:rounded-3xl shadow-2xl p-5 sm:p-6 pb-[max(1.25rem,env(safe-area-inset-bottom,0px))] sm:pb-6 keyboard-modal-sheet overflow-y-auto relative animate-bottom-sheet">
        <div className="sm:hidden w-10 h-1 rounded-full bg-zinc-300 dark:bg-zinc-700 mx-auto mb-3 shrink-0" />
        <button
          type="button"
          onClick={onClose}
          disabled={isExporting}
          aria-label="Fechar"
          className="pressable absolute top-4 right-4 min-w-[44px] min-h-[44px] flex items-center justify-center rounded-full text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 cursor-pointer"
        >
          <X className="w-5 h-5" />
        </button>

        <div className="flex items-start gap-3 pr-10">
          <div className="w-10 h-10 rounded-2xl bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-400 flex items-center justify-center shrink-0">
            <FileKey2 className="w-5 h-5" />
          </div>
          <div>
            <h3 className="text-base sm:text-lg font-bold text-zinc-900 dark:text-zinc-100">
              Criar Backup Cifrado (.lifeedy)
            </h3>
            <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5 leading-relaxed">
              Protegido por AES-256-GCM. Salve em uma pasta, envie para si mesmo ou guarde para trocar de aparelho.
            </p>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="mt-4 space-y-3.5">
          <div className="p-3 rounded-2xl bg-zinc-50 dark:bg-zinc-800/50 border border-zinc-200/70 dark:border-zinc-800 text-[11px] text-zinc-600 dark:text-zinc-300 flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
            <span>
              Incluirá {tasks.length} tarefa(s), {localEvents.length} evento(s) e {draftNotes.length} rascunho(s) mais suas finanças.
            </span>
          </div>

          <div className="space-y-1">
            <label className="block text-xs font-semibold text-zinc-700 dark:text-zinc-300">
              Senha de proteção *
            </label>
            <div className="relative">
              <Lock className="w-4 h-4 text-zinc-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
              <input
                type={showPass ? 'text' : 'password'}
                required
                minLength={4}
                autoFocus
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Mínimo 4 caracteres (recomendado 6+)"
                className="w-full h-11 pl-10 pr-11 text-sm rounded-xl bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-indigo-500/30"
              />
              <button
                type="button"
                onClick={() => setShowPass((p) => !p)}
                aria-label={showPass ? 'Ocultar senha' : 'Mostrar senha'}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1.5 text-zinc-400 hover:text-zinc-600 cursor-pointer"
              >
                {showPass ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          <div className="space-y-1">
            <label className="block text-xs font-semibold text-zinc-700 dark:text-zinc-300">
              Confirmar senha *
            </label>
            <input
              type={showPass ? 'text' : 'password'}
              required
              minLength={4}
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="Repita a senha"
              className="w-full h-11 px-3.5 text-sm rounded-xl bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-indigo-500/30"
            />
          </div>

          <p className="text-[11px] text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/30 border border-amber-200/80 dark:border-amber-900/50 rounded-xl px-3 py-2 leading-relaxed">
            Guarde esta senha em segurança: sem ela ninguém consegue abrir o arquivo cifrado.
          </p>

          {errorMsg && (
            <div className="flex items-start gap-2 text-xs font-medium text-rose-600 dark:text-rose-400 bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-900/50 rounded-xl px-3 py-2">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{errorMsg}</span>
            </div>
          )}

          <div className="pt-2 flex flex-wrap justify-end gap-2 border-t border-zinc-100 dark:border-zinc-800">
            <button
              type="button"
              onClick={onClose}
              disabled={isExporting}
              className="min-h-[44px] px-4 rounded-xl text-xs font-medium text-zinc-600 dark:text-zinc-300 cursor-pointer"
            >
              Cancelar
            </button>
            {!isNativeAndroid && typeof navigator !== 'undefined' && typeof navigator.share === 'function' && (
              <button
                type="button"
                onClick={() => void runExport(true)}
                disabled={isExporting || password.trim().length < 4}
                className="pressable min-h-[44px] px-4 rounded-xl border border-zinc-200 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-800 dark:text-zinc-200 text-xs font-semibold inline-flex items-center gap-1.5 disabled:opacity-50 cursor-pointer"
              >
                <Share2 className="w-3.5 h-3.5" />
                <span>Compartilhar</span>
              </button>
            )}
            <button
              type="submit"
              disabled={isExporting || password.trim().length < 4}
              className="pressable min-h-[44px] px-5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold inline-flex items-center gap-2 disabled:opacity-50 cursor-pointer"
            >
              {isExporting ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin" />
                  <span>Cifrando...</span>
                </>
              ) : isNativeAndroid ? (
                <>
                  <Share2 className="w-4 h-4" />
                  <span>Gerar e compartilhar</span>
                </>
              ) : (
                <span>Gerar e baixar</span>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

interface BackupImportModalProps {
  pendingFile: { name: string; size: number; content: string } | null;
  onClose: () => void;
  onImported?: (summary: BackupCountsSummary) => void;
  replaceWarning?: boolean;
}

export const BackupImportModal: React.FC<BackupImportModalProps> = ({
  pendingFile,
  onClose,
  onImported,
  replaceWarning = true,
}) => {
  const { inspectBackupBeforeImport, importBackupFromText } = useWorkspace();
  const [password, setPassword] = useState('');
  const [showPass, setShowPass] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const inspection = pendingFile ? inspectBackupBeforeImport(pendingFile.content) : null;

  useEffect(() => {
    if (pendingFile) {
      setPassword('');
      setShowPass(false);
      setIsImporting(false);
      setErrorMsg(null);
    }
  }, [pendingFile]);

  useBackHandler(Boolean(pendingFile), () => {
    if (isImporting) return false;
    onClose();
    return true;
  });

  if (!pendingFile || !inspection) return null;

  const handleConfirmImport = async (e: React.FormEvent) => {
    e.preventDefault();
    if (inspection.format === 'invalid') return;

    setIsImporting(true);
    setErrorMsg(null);
    hapticImpactLight();
    try {
      const res = await importBackupFromText(pendingFile.content, password);
      if (res.ok && res.summary) {
        onImported?.(res.summary);
        onClose();
      } else {
        setErrorMsg(res.error || 'Falha ao importar o backup.');
      }
    } finally {
      setIsImporting(false);
    }
  };

  return (
    <div
      onClick={(e) => {
        if (e.target === e.currentTarget && !isImporting) {
          hapticSelection();
          onClose();
        }
      }}
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/60 backdrop-blur-xs animate-backdrop-in keyboard-modal-backdrop"
    >
      <div className="w-full sm:max-w-md bg-white dark:bg-zinc-900 border-t sm:border border-zinc-200 dark:border-zinc-800 rounded-t-3xl sm:rounded-3xl shadow-2xl p-5 sm:p-6 pb-[max(1.25rem,env(safe-area-inset-bottom,0px))] sm:pb-6 keyboard-modal-sheet overflow-y-auto relative animate-bottom-sheet">
        <div className="sm:hidden w-10 h-1 rounded-full bg-zinc-300 dark:bg-zinc-700 mx-auto mb-3 shrink-0" />
        <button
          type="button"
          onClick={onClose}
          disabled={isImporting}
          aria-label="Fechar"
          className="pressable absolute top-4 right-4 min-w-[44px] min-h-[44px] flex items-center justify-center rounded-full text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 cursor-pointer"
        >
          <X className="w-5 h-5" />
        </button>

        <div className="flex items-start gap-3 pr-10">
          <div className="w-10 h-10 rounded-2xl bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-400 flex items-center justify-center shrink-0">
            <Upload className="w-5 h-5" />
          </div>
          <div className="min-w-0">
            <h3 className="text-base sm:text-lg font-bold text-zinc-900 dark:text-zinc-100">
              Restaurar Backup
            </h3>
            <p className="text-xs text-zinc-500 dark:text-zinc-400 truncate mt-0.5">
              {pendingFile.name} · {(pendingFile.size / 1024).toFixed(1)} KB
            </p>
          </div>
        </div>

        <form onSubmit={handleConfirmImport} className="mt-4 space-y-3.5">
          {inspection.format === 'invalid' ? (
            <div className="p-3.5 rounded-2xl bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-900/50 text-xs text-rose-700 dark:text-rose-300 flex items-start gap-2">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{inspection.error}</span>
            </div>
          ) : (
            <>
              <div className="p-3.5 rounded-2xl bg-zinc-50 dark:bg-zinc-800/50 border border-zinc-200/80 dark:border-zinc-800 space-y-1 text-xs">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold text-zinc-800 dark:text-zinc-200">
                    {inspection.format === 'encrypted'
                      ? 'Backup cifrado (.lifeedy · AES-256)'
                      : 'Backup JSON'}
                  </span>
                  {inspection.exportedAt && (
                    <span className="text-[11px] font-mono tabular-nums text-zinc-500">
                      {new Date(inspection.exportedAt).toLocaleDateString('pt-BR')}
                    </span>
                  )}
                </div>
                {inspection.summary && (
                  <p className="text-zinc-600 dark:text-zinc-400 tabular-nums">
                    {formatCountSummary(inspection.summary)}
                  </p>
                )}
              </div>

              {inspection.format === 'encrypted' && (
                <div className="space-y-1">
                  <label className="block text-xs font-semibold text-zinc-700 dark:text-zinc-300">
                    Senha do arquivo *
                  </label>
                  <div className="relative">
                    <Lock className="w-4 h-4 text-zinc-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                    <input
                      type={showPass ? 'text' : 'password'}
                      required
                      autoFocus
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="Digite a senha usada ao exportar"
                      className="w-full h-11 pl-10 pr-11 text-sm rounded-xl bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-indigo-500/30"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPass((p) => !p)}
                      aria-label={showPass ? 'Ocultar senha' : 'Mostrar senha'}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1.5 text-zinc-400 hover:text-zinc-600 cursor-pointer"
                    >
                      {showPass ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>
              )}

              {replaceWarning && (
                <p className="text-[11px] text-zinc-500 dark:text-zinc-400 leading-relaxed">
                  Ao confirmar, os dados atuais deste aparelho serão substituídos pelo conteúdo do backup.
                </p>
              )}
            </>
          )}

          {errorMsg && (
            <div className="flex items-start gap-2 text-xs font-medium text-rose-600 dark:text-rose-400 bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-900/50 rounded-xl px-3 py-2">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{errorMsg}</span>
            </div>
          )}

          <div className="pt-2 flex justify-end gap-2 border-t border-zinc-100 dark:border-zinc-800">
            <button
              type="button"
              onClick={onClose}
              disabled={isImporting}
              className="min-h-[44px] px-4 rounded-xl text-xs font-medium text-zinc-600 dark:text-zinc-300 cursor-pointer"
            >
              Cancelar
            </button>
            {inspection.format !== 'invalid' && (
              <button
                type="submit"
                disabled={isImporting || (inspection.format === 'encrypted' && !password.trim())}
                className="pressable min-h-[44px] px-5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold inline-flex items-center gap-2 disabled:opacity-50 cursor-pointer"
              >
                {isImporting ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin" />
                    <span>Restaurando...</span>
                  </>
                ) : (
                  <span>Restaurar agora</span>
                )}
              </button>
            )}
          </div>
        </form>
      </div>
    </div>
  );
};

function dataUrlToImageFile(dataUrl: string, fileName: string, mimeType: string): File | null {
  try {
    const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/i);
    if (!match) return null;
    const resolvedMime = mimeType || match[1] || 'image/jpeg';
    const binary = atob(match[2]);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    const cleanBaseName = (fileName || 'comprovante').replace(/[^a-zA-Z0-9._-]/g, '_');
    const safeName = cleanBaseName.includes('.') ? cleanBaseName : `${cleanBaseName}.jpg`;
    return new File([bytes], safeName, { type: resolvedMime });
  } catch {
    return null;
  }
}

interface IncomingFileCoordinatorProps {
  initialIncoming?: { file: IncomingFilePayload; id: number } | null;
  onImportedIcs?: () => void;
  onOpenReceiptImage?: (file: File) => void;
  onNavigateTab?: (tab: 'dashboard' | 'agenda' | 'financas') => void;
}

export const IncomingFileCoordinator: React.FC<IncomingFileCoordinatorProps> = ({
  initialIncoming,
  onImportedIcs,
  onOpenReceiptImage,
  onNavigateTab,
}) => {
  const { onboardingCompleted } = useWorkspace();
  const { importIcsCalendar, addDraftNote } = usePlanner();
  const { enqueueParsedBankText, formatMoney } = useFinance();
  const [pendingBackupFile, setPendingBackupFile] = useState<{
    name: string;
    size: number;
    content: string;
  } | null>(null);
  const [pendingIcsFile, setPendingIcsFile] = useState<{
    name: string;
    size: number;
    content: string;
    eventCount: number;
  } | null>(null);
  const [pendingImageFile, setPendingImageFile] = useState<{
    name: string;
    mimeType: string;
    size: number;
    dataUrl: string;
  } | null>(null);
  const [pendingSharedText, setPendingSharedText] = useState<{
    name: string;
    content: string;
    parsedBank: ReturnType<typeof parseBankNotificationText>;
  } | null>(null);
  const [icsImportError, setIcsImportError] = useState<string | null>(null);
  const [unsupportedFileName, setUnsupportedFileName] = useState<string | null>(null);
  const [incomingToast, setIncomingToast] = useState<string | null>(null);

  useEffect(() => {
    if (!incomingToast) return;
    const timer = window.setTimeout(() => setIncomingToast(null), 4000);
    return () => window.clearTimeout(timer);
  }, [incomingToast]);

  const handleIncomingPayload = React.useCallback((file: IncomingFilePayload) => {
    const kind = classifyIncomingFile({
      name: file.name,
      content: file.content,
      mimeType: file.mimeType,
      kind: file.kind,
    });
    if (kind === 'backup') {
      setPendingIcsFile(null);
      setPendingImageFile(null);
      setPendingSharedText(null);
      setUnsupportedFileName(null);
      setPendingBackupFile({
        name: file.name,
        size: file.size,
        content: file.content,
      });
      return;
    }

    if (kind === 'ics') {
      const parsed = parseIcsToLocalEvents(file.content);
      setPendingBackupFile(null);
      setPendingImageFile(null);
      setPendingSharedText(null);
      setUnsupportedFileName(null);
      setIcsImportError(
        parsed.events.length === 0
          ? 'Nenhum compromisso válido foi encontrado neste arquivo .ics.'
          : null
      );
      setPendingIcsFile({
        name: file.name,
        size: file.size,
        content: file.content,
        eventCount: parsed.events.length,
      });
      return;
    }

    if (kind === 'image') {
      setPendingBackupFile(null);
      setPendingIcsFile(null);
      setPendingSharedText(null);
      setUnsupportedFileName(null);
      setPendingImageFile({
        name: file.name || 'comprovante.jpg',
        mimeType: file.mimeType || 'image/jpeg',
        size: file.size,
        dataUrl: file.content,
      });
      return;
    }

    if (kind === 'text') {
      const cleanText = file.content.trim();
      const parsedBank = parseBankNotificationText({
        rawText: cleanText,
        source: 'manual',
        allowAmbiguous: false,
      });
      setPendingBackupFile(null);
      setPendingIcsFile(null);
      setPendingImageFile(null);
      setUnsupportedFileName(null);
      setPendingSharedText({
        name: file.name || 'Texto compartilhado',
        content: cleanText,
        parsedBank,
      });
      return;
    }

    setPendingBackupFile(null);
    setPendingIcsFile(null);
    setPendingImageFile(null);
    setPendingSharedText(null);
    setUnsupportedFileName(file.name);
  }, []);

  useEffect(() => {
    if (initialIncoming?.file) {
      handleIncomingPayload(initialIncoming.file);
    }
  }, [initialIncoming, handleIncomingPayload]);

  useEffect(() => {
    if (initialIncoming !== undefined) return;
    let active = true;
    let sub: { remove: () => Promise<void> } | null = null;

    consumePendingIncomingFile()
      .then((file) => {
        if (active && file) {
          handleIncomingPayload(file);
        }
      })
      .catch(() => {});

    addIncomingFileListener((file) => {
      if (active) {
        handleIncomingPayload(file);
      }
    })
      .then((s) => {
        sub = s;
      })
      .catch(() => {});

    return () => {
      active = false;
      if (sub) {
        void sub.remove();
      }
    };
  }, [handleIncomingPayload, initialIncoming]);

  useBackHandler(Boolean(pendingIcsFile), () => {
    setPendingIcsFile(null);
    return true;
  });

  useBackHandler(Boolean(pendingImageFile), () => {
    setPendingImageFile(null);
    return true;
  });

  useBackHandler(Boolean(pendingSharedText), () => {
    setPendingSharedText(null);
    return true;
  });

  useBackHandler(Boolean(unsupportedFileName), () => {
    setUnsupportedFileName(null);
    return true;
  });

  const handleConfirmIcsImport = () => {
    if (!pendingIcsFile) return;
    hapticImpactLight();
    const res = importIcsCalendar(pendingIcsFile.content);
    setPendingIcsFile(null);
    if (res.addedCount > 0 || res.duplicateCount > 0) {
      hapticSuccess();
    }
    if (res.addedCount > 0) {
      setIncomingToast(
        `${res.addedCount} compromisso(s) importado(s) na Agenda${
          res.duplicateCount > 0 ? ` (${res.duplicateCount} já existente(s))` : ''
        }.`
      );
    } else if (res.duplicateCount > 0) {
      setIncomingToast('Todos os compromissos deste arquivo já estavam na Agenda.');
    }
    onImportedIcs?.();
  };

  const handleOpenSharedReceipt = () => {
    if (!pendingImageFile) return;
    const converted = dataUrlToImageFile(
      pendingImageFile.dataUrl,
      pendingImageFile.name,
      pendingImageFile.mimeType
    );
    setPendingImageFile(null);
    if (!converted) {
      setIncomingToast('Não foi possível abrir esta imagem no leitor.');
      return;
    }
    hapticImpactLight();
    onOpenReceiptImage?.(converted);
  };

  const handleSaveSharedTextAsDraft = () => {
    if (!pendingSharedText) return;
    hapticImpactLight();
    const firstLine = pendingSharedText.content.split(/\r?\n/)[0]?.trim() || '';
    const title = firstLine.length > 0 ? firstLine.slice(0, 48) : 'Nota compartilhada';
    addDraftNote({
      title,
      content: pendingSharedText.content,
      kind: 'text',
    });
    setPendingSharedText(null);
    hapticSuccess();
    onNavigateTab?.('dashboard');
    setIncomingToast('Texto salvo nos seus Rascunhos.');
  };

  const handleSendSharedTextToFinance = () => {
    if (!pendingSharedText) return;
    hapticImpactLight();
    const queued = enqueueParsedBankText(
      pendingSharedText.content,
      pendingSharedText.parsedBank?.bankName
    );
    setPendingSharedText(null);
    if (queued) {
      hapticSuccess();
      onNavigateTab?.('financas');
      setIncomingToast('Comprovante enviado para revisão em Finanças.');
    } else {
      setIncomingToast('Não foi possível interpretar este comprovante.');
    }
  };

  return (
    <>
      <BackupImportModal
        pendingFile={pendingBackupFile}
        onClose={() => setPendingBackupFile(null)}
        onImported={(summary) => {
          setIncomingToast(`Backup restaurado: ${formatCountSummary(summary)}.`);
        }}
        replaceWarning={onboardingCompleted}
      />

      {pendingIcsFile && (
        <div
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              hapticSelection();
              setPendingIcsFile(null);
            }
          }}
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/60 backdrop-blur-xs animate-backdrop-in keyboard-modal-backdrop"
        >
          <div className="w-full sm:max-w-md bg-white dark:bg-zinc-900 border-t sm:border border-zinc-200 dark:border-zinc-800 rounded-t-3xl sm:rounded-3xl shadow-2xl p-5 sm:p-6 pb-[max(1.25rem,env(safe-area-inset-bottom,0px))] sm:pb-6 keyboard-modal-sheet overflow-y-auto relative animate-bottom-sheet">
            <div className="sm:hidden w-10 h-1 rounded-full bg-zinc-300 dark:bg-zinc-700 mx-auto mb-3 shrink-0" />
            <button
              type="button"
              onClick={() => setPendingIcsFile(null)}
              aria-label="Fechar"
              className="pressable absolute top-4 right-4 min-w-[44px] min-h-[44px] flex items-center justify-center rounded-full text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>

            <div className="flex items-start gap-3 pr-10">
              <div className="w-10 h-10 rounded-2xl bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-400 flex items-center justify-center shrink-0">
                <CalendarPlus className="w-5 h-5" />
              </div>
              <div className="min-w-0">
                <h3 className="text-base sm:text-lg font-bold text-zinc-900 dark:text-zinc-100">
                  Importar Agenda (.ics)
                </h3>
                <p className="text-xs text-zinc-500 dark:text-zinc-400 truncate mt-0.5">
                  {pendingIcsFile.name} · {(pendingIcsFile.size / 1024).toFixed(1)} KB
                </p>
              </div>
            </div>

            <div className="mt-4 p-3.5 rounded-2xl bg-zinc-50 dark:bg-zinc-800/50 border border-zinc-200/80 dark:border-zinc-800 text-xs text-zinc-700 dark:text-zinc-300 tabular-nums">
              {pendingIcsFile.eventCount > 0 ? (
                <span>
                  Encontrados <strong>{pendingIcsFile.eventCount}</strong> compromisso(s) neste calendário. Itens já existentes serão ignorados automaticamente.
                </span>
              ) : (
                <span className="text-rose-600 dark:text-rose-400">{icsImportError}</span>
              )}
            </div>

            <div className="mt-5 pt-3 border-t border-zinc-100 dark:border-zinc-800 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setPendingIcsFile(null)}
                className="min-h-[44px] px-4 rounded-xl text-xs font-medium text-zinc-600 dark:text-zinc-300 cursor-pointer"
              >
                Cancelar
              </button>
              {pendingIcsFile.eventCount > 0 && (
                <button
                  type="button"
                  onClick={handleConfirmIcsImport}
                  className="pressable min-h-[44px] px-5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold inline-flex items-center gap-2 cursor-pointer"
                >
                  <CalendarPlus className="w-4 h-4" />
                  <span>Importar na Agenda</span>
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {pendingImageFile && (
        <div
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              hapticSelection();
              setPendingImageFile(null);
            }
          }}
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/60 backdrop-blur-xs animate-backdrop-in keyboard-modal-backdrop"
        >
          <div className="w-full sm:max-w-md bg-white dark:bg-zinc-900 border-t sm:border border-zinc-200 dark:border-zinc-800 rounded-t-3xl sm:rounded-3xl shadow-2xl p-5 sm:p-6 pb-[max(1.25rem,env(safe-area-inset-bottom,0px))] sm:pb-6 keyboard-modal-sheet overflow-y-auto relative animate-bottom-sheet">
            <div className="sm:hidden w-10 h-1 rounded-full bg-zinc-300 dark:bg-zinc-700 mx-auto mb-3 shrink-0" />
            <button
              type="button"
              onClick={() => setPendingImageFile(null)}
              aria-label="Fechar"
              className="pressable absolute top-4 right-4 min-w-[44px] min-h-[44px] flex items-center justify-center rounded-full text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>

            <div className="flex items-start gap-3 pr-10">
              <div className="w-10 h-10 rounded-2xl bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-400 flex items-center justify-center shrink-0">
                <Receipt className="w-5 h-5" />
              </div>
              <div className="min-w-0">
                <h3 className="text-base sm:text-lg font-bold text-zinc-900 dark:text-zinc-100">
                  Ler Nota ou Cupom Compartilhado
                </h3>
                <p className="text-xs text-zinc-500 dark:text-zinc-400 truncate mt-0.5">
                  {pendingImageFile.name} · {Math.max(1, Math.round(pendingImageFile.size / 1024))} KB
                </p>
              </div>
            </div>

            <div className="mt-4 rounded-2xl overflow-hidden bg-zinc-100 dark:bg-zinc-800 border border-zinc-200/80 dark:border-zinc-800 flex items-center justify-center max-h-56">
              <img
                src={pendingImageFile.dataUrl}
                alt="Imagem compartilhada"
                className="max-h-56 w-auto object-contain"
              />
            </div>

            <div className="mt-5 pt-3 border-t border-zinc-100 dark:border-zinc-800 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setPendingImageFile(null)}
                className="min-h-[44px] px-4 rounded-xl text-xs font-medium text-zinc-600 dark:text-zinc-300 cursor-pointer"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleOpenSharedReceipt}
                className="pressable min-h-[44px] px-5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold inline-flex items-center gap-2 cursor-pointer"
              >
                <Receipt className="w-4 h-4" />
                <span>Escanear em Finanças</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {pendingSharedText && (
        <div
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              hapticSelection();
              setPendingSharedText(null);
            }
          }}
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/60 backdrop-blur-xs animate-backdrop-in keyboard-modal-backdrop"
        >
          <div className="w-full sm:max-w-md bg-white dark:bg-zinc-900 border-t sm:border border-zinc-200 dark:border-zinc-800 rounded-t-3xl sm:rounded-3xl shadow-2xl p-5 sm:p-6 pb-[max(1.25rem,env(safe-area-inset-bottom,0px))] sm:pb-6 keyboard-modal-sheet overflow-y-auto relative animate-bottom-sheet">
            <div className="sm:hidden w-10 h-1 rounded-full bg-zinc-300 dark:bg-zinc-700 mx-auto mb-3 shrink-0" />
            <button
              type="button"
              onClick={() => setPendingSharedText(null)}
              aria-label="Fechar"
              className="pressable absolute top-4 right-4 min-w-[44px] min-h-[44px] flex items-center justify-center rounded-full text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>

            <div className="flex items-start gap-3 pr-10">
              <div className="w-10 h-10 rounded-2xl bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-400 flex items-center justify-center shrink-0">
                <FileText className="w-5 h-5" />
              </div>
              <div className="min-w-0">
                <h3 className="text-base sm:text-lg font-bold text-zinc-900 dark:text-zinc-100">
                  Texto Recebido no Lifeedy
                </h3>
                <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
                  Escolha salvar como rascunho rápido ou enviar para Finanças.
                </p>
              </div>
            </div>

            <div className="mt-4 p-3 rounded-2xl bg-zinc-50 dark:bg-zinc-800/60 border border-zinc-200/80 dark:border-zinc-800 max-h-36 overflow-y-auto text-xs text-zinc-700 dark:text-zinc-300 whitespace-pre-wrap break-words">
              {pendingSharedText.content}
            </div>

            {pendingSharedText.parsedBank && (
              <div className="mt-3 p-3 rounded-2xl bg-emerald-50/90 dark:bg-emerald-950/30 border border-emerald-200/80 dark:border-emerald-900/50 text-xs flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-semibold text-emerald-900 dark:text-emerald-200 truncate">
                    {pendingSharedText.parsedBank.title}
                  </p>
                  <p className="text-[11px] text-emerald-700 dark:text-emerald-300">
                    {pendingSharedText.parsedBank.bankName} ·{' '}
                    {pendingSharedText.parsedBank.type === 'receita' ? 'Entrada' : 'Saída'}
                  </p>
                </div>
                <span className="font-bold text-emerald-700 dark:text-emerald-300 tabular-nums shrink-0">
                  {formatMoney(pendingSharedText.parsedBank.amount)}
                </span>
              </div>
            )}

            <div className="mt-5 pt-3 border-t border-zinc-100 dark:border-zinc-800 flex flex-wrap justify-end gap-2">
              <button
                type="button"
                onClick={handleSaveSharedTextAsDraft}
                className="pressable min-h-[44px] px-4 rounded-xl border border-zinc-200 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-800 text-xs font-semibold text-zinc-700 dark:text-zinc-200 inline-flex items-center gap-1.5 cursor-pointer"
              >
                <FileText className="w-3.5 h-3.5" />
                <span>Salvar Rascunho</span>
              </button>
              {pendingSharedText.parsedBank && (
                <button
                  type="button"
                  onClick={handleSendSharedTextToFinance}
                  className="pressable min-h-[44px] px-4 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer"
                >
                  <Wallet className="w-3.5 h-3.5" />
                  <span>Enviar p/ Finanças</span>
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {unsupportedFileName && (
        <div
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              setUnsupportedFileName(null);
            }
          }}
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/60 backdrop-blur-xs animate-backdrop-in"
        >
          <div className="w-full sm:max-w-md bg-white dark:bg-zinc-900 border-t sm:border border-zinc-200 dark:border-zinc-800 rounded-t-3xl sm:rounded-3xl shadow-2xl p-5 sm:p-6 pb-[max(1.25rem,env(safe-area-inset-bottom,0px))] sm:pb-6 relative animate-bottom-sheet space-y-4">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-2xl bg-amber-50 dark:bg-amber-950/50 text-amber-600 dark:text-amber-400 flex items-center justify-center shrink-0">
                <AlertCircle className="w-5 h-5" />
              </div>
              <div className="min-w-0">
                <h3 className="text-base font-bold text-zinc-900 dark:text-zinc-100">
                  Arquivo não reconhecido
                </h3>
                <p className="text-xs text-zinc-600 dark:text-zinc-400 mt-1 leading-relaxed break-words">
                  O arquivo <strong>{unsupportedFileName}</strong> não é um backup válido do Lifeedy (.lifeedy ou .json), calendário (.ics), imagem de cupom ou texto.
                </p>
              </div>
            </div>
            <div className="flex justify-end">
              <button
                type="button"
                onClick={() => setUnsupportedFileName(null)}
                className="pressable min-h-[44px] px-5 rounded-xl bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 text-xs font-semibold cursor-pointer"
              >
                Entendi
              </button>
            </div>
          </div>
        </div>
      )}
      {incomingToast && (
        <div
          role="status"
          aria-live="polite"
          className="fixed bottom-24 sm:bottom-6 left-1/2 -translate-x-1/2 z-50 max-w-sm w-[calc(100%-2rem)] bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 px-4 py-3 rounded-2xl shadow-xl border border-zinc-800 dark:border-zinc-200 flex items-center justify-between gap-3 animate-sheet-up"
        >
          <span className="text-xs font-medium leading-snug">{incomingToast}</span>
          <button
            type="button"
            onClick={() => setIncomingToast(null)}
            aria-label="Fechar aviso"
            className="text-zinc-400 hover:text-white dark:hover:text-zinc-900 p-1 rounded-lg cursor-pointer shrink-0"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}
    </>
  );
};
