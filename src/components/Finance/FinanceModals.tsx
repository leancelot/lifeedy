import React from 'react';
import { X } from 'lucide-react';
import { hapticSelection } from '../../services/hapticsService';
import { FinanceCategory, Transaction, TransactionType } from '../../types';

interface FinanceTransactionModalProps {
  isOpen: boolean;
  editingPendingBankId: string | null;
  editingTransactionId: string | null;
  txType: TransactionType;
  setTxType: (type: TransactionType) => void;
  txTitle: string;
  setTxTitle: (title: string) => void;
  txAmount: string;
  setTxAmount: (amount: string) => void;
  txCategory: FinanceCategory;
  setTxCategory: (cat: FinanceCategory) => void;
  txDate: string;
  setTxDate: (date: string) => void;
  txPaymentMethod: Transaction['paymentMethod'];
  setTxPaymentMethod: (pm: Transaction['paymentMethod']) => void;
  txNotes: string;
  setTxNotes: (notes: string) => void;
  txRecurring: boolean;
  setTxRecurring: (recurring: boolean) => void;
  onClose: () => void;
  onSubmit: (e: React.FormEvent) => void;
}

export const FinanceTransactionModal: React.FC<FinanceTransactionModalProps> = ({
  isOpen,
  editingPendingBankId,
  editingTransactionId,
  txType,
  setTxType,
  txTitle,
  setTxTitle,
  txAmount,
  setTxAmount,
  txCategory,
  setTxCategory,
  txDate,
  setTxDate,
  txPaymentMethod,
  setTxPaymentMethod,
  txNotes,
  setTxNotes,
  txRecurring,
  setTxRecurring,
  onClose,
  onSubmit,
}) => {
  if (!isOpen) return null;

  return (
    <div
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          hapticSelection();
          onClose();
        }
      }}
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/60 backdrop-blur-xs animate-backdrop-in keyboard-modal-backdrop"
    >
      <div className="w-full sm:max-w-lg bg-white dark:bg-zinc-900 border-t sm:border border-zinc-200 dark:border-zinc-800 rounded-t-3xl sm:rounded-3xl shadow-2xl p-5 sm:p-8 pb-[max(1.25rem,env(safe-area-inset-bottom,0px))] sm:pb-8 keyboard-modal-sheet overflow-y-auto animate-bottom-sheet">
        <div className="sm:hidden w-10 h-1 rounded-full bg-zinc-300 dark:bg-zinc-700 mx-auto mb-3 shrink-0" />
        <div className="flex items-center justify-between pb-4 border-b border-zinc-100 dark:border-zinc-800">
          <h3 className="text-lg font-bold text-zinc-900 dark:text-zinc-100">
            {editingPendingBankId
              ? 'Revisar Lançamento Bancário'
              : editingTransactionId
              ? 'Editar Transação'
              : 'Nova Transação'}
          </h3>
          <button
            type="button"
            onClick={() => {
              hapticSelection();
              onClose();
            }}
            className="pressable p-1.5 rounded-full text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 cursor-pointer"
            aria-label="Fechar"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={onSubmit} className="mt-4 space-y-4">
          <div className="grid grid-cols-2 gap-2 p-1 bg-zinc-100 dark:bg-zinc-800 rounded-xl">
            <button
              type="button"
              onClick={() => setTxType('despesa')}
              className={`py-2 text-xs font-semibold rounded-lg transition-colors cursor-pointer ${
                txType === 'despesa'
                  ? 'bg-rose-600 text-white shadow-xs'
                  : 'text-zinc-600 dark:text-zinc-400 hover:text-zinc-900'
              }`}
            >
              Despesa (Saída)
            </button>
            <button
              type="button"
              onClick={() => setTxType('receita')}
              className={`py-2 text-xs font-semibold rounded-lg transition-colors cursor-pointer ${
                txType === 'receita'
                  ? 'bg-emerald-600 text-white shadow-xs'
                  : 'text-zinc-600 dark:text-zinc-400 hover:text-zinc-900'
              }`}
            >
              Receita (Entrada)
            </button>
          </div>

          <div>
            <label className="block text-xs font-semibold text-zinc-700 dark:text-zinc-300 mb-1">
              Descrição da Transação *
            </label>
            <input
              type="text"
              required
              placeholder="Descrição da transação"
              value={txTitle}
              onChange={(e) => setTxTitle(e.target.value)}
              className="w-full px-3.5 py-2.5 text-sm rounded-xl bg-zinc-50 dark:bg-zinc-800/80 border border-zinc-200 dark:border-zinc-700 text-zinc-900 dark:text-zinc-100 focus:outline-none"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-zinc-700 dark:text-zinc-300 mb-1">
                Valor (R$) *
              </label>
              <input
                type="number"
                step="0.01"
                min="0.01"
                required
                placeholder="Valor"
                value={txAmount}
                onChange={(e) => setTxAmount(e.target.value)}
                className="w-full px-3.5 py-2 text-sm rounded-xl bg-zinc-50 dark:bg-zinc-800/80 border border-zinc-200 dark:border-zinc-700 text-zinc-900 dark:text-zinc-100 focus:outline-none"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-zinc-700 dark:text-zinc-300 mb-1">
                Data
              </label>
              <input
                type="date"
                required
                value={txDate}
                onChange={(e) => setTxDate(e.target.value)}
                className="w-full px-3.5 py-2 text-sm rounded-xl bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 text-zinc-900 dark:text-zinc-100 focus:outline-none"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-zinc-700 dark:text-zinc-300 mb-1">
                Categoria
              </label>
              <select
                value={txCategory}
                onChange={(e) => setTxCategory(e.target.value as FinanceCategory)}
                className="w-full px-3.5 py-2 text-sm rounded-xl bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 text-zinc-900 dark:text-zinc-100 focus:outline-none"
              >
                <option value="moradia">Moradia & Contas</option>
                <option value="alimentacao">Alimentação</option>
                <option value="transporte">Transporte</option>
                <option value="saude">Saúde</option>
                <option value="educacao">Educação</option>
                <option value="lazer">Lazer</option>
                <option value="salario">Salário</option>
                <option value="freelance">Freelance</option>
                <option value="investimentos">Investimentos</option>
                <option value="outros">Outros</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-zinc-700 dark:text-zinc-300 mb-1">
                Método de Pagamento
              </label>
              <select
                value={txPaymentMethod}
                onChange={(e) => setTxPaymentMethod(e.target.value as Transaction['paymentMethod'])}
                className="w-full px-3.5 py-2 text-sm rounded-xl bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 text-zinc-900 dark:text-zinc-100 focus:outline-none"
              >
                <option value="pix">Pix</option>
                <option value="cartao_credito">Cartão de Crédito</option>
                <option value="cartao_debito">Cartão de Débito</option>
                <option value="dinheiro">Dinheiro</option>
                <option value="transferencia">Transferência</option>
              </select>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="txRecurringCheckbox"
              checked={txRecurring}
              onChange={(e) => setTxRecurring(e.target.checked)}
              className="w-4 h-4 rounded text-emerald-600 cursor-pointer"
            />
            <label
              htmlFor="txRecurringCheckbox"
              className="text-xs font-medium text-zinc-700 dark:text-zinc-300 cursor-pointer"
            >
              Despesa / Entrada Fixa Recorrente (todo mês)
            </label>
          </div>

          <div>
            <label className="block text-xs font-semibold text-zinc-700 dark:text-zinc-300 mb-1">
              Notas / Observações
            </label>
            <input
              type="text"
              placeholder="Observações (opcional)"
              value={txNotes}
              onChange={(e) => setTxNotes(e.target.value)}
              className="w-full px-3.5 py-2 text-sm rounded-xl bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 text-zinc-900 dark:text-zinc-100 focus:outline-none"
            />
          </div>

          <div className="pt-4 flex items-center justify-end gap-3 border-t border-zinc-100 dark:border-zinc-800">
            <button
              type="button"
              onClick={() => {
                hapticSelection();
                onClose();
              }}
              className="pressable min-h-[40px] px-4 py-2 rounded-xl text-sm font-medium text-zinc-700 dark:text-zinc-300 bg-zinc-100 hover:bg-zinc-200 dark:bg-zinc-800 dark:hover:bg-zinc-700 cursor-pointer"
            >
              Cancelar
            </button>
            <button
              type="submit"
              className={`pressable min-h-[40px] px-5 py-2 rounded-xl text-sm font-semibold text-white shadow-md cursor-pointer ${
                txType === 'receita'
                  ? 'bg-emerald-600 hover:bg-emerald-700 shadow-emerald-600/20'
                  : 'bg-rose-600 hover:bg-rose-700 shadow-rose-600/20'
              }`}
            >
              {editingPendingBankId
                ? 'Confirmar e Lançar'
                : editingTransactionId
                ? 'Salvar Alterações'
                : 'Adicionar Transação'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

interface FinanceBudgetModalProps {
  isOpen: boolean;
  budgetDrafts: Record<string, string>;
  setBudgetDrafts: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  getCategoryLabel: (cat: FinanceCategory) => string;
  onClose: () => void;
  onSubmit: (e: React.FormEvent) => void;
}

export const FinanceBudgetModal: React.FC<FinanceBudgetModalProps> = ({
  isOpen,
  budgetDrafts,
  setBudgetDrafts,
  getCategoryLabel,
  onClose,
  onSubmit,
}) => {
  if (!isOpen) return null;

  return (
    <div
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          hapticSelection();
          onClose();
        }
      }}
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/60 backdrop-blur-xs animate-backdrop-in keyboard-modal-backdrop"
    >
      <div className="w-full sm:max-w-md bg-white dark:bg-zinc-900 border-t sm:border border-zinc-200 dark:border-zinc-800 rounded-t-3xl sm:rounded-3xl shadow-2xl p-5 sm:p-8 pb-[max(1.25rem,env(safe-area-inset-bottom,0px))] sm:pb-8 keyboard-modal-sheet overflow-y-auto animate-bottom-sheet">
        <div className="sm:hidden w-10 h-1 rounded-full bg-zinc-300 dark:bg-zinc-700 mx-auto mb-3 shrink-0" />
        <div className="flex items-center justify-between pb-4 border-b border-zinc-100 dark:border-zinc-800">
          <h3 className="text-lg font-bold text-zinc-900 dark:text-zinc-100">
            Limites de Orçamento Mensal
          </h3>
          <button
            type="button"
            onClick={() => {
              hapticSelection();
              onClose();
            }}
            className="pressable p-1.5 rounded-full text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 cursor-pointer"
            aria-label="Fechar"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={onSubmit}>
          <div className="mt-4 space-y-3">
            {(
              [
                'moradia',
                'alimentacao',
                'transporte',
                'saude',
                'lazer',
                'outros',
              ] as FinanceCategory[]
            ).map((cat) => (
              <div key={cat} className="flex items-center justify-between gap-4">
                <span className="text-xs font-semibold text-zinc-700 dark:text-zinc-300">
                  {getCategoryLabel(cat)}
                </span>
                <div className="flex items-center gap-1.5">
                  <span className="text-xs text-zinc-400">R$</span>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    placeholder="Sem limite"
                    value={budgetDrafts[cat] ?? ''}
                    onChange={(e) =>
                      setBudgetDrafts((prev) => ({ ...prev, [cat]: e.target.value }))
                    }
                    className="w-28 px-2.5 py-1.5 text-xs rounded-lg bg-zinc-100 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 text-zinc-900 dark:text-zinc-100 text-right font-semibold tabular-nums focus:outline-none"
                  />
                </div>
              </div>
            ))}
          </div>

          <div className="mt-6 pt-4 border-t border-zinc-100 dark:border-zinc-800 flex justify-end gap-2">
            <button
              type="button"
              onClick={() => {
                hapticSelection();
                onClose();
              }}
              className="pressable min-h-[40px] px-4 py-2 rounded-xl text-sm font-medium text-zinc-600 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 cursor-pointer"
            >
              Cancelar
            </button>
            <button
              type="submit"
              className="pressable min-h-[40px] px-4 py-2 rounded-xl text-sm font-semibold text-white bg-indigo-600 hover:bg-indigo-700 cursor-pointer"
            >
              Salvar Limites
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

