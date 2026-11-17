import { CalendarEventCategory, GoogleCalendarEvent } from '../types';
import { WorkspaceAuthError } from './googleAuthError';

interface GoogleCalendarListEntry {
  id: string;
  summary?: string;
  primary?: boolean;
  selected?: boolean;
  accessRole?: 'freeBusyReader' | 'reader' | 'writer' | 'owner';
}

export function classifyCalendarEvent(
  summary: string,
  calendarId?: string,
  calendarSummary?: string,
  description?: string
): CalendarEventCategory {
  const calIdLower = (calendarId || '').toLowerCase();
  const calNameLower = (calendarSummary || '').toLowerCase();
  const textLower = `${summary || ''} ${description || ''}`.toLowerCase();

  if (
    calIdLower.includes('#contacts@group.v.calendar.google.com') ||
    calNameLower.includes('anivers') ||
    calNameLower.includes('birthday') ||
    textLower.includes('aniversário') ||
    textLower.includes('aniversario') ||
    textLower.includes('birthday') ||
    textLower.includes('niver')
  ) {
    return 'birthday';
  }

  if (
    calIdLower.includes('#holiday@group.v.calendar.google.com') ||
    calNameLower.includes('feriado') ||
    calNameLower.includes('holiday') ||
    textLower.includes('feriado')
  ) {
    if (
      textLower.includes('comemorativ') ||
      textLower.includes('dia das mães') ||
      textLower.includes('dia dos pais') ||
      textLower.includes('namorados') ||
      textLower.includes('professor') ||
      textLower.includes('mulher') ||
      textLower.includes('páscoa')
    ) {
      return 'commemorative';
    }
    return 'holiday';
  }

  if (
    textLower.includes('data comemorativa') ||
    textLower.includes('dia das mães') ||
    textLower.includes('dia dos pais') ||
    textLower.includes('dia dos namorados')
  ) {
    return 'commemorative';
  }

  return 'event';
}

async function fetchUserCalendarList(accessToken: string): Promise<GoogleCalendarListEntry[]> {
  const url =
    'https://www.googleapis.com/calendar/v3/users/me/calendarList?minAccessRole=reader&showHidden=false';

  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (res.status === 401) {
    throw new WorkspaceAuthError('Sessão da Google Agenda expirada. Conecte sua conta novamente.');
  }

  if (!res.ok) {
    return [{ id: 'primary', summary: 'Agenda Principal', primary: true, accessRole: 'owner' }];
  }

  const data = await res.json();
  const items = Array.isArray(data.items) ? (data.items as GoogleCalendarListEntry[]) : [];
  const filtered = items.filter((cal) => cal.id && cal.selected !== false);
  return filtered.length > 0
    ? filtered
    : [{ id: 'primary', summary: 'Agenda Principal', primary: true, accessRole: 'owner' }];
}

async function fetchEventsForCalendar(
  accessToken: string,
  calendar: GoogleCalendarListEntry,
  timeMin: string,
  timeMax: string
): Promise<GoogleCalendarEvent[]> {
  const encodedId = encodeURIComponent(calendar.id);
  const url = `https://www.googleapis.com/calendar/v3/calendars/${encodedId}/events?timeMin=${encodeURIComponent(
    timeMin
  )}&timeMax=${encodeURIComponent(timeMax)}&singleEvents=true&orderBy=startTime&maxResults=150`;

  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (res.status === 401) {
    throw new WorkspaceAuthError('Sessão da Google Agenda expirada. Conecte sua conta novamente.');
  }

  if (!res.ok) {
    return [];
  }

  const data = await res.json();
  const items = Array.isArray(data.items) ? (data.items as any[]) : [];
  const isEditable =
    calendar.primary === true ||
    calendar.accessRole === 'owner' ||
    calendar.accessRole === 'writer';

  return items
    .filter((item) => item && item.status !== 'cancelled')
    .map((item) => ({
      ...(item as GoogleCalendarEvent),
      calendarId: calendar.id,
      calendarSummary: calendar.primary ? 'Google Agenda' : calendar.summary || 'Google Agenda',
      eventCategory: classifyCalendarEvent(
        item.summary || '',
        calendar.id,
        calendar.summary,
        item.description
      ),
      source: 'google' as const,
      editable: isEditable,
    }));
}

/**
 * Lists events across all subscribed Google Calendars (primary, secondary, holidays, birthdays).
 */
