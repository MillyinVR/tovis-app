// lib/migration/calendarImport.ts
//
// Parse a competitor calendar export (.ics / iCalendar text) into normalized
// events. Pure + server-only (node-ical has no React/Prisma deps but is a Node
// module) — the preview/commit server builds on the normalized shape, and the
// client uploads raw .ics text rather than parsing in the browser.
//
// We deliberately keep only the fields the import needs: a stable UID (for
// idempotency), the time window, the title text (matched to a service), and the
// attendee (resolved to a client). Recurring events are flagged, not expanded —
// salon exports are overwhelmingly concrete single appointments.
//
// The time is recorded as an ANCHOR, not as a resolved instant: an all-day or
// floating stamp carries no zone, and `node-ical` builds its `Date` from the
// HOST's clock (UTC on Vercel). See `calendarEventTime.ts` — the pro's timezone
// is what those stamps actually mean, and resolving them is that module's job.

import ical from 'node-ical'

import { isRecord } from '@/lib/guards'

import type {
  CalendarEventDate,
  CalendarEventTime,
  CalendarEventWallClock,
} from './calendarEventTime'

export type NormalizedCalendarEvent = {
  uid: string
  time: CalendarEventTime
  summary: string
  attendeeName: string | null
  attendeeEmail: string | null
  isRecurring: boolean
}

// node-ical surfaces text fields as either a bare string or { val, params }.
function readText(value: unknown): string {
  if (typeof value === 'string') return value.trim()
  if (
    value !== null &&
    typeof value === 'object' &&
    'val' in value &&
    typeof (value as { val: unknown }).val === 'string'
  ) {
    return (value as { val: string }).val.trim()
  }
  return ''
}

// Keeps the caller's type (node-ical's `DateWithTimeZone`, which carries the
// `tz` / `dateOnly` markers) instead of widening to `Date` the way a
// `value is Date` predicate would.
function validDate<T extends Date>(value: T | null | undefined): T | null {
  return value instanceof Date && Number.isFinite(value.getTime())
    ? value
    : null
}

// One attendee → { name, email }. node-ical gives `string | { val, params:{CN} }`
// where val is typically a `mailto:` URI.
function readAttendee(
  attendee: unknown,
): { name: string | null; email: string | null } {
  let raw = ''
  let cn: string | null = null

  if (typeof attendee === 'string') {
    raw = attendee
  } else if (isRecord(attendee)) {
    if (typeof attendee.val === 'string') raw = attendee.val
    const params = attendee.params
    if (isRecord(params) && typeof params.CN === 'string' && params.CN.trim()) {
      cn = params.CN.trim()
    }
  }

  const email = raw.replace(/^mailto:/i, '').trim()
  return {
    name: cn,
    email: email.includes('@') ? email : null,
  }
}

function firstAttendee(
  attendee: unknown,
): { name: string | null; email: string | null } {
  if (Array.isArray(attendee)) {
    for (const entry of attendee) {
      const resolved = readAttendee(entry)
      if (resolved.name || resolved.email) return resolved // pii-plaintext-read-ok: parsed from uploaded calendar file, not stored PII
    }
    return { name: null, email: null }
  }
  return readAttendee(attendee)
}

// node-ical builds an unzoned stamp from the HOST's local components
// (`new Date(y, m - 1, d, h, min)`), so reading them back with the host-local
// getters is what recovers the wall clock the feed actually wrote. This is the
// one place a raw `getHours()` is the CORRECT reading rather than a timezone
// leak — everywhere downstream the value travels as parts plus an anchor, and
// only `resolveCalendarEventWindow` turns it into an instant.
function toWallClock(value: Date): CalendarEventWallClock {
  return {
    year: value.getFullYear(),
    month: value.getMonth() + 1,
    day: value.getDate(),
    hour: value.getHours(),
    minute: value.getMinutes(),
  }
}

function toCalendarDate(value: Date): CalendarEventDate {
  return {
    year: value.getFullYear(),
    month: value.getMonth() + 1,
    day: value.getDate(),
  }
}

function isDateOnly(value: Date): boolean {
  return isRecord(value) && value.dateOnly === true
}

// Set by node-ical only when the feed pinned a zone: `Etc/UTC` for a trailing
// `Z`, the TZID (or the offset resolved from the VTIMEZONE) otherwise. Absent
// means the stamp was floating.
function pinnedZone(value: Date): string | null {
  if (!isRecord(value)) return null
  const tz = value.tz
  return typeof tz === 'string' && tz.trim() ? tz.trim() : null
}

// Which clock this event's stamps are in. `null` when there is no usable start.
function readEventTime(event: ical.VEvent): CalendarEventTime | null {
  const start = validDate(event.start)
  if (!start) return null

  // node-ical defaults a missing DTEND to DTSTART; treat a non-positive
  // duration as "no end" so callers can apply a sensible default.
  const rawEnd = validDate(event.end)
  const end = rawEnd && rawEnd.getTime() > start.getTime() ? rawEnd : null

  if (isDateOnly(start)) {
    return {
      anchor: 'LOCAL_DATE',
      startDate: toCalendarDate(start),
      // A DATE-TIME DTEND on a DATE DTSTART is malformed; ignore it rather than
      // mixing anchors, and let the resolver default to the single whole day.
      endDateExclusive: end && isDateOnly(end) ? toCalendarDate(end) : null,
    }
  }

  if (pinnedZone(start)) {
    return {
      anchor: 'INSTANT',
      startUtc: new Date(start.getTime()),
      // An end the feed left floating cannot be mixed with a pinned start.
      endUtc: end && pinnedZone(end) ? new Date(end.getTime()) : null,
    }
  }

  return {
    anchor: 'LOCAL_WALL',
    start: toWallClock(start),
    end: end && !pinnedZone(end) && !isDateOnly(end) ? toWallClock(end) : null,
  }
}

// Parse raw iCalendar text into normalized events. Invalid/incomplete events
// (no UID or no start) are skipped rather than throwing, so one bad row never
// fails the whole import.
export function parseCalendarFeed(icsText: string): NormalizedCalendarEvent[] {
  if (typeof icsText !== 'string' || !icsText.trim()) return []

  let parsed: ReturnType<typeof ical.sync.parseICS>
  try {
    parsed = ical.sync.parseICS(icsText)
  } catch {
    return []
  }

  const events: NormalizedCalendarEvent[] = []
  for (const component of Object.values(parsed)) {
    if (!component || component.type !== 'VEVENT') continue

    const uid = readText(component.uid)
    if (!uid) continue

    const time = readEventTime(component)
    if (!time) continue

    const attendee = firstAttendee(component.attendee)
    events.push({
      uid,
      time,
      summary: readText(component.summary),
      attendeeName: attendee.name,
      attendeeEmail: attendee.email,
      isRecurring: component.rrule != null,
    })
  }

  return events
}
