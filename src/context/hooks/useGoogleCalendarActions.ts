import React, { useCallback, useEffect, useMemo, useState } from 'react';
import confetti from 'canvas-confetti';
import {
  expandSpecialDatesToEvents,
  getBrazilianHolidaysInRange,
  mergeAndDeduplicateCalendarEvents,
} from '../../services/brazilianHolidaysService';
import {
  createCalendarEvent,
  deleteCalendarEvent as apiDeleteCalendarEvent,
  listCalendarEvents,
  updateCalendarEvent as apiUpdateCalendarEvent,
} from '../../services/calendarService';
import { getAccessToken } from '../../services/firebase';
import { hapticSuccess, hapticWarning } from '../../services/hapticsService';
import { GoogleCalendarEvent, LocalSpecialDate, TaskItem } from '../../types';
import { ConfirmActionInput } from './useConfirmDialog';

export interface CalendarEventPayload {
  summary: string;
  description?: string;
  location?: string;
  startDateTime: string;
  endDateTime: string;
  allDay?: boolean;
  date?: string;
  calendarId?: string;
}

interface UseGoogleCalendarActionsOptions {
  accessToken: string | null;
  specialDates: LocalSpecialDate[];
  setSpecialDates: React.Dispatch<React.SetStateAction<LocalSpecialDate[]>>;
  setTasks: React.Dispatch<React.SetStateAction<TaskItem[]>>;
  updateTask: (id: string, updates: Partial<TaskItem>) => void;
  ensureSignedInToken: () => Promise<string | null>;
  handleWorkspaceAuthError: (err: unknown) => boolean;
  confirmDestructiveAction: (config: ConfirmActionInput) => void;
  showUndoToast: (message: string, onUndo: () => void) => void;
  onDataChanged: () => void;
}

/**
 * Reúne a agenda unificada (Google Agenda + feriados brasileiros + datas especiais locais)
 * e as ações de criar, editar ou remover compromissos.
 */
