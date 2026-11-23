import { describe, expect, it } from 'vitest';
import {
  computeEasterSunday,
  expandSpecialDatesToEvents,
  getBrazilianHolidaysAndDatesForYear,
  mergeAndDeduplicateCalendarEvents,
} from '../brazilianHolidaysService';
import { LocalCalendarEvent, LocalSpecialDate } from '../../types';

describe('brazilianHolidaysService', () => {
  it('calcula corretamente Páscoa, Sexta-feira Santa, Carnaval e Corpus Christi em 2026', () => {
    const easter2026 = computeEasterSunday(2026);
    expect(easter2026.getFullYear()).toBe(2026);
    expect(easter2026.getMonth()).toBe(3); // April (0-indexed)
    expect(easter2026.getDate()).toBe(5);

    const events2026 = getBrazilianHolidaysAndDatesForYear(2026);
    const byDate = new Map(events2026.map((e) => [`${e.start.date}::${e.summary}`, e]));

    expect(byDate.has('2026-02-17::Carnaval')).toBe(true);
    expect(byDate.has('2026-04-03::Sexta-feira Santa')).toBe(true);
    expect(byDate.has('2026-06-04::Corpus Christi')).toBe(true);
    expect(byDate.has('2026-11-20::Dia da Consciência Negra')).toBe(true);
  });

  it('expande aniversários recorrentes corretamente inclusive na virada de ano', () => {
    const specialDates: LocalSpecialDate[] = [
      {
        id: 'sp-bday',
        title: 'Aniversário do João',
        monthDay: '01-10',
        category: 'birthday',
        recurringYearly: true,
        createdAt: '2026-11-17T08:00:00.000Z',
      },
    ];

    const expanded = expandSpecialDatesToEvents(
      specialDates,
      new Date(2026, 10, 15, 12, 0, 0),
      new Date(2027, 1, 15, 12, 0, 0)
    );

    expect(expanded).toHaveLength(1);
    expect(expanded[0].start.date).toBe('2027-01-10');
    expect(expanded[0].eventCategory).toBe('birthday');
    expect(expanded[0].source).toBe('local_special');
  });

  it('mescla eventos locais sem duplicar feriados iguais na mesma data', () => {
    const localEvents: LocalCalendarEvent[] = [
      {
        id: 'local-hol-1',
        summary: 'Dia Nacional de Zumbi e da Consciência Negra',
        start: { date: '2026-11-20' },
        end: { date: '2026-11-20' },
        eventCategory: 'holiday',
        source: 'local',
      },
      {
        id: 'local-meeting',
        summary: 'Reunião de alinhamento',
        start: { dateTime: '2026-11-20T14:00:00-03:00' },
        end: { dateTime: '2026-11-20T15:00:00-03:00' },
        eventCategory: 'event',
        source: 'local',
      },
    ];

    const offline = getBrazilianHolidaysAndDatesForYear(2026).filter(
      (e) => e.start.date === '2026-11-20' || e.start.date === '2026-12-25'
    );

    const merged = mergeAndDeduplicateCalendarEvents(localEvents, offline);
    const nov20Holidays = merged.filter(
      (e) => e.start.date === '2026-11-20' && e.eventCategory === 'holiday'
    );
    const dec25Holidays = merged.filter((e) => e.start.date === '2026-12-25');

    expect(nov20Holidays).toHaveLength(1);
    expect(nov20Holidays[0].id).toBe('local-hol-1');
    expect(dec25Holidays).toHaveLength(1);
    expect(dec25Holidays[0].summary).toBe('Natal');
  });
});