interface FinanceGoalModalProps {
  isOpen: boolean;
  editingGoalId: string | null;
  goalTitle: string;
  setGoalTitle: (v: string) => void;
  goalTarget: string;
  setGoalTarget: (v: string) => void;
  goalCurrent: string;
  setGoalCurrent: (v: string) => void;
  goalDate: string;
  setGoalDate: (v: string) => void;
  onClose: () => void;
  onSubmit: (e: React.FormEvent) => void;
}

export const FinanceGoalModal: React.FC<FinanceGoalModalProps> = ({
  isOpen,
  editingGoalId,
  goalTitle,
  setGoalTitle,
  goalTarget,
  setGoalTarget,
  goalCurrent,
  setGoalCurrent,
  goalDate,
  setGoalDate,
  onClose,
  onSubmit,
}) => {
  if (!isOpen) return null;

  return (
    <div
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          hapticSelection();
          onClose();
        }
      }}
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/60 backdrop-blur-xs animate-backdrop-in keyboard-modal-backdrop"
    >
      <div className="w-full sm:max-w-md bg-white dark:bg-zinc-900 border-t sm:border border-zinc-200 dark:border-zinc-800 rounded-t-3xl sm:rounded-3xl shadow-2xl p-5 sm:p-8 pb-[max(1.25rem,env(safe-area-inset-bottom,0px))] sm:pb-8 keyboard-modal-sheet overflow-y-auto animate-bottom-sheet">
        <div className="sm:hidden w-10 h-1 rounded-full bg-zinc-300 dark:bg-zinc-700 mx-auto mb-3 shrink-0" />
        <div className="flex items-center justify-between pb-4 border-b border-zinc-100 dark:border-zinc-800">
          <h3 className="text-lg font-bold text-zinc-900 dark:text-zinc-100">
            {editingGoalId ? 'Editar Meta Financeira' : 'Nova Meta Financeira'}
          </h3>
          <button
            type="button"
            onClick={() => {
              hapticSelection();
              onClose();
            }}
            className="pressable p-1.5 rounded-full text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 cursor-pointer"
            aria-label="Fechar"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={onSubmit} className="mt-4 space-y-4">
          <div>
            <label className="block text-xs font-semibold text-zinc-700 dark:text-zinc-300 mb-1">
              Título da Meta *
            </label>
            <input
              type="text"
              required
              placeholder="Nome da meta"
              value={goalTitle}
              onChange={(e) => setGoalTitle(e.target.value)}
              className="w-full px-3.5 py-2 text-sm rounded-xl bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 text-zinc-900 dark:text-zinc-100 focus:outline-none"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-zinc-700 dark:text-zinc-300 mb-1">
                Valor Alvo (R$) *
              </label>
              <input
                type="number"
                required
                min="0.01"
                step="0.01"
                placeholder="Valor alvo"
                value={goalTarget}
                onChange={(e) => setGoalTarget(e.target.value)}
                className="w-full px-3.5 py-2 text-sm rounded-xl bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 text-zinc-900 dark:text-zinc-100 focus:outline-none"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-zinc-700 dark:text-zinc-300 mb-1">
                Já Guardado (R$)
              </label>
              <input
                type="number"
                min="0"
                step="0.01"
                placeholder="Valor inicial"
                value={goalCurrent}
                onChange={(e) => setGoalCurrent(e.target.value)}
                className="w-full px-3.5 py-2 text-sm rounded-xl bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 text-zinc-900 dark:text-zinc-100 focus:outline-none"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-zinc-700 dark:text-zinc-300 mb-1">
              Data Alvo (opcional)
            </label>
            <input
              type="date"
              value={goalDate}
              onChange={(e) => setGoalDate(e.target.value)}
              className="w-full px-3.5 py-2 text-sm rounded-xl bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 text-zinc-900 dark:text-zinc-100 focus:outline-none"
            />
          </div>

          <div className="pt-3 flex justify-end gap-3 border-t border-zinc-100 dark:border-zinc-800">
            <button
              type="button"
              onClick={() => {
                hapticSelection();
                onClose();
              }}
              className="pressable min-h-[40px] px-4 py-2 rounded-xl text-sm font-medium text-zinc-600 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 cursor-pointer"
            >
              Cancelar
            </button>
            <button
              type="submit"
              className="pressable min-h-[40px] px-5 py-2 rounded-xl text-sm font-semibold text-white bg-indigo-600 hover:bg-indigo-700 cursor-pointer"
            >
              Salvar Meta
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