export function useGoogleCalendarActions({
  accessToken,
  specialDates,
  setSpecialDates,
  setTasks,
  updateTask,
  ensureSignedInToken,
  handleWorkspaceAuthError,
  confirmDestructiveAction,
  showUndoToast,
  onDataChanged,
}: UseGoogleCalendarActionsOptions) {
  const [googleCalendarEvents, setGoogleCalendarEvents] = useState<GoogleCalendarEvent[]>([]);
  const [isLoadingCalendar, setIsLoadingCalendar] = useState(false);

  const calendarEvents = useMemo(() => {
    const minDate = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);
    const maxDate = new Date(Date.now() + 180 * 24 * 60 * 60 * 1000);
    const brazilHolidays = getBrazilianHolidaysInRange(minDate, maxDate);
    const expandedSpecials = expandSpecialDatesToEvents(specialDates, minDate, maxDate);
    return mergeAndDeduplicateCalendarEvents(googleCalendarEvents, [
      ...expandedSpecials,
      ...brazilHolidays,
    ]);
  }, [googleCalendarEvents, specialDates]);

  const refreshCalendar = useCallback(async () => {
    const token = accessToken || (await getAccessToken());
    if (!token) return;

    setIsLoadingCalendar(true);
    try {
      const events = await listCalendarEvents(token);
      setGoogleCalendarEvents(events);
    } catch (err) {
      if (!handleWorkspaceAuthError(err)) {
        console.warn('Falha ao carregar calendário:', err);
      }
    } finally {
      setIsLoadingCalendar(false);
    }
  }, [accessToken, handleWorkspaceAuthError]);

  useEffect(() => {
    if (accessToken) {
      void refreshCalendar();
    }
  }, [accessToken, refreshCalendar]);

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
    (ev: GoogleCalendarEvent) => {
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

  const addEventToGoogleCalendar = useCallback(
    async (eventData: CalendarEventPayload): Promise<GoogleCalendarEvent | null> => {
      const token = await ensureSignedInToken();
      if (!token) return null;

      try {
        const created = await createCalendarEvent(token, eventData);
        setGoogleCalendarEvents((prev) => [created, ...prev]);
        confetti({ particleCount: 25, spread: 60 });
        return created;
      } catch (err) {
        handleWorkspaceAuthError(err);
        console.warn('Falha ao adicionar evento na Google Agenda:', err);
        throw err;
      }
    },
    [ensureSignedInToken, handleWorkspaceAuthError]
  );

  const updateGoogleCalendarEvent = useCallback(
    (eventId: string, eventData: CalendarEventPayload) => {
      confirmDestructiveAction({
        title: 'Atualizar Evento na Google Agenda?',
        message: `Confirmar alterações em "${eventData.summary}" no seu Google Calendar?`,
        details: [
          eventData.allDay && eventData.date ? `Data: ${eventData.date}` : 'Horário atualizado',
        ],
        confirmText: 'Salvar Alterações',
        isDestructive: false,
        onConfirm: async () => {
          const token = await ensureSignedInToken();
          if (!token) return;
          try {
            const updated = await apiUpdateCalendarEvent(token, eventId, eventData);
            setGoogleCalendarEvents((prev) =>
              prev.map((ev) => (ev.id === eventId ? { ...ev, ...updated } : ev))
            );
            hapticSuccess();
          } catch (err) {
            handleWorkspaceAuthError(err);
            throw err;
          }
        },
      });
    },
    [confirmDestructiveAction, ensureSignedInToken, handleWorkspaceAuthError]
  );

  const removeGoogleCalendarEvent = useCallback(
    async (eventId: string) => {
      const event = calendarEvents.find((e) => e.id === eventId);
      if (event?.source === 'local_special' && event.specialDateId) {
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

      if (event?.editable === false) return;

      const token = await ensureSignedInToken();
      if (!token) return;

      const summary = event ? event.summary : 'Evento da Google Agenda';
      const targetCalendarId = event?.calendarId || 'primary';

      confirmDestructiveAction({
        title: 'Excluir da Google Agenda?',
        message: `Tem certeza de que deseja remover "${summary}" da sua Google Agenda? Esta ação não pode ser desfeita.`,
        details: [`Calendário: ${event?.calendarSummary || 'Google Agenda'}`],
        confirmText: 'Excluir Evento',
        isDestructive: true,
        onConfirm: async () => {
          try {
            await apiDeleteCalendarEvent(token, eventId, targetCalendarId);
            setGoogleCalendarEvents((prev) => prev.filter((e) => e.id !== eventId));
          } catch (err) {
            handleWorkspaceAuthError(err);
            throw err;
          }
        },
      });
    },
    [
      calendarEvents,
      confirmDestructiveAction,
      deleteSpecialDate,
      ensureSignedInToken,
      handleWorkspaceAuthError,
    ]
  );

  const scheduleTaskInCalendar = useCallback(
    async (task: TaskItem, startHour = '10:00'): Promise<boolean> => {
      const token = await ensureSignedInToken();
      if (!token) return false;

      try {
        const startIso = `${task.dueDate}T${task.dueTime || startHour}:00`;
        const startDate = new Date(startIso);
        const endDate = new Date(startDate.getTime() + 60 * 60 * 1000);

        const created = await addEventToGoogleCalendar({
          summary: `[Lifeedy] ${task.title}`,
          description: task.description || 'Tarefa agendada via Lifeedy',
          startDateTime: startDate.toISOString(),
          endDateTime: endDate.toISOString(),
        });

        if (created) {
          updateTask(task.id, { googleCalendarEventId: created.id });
          return true;
        }
      } catch (e) {
        handleWorkspaceAuthError(e);
        console.warn('Falha ao agendar tarefa no Google Calendar:', e);
      }
      return false;
    },
    [addEventToGoogleCalendar, ensureSignedInToken, handleWorkspaceAuthError, updateTask]
  );

  return {
    googleCalendarEvents,
    setGoogleCalendarEvents,
    calendarEvents,
    isLoadingCalendar,
    refreshCalendar,
    addSpecialDate,
    deleteSpecialDate,
    createTaskFromCalendarEvent,
    addEventToGoogleCalendar,
    updateGoogleCalendarEvent,
    removeGoogleCalendarEvent,
    scheduleTaskInCalendar,
  };
}
