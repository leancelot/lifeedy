import { describe, expect, it } from 'vitest';
import {
  buildMonthGrid,
  formatMonthYearTitle,
  summarizeMonthDayItems,
} from '../agendaMonthUtils';
import { LocalCalendarEvent, TaskItem } from '../../types';

describe('agendaMonthUtils', () => {
  it('builds a full Sunday-to-Saturday grid covering all days of November 2026', () => {
    const grid = buildMonthGrid(2026, 10); // Nov 2026 starts on Sunday (Nov 1) and has 30 days -> 35 cells
    expect(grid).toHaveLength(35);
    expect(grid[0]).toEqual({ dateStr: '2026-11-01', dayNumber: 1, inCurrentMonth: true });
    expect(grid[29]).toEqual({ dateStr: '2026-11-30', dayNumber: 30, inCurrentMonth: true });
    expect(grid[30].inCurrentMonth).toBe(false);
  });

  it('uses 42 cells when a month spans 6 calendar rows', () => {
    const grid = buildMonthGrid(2026, 7); // Aug 2026 starts on Saturday (offset 6) + 31 days = 37 -> 42 cells
    expect(grid).toHaveLength(42);
    expect(grid[0].inCurrentMonth).toBe(false);
    expect(grid[6]).toEqual({ dateStr: '2026-08-01', dayNumber: 1, inCurrentMonth: true });
    expect(grid[36]).toEqual({ dateStr: '2026-08-31', dayNumber: 31, inCurrentMonth: true });
  });

  it('summarizes tasks, regular events, birthdays, and holidays by date', () => {
    const grid = buildMonthGrid(2026, 10);
    const tasks: TaskItem[] = [
      {
        id: 't1',
        title: 'Pagar conta',
        dueDate: '2026-11-10',
        priority: 'high',
        category: 'financas',
        completed: false,
        subtasks: [],
      },
      {
        id: 't2',
        title: 'Feita',
        dueDate: '2026-11-10',
        priority: 'low',
        category: 'pessoal',
        completed: true,
        subtasks: [],
      },
    ];
    const events: LocalCalendarEvent[] = [
      {
        id: 'e1',
        summary: 'Reunião',
        start: { dateTime: '2026-11-10T14:00:00Z' },
        end: { dateTime: '2026-11-10T15:00:00Z' },
      },
      {
        id: 'e2',
        summary: 'Aniversário Ana',
        eventCategory: 'birthday',
        start: { date: '2026-11-15' },
        end: { date: '2026-11-15' },
      },
      {
        id: 'e3',
        summary: 'Proclamação da República',
        eventCategory: 'holiday',
        start: { date: '2026-11-15' },
        end: { date: '2026-11-15' },
      },
    ];

    const summary = summarizeMonthDayItems(grid, tasks, events);
    expect(summary['2026-11-10']).toEqual({
      pendingTasks: 1,
      completedTasks: 1,
      regularEvents: 1,
      birthdays: 0,
      holidays: 0,
      total: 3,
    });
    expect(summary['2026-11-15']).toEqual({
      pendingTasks: 0,
      completedTasks: 0,
      regularEvents: 0,
      birthdays: 1,
      holidays: 1,
      total: 2,
    });
  });

  it('formats month and year title capitalized in pt-BR', () => {
    const label = formatMonthYearTitle(2026, 10);
    expect(label).toMatch(/^Novembro.+2026$/);
  });
});
