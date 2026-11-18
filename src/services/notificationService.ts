/**
 * Notification Service com suporte nativo Android (Capacitor LocalNotifications)
 * - Canais Android 8+ dedicados (Tarefas, Alertas Financeiros, Atualizações)
 * - Agendamento real em segundo plano (allowWhileIdle) para prazos, agenda e contas recorrentes
 * - Deep-link direto ao tocar na notificação
 */

import { Capacitor } from '@capacitor/core';
import { LocalNotifications, LocalNotificationSchema } from '@capacitor/local-notifications';
import { GoogleCalendarEvent, TaskItem, Transaction } from '../types';

export const NOTIFICATION_CHANNELS = {
  TASKS: 'lifeedy_tasks',
  FINANCE: 'lifeedy_finance',
  UPDATES: 'lifeedy_updates',
} as const;

export type NotificationNavigationTarget = 'agenda' | 'financas' | 'updates';

const STORAGE_KEY_MANAGED_IDS = 'vidaorganizada_scheduled_notif_ids_v1';
const STORAGE_KEY_NATIVE_PERM = 'vidaorganizada_native_notif_perm';
const MAX_SCHEDULED_NOTIFS = 48;

let channelsInitialized = false;

export function isNotificationSupported(): boolean {
  if (Capacitor.isNativePlatform()) {
    return true;
  }
  return typeof window !== 'undefined' && 'Notification' in window;
}

export function getNotificationPermission(): NotificationPermission {
  if (Capacitor.isNativePlatform()) {
    try {
      const saved = localStorage.getItem(STORAGE_KEY_NATIVE_PERM);
      if (saved === 'granted' || saved === 'denied') return saved as NotificationPermission;
    } catch {
      // ignore
    }
    return 'default';
  }

  if (!isNotificationSupported()) return 'denied';
  return Notification.permission;
}

export async function checkNativeNotificationPermission(): Promise<NotificationPermission> {
  if (!Capacitor.isNativePlatform()) {
    return getNotificationPermission();
  }
  try {
    const status = await LocalNotifications.checkPermissions();
    const perm: NotificationPermission =
      status.display === 'granted'
        ? 'granted'
        : status.display === 'denied'
        ? 'denied'
        : 'default';
    try {
      localStorage.setItem(STORAGE_KEY_NATIVE_PERM, perm);
    } catch {
      // ignore
    }
    return perm;
  } catch {
    return getNotificationPermission();
  }
}

export async function requestNotificationPermission(): Promise<NotificationPermission> {
  if (Capacitor.isNativePlatform()) {
    try {
      const result = await LocalNotifications.requestPermissions();
      const perm: NotificationPermission = result.display === 'granted' ? 'granted' : 'denied';
      try {
        localStorage.setItem(STORAGE_KEY_NATIVE_PERM, perm);
      } catch {
        // ignore
      }
      if (perm === 'granted') {
        await ensureAndroidNotificationChannels();
      }
      return perm;
    } catch (error) {
      console.warn('Erro ao solicitar permissão de notificações nativas:', error);
      return 'denied';
    }
  }

  if (!isNotificationSupported()) return 'denied';
  try {
    const permission = await Notification.requestPermission();
    return permission;
  } catch (error) {
    console.error('Erro ao solicitar permissão de notificações:', error);
    return 'denied';
  }
}

export async function ensureAndroidNotificationChannels(): Promise<void> {
  if (!Capacitor.isNativePlatform() || Capacitor.getPlatform() !== 'android' || channelsInitialized) {
    return;
  }

  try {
    await LocalNotifications.createChannel({
      id: NOTIFICATION_CHANNELS.TASKS,
      name: 'Tarefas e Agenda',
      description: 'Lembretes de tarefas, compromissos e aniversários',
      importance: 4,
      visibility: 1,
      vibration: true,
    });
    await LocalNotifications.createChannel({
      id: NOTIFICATION_CHANNELS.FINANCE,
      name: 'Alertas Financeiros',
      description: 'Vencimento de contas recorrentes e avisos de orçamento',
      importance: 4,
      visibility: 0,
      vibration: true,
    });
    await LocalNotifications.createChannel({
      id: NOTIFICATION_CHANNELS.UPDATES,
      name: 'Atualizações do App',
      description: 'Avisos de nova versão disponível e sincronização',
      importance: 3,
      visibility: 1,
      vibration: false,
    });
    channelsInitialized = true;
  } catch (err) {
    console.warn('Não foi possível criar canais de notificação Android:', err);
  }
}

