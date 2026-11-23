import React from 'react';
import {
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  Download,
  Mail,
  RefreshCw,
  Send,
} from 'lucide-react';
import { isDynamicImportError } from '../../utils/lazyWithRetry';
import { formatLocalDateIso } from '../../utils/dateUtils';
import {
  buildErrorReportMailtoUrl,
  recordAppError,
  sendDiagnosticReport,
} from '../../services/errorJournalService';

interface ErrorBoundaryProps {
  children: React.ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  errorMessage: string;
  componentStack: string;
  showDetails: boolean;
  backupStatus: string | null;
  reportStatus: string | null;
  isSendingReport: boolean;
}

const LOCAL_DATA_KEY = 'vidaorganizada_local_data_v2';

export class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = {
      hasError: false,
      errorMessage: '',
      componentStack: '',
      showDetails: false,
      backupStatus: null,
      reportStatus: null,
      isSendingReport: false,
    };
  }

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return {
      hasError: true,
      errorMessage: error?.message || 'Erro inesperado na interface',
    };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo): void {
    console.error('ErrorBoundary capturou falha na interface:', error, errorInfo);
    recordAppError('ErrorBoundary', error, errorInfo?.componentStack?.slice(0, 220));
    this.setState({
      componentStack: errorInfo?.componentStack?.trim() || '',
    });
  }

  handleReset = () => {
    if (isDynamicImportError(this.state.errorMessage)) {
      window.location.reload();
      return;
    }

    this.setState({
      hasError: false,
      errorMessage: '',
      componentStack: '',
      showDetails: false,
      backupStatus: null,
      reportStatus: null,
      isSendingReport: false,
    });
  };

  handleDownloadLocalBackup = () => {
    try {
      const raw = localStorage.getItem(LOCAL_DATA_KEY);
      if (!raw) {
        this.setState({
          backupStatus: 'Nenhum registro local encontrado para exportar ainda.',
        });
        return;
      }

      const blob = new Blob([raw], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `Lifeedy_Resgate_${formatLocalDateIso()}.json`;
      link.click();
      URL.revokeObjectURL(url);

      this.setState({
        backupStatus: 'Arquivo de backup salvo com sucesso.',
      });
    } catch {
      this.setState({
        backupStatus:
          'Não foi possível gerar o arquivo agora, mas seus dados continuam salvos no aparelho.',
      });
    }
  };

  handleSendReport = async () => {
    this.setState({ isSendingReport: true, reportStatus: null });
    const res = await sendDiagnosticReport({
      userNote: 'Enviado pela tela de recuperação de falha (ErrorBoundary)',
    });
    if (res.ok) {
      this.setState({
        isSendingReport: false,
        reportStatus: `Relatório sanitizado enviado (${res.reportId || 'confirmado'}).`,
      });
    } else {
      this.setState({
        isSendingReport: false,
        reportStatus: res.error || 'Não foi possível enviar ao servidor agora.',
      });
    }
  };

  render() {
    if (!this.state.hasError) {
      return this.props.children;
    }

    const mailtoUrl = buildErrorReportMailtoUrl();

    return (
      <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100 flex items-center justify-center p-4 pt-[max(1.5rem,env(safe-area-inset-top,0px))] pb-[max(1.5rem,env(safe-area-inset-bottom,0px))] font-sans">
        <div className="w-full max-w-md bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-3xl p-6 sm:p-8 shadow-xl space-y-5">
          <div className="w-12 h-12 rounded-2xl bg-amber-100 dark:bg-amber-950/60 text-amber-600 dark:text-amber-400 flex items-center justify-center">
            <AlertTriangle className="w-6 h-6" />
          </div>

          <div className="space-y-1.5">
            <h1 className="text-lg font-bold text-zinc-900 dark:text-zinc-100">
              Algo inesperado aconteceu
            </h1>
            <p className="text-xs sm:text-sm text-zinc-500 dark:text-zinc-400 leading-relaxed">
              {isDynamicImportError(this.state.errorMessage)
                ? 'Uma nova versão da página ficou disponível ou houve uma falha temporária ao carregar esta tela. Recarregue o app para continuar normalmente — seus dados locais estão seguros.'
                : 'Ocorreu uma falha temporária ao exibir esta tela. O evento foi salvo no diário local e seus dados permanecem protegidos no aparelho.'}
            </p>
          </div>

          {this.state.backupStatus && (
            <p className="text-xs font-medium text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 rounded-xl px-3.5 py-2.5">
              {this.state.backupStatus}
            </p>
          )}

          {this.state.reportStatus && (
            <p className="text-xs font-medium text-indigo-700 dark:text-indigo-300 bg-indigo-50 dark:bg-indigo-950/40 border border-indigo-200 dark:border-indigo-800 rounded-xl px-3.5 py-2.5">
              {this.state.reportStatus}
            </p>
          )}

          <div className="space-y-2.5 pt-1">
            <button
              type="button"
              onClick={this.handleReset}
              className="pressable w-full min-h-[46px] px-4 py-2.5 rounded-2xl bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold flex items-center justify-center gap-2 shadow-md shadow-indigo-600/20 cursor-pointer"
            >
              <RefreshCw className="w-4 h-4" />
              <span>
                {isDynamicImportError(this.state.errorMessage)
                  ? 'Recarregar aplicativo'
                  : 'Tentar novamente'}
              </span>
            </button>

            <button
              type="button"
              onClick={this.handleDownloadLocalBackup}
              className="pressable w-full min-h-[44px] px-4 py-2.5 rounded-2xl border border-zinc-200 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-700 dark:text-zinc-200 text-xs sm:text-sm font-semibold flex items-center justify-center gap-2 cursor-pointer"
            >
              <Download className="w-4 h-4" />
              <span>Baixar backup dos dados locais</span>
            </button>

            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => void this.handleSendReport()}
                disabled={this.state.isSendingReport}
                className="pressable min-h-[42px] px-3 py-2 rounded-xl border border-zinc-200 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-700 dark:text-zinc-200 text-xs font-semibold flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-60"
              >
                <Send className="w-3.5 h-3.5" />
                <span>{this.state.isSendingReport ? 'Enviando...' : 'Enviar relatório'}</span>
              </button>

              <a
                href={mailtoUrl}
                className="pressable min-h-[42px] px-3 py-2 rounded-xl border border-zinc-200 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-700 dark:text-zinc-200 text-xs font-semibold flex items-center justify-center gap-1.5"
              >
                <Mail className="w-3.5 h-3.5" />
                <span>Por e-mail</span>
              </a>
            </div>
          </div>

          {(this.state.errorMessage || this.state.componentStack) && (
            <div className="pt-2 border-t border-zinc-100 dark:border-zinc-800">
              <button
                type="button"
                onClick={() => this.setState((prev) => ({ showDetails: !prev.showDetails }))}
                className="inline-flex items-center gap-1.5 text-xs font-medium text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200 cursor-pointer"
              >
                {this.state.showDetails ? (
                  <ChevronUp className="w-3.5 h-3.5" />
                ) : (
                  <ChevronDown className="w-3.5 h-3.5" />
                )}
                <span>{this.state.showDetails ? 'Ocultar detalhes técnicos' : 'Detalhes técnicos'}</span>
              </button>

              {this.state.showDetails && (
                <div className="mt-2.5 p-3 rounded-xl bg-zinc-50 dark:bg-zinc-950/70 border border-zinc-200 dark:border-zinc-800 font-mono text-[11px] text-zinc-600 dark:text-zinc-400 space-y-1.5 max-h-40 overflow-y-auto break-words">
                  <div>{this.state.errorMessage}</div>
                  {this.state.componentStack && (
                    <pre className="whitespace-pre-wrap text-[10px] opacity-80">
                      {this.state.componentStack}
                    </pre>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    );
  }
}
