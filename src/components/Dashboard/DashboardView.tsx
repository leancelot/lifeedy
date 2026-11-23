import React, { useMemo, useState } from 'react';
import {
  ArrowRight,
  Cake,
  Calendar,
  CalendarClock,
  CalendarPlus,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock,
  Compass,
  Plus,
  ShieldCheck,
  Sparkles,
  Target,
  X,
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { hapticImpactLight, hapticSelection, hapticSuccess } from '../../services/hapticsService';
import { LocalCalendarEvent } from '../../types';
import { formatLocalDateIso } from '../../utils/dateUtils';
import { DraftsSection } from './DraftsSection';

interface DashboardViewProps {
  setCurrentTab: (tab: string) => void;
  showTourPrompt?: boolean;
  onOpenQuickTour?: () => void;
  onDismissTourPrompt?: () => void;
  onOpenBackupSettings?: () => void;
}

const getEventDateKey = (ev: LocalCalendarEvent): string => {
  if (ev.start?.date) return ev.start.date.slice(0, 10);
  if (ev.start?.dateTime) return formatLocalDateIso(new Date(ev.start.dateTime));
  return '';
};

export const DashboardView: React.FC<DashboardViewProps> = ({
  setCurrentTab,
  showTourPrompt = false,
  onOpenQuickTour,
  onDismissTourPrompt,
  onOpenBackupSettings,
}) => {
  const {
    tasks,
    toggleTaskCompletion,
    toggleSubtask,
    snoozeTaskToTomorrow,
    scheduleTaskInCalendar,
    addTask,
    calendarEvents,
    financialGoals,
    updateGoal,
    addTransaction,
    formatMoney,
    backupHealth,
    dismissBackupReminder,
  } = useApp();

  const [quickTaskTitle, setQuickTaskTitle] = useState('');
  const [filterMode, setFilterMode] = useState<'all' | 'pending' | 'completed'>('all');
  const [expandedTaskIds, setExpandedTaskIds] = useState<Record<string, boolean>>({});
  const [isDepositingGoal, setIsDepositingGoal] = useState(false);
  const [goalDepositAmount, setGoalDepositAmount] = useState('');

  const now = new Date();
  const todayStr = formatLocalDateIso(now);

  // Próximo compromisso, feriado ou aniversário a partir de agora
  const nextAgendaItem = useMemo(() => {
    const nowMs = Date.now();
    const upcoming = calendarEvents
      .map((ev) => {
        const dateKey = getEventDateKey(ev);
        if (!dateKey || dateKey < todayStr) return null;
        const sortMs = ev.start?.dateTime
          ? new Date(ev.start.dateTime).getTime()
          : new Date(`${dateKey}T00:00:00`).getTime();
        const endMs = ev.end?.dateTime
          ? new Date(ev.end.dateTime).getTime()
          : new Date(`${dateKey}T23:59:59`).getTime();
        if (dateKey === todayStr && ev.start?.dateTime && endMs < nowMs) return null;
        return { ev, dateKey, sortMs };
      })
      .filter((item): item is { ev: LocalCalendarEvent; dateKey: string; sortMs: number } =>
        Boolean(item)
      )
      .sort((a, b) => a.sortMs - b.sortMs);

    return upcoming[0] || null;
  }, [calendarEvents, todayStr]);

  // Meta financeira em foco: prioriza metas abertas mais próximas de concluir (ou a mais urgente)
  const focusGoal = useMemo(() => {
    if (financialGoals.length === 0) return null;
    const active = financialGoals.filter((g) => g.currentAmount < g.targetAmount && g.targetAmount > 0);
    if (active.length > 0) {
      return [...active].sort((a, b) => {
        const pctA = a.currentAmount / a.targetAmount;
        const pctB = b.currentAmount / b.targetAmount;
        return pctB - pctA;
      })[0];
    }
    return financialGoals[0];
  }, [financialGoals]);

  const goalStats = useMemo(() => {
    if (!focusGoal) return null;
    const remaining = Math.max(0, focusGoal.targetAmount - focusGoal.currentAmount);
    const pct =
      focusGoal.targetAmount > 0
        ? Math.min(100, Math.round((focusGoal.currentAmount / focusGoal.targetAmount) * 100))
        : 0;
    return { remaining, pct };
  }, [focusGoal]);

  const handleQuickGoalDeposit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!focusGoal) return;
    const parsed = parseFloat(goalDepositAmount.replace(',', '.'));
    if (isNaN(parsed) || parsed <= 0) return;

    hapticSuccess();
    updateGoal(focusGoal.id, {
      currentAmount: focusGoal.currentAmount + parsed,
    });
    addTransaction({
      type: 'despesa',
      title: `Aporte: ${focusGoal.title}`,
      amount: parsed,
      category: 'investimentos',
      date: todayStr,
      paymentMethod: 'pix',
      notes: 'Aporte rápido pelo Início',
    });
    setGoalDepositAmount('');
    setIsDepositingGoal(false);
  };

  const todayTasks = useMemo(
    () => tasks.filter((t) => t.dueDate === todayStr),
    [tasks, todayStr]
  );
  const pendingTasks = useMemo(() => todayTasks.filter((t) => !t.completed), [todayTasks]);
  const completedTasks = useMemo(() => todayTasks.filter((t) => t.completed), [todayTasks]);

  const handleQuickAdd = (e: React.FormEvent) => {
    e.preventDefault();
    if (!quickTaskTitle.trim()) return;

    hapticImpactLight();
    addTask({
      title: quickTaskTitle.trim(),
      dueDate: todayStr,
      priority: 'medium',
      category: 'pessoal',
      completed: false,
      subtasks: [],
    });
    setQuickTaskTitle('');
  };

  const displayedTasks = useMemo(() => {
    if (filterMode === 'pending') return pendingTasks;
    if (filterMode === 'completed') return completedTasks;
    return todayTasks;
  }, [filterMode, pendingTasks, completedTasks, todayTasks]);

  const toggleExpandSubtasks = (taskId: string) => {
    hapticSelection();
    setExpandedTaskIds((prev) => ({ ...prev, [taskId]: !prev[taskId] }));
  };

  const renderNextEventIcon = (category?: LocalCalendarEvent['eventCategory']) => {
    if (category === 'birthday') return <Cake className="w-4 h-4 text-violet-600 dark:text-violet-400" />;
    if (category === 'holiday' || category === 'commemorative') {
      return <Sparkles className="w-4 h-4 text-amber-600 dark:text-amber-400" />;
    }
    return <Calendar className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />;
  };

  return (
    <div className="max-w-6xl mx-auto pb-8">
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
        {/* Coluna Principal: Destaques Úteis + Tarefas de Hoje */}
        <div className="lg:col-span-7 space-y-5">
          {showTourPrompt && onOpenQuickTour && (
            <div className="bg-white dark:bg-zinc-900 border border-indigo-200/80 dark:border-indigo-900/60 rounded-2xl px-3.5 py-3 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2.5 min-w-0">
                <div className="w-9 h-9 rounded-xl bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-400 flex items-center justify-center shrink-0">
                  <Compass className="w-4 h-4" />
                </div>
                <div className="min-w-0">
                  <p className="text-xs font-bold text-zinc-900 dark:text-zinc-100 truncate">
                    Tour interativo em 4 cliques
                  </p>
                  <p className="text-[11px] text-zinc-500 dark:text-zinc-400 truncate">
                    Veja onde ficam a barra rápida, atalhos e ajustes
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <button
                  type="button"
                  onClick={() => {
                    hapticSelection();
                    onOpenQuickTour();
                  }}
                  className="pressable min-h-[40px] px-3 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold cursor-pointer whitespace-nowrap"
                >
                  Ver tour
                </button>
                {onDismissTourPrompt && (
                  <button
                    type="button"
                    onClick={() => {
                      hapticSelection();
                      onDismissTourPrompt();
                    }}
                    aria-label="Dispensar tour rápido"
                    className="pressable w-10 h-10 rounded-xl text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 flex items-center justify-center cursor-pointer"
                  >
                    <X className="w-4 h-4" />
                  </button>
                )}
              </div>
            </div>
          )}

          {!showTourPrompt && backupHealth.shouldRemind && onOpenBackupSettings && (
            <div className="bg-white dark:bg-zinc-900 border border-amber-200/80 dark:border-amber-900/60 rounded-2xl px-3.5 py-3 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2.5 min-w-0">
                <div className="w-9 h-9 rounded-xl bg-amber-50 dark:bg-amber-950/60 text-amber-600 dark:text-amber-400 flex items-center justify-center shrink-0">
                  <ShieldCheck className="w-4 h-4" />
                </div>
                <div className="min-w-0">
                  <p className="text-xs font-bold text-zinc-900 dark:text-zinc-100 truncate">
                    {backupHealth.level === 'missing'
                      ? 'Proteja seus dados com backup .lifeedy'
                      : `Último backup portátil há ${backupHealth.daysSinceLastBackup} dia(s)`}
                  </p>
                  <p className="text-[11px] text-zinc-500 dark:text-zinc-400 truncate">
                    Salve uma cópia cifrada ou ative a pasta automática no Android
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <button
                  type="button"
                  onClick={() => {
                    hapticSelection();
                    onOpenBackupSettings();
                  }}
                  className="pressable min-h-[40px] px-3 rounded-xl bg-amber-600 hover:bg-amber-700 text-white text-xs font-semibold cursor-pointer whitespace-nowrap"
                >
                  Fazer backup
                </button>
                <button
                  type="button"
                  onClick={() => {
                    hapticSelection();
                    dismissBackupReminder();
                  }}
                  aria-label="Lembrar mais tarde"
                  className="pressable w-10 h-10 rounded-xl text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 flex items-center justify-center cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>
          )}

          {/* Destaques Práticos (Próximo Evento + Meta em Foco) */}
          <section className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {/* Bloco 1: Próximo na Agenda */}
            <button
              type="button"
              onClick={() => {
                hapticSelection();
                setCurrentTab('agenda');
              }}
              className="pressable text-left bg-white dark:bg-zinc-900 border border-zinc-200/80 dark:border-zinc-800 hover:border-indigo-300 dark:hover:border-indigo-700 rounded-2xl p-3.5 transition-colors cursor-pointer flex flex-col justify-between gap-2.5"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-[11px] font-bold uppercase tracking-wider text-zinc-400">
                  Próximo na Agenda
                </span>
                <ArrowRight className="w-3.5 h-3.5 text-zinc-400 shrink-0" />
              </div>

              {nextAgendaItem ? (
                <div className="flex items-start gap-2.5 min-w-0">
                  <div className="w-8 h-8 rounded-xl bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center shrink-0">
                    {renderNextEventIcon(nextAgendaItem.ev.eventCategory)}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-xs sm:text-sm font-bold text-zinc-900 dark:text-zinc-100 truncate">
                      {nextAgendaItem.ev.summary || 'Compromisso'}
                    </p>
                    <p className="text-[11px] font-mono tabular-nums text-indigo-600 dark:text-indigo-400 mt-0.5 truncate">
                      {nextAgendaItem.dateKey === todayStr
                        ? 'Hoje'
                        : new Date(`${nextAgendaItem.dateKey}T12:00:00`).toLocaleDateString(
                            'pt-BR',
                            { day: '2-digit', month: 'short' }
                          )}{' '}
                      ·{' '}
                      {nextAgendaItem.ev.start?.dateTime
                        ? new Date(nextAgendaItem.ev.start.dateTime).toLocaleTimeString('pt-BR', {
                            hour: '2-digit',
                            minute: '2-digit',
                          })
                        : 'Dia todo'}
                    </p>
                  </div>
                </div>
              ) : (
                <div className="flex items-center gap-2.5 text-zinc-500 dark:text-zinc-400">
                  <div className="w-8 h-8 rounded-xl bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center shrink-0">
                    <Calendar className="w-4 h-4 text-zinc-400" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-xs font-semibold text-zinc-700 dark:text-zinc-200">
                      Nenhum evento próximo
                    </p>
                    <p className="text-[11px] text-zinc-400">Abrir Agenda completa</p>
                  </div>
                </div>
              )}
            </button>

            {/* Bloco 2: Meta Financeira ("Falta quanto para bater") */}
            <div className="bg-white dark:bg-zinc-900 border border-zinc-200/80 dark:border-zinc-800 rounded-2xl p-3.5 flex flex-col justify-between gap-2.5">
              <div className="flex items-center justify-between gap-2">
                <button
                  type="button"
                  onClick={() => {
                    hapticSelection();
                    setCurrentTab('financas');
                  }}
                  className="text-[11px] font-bold uppercase tracking-wider text-zinc-400 hover:text-indigo-600 dark:hover:text-indigo-400 inline-flex items-center gap-1 cursor-pointer"
                >
                  <span>Meta em Foco</span>
                  <ArrowRight className="w-3 h-3" />
                </button>

                {focusGoal && goalStats && goalStats.remaining > 0 && (
                  <button
                    type="button"
                    onClick={() => {
                      hapticSelection();
                      setIsDepositingGoal((prev) => !prev);
                    }}
                    className="pressable h-6 px-2 rounded-lg bg-emerald-50 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-300 text-[11px] font-semibold inline-flex items-center gap-1 cursor-pointer"
                  >
                    <Plus className="w-3 h-3" />
                    <span>Aportar</span>
                  </button>
                )}
              </div>

              {focusGoal && goalStats ? (
                <div className="space-y-2">
                  <div className="flex items-baseline justify-between gap-2">
                    <p className="text-xs sm:text-sm font-bold text-zinc-900 dark:text-zinc-100 truncate">
                      {focusGoal.title}
                    </p>
                    <span className="text-[11px] font-mono tabular-nums font-bold text-emerald-600 dark:text-emerald-400 shrink-0">
                      {goalStats.pct}%
                    </span>
                  </div>

                  <div className="w-full h-1.5 rounded-full bg-zinc-100 dark:bg-zinc-800 overflow-hidden">
                    <div
                      className="h-full rounded-full bg-emerald-500 transition-all duration-300"
                      style={{ width: `${goalStats.pct}%` }}
                    />
                  </div>

                  {isDepositingGoal ? (
                    <form onSubmit={handleQuickGoalDeposit} className="flex items-center gap-1.5 pt-0.5">
                      <input
                        type="number"
                        step="0.01"
                        min="0.01"
                        required
                        autoFocus
                        value={goalDepositAmount}
                        onChange={(e) => setGoalDepositAmount(e.target.value)}
                        placeholder="Valor R$"
                        className="flex-1 h-8 px-2.5 text-xs rounded-lg bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 font-mono tabular-nums focus:outline-none"
                      />
                      <button
                        type="submit"
                        className="pressable h-8 px-2.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-[11px] font-semibold cursor-pointer"
                      >
                        Salvar
                      </button>
                    </form>
                  ) : (
                    <p className="text-[11px] text-zinc-500 dark:text-zinc-400 font-mono tabular-nums">
                      {goalStats.remaining === 0
                        ? 'Meta batida!'
                        : `Falta ${formatMoney(goalStats.remaining)} para bater`}
                    </p>
                  )}
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    hapticSelection();
                    setCurrentTab('financas');
                  }}
                  className="flex items-center gap-2.5 text-left cursor-pointer group"
                >
                  <div className="w-8 h-8 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400 flex items-center justify-center shrink-0">
                    <Target className="w-4 h-4" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-xs font-semibold text-zinc-700 dark:text-zinc-200 group-hover:underline">
                      Sem meta cadastrada
                    </p>
                    <p className="text-[11px] text-zinc-400">Criar meta em Finanças</p>
                  </div>
                </button>
              )}
            </div>
          </section>

          {/* Tarefas de Hoje */}
          <section className="space-y-2.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-sm font-bold tracking-tight text-zinc-900 dark:text-zinc-100">
                Tarefas de Hoje
              </h2>

              <div className="inline-flex items-center gap-0.5 bg-zinc-100 dark:bg-zinc-800/70 p-0.5 rounded-xl text-[11px] font-medium">
                {(
                  [
                    { id: 'all', label: `Todas (${todayTasks.length})` },
                    { id: 'pending', label: `Pendentes (${pendingTasks.length})` },
                    { id: 'completed', label: 'Feitas' },
                  ] as const
                ).map((tab) => (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => {
                      hapticSelection();
                      setFilterMode(tab.id);
                    }}
                    className={`pressable h-7 px-2.5 rounded-lg cursor-pointer whitespace-nowrap shrink-0 flex items-center justify-center ${
                      filterMode === tab.id
                        ? 'bg-white dark:bg-zinc-700 text-zinc-900 dark:text-zinc-100 shadow-2xs font-semibold'
                        : 'text-zinc-500 dark:text-zinc-400'
                    }`}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>
            </div>

            <form onSubmit={handleQuickAdd} className="relative">
              <input
                type="text"
                value={quickTaskTitle}
                onChange={(e) => setQuickTaskTitle(e.target.value)}
                placeholder="Adicionar tarefa para hoje..."
                className="w-full h-11 pl-3.5 pr-11 text-xs sm:text-sm rounded-xl bg-white dark:bg-zinc-900 border border-zinc-200/80 dark:border-zinc-800 text-zinc-900 dark:text-zinc-100 placeholder-zinc-400 dark:placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/50 transition-all"
              />
              <button
                type="submit"
                disabled={!quickTaskTitle.trim()}
                className="pressable absolute right-1.5 top-1/2 -translate-y-1/2 w-8 h-8 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white flex items-center justify-center disabled:opacity-30 cursor-pointer"
                title="Adicionar tarefa"
                aria-label="Adicionar tarefa"
              >
                <Plus className="w-4 h-4" />
              </button>
            </form>

            {displayedTasks.length === 0 ? (
              <div className="py-6 text-center bg-white dark:bg-zinc-900/50 border border-dashed border-zinc-200 dark:border-zinc-800 rounded-2xl p-4 space-y-1">
                <CheckCircle2 className="w-6 h-6 mx-auto text-emerald-500/70" />
                <p className="text-xs font-semibold text-zinc-700 dark:text-zinc-300">
                  {filterMode === 'completed'
                    ? 'Nenhuma tarefa concluída hoje.'
                    : 'Sem tarefas pendentes para hoje.'}
                </p>
              </div>
            ) : (
              <div className="divide-y divide-zinc-100 dark:divide-zinc-800/80 bg-white dark:bg-zinc-900 border border-zinc-200/80 dark:border-zinc-800 rounded-2xl overflow-hidden">
                {displayedTasks.map((task) => {
                  const hasSubtasks = task.subtasks && task.subtasks.length > 0;
                  const isExpanded = Boolean(expandedTaskIds[task.id]);
                  const doneSubtasks = task.subtasks.filter((s) => s.completed).length;

                  return (
                    <div
                      key={task.id}
                      className={`px-3 py-2.5 transition-colors ${
                        task.completed ? 'bg-zinc-50/60 dark:bg-zinc-900/40 opacity-70' : ''
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <button
                          type="button"
                          onClick={() => toggleTaskCompletion(task.id)}
                          aria-label={task.completed ? 'Desmarcar tarefa' : 'Concluir tarefa'}
                          className="flex items-center gap-2.5 min-w-0 flex-1 text-left cursor-pointer min-h-[40px]"
                        >
                          <span
                            className={`w-5 h-5 rounded-md flex items-center justify-center transition-colors shrink-0 ${
                              task.completed
                                ? 'bg-emerald-600 text-white animate-check-pop'
                                : 'border-2 border-zinc-300 dark:border-zinc-600 hover:border-indigo-500'
                            }`}
                          >
                            {task.completed && <Check className="w-3 h-3 stroke-[3]" />}
                          </span>
                          <div className="min-w-0">
                            <span
                              className={`text-xs sm:text-sm font-medium block truncate transition-colors ${
                                task.completed
                                  ? 'line-through text-zinc-400 dark:text-zinc-500'
                                  : 'text-zinc-800 dark:text-zinc-100'
                              }`}
                            >
                              {task.title}
                            </span>
                            {(task.category || hasSubtasks || task.dueTime) && (
                              <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-zinc-400">
                                {task.dueTime && (
                                  <span className="font-mono tabular-nums inline-flex items-center gap-0.5 text-indigo-600 dark:text-indigo-400">
                                    <Clock className="w-2.5 h-2.5" />
                                    {task.dueTime}
                                  </span>
                                )}
                                {task.dueTime && task.category && <span aria-hidden="true">·</span>}
                                {task.category && <span>{task.category}</span>}
                                {hasSubtasks && (
                                  <>
                                    <span aria-hidden="true">·</span>
                                    <span className="font-mono tabular-nums">
                                      {doneSubtasks}/{task.subtasks.length} etapas
                                    </span>
                                  </>
                                )}
                              </div>
                            )}
                          </div>
                        </button>

                        <div className="flex items-center gap-1 shrink-0">
                          {hasSubtasks && (
                            <button
                              type="button"
                              onClick={() => toggleExpandSubtasks(task.id)}
                              aria-label={isExpanded ? 'Ocultar etapas' : 'Ver etapas'}
                              className="pressable w-9 h-9 rounded-lg text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800 flex items-center justify-center cursor-pointer"
                            >
                              {isExpanded ? (
                                <ChevronUp className="w-4 h-4" />
                              ) : (
                                <ChevronDown className="w-4 h-4" />
                              )}
                            </button>
                          )}
                          {!task.completed && !task.linkedEventId && (
                            <button
                              type="button"
                              onClick={() => scheduleTaskInCalendar(task)}
                              title="Agendar compromisso"
                              aria-label={`Agendar ${task.title}`}
                              className="pressable w-9 h-9 rounded-lg text-indigo-600 dark:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-950/60 flex items-center justify-center cursor-pointer"
                            >
                              <CalendarPlus className="w-4 h-4" />
                            </button>
                          )}
                          {!task.completed && (
                            <button
                              type="button"
                              onClick={() => snoozeTaskToTomorrow(task.id)}
                              title="Adiar para amanhã"
                              aria-label={`Adiar ${task.title} para amanhã`}
                              className="pressable h-9 px-2 rounded-lg text-zinc-500 dark:text-zinc-400 hover:text-indigo-700 dark:hover:text-indigo-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 text-[11px] font-semibold inline-flex items-center gap-1 cursor-pointer whitespace-nowrap shrink-0"
                            >
                              <CalendarClock className="w-3.5 h-3.5 shrink-0" />
                              <span className="hidden sm:inline">Amanhã</span>
                            </button>
                          )}
                        </div>
                      </div>

                      {hasSubtasks && isExpanded && (
                        <div className="mt-1.5 pt-1.5 border-t border-zinc-100 dark:border-zinc-800 space-y-0.5 pl-7">
                          {task.subtasks.map((st) => (
                            <button
                              key={st.id}
                              type="button"
                              onClick={() => toggleSubtask(task.id, st.id)}
                              className="w-full min-h-[34px] py-1 flex items-center gap-2 text-left text-xs text-zinc-600 dark:text-zinc-300 cursor-pointer"
                            >
                              <span
                                className={`w-4 h-4 rounded-sm flex items-center justify-center border shrink-0 ${
                                  st.completed
                                    ? 'bg-emerald-600 border-emerald-600 text-white'
                                    : 'border-zinc-300 dark:border-zinc-600'
                                }`}
                              >
                                {st.completed && <Check className="w-2.5 h-2.5 stroke-[3]" />}
                              </span>
                              <span className={st.completed ? 'line-through text-zinc-400' : ''}>
                                {st.title}
                              </span>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        </div>

        {/* Coluna Direita: Rascunhos Multimídia Estilo Keep */}
        <div className="lg:col-span-5">
          <DraftsSection />
        </div>
      </div>
    </div>
  );
};