/**
 * Generates a deterministic positive 32-bit integer notification ID from a unique string key
 */
export function deterministicNotificationId(key: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) {
    hash ^= key.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash & 0x7fffffff) || 1;
}

function parseLocalDate(dateStr: string, hour = 9, minute = 0): Date | null {
  const match = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]) - 1;
  const day = Number(match[3]);
  const d = new Date(year, month, day, hour, minute, 0, 0);
  if (Number.isNaN(d.getTime())) return null;
  return d;
}

function getNextMonthlyOccurrence(sourceDateStr: string, fromDate: Date): Date | null {
  const match = sourceDateStr.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const dayOfMonth = Math.max(1, Math.min(31, Number(match[3])));

  const candidates = [
    new Date(fromDate.getFullYear(), fromDate.getMonth(), 1, 9, 0, 0, 0),
    new Date(fromDate.getFullYear(), fromDate.getMonth() + 1, 1, 9, 0, 0, 0),
  ];

  for (const base of candidates) {
    const daysInMonth = new Date(base.getFullYear(), base.getMonth() + 1, 0).getDate();
    const clampedDay = Math.min(dayOfMonth, daysInMonth);
    const due = new Date(base.getFullYear(), base.getMonth(), clampedDay, 9, 0, 0, 0);
    if (due.getTime() >= fromDate.getTime() - 24 * 60 * 60 * 1000) {
      return due;
    }
  }
  return null;
}

export interface ScheduledReminderPlan {
  id: number;
  key: string;
  title: string;
  body: string;
  at: Date;
  channelId: string;
  targetTab: NotificationNavigationTarget;
  itemId?: string;
}

