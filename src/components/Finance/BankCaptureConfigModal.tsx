import React, { useEffect, useMemo, useState } from 'react';
import {
  BellRing,
  CalendarClock,
  Check,
  Landmark,
  MessageSquare,
  Play,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  Smartphone,
  Trash2,
  Wallet,
  X,
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { useBackHandler } from '../../context/BackNavigationContext';
import { extractBRLAmount } from '../../services/bankNotificationParser';
import { hapticImpactLight, hapticSelection, hapticSuccess } from '../../services/hapticsService';
import { FinanceCategory, Transaction, TransactionType } from '../../types';
import { formatLocalDateIso } from '../../utils/dateUtils';

type ConfigTab = 'sources' | 'manual_apps' | 'scheduled';

interface BankCaptureConfigModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialTab?: ConfigTab;
}

const SUGGESTED_MANUAL_APPS: Array<{ packageName: string; label: string }> = [
  { packageName: 'com.whatsapp', label: 'WhatsApp' },
  { packageName: 'com.whatsapp.w4b', label: 'WhatsApp Business' },
  { packageName: 'com.google.android.gm', label: 'Gmail' },
  { packageName: 'com.microsoft.office.outlook', label: 'Outlook' },
  { packageName: 'org.telegram.messenger', label: 'Telegram' },
  { packageName: 'com.google.android.apps.walletnfcrel', label: 'Google Wallet' },
];

const CATEGORY_OPTIONS: Array<{ value: FinanceCategory; label: string }> = [
  { value: 'moradia', label: 'Moradia & Contas' },
  { value: 'alimentacao', label: 'Alimentação' },
  { value: 'transporte', label: 'Transporte' },
  { value: 'saude', label: 'Saúde' },
  { value: 'educacao', label: 'Educação' },
  { value: 'lazer', label: 'Lazer & Cultura' },
  { value: 'salario', label: 'Salário' },
  { value: 'freelance', label: 'Freelance' },
  { value: 'investimentos', label: 'Investimentos' },
  { value: 'outros', label: 'Outros' },
];

