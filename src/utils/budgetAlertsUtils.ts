import { BudgetLimit, FinanceCategory, Transaction } from '../types';

export type BudgetAlertLevel = 'warning' | 'exceeded';

export interface MonthlyBudgetAlert {
  category: FinanceCategory;
  monthlyLimit: number;
  spent: number;
  percent: number;
  level: BudgetAlertLevel;
  monthKey: string;
}

export function evaluateMonthlyBudgetAlerts(
  transactions: Transaction[],
  budgetLimits: BudgetLimit[],
  referenceDate: Date = new Date()
): MonthlyBudgetAlert[] {
  const activeLimits = budgetLimits.filter((b) => Number.isFinite(b.monthlyLimit) && b.monthlyLimit > 0);
  if (activeLimits.length === 0) return [];

  const targetYear = referenceDate.getFullYear();
  const targetMonth = referenceDate.getMonth();
  const monthKey = `${targetYear}-${String(targetMonth + 1).padStart(2, '0')}`;

  const spentByCategory = new Map<FinanceCategory, number>();
  for (const tx of transactions) {
    if (tx.type !== 'despesa' || !tx.date) continue;
    if (!tx.date.startsWith(monthKey)) continue;
    spentByCategory.set(tx.category, (spentByCategory.get(tx.category) || 0) + tx.amount);
  }

  const alerts: MonthlyBudgetAlert[] = [];
  for (const budget of activeLimits) {
    const spent = spentByCategory.get(budget.category) || 0;
    const rawPct = (spent / budget.monthlyLimit) * 100;
    const percent = Math.round(rawPct);

    if (rawPct >= 100) {
      alerts.push({
        category: budget.category,
        monthlyLimit: budget.monthlyLimit,
        spent,
        percent,
        level: 'exceeded',
        monthKey,
      });
    } else if (rawPct >= 80) {
      alerts.push({
        category: budget.category,
        monthlyLimit: budget.monthlyLimit,
        spent,
        percent,
        level: 'warning',
        monthKey,
      });
    }
  }

  return alerts.sort((a, b) => b.percent - a.percent);
}
