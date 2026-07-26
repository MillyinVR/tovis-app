// lib/migration/calendarEventTime.ts
//
// WHOSE CLOCK an imported calendar event is expressed in, and how to turn that
// into UTC instants.
//
// iCalendar stamps a time in one of three KINDS, and they do not mean the same
// thing:
//
//   DTSTART;TZID=America/Los_Angeles:20260801T140000   ⎫ an absolute instant
//   DTSTART:20260801T210000Z                           ⎭ (zone pinned by the feed)
//   DTSTART;VALUE=DATE:20260805                        → a CALENDAR DATE
//   DTSTART:20260801T140000                            → a FLOATING wall time
//
// The first kind is already an instant. The other two are not: they are a date /
// wall clock with no zone attached, and RFC 5545 says a floating time "is always
// used in the same local time-zone" as the observer — for us, the pro whose
// calendar this is. `node-ical` has to pick *some* zone to build its `Date`, and
// it picks the HOST's (`new Date(y, m - 1, d, …)`), which on Vercel is UTC. Take
// that `Date` at face value and a Los Angeles pro's all-day "Vacation — closed"
// becomes a block over 17:00 the previous day → 17:00 that day, leaving the last
// seven hours of their day off bookable.
//
// So the parser records the ANCHOR rather than a resolved instant, and this
// module is the only place that resolves one — in the pro's own timezone, using
// the shared primitives (`startOfLocalDayUtc` gets local-day starts right in the
// five zones that move their clocks at midnight; see B6).

import { addDaysToYMD, startOfLocalDayUtc, zonedTimeToUtc } from '@/lib/time'

/** A calendar date with no time-of-day and no zone (`VALUE=DATE`). */
export type CalendarEventDate = {
  year: number
  /** 1-12. */
  month: number
  day: number
}

/** A wall clock with no zone (a floating `DATE-TIME`). */
export type CalendarEventWallClock = CalendarEventDate & {
  hour: number
  minute: number
}

/**
 * How the feed expressed an event's time.
 *
 * Deliberately a discriminated union rather than a pair of `Date`s plus a flag:
 * an unresolved wall time and an instant are not interchangeable, and the type
 * is what stops a caller from treating one as the other.
 */
export type CalendarEventTime =
  /** The feed pinned a zone (`TZID=…` or a trailing `Z`) — already absolute. */
  | { anchor: 'INSTANT'; startUtc: Date; endUtc: Date | null }
  /** `VALUE=DATE`: whole local days. `endDateExclusive` follows DTEND's own
   *  exclusive-end convention; null means "the one day". */
  | {
      anchor: 'LOCAL_DATE'
      startDate: CalendarEventDate
      endDateExclusive: CalendarEventDate | null
    }
  /** A floating `DATE-TIME`: the pro's own wall clock. */
  | {
      anchor: 'LOCAL_WALL'
      start: CalendarEventWallClock
      end: CalendarEventWallClock | null
    }

export type CalendarEventWindow = {
  startUtc: Date
  /** null when the feed gave no usable end — the caller applies its default. */
  endUtc: Date | null
}

/**
 * The event's UTC window, resolved in `timeZone` (the pro's).
 *
 * An INSTANT passes through untouched: the feed already said which moment it
 * meant, and re-interpreting it would be the bug in the other direction.
 */
export function resolveCalendarEventWindow(args: {
  time: CalendarEventTime
  timeZone: string
}): CalendarEventWindow {
  const { time, timeZone } = args

  switch (time.anchor) {
    case 'INSTANT':
      return { startUtc: time.startUtc, endUtc: time.endUtc }

    case 'LOCAL_DATE': {
      const startUtc = startOfLocalDayUtc({ ...time.startDate, timeZone })
      // No DTEND on an all-day event means the single day it names — the whole
      // of it, not a default appointment length. Stepping the calendar day (not
      // +24h) keeps a 23h/25h DST day exact ([[local-day-arithmetic-not-24h]]).
      const endDate =
        time.endDateExclusive ??
        addDaysToYMD(
          time.startDate.year,
          time.startDate.month,
          time.startDate.day,
          1,
        )
      const endUtc = startOfLocalDayUtc({ ...endDate, timeZone })
      return {
        startUtc,
        endUtc: endUtc.getTime() > startUtc.getTime() ? endUtc : null,
      }
    }

    case 'LOCAL_WALL': {
      // Best-effort rather than strict: a floating time is machine-supplied, so
      // there is no human to re-prompt, and refusing would drop the event
      // instead of holding its time. In a DST gap this settles on an adjacent
      // real instant (see `zonedTimeToUtc`'s note) — an hour off at worst,
      // versus not blocking the time at all.
      const startUtc = zonedTimeToUtc({ ...time.start, timeZone })
      const endUtc = time.end ? zonedTimeToUtc({ ...time.end, timeZone }) : null
      return {
        startUtc,
        endUtc:
          endUtc && endUtc.getTime() > startUtc.getTime() ? endUtc : null,
      }
    }
  }
}
