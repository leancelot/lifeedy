import { PendingBankNotification, ScheduledValueMessage } from '../types';
import { buildNotificationSignature } from './bankNotificationParser';

export interface DueScheduledRuleMatch {
  rule: ScheduledValueMessage;
  triggerKey: string;
  occurrenceDate: string;
}

function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

export function formatLocalDateYmd(date: Date): string {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

export function evaluateDueScheduledValueMessages(
  rules: ScheduledValueMessage[],
  now: Date = new Date()
): {
  dueMatches: DueScheduledRuleMatch[];
  updatedRules: ScheduledValueMessage[];
  changed: boolean;
} {
  const todayStr = formatLocalDateYmd(now);
  const currentMonthKey = `${now.getFullYear()}-${pad2(now.getMonth() + 1)}`;
  const currentTime = `${pad2(now.getHours())}:${pad2(now.getMinutes())}`;

  const dueMatches: DueScheduledRuleMatch[] = [];
  let changed = false;

  const updatedRules = rules.map((rule) => {
    if (!rule.enabled) return rule;

    if (rule.frequency === 'once') {
      const targetDate = rule.specificDate;
      if (!targetDate) return rule;
      if (targetDate > todayStr) return rule;
      if (targetDate === todayStr && currentTime < (rule.timeOfDay || '09:00')) return rule;

      const triggerKey = targetDate;
      if (rule.lastTriggeredKey === triggerKey) return rule;

      changed = true;
      dueMatches.push({ rule, triggerKey, occurrenceDate: targetDate });
      return {
        ...rule,
        lastTriggeredKey: triggerKey,
        enabled: false,
      };
    }

    // Mensal
    const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    const desiredDay = Math.max(1, Math.min(31, rule.dayOfMonth || 5));
    const targetDay = Math.min(desiredDay, daysInMonth);

    if (now.getDate() < targetDay) return rule;
    if (now.getDate() === targetDay && currentTime < (rule.timeOfDay || '09:00')) return rule;

    const triggerKey = currentMonthKey;
    if (rule.lastTriggeredKey === triggerKey) return rule;

    const occurrenceDate = `${currentMonthKey}-${pad2(targetDay)}`;
    changed = true;
    dueMatches.push({ rule, triggerKey, occurrenceDate });
    return {
      ...rule,
      lastTriggeredKey: triggerKey,
    };
  });

  return { dueMatches, updatedRules, changed };
}

export function buildPendingNotificationFromScheduledRule(
  rule: ScheduledValueMessage,
  occurrenceDate: string,
  nowMs: number = Date.now()
): PendingBankNotification {
  const bankName = 'Mensagem Programada';
  const signature = buildNotificationSignature({
    bankName,
    type: rule.type,
    amount: rule.amount,
    date: occurrenceDate,
    title: rule.title,
  });

  const formattedDay =
    occurrenceDate.length === 10
      ? `${occurrenceDate.slice(8, 10)}/${occurrenceDate.slice(5, 7)}`
      : occurrenceDate;

  return {
    id: `bn-sched-${rule.id}-${nowMs}-${Math.random().toString(36).slice(2, 6)}`,
    signature,
    bankName,
    rawText: rule.messageText || `${rule.title} R$ ${rule.amount.toFixed(2).replace('.', ',')}`,
    title: rule.title,
    amount: rule.amount,
    type: rule.type,
    category: rule.category,
    paymentMethod: rule.paymentMethod || 'pix',
    date: occurrenceDate,
    receivedAt: new Date(nowMs).toISOString(),
    source: 'manual',
    sourceKind: 'scheduled_rule',
    isScheduled: true,
    scheduledLabel:
      rule.frequency === 'monthly'
        ? `Programado mensal (dia ${formattedDay.slice(0, 2)})`
        : `Programado para ${formattedDay}`,
  };
}