export function buildUpcomingNotificationPlan(
  params: {
    tasks: TaskItem[];
    calendarEvents: GoogleCalendarEvent[];
    transactions: Transaction[];
  },
  nowMs: number = Date.now()
): ScheduledReminderPlan[] {
  const horizonMs = nowMs + 14 * 24 * 60 * 60 * 1000;
  const minScheduleMs = nowMs + 15_000;
  const plans: ScheduledReminderPlan[] = [];
  const seenKeys = new Set<string>();

  const pushPlan = (plan: Omit<ScheduledReminderPlan, 'id'>) => {
    const atMs = plan.at.getTime();
    if (!Number.isFinite(atMs) || atMs < minScheduleMs || atMs > horizonMs) return;
    if (seenKeys.has(plan.key)) return;
    seenKeys.add(plan.key);
    plans.push({
      ...plan,
      id: deterministicNotificationId(plan.key),
    });
  };

  // 1. Tarefas pendentes com data/hora
  for (const task of params.tasks) {
    if (task.completed || !task.dueDate) continue;

    if (task.dueTime) {
      const [hStr, mStr] = task.dueTime.split(':');
      const hour = Number(hStr);
      const minute = Number(mStr);
      if (Number.isFinite(hour) && Number.isFinite(minute)) {
        const dueAt = parseLocalDate(task.dueDate, hour, minute);
        if (dueAt) {
          const minsBefore =
            typeof task.reminderMinutesBefore === 'number' && task.reminderMinutesBefore > 0
              ? task.reminderMinutesBefore
              : 15;
          const beforeAt = new Date(dueAt.getTime() - minsBefore * 60_000);
          pushPlan({
            key: `task-before-${task.id}-${task.dueDate}-${task.dueTime}-${minsBefore}`,
            title: `Tarefa em ${minsBefore} min: ${task.title}`,
            body: `Horário previsto às ${task.dueTime}.`,
            at: beforeAt,
            channelId: NOTIFICATION_CHANNELS.TASKS,
            targetTab: 'agenda',
            itemId: task.id,
          });
          pushPlan({
            key: `task-exact-${task.id}-${task.dueDate}-${task.dueTime}`,
            title: `Prazo agora: ${task.title}`,
            body: `Agendado para ${task.dueTime}.`,
            at: dueAt,
            channelId: NOTIFICATION_CHANNELS.TASKS,
            targetTab: 'agenda',
            itemId: task.id,
          });
        }
      }
    } else {
      const morningAt = parseLocalDate(task.dueDate, 9, 0);
      if (morningAt) {
        pushPlan({
          key: `task-day-${task.id}-${task.dueDate}`,
          title: `Tarefa para hoje: ${task.title}`,
          body: 'Toque para visualizar e concluir na Agenda.',
          at: morningAt,
          channelId: NOTIFICATION_CHANNELS.TASKS,
          targetTab: 'agenda',
          itemId: task.id,
        });
      }
    }
  }

  // 2. Compromissos da Agenda e Aniversários locais
  for (const ev of params.calendarEvents) {
    if (ev.source === 'brazil_holiday') continue;
    if (ev.start?.dateTime) {
      const startDate = new Date(ev.start.dateTime);
      if (!Number.isNaN(startDate.getTime())) {
        const beforeAt = new Date(startDate.getTime() - 15 * 60_000);
        const formattedTime = startDate.toLocaleTimeString('pt-BR', {
          hour: '2-digit',
          minute: '2-digit',
        });
        pushPlan({
          key: `event-before-${ev.id}-${ev.start.dateTime}`,
          title: `Agenda às ${formattedTime}: ${ev.summary || 'Compromisso'}`,
          body: ev.location ? `Local: ${ev.location}` : 'Começa em 15 minutos.',
          at: beforeAt,
          channelId: NOTIFICATION_CHANNELS.TASKS,
          targetTab: 'agenda',
          itemId: ev.id,
        });
      }
    } else if (ev.start?.date && ev.eventCategory === 'birthday') {
      const bdayAt = parseLocalDate(ev.start.date.slice(0, 10), 9, 0);
      if (bdayAt) {
        pushPlan({
          key: `birthday-${ev.id}-${ev.start.date}`,
          title: `Aniversário hoje: ${ev.summary}`,
          body: 'Lembrete especial da sua agenda pessoal.',
          at: bdayAt,
          channelId: NOTIFICATION_CHANNELS.TASKS,
          targetTab: 'agenda',
          itemId: ev.id,
        });
      }
    }
  }

  // 3. Alertas financeiros para despesas recorrentes (1 dia antes + no vencimento)
  const nowDate = new Date(nowMs);
  for (const tx of params.transactions) {
    if (!tx.recurring || tx.type !== 'despesa' || !tx.date) continue;
    const nextDue = getNextMonthlyOccurrence(tx.date, nowDate);
    if (!nextDue) continue;

    const amountText = new Intl.NumberFormat('pt-BR', {
      style: 'currency',
      currency: 'BRL',
    }).format(tx.amount);

    const eveAt = new Date(nextDue.getTime() - 24 * 60 * 60 * 1000);
    const dueKeyMonth = `${nextDue.getFullYear()}-${String(nextDue.getMonth() + 1).padStart(2, '0')}`;

    pushPlan({
      key: `bill-eve-${tx.id}-${dueKeyMonth}`,
      title: `Conta vence amanhã: ${tx.title}`,
      body: `Valor previsto de ${amountText}. Toque para conferir em Finanças.`,
      at: eveAt,
      channelId: NOTIFICATION_CHANNELS.FINANCE,
      targetTab: 'financas',
      itemId: tx.id,
    });

    pushPlan({
      key: `bill-due-${tx.id}-${dueKeyMonth}`,
      title: `Vencimento hoje: ${tx.title}`,
      body: `Lançamento recorrente de ${amountText}.`,
      at: nextDue,
      channelId: NOTIFICATION_CHANNELS.FINANCE,
      targetTab: 'financas',
      itemId: tx.id,
    });
  }

  return plans
    .sort((a, b) => a.at.getTime() - b.at.getTime())
    .slice(0, MAX_SCHEDULED_NOTIFS);
}

function loadManagedIds(): number[] {
  if (typeof localStorage === 'undefined') return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY_MANAGED_IDS);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((id) => typeof id === 'number') : [];
  } catch {
    return [];
  }
}

function saveManagedIds(ids: number[]): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY_MANAGED_IDS, JSON.stringify(ids));
  } catch {
    // ignore
  }
}

