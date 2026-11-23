import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowRight,
  Calendar,
  CheckSquare,
  CircleDollarSign,
  FileText,
  Search,
  X,
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { useBackHandler } from '../../context/BackNavigationContext';
import { hapticSelection } from '../../services/hapticsService';

interface GlobalSearchModalProps {
  isOpen: boolean;
  onClose: () => void;
  onNavigateTab: (tab: 'dashboard' | 'agenda' | 'financas') => void;
}

interface SearchHit {
  id: string;
  group: 'financas' | 'tarefa' | 'agenda' | 'rascunho';
  title: string;
  subtitle: string;
  targetTab: 'dashboard' | 'agenda' | 'financas';
  badge?: string;
}

export const GlobalSearchModal: React.FC<GlobalSearchModalProps> = ({
  isOpen,
  onClose,
  onNavigateTab,
}) => {
  const {
    transactions,
    tasks,
    calendarEvents,
    draftNotes,
    formatMoney,
    financeLockEnabled,
  } = useApp();
  const [query, setQuery] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useBackHandler(isOpen, () => {
    onClose();
    return true;
  });

  useEffect(() => {
    if (!isOpen) {
      setQuery('');
      return;
    }
    const id = window.setTimeout(() => inputRef.current?.focus(), 60);
    return () => window.clearTimeout(id);
  }, [isOpen]);

  const results = useMemo<SearchHit[]>(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];

    const hits: SearchHit[] = [];

    for (const tx of transactions) {
      const hay = `${tx.title} ${tx.category} ${tx.notes || ''} ${tx.date}`.toLowerCase();
      if (hay.includes(q)) {
        hits.push({
          id: `tx-${tx.id}`,
          group: 'financas',
          title: tx.title,
          subtitle: `${tx.date} · ${tx.category}`,
          targetTab: 'financas',
          badge: financeLockEnabled
            ? 'Protegido'
            : `${tx.type === 'receita' ? '+' : '-'} ${formatMoney(tx.amount)}`,
        });
      }
      if (hits.length >= 24) break;
    }

    for (const task of tasks) {
      const hay = `${task.title} ${task.description || ''} ${task.category} ${task.dueDate}`.toLowerCase();
      if (hay.includes(q)) {
        hits.push({
          id: `task-${task.id}`,
          group: 'tarefa',
          title: task.title,
          subtitle: `${task.dueDate}${task.dueTime ? ` às ${task.dueTime}` : ''} · ${
            task.completed ? 'Concluída' : 'Pendente'
          }`,
          targetTab: 'agenda',
        });
      }
      if (hits.length >= 32) break;
    }

    for (const ev of calendarEvents) {
      const hay = `${ev.summary || ''} ${ev.description || ''} ${ev.location || ''}`.toLowerCase();
      if (hay.includes(q)) {
        const rawDate = ev.start?.date || ev.start?.dateTime?.slice(0, 10) || '';
        hits.push({
          id: `ev-${ev.id}`,
          group: 'agenda',
          title: ev.summary || 'Compromisso',
          subtitle: [rawDate, ev.location].filter(Boolean).join(' · ') || 'Agenda',
          targetTab: 'agenda',
        });
      }
      if (hits.length >= 40) break;
    }

    for (const draft of draftNotes) {
      const checklistText = (draft.checklistItems || []).map((c) => c.text).join(' ');
      const hay = `${draft.title} ${draft.content} ${checklistText}`.toLowerCase();
      if (hay.includes(q)) {
        hits.push({
          id: `draft-${draft.id}`,
          group: 'rascunho',
          title: draft.title || 'Rascunho sem título',
          subtitle: (draft.content || checklistText || 'Rascunho rápido').slice(0, 72),
          targetTab: 'dashboard',
        });
      }
      if (hits.length >= 48) break;
    }

    return hits;
  }, [calendarEvents, draftNotes, financeLockEnabled, formatMoney, query, tasks, transactions]);

  if (!isOpen) return null;

  const renderGroupIcon = (group: SearchHit['group']) => {
    if (group === 'financas') {
      return <CircleDollarSign className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />;
    }
    if (group === 'tarefa') {
      return <CheckSquare className="w-4 h-4 text-indigo-600 dark:text-indigo-400 shrink-0" />;
    }
    if (group === 'agenda') {
      return <Calendar className="w-4 h-4 text-violet-600 dark:text-violet-400 shrink-0" />;
    }
    return <FileText className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0" />;
  };

  return (
    <div
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          hapticSelection();
          onClose();
        }
      }}
      className="fixed inset-0 z-50 flex items-end sm:items-start sm:pt-16 justify-center p-0 sm:p-4 bg-black/60 backdrop-blur-xs animate-backdrop-in keyboard-modal-backdrop"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Busca global no Lifeedy"
        className="w-full sm:max-w-xl bg-white dark:bg-zinc-900 border-t sm:border border-zinc-200 dark:border-zinc-800 rounded-t-3xl sm:rounded-3xl shadow-2xl p-4 sm:p-5 pb-[max(1.25rem,env(safe-area-inset-bottom,0px))] sm:pb-5 keyboard-modal-sheet max-h-[82vh] flex flex-col animate-bottom-sheet"
      >
        <div className="sm:hidden w-10 h-1 rounded-full bg-zinc-300 dark:bg-zinc-700 mx-auto mb-3 shrink-0" />

        <div className="flex items-center gap-2 bg-zinc-100 dark:bg-zinc-800/90 border border-zinc-200/80 dark:border-zinc-700 rounded-2xl px-3.5 h-12 shrink-0">
          <Search className="w-4 h-4 text-zinc-400 shrink-0" />
          <input
            ref={inputRef}
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar transações, tarefas, eventos ou rascunhos..."
            className="flex-1 bg-transparent text-sm text-zinc-900 dark:text-zinc-100 placeholder-zinc-400 focus:outline-none min-w-0"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery('')}
              aria-label="Limpar busca"
              className="p-1 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar busca"
            className="p-1.5 text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-100 cursor-pointer shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="mt-3 flex-1 overflow-y-auto space-y-1.5 min-h-[140px]">
          {!query.trim() ? (
            <div className="py-10 text-center text-xs text-zinc-500 dark:text-zinc-400 space-y-1">
              <p className="font-medium text-zinc-700 dark:text-zinc-300">
                Busca unificada em todo o aparelho
              </p>
              <p>Digite qualquer palavra-chave para filtrar finanças, agenda, tarefas e rascunhos.</p>
            </div>
          ) : results.length === 0 ? (
            <div className="py-10 text-center text-xs text-zinc-500 dark:text-zinc-400">
              Nenhum resultado encontrado para “{query.trim()}”.
            </div>
          ) : (
            results.map((hit) => (
              <button
                key={hit.id}
                type="button"
                onClick={() => {
                  hapticSelection();
                  onNavigateTab(hit.targetTab);
                  onClose();
                }}
                className="pressable w-full text-left px-3 py-2.5 rounded-2xl border border-zinc-200/70 dark:border-zinc-800 hover:bg-zinc-50 dark:hover:bg-zinc-800/70 flex items-center justify-between gap-3 cursor-pointer"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-9 h-9 rounded-xl bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center shrink-0">
                    {renderGroupIcon(hit.group)}
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 truncate">
                      {hit.title}
                    </p>
                    <p className="text-xs text-zinc-500 dark:text-zinc-400 truncate">
                      {hit.subtitle}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {hit.badge && (
                    <span className="text-xs font-semibold font-mono tabular-nums text-zinc-700 dark:text-zinc-300">
                      {hit.badge}
                    </span>
                  )}
                  <ArrowRight className="w-4 h-4 text-zinc-400" />
                </div>
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
};
