import { describe, expect, it } from 'vitest';
import { ScheduledValueMessage } from '../../types';
import { sanitizeLegacyPayload } from '../../utils/storageSanitizer';
import {
  buildPendingNotificationFromScheduledRule,
  evaluateDueScheduledValueMessages,
} from '../scheduledValueMessageEngine';

describe('scheduledValueMessageEngine', () => {
  const baseMonthlyRule: ScheduledValueMessage = {
    id: 'svm-1',
    title: 'Aluguel Apartamento',
    messageText: 'Pagar aluguel R$ 1.850,00',
    amount: 1850,
    type: 'despesa',
    category: 'moradia',
    paymentMethod: 'pix',
    frequency: 'monthly',
    dayOfMonth: 5,
    timeOfDay: '09:00',
    enabled: true,
    createdAt: '2026-11-01T10:00:00.000Z',
  };

  it('dispara mensagem mensal apenas quando dia e horário chegam e evita duplicar no mesmo mês', () => {
    const beforeHour = new Date(2026, 10, 5, 8, 59); // Nov 5, 08:59
    const r1 = evaluateDueScheduledValueMessages([baseMonthlyRule], beforeHour);
    expect(r1.dueMatches).toHaveLength(0);
    expect(r1.changed).toBe(false);

    const onTime = new Date(2026, 10, 5, 9, 15); // Nov 5, 09:15
    const r2 = evaluateDueScheduledValueMessages([baseMonthlyRule], onTime);
    expect(r2.dueMatches).toHaveLength(1);
    expect(r2.dueMatches[0].occurrenceDate).toBe('2026-11-05');
    expect(r2.updatedRules[0].lastTriggeredKey).toBe('2026-11');

    const laterSameMonth = new Date(2026, 10, 18, 14, 0);
    const r3 = evaluateDueScheduledValueMessages(r2.updatedRules, laterSameMonth);
    expect(r3.dueMatches).toHaveLength(0);

    const nextMonth = new Date(2026, 11, 5, 9, 5); // Dec 5, 09:05
    const r4 = evaluateDueScheduledValueMessages(r2.updatedRules, nextMonth);
    expect(r4.dueMatches).toHaveLength(1);
    expect(r4.dueMatches[0].occurrenceDate).toBe('2026-12-05');
  });

  it('ajusta dia 31 para o último dia do mês em fevereiro', () => {
    const rule31: ScheduledValueMessage = {
      ...baseMonthlyRule,
      id: 'svm-31',
      dayOfMonth: 31,
    };
    const feb28 = new Date(2026, 1, 28, 10, 0); // Feb 28, 2026
    const res = evaluateDueScheduledValueMessages([rule31], feb28);
    expect(res.dueMatches).toHaveLength(1);
    expect(res.dueMatches[0].occurrenceDate).toBe('2026-02-28');
  });

  it('dispara regra de data única uma única vez e desativa após disparo', () => {
    const onceRule: ScheduledValueMessage = {
      ...baseMonthlyRule,
      id: 'svm-once',
      frequency: 'once',
      dayOfMonth: undefined,
      specificDate: '2026-11-23',
      timeOfDay: '12:00',
    };

    const fired = evaluateDueScheduledValueMessages([onceRule], new Date(2026, 10, 23, 12, 5));
    expect(fired.dueMatches).toHaveLength(1);
    expect(fired.updatedRules[0].enabled).toBe(false);
    expect(fired.updatedRules[0].lastTriggeredKey).toBe('2026-11-23');

    const pending = buildPendingNotificationFromScheduledRule(
      onceRule,
      fired.dueMatches[0].occurrenceDate
    );
    expect(pending.isScheduled).toBe(true);
    expect(pending.sourceKind).toBe('scheduled_rule');
    expect(pending.amount).toBe(1850);
  });

  it('sanitiza bankCaptureSettings e scheduledValueMessages ao carregar payloads', () => {
    const sanitized = sanitizeLegacyPayload({
      version: 4,
      tasks: [],
      transactions: [],
      financialGoals: [],
      budgetLimits: [],
      draftNotes: [],
      bankCaptureSettings: {
        captureBanksEnabled: true,
        captureWalletEnabled: true,
        captureSmsEnabled: false,
        captureScheduledMessagesEnabled: true,
        manualApps: [
          { packageName: 'com.whatsapp', label: 'WhatsApp', enabled: true },
          { packageName: 'invalid package!', label: 'Bad', enabled: true },
        ],
      },
      scheduledValueMessages: [
        baseMonthlyRule,
        { id: 'bad', title: '', amount: -10 },
      ],
    });

    expect(sanitized.bankCaptureSettings?.captureSmsEnabled).toBe(false);
    expect(sanitized.bankCaptureSettings?.manualApps).toHaveLength(1);
    expect(sanitized.bankCaptureSettings?.manualApps[0].packageName).toBe('com.whatsapp');
    expect(sanitized.scheduledValueMessages).toHaveLength(1);
    expect(sanitized.scheduledValueMessages?.[0].amount).toBe(1850);
  });
});
