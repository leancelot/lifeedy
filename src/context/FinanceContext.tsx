import { createContext, useContext } from 'react';
import { InstalledAppInfo } from '../services/bankNotificationBridge';
import {
  BankCaptureSettings,
  BudgetLimit,
  FinancialGoal,
  PendingBankNotification,
  ScheduledValueMessage,
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
  enqueueParsedBankText: (
    rawText: string,
    bankName?: string,
    options?: { includeScheduledMessages?: boolean; sourceKind?: PendingBankNotification['sourceKind'] }
  ) => PendingBankNotification | null;
  approvePendingBankNotification: (
    id: string,
    overrides?: Partial<Omit<Transaction, 'id'>>
  ) => void;
  approveAllPendingBankNotifications: () => void;
  dismissPendingBankNotification: (id: string) => void;
  clearPendingBankNotifications: () => void;

  bankCaptureSettings: BankCaptureSettings;
  updateBankCaptureSettings: (patch: Partial<Omit<BankCaptureSettings, 'manualApps'>>) => void;
  addManualCaptureApp: (packageName: string, label: string) => void;
  toggleManualCaptureApp: (packageName: string) => void;
  removeManualCaptureApp: (packageName: string) => void;
  installedAndroidApps: InstalledAppInfo[];
  loadInstalledAndroidApps: () => Promise<InstalledAppInfo[]>;

  scheduledValueMessages: ScheduledValueMessage[];
  addScheduledValueMessage: (
    input: Omit<ScheduledValueMessage, 'id' | 'createdAt' | 'lastTriggeredKey'>
  ) => ScheduledValueMessage;
  toggleScheduledValueMessage: (id: string) => void;
  deleteScheduledValueMessage: (id: string) => void;
  triggerScheduledValueMessageNow: (id: string) => PendingBankNotification | null;
}

export const FinanceContext = createContext<FinanceContextType | null>(null);

export const useFinance = (): FinanceContextType => {
  const ctx = useContext(FinanceContext);
  if (!ctx) {
    throw new Error('useFinance must be used within an AppProvider');
  }
  return ctx;
};
