import { describe, expect, it } from 'vitest';
import {
  deduplicateImportedIcsEvents,
  exportLocalEventsToIcs,
  parseIcsToLocalEvents,
} from '../icsCalendarService';
import { LocalCalendarEvent } from '../../types';

describe('icsCalendarService', () => {
  it('interpreta eventos de dia inteiro (com DTEND exclusivo RFC 5545), eventos com hora e linhas dobradas', () => {
    const sampleIcs = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'BEGIN:VEVENT',
      'UID:uid-all-day-1@example.com',
      'DTSTART;VALUE=DATE:20261224',
      'DTEND;VALUE=DATE:20261225',
      'SUMMARY:Véspera de Natal\\, em família',
      'DESCRIPTION:Preparar ceia\\nConfirmar convidados',
      'LOCATION:Casa dos Pais',
      'END:VEVENT',
      'BEGIN:VEVENT',
      'UID:uid-timed-2@example.com',
      'DTSTART:20261128T150000Z',
      'DTEND:20261128T163000Z',
      'SUMMARY:Revisão do projeto com ',
      ' continuação na segunda linha',
      'END:VEVENT',
      'BEGIN:VEVENT',
      'UID:uid-invalid-no-summary@example.com',
      'DTSTART:20261129T100000Z',
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\r\n');

    const result = parseIcsToLocalEvents(sampleIcs);
    expect(result.skippedCount).toBe(1);
    expect(result.events).toHaveLength(2);

    const [allDay, timed] = result.events;
    expect(allDay.start).toEqual({ date: '2026-12-24' });
    expect(allDay.end).toEqual({ date: '2026-12-24' });
    expect(allDay.summary).toBe('Véspera de Natal, em família');
    expect(allDay.description).toBe('Preparar ceia\nConfirmar convidados');
    expect(allDay.location).toBe('Casa dos Pais');
    expect(allDay.source).toBe('ics_import');
    expect(allDay.externalUid).toBe('uid-all-day-1@example.com');

    expect(timed.summary).toBe('Revisão do projeto com continuação na segunda linha');
    expect(timed.start.dateTime).toBe('2026-11-28T15:00:00.000Z');
    expect(timed.end?.dateTime).toBe('2026-11-28T16:30:00.000Z');
  });

  it('deduplica eventos repetidos por UID ou data+título e ignora cancelados', () => {
    const existing: LocalCalendarEvent[] = [
      {
        id: 'local-1',
        summary: 'Reunião Semanal',
        start: { dateTime: '2026-11-28T15:00:00.000Z' },
        end: { dateTime: '2026-11-28T16:00:00.000Z' },
        source: 'local',
        externalUid: 'uid-existing-1',
      },
    ];

    const incoming: LocalCalendarEvent[] = [
      {
        id: 'imp-1',
        summary: 'Reunião Semanal',
        start: { dateTime: '2026-11-28T15:00:00.000Z' },
        end: { dateTime: '2026-11-28T16:00:00.000Z' },
        source: 'ics_import',
        externalUid: 'uid-existing-1',
      },
      {
        id: 'imp-2',
        summary: 'Reuniao Semanal',
        start: { dateTime: '2026-11-28T15:00:00.000Z' },
        end: { dateTime: '2026-11-28T16:00:00.000Z' },
        source: 'ics_import',
      },
      {
        id: 'imp-3',
        summary: 'Evento cancelado',
        start: { date: '2026-11-30' },
        end: { date: '2026-11-30' },
        status: 'cancelled',
        source: 'ics_import',
      },
      {
        id: 'imp-4',
        summary: 'Consulta Odontológica',
        start: { date: '2026-12-03' },
        end: { date: '2026-12-03' },
        source: 'ics_import',
        externalUid: 'uid-new-4',
      },
    ];

    const deduped = deduplicateImportedIcsEvents(existing, incoming);
    expect(deduped.addedCount).toBe(1);
    expect(deduped.duplicateCount).toBe(2);
    expect(deduped.merged).toHaveLength(2);
    expect(deduped.merged[0].summary).toBe('Consulta Odontológica');
  });

  it('exporta compromissos locais em formato .ics válido e reimporta com fidelidade', () => {
    const events: LocalCalendarEvent[] = [
      {
        id: 'ev-local-1',
        summary: 'Almoço, Equipe',
        description: 'Confirmar sala; levar notebook',
        location: 'Centro',
        start: { date: '2026-12-10' },
        end: { date: '2026-12-10' },
        source: 'local',
      },
      {
        id: 'ev-holiday-ignored',
        summary: 'Natal',
        start: { date: '2026-12-25' },
        end: { date: '2026-12-25' },
        source: 'brazil_holiday',
        eventCategory: 'holiday',
      },
    ];

    const icsText = exportLocalEventsToIcs(events);
    expect(icsText).toContain('BEGIN:VCALENDAR');
    expect(icsText).toContain('DTSTART;VALUE=DATE:20261210');
    expect(icsText).toContain('DTEND;VALUE=DATE:20261211');
    expect(icsText).not.toContain('Natal');

    const reparsed = parseIcsToLocalEvents(icsText);
    expect(reparsed.events).toHaveLength(1);
    expect(reparsed.events[0].summary).toBe('Almoço, Equipe');
    expect(reparsed.events[0].description).toBe('Confirmar sala; levar notebook');
    expect(reparsed.events[0].start).toEqual({ date: '2026-12-10' });
    expect(reparsed.events[0].end).toEqual({ date: '2026-12-10' });
  });
});
