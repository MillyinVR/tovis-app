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

import ical from 'node-ical'

export type NormalizedCalendarEvent = {
  uid: string
  start: Date
  end: Date | null
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

function isValidDate(value: unknown): value is Date {
  return value instanceof Date && Number.isFinite(value.getTime())
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
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
    if (!uid || !isValidDate(component.start)) continue

    // node-ical defaults a missing DTEND to DTSTART; treat a non-positive
    // duration as "no end" so callers can apply a sensible default.
    const start = new Date(component.start.getTime())
    const end =
      isValidDate(component.end) && component.end.getTime() > start.getTime()
        ? new Date(component.end.getTime())
        : null

    const attendee = firstAttendee(component.attendee)
    events.push({
      uid,
      start,
      end,
      summary: readText(component.summary),
      attendeeName: attendee.name,
      attendeeEmail: attendee.email,
      isRecurring: component.rrule != null,
    })
  }

  return events
}
