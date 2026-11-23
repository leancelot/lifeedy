import { createContext, useContext } from 'react';
import { NotificationNavigationTarget } from '../services/notificationService';
import {
  AppNotification,
  DraftNote,
  LocalCalendarEvent,
  LocalSpecialDate,
  TaskItem,
} from '../types';
import { CalendarEventPayload, IcsImportSummary } from './hooks/useLocalCalendarActions';

export interface PlannerContextType {
  tasks: TaskItem[];
  localEvents: LocalCalendarEvent[];
  specialDates: LocalSpecialDate[];
  calendarEvents: LocalCalendarEvent[];
  draftNotes: DraftNote[];

  addTask: (task: Omit<TaskItem, 'id'>) => void;
  updateTask: (id: string, updates: Partial<TaskItem>) => void;
  toggleTaskCompletion: (id: string) => void;
  snoozeTaskToTomorrow: (id: string) => void;
  deleteTask: (id: string) => void;
  toggleSubtask: (taskId: string, subtaskId: string) => void;

  addDraftNote: (note: Omit<DraftNote, 'id' | 'updatedAt'>) => void;
  updateDraftNote: (id: string, updates: Partial<DraftNote>) => void;
  deleteDraftNote: (id: string) => void;
  togglePinDraft: (id: string) => void;
  toggleDraftChecklistItem: (draftId: string, itemId: string) => void;
  addDraftChecklistItem: (draftId: string, text: string) => void;
  convertDraftToTask: (draft: DraftNote) => void;

  addSpecialDate: (item: Omit<LocalSpecialDate, 'id' | 'createdAt'>) => void;
  deleteSpecialDate: (id: string) => void;
  createTaskFromCalendarEvent: (event: LocalCalendarEvent) => void;
  addLocalEvent: (event: CalendarEventPayload) => LocalCalendarEvent;
  updateLocalEvent: (eventId: string, event: CalendarEventPayload) => void;
  removeLocalEvent: (eventId: string) => void;
  scheduleTaskInCalendar: (task: TaskItem, startHour?: string) => boolean;
  importIcsCalendar: (rawIcs: string) => IcsImportSummary;
  exportAgendaIcs: () => number;

  notificationPermission: NotificationPermission;
  notificationsList: AppNotification[];
  enableNotifications: () => Promise<boolean>;
  triggerTestNotification: () => void;
  dismissNotification: (id: string) => void;
  clearAllNotifications: () => void;
  pendingNotificationTarget: { target: NotificationNavigationTarget; itemId?: string } | null;
  consumeNotificationTarget: () => void;
}

export const PlannerContext = createContext<PlannerContextType | null>(null);

export const usePlanner = (): PlannerContextType => {
  const ctx = useContext(PlannerContext);
  if (!ctx) {
    throw new Error('usePlanner must be used within an AppProvider');
  }
  return ctx;
};
