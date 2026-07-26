// lib/migration/calendarEventTime.test.ts
//
// Every expected instant here was derived from ICU (a scratch script that binary
// -searches the local-day boundary and fixed-points the wall clock), not from
// memory — a remembered DST date is exactly the kind of "plausible" number B8's
// prod query got wrong.
//
// This module is new, so there is no pre-fix version to A/B against; it was
// proven instead by MUTATION (B8 §16.8) — each decision it encodes inverted in
// turn, with the case that catches it named beside the decision:
//
//   1. LOCAL_DATE resolved with the host clock instead of the pro's
//        → "an all-day event is the pro's whole local day" (all three zones)
//   2. the missing-DTEND default set to DEFAULT_BLOCK_MINUTES instead of +1 day
//        → "an all-day event with no DTEND is the whole day"
//   3. `addDaysToYMD(…, 1)` replaced by `+24h`
//        → the 23h and 25h DST cases
//   4. `startOfLocalDayUtc` replaced by `zonedTimeToUtc(…, hour: 0)`
//        → "a zone that moves its clock AT midnight"
//   5. INSTANT re-interpreted in the pro's zone instead of passed through
//        → "a zoned stamp is left exactly as the feed pinned it"

import { describe, expect, it } from 'vitest'

import { resolveCalendarEventWindow } from './calendarEventTime'

const LA = 'America/Los_Angeles'
const BERLIN = 'Europe/Berlin'
const AUCKLAND = 'Pacific/Auckland'
const SANTIAGO = 'America/Santiago'

function allDay(
  startDate: { year: number; month: number; day: number },
  endDateExclusive: { year: number; month: number; day: number } | null = null,
) {
  return { anchor: 'LOCAL_DATE' as const, startDate, endDateExclusive }
}

describe('resolveCalendarEventWindow — LOCAL_DATE (all-day)', () => {
  // The B9 defect: node-ical anchors `VALUE=DATE` to the HOST's midnight (UTC on
  // Vercel), so a Los Angeles pro's day off ran 17:00 the previous day → 17:00,
  // leaving the last seven hours of it bookable.
  it('is the pro’s whole local day, in the pro’s zone — not the host’s', () => {
    const time = allDay({ year: 2026, month: 8, day: 5 }, { year: 2026, month: 8, day: 6 })

    expect(
      resolveCalendarEventWindow({ time, timeZone: LA }),
    ).toEqual({
      startUtc: new Date('2026-08-05T07:00:00.000Z'),
      endUtc: new Date('2026-08-06T07:00:00.000Z'),
    })

    expect(
      resolveCalendarEventWindow({ time, timeZone: BERLIN }),
    ).toEqual({
      startUtc: new Date('2026-08-04T22:00:00.000Z'),
      endUtc: new Date('2026-08-05T22:00:00.000Z'),
    })

    // Three zones on purpose: a single zone lets a host that happens to share it
    // pass by accident ([[your-machine-already-satisfies-the-condition]]).
    expect(
      resolveCalendarEventWindow({ time, timeZone: AUCKLAND }),
    ).toEqual({
      startUtc: new Date('2026-08-04T12:00:00.000Z'),
      endUtc: new Date('2026-08-05T12:00:00.000Z'),
    })
  })

  it('with no DTEND is the whole single day, not a default appointment length', () => {
    const window = resolveCalendarEventWindow({
      time: allDay({ year: 2026, month: 8, day: 5 }),
      timeZone: LA,
    })

    expect(window.startUtc.toISOString()).toBe('2026-08-05T07:00:00.000Z')
    expect(window.endUtc?.toISOString()).toBe('2026-08-06T07:00:00.000Z')
  })

  it('spans a multi-day all-day event end-exclusively, the way DTEND means it', () => {
    // Google writes a 3-day event as DTSTART 08-10 / DTEND 08-13.
    const window = resolveCalendarEventWindow({
      time: allDay({ year: 2026, month: 8, day: 10 }, { year: 2026, month: 8, day: 13 }),
      timeZone: LA,
    })

    expect(window.startUtc.toISOString()).toBe('2026-08-10T07:00:00.000Z')
    expect(window.endUtc?.toISOString()).toBe('2026-08-13T07:00:00.000Z')
  })

  it('is 23 hours long on a spring-forward day and 25 on a fall-back day', () => {
    const spring = resolveCalendarEventWindow({
      time: allDay({ year: 2026, month: 3, day: 8 }),
      timeZone: LA,
    })
    expect(spring.startUtc.toISOString()).toBe('2026-03-08T08:00:00.000Z')
    expect(spring.endUtc?.toISOString()).toBe('2026-03-09T07:00:00.000Z')
    expect(hours(spring)).toBe(23)

    const fall = resolveCalendarEventWindow({
      time: allDay({ year: 2026, month: 11, day: 1 }),
      timeZone: LA,
    })
    expect(fall.startUtc.toISOString()).toBe('2026-11-01T07:00:00.000Z')
    expect(fall.endUtc?.toISOString()).toBe('2026-11-02T08:00:00.000Z')
    expect(hours(fall)).toBe(25)
  })

  it('starts a day at 01:00 in a zone that moves its clock AT midnight', () => {
    // Santiago springs forward at 00:00 on 2026-09-06, so that day has no
    // midnight at all — B6's case, and the reason this goes through
    // `startOfLocalDayUtc` rather than a plain wall-time conversion.
    const window = resolveCalendarEventWindow({
      time: allDay({ year: 2026, month: 9, day: 6 }),
      timeZone: SANTIAGO,
    })

    expect(window.startUtc.toISOString()).toBe('2026-09-06T04:00:00.000Z')
    expect(window.endUtc?.toISOString()).toBe('2026-09-07T03:00:00.000Z')
    expect(hours(window)).toBe(23)
  })

  it('tiles consecutive all-day events with neither a gap nor an overlap', () => {
    const first = resolveCalendarEventWindow({
      time: allDay({ year: 2026, month: 11, day: 1 }),
      timeZone: LA,
    })
    const second = resolveCalendarEventWindow({
      time: allDay({ year: 2026, month: 11, day: 2 }),
      timeZone: LA,
    })

    expect(first.endUtc?.toISOString()).toBe(second.startUtc.toISOString())
  })
})

