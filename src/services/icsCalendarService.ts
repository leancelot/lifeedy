import { LocalCalendarEvent } from '../types';

export interface IcsImportResult {
  events: LocalCalendarEvent[];
  skippedCount: number;
}

export interface IcsDeduplicationResult {
  merged: LocalCalendarEvent[];
  addedCount: number;
  duplicateCount: number;
}

function unfoldIcsLines(rawText: string): string[] {
  const normalized = rawText.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const rawLines = normalized.split('\n');
  const unfolded: string[] = [];

  for (const line of rawLines) {
    if ((line.startsWith(' ') || line.startsWith('\t')) && unfolded.length > 0) {
      unfolded[unfolded.length - 1] += line.slice(1);
    } else {
      unfolded.push(line);
    }
  }
  return unfolded;
}

function unescapeIcsText(value: string): string {
  return value
    .replace(/\\n/gi, '\n')
    .replace(/\\,/g, ',')
    .replace(/\\;/g, ';')
    .replace(/\\\\/g, '\\')
    .trim();
}

function escapeIcsText(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/\r?\n/g, '\\n')
    .replace(/,/g, '\\,')
    .replace(/;/g, '\\;');
}

function parseIcsDateValue(rawVal: string, paramsStr: string): { date?: string; dateTime?: string } | null {
  const val = rawVal.trim();
  const isValueDate = /VALUE=DATE\b/i.test(paramsStr) || /^\d{8}$/.test(val);

  if (isValueDate) {
    const match = val.match(/^(\d{4})(\d{2})(\d{2})$/);
    if (!match) return null;
    return { date: `${match[1]}-${match[2]}-${match[3]}` };
  }

  const dtMatch = val.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z)?$/i);
  if (!dtMatch) return null;

  const [, y, m, d, hh, mm, ss, z] = dtMatch;
  if (z) {
    const utcDate = new Date(
      Date.UTC(Number(y), Number(m) - 1, Number(d), Number(hh), Number(mm), Number(ss))
    );
    if (Number.isNaN(utcDate.getTime())) return null;
    return { dateTime: utcDate.toISOString() };
  }

  const localDate = new Date(
    Number(y),
    Number(m) - 1,
    Number(d),
    Number(hh),
    Number(mm),
    Number(ss)
  );
  if (Number.isNaN(localDate.getTime())) return null;
  return { dateTime: localDate.toISOString() };
}

function addDaysToIsoDate(isoDate: string, days: number): string {
  const match = isoDate.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return isoDate;
  const d = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12, 0, 0);
  d.setDate(d.getDate() + days);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function parseIcsToLocalEvents(rawIcs: string): IcsImportResult {
  if (typeof rawIcs !== 'string' || !rawIcs.trim()) {
    return { events: [], skippedCount: 0 };
  }

  const lines = unfoldIcsLines(rawIcs);
  const events: LocalCalendarEvent[] = [];
  let skippedCount = 0;

  let insideEvent = false;
  let current: {
    uid?: string;
    summary?: string;
    description?: string;
    location?: string;
    start?: { date?: string; dateTime?: string };
    end?: { date?: string; dateTime?: string };
    status?: string;
  } | null = null;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    if (trimmed.toUpperCase() === 'BEGIN:VEVENT') {
      insideEvent = true;
      current = {};
      continue;
    }

    if (trimmed.toUpperCase() === 'END:VEVENT') {
      if (insideEvent && current) {
        if (current.summary && (current.start?.date || current.start?.dateTime)) {
          let normalizedEnd: { date?: string; dateTime?: string };
          if (!current.end) {
            if (current.start.date) {
              normalizedEnd = { date: current.start.date };
            } else {
              const startMs = new Date(current.start.dateTime!).getTime();
              normalizedEnd = {
                dateTime: new Date(startMs + 60 * 60 * 1000).toISOString(),
              };
            }
          } else if (current.start.date && current.end.date && current.end.date > current.start.date) {
            // RFC 5545 all-day DTEND is exclusive; normalize inclusive day if it's strictly 1+ days after
            const inclusiveEnd = addDaysToIsoDate(current.end.date, -1);
            normalizedEnd = { date: inclusiveEnd >= current.start.date ? inclusiveEnd : current.start.date };
          } else {
            normalizedEnd = current.end;
          }

          const uid = current.uid?.trim() || undefined;
          const idSeed = uid || `${current.start.date || current.start.dateTime}-${current.summary}`;
          events.push({
            id: `ics-${idSeed.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64)}-${events.length}`,
            summary: current.summary,
            description: current.description || undefined,
            location: current.location || undefined,
            start: current.start,
            end: normalizedEnd,
            status: current.status?.toLowerCase() === 'cancelled' ? 'cancelled' : 'confirmed',
            calendarSummary: 'Importado (.ics)',
            eventCategory: 'event',
            source: 'ics_import',
            editable: true,
            externalUid: uid,
          });
        } else {
          skippedCount += 1;
        }
      }
      insideEvent = false;
      current = null;
      continue;
    }

    if (!insideEvent || !current) continue;

    const colonIdx = line.indexOf(':');
    if (colonIdx <= 0) continue;

    const propPart = line.slice(0, colonIdx);
    const valuePart = line.slice(colonIdx + 1);
    const [rawPropName, ...paramParts] = propPart.split(';');
    const propName = rawPropName.trim().toUpperCase();
    const paramsStr = paramParts.join(';');

    switch (propName) {
      case 'UID':
        current.uid = valuePart.trim();
        break;
      case 'SUMMARY':
        current.summary = unescapeIcsText(valuePart);
        break;
      case 'DESCRIPTION':
        current.description = unescapeIcsText(valuePart);
        break;
      case 'LOCATION':
        current.location = unescapeIcsText(valuePart);
        break;
      case 'STATUS':
        current.status = valuePart.trim();
        break;
      case 'DTSTART': {
        const parsed = parseIcsDateValue(valuePart, paramsStr);
        if (parsed) current.start = parsed;
        break;
      }
      case 'DTEND': {
        const parsed = parseIcsDateValue(valuePart, paramsStr);
        if (parsed) current.end = parsed;
        break;
      }
      default:
        break;
    }
  }

  return { events, skippedCount };
}

