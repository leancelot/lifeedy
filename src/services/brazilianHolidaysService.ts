import { CalendarEventCategory, GoogleCalendarEvent, LocalSpecialDate } from '../types';

function toIsoDate(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function addDaysToDate(date: Date, days: number): Date {
  const next = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 12, 0, 0);
  next.setDate(next.getDate() + days);
  return next;
}

function formatLocalDate(date: Date): string {
  return toIsoDate(date.getFullYear(), date.getMonth() + 1, date.getDate());
}

/**
 * Meeus/Jones/Butcher Gregorian algorithm for Easter Sunday.
 */
export function computeEasterSunday(year: number): Date {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31); // 3=March, 4=April
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(year, month - 1, day, 12, 0, 0);
}

/**
 * Computes the Nth occurrence (1-indexed) of a weekday (0=Sunday..6=Saturday) in a given month (1..12).
 */
function getNthWeekdayOfMonth(year: number, month: number, weekday: number, nth: number): Date {
  const firstDay = new Date(year, month - 1, 1, 12, 0, 0);
  const firstWeekday = firstDay.getDay();
  const delta = (weekday - firstWeekday + 7) % 7;
  const day = 1 + delta + (nth - 1) * 7;
  return new Date(year, month - 1, day, 12, 0, 0);
}

interface BuiltInDateEntry {
  dateStr: string;
  summary: string;
  description: string;
  category: CalendarEventCategory;
}