export async function listCalendarEvents(
  accessToken: string,
  timeMin?: string,
  timeMax?: string
): Promise<GoogleCalendarEvent[]> {
  const min = timeMin || new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const max = timeMax || new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString();

  const calendars = await fetchUserCalendarList(accessToken);

  // Ensure Brazilian Google Holidays feed is also checked if not already in user's subscribed list
  const hasHolidayCal = calendars.some((c) =>
    c.id.toLowerCase().includes('#holiday@group.v.calendar.google.com')
  );
  const targetCalendars: GoogleCalendarListEntry[] = hasHolidayCal
    ? calendars
    : [
        ...calendars,
        {
          id: 'pt.brazilian#holiday@group.v.calendar.google.com',
          summary: 'Feriados no Brasil',
          accessRole: 'reader',
        },
      ];

  const results = await Promise.allSettled(
    targetCalendars.map((cal) => fetchEventsForCalendar(accessToken, cal, min, max))
  );

  // Propagate 401 auth errors if any calendar query rejected with WorkspaceAuthError
  for (const r of results) {
    if (r.status === 'rejected' && r.reason instanceof WorkspaceAuthError) {
      throw r.reason;
    }
  }

  const seen = new Set<string>();
  const allEvents: GoogleCalendarEvent[] = [];

  results.forEach((r) => {
    if (r.status !== 'fulfilled') return;
    r.value.forEach((ev) => {
      const startKey = ev.start?.dateTime || ev.start?.date || '';
      const dedupeKey = `${ev.calendarId || 'primary'}::${ev.id}::${startKey}`;
      if (!seen.has(dedupeKey)) {
        seen.add(dedupeKey);
        allEvents.push(ev);
      }
    });
  });

  return allEvents.sort((a, b) => {
    const aKey = a.start?.dateTime || `${a.start?.date || ''}T00:00:00`;
    const bKey = b.start?.dateTime || `${b.start?.date || ''}T00:00:00`;
    return aKey.localeCompare(bKey);
  });
}

/**
 * Creates an event in user's primary Google Calendar
 */
export async function createCalendarEvent(
  accessToken: string,
  event: {
    summary: string;
    description?: string;
    location?: string;
    startDateTime: string; // ISO String or YYYY-MM-DDTHH:mm:00
    endDateTime: string; // ISO String or YYYY-MM-DDTHH:mm:00
    allDay?: boolean;
    date?: string; // YYYY-MM-DD if all day
    calendarId?: string;
  }
): Promise<GoogleCalendarEvent> {
  const calendarId = encodeURIComponent(event.calendarId || 'primary');
  const url = `https://www.googleapis.com/calendar/v3/calendars/${calendarId}/events`;

  const body: any = {
    summary: event.summary,
    description: event.description || 'Criado via aplicativo Lifeedy',
    location: event.location,
  };

  if (event.allDay && event.date) {
    body.start = { date: event.date };
    body.end = { date: event.date };
  } else {
    body.start = { dateTime: event.startDateTime };
    body.end = { dateTime: event.endDateTime };
  }

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (res.status === 401) {
    throw new WorkspaceAuthError('Sessão da Google Agenda expirada. Conecte sua conta novamente.');
  }

  if (!res.ok) {
    const errorText = await res.text();
    console.warn('Falha ao criar evento na agenda:', res.status, errorText);
    throw new Error(`Falha ao criar evento na Google Agenda (${res.status})`);
  }

  const created = (await res.json()) as GoogleCalendarEvent;
  return {
    ...created,
    calendarId: event.calendarId || 'primary',
    calendarSummary: 'Google Agenda',
    eventCategory: classifyCalendarEvent(created.summary || '', event.calendarId || 'primary'),
    source: 'google',
    editable: true,
  };
}

/**
 * Updates an event in Google Calendar (Requires User Confirmation in UI before calling)
 */
export async function updateCalendarEvent(
  accessToken: string,
  eventId: string,
  event: {
    summary: string;
    description?: string;
    location?: string;
    startDateTime: string;
    endDateTime: string;
    allDay?: boolean;
    date?: string;
    calendarId?: string;
  }
): Promise<GoogleCalendarEvent> {
  const calendarId = encodeURIComponent(event.calendarId || 'primary');
  const url = `https://www.googleapis.com/calendar/v3/calendars/${calendarId}/events/${encodeURIComponent(
    eventId
  )}`;

  const body: any = {
    summary: event.summary,
    description: event.description,
    location: event.location,
  };

  if (event.allDay && event.date) {
    body.start = { date: event.date };
    body.end = { date: event.date };
  } else {
    body.start = { dateTime: event.startDateTime };
    body.end = { dateTime: event.endDateTime };
  }

  const res = await fetch(url, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (res.status === 401) {
    throw new WorkspaceAuthError('Sessão da Google Agenda expirada. Conecte sua conta novamente.');
  }

  if (!res.ok) {
    throw new Error(`Falha ao atualizar evento na Google Agenda (${res.status})`);
  }

  const updated = (await res.json()) as GoogleCalendarEvent;
  return {
    ...updated,
    calendarId: event.calendarId || 'primary',
    calendarSummary: 'Google Agenda',
    eventCategory: classifyCalendarEvent(updated.summary || '', event.calendarId || 'primary'),
    source: 'google',
    editable: true,
  };
}

/**
 * Deletes an event in Google Calendar (Requires User Confirmation in UI before calling)
 */
export async function deleteCalendarEvent(
  accessToken: string,
  eventId: string,
  calendarId = 'primary'
): Promise<void> {
  const encodedCal = encodeURIComponent(calendarId);
  const url = `https://www.googleapis.com/calendar/v3/calendars/${encodedCal}/events/${encodeURIComponent(
    eventId
  )}`;

  const res = await fetch(url, {
    method: 'DELETE',
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (res.status === 401) {
    throw new WorkspaceAuthError('Sessão da Google Agenda expirada. Conecte sua conta novamente.');
  }

  if (!res.ok && res.status !== 404) {
    throw new Error(`Falha ao excluir evento da Google Agenda (${res.status})`);
  }
}
