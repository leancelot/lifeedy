import React, { useCallback, useEffect, useState } from 'react';
import { hapticImpactLight, hapticWarning } from '../../services/hapticsService';
import { BudgetLimit, FinancialGoal, Transaction } from '../../types';

const STORAGE_KEY_HIDE_VALUES = 'vidaorganizada_hide_values_v1';
const STORAGE_KEY_FINANCE_LOCK = 'vidaorganizada_finance_lock_v1';

const BRL_FORMATTER = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
});

interface UseFinanceActionsOptions {
  transactions: Transaction[];
  setTransactions: React.Dispatch<React.SetStateAction<Transaction[]>>;
  setFinancialGoals: React.Dispatch<React.SetStateAction<FinancialGoal[]>>;
  setBudgetLimits: React.Dispatch<React.SetStateAction<BudgetLimit[]>>;
  onDataChanged: () => void;
  showUndoToast: (message: string, onUndo: () => void) => void;
}

/**
 * Reúne lançamentos financeiros, metas, limites por categoria,
 * modo privacidade (ocultar valores) e bloqueio biométrico da aba Finanças.
 */
export function useFinanceActions({
  transactions,
  setTransactions,
  setFinancialGoals,
  setBudgetLimits,
  onDataChanged,
  showUndoToast,
}: UseFinanceActionsOptions) {
  const [hideValues, setHideValues] = useState<boolean>(() => {
    try {
      return localStorage.getItem(STORAGE_KEY_HIDE_VALUES) === 'true';
    } catch {
      return false;
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY_HIDE_VALUES, String(hideValues));
    } catch {
      // ignora erro de armazenamento
    }
  }, [hideValues]);

  const toggleHideValues = useCallback(() => {
    hapticImpactLight();
    setHideValues((prev) => !prev);
  }, []);

  const formatMoney = useCallback(
    (amount: number) => {
      if (hideValues) return 'R$ •••••';
      return BRL_FORMATTER.format(amount);
    },
    [hideValues]
  );

  const [financeLockEnabled, setFinanceLockEnabledState] = useState<boolean>(() => {
    try {
      return localStorage.getItem(STORAGE_KEY_FINANCE_LOCK) === 'true';
    } catch {
      return false;
    }
  });

  const setFinanceLockEnabled = useCallback((enabled: boolean) => {
    setFinanceLockEnabledState(enabled);
    try {
      localStorage.setItem(STORAGE_KEY_FINANCE_LOCK, String(enabled));
    } catch {
      // ignora erro de armazenamento
    }
  }, []);

  const addTransaction = useCallback(
    (txData: Omit<Transaction, 'id'>) => {
      const newTx: Transaction = {
        ...txData,
        id: 'tx-' + Date.now() + '-' + Math.random().toString(36).substring(2, 6),
      };
      hapticImpactLight();
      setTransactions((prev) => [newTx, ...prev]);
      onDataChanged();
    },
    [onDataChanged, setTransactions]
  );

  const updateTransaction = useCallback(
    (id: string, updates: Partial<Omit<Transaction, 'id'>>) => {
      hapticImpactLight();
      setTransactions((prev) => prev.map((tx) => (tx.id === id ? { ...tx, ...updates } : tx)));
      onDataChanged();
    },
    [onDataChanged, setTransactions]
  );

  const deleteTransaction = useCallback(
    (id: string) => {
      const txToDelete = transactions.find((tx) => tx.id === id);
      if (!txToDelete) return;

      hapticWarning();
      setTransactions((prev) => prev.filter((tx) => tx.id !== id));
      onDataChanged();

      showUndoToast(`Transação "${txToDelete.title}" excluída.`, () => {
        setTransactions((prev) => [txToDelete, ...prev]);
        onDataChanged();
      });
    },
    [onDataChanged, setTransactions, showUndoToast, transactions]
  );

  const addGoal = useCallback(
    (goalData: Omit<FinancialGoal, 'id'>) => {
      const newGoal: FinancialGoal = {
        ...goalData,
        id: 'goal-' + Date.now(),
      };
      setFinancialGoals((prev) => [...prev, newGoal]);
      onDataChanged();
    },
    [onDataChanged, setFinancialGoals]
  );

  const updateGoal = useCallback(
    (id: string, updates: Partial<FinancialGoal>) => {
      setFinancialGoals((prev) => prev.map((g) => (g.id === id ? { ...g, ...updates } : g)));
      onDataChanged();
    },
    [onDataChanged, setFinancialGoals]
  );

  const deleteGoal = useCallback(
    (id: string) => {
      setFinancialGoals((prev) => prev.filter((g) => g.id !== id));
      onDataChanged();
    },
    [onDataChanged, setFinancialGoals]
  );

  const updateBudgetLimit = useCallback(
    (category: Transaction['category'], limit: number) => {
      setBudgetLimits((prev) => {
        if (limit <= 0 || Number.isNaN(limit)) {
          return prev.filter((b) => b.category !== category);
        }
        const exists = prev.find((b) => b.category === category);
        if (exists) {
          return prev.map((b) => (b.category === category ? { ...b, monthlyLimit: limit } : b));
        }
        return [...prev, { category, monthlyLimit: limit }];
      });
      onDataChanged();
    },
    [onDataChanged, setBudgetLimits]
  );

  return {
    hideValues,
    toggleHideValues,
    formatMoney,
    financeLockEnabled,
    setFinanceLockEnabled,
    addTransaction,
    updateTransaction,
    deleteTransaction,
    addGoal,
    updateGoal,
    deleteGoal,
    updateBudgetLimit,
  };
}
