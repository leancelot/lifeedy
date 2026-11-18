import { describe, expect, it } from 'vitest';
import {
  buildUpcomingNotificationPlan,
  deterministicNotificationId,
  NOTIFICATION_CHANNELS,
} from '../notificationService';
import { GoogleCalendarEvent, TaskItem, Transaction } from '../../types';

describe('notificationService', () => {
  it('generates stable positive 32-bit IDs for identical keys', () => {
    const id1 = deterministicNotificationId('task-1-2026-11-20');
    const id2 = deterministicNotificationId('task-1-2026-11-20');
    const id3 = deterministicNotificationId('task-2-2026-11-20');

    expect(id1).toBe(id2);
    expect(id1).toBeGreaterThan(0);
    expect(id1).not.toBe(id3);
  });

  it('schedules task reminders, birthday reminders, and recurring expense due alerts', () => {
    const now = new Date(2026, 10, 18, 8, 0, 0, 0).getTime(); // 2026-11-18 08:00 local

    const tasks: TaskItem[] = [
      {
        id: 't1',
        title: 'Enviar relatório',
        dueDate: '2026-11-18',
        dueTime: '14:00',
        priority: 'high',
        category: 'trabalho',
        completed: false,
        subtasks: [],
      },
      {
        id: 't2',
        title: 'Tarefa concluída',
        dueDate: '2026-11-18',
        dueTime: '15:00',
        priority: 'low',
        category: 'pessoal',
        completed: true,
        subtasks: [],
      },
    ];

    const transactions: Transaction[] = [
      {
        id: 'tx1',
        type: 'despesa',
        title: 'Aluguel',
        amount: 1850,
        category: 'moradia',
        date: '2026-10-20',
        recurring: true,
      },
    ];

    const calendarEvents: GoogleCalendarEvent[] = [
      {
        id: 'b1',
        summary: 'Aniversário Maria',
        start: { date: '2026-11-21' },
        end: { date: '2026-11-22' },
        eventCategory: 'birthday',
        source: 'local_special',
      },
    ];

    const plans = buildUpcomingNotificationPlan({ tasks, calendarEvents, transactions }, now);

    // Completed task excluded
    expect(plans.some((p) => p.itemId === 't2')).toBe(false);

    // Task 15m before + exact
    const taskPlans = plans.filter((p) => p.itemId === 't1');
    expect(taskPlans).toHaveLength(2);
    expect(taskPlans[0].channelId).toBe(NOTIFICATION_CHANNELS.TASKS);
    expect(taskPlans[0].targetTab).toBe('agenda');

    // Recurring expense eve (Nov 19 09:00) & due day (Nov 20 09:00)
    const billPlans = plans.filter((p) => p.itemId === 'tx1');
    expect(billPlans).toHaveLength(2);
    expect(billPlans[0].channelId).toBe(NOTIFICATION_CHANNELS.FINANCE);
    expect(billPlans[0].targetTab).toBe('financas');

    // Birthday reminder
    const bdayPlan = plans.find((p) => p.itemId === 'b1');
    expect(bdayPlan).toBeDefined();
    expect(bdayPlan?.channelId).toBe(NOTIFICATION_CHANNELS.TASKS);
  });
});
