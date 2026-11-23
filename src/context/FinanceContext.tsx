import { createContext, useContext } from 'react';
import {
  BudgetLimit,
  FinancialGoal,
  PendingBankNotification,
  Transaction,
} from '../types';

export interface FinanceContextType {
  transactions: Transaction[];
  financialGoals: FinancialGoal[];
  budgetLimits: BudgetLimit[];

  hideValues: boolean;
  toggleHideValues: () => void;
  formatMoney: (amount: number) => string;
  financeLockEnabled: boolean;
  setFinanceLockEnabled: (enabled: boolean) => void;

  addTransaction: (tx: Omit<Transaction, 'id'>) => void;
  updateTransaction: (id: string, updates: Partial<Omit<Transaction, 'id'>>) => void;
  deleteTransaction: (id: string) => void;
  addGoal: (goal: Omit<FinancialGoal, 'id'>) => void;
  updateGoal: (id: string, updates: Partial<FinancialGoal>) => void;
  deleteGoal: (id: string) => void;
  updateBudgetLimit: (category: Transaction['category'], limit: number) => void;

  pendingBankNotifications: PendingBankNotification[];
  bankListenerSupported: boolean;
  bankListenerPermission: boolean;
  refreshBankListenerPermission: () => Promise<boolean>;
  openBankListenerSettings: () => Promise<void>;
  enqueueParsedBankText: (rawText: string, bankName?: string) => PendingBankNotification | null;
  approvePendingBankNotification: (
    id: string,
    overrides?: Partial<Omit<Transaction, 'id'>>
  ) => void;
  approveAllPendingBankNotifications: () => void;
  dismissPendingBankNotification: (id: string) => void;
  clearPendingBankNotifications: () => void;
}

export const FinanceContext = createContext<FinanceContextType | null>(null);

export const useFinance = (): FinanceContextType => {
  const ctx = useContext(FinanceContext);
  if (!ctx) {
    throw new Error('useFinance must be used within an AppProvider');
  }
  return ctx;
};