export const BankCaptureConfigModal: React.FC<BankCaptureConfigModalProps> = ({
  isOpen,
  onClose,
  initialTab = 'sources',
}) => {
  const {
    bankListenerSupported,
    bankListenerPermission,
    refreshBankListenerPermission,
    openBankListenerSettings,
    bankCaptureSettings,
    updateBankCaptureSettings,
    addManualCaptureApp,
    toggleManualCaptureApp,
    removeManualCaptureApp,
    installedAndroidApps,
    loadInstalledAndroidApps,
    scheduledValueMessages,
    addScheduledValueMessage,
    toggleScheduledValueMessage,
    deleteScheduledValueMessage,
    triggerScheduledValueMessageNow,
    formatMoney,
  } = useApp();

  const [activeTab, setActiveTab] = useState<ConfigTab>(initialTab);
  const [appSearch, setAppSearch] = useState('');
  const [loadingApps, setLoadingApps] = useState(false);
  const [customPackageName, setCustomPackageName] = useState('');
  const [customAppLabel, setCustomAppLabel] = useState('');
  const [manualAppError, setManualAppError] = useState<string | null>(null);

  // Scheduled value message form
  const [schedTitle, setSchedTitle] = useState('');
  const [schedMessageText, setSchedMessageText] = useState('');
  const [schedAmount, setSchedAmount] = useState('');
  const [schedType, setSchedType] = useState<TransactionType>('despesa');
  const [schedCategory, setSchedCategory] = useState<FinanceCategory>('moradia');
  const [schedPaymentMethod, setSchedPaymentMethod] =
    useState<NonNullable<Transaction['paymentMethod']>>('pix');
  const [schedFrequency, setSchedFrequency] = useState<'monthly' | 'once'>('monthly');
  const [schedDayOfMonth, setSchedDayOfMonth] = useState('5');
  const [schedSpecificDate, setSchedSpecificDate] = useState(() => formatLocalDateIso());
  const [schedTimeOfDay, setSchedTimeOfDay] = useState('09:00');
  const [schedFeedback, setSchedFeedback] = useState<string | null>(null);

  useBackHandler(isOpen, () => {
    onClose();
    return true;
  });

  useEffect(() => {
    if (isOpen) {
      setActiveTab(initialTab);
    }
  }, [isOpen, initialTab]);

  useEffect(() => {
    if (!isOpen || activeTab !== 'manual_apps' || !bankListenerSupported) return;
    if (installedAndroidApps.length > 0) return;

    let mounted = true;
    setLoadingApps(true);
    void loadInstalledAndroidApps().finally(() => {
      if (mounted) setLoadingApps(false);
    });
    return () => {
      mounted = false;
    };
  }, [isOpen, activeTab, bankListenerSupported, installedAndroidApps.length, loadInstalledAndroidApps]);

  const activeManualMap = useMemo(() => {
    const map = new Map<string, boolean>();
    bankCaptureSettings.manualApps.forEach((a) => {
      map.set(a.packageName, a.enabled);
    });
    return map;
  }, [bankCaptureSettings.manualApps]);

  const filteredInstalledApps = useMemo(() => {
    const q = appSearch.trim().toLowerCase();
    return installedAndroidApps
      .filter((app) => {
        if (!q) return true;
        return (
          app.label.toLowerCase().includes(q) || app.packageName.toLowerCase().includes(q)
        );
      })
      .slice(0, 60);
  }, [installedAndroidApps, appSearch]);

  if (!isOpen) return null;

  const handleRefreshApps = async () => {
    hapticImpactLight();
    setLoadingApps(true);
    try {
      await loadInstalledAndroidApps();
    } finally {
      setLoadingApps(false);
    }
  };

  const handleAddCustomApp = (e: React.FormEvent) => {
    e.preventDefault();
    setManualAppError(null);
    const pkg = customPackageName.trim();
    if (!/^[A-Za-z0-9_]+(?:\.[A-Za-z0-9_]+)+$/.test(pkg)) {
      setManualAppError('Informe um pacote Android válido (ex.: com.whatsapp ou br.com.app).');
      return;
    }
    const label = customAppLabel.trim() || pkg;
    addManualCaptureApp(pkg, label);
    setCustomPackageName('');
    setCustomAppLabel('');
    hapticSuccess();
  };

  const handleSchedMessageChange = (text: string) => {
    setSchedMessageText(text);
    const extracted = extractBRLAmount(text);
    if (extracted !== null && extracted > 0) {
      setSchedAmount(extracted.toFixed(2));
    }
  };

  const handleAddScheduledMessage = (e: React.FormEvent) => {
    e.preventDefault();
    const numericAmount = parseFloat(schedAmount.replace(',', '.'));
    if (!schedTitle.trim() || !Number.isFinite(numericAmount) || numericAmount <= 0) {
      setSchedFeedback('Informe uma descrição e um valor maior que zero.');
      return;
    }

    const messageText =
      schedMessageText.trim() ||
      `${schedTitle.trim()} - R$ ${numericAmount.toFixed(2).replace('.', ',')}`;

    addScheduledValueMessage({
      title: schedTitle.trim(),
      messageText,
      amount: Math.round(numericAmount * 100) / 100,
      type: schedType,
      category: schedCategory,
      paymentMethod: schedPaymentMethod,
      frequency: schedFrequency,
      dayOfMonth:
        schedFrequency === 'monthly'
          ? Math.max(1, Math.min(31, Number.parseInt(schedDayOfMonth, 10) || 5))
          : undefined,
      specificDate: schedFrequency === 'once' ? schedSpecificDate : undefined,
      timeOfDay: schedTimeOfDay || '09:00',
      enabled: true,
    });

    setSchedTitle('');
    setSchedMessageText('');
    setSchedAmount('');
    setSchedFeedback('Mensagem programada ativada.');
    setTimeout(() => setSchedFeedback(null), 3000);
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-end sm:items-center justify-center p-0 sm:p-4 animate-fade-in"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="bank-capture-config-title"
        onClick={(e) => e.stopPropagation()}
        className="w-full sm:max-w-2xl bg-white dark:bg-zinc-900 rounded-t-3xl sm:rounded-3xl border border-zinc-200/80 dark:border-zinc-800 shadow-2xl max-h-[92vh] flex flex-col overflow-hidden"
      >
        <div className="sm:hidden w-10 h-1 rounded-full bg-zinc-300 dark:bg-zinc-700 mx-auto mt-3 shrink-0" />

        {/* Header */}
        <div className="px-5 pt-4 pb-3 border-b border-zinc-100 dark:border-zinc-800 flex items-center justify-between gap-3 shrink-0">
          <div className="min-w-0">
            <h2
              id="bank-capture-config-title"
              className="text-base sm:text-lg font-bold text-zinc-900 dark:text-zinc-100 truncate"
            >
              Reconhecimento Financeiro & Fontes
            </h2>
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              Bancos, Google Wallet, SMS, apps manuais e mensagens programadas
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar configurações de captura"
            className="pressable p-2 rounded-full text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 cursor-pointer shrink-0"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tab Bar */}
        <div className="px-5 pt-3 pb-2 border-b border-zinc-100 dark:border-zinc-800 shrink-0">
          <div className="grid grid-cols-3 gap-1 bg-zinc-100 dark:bg-zinc-800/80 p-1 rounded-xl">
            <button
              type="button"
              onClick={() => {
                hapticSelection();
                setActiveTab('sources');
              }}
              className={`px-2 py-2 rounded-lg text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap truncate ${
                activeTab === 'sources'
                  ? 'bg-white dark:bg-zinc-700 text-zinc-900 dark:text-zinc-100 shadow-xs'
                  : 'text-zinc-600 dark:text-zinc-400'
              }`}
            >
              Fontes Automáticas
            </button>
            <button
              type="button"
              onClick={() => {
                hapticSelection();
                setActiveTab('manual_apps');
              }}
              className={`px-2 py-2 rounded-lg text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap truncate ${
                activeTab === 'manual_apps'
                  ? 'bg-white dark:bg-zinc-700 text-zinc-900 dark:text-zinc-100 shadow-xs'
                  : 'text-zinc-600 dark:text-zinc-400'
              }`}
            >
              Apps Manuais ({bankCaptureSettings.manualApps.filter((a) => a.enabled).length})
            </button>
            <button
              type="button"
              onClick={() => {
                hapticSelection();
                setActiveTab('scheduled');
              }}
              className={`px-2 py-2 rounded-lg text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap truncate ${
                activeTab === 'scheduled'
                  ? 'bg-white dark:bg-zinc-700 text-zinc-900 dark:text-zinc-100 shadow-xs'
                  : 'text-zinc-600 dark:text-zinc-400'
              }`}
            >
              Programadas ({scheduledValueMessages.filter((m) => m.enabled).length})
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {activeTab === 'sources' && (
            <div className="space-y-3">
              {/* Native Listener Status */}
              {bankListenerSupported ? (
                <div
                  className={`p-3.5 rounded-2xl border flex flex-col sm:flex-row sm:items-center justify-between gap-3 ${
                    bankListenerPermission
                      ? 'bg-emerald-50/70 dark:bg-emerald-950/20 border-emerald-200 dark:border-emerald-900/50'
                      : 'bg-amber-50/80 dark:bg-amber-950/25 border-amber-200 dark:border-amber-800/60'
                  }`}
                >
                  <div className="flex items-start gap-2.5 min-w-0">
                    {bankListenerPermission ? (
                      <ShieldCheck className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
                    ) : (
                      <Smartphone className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
                    )}
                    <div className="min-w-0">
                      <p className="text-xs font-bold text-zinc-900 dark:text-zinc-100">
                        {bankListenerPermission
                          ? 'Leitura de notificações Android ativa'
                          : 'Permissão de acesso às notificações pendente'}
                      </p>
                      <p className="text-[11px] text-zinc-600 dark:text-zinc-400 mt-0.5">
                        {bankListenerPermission
                          ? 'O sistema captura push, Google Wallet, SMS e apps manuais em segundo plano para sua fila de revisão.'
                          : 'Ative o "Leitor Financeiro Lifeedy" nas configurações do Android para captura automática.'}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      type="button"
                      onClick={() => void openBankListenerSettings()}
                      className="pressable px-3 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold cursor-pointer whitespace-nowrap"
                    >
                      {bankListenerPermission ? 'Ajustar no Android' : 'Ativar no Android'}
                    </button>
                    <button
                      type="button"
                      onClick={() => void refreshBankListenerPermission()}
                      aria-label="Verificar permissão"
                      className="pressable w-9 h-9 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-zinc-600 dark:text-zinc-300 flex items-center justify-center cursor-pointer"
                    >
                      <RefreshCw className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              ) : (
                <div className="p-3.5 rounded-2xl border border-zinc-200/80 dark:border-zinc-800 bg-zinc-50/70 dark:bg-zinc-800/40 text-xs text-zinc-600 dark:text-zinc-300">
                  Na versão Web você pode usar mensagens programadas com valores abaixo e colar qualquer aviso bancário, SMS ou recibo Google Wallet no botão <strong>Colar aviso / SMS</strong>. No APK Android a leitura das fontes abaixo é automática.
                </div>
              )}

              {/* Source Toggle Cards */}
              <div className="space-y-2.5">
                <ToggleRow
                  icon={<Landmark className="w-4 h-4 text-indigo-600" />}
                  title="Bancos e Fintechs (Push)"
                  description="Nubank, Itaú, Bradesco, Santander, BB, Caixa, Inter, C6, Mercado Pago, PicPay, BTG, PagBank, iti, Banrisul, Pan e mais."
                  checked={bankCaptureSettings.captureBanksEnabled}
                  onToggle={() =>
                    updateBankCaptureSettings({
                      captureBanksEnabled: !bankCaptureSettings.captureBanksEnabled,
                    })
                  }
                />

                <ToggleRow
                  icon={<Wallet className="w-4 h-4 text-emerald-600" />}
                  title="Google Wallet & Carteiras Digitais"
                  description="Reconhece pagamentos por aproximação (Tap & Pay), Google Pay, Samsung Wallet e cartões Visa/Master/Elo •••• automaticamente."
                  checked={bankCaptureSettings.captureWalletEnabled}
                  onToggle={() =>
                    updateBankCaptureSettings({
                      captureWalletEnabled: !bankCaptureSettings.captureWalletEnabled,
                    })
                  }
                />

                <ToggleRow
                  icon={<MessageSquare className="w-4 h-4 text-sky-600" />}
                  title="SMS de Bancos e Cartões"
                  description="Captura SMS de compra aprovada, Pix ou transferência enviados via Google Mensagens, Samsung Mensagens ou app SMS padrão."
                  checked={bankCaptureSettings.captureSmsEnabled}
                  onToggle={() =>
                    updateBankCaptureSettings({
                      captureSmsEnabled: !bankCaptureSettings.captureSmsEnabled,
                    })
                  }
                />

                <ToggleRow
                  icon={<CalendarClock className="w-4 h-4 text-amber-600" />}
                  title="Mensagens Programadas e Agendamentos com Valor"
                  description="Reconhece avisos de Pix agendado, débito automático previsto e faturas/boletos com vencimento e valor futuro."
                  checked={bankCaptureSettings.captureScheduledMessagesEnabled}
                  onToggle={() =>
                    updateBankCaptureSettings({
                      captureScheduledMessagesEnabled:
                        !bankCaptureSettings.captureScheduledMessagesEnabled,
                    })
                  }
                />
              </div>
            </div>
          )}

          {activeTab === 'manual_apps' && (
            <div className="space-y-4">
              <p className="text-xs text-zinc-600 dark:text-zinc-400">
                Ative aplicativos extras instalados no aparelho para que notificações contendo valores (ex.: WhatsApp, e-mail de cobrança, corretoras ou carteiras regionais) também entrem na fila de revisão.
              </p>

              {/* Activated Manual Apps */}
              <div className="space-y-2">
                <h3 className="text-xs font-bold text-zinc-800 dark:text-zinc-200 uppercase tracking-wider">
                  Apps manuais configurados ({bankCaptureSettings.manualApps.length})
                </h3>
                {bankCaptureSettings.manualApps.length === 0 ? (
                  <p className="text-xs text-zinc-500 dark:text-zinc-400 py-3 px-3.5 rounded-xl border border-dashed border-zinc-200 dark:border-zinc-800">
                    Nenhum aplicativo manual ativado ainda. Selecione uma sugestão, escolha um app instalado ou informe o pacote abaixo.
                  </p>
                ) : (
                  <div className="divide-y divide-zinc-100 dark:divide-zinc-800 border border-zinc-200/80 dark:border-zinc-800 rounded-2xl overflow-hidden">
                    {bankCaptureSettings.manualApps.map((rule) => (
                      <div
                        key={rule.packageName}
                        className="px-3.5 py-2.5 flex items-center justify-between gap-2 bg-white dark:bg-zinc-900"
                      >
                        <div className="min-w-0">
                          <p className="text-xs font-bold text-zinc-900 dark:text-zinc-100 truncate">
                            {rule.label}
                          </p>
                          <p className="text-[11px] font-mono text-zinc-500 dark:text-zinc-400 truncate">
                            {rule.packageName}
                          </p>
                        </div>
                        <div className="flex items-center gap-1.5 shrink-0">
                          <button
                            type="button"
                            role="switch"
                            aria-checked={rule.enabled}
                            onClick={() => toggleManualCaptureApp(rule.packageName)}
                            className={`pressable px-2.5 py-1.5 rounded-lg text-[11px] font-semibold cursor-pointer ${
                              rule.enabled
                                ? 'bg-emerald-50 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800'
                                : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400'
                            }`}
                          >
                            {rule.enabled ? 'Ativo' : 'Pausado'}
                          </button>
                          <button
                            type="button"
                            onClick={() => removeManualCaptureApp(rule.packageName)}
                            aria-label={`Remover ${rule.label}`}
                            className="p-1.5 rounded-lg text-zinc-400 hover:text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-950/30 cursor-pointer"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Quick Suggestions */}
              <div className="space-y-2">
                <h3 className="text-xs font-bold text-zinc-800 dark:text-zinc-200 uppercase tracking-wider">
                  Atalhos rápidos
                </h3>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  {SUGGESTED_MANUAL_APPS.map((sug) => {
                    const isConfigured = activeManualMap.has(sug.packageName);
                    const isEnabled = activeManualMap.get(sug.packageName) === true;
                    return (
                      <button
                        key={sug.packageName}
                        type="button"
                        onClick={() => {
                          if (isConfigured) {
                            toggleManualCaptureApp(sug.packageName);
                          } else {
                            addManualCaptureApp(sug.packageName, sug.label);
                          }
                        }}
                        className={`pressable px-3 py-2 rounded-xl border text-left flex items-center justify-between gap-2 text-xs cursor-pointer transition-colors ${
                          isEnabled
                            ? 'bg-indigo-50 dark:bg-indigo-950/40 border-indigo-200 dark:border-indigo-800 text-indigo-700 dark:text-indigo-300 font-semibold'
                            : 'bg-zinc-50 dark:bg-zinc-800/60 border-zinc-200 dark:border-zinc-700 text-zinc-700 dark:text-zinc-300'
                        }`}
                      >
                        <span className="truncate">{sug.label}</span>
                        {isEnabled ? (
                          <Check className="w-3.5 h-3.5 shrink-0" />
                        ) : (
                          <Plus className="w-3.5 h-3.5 shrink-0 text-zinc-400" />
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Installed Android Apps Picker */}
              {bankListenerSupported && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="text-xs font-bold text-zinc-800 dark:text-zinc-200 uppercase tracking-wider">
                      Apps instalados no dispositivo
                    </h3>
                    <button
                      type="button"
                      onClick={() => void handleRefreshApps()}
                      className="text-xs font-semibold text-indigo-600 dark:text-indigo-400 inline-flex items-center gap-1 cursor-pointer"
                    >
                      <RefreshCw className={`w-3 h-3 ${loadingApps ? 'animate-spin' : ''}`} />
                      <span>Atualizar lista</span>
                    </button>
                  </div>

                  <div className="relative">
                    <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400" />
                    <input
                      type="text"
                      value={appSearch}
                      onChange={(e) => setAppSearch(e.target.value)}
                      placeholder="Buscar app instalado ou pacote..."
                      className="w-full pl-8 pr-3 py-2 text-xs rounded-xl bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 text-zinc-900 dark:text-zinc-100 focus:outline-none"
                    />
                  </div>

                  <div className="max-h-52 overflow-y-auto divide-y divide-zinc-100 dark:divide-zinc-800 border border-zinc-200/80 dark:border-zinc-800 rounded-2xl">
                    {loadingApps ? (
                      <p className="p-4 text-xs text-zinc-500 text-center">Carregando aplicativos...</p>
                    ) : filteredInstalledApps.length === 0 ? (
                      <p className="p-4 text-xs text-zinc-500 text-center">
                        Nenhum aplicativo encontrado.
                      </p>
                    ) : (
                      filteredInstalledApps.map((app) => {
                        const isBuiltIn = app.isBuiltInBank || app.isWallet || app.isSms;
                        const isActiveManual = activeManualMap.get(app.packageName) === true;
                        return (
                          <div
                            key={app.packageName}
                            className="px-3.5 py-2.5 flex items-center justify-between gap-2"
                          >
                            <div className="min-w-0">
                              <div className="flex items-center gap-1.5 flex-wrap">
                                <span className="text-xs font-semibold text-zinc-900 dark:text-zinc-100 truncate">
                                  {app.label}
                                </span>
                                {isBuiltIn && (
                                  <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-emerald-50 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-300">
                                    Nativo
                                  </span>
                                )}
                              </div>
                              <span className="text-[10px] font-mono text-zinc-500 dark:text-zinc-400 block truncate">
                                {app.packageName}
                              </span>
                            </div>
                            {!isBuiltIn && (
                              <button
                                type="button"
                                onClick={() => {
                                  if (activeManualMap.has(app.packageName)) {
                                    toggleManualCaptureApp(app.packageName);
                                  } else {
                                    addManualCaptureApp(app.packageName, app.label);
                                  }
                                }}
                                className={`pressable px-2.5 py-1.5 rounded-lg text-[11px] font-semibold cursor-pointer shrink-0 ${
                                  isActiveManual
                                    ? 'bg-emerald-600 text-white'
                                    : 'border border-zinc-200 dark:border-zinc-700 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800'
                                }`}
                              >
                                {isActiveManual ? 'Ativado' : 'Ativar'}
                              </button>
                            )}
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>
              )}

              {/* Custom Package Form */}
              <form
                onSubmit={handleAddCustomApp}
                className="p-3.5 rounded-2xl border border-zinc-200/80 dark:border-zinc-800 bg-zinc-50/60 dark:bg-zinc-800/30 space-y-2.5"
              >
                <p className="text-xs font-bold text-zinc-800 dark:text-zinc-200">
                  Adicionar pacote manualmente
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <input
                    type="text"
                    value={customAppLabel}
                    onChange={(e) => setCustomAppLabel(e.target.value)}
                    placeholder="Nome (ex.: Mercado Livre)"
                    className="px-3 py-2 text-xs rounded-xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 text-zinc-900 dark:text-zinc-100 focus:outline-none"
                  />
                  <input
                    type="text"
                    value={customPackageName}
                    onChange={(e) => {
                      setCustomPackageName(e.target.value);
                      if (manualAppError) setManualAppError(null);
                    }}
                    placeholder="Pacote (ex.: com.mercadolibre)"
                    className="px-3 py-2 text-xs font-mono rounded-xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 text-zinc-900 dark:text-zinc-100 focus:outline-none"
                  />
                </div>
                {manualAppError && (
                  <p className="text-[11px] text-rose-600 dark:text-rose-400">{manualAppError}</p>
                )}
                <button
                  type="submit"
                  className="pressable px-3.5 py-2 rounded-xl bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Adicionar app manual</span>
                </button>
              </form>
            </div>
          )}

          {activeTab === 'scheduled' && (
            <div className="space-y-4">
              <p className="text-xs text-zinc-600 dark:text-zinc-400">
                Cadastre mensagens programadas com valores (ex.: aluguel, salário, boletos ou cobranças mensais). Na data e hora programadas, elas entram automaticamente na Fila de Revisão com notificação de lembrete.
              </p>

              {/* Form */}
              <form
                onSubmit={handleAddScheduledMessage}
                className="p-4 rounded-2xl border border-zinc-200/80 dark:border-zinc-800 bg-zinc-50/60 dark:bg-zinc-800/30 space-y-3"
              >
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  <div>
                    <label className="block text-[11px] font-semibold text-zinc-600 dark:text-zinc-400 mb-1">
                      Título / Descrição *
                    </label>
                    <input
                      type="text"
                      required
                      value={schedTitle}
                      onChange={(e) => setSchedTitle(e.target.value)}
                      placeholder="Ex.: Aluguel Apartamento"
                      className="w-full px-3 py-2 text-xs rounded-xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 text-zinc-900 dark:text-zinc-100 focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-semibold text-zinc-600 dark:text-zinc-400 mb-1">
                      Valor (R$) *
                    </label>
                    <input
                      type="text"
                      inputMode="decimal"
                      required
                      value={schedAmount}
                      onChange={(e) => setSchedAmount(e.target.value)}
                      placeholder="Ex.: 1850,00"
                      className="w-full px-3 py-2 text-xs rounded-xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 text-zinc-900 dark:text-zinc-100 focus:outline-none"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-[11px] font-semibold text-zinc-600 dark:text-zinc-400 mb-1">
                    Texto da mensagem (detecta R$ automaticamente ao digitar)
                  </label>
                  <input
                    type="text"
                    value={schedMessageText}
                    onChange={(e) => handleSchedMessageChange(e.target.value)}
                    placeholder="Ex.: Pagar Pix do aluguel R$ 1.850,00 para Imobiliária"
                    className="w-full px-3 py-2 text-xs rounded-xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 text-zinc-900 dark:text-zinc-100 focus:outline-none"
                  />
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  <div>
                    <label className="block text-[11px] font-semibold text-zinc-600 dark:text-zinc-400 mb-1">
                      Tipo
                    </label>
                    <select
                      value={schedType}
                      onChange={(e) => setSchedType(e.target.value as TransactionType)}
                      className="w-full px-2.5 py-2 text-xs rounded-xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 text-zinc-900 dark:text-zinc-100 focus:outline-none"
                    >
                      <option value="despesa">Despesa</option>
                      <option value="receita">Receita</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-[11px] font-semibold text-zinc-600 dark:text-zinc-400 mb-1">
                      Categoria
                    </label>
                    <select
                      value={schedCategory}
                      onChange={(e) => setSchedCategory(e.target.value as FinanceCategory)}
                      className="w-full px-2.5 py-2 text-xs rounded-xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 text-zinc-900 dark:text-zinc-100 focus:outline-none"
                    >
                      {CATEGORY_OPTIONS.map((c) => (
                        <option key={c.value} value={c.value}>
                          {c.label}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="col-span-2 sm:col-span-1">
                    <label className="block text-[11px] font-semibold text-zinc-600 dark:text-zinc-400 mb-1">
                      Meio
                    </label>
                    <select
                      value={schedPaymentMethod}
                      onChange={(e) =>
                        setSchedPaymentMethod(
                          e.target.value as NonNullable<Transaction['paymentMethod']>
                        )
                      }
                      className="w-full px-2.5 py-2 text-xs rounded-xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 text-zinc-900 dark:text-zinc-100 focus:outline-none"
                    >
                      <option value="pix">Pix</option>
                      <option value="cartao_credito">Cartão de Crédito</option>
                      <option value="cartao_debito">Cartão de Débito</option>
                      <option value="transferencia">Transferência / Boleto</option>
                      <option value="dinheiro">Dinheiro</option>
                    </select>
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-2">
                  <div>
                    <label className="block text-[11px] font-semibold text-zinc-600 dark:text-zinc-400 mb-1">
                      Frequência
                    </label>
                    <select
                      value={schedFrequency}
                      onChange={(e) => setSchedFrequency(e.target.value as 'monthly' | 'once')}
                      className="w-full px-2.5 py-2 text-xs rounded-xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 text-zinc-900 dark:text-zinc-100 focus:outline-none"
                    >
                      <option value="monthly">Mensal</option>
                      <option value="once">Data única</option>
                    </select>
                  </div>

                  {schedFrequency === 'monthly' ? (
                    <div>
                      <label className="block text-[11px] font-semibold text-zinc-600 dark:text-zinc-400 mb-1">
                        Dia do mês
                      </label>
                      <input
                        type="number"
                        min={1}
                        max={31}
                        value={schedDayOfMonth}
                        onChange={(e) => setSchedDayOfMonth(e.target.value)}
                        className="w-full px-2.5 py-2 text-xs rounded-xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 text-zinc-900 dark:text-zinc-100 focus:outline-none"
                      />
                    </div>
                  ) : (
                    <div>
                      <label className="block text-[11px] font-semibold text-zinc-600 dark:text-zinc-400 mb-1">
                        Data
                      </label>
                      <input
                        type="date"
                        value={schedSpecificDate}
                        onChange={(e) => setSchedSpecificDate(e.target.value)}
                        className="w-full px-2.5 py-2 text-xs rounded-xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 text-zinc-900 dark:text-zinc-100 focus:outline-none"
                      />
                    </div>
                  )}

                  <div>
                    <label className="block text-[11px] font-semibold text-zinc-600 dark:text-zinc-400 mb-1">
                      Horário
                    </label>
                    <input
                      type="time"
                      value={schedTimeOfDay}
                      onChange={(e) => setSchedTimeOfDay(e.target.value)}
                      className="w-full px-2.5 py-2 text-xs rounded-xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 text-zinc-900 dark:text-zinc-100 focus:outline-none"
                    />
                  </div>
                </div>

                {schedFeedback && (
                  <p className="text-xs font-medium text-indigo-600 dark:text-indigo-400">
                    {schedFeedback}
                  </p>
                )}

                <button
                  type="submit"
                  className="pressable w-full sm:w-auto px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold inline-flex items-center justify-center gap-1.5 cursor-pointer"
                >
                  <BellRing className="w-3.5 h-3.5" />
                  <span>Salvar mensagem programada</span>
                </button>
              </form>

              {/* List */}
              <div className="space-y-2">
                <h3 className="text-xs font-bold text-zinc-800 dark:text-zinc-200 uppercase tracking-wider">
                  Mensagens cadastradas ({scheduledValueMessages.length})
                </h3>
                {scheduledValueMessages.length === 0 ? (
                  <p className="text-xs text-zinc-500 dark:text-zinc-400 py-3 px-3.5 rounded-xl border border-dashed border-zinc-200 dark:border-zinc-800">
                    Nenhuma mensagem programada com valor cadastrada ainda.
                  </p>
                ) : (
                  <div className="divide-y divide-zinc-100 dark:divide-zinc-800 border border-zinc-200/80 dark:border-zinc-800 rounded-2xl overflow-hidden">
                    {scheduledValueMessages.map((msg) => (
                      <div
                        key={msg.id}
                        className="p-3.5 bg-white dark:bg-zinc-900 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5"
                      >
                        <div className="min-w-0 space-y-0.5">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-xs font-bold text-zinc-900 dark:text-zinc-100 truncate">
                              {msg.title}
                            </span>
                            <span
                              className={`text-xs font-bold tabular-nums ${
                                msg.type === 'receita'
                                  ? 'text-emerald-600 dark:text-emerald-400'
                                  : 'text-rose-600 dark:text-rose-400'
                              }`}
                            >
                              {msg.type === 'receita' ? '+' : '-'} {formatMoney(msg.amount)}
                            </span>
                          </div>
                          <p className="text-[11px] text-zinc-500 dark:text-zinc-400">
                            {msg.frequency === 'monthly'
                              ? `Todo dia ${msg.dayOfMonth || 5} às ${msg.timeOfDay}`
                              : `Em ${msg.specificDate} às ${msg.timeOfDay}`}{' '}
                            • {msg.messageText}
                          </p>
                        </div>

                        <div className="flex items-center gap-1.5 shrink-0">
                          <button
                            type="button"
                            onClick={() => {
                              triggerScheduledValueMessageNow(msg.id);
                              setSchedFeedback(`"${msg.title}" enviado para a fila de revisão.`);
                              setTimeout(() => setSchedFeedback(null), 3000);
                            }}
                            title="Enviar agora para fila de revisão"
                            className="pressable px-2.5 py-1.5 rounded-lg border border-indigo-200 dark:border-indigo-800 text-indigo-700 dark:text-indigo-300 text-[11px] font-semibold inline-flex items-center gap-1 cursor-pointer"
                          >
                            <Play className="w-3 h-3" />
                            <span>Enviar</span>
                          </button>
                          <button
                            type="button"
                            role="switch"
                            aria-checked={msg.enabled}
                            onClick={() => toggleScheduledValueMessage(msg.id)}
                            className={`pressable px-2.5 py-1.5 rounded-lg text-[11px] font-semibold cursor-pointer ${
                              msg.enabled
                                ? 'bg-emerald-50 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800'
                                : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400'
                            }`}
                          >
                            {msg.enabled ? 'Ativa' : 'Pausada'}
                          </button>
                          <button
                            type="button"
                            onClick={() => deleteScheduledValueMessage(msg.id)}
                            aria-label={`Excluir ${msg.title}`}
                            className="p-1.5 rounded-lg text-zinc-400 hover:text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-950/30 cursor-pointer"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

interface ToggleRowProps {
  icon: React.ReactNode;
  title: string;
  description: string;
  checked: boolean;
  onToggle: () => void;
}

const ToggleRow: React.FC<ToggleRowProps> = ({
  icon,
  title,
  description,
  checked,
  onToggle,
}) => (
  <div className="p-3.5 rounded-2xl border border-zinc-200/80 dark:border-zinc-800 flex items-center justify-between gap-3">
    <div className="flex items-start gap-3 min-w-0">
      <div className="w-9 h-9 rounded-xl bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center shrink-0 mt-0.5">
        {icon}
      </div>
      <div className="min-w-0">
        <p className="text-xs font-bold text-zinc-900 dark:text-zinc-100">{title}</p>
        <p className="text-[11px] text-zinc-500 dark:text-zinc-400 mt-0.5 leading-relaxed">
          {description}
        </p>
      </div>
    </div>
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={onToggle}
      className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors ${
        checked ? 'bg-indigo-600' : 'bg-zinc-300 dark:bg-zinc-700'
      }`}
    >
      <span
        className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-xs transition-transform ${
          checked ? 'translate-x-5' : 'translate-x-0'
        }`}
      />
    </button>
  </div>
);
