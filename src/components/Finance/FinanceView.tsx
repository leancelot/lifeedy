import React, { Suspense, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  BellRing,
  CalendarClock,
  Check,
  CheckCheck,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  ClipboardPaste,
  CopyPlus,
  CreditCard,
  DollarSign,
  Download,
  Eye,
  EyeOff,
  Lock,
  Pencil,
  PieChart as PieChartIcon,
  PiggyBank,
  Plus,
  Repeat,
  Search,
  Settings2,
  SlidersHorizontal,
  Smartphone,
  Sparkles,
  Target,
  Trash2,
  TrendingDown,
  TrendingUp,
  X,
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { useBackHandler } from '../../context/BackNavigationContext';
import { hapticImpactLight, hapticSelection, hapticSuccess } from '../../services/hapticsService';
import { parseBankNotificationText } from '../../services/bankNotificationParser';
import {
  FinanceCategory,
  FinancialGoal,
  PendingBankNotification,
  Transaction,
  TransactionType,
} from '../../types';
import { evaluateMonthlyBudgetAlerts } from '../../utils/budgetAlertsUtils';
import { formatLocalDateIso } from '../../utils/dateUtils';
import { exportMonthlyFinanceCsv } from '../../utils/financeCsvExport';
import {
  computeMonthlyRecurringSummary,
  computeProjectedBalance,
  getRecurringMonthDismissStorageKey,
  PendingRecurringExpense,
} from '../../utils/financeForecastUtils';
import {
  FinanceAddToGoalModal,
  FinanceBudgetModal,
  FinanceGoalModal,
  FinanceTransactionModal,
} from './FinanceModals';

import { lazyWithRetry } from '../../utils/lazyWithRetry';

const ReceiptScannerModal = lazyWithRetry(
  () => import('./ReceiptScannerModal').then((m) => ({ default: m.ReceiptScannerModal })),
  'receipt-scanner-modal'
);

const BankCaptureConfigModal = lazyWithRetry(
  () => import('./BankCaptureConfigModal').then((m) => ({ default: m.BankCaptureConfigModal })),
  'bank-capture-config-modal'
);

const DISMISSED_RECURRING_STORAGE_KEY = 'vidaorganizada_dismissed_recurring_v1';

const getLocalTodayStr = (): string => formatLocalDateIso();

type FinanceSubTab = 'resumo' | 'lancamentos' | 'metas';

const CATEGORY_LABELS: Record<FinanceCategory, string> = {
  salario: 'Salário',
  investimentos: 'Investimentos',
  freelance: 'Freelance',
  moradia: 'Moradia & Contas',
  alimentacao: 'Alimentação',
  transporte: 'Transporte',
  saude: 'Saúde',
  educacao: 'Educação',
  lazer: 'Lazer & Cultura',
  outros: 'Outros',
};

const CATEGORY_COLORS: Record<string, string> = {
  moradia: '#6366f1',
  alimentacao: '#f59e0b',
  transporte: '#3b82f6',
  saude: '#10b981',
  lazer: '#ec4899',
  educacao: '#8b5cf6',
  outros: '#94a3b8',
};

const PAYMENT_METHOD_LABELS: Record<NonNullable<Transaction['paymentMethod']>, string> = {
  pix: 'Pix',
  cartao_credito: 'Cartão de Crédito',
  cartao_debito: 'Cartão de Débito',
  dinheiro: 'Dinheiro',
  transferencia: 'Transferência',
};

interface FinanceViewProps {
  quickOpenAction?: 'new-transaction' | 'scan-receipt' | null;
  onConsumeQuickOpen?: () => void;
  initialReceiptFile?: File | null;
  onConsumeInitialReceiptFile?: () => void;
  onRelockFinance?: () => void;
}

export const FinanceView: React.FC<FinanceViewProps> = ({
  quickOpenAction,
  onConsumeQuickOpen,
  initialReceiptFile,
  onConsumeInitialReceiptFile,
  onRelockFinance,
}) => {
  const {
    transactions,
    addTransaction,
    updateTransaction,
    deleteTransaction,
    financialGoals,
    updateGoal,
    addGoal,
    deleteGoal,
    budgetLimits,
    updateBudgetLimit,
    hideValues,
    toggleHideValues,
    formatMoney,
    financeLockEnabled,
    pendingBankNotifications,
    bankListenerSupported,
    bankListenerPermission,
    refreshBankListenerPermission,
    openBankListenerSettings,
    enqueueParsedBankText,
    approvePendingBankNotification,
    approveAllPendingBankNotifications,
    dismissPendingBankNotification,
    clearPendingBankNotifications,
    bankCaptureSettings,
    scheduledValueMessages,
  } = useApp();

  const [activeSubTab, setActiveSubTab] = useState<FinanceSubTab>('resumo');
  const [currentDate, setCurrentDate] = useState(new Date());
  const [filterType, setFilterType] = useState<'all' | 'receita' | 'despesa'>('all');
  const [categoryFilter, setCategoryFilter] = useState<FinanceCategory | null>(null);
  const [searchQuery, setSearchQuery] = useState('');

  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [editingPendingBankId, setEditingPendingBankId] = useState<string | null>(null);
  const [editingTransactionId, setEditingTransactionId] = useState<string | null>(null);
  const [isBudgetModalOpen, setIsBudgetModalOpen] = useState(false);
  const [isGoalModalOpen, setIsGoalModalOpen] = useState(false);
  const [editingGoalId, setEditingGoalId] = useState<string | null>(null);
  const [isScannerOpen, setIsScannerOpen] = useState(false);
  const [isPasteBankModalOpen, setIsPasteBankModalOpen] = useState(false);
  const [isCaptureConfigOpen, setIsCaptureConfigOpen] = useState(false);
  const [captureConfigInitialTab, setCaptureConfigInitialTab] = useState<
    'sources' | 'manual_apps' | 'scheduled'
  >('sources');

  // Paste Bank Alert / SMS state
  const [pasteBankText, setPasteBankText] = useState('');
  const [pasteBankName, setPasteBankName] = useState('');
  const [includeScheduledInPaste, setIncludeScheduledInPaste] = useState(true);
  const [pasteError, setPasteError] = useState<string | null>(null);

  // New / Edit Transaction form
  const [txType, setTxType] = useState<TransactionType>('despesa');
  const [txTitle, setTxTitle] = useState('');
  const [txAmount, setTxAmount] = useState('');
  const [txCategory, setTxCategory] = useState<FinanceCategory>('alimentacao');
  const [txDate, setTxDate] = useState(() => getLocalTodayStr());
  const [txPaymentMethod, setTxPaymentMethod] = useState<Transaction['paymentMethod']>('pix');
  const [txNotes, setTxNotes] = useState('');
  const [txRecurring, setTxRecurring] = useState(false);

  // New / Edit Goal form
  const [goalTitle, setGoalTitle] = useState('');
  const [goalTarget, setGoalTarget] = useState('');
  const [goalCurrent, setGoalCurrent] = useState('');
  const [goalDate, setGoalDate] = useState('');

  // Add amount to existing goal modal
  const [addingToGoal, setAddingToGoal] = useState<{ id: string; title: string } | null>(null);
  const [addGoalAmount, setAddGoalAmount] = useState('');

  // Budget drafts when editing limits
  const [budgetDrafts, setBudgetDrafts] = useState<Record<string, string>>({});
  const [csvFeedback, setCsvFeedback] = useState<string | null>(null);
  const [showRecurringDetails, setShowRecurringDetails] = useState<boolean>(false);
  const [dismissedRecurringByMonth, setDismissedRecurringByMonth] = useState<
    Record<string, string[]>
  >(() => {
    try {
      const saved = localStorage.getItem(DISMISSED_RECURRING_STORAGE_KEY);
      return saved ? JSON.parse(saved) : {};
    } catch {
      return {};
    }
  });

  useBackHandler(isPasteBankModalOpen, () => {
    setIsPasteBankModalOpen(false);
    return true;
  });

  useBackHandler(isAddModalOpen, () => {
    setIsAddModalOpen(false);
    return true;
  });

  useBackHandler(isBudgetModalOpen, () => {
    setIsBudgetModalOpen(false);
    return true;
  });

  useBackHandler(isGoalModalOpen, () => {
    setIsGoalModalOpen(false);
    return true;
  });

  useBackHandler(Boolean(addingToGoal), () => {
    setAddingToGoal(null);
    return true;
  });

  useEffect(() => {
    if (!quickOpenAction) return;
    if (quickOpenAction === 'new-transaction') {
      setEditingPendingBankId(null);
      setEditingTransactionId(null);
      setTxType('despesa');
      setTxTitle('');
      setTxAmount('');
      setTxCategory('alimentacao');
      setTxDate(getLocalTodayStr());
      setTxPaymentMethod('pix');
      setTxNotes('');
      setTxRecurring(false);
      setIsAddModalOpen(true);
    } else if (quickOpenAction === 'scan-receipt') {
      setIsScannerOpen(true);
    }
    onConsumeQuickOpen?.();
  }, [quickOpenAction, onConsumeQuickOpen]);

  useEffect(() => {
    if (initialReceiptFile) {
      setIsScannerOpen(true);
    }
  }, [initialReceiptFile]);

  const prevMonth = () => {
    hapticSelection();
    setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() - 1, 1));
  };

  const nextMonth = () => {
    hapticSelection();
    setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 1));
  };

  const currentMonthIndex = currentDate.getMonth();
  const currentYear = currentDate.getFullYear();

  const monthName = new Intl.DateTimeFormat('pt-BR', {
    month: 'long',
    year: 'numeric',
  }).format(currentDate);

  const capitalizedMonth = monthName.charAt(0).toUpperCase() + monthName.slice(1);

  const monthlyTransactions = useMemo(
    () =>
      transactions.filter((tx) => {
        const txDateObj = new Date(tx.date + 'T00:00:00');
        return (
          txDateObj.getMonth() === currentMonthIndex && txDateObj.getFullYear() === currentYear
        );
      }),
    [transactions, currentMonthIndex, currentYear]
  );

  const totalIncome = monthlyTransactions
    .filter((tx) => tx.type === 'receita')
    .reduce((sum, tx) => sum + tx.amount, 0);

  const totalExpense = monthlyTransactions
    .filter((tx) => tx.type === 'despesa')
    .reduce((sum, tx) => sum + tx.amount, 0);

  const balance = totalIncome - totalExpense;
  const savingsRate =
    totalIncome > 0
      ? Math.max(0, Math.round(((totalIncome - totalExpense) / totalIncome) * 100))
      : 0;

  const fixedExpenses = monthlyTransactions
    .filter((tx) => tx.type === 'despesa' && tx.recurring)
    .reduce((s, tx) => s + tx.amount, 0);
  const variableExpenses = totalExpense - fixedExpenses;

  const recurringMonthKey = getRecurringMonthDismissStorageKey(currentYear, currentMonthIndex);
  const recurringSummary = useMemo(
    () =>
      computeMonthlyRecurringSummary(
        transactions,
        currentYear,
        currentMonthIndex,
        dismissedRecurringByMonth[recurringMonthKey] || []
      ),
    [transactions, currentYear, currentMonthIndex, dismissedRecurringByMonth, recurringMonthKey]
  );

  const { projectedBalance } = useMemo(
    () => computeProjectedBalance(totalIncome, totalExpense, recurringSummary.pendingTotal),
    [totalIncome, totalExpense, recurringSummary.pendingTotal]
  );

  const launchSingleRecurring = (item: PendingRecurringExpense) => {
    hapticSuccess();
    addTransaction({
      type: 'despesa',
      title: item.title,
      amount: item.amount,
      category: item.category,
      date: item.suggestedDate,
      paymentMethod: item.paymentMethod || 'pix',
      notes: item.notes,
      recurring: true,
    });
  };

  const launchAllPendingRecurring = () => {
    if (recurringSummary.pendingRecurring.length === 0) return;
    hapticSuccess();
    recurringSummary.pendingRecurring.forEach((item) => {
      addTransaction({
        type: 'despesa',
        title: item.title,
        amount: item.amount,
        category: item.category,
        date: item.suggestedDate,
        paymentMethod: item.paymentMethod || 'pix',
        notes: item.notes,
        recurring: true,
      });
    });
  };

  const dismissRecurringForMonth = (key: string) => {
    hapticSelection();
    setDismissedRecurringByMonth((prev) => {
      const currentList = prev[recurringMonthKey] || [];
      if (currentList.includes(key)) return prev;
      const next = { ...prev, [recurringMonthKey]: [...currentList, key] };
      try {
        localStorage.setItem(DISMISSED_RECURRING_STORAGE_KEY, JSON.stringify(next));
      } catch {
        // ignore storage quota
      }
      return next;
    });
  };

  const visibleTransactions = useMemo(
    () =>
      monthlyTransactions.filter((tx) => {
        if (filterType !== 'all' && tx.type !== filterType) return false;
        if (categoryFilter && tx.category !== categoryFilter) return false;
        if (searchQuery.trim()) {
          const q = searchQuery.toLowerCase();
          const match =
            tx.title.toLowerCase().includes(q) ||
            (tx.notes && tx.notes.toLowerCase().includes(q));
          if (!match) return false;
        }
        return true;
      }),
    [monthlyTransactions, filterType, categoryFilter, searchQuery]
  );

  const categoryExpenses: Record<string, number> = {};
  monthlyTransactions
    .filter((tx) => tx.type === 'despesa')
    .forEach((tx) => {
      categoryExpenses[tx.category] = (categoryExpenses[tx.category] || 0) + tx.amount;
    });

  const getCategoryLabel = (cat: FinanceCategory) => CATEGORY_LABELS[cat] || cat;

  const livePastePreview = useMemo(() => {
    if (!pasteBankText.trim()) return null;
    return parseBankNotificationText({
      rawText: pasteBankText,
      bankName: pasteBankName.trim() || undefined,
      source: 'manual',
      allowAmbiguous: true,
      includeScheduledMessages: includeScheduledInPaste,
    });
  }, [pasteBankText, pasteBankName, includeScheduledInPaste]);

  const monthlyBudgetAlerts = useMemo(
    () => evaluateMonthlyBudgetAlerts(transactions, budgetLimits, currentDate),
    [transactions, budgetLimits, currentDate]
  );

  const exportToCSV = async () => {
    if (monthlyTransactions.length === 0) {
      setCsvFeedback('Nenhuma transação registrada neste mês para exportar.');
      setTimeout(() => setCsvFeedback(null), 3500);
      return;
    }

    try {
      const delivery = await exportMonthlyFinanceCsv({
        transactions: monthlyTransactions,
        year: currentYear,
        monthIndex: currentMonthIndex,
      });
      setCsvFeedback(
        delivery === 'download'
          ? 'Extrato CSV baixado com sucesso.'
          : 'Extrato CSV pronto para compartilhamento.'
      );
      setTimeout(() => setCsvFeedback(null), 3500);
    } catch {
      setCsvFeedback('Não foi possível exportar o extrato CSV agora.');
      setTimeout(() => setCsvFeedback(null), 3500);
    }
  };

  const resetTransactionModal = () => {
    setEditingPendingBankId(null);
    setEditingTransactionId(null);
    setTxType('despesa');
    setTxTitle('');
    setTxAmount('');
    setTxCategory('alimentacao');
    setTxDate(getLocalTodayStr());
    setTxPaymentMethod('pix');
    setTxNotes('');
    setTxRecurring(false);
  };

  const openNewTransactionModal = (presetType: TransactionType = 'despesa') => {
    resetTransactionModal();
    setTxType(presetType);
    if (presetType === 'receita') {
      setTxCategory('salario');
    }
    setIsAddModalOpen(true);
  };

  const openEditTransactionModal = (tx: Transaction) => {
    hapticSelection();
    setEditingPendingBankId(null);
    setEditingTransactionId(tx.id);
    setTxType(tx.type);
    setTxTitle(tx.title);
    setTxAmount(tx.amount.toFixed(2));
    setTxCategory(tx.category);
    setTxDate(tx.date);
    setTxPaymentMethod(tx.paymentMethod || 'pix');
    setTxNotes(tx.notes || '');
    setTxRecurring(Boolean(tx.recurring));
    setIsAddModalOpen(true);
  };

  const handleRepeatTransactionToday = (tx: Transaction) => {
    hapticSuccess();
    addTransaction({
      type: tx.type,
      title: tx.title,
      amount: tx.amount,
      category: tx.category,
      date: getLocalTodayStr(),
      paymentMethod: tx.paymentMethod,
      notes: tx.notes,
      recurring: tx.recurring,
    });
  };

  const openEditPendingModal = (item: PendingBankNotification) => {
    setEditingPendingBankId(item.id);
    setEditingTransactionId(null);
    setTxType(item.type);
    setTxTitle(item.title);
    setTxAmount(item.amount.toFixed(2));
    setTxCategory(item.category);
    setTxDate(item.date);
    setTxPaymentMethod(item.paymentMethod || 'pix');
    setTxNotes(`Origem: ${item.bankName}`);
    setTxRecurring(false);
    setIsAddModalOpen(true);
  };

  const handleCreateTransaction = (e: React.FormEvent) => {
    e.preventDefault();
    const amountNum = parseFloat(txAmount.replace(',', '.'));
    if (!txTitle.trim() || isNaN(amountNum) || amountNum <= 0) return;

    const txPayload: Omit<Transaction, 'id'> = {
      type: txType,
      title: txTitle.trim(),
      amount: amountNum,
      category: txCategory,
      date: txDate,
      paymentMethod: txPaymentMethod,
      notes: txNotes.trim() || undefined,
      recurring: txRecurring,
    };

    if (editingPendingBankId) {
      approvePendingBankNotification(editingPendingBankId, txPayload);
    } else if (editingTransactionId) {
      updateTransaction(editingTransactionId, txPayload);
    } else {
      addTransaction(txPayload);
    }

    resetTransactionModal();
    setIsAddModalOpen(false);
  };

  const handleEnqueuePastedText = (e: React.FormEvent) => {
    e.preventDefault();
    setPasteError(null);
    const created = enqueueParsedBankText(pasteBankText, pasteBankName.trim() || undefined, {
      includeScheduledMessages: includeScheduledInPaste,
    });
    if (!created) {
      setPasteError('Não foi possível identificar um valor monetário neste texto.');
      return;
    }
    setPasteBankText('');
    setPasteBankName('');
    setIsPasteBankModalOpen(false);
    setActiveSubTab('lancamentos');
  };

  const handleEditFromPastedText = () => {
    if (!livePastePreview) {
      setPasteError('Não foi possível identificar um valor monetário neste texto.');
      return;
    }
    setEditingPendingBankId(null);
    setEditingTransactionId(null);
    setTxType(livePastePreview.type);
    setTxTitle(livePastePreview.title);
    setTxAmount(livePastePreview.amount.toFixed(2));
    setTxCategory(livePastePreview.category);
    setTxDate(livePastePreview.date);
    setTxPaymentMethod(livePastePreview.paymentMethod || 'pix');
    setTxNotes(`Origem: ${livePastePreview.bankName}`);
    setTxRecurring(false);

    setPasteBankText('');
    setPasteBankName('');
    setPasteError(null);
    setIsPasteBankModalOpen(false);
    setIsAddModalOpen(true);
  };

  const openNewGoalModal = () => {
    setEditingGoalId(null);
    setGoalTitle('');
    setGoalTarget('');
    setGoalCurrent('');
    setGoalDate('');
    setIsGoalModalOpen(true);
  };

  const openEditGoalModal = (goal: FinancialGoal) => {
    hapticSelection();
    setEditingGoalId(goal.id);
    setGoalTitle(goal.title);
    setGoalTarget(String(goal.targetAmount));
    setGoalCurrent(String(goal.currentAmount));
    setGoalDate(goal.targetDate || '');
    setIsGoalModalOpen(true);
  };

  const handleCreateGoal = (e: React.FormEvent) => {
    e.preventDefault();
    const targetNum = parseFloat(goalTarget.replace(',', '.'));
    const currentNum = goalCurrent.trim() ? parseFloat(goalCurrent.replace(',', '.')) : 0;
    if (!goalTitle.trim() || isNaN(targetNum) || targetNum <= 0) return;

    if (editingGoalId) {
      updateGoal(editingGoalId, {
        title: goalTitle.trim(),
        targetAmount: targetNum,
        currentAmount: isNaN(currentNum) ? 0 : currentNum,
        targetDate: goalDate,
      });
    } else {
      addGoal({
        title: goalTitle.trim(),
        targetAmount: targetNum,
        currentAmount: isNaN(currentNum) ? 0 : currentNum,
        targetDate: goalDate,
        category: 'investimentos',
        color: '#6366f1',
      });
    }

    setEditingGoalId(null);
    setGoalTitle('');
    setGoalTarget('');
    setGoalCurrent('');
    setGoalDate('');
    setIsGoalModalOpen(false);
  };

  const openBudgetModal = () => {
    const drafts: Record<string, string> = {};
    (
      ['moradia', 'alimentacao', 'transporte', 'saude', 'lazer', 'outros'] as FinanceCategory[]
    ).forEach((cat) => {
      const existing = budgetLimits.find((b) => b.category === cat);
      drafts[cat] = existing && existing.monthlyLimit > 0 ? String(existing.monthlyLimit) : '';
    });
    setBudgetDrafts(drafts);
    setIsBudgetModalOpen(true);
  };

  const handleSaveBudgets = (e: React.FormEvent) => {
    e.preventDefault();
    (
      ['moradia', 'alimentacao', 'transporte', 'saude', 'lazer', 'outros'] as FinanceCategory[]
    ).forEach((cat) => {
      const raw = (budgetDrafts[cat] || '').trim();
      if (!raw) {
        updateBudgetLimit(cat, 0);
      } else {
        const val = parseFloat(raw.replace(',', '.'));
        if (!isNaN(val)) {
          updateBudgetLimit(cat, val);
        }
      }
    });
    setIsBudgetModalOpen(false);
  };

  const handleAddAmountToGoal = (e: React.FormEvent) => {
    e.preventDefault();
    if (!addingToGoal) return;
    const num = parseFloat(addGoalAmount.replace(',', '.'));
    const targetGoal = financialGoals.find((g) => g.id === addingToGoal.id);
    if (!targetGoal || isNaN(num) || num <= 0) return;
    updateGoal(targetGoal.id, { currentAmount: targetGoal.currentAmount + num });
    hapticSuccess();
    setAddingToGoal(null);
    setAddGoalAmount('');
  };

  const handleFilterCategoryFromResumo = (cat: FinanceCategory) => {
    hapticSelection();
    setCategoryFilter(cat);
    setFilterType('despesa');
    setActiveSubTab('lancamentos');
  };

  return (
    <div className="space-y-4 pb-16">
      {/* Compact Month Bar + Primary Actions + Sub-tabs */}
      <div className="space-y-2.5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-1.5">
            <div className="flex items-center h-9 bg-white dark:bg-zinc-900 border border-zinc-200/80 dark:border-zinc-800 rounded-xl p-0.5">
              <button
                type="button"
                onClick={prevMonth}
                title="Mês anterior"
                aria-label="Mês anterior"
                className="pressable w-8 h-8 flex items-center justify-center rounded-lg text-zinc-600 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 cursor-pointer"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <span className="px-2.5 text-xs sm:text-sm font-bold text-zinc-900 dark:text-zinc-100 whitespace-nowrap">
                {capitalizedMonth}
              </span>
              <button
                type="button"
                onClick={nextMonth}
                title="Próximo mês"
                aria-label="Próximo mês"
                className="pressable w-8 h-8 flex items-center justify-center rounded-lg text-zinc-600 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 cursor-pointer"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>

            <button
              type="button"
              onClick={toggleHideValues}
              title={hideValues ? 'Mostrar valores' : 'Ocultar valores'}
              aria-label={hideValues ? 'Mostrar valores' : 'Ocultar valores'}
              aria-pressed={hideValues}
              className={`pressable w-9 h-9 flex items-center justify-center rounded-xl border cursor-pointer shrink-0 ${
                hideValues
                  ? 'bg-indigo-50 dark:bg-indigo-950/50 text-indigo-600 dark:text-indigo-400 border-indigo-200 dark:border-indigo-800'
                  : 'bg-white dark:bg-zinc-900 text-zinc-600 dark:text-zinc-300 border-zinc-200/80 dark:border-zinc-800'
              }`}
            >
              {hideValues ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>

          <div className="flex items-center gap-1.5 flex-wrap">
            {financeLockEnabled && onRelockFinance && (
              <button
                type="button"
                onClick={() => {
                  hapticImpactLight();
                  onRelockFinance();
                }}
                title="Bloquear aba Finanças"
                aria-label="Bloquear Finanças"
                className="pressable w-9 h-9 rounded-xl bg-white dark:bg-zinc-900 border border-zinc-200/80 dark:border-zinc-800 text-zinc-600 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 flex items-center justify-center cursor-pointer shrink-0"
              >
                <Lock className="w-4 h-4" />
              </button>
            )}

            <button
              type="button"
              onClick={() => void exportToCSV()}
              title="Exportar CSV do mês"
              aria-label="Exportar CSV"
              className="pressable w-9 h-9 rounded-xl bg-white dark:bg-zinc-900 border border-zinc-200/80 dark:border-zinc-800 text-zinc-600 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 flex items-center justify-center cursor-pointer shrink-0"
            >
              <Download className="w-4 h-4" />
            </button>

            <button
              type="button"
              onClick={openBudgetModal}
              title="Definir limites de orçamento"
              aria-label="Limites de orçamento"
              className="pressable w-9 h-9 rounded-xl bg-white dark:bg-zinc-900 border border-zinc-200/80 dark:border-zinc-800 text-zinc-600 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 flex items-center justify-center cursor-pointer shrink-0"
            >
              <SlidersHorizontal className="w-4 h-4" />
            </button>

            <button
              type="button"
              onClick={() => {
                hapticImpactLight();
                setIsScannerOpen(true);
              }}
              title="Ler Nota Fiscal com IA"
              className="pressable h-9 px-3 rounded-xl bg-gradient-to-r from-[#B6543C] to-[#A64B5E] text-white font-semibold text-xs inline-flex items-center gap-1.5 cursor-pointer whitespace-nowrap shrink-0"
            >
              <Sparkles className="w-3.5 h-3.5 text-amber-200 shrink-0" />
              <span>Ler Nota</span>
            </button>

            <button
              type="button"
              onClick={() => {
                hapticImpactLight();
                openNewTransactionModal('despesa');
              }}
              className="pressable h-9 px-3.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-xs inline-flex items-center gap-1 cursor-pointer whitespace-nowrap shrink-0"
            >
              <Plus className="w-4 h-4 shrink-0" />
              <span>Nova</span>
            </button>
          </div>
        </div>

        {/* Single-line Sub-tab Switcher */}
        <div
          role="tablist"
          aria-label="Seções de Finanças"
          className="grid grid-cols-3 gap-1 bg-zinc-100 dark:bg-zinc-800/80 p-1 rounded-xl border border-zinc-200/60 dark:border-zinc-800"
        >
          <button
            role="tab"
            aria-selected={activeSubTab === 'resumo'}
            onClick={() => {
              hapticSelection();
              setActiveSubTab('resumo');
            }}
            className={`pressable h-9 px-2 rounded-lg text-xs font-semibold cursor-pointer whitespace-nowrap shrink-0 flex items-center justify-center ${
              activeSubTab === 'resumo'
                ? 'bg-white dark:bg-zinc-700 text-zinc-900 dark:text-zinc-100 shadow-2xs'
                : 'text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200'
            }`}
          >
            Resumo
          </button>

          <button
            role="tab"
            aria-selected={activeSubTab === 'lancamentos'}
            onClick={() => {
              hapticSelection();
              setActiveSubTab('lancamentos');
            }}
            className={`pressable h-9 px-2 rounded-lg text-xs font-semibold cursor-pointer whitespace-nowrap shrink-0 flex items-center justify-center gap-1.5 ${
              activeSubTab === 'lancamentos'
                ? 'bg-white dark:bg-zinc-700 text-zinc-900 dark:text-zinc-100 shadow-2xs'
                : 'text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200'
            }`}
          >
            <span>Lançamentos</span>
            {pendingBankNotifications.length > 0 && (
              <span className="inline-flex items-center justify-center px-1.5 min-w-[18px] h-[18px] rounded-md bg-indigo-600 text-white text-[10px] font-bold tabular-nums">
                {pendingBankNotifications.length}
              </span>
            )}
          </button>

          <button
            role="tab"
            aria-selected={activeSubTab === 'metas'}
            onClick={() => {
              hapticSelection();
              setActiveSubTab('metas');
            }}
            className={`pressable h-9 px-2 rounded-lg text-xs font-semibold cursor-pointer whitespace-nowrap shrink-0 flex items-center justify-center ${
              activeSubTab === 'metas'
                ? 'bg-white dark:bg-zinc-700 text-zinc-900 dark:text-zinc-100 shadow-2xs'
                : 'text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200'
            }`}
          >
            Metas
          </button>
        </div>
      </div>

      {csvFeedback && (
        <div className="px-3.5 py-2 rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 text-xs font-medium text-amber-700 dark:text-amber-300">
          {csvFeedback}
        </div>
      )}

      {/* SUB-TAB 1: RESUMO */}
      {activeSubTab === 'resumo' && (
        <div className="space-y-4 animate-tab-enter">
          {monthlyBudgetAlerts.length > 0 && (
            <div className="rounded-2xl border border-amber-200 dark:border-amber-900/60 bg-amber-50/90 dark:bg-amber-950/30 px-3.5 py-3 flex items-start justify-between gap-3">
              <div className="flex items-start gap-2.5 min-w-0">
                <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
                <div className="text-xs text-amber-900 dark:text-amber-200 space-y-0.5">
                  <p className="font-bold">
                    {monthlyBudgetAlerts.some((a) => a.level === 'exceeded')
                      ? 'Limite mensal ultrapassado'
                      : 'Atenção aos limites de orçamento'}
                  </p>
                  <p className="text-amber-800/90 dark:text-amber-300/90 leading-relaxed">
                    {monthlyBudgetAlerts
                      .slice(0, 3)
                      .map((a) => `${getCategoryLabel(a.category)} (${a.percent}%)`)
                      .join(' · ')}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={openBudgetModal}
                className="pressable px-2.5 py-1 rounded-lg text-[11px] font-semibold bg-amber-200/70 dark:bg-amber-900/50 text-amber-900 dark:text-amber-200 cursor-pointer shrink-0"
              >
                Ajustar
              </button>
            </div>
          )}

          {/* Actionable KPI Cards - 2 cols on mobile, 4 cols on desktop */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5 sm:gap-3">
            {/* Saldo -> Abre extrato completo */}
            <div
              onClick={() => {
                hapticSelection();
                setCategoryFilter(null);
                setFilterType('all');
                setActiveSubTab('lancamentos');
              }}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  setCategoryFilter(null);
                  setFilterType('all');
                  setActiveSubTab('lancamentos');
                }
              }}
              className="pressable bg-white dark:bg-zinc-900 border border-zinc-200/80 dark:border-zinc-800 hover:border-indigo-400 dark:hover:border-indigo-600 rounded-2xl p-3.5 cursor-pointer flex flex-col justify-between gap-2"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-semibold text-zinc-500 dark:text-zinc-400">
                  Saldo
                </span>
                <DollarSign
                  className={`w-4 h-4 shrink-0 ${
                    balance >= 0 ? 'text-emerald-600' : 'text-rose-600'
                  }`}
                />
              </div>
              <div
                className={`text-lg sm:text-xl font-bold tracking-tight truncate font-mono tabular-nums ${
                  balance >= 0
                    ? 'text-zinc-900 dark:text-zinc-100'
                    : 'text-rose-600 dark:text-rose-400'
                }`}
              >
                {formatMoney(balance)}
              </div>
              {recurringSummary.pendingTotal > 0 ? (
                <div className="flex items-center justify-between gap-1 text-[11px] font-mono tabular-nums">
                  <span
                    className={`font-semibold truncate ${
                      projectedBalance >= 0
                        ? 'text-emerald-600 dark:text-emerald-400'
                        : 'text-rose-600 dark:text-rose-400'
                    }`}
                  >
                    Prev: {formatMoney(projectedBalance)}
                  </span>
                  <span className="text-indigo-600 dark:text-indigo-400 font-sans font-semibold shrink-0">
                    Extrato →
                  </span>
                </div>
              ) : (
                <div className="flex items-center justify-between gap-1 text-[11px]">
                  {balance >= 0 ? (
                    <span className="text-emerald-600 dark:text-emerald-400 font-semibold inline-flex items-center gap-0.5">
                      <TrendingUp className="w-3 h-3" />
                      Superávit
                    </span>
                  ) : (
                    <span className="text-rose-600 dark:text-rose-400 font-semibold inline-flex items-center gap-0.5">
                      <TrendingDown className="w-3 h-3" />
                      Déficit
                    </span>
                  )}
                  <span className="text-indigo-600 dark:text-indigo-400 font-semibold">
                    Ver extrato →
                  </span>
                </div>
              )}
            </div>

            {/* Receitas -> Filtra receitas + botão rápido + Receita */}
            <div
              onClick={() => {
                hapticSelection();
                setCategoryFilter(null);
                setFilterType('receita');
                setActiveSubTab('lancamentos');
              }}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  setCategoryFilter(null);
                  setFilterType('receita');
                  setActiveSubTab('lancamentos');
                }
              }}
              className="pressable bg-white dark:bg-zinc-900 border border-zinc-200/80 dark:border-zinc-800 hover:border-emerald-400 dark:hover:border-emerald-600 rounded-2xl p-3.5 cursor-pointer flex flex-col justify-between gap-2"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-semibold text-zinc-500 dark:text-zinc-400">
                  Receitas
                </span>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    hapticImpactLight();
                    openNewTransactionModal('receita');
                  }}
                  title="Adicionar nova receita"
                  aria-label="Adicionar receita"
                  className="pressable h-7 px-2 rounded-lg bg-emerald-50 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-100 dark:hover:bg-emerald-900/60 text-[11px] font-semibold inline-flex items-center gap-0.5 cursor-pointer whitespace-nowrap"
                >
                  <Plus className="w-3 h-3" />
                  <span>Entrada</span>
                </button>
              </div>
              <div className="text-lg sm:text-xl font-bold tracking-tight text-emerald-600 dark:text-emerald-400 truncate font-mono tabular-nums">
                {formatMoney(totalIncome)}
              </div>
              <div className="flex items-center justify-between text-[11px] text-zinc-500 dark:text-zinc-400 font-mono tabular-nums">
                <span>{monthlyTransactions.filter((t) => t.type === 'receita').length} entrada(s)</span>
                <ArrowUpRight className="w-3.5 h-3.5 text-emerald-500" />
              </div>
            </div>

            {/* Despesas -> Filtra despesas + botão rápido + Despesa */}
            <div
              onClick={() => {
                hapticSelection();
                setCategoryFilter(null);
                setFilterType('despesa');
                setActiveSubTab('lancamentos');
              }}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  setCategoryFilter(null);
                  setFilterType('despesa');
                  setActiveSubTab('lancamentos');
                }
              }}
              className="pressable bg-white dark:bg-zinc-900 border border-zinc-200/80 dark:border-zinc-800 hover:border-rose-400 dark:hover:border-rose-600 rounded-2xl p-3.5 cursor-pointer flex flex-col justify-between gap-2"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-semibold text-zinc-500 dark:text-zinc-400">
                  Despesas
                </span>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    hapticImpactLight();
                    openNewTransactionModal('despesa');
                  }}
                  title="Adicionar nova despesa"
                  aria-label="Adicionar despesa"
                  className="pressable h-7 px-2 rounded-lg bg-rose-50 dark:bg-rose-950/50 text-rose-700 dark:text-rose-300 hover:bg-rose-100 dark:hover:bg-rose-900/60 text-[11px] font-semibold inline-flex items-center gap-0.5 cursor-pointer whitespace-nowrap"
                >
                  <Plus className="w-3 h-3" />
                  <span>Gasto</span>
                </button>
              </div>
              <div className="text-lg sm:text-xl font-bold tracking-tight text-rose-600 dark:text-rose-400 truncate font-mono tabular-nums">
                {formatMoney(totalExpense)}
              </div>
              <div className="text-[11px] text-zinc-400 flex items-center gap-1.5 truncate font-mono tabular-nums">
                <span>Fix: {formatMoney(fixedExpenses)}</span>
                <span aria-hidden="true">·</span>
                <span>Var: {formatMoney(variableExpenses)}</span>
              </div>
            </div>

            {/* Poupança -> Abre Metas ou aporta sobra na meta */}
            <div
              onClick={() => {
                hapticSelection();
                setActiveSubTab('metas');
              }}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  setActiveSubTab('metas');
                }
              }}
              className="pressable bg-white dark:bg-zinc-900 border border-zinc-200/80 dark:border-zinc-800 hover:border-indigo-400 dark:hover:border-indigo-600 rounded-2xl p-3.5 cursor-pointer flex flex-col justify-between gap-2"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-semibold text-zinc-500 dark:text-zinc-400">
                  Poupança
                </span>
                {balance > 0 && financialGoals.length > 0 ? (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      const firstGoal = financialGoals[0];
                      setAddingToGoal({ id: firstGoal.id, title: firstGoal.title });
                      setAddGoalAmount(balance.toFixed(2));
                    }}
                    className="pressable h-7 px-2 rounded-lg bg-indigo-50 dark:bg-indigo-950/50 text-indigo-600 dark:text-indigo-400 hover:bg-indigo-100 text-[11px] font-semibold cursor-pointer whitespace-nowrap"
                  >
                    Guardar sobra
                  </button>
                ) : (
                  <PiggyBank className="w-4 h-4 text-indigo-500 shrink-0" />
                )}
              </div>
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-lg sm:text-xl font-bold tracking-tight text-indigo-600 dark:text-indigo-400 font-mono tabular-nums">
                  {savingsRate}%
                </span>
                <span className="text-[11px] text-zinc-500 dark:text-zinc-400 font-mono tabular-nums truncate">
                  {balance > 0 ? formatMoney(balance) : 'Ir para metas →'}
                </span>
              </div>
              <div className="w-full bg-zinc-100 dark:bg-zinc-800 h-1.5 rounded-full overflow-hidden">
                <div
                  className="bg-indigo-600 h-full rounded-full transition-all"
                  style={{ width: `${Math.min(100, savingsRate)}%` }}
                />
              </div>
            </div>
          </div>

          {/* Contas Fixas / Recorrentes Pendentes do Mês (1-tap launch) */}
          {recurringSummary.pendingRecurring.length > 0 && (
            <section className="bg-white dark:bg-zinc-900 border border-amber-300/80 dark:border-amber-800/70 rounded-2xl p-3.5 sm:p-4 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2.5">
                <div className="flex items-center gap-2.5 min-w-0">
                  <div className="w-9 h-9 rounded-xl bg-amber-50 dark:bg-amber-950/50 text-amber-600 dark:text-amber-400 flex items-center justify-center shrink-0">
                    <Repeat className="w-4 h-4" />
                  </div>
                  <div className="min-w-0">
                    <h3 className="text-xs sm:text-sm font-bold text-zinc-900 dark:text-zinc-100 truncate">
                      {recurringSummary.pendingRecurring.length} conta(s) fixa(s) pendente(s) neste mês
                    </h3>
                    <p className="text-[11px] text-zinc-500 dark:text-zinc-400 font-mono tabular-nums">
                      Total previsto: {formatMoney(recurringSummary.pendingTotal)} · Saldo após fixas:{' '}
                      {formatMoney(projectedBalance)}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-1.5 shrink-0">
                  <button
                    type="button"
                    onClick={() => {
                      hapticSelection();
                      setShowRecurringDetails((prev) => !prev);
                    }}
                    className="pressable h-9 px-2.5 rounded-xl border border-zinc-200 dark:border-zinc-700 text-xs font-semibold text-zinc-700 dark:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 inline-flex items-center gap-1 cursor-pointer"
                  >
                    <span>{showRecurringDetails ? 'Ocultar' : 'Revisar'}</span>
                    {showRecurringDetails ? (
                      <ChevronUp className="w-3.5 h-3.5" />
                    ) : (
                      <ChevronDown className="w-3.5 h-3.5" />
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={launchAllPendingRecurring}
                    className="pressable h-9 px-3 rounded-xl bg-amber-600 hover:bg-amber-700 text-white text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
                  >
                    <CalendarClock className="w-3.5 h-3.5" />
                    <span>Lançar todas</span>
                  </button>
                </div>
              </div>

              {showRecurringDetails && (
                <div className="divide-y divide-zinc-100 dark:divide-zinc-800 border-t border-zinc-100 dark:border-zinc-800 pt-1">
                  {recurringSummary.pendingRecurring.map((item) => (
                    <div
                      key={item.key}
                      className="py-2 flex items-center justify-between gap-2 text-xs"
                    >
                      <div className="min-w-0">
                        <p className="font-semibold text-zinc-900 dark:text-zinc-100 truncate">
                          {item.title}
                        </p>
                        <p className="text-[11px] text-zinc-500 dark:text-zinc-400 font-mono tabular-nums">
                          {getCategoryLabel(item.category)} · {item.suggestedDate.split('-').reverse().join('/')}
                        </p>
                      </div>

                      <div className="flex items-center gap-1.5 shrink-0">
                        <span className="font-mono tabular-nums font-bold text-rose-600 dark:text-rose-400 mr-1">
                          {formatMoney(item.amount)}
                        </span>
                        <button
                          type="button"
                          onClick={() => launchSingleRecurring(item)}
                          className="pressable h-8 px-2.5 rounded-lg bg-emerald-50 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-100 text-[11px] font-semibold cursor-pointer"
                        >
                          Lançar
                        </button>
                        <button
                          type="button"
                          onClick={() => dismissRecurringForMonth(item.key)}
                          title="Ignorar neste mês"
                          aria-label={`Ignorar ${item.title} neste mês`}
                          className="pressable w-8 h-8 rounded-lg text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 flex items-center justify-center cursor-pointer"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>
          )}

          {/* Visual Expense Breakdown Chart + Actionable Category Budget Limits */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            {/* Interactive Distribution Chart */}
            <div className="lg:col-span-1 bg-white dark:bg-zinc-900 border border-zinc-200/80 dark:border-zinc-800 rounded-2xl p-4 sm:p-5 flex flex-col justify-between space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <PieChartIcon className="w-4 h-4 text-indigo-600" />
                  <h3 className="text-sm font-bold text-zinc-900 dark:text-zinc-100">
                    Gastos por Categoria
                  </h3>
                </div>
                <span className="text-[11px] text-zinc-400 font-mono tabular-nums">
                  {monthlyTransactions.filter((t) => t.type === 'despesa').length} saídas
                </span>
              </div>

              {totalExpense === 0 ? (
                <div className="py-8 text-center text-xs text-zinc-400 space-y-2">
                  <p>Nenhuma despesa registrada neste mês.</p>
                  <button
                    type="button"
                    onClick={() => openNewTransactionModal('despesa')}
                    className="text-xs font-semibold text-indigo-600 dark:text-indigo-400 hover:underline cursor-pointer"
                  >
                    + Registrar primeira despesa
                  </button>
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="w-full h-3.5 rounded-lg overflow-hidden flex bg-zinc-100 dark:bg-zinc-800">
                    {Object.entries(categoryExpenses).map(([cat, amount]) => {
                      const pct = (amount / totalExpense) * 100;
                      const color = CATEGORY_COLORS[cat] || '#94a3b8';
                      return (
                        <button
                          key={cat}
                          type="button"
                          style={{ width: `${pct}%`, backgroundColor: color }}
                          title={`${getCategoryLabel(cat as FinanceCategory)}: ${formatMoney(
                            amount
                          )} (${pct.toFixed(1)}%)`}
                          className="h-full transition-opacity hover:opacity-80 cursor-pointer"
                          onClick={() => handleFilterCategoryFromResumo(cat as FinanceCategory)}
                        />
                      );
                    })}
                  </div>

                  <div className="space-y-1 max-h-56 overflow-y-auto pr-1">
                    {Object.entries(categoryExpenses)
                      .sort((a, b) => b[1] - a[1])
                      .map(([cat, amount]) => {
                        const pct = Math.round((amount / totalExpense) * 100);
                        const color = CATEGORY_COLORS[cat] || '#94a3b8';

                        return (
                          <button
                            key={cat}
                            type="button"
                            onClick={() => handleFilterCategoryFromResumo(cat as FinanceCategory)}
                            className="w-full flex items-center justify-between text-xs px-2 py-2 rounded-xl hover:bg-zinc-50 dark:hover:bg-zinc-800/70 transition-colors cursor-pointer text-left"
                          >
                            <div className="flex items-center gap-2 min-w-0">
                              <span
                                className="w-2.5 h-2.5 rounded-full shrink-0"
                                style={{ backgroundColor: color }}
                              />
                              <span className="text-zinc-800 dark:text-zinc-200 truncate">
                                {getCategoryLabel(cat as FinanceCategory)}
                              </span>
                            </div>
                            <div className="flex items-center gap-2 font-mono tabular-nums shrink-0">
                              <span className="text-zinc-400">{pct}%</span>
                              <span className="text-zinc-900 dark:text-zinc-100 font-semibold">
                                {formatMoney(amount)}
                              </span>
                            </div>
                          </button>
                        );
                      })}
                  </div>
                </div>
              )}
            </div>

            {/* Actionable Category Budget Limits */}
            <div className="lg:col-span-2 bg-white dark:bg-zinc-900 border border-zinc-200/80 dark:border-zinc-800 rounded-2xl p-4 sm:p-5 space-y-3">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <h3 className="text-sm font-bold text-zinc-900 dark:text-zinc-100">
                    Orçamentos do Mês
                  </h3>
                  <p className="text-[11px] text-zinc-500 dark:text-zinc-400">
                    Toque em uma categoria para filtrar seus gastos ou ajustar o limite
                  </p>
                </div>
                <button
                  type="button"
                  onClick={openBudgetModal}
                  className="text-xs text-indigo-600 dark:text-indigo-400 font-semibold hover:underline cursor-pointer shrink-0"
                >
                  Editar limites
                </button>
              </div>

              {budgetLimits.filter((b) => b.monthlyLimit > 0).length === 0 ? (
                <div className="py-8 text-center text-zinc-400 space-y-2">
                  <SlidersHorizontal className="w-6 h-6 mx-auto text-zinc-300 dark:text-zinc-600" />
                  <p className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
                    Nenhum teto de gasto configurado ainda
                  </p>
                  <button
                    type="button"
                    onClick={openBudgetModal}
                    className="text-xs text-indigo-600 dark:text-indigo-400 font-semibold hover:underline cursor-pointer"
                  >
                    Configurar limites por categoria
                  </button>
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  {budgetLimits
                    .filter((b) => b.monthlyLimit > 0)
                    .map((budgetObj) => {
                      const cat = budgetObj.category;
                      const spent = categoryExpenses[cat] || 0;
                      const limit = budgetObj.monthlyLimit;
                      const percent = Math.round((spent / limit) * 100);
                      const isOver = spent > limit;
                      const remaining = limit - spent;

                      return (
                        <div
                          key={cat}
                          onClick={() => handleFilterCategoryFromResumo(cat)}
                          role="button"
                          tabIndex={0}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault();
                              handleFilterCategoryFromResumo(cat);
                            }
                          }}
                          className={`pressable p-3 rounded-xl border transition-colors cursor-pointer space-y-1.5 ${
                            isOver
                              ? 'border-rose-200 dark:border-rose-900/60 bg-rose-50/40 dark:bg-rose-950/20'
                              : 'border-zinc-200/70 dark:border-zinc-800 hover:border-indigo-400 dark:hover:border-indigo-600 bg-zinc-50/50 dark:bg-zinc-800/30'
                          }`}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-xs font-bold text-zinc-800 dark:text-zinc-200 truncate">
                              {getCategoryLabel(cat)}
                            </span>
                            <div className="flex items-center gap-1.5 shrink-0">
                              <span
                                className={`text-xs font-bold font-mono tabular-nums ${
                                  isOver ? 'text-rose-600' : 'text-zinc-600 dark:text-zinc-300'
                                }`}
                              >
                                {percent}%
                              </span>
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  openBudgetModal();
                                }}
                                title={`Ajustar limite de ${getCategoryLabel(cat)}`}
                                aria-label={`Ajustar limite de ${getCategoryLabel(cat)}`}
                                className="w-7 h-7 rounded-lg hover:bg-zinc-200/70 dark:hover:bg-zinc-700 text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 flex items-center justify-center cursor-pointer"
                              >
                                <Pencil className="w-3 h-3" />
                              </button>
                            </div>
                          </div>

                          <div className="flex items-baseline justify-between text-[11px] text-zinc-500 font-mono tabular-nums">
                            <span className="font-semibold text-zinc-900 dark:text-zinc-100">
                              {formatMoney(spent)} / {formatMoney(limit)}
                            </span>
                            <span
                              className={
                                isOver
                                  ? 'text-rose-600 dark:text-rose-400 font-semibold'
                                  : 'text-emerald-600 dark:text-emerald-400 font-medium'
                              }
                            >
                              {isOver
                                ? `+${formatMoney(spent - limit)} acima`
                                : `Restam ${formatMoney(remaining)}`}
                            </span>
                          </div>

                          <div className="w-full bg-zinc-200 dark:bg-zinc-700 h-1.5 rounded-full overflow-hidden">
                            <div
                              className={`h-full rounded-full transition-all duration-300 ${
                                isOver
                                  ? 'bg-rose-500'
                                  : percent > 80
                                  ? 'bg-amber-500'
                                  : 'bg-emerald-500'
                              }`}
                              style={{ width: `${Math.min(100, percent)}%` }}
                            />
                          </div>
                        </div>
                      );
                    })}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* SUB-TAB 2: LANÇAMENTOS */}
      {activeSubTab === 'lancamentos' && (
        <div className="space-y-5 animate-tab-enter">
          {/* Android Notification Permission Banner (only shown on Android when disabled) */}
          {bankListenerSupported && !bankListenerPermission && (
            <div className="bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800/70 rounded-3xl p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="flex items-start gap-3">
                <div className="w-10 h-10 rounded-xl bg-amber-100 dark:bg-amber-900/50 text-amber-700 dark:text-amber-300 flex items-center justify-center shrink-0">
                  <Smartphone className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-zinc-900 dark:text-zinc-100">
                    Captura Automática de Bancos, Google Wallet e SMS Desativada
                  </h3>
                  <p className="text-xs text-zinc-600 dark:text-zinc-400 mt-0.5">
                    Permita o acesso às notificações para capturar entradas e saídas de bancos, Google Wallet, SMS e apps manuais.
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2 shrink-0 flex-wrap">
                <button
                  onClick={() => openBankListenerSettings()}
                  className="px-3.5 py-2 min-h-[40px] rounded-xl bg-amber-600 hover:bg-amber-700 text-white text-xs font-semibold cursor-pointer transition-colors"
                >
                  Ativar Acesso
                </button>
                <button
                  onClick={() => refreshBankListenerPermission()}
                  className="px-3 py-2 min-h-[40px] rounded-xl border border-amber-300 dark:border-amber-700 text-amber-800 dark:text-amber-200 text-xs font-semibold hover:bg-amber-100 dark:hover:bg-amber-900/40 cursor-pointer transition-colors"
                >
                  Verificar
                </button>
                <button
                  onClick={() => {
                    setCaptureConfigInitialTab('sources');
                    setIsCaptureConfigOpen(true);
                  }}
                  className="px-3 py-2 min-h-[40px] rounded-xl border border-amber-300 dark:border-amber-700 text-amber-900 dark:text-amber-100 text-xs font-semibold hover:bg-amber-100 dark:hover:bg-amber-900/40 cursor-pointer transition-colors inline-flex items-center gap-1"
                >
                  <Settings2 className="w-3.5 h-3.5" />
                  <span>Fontes</span>
                </button>
              </div>
            </div>
          )}

          {/* Bank Notification Review Queue */}
          {pendingBankNotifications.length > 0 && (
            <div className="bg-white dark:bg-zinc-900 border border-indigo-200 dark:border-indigo-900/70 rounded-3xl p-5 sm:p-6 shadow-xs space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-zinc-100 dark:border-zinc-800">
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="text-base font-bold text-zinc-900 dark:text-zinc-100">
                      Fila de Revisão Bancária
                    </h3>
                    <span className="px-2 py-0.5 rounded-md bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-400 text-xs font-bold tabular-nums">
                      {pendingBankNotifications.length}
                    </span>
                  </div>
                  <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
                    Confira os lançamentos capturados (Bancos, Google Wallet, SMS e Programados) antes de salvar
                  </p>
                </div>

                <div className="flex items-center gap-2 shrink-0 flex-wrap">
                  <button
                    onClick={() => {
                      setCaptureConfigInitialTab('sources');
                      setIsCaptureConfigOpen(true);
                    }}
                    className="flex items-center gap-1 px-3 py-2 min-h-[38px] rounded-xl border border-zinc-200 dark:border-zinc-700 text-zinc-600 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 text-xs font-semibold cursor-pointer transition-colors"
                  >
                    <Settings2 className="w-3.5 h-3.5" />
                    <span>Fontes</span>
                  </button>
                  <button
                    onClick={approveAllPendingBankNotifications}
                    className="flex items-center gap-1.5 px-3 py-2 min-h-[38px] rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold cursor-pointer transition-colors"
                  >
                    <CheckCheck className="w-3.5 h-3.5" />
                    <span>Confirmar todos</span>
                  </button>
                  <button
                    onClick={clearPendingBankNotifications}
                    className="px-3 py-2 min-h-[38px] rounded-xl border border-zinc-200 dark:border-zinc-700 text-zinc-600 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 text-xs font-semibold cursor-pointer transition-colors"
                  >
                    Limpar
                  </button>
                </div>
              </div>

              <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
                {pendingBankNotifications.map((item) => {
                  const isIncome = item.type === 'receita';
                  const formattedDate = new Intl.DateTimeFormat('pt-BR', {
                    day: 'numeric',
                    month: 'short',
                  }).format(new Date(item.date + 'T00:00:00'));

                  const sourceKindTag =
                    item.sourceKind === 'wallet'
                      ? 'Google Wallet'
                      : item.sourceKind === 'sms'
                      ? 'SMS'
                      : item.sourceKind === 'manual_app'
                      ? 'App Manual'
                      : item.sourceKind === 'scheduled_rule'
                      ? 'Programado'
                      : null;

                  return (
                    <div
                      key={item.id}
                      className="py-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                    >
                      <div className="flex items-start gap-3 min-w-0">
                        <div
                          className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 mt-0.5 ${
                            isIncome
                              ? 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600'
                              : 'bg-rose-50 dark:bg-rose-950/40 text-rose-600'
                          }`}
                        >
                          {isIncome ? (
                            <ArrowUpRight className="w-5 h-5" />
                          ) : (
                            <ArrowDownRight className="w-5 h-5" />
                          )}
                        </div>

                        <div className="min-w-0 space-y-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-[11px] font-bold text-indigo-600 dark:text-indigo-400">
                              {item.bankName}
                            </span>
                            {sourceKindTag && (
                              <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300">
                                {sourceKindTag}
                              </span>
                            )}
                            {item.isScheduled && (
                              <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-amber-50 dark:bg-amber-950/50 text-amber-700 dark:text-amber-300">
                                {item.scheduledLabel || 'Agendado'}
                              </span>
                            )}
                            <span className="text-xs text-zinc-300 dark:text-zinc-700">•</span>
                            <span className="text-xs text-zinc-500 dark:text-zinc-400">
                              {formattedDate}
                            </span>
                            <span className="text-xs text-zinc-300 dark:text-zinc-700">•</span>
                            <span className="text-xs text-zinc-500 dark:text-zinc-400">
                              {getCategoryLabel(item.category)}
                            </span>
                          </div>

                          <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 truncate">
                            {item.title}
                          </p>

                          <p className="text-[11px] text-zinc-500 dark:text-zinc-400 line-clamp-1">
                            {item.rawText}
                          </p>
                        </div>
                      </div>

                      <div className="flex items-center justify-between sm:justify-end gap-2.5 shrink-0 pl-13 sm:pl-0">
                        <span
                          className={`text-sm font-bold whitespace-nowrap tabular-nums ${
                            isIncome
                              ? 'text-emerald-600 dark:text-emerald-400'
                              : 'text-zinc-900 dark:text-zinc-100'
                          }`}
                        >
                          {isIncome ? '+' : '-'} {formatMoney(item.amount)}
                        </span>

                        <div className="flex items-center gap-1.5">
                          <button
                            onClick={() => approvePendingBankNotification(item.id)}
                            title="Confirmar e lançar"
                            className="flex items-center gap-1 px-2.5 py-1.5 min-h-[36px] rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold cursor-pointer transition-colors"
                          >
                            <Check className="w-3.5 h-3.5" />
                            <span>Confirmar</span>
                          </button>

                          <button
                            onClick={() => openEditPendingModal(item)}
                            title="Editar antes de lançar"
                            className="p-2 min-h-[36px] min-w-[36px] flex items-center justify-center rounded-xl border border-zinc-200 dark:border-zinc-700 text-zinc-600 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 cursor-pointer transition-colors"
                          >
                            <Pencil className="w-3.5 h-3.5" />
                          </button>

                          <button
                            onClick={() => dismissPendingBankNotification(item.id)}
                            title="Descartar"
                            className="p-2 min-h-[36px] min-w-[36px] flex items-center justify-center rounded-xl border border-zinc-200 dark:border-zinc-700 text-zinc-400 hover:text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-950/30 cursor-pointer transition-colors"
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Transactions List */}
          <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-3xl p-5 sm:p-6 shadow-xs space-y-4">
            <div className="flex flex-col lg:flex-row items-stretch lg:items-center justify-between gap-3">
              <div className="flex items-center gap-1 bg-zinc-100 dark:bg-zinc-800 p-1 rounded-xl">
                <button
                  onClick={() => setFilterType('all')}
                  className={`flex-1 sm:flex-initial px-3 py-1.5 min-h-[36px] rounded-lg text-xs font-medium transition-colors cursor-pointer whitespace-nowrap ${
                    filterType === 'all'
                      ? 'bg-white dark:bg-zinc-700 text-zinc-900 dark:text-zinc-100 shadow-xs'
                      : 'text-zinc-600 dark:text-zinc-400'
                  }`}
                >
                  Todas ({monthlyTransactions.length})
                </button>
                <button
                  onClick={() => setFilterType('receita')}
                  className={`flex-1 sm:flex-initial px-3 py-1.5 min-h-[36px] rounded-lg text-xs font-medium transition-colors cursor-pointer whitespace-nowrap ${
                    filterType === 'receita'
                      ? 'bg-white dark:bg-zinc-700 text-emerald-600 font-semibold shadow-xs'
                      : 'text-zinc-600 dark:text-zinc-400'
                  }`}
                >
                  Receitas
                </button>
                <button
                  onClick={() => setFilterType('despesa')}
                  className={`flex-1 sm:flex-initial px-3 py-1.5 min-h-[36px] rounded-lg text-xs font-medium transition-colors cursor-pointer whitespace-nowrap ${
                    filterType === 'despesa'
                      ? 'bg-white dark:bg-zinc-700 text-rose-600 font-semibold shadow-xs'
                      : 'text-zinc-600 dark:text-zinc-400'
                  }`}
                >
                  Despesas
                </button>
              </div>

              <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
                <div className="relative min-w-[200px] flex-1">
                  <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400" />
                  <input
                    type="text"
                    placeholder="Buscar transações..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="w-full pl-8 pr-3 py-2 min-h-[38px] text-xs rounded-xl bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 text-zinc-900 dark:text-zinc-100 focus:outline-none"
                  />
                </div>

                <div className="flex items-center gap-2 flex-wrap">
                  <button
                    onClick={() => {
                      setPasteError(null);
                      setIncludeScheduledInPaste(
                        bankCaptureSettings.captureScheduledMessagesEnabled
                      );
                      setIsPasteBankModalOpen(true);
                    }}
                    className="flex items-center justify-center gap-1.5 px-3 py-2 min-h-[38px] rounded-xl border border-indigo-200 dark:border-indigo-800 bg-indigo-50/70 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-300 hover:bg-indigo-100 dark:hover:bg-indigo-900/50 text-xs font-semibold cursor-pointer transition-colors whitespace-nowrap shrink-0"
                  >
                    <ClipboardPaste className="w-3.5 h-3.5" />
                    <span>Colar aviso / SMS</span>
                  </button>

                  <button
                    onClick={() => {
                      setCaptureConfigInitialTab('sources');
                      setIsCaptureConfigOpen(true);
                    }}
                    className="flex items-center justify-center gap-1.5 px-3 py-2 min-h-[38px] rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-700 text-xs font-semibold cursor-pointer transition-colors whitespace-nowrap shrink-0"
                  >
                    <Settings2 className="w-3.5 h-3.5" />
                    <span>
                      Fontes & Apps
                      {scheduledValueMessages.filter((m) => m.enabled).length > 0
                        ? ` (${scheduledValueMessages.filter((m) => m.enabled).length})`
                        : ''}
                    </span>
                  </button>
                </div>
              </div>
            </div>

            {/* Active Category Cross-Filter Chip */}
            {categoryFilter && (
              <div className="flex items-center justify-between gap-2 px-3.5 py-2 rounded-xl bg-indigo-50/70 dark:bg-indigo-950/30 border border-indigo-200/70 dark:border-indigo-900/60 text-xs">
                <span className="text-zinc-700 dark:text-zinc-300">
                  Filtrado por categoria:{' '}
                  <strong className="text-indigo-700 dark:text-indigo-300">
                    {getCategoryLabel(categoryFilter)}
                  </strong>
                </span>
                <button
                  onClick={() => setCategoryFilter(null)}
                  className="flex items-center gap-1 text-indigo-600 dark:text-indigo-400 font-semibold hover:underline cursor-pointer"
                >
                  <X className="w-3.5 h-3.5" />
                  <span>Limpar filtro</span>
                </button>
              </div>
            )}

            {visibleTransactions.length === 0 ? (
              <div className="py-12 text-center text-zinc-400 space-y-2.5">
                <CreditCard className="w-8 h-8 mx-auto text-zinc-300 dark:text-zinc-600" />
                <p className="text-sm font-medium">
                  {categoryFilter
                    ? 'Nenhuma transação encontrada nesta categoria neste mês'
                    : 'Nenhuma transação encontrada para este mês'}
                </p>
                <div className="flex items-center justify-center gap-3 flex-wrap">
                  {categoryFilter && (
                    <button
                      onClick={() => setCategoryFilter(null)}
                      className="text-xs text-zinc-600 dark:text-zinc-300 font-semibold hover:underline cursor-pointer"
                    >
                      Ver todas as categorias
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => openNewTransactionModal(filterType === 'receita' ? 'receita' : 'despesa')}
                    className="text-xs text-indigo-600 dark:text-indigo-400 font-semibold hover:underline cursor-pointer"
                  >
                    Adicionar transação
                  </button>
                </div>
              </div>
            ) : (
              <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
                {visibleTransactions.map((tx) => {
                  const isIncome = tx.type === 'receita';
                  const formattedDate = new Intl.DateTimeFormat('pt-BR', {
                    day: 'numeric',
                    month: 'short',
                  }).format(new Date(tx.date + 'T00:00:00'));

                  return (
                    <div
                      key={tx.id}
                      onClick={() => openEditTransactionModal(tx)}
                      role="button"
                      tabIndex={0}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          openEditTransactionModal(tx);
                        }
                      }}
                      className="py-2.5 flex items-center justify-between gap-2.5 hover:bg-zinc-50/70 dark:hover:bg-zinc-800/30 px-2 rounded-xl transition-colors cursor-pointer"
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <div
                          className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${
                            isIncome
                              ? 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600'
                              : 'bg-rose-50 dark:bg-rose-950/40 text-rose-600'
                          }`}
                        >
                          {isIncome ? (
                            <ArrowUpRight className="w-4 h-4" />
                          ) : (
                            <ArrowDownRight className="w-4 h-4" />
                          )}
                        </div>

                        <div className="min-w-0">
                          <p className="text-xs sm:text-sm font-semibold text-zinc-900 dark:text-zinc-100 truncate">
                            {tx.title}
                          </p>
                          <div className="flex items-center gap-1.5 text-[11px] text-zinc-400 mt-0.5 flex-wrap">
                            <span>{getCategoryLabel(tx.category)}</span>
                            <span aria-hidden="true">·</span>
                            <span className="font-mono tabular-nums">{formattedDate}</span>
                            {tx.paymentMethod && (
                              <>
                                <span aria-hidden="true">·</span>
                                <span>
                                  {PAYMENT_METHOD_LABELS[tx.paymentMethod] ||
                                    tx.paymentMethod.replace('_', ' ')}
                                </span>
                              </>
                            )}
                            {tx.recurring && (
                              <>
                                <span aria-hidden="true">·</span>
                                <span className="text-indigo-600 dark:text-indigo-400 font-semibold">
                                  Fixa
                                </span>
                              </>
                            )}
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-1 shrink-0">
                        <span
                          className={`text-xs sm:text-sm font-bold whitespace-nowrap font-mono tabular-nums mr-1 ${
                            isIncome
                              ? 'text-emerald-600 dark:text-emerald-400'
                              : 'text-zinc-900 dark:text-zinc-100'
                          }`}
                        >
                          {isIncome ? '+' : '-'} {formatMoney(tx.amount)}
                        </span>

                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleRepeatTransactionToday(tx);
                          }}
                          title="Repetir este lançamento hoje"
                          aria-label={`Repetir ${tx.title} hoje`}
                          className="pressable w-8 h-8 rounded-lg text-zinc-400 hover:text-indigo-600 dark:hover:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-950/40 flex items-center justify-center cursor-pointer"
                        >
                          <CopyPlus className="w-3.5 h-3.5" />
                        </button>

                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            openEditTransactionModal(tx);
                          }}
                          title="Editar lançamento"
                          aria-label={`Editar ${tx.title}`}
                          className="pressable w-8 h-8 rounded-lg text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 flex items-center justify-center cursor-pointer"
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </button>

                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            deleteTransaction(tx.id);
                          }}
                          title="Excluir lançamento"
                          aria-label={`Excluir ${tx.title}`}
                          className="pressable w-8 h-8 rounded-lg text-zinc-400 hover:text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-950/30 flex items-center justify-center cursor-pointer"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* SUB-TAB 3: METAS */}
      {activeSubTab === 'metas' && (
        <div className="space-y-4 animate-tab-enter">
          <div className="bg-white dark:bg-zinc-900 border border-zinc-200/80 dark:border-zinc-800 rounded-2xl p-4 sm:p-5 space-y-4">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <Target className="w-4 h-4 text-indigo-600 shrink-0" />
                <div>
                  <h3 className="text-sm font-bold text-zinc-900 dark:text-zinc-100">
                    Metas Financeiras
                  </h3>
                  <p className="text-[11px] text-zinc-500 dark:text-zinc-400">
                    Aporte valores em 1 toque ou ajuste prazos e alvos
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={openNewGoalModal}
                className="pressable flex items-center gap-1 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 px-3 h-9 rounded-xl cursor-pointer shrink-0 whitespace-nowrap"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Nova Meta</span>
              </button>
            </div>

            {financialGoals.length === 0 ? (
              <div className="py-10 text-center text-zinc-400 space-y-2">
                <Target className="w-7 h-7 mx-auto text-zinc-300 dark:text-zinc-600" />
                <p className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
                  Nenhuma meta financeira cadastrada
                </p>
                <button
                  type="button"
                  onClick={openNewGoalModal}
                  className="text-xs text-indigo-600 dark:text-indigo-400 font-semibold hover:underline cursor-pointer"
                >
                  Criar primeira meta
                </button>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                {financialGoals.map((goal) => {
                  const percent =
                    goal.targetAmount > 0
                      ? Math.min(100, Math.round((goal.currentAmount / goal.targetAmount) * 100))
                      : 0;
                  const remaining = Math.max(0, goal.targetAmount - goal.currentAmount);

                  let monthlySuggested: number | null = null;
                  if (remaining > 0 && goal.targetDate) {
                    const targetDt = new Date(`${goal.targetDate}T12:00:00`);
                    const now = new Date();
                    const monthsDiff =
                      (targetDt.getFullYear() - now.getFullYear()) * 12 +
                      (targetDt.getMonth() - now.getMonth());
                    if (monthsDiff >= 1) {
                      monthlySuggested = remaining / monthsDiff;
                    }
                  }

                  return (
                    <div
                      key={goal.id}
                      className="p-3.5 rounded-2xl border border-zinc-200/80 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-800/30 space-y-2.5 flex flex-col justify-between"
                    >
                      <div className="space-y-2">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <h4 className="text-sm font-bold text-zinc-900 dark:text-zinc-100 truncate">
                              {goal.title}
                            </h4>
                            <p className="text-[11px] text-zinc-500 dark:text-zinc-400 font-mono tabular-nums">
                              {remaining === 0
                                ? 'Meta alcançada!'
                                : `Faltam ${formatMoney(remaining)}`}
                              {monthlySuggested !== null && (
                                <>
                                  {' · '}
                                  <span>{formatMoney(monthlySuggested)}/mês</span>
                                </>
                              )}
                            </p>
                          </div>

                          <div className="flex items-center gap-0.5 shrink-0">
                            <button
                              type="button"
                              onClick={() => openEditGoalModal(goal)}
                              title="Editar meta"
                              aria-label={`Editar ${goal.title}`}
                              className="pressable w-8 h-8 rounded-lg text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 hover:bg-zinc-200/60 dark:hover:bg-zinc-700 flex items-center justify-center cursor-pointer"
                            >
                              <Pencil className="w-3.5 h-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => deleteGoal(goal.id)}
                              title="Excluir meta"
                              aria-label={`Excluir ${goal.title}`}
                              className="pressable w-8 h-8 rounded-lg text-zinc-400 hover:text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-950/30 flex items-center justify-center cursor-pointer"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>

                        <div className="flex items-baseline justify-between gap-2 text-xs font-mono tabular-nums">
                          <span className="text-sm font-bold text-indigo-600 dark:text-indigo-400">
                            {formatMoney(goal.currentAmount)}
                          </span>
                          <span className="text-zinc-500">
                            Alvo: {formatMoney(goal.targetAmount)} ({percent}%)
                          </span>
                        </div>

                        <div className="w-full bg-zinc-200 dark:bg-zinc-700 h-2 rounded-full overflow-hidden">
                          <div
                            className={`h-full rounded-full transition-all duration-300 ${
                              remaining === 0 ? 'bg-emerald-500' : 'bg-indigo-600'
                            }`}
                            style={{ width: `${percent}%` }}
                          />
                        </div>
                      </div>

                      {/* Ações rápidas de aporte direto no card */}
                      <div className="flex items-center gap-1.5 pt-1 border-t border-zinc-200/60 dark:border-zinc-700/60">
                        {[50, 100].map((quickVal) => (
                          <button
                            key={quickVal}
                            type="button"
                            onClick={() => {
                              hapticSuccess();
                              updateGoal(goal.id, {
                                currentAmount: goal.currentAmount + quickVal,
                              });
                            }}
                            className="pressable h-8 px-2.5 rounded-lg bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 hover:border-emerald-400 text-[11px] font-bold font-mono tabular-nums text-emerald-700 dark:text-emerald-400 cursor-pointer whitespace-nowrap"
                          >
                            +{quickVal}
                          </button>
                        ))}
                        <button
                          type="button"
                          onClick={() => {
                            setAddingToGoal({ id: goal.id, title: goal.title });
                            setAddGoalAmount('');
                          }}
                          className="pressable ml-auto h-8 px-2.5 rounded-lg bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-100 text-[11px] font-semibold cursor-pointer whitespace-nowrap"
                        >
                          + Outro valor
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Paste Bank Alert / SMS Modal */}
      {isPasteBankModalOpen && (
        <div
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              hapticSelection();
              setIsPasteBankModalOpen(false);
            }
          }}
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/60 backdrop-blur-xs animate-backdrop-in keyboard-modal-backdrop"
        >
          <div className="w-full sm:max-w-lg bg-white dark:bg-zinc-900 border-t sm:border border-zinc-200 dark:border-zinc-800 rounded-t-3xl sm:rounded-3xl shadow-2xl p-5 sm:p-8 pb-[max(1.25rem,env(safe-area-inset-bottom,0px))] sm:pb-8 keyboard-modal-sheet overflow-y-auto animate-bottom-sheet">
            <div className="sm:hidden w-10 h-1 rounded-full bg-zinc-300 dark:bg-zinc-700 mx-auto mb-3 shrink-0" />
            <div className="flex items-center justify-between pb-4 border-b border-zinc-100 dark:border-zinc-800">
              <div className="flex items-center gap-2">
                <ClipboardPaste className="w-5 h-5 text-indigo-600" />
                <h3 className="text-lg font-bold text-zinc-900 dark:text-zinc-100">
                  Colar Aviso Bancário ou SMS
                </h3>
              </div>
              <button
                type="button"
                onClick={() => {
                  hapticSelection();
                  setIsPasteBankModalOpen(false);
                }}
                className="pressable p-1.5 rounded-full text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 cursor-pointer"
                aria-label="Fechar"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleEnqueuePastedText} className="mt-4 space-y-4">
              <div className="space-y-2">
                <label className="block text-xs font-semibold text-zinc-700 dark:text-zinc-300">
                  Texto da notificação, Google Wallet ou SMS *
                </label>
                <textarea
                  rows={4}
                  required
                  value={pasteBankText}
                  onChange={(e) => {
                    setPasteBankText(e.target.value);
                    if (pasteError) setPasteError(null);
                  }}
                  placeholder="Ex.: Padaria Central R$ 24,50 com Visa •••• 1234 | SMS Itaú | Pix agendado..."
                  className="w-full px-3.5 py-2.5 text-sm rounded-xl bg-zinc-50 dark:bg-zinc-800/80 border border-zinc-200 dark:border-zinc-700 text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-indigo-500/30"
                />
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className="text-[11px] text-zinc-500 dark:text-zinc-400">Exemplos:</span>
                  <button
                    type="button"
                    onClick={() => {
                      setPasteBankName('Google Wallet');
                      setPasteBankText('Padaria Central R$ 24,50 com Visa •••• 1234');
                    }}
                    className="px-2 py-1 rounded-lg bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 text-[11px] font-medium text-zinc-700 dark:text-zinc-300 cursor-pointer"
                  >
                    Google Wallet
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setPasteBankName('');
                      setPasteBankText('CAIXA: Compra aprovada R$62,40 MERCADO BOM DIA 23/11 10:15');
                    }}
                    className="px-2 py-1 rounded-lg bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 text-[11px] font-medium text-zinc-700 dark:text-zinc-300 cursor-pointer"
                  >
                    SMS Banco
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setPasteBankName('');
                      setIncludeScheduledInPaste(true);
                      setPasteBankText('Nubank: Pix agendado de R$ 450,00 para Condominio para 05/12');
                    }}
                    className="px-2 py-1 rounded-lg bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 text-[11px] font-medium text-zinc-700 dark:text-zinc-300 cursor-pointer"
                  >
                    Pix Agendado
                  </button>
                </div>
              </div>

              <div className="flex items-center justify-between gap-2 px-3 py-2.5 rounded-xl bg-zinc-50 dark:bg-zinc-800/50 border border-zinc-200/80 dark:border-zinc-700">
                <label
                  htmlFor="paste-include-scheduled"
                  className="text-xs font-medium text-zinc-700 dark:text-zinc-300 flex items-center gap-2 cursor-pointer"
                >
                  <BellRing className="w-3.5 h-3.5 text-amber-600 shrink-0" />
                  <span>Reconhecer mensagens agendadas / programadas e faturas com valor</span>
                </label>
                <input
                  id="paste-include-scheduled"
                  type="checkbox"
                  checked={includeScheduledInPaste}
                  onChange={(e) => setIncludeScheduledInPaste(e.target.checked)}
                  className="w-4 h-4 accent-indigo-600 cursor-pointer shrink-0"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-zinc-700 dark:text-zinc-300 mb-1">
                  Banco, carteira ou app manual (opcional)
                </label>
                <input
                  type="text"
                  value={pasteBankName}
                  onChange={(e) => setPasteBankName(e.target.value)}
                  placeholder="Detectado automaticamente se citado no texto"
                  className="w-full px-3.5 py-2 text-sm rounded-xl bg-zinc-50 dark:bg-zinc-800/80 border border-zinc-200 dark:border-zinc-700 text-zinc-900 dark:text-zinc-100 focus:outline-none"
                />
              </div>

              {livePastePreview && (
                <div className="p-4 rounded-2xl bg-zinc-50 dark:bg-zinc-800/50 border border-zinc-200 dark:border-zinc-700 space-y-2">
                  <div className="flex items-center justify-between text-xs gap-2">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="font-bold text-indigo-600 dark:text-indigo-400">
                        {livePastePreview.bankName}
                      </span>
                      {livePastePreview.isScheduled && (
                        <span className="px-1.5 py-0.5 rounded bg-amber-50 dark:bg-amber-950/60 text-amber-700 dark:text-amber-300 text-[10px] font-semibold">
                          {livePastePreview.scheduledLabel || 'Programado'}
                        </span>
                      )}
                    </div>
                    <span
                      className={`font-bold px-2 py-0.5 rounded-md ${
                        livePastePreview.type === 'receita'
                          ? 'bg-emerald-50 dark:bg-emerald-950/50 text-emerald-600 dark:text-emerald-400'
                          : 'bg-rose-50 dark:bg-rose-950/50 text-rose-600 dark:text-rose-400'
                      }`}
                    >
                      {livePastePreview.type === 'receita' ? 'Entrada' : 'Saída'}
                    </span>
                  </div>

                  <div className="flex items-baseline justify-between gap-2">
                    <span className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 truncate">
                      {livePastePreview.title}
                    </span>
                    <span className="text-base font-bold text-zinc-900 dark:text-zinc-100 tabular-nums shrink-0">
                      {formatMoney(livePastePreview.amount)}
                    </span>
                  </div>

                  <div className="flex items-center gap-2 text-[11px] text-zinc-500 dark:text-zinc-400 flex-wrap">
                    <span>{getCategoryLabel(livePastePreview.category)}</span>
                    <span>•</span>
                    <span>
                      {livePastePreview.paymentMethod
                        ? PAYMENT_METHOD_LABELS[livePastePreview.paymentMethod]
                        : 'Transferência'}
                    </span>
                    <span>•</span>
                    <span>{livePastePreview.date}</span>
                  </div>
                </div>
              )}

              {pasteError && (
                <p className="text-xs font-medium text-rose-600 dark:text-rose-400">{pasteError}</p>
              )}

              <div className="pt-3 flex flex-col-reverse sm:flex-row sm:items-center justify-end gap-2.5 border-t border-zinc-100 dark:border-zinc-800">
                <button
                  type="button"
                  onClick={() => {
                    hapticSelection();
                    setIsPasteBankModalOpen(false);
                  }}
                  className="pressable min-h-[40px] px-4 py-2 rounded-xl text-xs font-medium text-zinc-700 dark:text-zinc-300 bg-zinc-100 hover:bg-zinc-200 dark:bg-zinc-800 dark:hover:bg-zinc-700 cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  disabled={!livePastePreview}
                  onClick={handleEditFromPastedText}
                  className="pressable min-h-[40px] px-4 py-2 rounded-xl text-xs font-semibold border border-zinc-200 dark:border-zinc-700 text-zinc-700 dark:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 disabled:opacity-40 cursor-pointer"
                >
                  Editar campos
                </button>
                <button
                  type="submit"
                  disabled={!livePastePreview}
                  className="pressable min-h-[40px] px-4 py-2 rounded-xl text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 cursor-pointer"
                >
                  Enviar para fila
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <FinanceTransactionModal
        isOpen={isAddModalOpen}
        editingPendingBankId={editingPendingBankId}
        editingTransactionId={editingTransactionId}
        txType={txType}
        setTxType={setTxType}
        txTitle={txTitle}
        setTxTitle={setTxTitle}
        txAmount={txAmount}
        setTxAmount={setTxAmount}
        txCategory={txCategory}
        setTxCategory={setTxCategory}
        txDate={txDate}
        setTxDate={setTxDate}
        txPaymentMethod={txPaymentMethod}
        setTxPaymentMethod={setTxPaymentMethod}
        txNotes={txNotes}
        setTxNotes={setTxNotes}
        txRecurring={txRecurring}
        setTxRecurring={setTxRecurring}
        onClose={() => {
          resetTransactionModal();
          setIsAddModalOpen(false);
        }}
        onSubmit={handleCreateTransaction}
      />

      <FinanceBudgetModal
        isOpen={isBudgetModalOpen}
        budgetDrafts={budgetDrafts}
        setBudgetDrafts={setBudgetDrafts}
        getCategoryLabel={getCategoryLabel}
        onClose={() => setIsBudgetModalOpen(false)}
        onSubmit={handleSaveBudgets}
      />

      <FinanceGoalModal
        isOpen={isGoalModalOpen}
        editingGoalId={editingGoalId}
        goalTitle={goalTitle}
        setGoalTitle={setGoalTitle}
        goalTarget={goalTarget}
        setGoalTarget={setGoalTarget}
        goalCurrent={goalCurrent}
        setGoalCurrent={setGoalCurrent}
        goalDate={goalDate}
        setGoalDate={setGoalDate}
        onClose={() => setIsGoalModalOpen(false)}
        onSubmit={handleCreateGoal}
      />

      <FinanceAddToGoalModal
        addingToGoal={addingToGoal}
        addGoalAmount={addGoalAmount}
        setAddGoalAmount={setAddGoalAmount}
        onClose={() => setAddingToGoal(null)}
        onSubmit={handleAddAmountToGoal}
      />

      {/* AI Receipt Scanner Modal (lazy-loaded on demand) */}
      {isScannerOpen && (
        <Suspense fallback={null}>
          <ReceiptScannerModal
            isOpen={isScannerOpen}
            onClose={() => {
              onConsumeInitialReceiptFile?.();
              setIsScannerOpen(false);
            }}
            initialFile={initialReceiptFile}
            onConsumeInitialFile={onConsumeInitialReceiptFile}
          />
        </Suspense>
      )}

      {/* Bank Capture, Wallet, SMS, Manual Apps & Scheduled Value Messages Modal */}
      {isCaptureConfigOpen && (
        <Suspense fallback={null}>
          <BankCaptureConfigModal
            isOpen={isCaptureConfigOpen}
            initialTab={captureConfigInitialTab}
            onClose={() => setIsCaptureConfigOpen(false)}
          />
        </Suspense>
      )}
    </div>
  );
};
