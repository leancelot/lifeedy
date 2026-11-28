import React, { useEffect, useRef, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import { Browser } from '@capacitor/browser';
import {
  AlertCircle,
  Camera,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Copy,
  ExternalLink,
  Image as ImageIcon,
  Loader2,
  Pencil,
  QrCode,
  Receipt,
  RefreshCw,
  Send,
  ShieldCheck,
  Upload,
  X,
} from 'lucide-react';
import {
  formatDiagnosticsReport,
  ReceiptScanDiagnostics,
  ReceiptScanError,
  scanReceiptWithAI,
} from '../../services/receiptScannerService';
import { lookupNfceFromQrOrKey } from '../../services/nfceSefazLookupService';
import { NfceParsedReceipt } from '../../services/nfceSefazParser';
import { useFinance } from '../../context/AppContext';
import { useBackHandler } from '../../context/BackNavigationContext';
import { hapticSelection } from '../../services/hapticsService';
import {
  isAndroidNativeHealthSupported,
  openAndroidPermissionSettings,
  requestMediaPermission,
} from '../../services/appHealthBridge';
import { validateReceiptImageFile } from '../../utils/runtimeValidator';
import { formatLocalDateIso } from '../../utils/dateUtils';
import { FinanceCategory, Transaction } from '../../types';
import { triggerConfetti } from '../../utils/confettiEffect';
import { QrReceiptScannerView } from './QrReceiptScannerView';

interface ReceiptScannerModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialFile?: File | null;
  onConsumeInitialFile?: () => void;
  initialMode?: 'upload' | 'qr';
}

type ScanSourceType = 'ai' | 'offline_ocr' | 'manual' | 'sefaz_qr' | 'pix_qr';

interface SefazReviewMeta {
  sefazUrl?: string;
  sourceStatus?: NfceParsedReceipt['sourceStatus'];
  cnpj?: string;
  captchaBlocked?: boolean;
  cnaeDescription?: string;
}

