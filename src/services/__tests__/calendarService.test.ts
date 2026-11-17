import { describe, expect, it } from 'vitest';
import { classifyCalendarEvent } from '../calendarService';

describe('calendarService classification', () => {
  it('identifica corretamente feriados, aniversários, datas comemorativas e eventos comuns', () => {
    expect(
      classifyCalendarEvent('Natal', 'pt.brazilian#holiday@group.v.calendar.google.com', 'Feriados')
    ).toBe('holiday');

    expect(
      classifyCalendarEvent(
        'Dia das Mães',
        'pt.brazilian#holiday@group.v.calendar.google.com',
        'Feriados no Brasil'
      )
    ).toBe('commemorative');

    expect(
      classifyCalendarEvent(
        'Maria Silva',
        'addressbook#contacts@group.v.calendar.google.com',
        'Aniversários'
      )
    ).toBe('birthday');

    expect(classifyCalendarEvent('Aniversário do Lucas', 'primary', 'Agenda Principal')).toBe(
      'birthday'
    );

    expect(classifyCalendarEvent('Consulta Médica', 'primary', 'Agenda Principal')).toBe('event');
  });
});
