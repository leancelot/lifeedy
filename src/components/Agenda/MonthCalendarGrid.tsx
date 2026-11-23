import React, { useMemo } from 'react';
import { Cake, Sparkles } from 'lucide-react';
import { LocalCalendarEvent, TaskItem } from '../../types';
import { buildMonthGrid, summarizeMonthDayItems } from '../../utils/agendaMonthUtils';
import { hapticSelection } from '../../services/hapticsService';

interface MonthCalendarGridProps {
  selectedDateStr: string;
  todayStr: string;
  tasks: TaskItem[];
  events: LocalCalendarEvent[];
  onSelectDate: (dateStr: string) => void;
}

const WEEKDAY_HEADERS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

export const MonthCalendarGrid: React.FC<MonthCalendarGridProps> = ({
  selectedDateStr,
  todayStr,
  tasks,
  events,
  onSelectDate,
}) => {
  const anchorDate = new Date(`${selectedDateStr}T12:00:00`);
  const year = anchorDate.getFullYear();
  const monthIndex = anchorDate.getMonth();

  const cells = useMemo(() => buildMonthGrid(year, monthIndex), [year, monthIndex]);
  const summaries = useMemo(
    () => summarizeMonthDayItems(cells, tasks, events),
    [cells, tasks, events]
  );

  return (
    <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-3xl p-3 sm:p-5 space-y-3">
      {/* Cabeçalho dos dias da semana */}
      <div className="grid grid-cols-7 gap-1 text-center">
        {WEEKDAY_HEADERS.map((wd) => (
          <div
            key={wd}
            className="py-1 text-[11px] font-semibold text-zinc-400 dark:text-zinc-500 uppercase tracking-wider"
          >
            {wd}
          </div>
        ))}
      </div>

      {/* Grade do Mês */}
      <div className="grid grid-cols-7 gap-1 sm:gap-1.5">
        {cells.map((cell) => {
          const info = summaries[cell.dateStr];
          const isSelected = cell.dateStr === selectedDateStr;
          const isToday = cell.dateStr === todayStr;
          const hasAny = info && info.total > 0;

          return (
            <button
              key={cell.dateStr}
              type="button"
              onClick={() => {
                hapticSelection();
                onSelectDate(cell.dateStr);
              }}
              aria-label={`Selecionar ${cell.dateStr}`}
              aria-pressed={isSelected}
              className={`pressable min-h-[52px] sm:min-h-[64px] p-1 sm:p-1.5 rounded-2xl border flex flex-col items-center justify-between transition-colors cursor-pointer ${
                isSelected
                  ? 'bg-indigo-600 border-indigo-600 text-white'
                  : isToday
                  ? 'bg-indigo-50/80 dark:bg-indigo-950/40 border-indigo-300 dark:border-indigo-800 text-indigo-700 dark:text-indigo-300'
                  : cell.inCurrentMonth
                  ? 'bg-zinc-50/60 dark:bg-zinc-800/40 border-zinc-200/70 dark:border-zinc-800 text-zinc-900 dark:text-zinc-100 hover:bg-zinc-100 dark:hover:bg-zinc-800'
                  : 'bg-transparent border-transparent text-zinc-400 dark:text-zinc-600 hover:bg-zinc-50 dark:hover:bg-zinc-800/30'
              }`}
            >
              <span
                className={`text-xs sm:text-sm font-mono tabular-nums font-bold leading-none mt-0.5 ${
                  isSelected ? 'text-white' : ''
                }`}
              >
                {cell.dayNumber}
              </span>

              {/* Indicadores compactos de conteúdo do dia */}
              <div className="flex items-center justify-center gap-0.5 min-h-[14px]">
                {hasAny ? (
                  <>
                    {info.birthdays > 0 && (
                      <Cake
                        className={`w-2.5 h-2.5 ${
                          isSelected ? 'text-white' : 'text-violet-600 dark:text-violet-400'
                        }`}
                      />
                    )}
                    {info.holidays > 0 && (
                      <Sparkles
                        className={`w-2.5 h-2.5 ${
                          isSelected ? 'text-white' : 'text-amber-500'
                        }`}
                      />
                    )}
                    {info.regularEvents > 0 && (
                      <span
                        className={`w-1.5 h-1.5 rounded-full ${
                          isSelected ? 'bg-white' : 'bg-indigo-500'
                        }`}
                      />
                    )}
                    {info.pendingTasks > 0 && (
                      <span
                        className={`w-1.5 h-1.5 rounded-full ${
                          isSelected ? 'bg-amber-200' : 'bg-emerald-500'
                        }`}
                      />
                    )}
                    {info.pendingTasks === 0 &&
                      info.completedTasks > 0 &&
                      info.regularEvents === 0 &&
                      info.birthdays === 0 &&
                      info.holidays === 0 && (
                        <span
                          className={`w-1.5 h-1.5 rounded-full opacity-50 ${
                            isSelected ? 'bg-white' : 'bg-zinc-400'
                          }`}
                        />
                      )}
                  </>
                ) : null}
              </div>
            </button>
          );
        })}
      </div>

      {/* Legenda limpa sem caixas */}
      <div className="pt-2 border-t border-zinc-100 dark:border-zinc-800 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[11px] text-zinc-500 dark:text-zinc-400">
        <span className="inline-flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full bg-indigo-500" />
          Compromissos
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full bg-emerald-500" />
          Tarefas pendentes
        </span>
        <span className="inline-flex items-center gap-1.5">
          <Cake className="w-3 h-3 text-violet-600 dark:text-violet-400" />
          Aniversários
        </span>
        <span className="inline-flex items-center gap-1.5">
          <Sparkles className="w-3 h-3 text-amber-500" />
          Feriados
        </span>
      </div>
    </div>
  );
};