function normalizeMatchKey(ev: LocalCalendarEvent): string {
  const dateKey = ev.start.date || ev.start.dateTime?.slice(0, 16) || '';
  const summaryKey = (ev.summary || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();
  return `${dateKey}::${summaryKey}`;
}

export function deduplicateImportedIcsEvents(
  existing: LocalCalendarEvent[],
  incoming: LocalCalendarEvent[]
): IcsDeduplicationResult {
  const existingUids = new Set(
    existing.map((e) => e.externalUid?.trim()).filter((u): u is string => Boolean(u))
  );
  const existingKeys = new Set(existing.map(normalizeMatchKey));

  const added: LocalCalendarEvent[] = [];
  let duplicateCount = 0;

  for (const ev of incoming) {
    if (ev.status === 'cancelled') continue;
    const uid = ev.externalUid?.trim();
    const matchKey = normalizeMatchKey(ev);

    if ((uid && existingUids.has(uid)) || existingKeys.has(matchKey)) {
      duplicateCount += 1;
      continue;
    }

    if (uid) existingUids.add(uid);
    existingKeys.add(matchKey);
    added.push(ev);
  }

  return {
    merged: [...added, ...existing],
    addedCount: added.length,
    duplicateCount,
  };
}

function toIcsUtcTimestamp(isoStr: string): string {
  const d = new Date(isoStr);
  if (Number.isNaN(d.getTime())) {
    return toIcsUtcTimestamp(new Date().toISOString());
  }
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    `${d.getUTCFullYear()}` +
    `${pad(d.getUTCMonth() + 1)}` +
    `${pad(d.getUTCDate())}T` +
    `${pad(d.getUTCHours())}` +
    `${pad(d.getUTCMinutes())}` +
    `${pad(d.getUTCSeconds())}Z`
  );
}

function toIcsCompactDate(isoDate: string): string {
  return isoDate.slice(0, 10).replace(/-/g, '');
}

export function exportLocalEventsToIcs(events: LocalCalendarEvent[]): string {
  const exportable = events.filter(
    (ev) => ev.source === 'local' || ev.source === 'ics_import' || !ev.source
  );
  const dtStamp = toIcsUtcTimestamp(new Date().toISOString());

  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Lifeedy//Agenda Local//PT-BR',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
  ];

  for (const ev of exportable) {
    const uid = ev.externalUid || `${ev.id}@lifeedy.local`;
    lines.push('BEGIN:VEVENT');
    lines.push(`UID:${uid}`);
    lines.push(`DTSTAMP:${dtStamp}`);

    if (ev.start.date) {
      const startCompact = toIcsCompactDate(ev.start.date);
      const endDateBase = ev.end?.date || ev.start.date;
      const exclusiveEnd = toIcsCompactDate(addDaysToIsoDate(endDateBase, 1));
      lines.push(`DTSTART;VALUE=DATE:${startCompact}`);
      lines.push(`DTEND;VALUE=DATE:${exclusiveEnd}`);
    } else if (ev.start.dateTime) {
      lines.push(`DTSTART:${toIcsUtcTimestamp(ev.start.dateTime)}`);
      const endIso =
        ev.end?.dateTime ||
        new Date(new Date(ev.start.dateTime).getTime() + 60 * 60 * 1000).toISOString();
      lines.push(`DTEND:${toIcsUtcTimestamp(endIso)}`);
    }

    lines.push(`SUMMARY:${escapeIcsText(ev.summary || 'Compromisso')}`);
    if (ev.description) {
      lines.push(`DESCRIPTION:${escapeIcsText(ev.description)}`);
    }
    if (ev.location) {
      lines.push(`LOCATION:${escapeIcsText(ev.location)}`);
    }
    lines.push('STATUS:CONFIRMED');
    lines.push('END:VEVENT');
  }

  lines.push('END:VCALENDAR');
  return `${lines.join('\r\n')}\r\n`;
}
