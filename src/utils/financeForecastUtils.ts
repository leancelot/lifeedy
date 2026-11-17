import { FinanceCategory, Transaction } from '../types';

export interface PendingRecurringExpense {
  key: string;
  sourceId: string;
  title: string;
  amount: number;
  category: FinanceCategory;
  paymentMethod?: Transaction['paymentMethod'];
  notes?: string;
  suggestedDate: string;
}

export interface MonthlyRecurringSummary {
  pendingRecurring: PendingRecurringExpense[];
  pendingTotal: number;
}

export function normalizeRecurringKey(title: string, category: FinanceCategory): string {
  const normalizedTitle = title
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ');
  return `${normalizedTitle}::${category}`;
}

export function getRecurringMonthDismissStorageKey(year: number, monthIndex: number): string {
  return `${year}-${String(monthIndex + 1).padStart(2, '0')}`;
}

export function computeMonthlyRecurringSummary(
  transactions: Transaction[],
  targetYear: number,
  targetMonthIndex: number,
  dismissedKeys: string[] = []
): MonthlyRecurringSummary {
  const targetYm = `${targetYear}-${String(targetMonthIndex + 1).padStart(2, '0')}`;
  const daysInTargetMonth = new Date(targetYear, targetMonthIndex + 1, 0).getDate();
  const dismissedSet = new Set(dismissedKeys);

  // Keys already launched in the target month (whether flagged recurring or manual)
  const existingKeysInTargetMonth = new Set<string>();
  for (const tx of transactions) {
    if (tx.type !== 'despesa' || !tx.date) continue;
    if (tx.date.slice(0, 7) === targetYm) {
      existingKeysInTargetMonth.add(normalizeRecurringKey(tx.title, tx.category));
    }
  }

  // Collect latest template for each recurring expense from months strictly earlier than targetYm
  const recurringTemplates = new Map<string, Transaction>();
  const sortedEarlier = [...transactions]
    .filter((tx) => tx.type === 'despesa' && tx.recurring && tx.date && tx.date.slice(0, 7) < targetYm)
    .sort((a, b) => a.date.localeCompare(b.date));

  for (const tx of sortedEarlier) {
    const key = normalizeRecurringKey(tx.title, tx.category);
    recurringTemplates.set(key, tx);
  }

  const pendingRecurring: PendingRecurringExpense[] = [];
  for (const [key, template] of recurringTemplates.entries()) {
    if (existingKeysInTargetMonth.has(key) || dismissedSet.has(key)) continue;
    const origDay = parseInt(template.date.slice(8, 10), 10) || 1;
    const clampedDay = Math.min(Math.max(1, origDay), daysInTargetMonth);
    const suggestedDate = `${targetYm}-${String(clampedDay).padStart(2, '0')}`;

    pendingRecurring.push({
      key,
      sourceId: template.id,
      title: template.title,
      amount: template.amount,
      category: template.category,
      paymentMethod: template.paymentMethod,
      notes: template.notes,
      suggestedDate,
    });
  }

  pendingRecurring.sort((a, b) => a.suggestedDate.localeCompare(b.suggestedDate));
  const pendingTotal = Math.round(
    pendingRecurring.reduce((sum, item) => sum + item.amount, 0) * 100
  ) / 100;

  return {
    pendingRecurring,
    pendingTotal,
  };
}

export function computeProjectedBalance(
  currentIncome: number,
  currentExpense: number,
  pendingRecurringTotal: number
): { currentBalance: number; projectedBalance: number } {
  const currentBalance = Math.round((currentIncome - currentExpense) * 100) / 100;
  const projectedBalance = Math.round((currentBalance - pendingRecurringTotal) * 100) / 100;
  return { currentBalance, projectedBalance };
}