export async function syncScheduledNativeNotifications(params: {
  tasks: TaskItem[];
  calendarEvents: GoogleCalendarEvent[];
  transactions: Transaction[];
}): Promise<number> {
  if (!Capacitor.isNativePlatform()) return 0;

  try {
    const perm = await LocalNotifications.checkPermissions();
    if (perm.display !== 'granted') return 0;

    await ensureAndroidNotificationChannels();

    const plans = buildUpcomingNotificationPlan(params);
    const previousIds = loadManagedIds();
    const pendingRes = await LocalNotifications.getPending().catch(() => ({ notifications: [] }));
    const pendingIds = (pendingRes.notifications || []).map((n) => n.id);
    const idsToCancel = Array.from(new Set([...previousIds, ...pendingIds]));

    if (idsToCancel.length > 0) {
      await LocalNotifications.cancel({
        notifications: idsToCancel.map((id) => ({ id })),
      }).catch(() => {});
    }

    if (plans.length === 0) {
      saveManagedIds([]);
      return 0;
    }

    const nativePayload: LocalNotificationSchema[] = plans.map((plan) => ({
      id: plan.id,
      title: plan.title,
      body: plan.body,
      channelId: plan.channelId,
      smallIcon: 'ic_stat_lifeedy',
      schedule: {
        at: plan.at,
        allowWhileIdle: true,
      },
      extra: {
        targetTab: plan.targetTab,
        itemId: plan.itemId || '',
        key: plan.key,
      },
    }));

    await LocalNotifications.schedule({ notifications: nativePayload });
    saveManagedIds(plans.map((p) => p.id));
    return nativePayload.length;
  } catch (err) {
    console.warn('Falha ao sincronizar alarmes nativos de notificação:', err);
    return 0;
  }
}

export async function registerNotificationActionListener(
  onNavigate: (target: NotificationNavigationTarget, itemId?: string) => void
): Promise<(() => void) | null> {
  if (!Capacitor.isNativePlatform()) return null;

  try {
    const handle = await LocalNotifications.addListener(
      'localNotificationActionPerformed',
      (action) => {
        const extra = (action?.notification?.extra || {}) as Record<string, unknown>;
        const target = extra.targetTab;
        const itemId = typeof extra.itemId === 'string' ? extra.itemId : undefined;
        if (target === 'agenda' || target === 'financas' || target === 'updates') {
          onNavigate(target, itemId);
        }
      }
    );
    return () => {
      void handle.remove();
    };
  } catch {
    return null;
  }
}

/**
 * Dispara uma notificação imediata no Android (canal apropriado) ou Web Notification
 */
export async function sendWebNotification(
  title: string,
  options?: {
    body?: string;
    tag?: string;
    channelId?: string;
    targetTab?: NotificationNavigationTarget;
    onClick?: () => void;
  }
): Promise<boolean> {
  if (Capacitor.isNativePlatform()) {
    try {
      const perm = await LocalNotifications.checkPermissions();
      if (perm.display !== 'granted') {
        const req = await LocalNotifications.requestPermissions();
        if (req.display !== 'granted') return false;
      }

      await ensureAndroidNotificationChannels();

      const id = options?.tag
        ? deterministicNotificationId(options.tag)
        : Math.floor(Math.random() * 1000000) + 1;

      await LocalNotifications.schedule({
        notifications: [
          {
            id,
            title,
            body: options?.body || '',
            channelId: options?.channelId || NOTIFICATION_CHANNELS.TASKS,
            smallIcon: 'ic_stat_lifeedy',
            schedule: { at: new Date(Date.now() + 200), allowWhileIdle: true },
            extra: {
              tag: options?.tag,
              targetTab: options?.targetTab || 'agenda',
            },
          },
        ],
      });
      return true;
    } catch (e) {
      console.warn('Erro ao disparar notificação nativa:', e);
      return false;
    }
  }

  if (!isNotificationSupported() || Notification.permission !== 'granted') {
    return false;
  }

  try {
    const notification = new Notification(title, {
      body: options?.body,
      tag: options?.tag,
      icon: '/favicon.ico',
      silent: true,
    });

    if (options?.onClick) {
      notification.onclick = () => {
        window.focus();
        options.onClick?.();
        notification.close();
      };
    }

    return true;
  } catch (error) {
    console.warn('Erro ao disparar Web Notification:', error);
    return false;
  }
}