export function getBrazilianHolidaysAndDatesForYear(year: number): GoogleCalendarEvent[] {
  const easter = computeEasterSunday(year);
  const carnivalMonday = addDaysToDate(easter, -48);
  const carnivalTuesday = addDaysToDate(easter, -47);
  const goodFriday = addDaysToDate(easter, -2);
  const corpusChristi = addDaysToDate(easter, 60);
  const mothersDay = getNthWeekdayOfMonth(year, 5, 0, 2); // 2o domingo de maio
  const fathersDay = getNthWeekdayOfMonth(year, 8, 0, 2); // 2o domingo de agosto

  const entries: BuiltInDateEntry[] = [
    {
      dateStr: toIsoDate(year, 1, 1),
      summary: 'Confraternização Universal',
      description: 'Feriado nacional brasileiro',
      category: 'holiday',
    },
    {
      dateStr: formatLocalDate(carnivalMonday),
      summary: 'Carnaval (Ponto Facultativo)',
      description: 'Segunda-feira de Carnaval',
      category: 'commemorative',
    },
    {
      dateStr: formatLocalDate(carnivalTuesday),
      summary: 'Carnaval',
      description: 'Terça-feira de Carnaval',
      category: 'commemorative',
    },
    {
      dateStr: toIsoDate(year, 3, 8),
      summary: 'Dia Internacional da Mulher',
      description: 'Data comemorativa',
      category: 'commemorative',
    },
    {
      dateStr: formatLocalDate(goodFriday),
      summary: 'Sexta-feira Santa',
      description: 'Feriado nacional brasileiro (Paixão de Cristo)',
      category: 'holiday',
    },
    {
      dateStr: formatLocalDate(easter),
      summary: 'Páscoa',
      description: 'Data comemorativa',
      category: 'commemorative',
    },
    {
      dateStr: toIsoDate(year, 4, 21),
      summary: 'Tiradentes',
      description: 'Feriado nacional brasileiro',
      category: 'holiday',
    },
    {
      dateStr: toIsoDate(year, 5, 1),
      summary: 'Dia do Trabalho',
      description: 'Feriado nacional brasileiro',
      category: 'holiday',
    },
    {
      dateStr: formatLocalDate(mothersDay),
      summary: 'Dia das Mães',
      description: 'Data comemorativa brasileira (2º domingo de maio)',
      category: 'commemorative',
    },
    {
      dateStr: formatLocalDate(corpusChristi),
      summary: 'Corpus Christi',
      description: 'Data religiosa / ponto facultativo nacional',
      category: 'commemorative',
    },
    {
      dateStr: toIsoDate(year, 6, 12),
      summary: 'Dia dos Namorados',
      description: 'Data comemorativa no Brasil',
      category: 'commemorative',
    },
    {
      dateStr: formatLocalDate(fathersDay),
      summary: 'Dia dos Pais',
      description: 'Data comemorativa brasileira (2º domingo de agosto)',
      category: 'commemorative',
    },
    {
      dateStr: toIsoDate(year, 9, 7),
      summary: 'Independência do Brasil',
      description: 'Feriado nacional brasileiro',
      category: 'holiday',
    },
    {
      dateStr: toIsoDate(year, 10, 12),
      summary: 'Nossa Senhora Aparecida / Dia das Crianças',
      description: 'Feriado nacional brasileiro e Dia das Crianças',
      category: 'holiday',
    },
    {
      dateStr: toIsoDate(year, 10, 15),
      summary: 'Dia do Professor',
      description: 'Data comemorativa nacional',
      category: 'commemorative',
    },
    {
      dateStr: toIsoDate(year, 11, 2),
      summary: 'Finados',
      description: 'Feriado nacional brasileiro',
      category: 'holiday',
    },
    {
      dateStr: toIsoDate(year, 11, 15),
      summary: 'Proclamação da República',
      description: 'Feriado nacional brasileiro',
      category: 'holiday',
    },
    {
      dateStr: toIsoDate(year, 11, 20),
      summary: 'Dia da Consciência Negra',
      description: 'Feriado nacional (Dia Nacional de Zumbi e da Consciência Negra)',
      category: 'holiday',
    },
    {
      dateStr: toIsoDate(year, 12, 25),
      summary: 'Natal',
      description: 'Feriado nacional brasileiro',
      category: 'holiday',
    },
    {
      dateStr: toIsoDate(year, 12, 31),
      summary: 'Véspera de Ano Novo',
      description: 'Data comemorativa de fim de ano',
      category: 'commemorative',
    },
  ];

  return entries.map((entry) => ({
    id: `br-${entry.dateStr}-${normalizeTitle(entry.summary).replace(/\s+/g, '-')}`,
    summary: entry.summary,
    description: entry.description,
    start: { date: entry.dateStr },
    end: { date: entry.dateStr },
    calendarSummary: entry.category === 'holiday' ? 'Feriados no Brasil' : 'Datas Comemorativas',
    eventCategory: entry.category,
    source: 'brazil_holiday',
    editable: false,
  }));
}

export function getBrazilianHolidaysInRange(minDate: Date, maxDate: Date): GoogleCalendarEvent[] {
  const minStr = formatLocalDate(minDate);
  const maxStr = formatLocalDate(maxDate);
  const years = new Set<number>([minDate.getFullYear(), maxDate.getFullYear()]);
  const list: GoogleCalendarEvent[] = [];

  years.forEach((yr) => {
    getBrazilianHolidaysAndDatesForYear(yr).forEach((ev) => {
      const d = ev.start.date || '';
      if (d >= minStr && d <= maxStr) {
        list.push(ev);
      }
    });
  });

  return list;
}