export const ReceiptScannerModal: React.FC<ReceiptScannerModalProps> = ({
  isOpen,
  onClose,
  initialFile,
  onConsumeInitialFile,
  initialMode = 'upload',
}) => {
  const { addTransaction } = useFinance();

  const [step, setStep] = useState<'upload' | 'qr' | 'scanning' | 'review'>(() =>
    !initialFile && initialMode === 'qr' ? 'qr' : 'upload'
  );
  const [scanningMode, setScanningMode] = useState<'photo' | 'sefaz'>('photo');
  const [selectedImagePreview, setSelectedImagePreview] = useState<string | null>(null);
  const [lastFile, setLastFile] = useState<File | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [diagnostics, setDiagnostics] = useState<ReceiptScanDiagnostics | null>(null);
  const [scanSource, setScanSource] = useState<ScanSourceType>('ai');
  const [sefazMeta, setSefazMeta] = useState<SefazReviewMeta | null>(null);
  const [isLogExpanded, setIsLogExpanded] = useState(false);
  const [copiedLog, setCopiedLog] = useState(false);

  // Parsed Form fields
  const [title, setTitle] = useState('');
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState('');
  const [category, setCategory] = useState<FinanceCategory>('alimentacao');
  const [paymentMethod, setPaymentMethod] = useState<Transaction['paymentMethod']>('cartao_credito');
  const [notes, setNotes] = useState('');

  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);

  useBackHandler(isOpen, () => {
    if (step === 'scanning') return false;
    if (step === 'qr') {
      setStep('upload');
      setErrorMsg(null);
      return true;
    }
    handleClose();
    return true;
  });

  useEffect(() => {
    if (!isOpen) return;
    if (initialFile) {
      const fileToScan = initialFile;
      onConsumeInitialFile?.();
      void handleFileSelected(fileToScan);
    } else if (initialMode === 'qr') {
      setErrorMsg(null);
      setDiagnostics(null);
      setStep('qr');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, initialFile, initialMode]);

  if (!isOpen) return null;

  const handleFileSelected = async (file: File, forceServerRetry = false) => {
    if (!file) return;

    const validation = validateReceiptImageFile(file);
    if (!validation.ok) {
      setErrorMsg(validation.error || 'Arquivo de imagem inválido ou não permitido.');
      setStep('upload');
      return;
    }

    if (selectedImagePreview) {
      URL.revokeObjectURL(selectedImagePreview);
    }

    const previewUrl = URL.createObjectURL(file);
    setSelectedImagePreview(previewUrl);
    setLastFile(file);
    setErrorMsg(null);
    setDiagnostics(null);
    setSefazMeta(null);
    setIsLogExpanded(false);
    setCopiedLog(false);
    setScanningMode('photo');
    setStep('scanning');

    try {
      const result = await scanReceiptWithAI(file, { forceServerRetry });
      const { data, source, diagnostics: scanDiag, sefazMeta: resolvedSefazMeta } = result;

      setTitle(data.title);
      setAmount(data.amount > 0 ? data.amount.toFixed(2) : '');
      setDate(data.date);
      setCategory(data.category);
      setPaymentMethod(data.paymentMethod || 'cartao_credito');
      setNotes(data.notes || '');
      setScanSource(source);
      setSefazMeta(resolvedSefazMeta || null);
      setDiagnostics(scanDiag);

      setStep('review');
    } catch (err: any) {
      console.error('Falha ao escanear recibo:', err);
      if (err instanceof ReceiptScanError) {
        setDiagnostics(err.diagnostics);
      } else {
        setDiagnostics({
          timestamp: new Date().toISOString(),
          platform: typeof window !== 'undefined' ? window.location.origin : 'App',
          endpoint: '/api/gemini/parse-receipt',
          serverErrorSummary: err?.message || 'Erro desconhecido ao ler imagem',
          offlineAttempted: false,
          offlineStatus: 'failed',
        });
      }
      setErrorMsg(
        err?.message || 'Não foi possível ler a nota fiscal. Tente novamente ou preencha manualmente.'
      );
      setStep('upload');
    }
  };

  const handleQrDetected = async (rawQr: string) => {
    if (selectedImagePreview) {
      URL.revokeObjectURL(selectedImagePreview);
      setSelectedImagePreview(null);
    }
    setLastFile(null);
    setErrorMsg(null);
    setDiagnostics(null);
    setSefazMeta(null);
    setScanningMode('sefaz');
    setStep('scanning');

    try {
      const res = await lookupNfceFromQrOrKey(rawQr);
      setTitle(res.title);
      setAmount(res.amount > 0 ? res.amount.toFixed(2) : '');
      setDate(res.date || formatLocalDateIso());
      setCategory(res.category || 'outros');
      setPaymentMethod(res.paymentMethod || 'cartao_credito');
      setNotes(res.notes || '');
      setScanSource(res.sourceStatus === 'pix_qr' ? 'pix_qr' : 'sefaz_qr');
      setSefazMeta({
        sefazUrl: res.sefazUrl,
        sourceStatus: res.sourceStatus,
        cnpj: res.cnpj,
        captchaBlocked: res.captchaBlocked,
        cnaeDescription: res.cnaeDescription,
      });
      setStep('review');
    } catch (err: unknown) {
      const msg =
        err instanceof Error
          ? err.message
          : 'Não foi possível consultar a nota fiscal na Receita Federal/SEFAZ.';
      setErrorMsg(msg);
      setStep('qr');
    }
  };

  const handleRetryScan = () => {
    if (!lastFile) return;
    handleFileSelected(lastFile, true);
  };

  const handleManualFallback = () => {
    setErrorMsg(null);
    setSefazMeta(null);
    setTitle('');
    setAmount('');
    setDate(formatLocalDateIso());
    setCategory('alimentacao');
    setPaymentMethod('cartao_credito');
    setNotes('');
    setScanSource('manual');
    setStep('review');
  };

  const handleCopyLog = async () => {
    if (!diagnostics) return;
    const report = formatDiagnosticsReport(diagnostics);
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(report);
      } else {
        const textarea = document.createElement('textarea');
        textarea.value = report;
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand('copy');
        document.body.removeChild(textarea);
      }
      setCopiedLog(true);
      setTimeout(() => setCopiedLog(false), 2500);
    } catch (e) {
      console.warn('Não foi possível copiar o log:', e);
    }
  };

  const handleReportLog = async () => {
    if (!diagnostics) return;
    const report = formatDiagnosticsReport(diagnostics);

    if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
      try {
        await navigator.share({
          title: 'Log de Leitura de Nota Fiscal - Lifeedy',
          text: report,
        });
        return;
      } catch {
        // User cancelled or share unsupported for text -> fallback to mailto link below
      }
    }

    const subject = encodeURIComponent(
      `Relatório de Leitura NF (${diagnostics.errorCode || diagnostics.httpStatus || 'Erro'})`
    );
    const body = encodeURIComponent(report);
    const link = document.createElement('a');
    link.href = `mailto:?subject=${subject}&body=${body}`;
    link.click();
  };

  const resetAll = (targetStep: 'upload' | 'qr' = 'upload') => {
    if (selectedImagePreview) {
      URL.revokeObjectURL(selectedImagePreview);
    }
    setStep(targetStep);
    setSelectedImagePreview(null);
    setLastFile(null);
    setErrorMsg(null);
    setDiagnostics(null);
    setSefazMeta(null);
    setIsLogExpanded(false);
    setCopiedLog(false);
  };

  const handleClose = () => {
    resetAll('upload');
    onClose();
  };

  const handleConfirmAndSave = (e: React.FormEvent) => {
    e.preventDefault();
    const amountNum = parseFloat(amount.replace(',', '.'));
    if (!title.trim() || isNaN(amountNum) || amountNum <= 0) return;

    const fallbackNote =
      scanSource === 'sefaz_qr'
        ? 'Lançado via QR Code da Nota Fiscal (Receita Federal / SEFAZ)'
        : scanSource === 'pix_qr'
          ? 'Lançado via leitura de QR Code Pix'
          : scanSource === 'offline_ocr'
            ? 'Lançado via leitura offline de Nota Fiscal'
            : scanSource === 'manual'
              ? 'Lançado manualmente pelo leitor de Nota Fiscal'
              : 'Lançado automaticamente via leitura de Nota Fiscal por IA';

    addTransaction({
      type: 'despesa',
      title: title.trim(),
      amount: amountNum,
      category,
      date: date || formatLocalDateIso(),
      paymentMethod,
      notes: notes.trim() || fallbackNote,
      recurring: false,
    });

    triggerConfetti({ particleCount: 35, spread: 60, origin: { y: 0.7 } });
    resetAll('upload');
    onClose();
  };

  const renderExpandableDiagnostics = (variant: 'error' | 'warning') => {
    if (!diagnostics) return null;

    const borderClass =
      variant === 'error'
        ? 'border-rose-200 dark:border-rose-800/70'
        : 'border-amber-200 dark:border-amber-800/70';

    return (
      <div className={`pt-2 border-t ${borderClass} space-y-2.5`}>
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <button
            type="button"
            onClick={() => setIsLogExpanded((prev) => !prev)}
            className="inline-flex items-center gap-1 text-[11px] font-semibold underline cursor-pointer"
          >
            {isLogExpanded ? (
              <ChevronUp className="w-3.5 h-3.5" />
            ) : (
              <ChevronDown className="w-3.5 h-3.5" />
            )}
            <span>{isLogExpanded ? 'Ocultar detalhes técnicos' : 'Ver detalhes técnicos (Log)'}</span>
          </button>

          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={handleCopyLog}
              className="inline-flex items-center gap-1 px-2.5 py-1 min-h-[30px] rounded-lg border border-current/25 bg-white/80 dark:bg-zinc-900/70 text-[11px] font-semibold cursor-pointer hover:bg-white dark:hover:bg-zinc-900 transition-colors"
            >
              {copiedLog ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
              <span>{copiedLog ? 'Copiado!' : 'Copiar log'}</span>
            </button>

            <button
              type="button"
              onClick={handleReportLog}
              className="inline-flex items-center gap-1 px-2.5 py-1 min-h-[30px] rounded-lg border border-current/25 bg-white/80 dark:bg-zinc-900/70 text-[11px] font-semibold cursor-pointer hover:bg-white dark:hover:bg-zinc-900 transition-colors"
            >
              <Send className="w-3 h-3" />
              <span>Reportar</span>
            </button>
          </div>
        </div>

        {isLogExpanded && (
          <div className="p-3 rounded-xl bg-white/90 dark:bg-zinc-950/70 border border-zinc-200 dark:border-zinc-800 font-mono text-[11px] text-zinc-700 dark:text-zinc-300 space-y-1 break-all tabular-nums">
            <div>
              <strong>Plataforma:</strong> {diagnostics.platform}
            </div>
            <div>
              <strong>URL:</strong> {diagnostics.endpoint}
            </div>
            <div>
              <strong>HTTP / Código:</strong>{' '}
              {diagnostics.httpStatus !== undefined ? diagnostics.httpStatus : 'Sem resposta'}{' '}
              {diagnostics.errorCode ? `(${diagnostics.errorCode})` : ''}
            </div>
            <div>
              <strong>Servidor:</strong> {diagnostics.serverErrorSummary}
            </div>
            {diagnostics.serverResponseSnippet && (
              <div>
                <strong>Resposta:</strong> {diagnostics.serverResponseSnippet}
              </div>
            )}
            <div>
              <strong>OCR Offline:</strong> {diagnostics.offlineStatus}
              {diagnostics.offlineEngine ? ` (${diagnostics.offlineEngine})` : ''}
              {diagnostics.offlineDetail ? ` — ${diagnostics.offlineDetail}` : ''}
            </div>
          </div>
        )}
      </div>
    );
  };

  const renderSourceBadge = () => {
    if (scanSource === 'manual') {
      return (
        <div className="p-3 bg-zinc-50 dark:bg-zinc-800/60 border border-zinc-200 dark:border-zinc-700/70 rounded-2xl flex items-center gap-2 text-xs font-medium text-zinc-700 dark:text-zinc-300">
          <Pencil className="w-4 h-4 text-zinc-500 shrink-0" />
          <span>Preenchimento manual · Confira e complete os dados da nota</span>
        </div>
      );
    }

    if (scanSource === 'sefaz_qr' || scanSource === 'pix_qr') {
      const statusLabel =
        sefazMeta?.sourceStatus === 'sefaz_full'
          ? 'Dados oficiais obtidos da SEFAZ / Receita Federal'
          : sefazMeta?.sourceStatus === 'sefaz_partial_cnpj' || sefazMeta?.sourceStatus === 'cnpj_only'
            ? 'Empresa e categoria consultadas na Receita Federal (CNPJ)'
            : scanSource === 'pix_qr'
              ? 'Dados lidos do QR Code Pix'
              : 'Lido do QR Code da Nota Fiscal (NFC-e)';

      const needsAttention = Boolean(sefazMeta?.captchaBlocked || !amount);

      return (
        <div className="space-y-2">
          <div className="p-3 bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800 rounded-2xl flex items-center justify-between gap-2 text-xs font-medium text-emerald-800 dark:text-emerald-300">
            <div className="flex items-center gap-2 min-w-0">
              <ShieldCheck className="w-4 h-4 text-emerald-600 shrink-0" />
              <span className="truncate">{statusLabel}</span>
            </div>

            {sefazMeta?.sefazUrl && (
              Capacitor.isNativePlatform() ? (
                <button
                  type="button"
                  onClick={() => {
                    if (sefazMeta.sefazUrl) {
                      void Browser.open({ url: sefazMeta.sefazUrl });
                    }
                  }}
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-emerald-600/10 hover:bg-emerald-600/20 text-emerald-700 dark:text-emerald-300 text-[11px] font-semibold shrink-0 cursor-pointer"
                >
                  <span>SEFAZ</span>
                  <ExternalLink className="w-3 h-3" />
                </button>
              ) : (
                <a
                  href={sefazMeta.sefazUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-emerald-600/10 hover:bg-emerald-600/20 text-emerald-700 dark:text-emerald-300 text-[11px] font-semibold shrink-0"
                >
                  <span>SEFAZ</span>
                  <ExternalLink className="w-3 h-3" />
                </a>
              )
            )}
          </div>

          {needsAttention && (
            <div className="px-3 py-2 rounded-xl bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800/70 text-[11px] text-amber-800 dark:text-amber-300">
              {sefazMeta?.captchaBlocked
                ? 'O portal estadual da SEFAZ pediu verificação humana (CAPTCHA). Já preenchemos os dados pela Receita Federal — confira o valor total antes de salvar.'
                : 'Este QR Code não traz o valor embutido na URL. Confira ou digite o valor total pago.'}
            </div>
          )}
        </div>
      );
    }

    return (
      <div className="p-3 bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800 rounded-2xl flex items-center justify-between gap-2 text-xs font-medium text-emerald-800 dark:text-emerald-300">
        <div className="flex items-center gap-2 min-w-0">
          <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
          <span className="truncate">Nota pronta para conferência</span>
        </div>
        <span className="text-[11px] font-medium text-emerald-700/80 dark:text-emerald-400/90 whitespace-nowrap shrink-0">
          {scanSource === 'offline_ocr' ? '· Leitura offline' : '· Leitura por IA'}
        </span>
      </div>
    );
  };

  return (
    <div
      onClick={(e) => {
        if (e.target === e.currentTarget && step !== 'scanning') {
          hapticSelection();
          handleClose();
        }
      }}
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/60 backdrop-blur-xs animate-backdrop-in keyboard-modal-backdrop"
    >
      <div className="w-full sm:max-w-xl bg-white dark:bg-zinc-900 border-t sm:border border-zinc-200 dark:border-zinc-800 rounded-t-3xl sm:rounded-3xl shadow-2xl p-5 sm:p-8 pb-[max(1.25rem,env(safe-area-inset-bottom,0px))] sm:pb-8 keyboard-modal-sheet overflow-y-auto relative animate-bottom-sheet">
        <div className="sm:hidden w-10 h-1 rounded-full bg-zinc-300 dark:bg-zinc-700 mx-auto mb-3 shrink-0" />
        <button
          onClick={handleClose}
          className="pressable absolute top-5 right-5 p-1.5 rounded-full text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 cursor-pointer"
          aria-label="Fechar"
        >
          <X className="w-5 h-5" />
        </button>

        {/* Modal Header */}
        <div className="flex items-center gap-3 mb-5">
          <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-[#DC7B62] to-[#BE6272] dark:from-[#F2A68E] dark:to-[#E69BA7] text-white dark:text-[#24120E] flex items-center justify-center shadow-md shadow-indigo-500/20 shrink-0">
            {step === 'qr' ? <QrCode className="w-6 h-6" /> : <Receipt className="w-6 h-6" />}
          </div>
          <div>
            <h3 className="text-xl font-bold text-zinc-900 dark:text-zinc-100">
              {step === 'qr' ? 'QR Code da Nota Fiscal' : 'Leitor de Nota Fiscal'}
            </h3>
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              {step === 'qr'
                ? 'Escaneie o QR da NFC-e para puxar os dados da Receita Federal / SEFAZ'
                : 'Leia pelo QR Code da Receita Federal ou envie a foto do comprovante'}
            </p>
          </div>
        </div>

        {errorMsg && (
          <div className="mb-4 p-4 rounded-2xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 space-y-3 text-xs text-rose-800 dark:text-rose-200">
            <div className="flex items-start gap-2.5">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-rose-600 dark:text-rose-400" />
              <div className="flex-1">
                <span className="font-semibold block">Erro na leitura</span>
                <span>{errorMsg}</span>
              </div>
            </div>

            {step === 'upload' && (
              <div className="flex items-center gap-2 flex-wrap pl-6">
                {lastFile && (
                  <button
                    type="button"
                    onClick={handleRetryScan}
                    className="pressable inline-flex items-center gap-1.5 px-3 py-1.5 min-h-[36px] rounded-xl bg-rose-600 hover:bg-rose-700 text-white font-semibold cursor-pointer"
                  >
                    <RefreshCw className="w-3.5 h-3.5" />
                    <span>Tentar novamente</span>
                  </button>
                )}
                <button
                  type="button"
                  onClick={handleManualFallback}
                  className="pressable inline-flex items-center gap-1.5 px-3 py-1.5 min-h-[36px] rounded-xl border border-rose-300 dark:border-rose-700 bg-white dark:bg-zinc-900 text-rose-700 dark:text-rose-300 hover:bg-rose-100/60 dark:hover:bg-rose-950/50 font-semibold cursor-pointer"
                >
                  <Pencil className="w-3.5 h-3.5" />
                  <span>Preencher manualmente</span>
                </button>
              </div>
            )}

            {renderExpandableDiagnostics('error')}
          </div>
        )}

        {/* STEP 1: Upload or Snap Photo */}
        {step === 'upload' && (
          <div className="space-y-4">
            <button
              type="button"
              onClick={() => {
                setErrorMsg(null);
                setDiagnostics(null);
                hapticSelection();
                setStep('qr');
              }}
              className="pressable w-full flex items-center justify-between gap-3 p-4 rounded-2xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 text-white shadow-md shadow-emerald-600/20 cursor-pointer text-left"
            >
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-10 h-10 rounded-xl bg-white/15 flex items-center justify-center shrink-0">
                  <QrCode className="w-5 h-5" />
                </div>
                <div className="min-w-0">
                  <span className="block text-sm font-bold truncate">
                    Ler QR Code da Nota (Receita Federal)
                  </span>
                  <span className="block text-[11px] text-emerald-50/90 truncate">
                    Puxa estabelecimento, valor, itens e categoria direto da SEFAZ
                  </span>
                </div>
              </div>
              <span className="px-2.5 py-1 rounded-lg bg-white/20 text-[11px] font-bold shrink-0">
                Abrir
              </span>
            </button>

            <div
              onClick={() => fileInputRef.current?.click()}
              className="border-2 border-dashed border-zinc-200 dark:border-zinc-700 hover:border-indigo-500 dark:hover:border-indigo-500 rounded-3xl p-7 text-center cursor-pointer transition-colors bg-zinc-50/50 dark:bg-zinc-800/40 flex flex-col items-center justify-center gap-3"
            >
              <div className="w-12 h-12 rounded-2xl bg-indigo-50 dark:bg-indigo-950/40 text-indigo-600 dark:text-indigo-400 flex items-center justify-center">
                <Upload className="w-6 h-6" />
              </div>
              <div>
                <p className="text-sm font-bold text-zinc-800 dark:text-zinc-200">
                  Ou clique para enviar foto da Nota Fiscal
                </p>
                <p className="text-xs text-zinc-400 mt-1">
                  Suporta cupons (NFC-e, SAT), DANFE e recibos em PNG, JPG ou WEBP
                </p>
              </div>
            </div>

            {errorMsg && isAndroidNativeHealthSupported() && (
              <div className="flex items-center justify-end">
                <button
                  type="button"
                  onClick={() => void openAndroidPermissionSettings('appDetails')}
                  className="px-2.5 py-1 rounded-lg bg-rose-600 hover:bg-rose-700 text-white text-[11px] font-semibold shrink-0 cursor-pointer"
                >
                  Abrir ajustes de câmera
                </button>
              </div>
            )}

            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={async () => {
                  setErrorMsg(null);
                  if (isAndroidNativeHealthSupported()) {
                    const perm = await requestMediaPermission('camera');
                    if (!perm.granted) {
                      setErrorMsg('Permita o acesso à câmera para fotografar notas fiscais.');
                      return;
                    }
                  }
                  cameraInputRef.current?.click();
                }}
                className="pressable flex items-center justify-center gap-2 py-3 px-4 min-h-[44px] rounded-2xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold shadow-md shadow-indigo-600/20 cursor-pointer"
              >
                <Camera className="w-4 h-4" />
                <span>Tirar Foto Agora</span>
              </button>

              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="pressable flex items-center justify-center gap-2 py-3 px-4 min-h-[44px] rounded-2xl border border-zinc-200 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-800 dark:text-zinc-200 text-xs font-semibold cursor-pointer"
              >
                <ImageIcon className="w-4 h-4 text-zinc-500" />
                <span>Escolher da Galeria</span>
              </button>
            </div>

            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) handleFileSelected(file);
              }}
            />
            <input
              ref={cameraInputRef}
              type="file"
              accept="image/*"
              capture="environment"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) handleFileSelected(file);
              }}
            />
          </div>
        )}

        {/* STEP 1B: Live QR Scanner + Photo/Key Fallback */}
        {step === 'qr' && (
          <QrReceiptScannerView
            onQrDetected={(rawQr) => void handleQrDetected(rawQr)}
            onBackToUpload={() => {
              setErrorMsg(null);
              setStep('upload');
            }}
          />
        )}

        {/* STEP 2: Scanning in Progress */}
        {step === 'scanning' && (
          <div className="py-12 flex flex-col items-center justify-center text-center space-y-4">
            <div className="w-16 h-16 rounded-2xl bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600 flex items-center justify-center">
              <Loader2 className="w-8 h-8 text-indigo-600 animate-spin" />
            </div>
            <div>
              <h4 className="text-base font-bold text-zinc-900 dark:text-zinc-100">
                {scanningMode === 'sefaz'
                  ? 'Consultando Receita Federal / SEFAZ...'
                  : 'Analisando sua Nota Fiscal...'}
              </h4>
              <p className="text-xs text-zinc-500 max-w-sm mx-auto mt-1">
                {scanningMode === 'sefaz'
                  ? 'Buscando estabelecimento, valor total, itens e categoria fiscal da NFC-e.'
                  : 'Extraindo estabelecimento, valor total, data de emissão e categoria da despesa.'}
              </p>
            </div>
            {selectedImagePreview && (
              <div className="w-32 h-32 rounded-xl overflow-hidden border border-zinc-200 dark:border-zinc-700 shadow-xs opacity-60">
                <img
                  src={selectedImagePreview}
                  alt="Prévia da nota"
                  className="w-full h-full object-cover"
                />
              </div>
            )}
          </div>
        )}

        {/* STEP 3: Review & Confirm */}
        {step === 'review' && (
          <form onSubmit={handleConfirmAndSave} className="space-y-4">
            {renderSourceBadge()}

            <div className="flex gap-4">
              {selectedImagePreview && (
                <div className="w-24 h-24 rounded-2xl overflow-hidden border border-zinc-200 dark:border-zinc-700 shrink-0">
                  <img
                    src={selectedImagePreview}
                    alt="Nota Fiscal"
                    className="w-full h-full object-cover"
                  />
                </div>
              )}

              <div className="flex-1">
                <label className="block text-xs font-semibold text-zinc-700 dark:text-zinc-300 mb-1">
                  Estabelecimento / Loja *
                </label>
                <input
                  type="text"
                  required
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="Nome do estabelecimento"
                  className="w-full px-3 py-2 text-sm rounded-xl bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 text-zinc-900 dark:text-zinc-100 font-semibold focus:outline-none"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-zinc-700 dark:text-zinc-300 mb-1">
                  Valor Total Pago (R$) *
                </label>
                <input
                  type="number"
                  step="0.01"
                  min="0.01"
                  required
                  placeholder="Valor"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  className="w-full px-3 py-2 text-base rounded-xl bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 text-rose-600 dark:text-rose-400 font-bold tabular-nums focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-zinc-700 dark:text-zinc-300 mb-1">
                  Data da Compra *
                </label>
                <input
                  type="date"
                  required
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  className="w-full px-3 py-2 text-sm rounded-xl bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 text-zinc-900 dark:text-zinc-100 focus:outline-none"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-zinc-700 dark:text-zinc-300 mb-1">
                  Categoria Sugerida
                </label>
                <select
                  value={category}
                  onChange={(e) => setCategory(e.target.value as FinanceCategory)}
                  className="w-full px-3 py-2 text-xs rounded-xl bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 text-zinc-900 dark:text-zinc-100 focus:outline-none capitalize"
                >
                  <option value="alimentacao">Alimentação</option>
                  <option value="transporte">Transporte</option>
                  <option value="moradia">Moradia & Contas</option>
                  <option value="saude">Saúde</option>
                  <option value="educacao">Educação</option>
                  <option value="lazer">Lazer</option>
                  <option value="outros">Outros</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-zinc-700 dark:text-zinc-300 mb-1">
                  Forma de Pagamento
                </label>
                <select
                  value={paymentMethod}
                  onChange={(e) =>
                    setPaymentMethod(e.target.value as Transaction['paymentMethod'])
                  }
                  className="w-full px-3 py-2 text-xs rounded-xl bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 text-zinc-900 dark:text-zinc-100 focus:outline-none"
                >
                  <option value="cartao_credito">Cartão de Crédito</option>
                  <option value="cartao_debito">Cartão de Débito</option>
                  <option value="pix">Pix</option>
                  <option value="dinheiro">Dinheiro</option>
                  <option value="transferencia">Transferência</option>
                </select>
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-zinc-700 dark:text-zinc-300 mb-1">
                Itens e Dados Fiscais Identificados
              </label>
              <textarea
                rows={2}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Itens ou observações do comprovante"
                className="w-full px-3 py-2 text-xs rounded-xl bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 text-zinc-900 dark:text-zinc-100 focus:outline-none resize-none"
              />
            </div>

            <div className="pt-3 border-t border-zinc-100 dark:border-zinc-800 flex items-center justify-between gap-2">
              <button
                type="button"
                onClick={() => resetAll(scanSource === 'sefaz_qr' || scanSource === 'pix_qr' ? 'qr' : 'upload')}
                className="pressable min-h-[40px] px-2 text-xs text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200 cursor-pointer whitespace-nowrap"
              >
                {scanSource === 'sefaz_qr' || scanSource === 'pix_qr' ? 'Ler outro QR' : 'Ler outra foto'}
              </button>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleClose}
                  className="pressable min-h-[44px] px-4 py-2 rounded-xl text-xs font-medium text-zinc-600 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="pressable min-h-[44px] px-5 py-2 rounded-xl text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-700 shadow-md shadow-emerald-600/20 cursor-pointer flex items-center gap-1.5 whitespace-nowrap"
                >
                  <CheckCircle2 className="w-4 h-4 shrink-0" />
                  <span>Confirmar e Lançar</span>
                </button>
              </div>
            </div>
          </form>
        )}
      </div>
    </div>
  );
};
