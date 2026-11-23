import React, { useCallback, useMemo } from 'react';
import { triggerConfetti } from '../../utils/confettiEffect';
import {
  expandSpecialDatesToEvents,
  getBrazilianHolidaysInRange,
  mergeAndDeduplicateCalendarEvents,
} from '../../services/brazilianHolidaysService';
import { shareOrDownloadTextFile } from '../../services/encryptedBackupService';
import {
  deduplicateImportedIcsEvents,
  exportLocalEventsToIcs,
  parseIcsToLocalEvents,
} from '../../services/icsCalendarService';
import { hapticImpactLight, hapticSuccess, hapticWarning } from '../../services/hapticsService';
import { LocalCalendarEvent, LocalSpecialDate, TaskItem } from '../../types';
import { formatLocalDateIso } from '../../utils/dateUtils';
import { ConfirmActionInput } from './useConfirmDialog';

export interface CalendarEventPayload {
  summary: string;
  description?: string;
  location?: string;
  startDateTime: string;
  endDateTime: string;
  allDay?: boolean;
  date?: string;
}

export interface IcsImportSummary {
  addedCount: number;
  duplicateCount: number;
  skippedCount: number;
}

interface UseLocalCalendarActionsOptions {
  localEvents: LocalCalendarEvent[];
  setLocalEvents: React.Dispatch<React.SetStateAction<LocalCalendarEvent[]>>;
  specialDates: LocalSpecialDate[];
  setSpecialDates: React.Dispatch<React.SetStateAction<LocalSpecialDate[]>>;
  setTasks: React.Dispatch<React.SetStateAction<TaskItem[]>>;
  updateTask: (id: string, updates: Partial<TaskItem>) => void;
  confirmDestructiveAction: (config: ConfirmActionInput) => void;
  showUndoToast: (message: string, onUndo: () => void) => void;
  onDataChanged: () => void;
}

/**
 * Gerencia a agenda 100% local e offline (compromissos próprios, arquivos .ics,
 * feriados nacionais do Brasil e datas especiais/aniversários locais).
 */
