import React, { useState } from 'react';
import {
  CalendarPlus,
  CheckSquare,
  CircleDollarSign,
  Plus,
} from 'lucide-react';
import { useBackHandler } from '../../context/BackNavigationContext';
import { hapticImpactLight, hapticSelection } from '../../services/hapticsService';

interface QuickActionFabProps {
  isOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  onTriggerAgendaModal: (mode: 'task' | 'event') => void;
  onTriggerFinanceModal: (mode: 'new-transaction') => void;
}

export const QuickActionFab: React.FC<QuickActionFabProps> = ({
  isOpen: controlledIsOpen,
  onOpenChange,
  onTriggerAgendaModal,
  onTriggerFinanceModal,
}) => {
  const [internalIsOpen, setInternalIsOpen] = useState(false);
  const isOpen = controlledIsOpen !== undefined ? controlledIsOpen : internalIsOpen;
  const setOpen = (next: boolean) => {
    if (onOpenChange) {
      onOpenChange(next);
    } else {
      setInternalIsOpen(next);
    }
  };

  useBackHandler(isOpen, () => {
    setOpen(false);
    return true;
  });

  return (
    <>
      {isOpen && (
        <div
          className="fixed inset-0 z-30 bg-black/45 backdrop-blur-xs animate-backdrop-in"
          onClick={() => setOpen(false)}
        />
      )}

      {/* Exatamente 3 atalhos diretos que abrem seu modal imediatamente */}
      {isOpen && (
        <div className="fixed bottom-24 left-1/2 -translate-x-1/2 md:left-auto md:translate-x-0 md:bottom-26 md:right-8 z-40 w-[min(calc(100vw-2rem),290px)] md:w-auto flex flex-col items-stretch md:items-end gap-2">
          <button
            type="button"
            onClick={() => {
              hapticSelection();
              onTriggerAgendaModal('event');
              setOpen(false);
            }}
            style={{ animationDelay: '40ms' }}
            className="animate-sheet-up pressable flex items-center justify-between md:justify-end gap-3 px-4 py-2.5 min-h-[48px] rounded-2xl bg-white dark:bg-zinc-900 text-zinc-800 dark:text-zinc-100 shadow-lg border border-zinc-200 dark:border-zinc-800 hover:bg-zinc-50 dark:hover:bg-zinc-800 cursor-pointer text-xs font-semibold group"
          >
            <span>Novo Evento</span>
            <div className="w-8 h-8 rounded-xl bg-violet-100 dark:bg-violet-950/60 text-violet-600 dark:text-violet-400 flex items-center justify-center group-hover:scale-105 transition-transform shrink-0">
              <CalendarPlus className="w-4 h-4" />
            </div>
          </button>

          <button
            type="button"
            onClick={() => {
              hapticSelection();
              onTriggerFinanceModal('new-transaction');
              setOpen(false);
            }}
            style={{ animationDelay: '20ms' }}
            className="animate-sheet-up pressable flex items-center justify-between md:justify-end gap-3 px-4 py-2.5 min-h-[48px] rounded-2xl bg-white dark:bg-zinc-900 text-zinc-800 dark:text-zinc-100 shadow-lg border border-zinc-200 dark:border-zinc-800 hover:bg-zinc-50 dark:hover:bg-zinc-800 cursor-pointer text-xs font-semibold group"
          >
            <span>Nova Transação</span>
            <div className="w-8 h-8 rounded-xl bg-emerald-100 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400 flex items-center justify-center group-hover:scale-105 transition-transform shrink-0">
              <CircleDollarSign className="w-4 h-4" />
            </div>
          </button>

          <button
            type="button"
            onClick={() => {
              hapticSelection();
              onTriggerAgendaModal('task');
              setOpen(false);
            }}
            style={{ animationDelay: '0ms' }}
            className="animate-sheet-up pressable flex items-center justify-between md:justify-end gap-3 px-4 py-2.5 min-h-[48px] rounded-2xl bg-white dark:bg-zinc-900 text-zinc-800 dark:text-zinc-100 shadow-lg border border-zinc-200 dark:border-zinc-800 hover:bg-zinc-50 dark:hover:bg-zinc-800 cursor-pointer text-xs font-semibold group"
          >
            <span>Nova Tarefa</span>
            <div className="w-8 h-8 rounded-xl bg-indigo-100 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-400 flex items-center justify-center group-hover:scale-105 transition-transform shrink-0">
              <CheckSquare className="w-4 h-4" />
            </div>
          </button>
        </div>
      )}

      {/* Botão flutuante apenas no desktop */}
      <div className="hidden md:flex fixed bottom-8 right-8 z-40">
        <button
          type="button"
          onClick={() => {
            hapticImpactLight();
            setOpen(!isOpen);
          }}
          title="Ação Rápida (+)"
          aria-label="Ação Rápida"
          className={`pressable w-14 h-14 rounded-2xl flex items-center justify-center shadow-xl transition-transform duration-150 cursor-pointer ${
            isOpen
              ? 'bg-zinc-800 dark:bg-zinc-100 text-white dark:text-zinc-950 rotate-45 scale-95'
              : 'bg-gradient-to-br from-[#DC7B62] to-[#BE6272] dark:from-[#F2A68E] dark:to-[#E69BA7] text-white dark:text-[#24120E] shadow-indigo-600/25 hover:scale-105'
          }`}
        >
          <Plus className="w-7 h-7 stroke-[2.5]" />
        </button>
      </div>
    </>
  );
};
