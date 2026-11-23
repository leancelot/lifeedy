import { useCallback, useEffect, useRef, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import {
  checkNativeNotificationPermission,
  getNotificationPermission,
  NOTIFICATION_CHANNELS,
  NotificationNavigationTarget,
  registerNotificationActionListener,
  requestNotificationPermission,
  sendWebNotification,
  syncScheduledNativeNotifications,
} from '../../services/notificationService';
import {
  AppNotification,
  BudgetLimit,
  FinanceCategory,
  LocalCalendarEvent,
  TaskItem,
  Transaction,
} from '../../types';
import { evaluateMonthlyBudgetAlerts } from '../../utils/budgetAlertsUtils';
import { formatLocalDateIso } from '../../utils/dateUtils';

const STORAGE_KEY_NOTIFS = 'vidaorganizada_notifications_v2';
const STORAGE_KEY_BUDGET_ALERTS_SENT = 'vidaorganizada_budget_alerts_sent_v1';

const BUDGET_CATEGORY_NAMES: Record<FinanceCategory, string> = {
  salario: 'Salário',
  investimentos: 'Investimentos',
  freelance: 'Freelance',
  moradia: 'Moradia & Contas',
  alimentacao: 'Alimentação',
  transporte: 'Transporte',
  saude: 'Saúde',
  educacao: 'Educação',
  lazer: 'Lazer & Cultura',
  outros: 'Outros',
};

function loadSentBudgetKeys(): Set<string> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_BUDGET_ALERTS_SENT);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? new Set(parsed.filter((x) => typeof x === 'string')) : new Set();
  } catch {
    return new Set();
  }
}

function saveSentBudgetKeys(keys: Set<string>): void {
  try {
    localStorage.setItem(STORAGE_KEY_BUDGET_ALERTS_SENT, JSON.stringify([...keys].slice(-60)));
  } catch {
    // ignore storage errors
  }
}

interface UseNotificationsEngineOptions {
  tasks: TaskItem[];
  calendarEvents: LocalCalendarEvent[];
  transactions: Transaction[];
  budgetLimits: BudgetLimit[];
  refreshAndroidPermissions: () => Promise<unknown>;
}

/**
 * Gerencia permissões de notificação, lembretes em segundo plano no Android,
 * alertas de tarefas/compromissos próximos, alertas de orçamento e a central interna de avisos.
 */