describe('resolveCalendarEventWindow — LOCAL_WALL (floating)', () => {
  const floating = {
    anchor: 'LOCAL_WALL' as const,
    start: { year: 2026, month: 8, day: 7, hour: 10, minute: 0 },
    end: { year: 2026, month: 8, day: 7, hour: 11, minute: 0 },
  }

  it('reads a floating wall time on the pro’s clock', () => {
    expect(resolveCalendarEventWindow({ time: floating, timeZone: LA })).toEqual({
      startUtc: new Date('2026-08-07T17:00:00.000Z'),
      endUtc: new Date('2026-08-07T18:00:00.000Z'),
    })
    expect(resolveCalendarEventWindow({ time: floating, timeZone: BERLIN })).toEqual({
      startUtc: new Date('2026-08-07T08:00:00.000Z'),
      endUtc: new Date('2026-08-07T09:00:00.000Z'),
    })
    expect(resolveCalendarEventWindow({ time: floating, timeZone: AUCKLAND })).toEqual({
      startUtc: new Date('2026-08-06T22:00:00.000Z'),
      endUtc: new Date('2026-08-06T23:00:00.000Z'),
    })
  })

  it('drops an end that is not after the start, so the caller applies its default', () => {
    expect(
      resolveCalendarEventWindow({
        time: {
          anchor: 'LOCAL_WALL',
          start: { year: 2026, month: 8, day: 7, hour: 10, minute: 0 },
          end: { year: 2026, month: 8, day: 7, hour: 10, minute: 0 },
        },
        timeZone: LA,
      }).endUtc,
    ).toBeNull()
  })
})

describe('resolveCalendarEventWindow — INSTANT', () => {
  it('leaves a zoned stamp exactly as the feed pinned it', () => {
    const startUtc = new Date('2026-08-01T21:00:00.000Z')
    const endUtc = new Date('2026-08-01T22:30:00.000Z')

    // Same input, four different pro zones, one answer: the feed already said
    // which moment it meant, and re-reading it would be the bug reversed.
    for (const timeZone of [LA, BERLIN, AUCKLAND, SANTIAGO]) {
      expect(
        resolveCalendarEventWindow({
          time: { anchor: 'INSTANT', startUtc, endUtc },
          timeZone,
        }),
      ).toEqual({ startUtc, endUtc })
    }
  })

  it('passes a null end through', () => {
    expect(
      resolveCalendarEventWindow({
        time: {
          anchor: 'INSTANT',
          startUtc: new Date('2026-08-01T21:00:00.000Z'),
          endUtc: null,
        },
        timeZone: LA,
      }).endUtc,
    ).toBeNull()
  })
})

function hours(window: { startUtc: Date; endUtc: Date | null }): number {
  if (!window.endUtc) return 0
  return (window.endUtc.getTime() - window.startUtc.getTime()) / 3_600_000
}