export function useLocalCalendarActions({
  localEvents,
  setLocalEvents,
  specialDates,
  setSpecialDates,
  setTasks,
  updateTask,
  confirmDestructiveAction,
  showUndoToast,
  onDataChanged,
}: UseLocalCalendarActionsOptions) {
  const calendarEvents = useMemo(() => {
    const minDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const maxDate = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);
    const brazilHolidays = getBrazilianHolidaysInRange(minDate, maxDate);
    const expandedSpecials = expandSpecialDatesToEvents(specialDates, minDate, maxDate);
    return mergeAndDeduplicateCalendarEvents(localEvents, [
      ...expandedSpecials,
      ...brazilHolidays,
    ]);
  }, [localEvents, specialDates]);

  const addSpecialDate = useCallback(
    (item: Omit<LocalSpecialDate, 'id' | 'createdAt'>) => {
      const newItem: LocalSpecialDate = {
        ...item,
        id: 'special-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6),
        createdAt: new Date().toISOString(),
      };
      hapticSuccess();
      setSpecialDates((prev) => [newItem, ...prev]);
      onDataChanged();
    },
    [onDataChanged, setSpecialDates]
  );

  const deleteSpecialDate = useCallback(
    (id: string) => {
      const target = specialDates.find((s) => s.id === id);
      if (!target) return;
      hapticWarning();
      setSpecialDates((prev) => prev.filter((s) => s.id !== id));
      onDataChanged();
      showUndoToast(`Data "${target.title}" removida.`, () => {
        setSpecialDates((prev) => [target, ...prev]);
        onDataChanged();
      });
    },
    [onDataChanged, setSpecialDates, showUndoToast, specialDates]
  );

  const createTaskFromCalendarEvent = useCallback(
    (ev: LocalCalendarEvent) => {
      const d = new Date();
      const fallbackToday = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(
        2,
        '0'
      )}-${String(d.getDate()).padStart(2, '0')}`;
      const evDate = ev.start?.date
        ? ev.start.date.slice(0, 10)
        : ev.start?.dateTime
        ? ev.start.dateTime.slice(0, 10)
        : fallbackToday;
      const targetDate = evDate >= fallbackToday ? evDate : fallbackToday;
      const prefix =
        ev.eventCategory === 'birthday'
          ? 'Preparar comemoração: '
          : ev.eventCategory === 'holiday'
          ? 'Planejar feriado: '
          : '';

      const newTask: TaskItem = {
        id: 'task-' + Date.now() + '-' + Math.random().toString(36).substring(2, 6),
        title: `${prefix}${ev.summary || 'Compromisso'}`.trim(),
        description: ev.description || (ev.location ? `Local: ${ev.location}` : undefined),
        dueDate: targetDate,
        dueTime: ev.start?.dateTime
          ? new Date(ev.start.dateTime).toLocaleTimeString('pt-BR', {
              hour: '2-digit',
              minute: '2-digit',
              hour12: false,
            })
          : undefined,
        priority: ev.eventCategory === 'birthday' ? 'high' : 'medium',
        category: 'pessoal',
        completed: false,
        subtasks: [],
      };

      hapticSuccess();
      setTasks((prev) => [newTask, ...prev]);
      onDataChanged();
      showUndoToast(`Tarefa "${newTask.title}" criada na sua lista.`, () => {
        setTasks((prev) => prev.filter((t) => t.id !== newTask.id));
        onDataChanged();
      });
    },
    [onDataChanged, setTasks, showUndoToast]
  );

  const addLocalEvent = useCallback(
    (eventData: CalendarEventPayload): LocalCalendarEvent => {
      const startObj =
        eventData.allDay && eventData.date
          ? { date: eventData.date }
          : { dateTime: eventData.startDateTime };
      const endObj =
        eventData.allDay && eventData.date
          ? { date: eventData.date }
          : { dateTime: eventData.endDateTime };

      const created: LocalCalendarEvent = {
        id: 'ev-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6),
        summary: eventData.summary.trim() || 'Compromisso',
        description: eventData.description?.trim() || undefined,
        location: eventData.location?.trim() || undefined,
        start: startObj,
        end: endObj,
        status: 'confirmed',
        calendarSummary: 'Agenda Local',
        eventCategory: 'event',
        source: 'local',
        editable: true,
      };

      hapticSuccess();
      setLocalEvents((prev) => [created, ...prev]);
      onDataChanged();
      triggerConfetti({ particleCount: 24, spread: 55, origin: { y: 0.85 } });
      return created;
    },
    [onDataChanged, setLocalEvents]
  );

  const updateLocalEvent = useCallback(
    (eventId: string, eventData: CalendarEventPayload) => {
      const startObj =
        eventData.allDay && eventData.date
          ? { date: eventData.date }
          : { dateTime: eventData.startDateTime };
      const endObj =
        eventData.allDay && eventData.date
          ? { date: eventData.date }
          : { dateTime: eventData.endDateTime };

      hapticImpactLight();
      setLocalEvents((prev) =>
        prev.map((ev) =>
          ev.id === eventId
            ? {
                ...ev,
                summary: eventData.summary.trim() || ev.summary,
                description: eventData.description?.trim() || undefined,
                location: eventData.location?.trim() || undefined,
                start: startObj,
                end: endObj,
                editable: true,
              }
            : ev
        )
      );
      onDataChanged();
    },
    [onDataChanged, setLocalEvents]
  );

  const removeLocalEvent = useCallback(
    (eventId: string) => {
      const event = calendarEvents.find((e) => e.id === eventId);
      if (!event) return;

      if (event.source === 'local_special' && event.specialDateId) {
        const specialId = event.specialDateId;
        confirmDestructiveAction({
          title: 'Excluir Data Especial?',
          message: `Deseja remover "${event.summary}" das suas datas e aniversários salvos?`,
          confirmText: 'Excluir Data',
          isDestructive: true,
          onConfirm: () => {
            deleteSpecialDate(specialId);
          },
        });
        return;
      }

      if (event.editable === false) return;

      const removedEvent = localEvents.find((e) => e.id === eventId);
      if (!removedEvent) return;

      hapticWarning();
      setLocalEvents((prev) => prev.filter((e) => e.id !== eventId));
      onDataChanged();
      showUndoToast(`Compromisso "${removedEvent.summary}" removido.`, () => {
        setLocalEvents((prev) => [removedEvent, ...prev]);
        onDataChanged();
      });
    },
    [
      calendarEvents,
      confirmDestructiveAction,
      deleteSpecialDate,
      localEvents,
      onDataChanged,
      setLocalEvents,
      showUndoToast,
    ]
  );

  const scheduleTaskInCalendar = useCallback(
    (task: TaskItem, startHour = '10:00'): boolean => {
      const timeStr = task.dueTime || startHour;
      const startDate = new Date(`${task.dueDate}T${timeStr}:00`);
      if (Number.isNaN(startDate.getTime())) return false;
      const endDate = new Date(startDate.getTime() + 60 * 60 * 1000);

      const created = addLocalEvent({
        summary: task.title,
        description: task.description || 'Agendado a partir de tarefa no Lifeedy',
        startDateTime: startDate.toISOString(),
        endDateTime: endDate.toISOString(),
      });

      updateTask(task.id, { linkedEventId: created.id });
      return true;
    },
    [addLocalEvent, updateTask]
  );

  const importIcsCalendar = useCallback(
    (rawIcs: string): IcsImportSummary => {
      const parsed = parseIcsToLocalEvents(rawIcs);
      if (parsed.events.length === 0) {
        return { addedCount: 0, duplicateCount: 0, skippedCount: parsed.skippedCount };
      }

      const result = deduplicateImportedIcsEvents(localEvents, parsed.events);
      if (result.addedCount > 0) {
        setLocalEvents(result.merged);
        onDataChanged();
        hapticSuccess();
        triggerConfetti({ particleCount: 28, spread: 60, origin: { y: 0.8 } });
      }

      return {
        addedCount: result.addedCount,
        duplicateCount: result.duplicateCount,
        skippedCount: parsed.skippedCount,
      };
    },
    [localEvents, onDataChanged, setLocalEvents]
  );

  const exportAgendaIcs = useCallback((): number => {
    const icsContent = exportLocalEventsToIcs(localEvents);
    const today = formatLocalDateIso();
    void shareOrDownloadTextFile({
      fileName: `Lifeedy_Agenda_${today}.ics`,
      content: icsContent,
      mimeType: 'text/calendar;charset=utf-8',
      chooserTitle: 'Exportar Agenda (.ics)',
      preferShare: true,
    }).catch((err) => {
      console.warn('Falha ao compartilhar/exportar .ics:', err);
    });
    hapticSuccess();
    return localEvents.length;
  }, [localEvents]);

  return {
    localEvents,
    setLocalEvents,
    calendarEvents,
    addSpecialDate,
    deleteSpecialDate,
    createTaskFromCalendarEvent,
    addLocalEvent,
    updateLocalEvent,
    removeLocalEvent,
    scheduleTaskInCalendar,
    importIcsCalendar,
    exportAgendaIcs,
  };
}