export function useNotificationsEngine({
  tasks,
  calendarEvents,
  transactions,
  budgetLimits,
  refreshAndroidPermissions,
}: UseNotificationsEngineOptions) {
  const [notificationPermission, setNotificationPermission] = useState<NotificationPermission>(() =>
    getNotificationPermission()
  );

  const [notificationsList, setNotificationsList] = useState<AppNotification[]>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY_NOTIFS);
      if (saved) return JSON.parse(saved);
    } catch {
      // ignora erro de leitura
    }
    return [];
  });

  const [pendingNotificationTarget, setPendingNotificationTarget] = useState<{
    target: NotificationNavigationTarget;
    itemId?: string;
  } | null>(null);

  const notifiedKeysRef = useRef<Set<string>>(new Set());
  const sentBudgetAlertKeysRef = useRef<Set<string>>(loadSentBudgetKeys());

  const consumeNotificationTarget = useCallback(() => {
    setPendingNotificationTarget(null);
  }, []);

  const pushAppNotification = useCallback(
    (input: Omit<AppNotification, 'id' | 'timestamp' | 'read'> & { id?: string }) => {
      const item: AppNotification = {
        id: input.id || 'notif-' + Date.now() + '-' + Math.random().toString(36).substring(2, 5),
        title: input.title,
        body: input.body,
        timestamp: new Date().toISOString(),
        type: input.type,
        read: false,
      };
      setNotificationsList((prev) => [item, ...prev.slice(0, 29)]);
    },
    []
  );

  // Sincroniza permissão inicial no Android
  useEffect(() => {
    if (Capacitor.isNativePlatform()) {
      checkNativeNotificationPermission()
        .then((perm) => setNotificationPermission(perm))
        .catch(() => {});
    }
  }, []);

  // Salva histórico recente de avisos localmente
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY_NOTIFS, JSON.stringify(notificationsList.slice(0, 30)));
    } catch {
      // ignora erro de gravação
    }
  }, [notificationsList]);

  // Escuta toques em notificações nativas para abrir a aba certa
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    let cleanup: (() => void) | null = null;
    registerNotificationActionListener((target, itemId) => {
      setPendingNotificationTarget({ target, itemId });
    }).then((unsub) => {
      cleanup = unsub;
    });
    return () => {
      if (cleanup) cleanup();
    };
  }, []);

  // Agenda notificações nativas locais (tarefas, eventos, aniversários e contas)
  useEffect(() => {
    if (!Capacitor.isNativePlatform() || notificationPermission !== 'granted') return;
    const timer = setTimeout(() => {
      void syncScheduledNativeNotifications({
        tasks,
        calendarEvents,
        transactions,
      });
    }, 400);
    return () => clearTimeout(timer);
  }, [tasks, calendarEvents, transactions, notificationPermission]);

  // Monitora limites mensais de orçamento (80% atenção e 100% excedido) sem repetir no mesmo mês
  useEffect(() => {
    const alerts = evaluateMonthlyBudgetAlerts(transactions, budgetLimits, new Date());
    if (alerts.length === 0) return;

    let addedAny = false;
    for (const alert of alerts) {
      const key = `budget-${alert.monthKey}-${alert.category}-${alert.level}`;
      if (sentBudgetAlertKeysRef.current.has(key)) continue;

      sentBudgetAlertKeysRef.current.add(key);
      addedAny = true;

      const catLabel = BUDGET_CATEGORY_NAMES[alert.category] || alert.category;
      const title =
        alert.level === 'exceeded'
          ? `Orçamento excedido: ${catLabel}`
          : `Atenção ao orçamento: ${catLabel}`;
      const body =
        alert.level === 'exceeded'
          ? `Você atingiu ${alert.percent}% do limite mensal definido para ${catLabel}.`
          : `Você já utilizou ${alert.percent}% do limite mensal de ${catLabel}.`;

      sendWebNotification(title, {
        body,
        tag: key,
        channelId: NOTIFICATION_CHANNELS.FINANCE,
        targetTab: 'financas',
      });

      pushAppNotification({
        title,
        body,
        type: 'reminder',
      });
    }

    if (addedAny) {
      saveSentBudgetKeys(sentBudgetAlertKeysRef.current);
    }
  }, [transactions, budgetLimits, pushAppNotification]);

  // Verifica lembretes próximos enquanto o app está aberto
  useEffect(() => {
    const checkReminders = () => {
      const now = new Date();
      const todayStr = formatLocalDateIso(now);
      const currentTimeMs = now.getTime();

      // 1. Tarefas com horário marcado para hoje
      tasks.forEach((task) => {
        if (task.completed || task.dueDate !== todayStr || !task.dueTime) return;

        const [hours, minutes] = task.dueTime.split(':').map(Number);
        const taskDueMs = new Date(
          now.getFullYear(),
          now.getMonth(),
          now.getDate(),
          hours,
          minutes
        ).getTime();
        const diffMinutes = (taskDueMs - currentTimeMs) / (1000 * 60);

        if (diffMinutes <= 15 && diffMinutes >= -5) {
          const key = `task-${task.id}-${todayStr}-${task.dueTime}`;
          if (!notifiedKeysRef.current.has(key)) {
            notifiedKeysRef.current.add(key);

            const title = `⏰ Lembrete: ${task.title}`;
            const body =
              diffMinutes <= 1
                ? `Horário de vencimento agora (${task.dueTime})!`
                : `Vence em aproximadamente ${Math.ceil(diffMinutes)} minuto(s) às ${task.dueTime}.`;

            sendWebNotification(title, {
              body,
              tag: key,
              channelId: NOTIFICATION_CHANNELS.TASKS,
              targetTab: 'agenda',
            });

            pushAppNotification({ title, body, type: 'task_deadline' });
          }
        }
      });

      // 2. Compromissos da Agenda começando em breve
      calendarEvents.forEach((event) => {
        if (!event.start?.dateTime) return;

        const eventStartMs = new Date(event.start.dateTime).getTime();
        const diffMinutes = (eventStartMs - currentTimeMs) / (1000 * 60);

        if (diffMinutes <= 15 && diffMinutes >= -2) {
          const key = `event-${event.id}-${event.start.dateTime}`;
          if (!notifiedKeysRef.current.has(key)) {
            notifiedKeysRef.current.add(key);

            const startTimeFormatted = new Date(event.start.dateTime).toLocaleTimeString('pt-BR', {
              hour: '2-digit',
              minute: '2-digit',
            });

            const title = `📅 Agenda: ${event.summary || 'Compromisso'}`;
            const body =
              diffMinutes <= 1
                ? `Iniciando agora (${startTimeFormatted})!${event.location ? ` • ${event.location}` : ''}`
                : `Inicia em ${Math.ceil(diffMinutes)} minuto(s) às ${startTimeFormatted}.${
                    event.location ? ` Local: ${event.location}` : ''
                  }`;

            sendWebNotification(title, {
              body,
              tag: key,
              channelId: NOTIFICATION_CHANNELS.TASKS,
              targetTab: 'agenda',
            });

            pushAppNotification({ title, body, type: 'calendar_event' });
          }
        }
      });
    };

    checkReminders();
    const interval = setInterval(checkReminders, 30000);
    return () => clearInterval(interval);
  }, [calendarEvents, pushAppNotification, tasks]);

  const enableNotifications = useCallback(async (): Promise<boolean> => {
    const perm = await requestNotificationPermission();
    setNotificationPermission(perm);
    if (Capacitor.isNativePlatform()) {
      void refreshAndroidPermissions();
    }
    if (perm === 'granted') {
      sendWebNotification('🔔 Notificações Ativadas!', {
        body: 'Você agora receberá lembretes de tarefas, agenda e alertas financeiros mesmo em segundo plano.',
        channelId: NOTIFICATION_CHANNELS.TASKS,
        targetTab: 'agenda',
      });
      if (Capacitor.isNativePlatform()) {
        void syncScheduledNativeNotifications({ tasks, calendarEvents, transactions });
      }
      return true;
    }
    return false;
  }, [calendarEvents, refreshAndroidPermissions, tasks, transactions]);

  const triggerTestNotification = useCallback(() => {
    sendWebNotification('🔔 Notificação de Teste', {
      body: 'Seu sistema de notificações visuais está funcionando perfeitamente!',
    });
    pushAppNotification({
      id: 'notif-test-' + Date.now(),
      title: '🔔 Teste de Notificação',
      body: 'Alerta visual emitido com sucesso.',
      type: 'reminder',
    });
  }, [pushAppNotification]);

  const dismissNotification = useCallback((id: string) => {
    setNotificationsList((prev) => prev.filter((n) => n.id !== id));
  }, []);

  const clearAllNotifications = useCallback(() => {
    setNotificationsList([]);
  }, []);

  const resetNotificationMemory = useCallback(() => {
    setNotificationsList([]);
    notifiedKeysRef.current.clear();
    sentBudgetAlertKeysRef.current.clear();
    try {
      localStorage.removeItem(STORAGE_KEY_BUDGET_ALERTS_SENT);
    } catch {
      // ignore
    }
  }, []);

  return {
    notificationPermission,
    setNotificationPermission,
    notificationsList,
    pushAppNotification,
    enableNotifications,
    triggerTestNotification,
    dismissNotification,
    clearAllNotifications,
    resetNotificationMemory,
    pendingNotificationTarget,
    consumeNotificationTarget,
  };
}
