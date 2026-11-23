import { LocalCalendarEvent, TaskItem } from '../types';

export interface MonthGridCell {
  dateStr: string;
  dayNumber: number;
  inCurrentMonth: boolean;
}

export interface MonthDaySummary {
  pendingTasks: number;
  completedTasks: number;
  regularEvents: number;
  birthdays: number;
  holidays: number;
  total: number;
}

const formatYmd = (d: Date): string => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};

export function buildMonthGrid(year: number, monthIndex: number): MonthGridCell[] {
  const firstOfMonth = new Date(year, monthIndex, 1, 12, 0, 0);
  const startOffset = firstOfMonth.getDay(); // 0 = Sunday
  const daysInMonth = new Date(year, monthIndex + 1, 0, 12, 0, 0).getDate();
  const totalNeeded = startOffset + daysInMonth;
  const totalCells = totalNeeded <= 35 ? 35 : 42;

  const gridStart = new Date(year, monthIndex, 1 - startOffset, 12, 0, 0);
  const cells: MonthGridCell[] = [];

  for (let i = 0; i < totalCells; i++) {
    const cellDate = new Date(gridStart);
    cellDate.setDate(gridStart.getDate() + i);
    cells.push({
      dateStr: formatYmd(cellDate),
      dayNumber: cellDate.getDate(),
      inCurrentMonth:
        cellDate.getFullYear() === year && cellDate.getMonth() === monthIndex,
    });
  }

  return cells;
}

const getEventDateKey = (ev: LocalCalendarEvent): string => {
  if (ev.start?.date) return ev.start.date.slice(0, 10);
  if (ev.start?.dateTime) return formatYmd(new Date(ev.start.dateTime));
  return '';
};

export function summarizeMonthDayItems(
  cells: MonthGridCell[],
  tasks: TaskItem[],
  events: LocalCalendarEvent[]
): Record<string, MonthDaySummary> {
  const map: Record<string, MonthDaySummary> = {};
  for (const cell of cells) {
    map[cell.dateStr] = {
      pendingTasks: 0,
      completedTasks: 0,
      regularEvents: 0,
      birthdays: 0,
      holidays: 0,
      total: 0,
    };
  }

  for (const task of tasks) {
    const bucket = map[task.dueDate];
    if (!bucket) continue;
    if (task.completed) {
      bucket.completedTasks += 1;
    } else {
      bucket.pendingTasks += 1;
    }
    bucket.total += 1;
  }

  for (const ev of events) {
    const dateKey = getEventDateKey(ev);
    const bucket = dateKey ? map[dateKey] : undefined;
    if (!bucket) continue;
    if (ev.eventCategory === 'birthday') {
      bucket.birthdays += 1;
    } else if (ev.eventCategory === 'holiday' || ev.eventCategory === 'commemorative') {
      bucket.holidays += 1;
    } else {
      bucket.regularEvents += 1;
    }
    bucket.total += 1;
  }

  return map;
}

export function formatMonthYearTitle(year: number, monthIndex: number): string {
  const formatted = new Intl.DateTimeFormat('pt-BR', {
    month: 'long',
    year: 'numeric',
  }).format(new Date(year, monthIndex, 1, 12, 0, 0));
  return formatted.charAt(0).toUpperCase() + formatted.slice(1);
}