export function expandSpecialDatesToEvents(
  specialDates: LocalSpecialDate[],
  minDate: Date,
  maxDate: Date
): GoogleCalendarEvent[] {
  if (!Array.isArray(specialDates) || specialDates.length === 0) return [];
  const minStr = formatLocalDate(minDate);
  const maxStr = formatLocalDate(maxDate);
  const years = new Set<number>([minDate.getFullYear(), maxDate.getFullYear()]);
  const result: GoogleCalendarEvent[] = [];

  specialDates.forEach((item) => {
    if (!item.monthDay) return;
    if (item.recurringYearly) {
      // Accepts MM-DD or YYYY-MM-DD and normalizes to MM-DD
      const parts = item.monthDay.split('-');
      const mmdd = parts.length === 3 ? `${parts[1]}-${parts[2]}` : item.monthDay;
      if (!/^\d{2}-\d{2}$/.test(mmdd)) return;

      years.forEach((yr) => {
        const dateStr = `${yr}-${mmdd}`;
        if (dateStr >= minStr && dateStr <= maxStr) {
          result.push({
            id: `local-special-${item.id}-${yr}`,
            specialDateId: item.id,
            summary: item.title,
            description:
              item.notes ||
              (item.category === 'birthday'
                ? 'Aniversário salvo no Lifeedy'
                : 'Data especial salva no Lifeedy'),
            start: { date: dateStr },
            end: { date: dateStr },
            calendarSummary:
              item.category === 'birthday'
                ? 'Aniversários'
                : item.category === 'holiday'
                ? 'Feriado local'
                : 'Datas especiais',
            eventCategory: item.category,
            source: 'local_special',
            editable: true,
            recurringYearly: true,
          });
        }
      });
    } else if (/^\d{4}-\d{2}-\d{2}$/.test(item.monthDay)) {
      if (item.monthDay >= minStr && item.monthDay <= maxStr) {
        result.push({
          id: `local-special-${item.id}`,
          specialDateId: item.id,
          summary: item.title,
          description: item.notes || 'Data especial salva no Lifeedy',
          start: { date: item.monthDay },
          end: { date: item.monthDay },
          calendarSummary:
            item.category === 'birthday'
              ? 'Aniversários'
              : item.category === 'holiday'
              ? 'Feriado local'
              : 'Datas especiais',
          eventCategory: item.category,
          source: 'local_special',
          editable: true,
          recurringYearly: false,
        });
      }
    }
  });

  return result;
}

export function normalizeTitle(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function getEventDateKey(ev: GoogleCalendarEvent): string {
  if (ev.start?.date) return ev.start.date.slice(0, 10);
  if (ev.start?.dateTime) return ev.start.dateTime.slice(0, 10);
  return '';
}

function titlesLookEquivalent(a: string, b: string): boolean {
  const na = normalizeTitle(a);
  const nb = normalizeTitle(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  if (na.includes(nb) || nb.includes(na)) return true;

  const stopWords = new Set(['de', 'da', 'do', 'das', 'dos', 'e', 'dia', 'no', 'na', 'brasil', 'brasileiro']);
  const tokensA = na.split(' ').filter((t) => t.length > 2 && !stopWords.has(t));
  const tokensB = nb.split(' ').filter((t) => t.length > 2 && !stopWords.has(t));
  if (tokensA.length === 0 || tokensB.length === 0) return false;

  const overlap = tokensA.filter((t) => tokensB.includes(t));
  return overlap.length >= Math.min(tokensA.length, tokensB.length);
}

/**
 * Merges synced Google Calendar events with offline Brazilian holidays/commemorative dates
 * and user local special dates, avoiding duplicates on the same day.
 */
export function mergeAndDeduplicateCalendarEvents(
  googleEvents: GoogleCalendarEvent[],
  offlineEvents: GoogleCalendarEvent[]
): GoogleCalendarEvent[] {
  const combined: GoogleCalendarEvent[] = [...googleEvents];

  offlineEvents.forEach((offlineEv) => {
    const offlineDate = getEventDateKey(offlineEv);
    const duplicate = combined.some((existing) => {
      if (getEventDateKey(existing) !== offlineDate) return false;
      return titlesLookEquivalent(existing.summary || '', offlineEv.summary || '');
    });
    if (!duplicate) {
      combined.push(offlineEv);
    }
  });

  return combined.sort((a, b) => {
    const aKey = a.start?.dateTime || `${a.start?.date || ''}T00:00:00`;
    const bKey = b.start?.dateTime || `${b.start?.date || ''}T00:00:00`;
    return aKey.localeCompare(bKey);
  });
}