interface FinanceAddToGoalModalProps {
  addingToGoal: { id: string; title: string } | null;
  addGoalAmount: string;
  setAddGoalAmount: (v: string) => void;
  onClose: () => void;
  onSubmit: (e: React.FormEvent) => void;
}

export const FinanceAddToGoalModal: React.FC<FinanceAddToGoalModalProps> = ({
  addingToGoal,
  addGoalAmount,
  setAddGoalAmount,
  onClose,
  onSubmit,
}) => {
  if (!addingToGoal) return null;

  return (
    <div
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          hapticSelection();
          onClose();
        }
      }}
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/60 backdrop-blur-xs animate-backdrop-in keyboard-modal-backdrop"
    >
      <div className="w-full sm:max-w-sm bg-white dark:bg-zinc-900 border-t sm:border border-zinc-200 dark:border-zinc-800 rounded-t-3xl sm:rounded-3xl shadow-2xl p-5 sm:p-6 pb-[max(1.25rem,env(safe-area-inset-bottom,0px))] sm:pb-6 keyboard-modal-sheet overflow-y-auto animate-bottom-sheet">
        <div className="sm:hidden w-10 h-1 rounded-full bg-zinc-300 dark:bg-zinc-700 mx-auto mb-3 shrink-0" />
        <div className="flex items-center justify-between pb-3 border-b border-zinc-100 dark:border-zinc-800">
          <h3 className="text-base font-bold text-zinc-900 dark:text-zinc-100 truncate pr-2">
            Adicionar à meta
          </h3>
          <button
            type="button"
            onClick={() => {
              hapticSelection();
              onClose();
            }}
            className="pressable p-1.5 rounded-full text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 cursor-pointer"
            aria-label="Fechar"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={onSubmit} className="mt-4 space-y-4">
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            Meta: <strong className="text-zinc-800 dark:text-zinc-200">{addingToGoal.title}</strong>
          </p>
          <div>
            <label className="block text-xs font-semibold text-zinc-700 dark:text-zinc-300 mb-1">
              Valor a adicionar (R$) *
            </label>
            <input
              type="number"
              required
              min="0.01"
              step="0.01"
              autoFocus
              placeholder="Valor"
              value={addGoalAmount}
              onChange={(e) => setAddGoalAmount(e.target.value)}
              className="w-full px-3.5 py-2.5 text-sm rounded-xl bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 text-zinc-900 dark:text-zinc-100 focus:outline-none"
            />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => {
                hapticSelection();
                onClose();
              }}
              className="pressable min-h-[40px] px-4 py-2 rounded-xl text-xs font-medium text-zinc-600 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 cursor-pointer"
            >
              Cancelar
            </button>
            <button
              type="submit"
              className="pressable min-h-[40px] px-4 py-2 rounded-xl text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-700 cursor-pointer"
            >
              Adicionar
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
