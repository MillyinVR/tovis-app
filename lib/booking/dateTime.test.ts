// lib/booking/dateTime.test.ts
import { describe, expect, it } from 'vitest'
import {
  getUtcBoundsForLocalDate,
  dateTimeLocalToUtcIso,
  utcIsoToDateTimeLocal,
  utcDateToLocalParts,
  utcDateToLocalYmd,
  zonedPartsToUtcStrict,
} from './dateTime'

describe('lib/booking/dateTime', () => {
  it('round-trips a normal local wall time through UTC', () => {
    const tz = 'America/New_York'
    const local = '2026-01-15T09:30:00'

    const utcIso = dateTimeLocalToUtcIso(local, tz)
    const localRoundTrip = utcIsoToDateTimeLocal(utcIso, tz)

    expect(localRoundTrip).toBe('2026-01-15T09:30')
  })

  it('computes UTC bounds for a local date without shifting the day', () => {
    const tz = 'America/Los_Angeles'
    const bounds = getUtcBoundsForLocalDate('2026-01-15', tz)

    const startParts = utcDateToLocalParts(bounds.startUtc, tz)
    const endMinusOneMsParts = utcDateToLocalParts(
      new Date(bounds.endUtc.getTime() - 1),
      tz,
    )

    expect(startParts.year).toBe(2026)
    expect(startParts.month).toBe(1)
    expect(startParts.day).toBe(15)
    expect(startParts.hour).toBe(0)
    expect(startParts.minute).toBe(0)

    expect(endMinusOneMsParts.year).toBe(2026)
    expect(endMinusOneMsParts.month).toBe(1)
    expect(endMinusOneMsParts.day).toBe(15)
  })

  it('keeps near-midnight local bookings on the same local date after round-trip', () => {
    const tz = 'America/Los_Angeles'
    const local = '2026-01-15T23:30:00'

    const utcIso = dateTimeLocalToUtcIso(local, tz)
    const localRoundTrip = utcIsoToDateTimeLocal(utcIso, tz)

    expect(localRoundTrip).toBe('2026-01-15T23:30')
  })

  it('spring forward: rejects nonexistent local wall time', () => {
    const tz = 'America/New_York'
    const nonexistentLocal = '2026-03-08T02:30:00'

    expect(() => dateTimeLocalToUtcIso(nonexistentLocal, tz)).toThrow(
      /does not exist or is ambiguous/i,
    )
  })

  it('fall back: rejects ambiguous repeated wall-clock hour', () => {
    const tz = 'America/New_York'
    const ambiguousLocal = '2026-11-01T01:30:00'

    expect(() => dateTimeLocalToUtcIso(ambiguousLocal, tz)).toThrow(
      /does not exist or is ambiguous/i,
    )
  })

  describe('zonedPartsToUtcStrict', () => {
    it('converts a normal wall time to the matching UTC instant', () => {
      const utc = zonedPartsToUtcStrict({
        year: 2026,
        month: 1,
        day: 15,
        hour: 9,
        minute: 30,
        timeZone: 'America/New_York',
      })
      // EST (UTC-5) in January
      expect(utc.toISOString()).toBe('2026-01-15T14:30:00.000Z')
    })

    it('throws on a nonexistent spring-forward wall time', () => {
      expect(() =>
        zonedPartsToUtcStrict({
          year: 2026,
          month: 3,
          day: 8,
          hour: 2,
          minute: 30,
          timeZone: 'America/New_York',
        }),
      ).toThrow(/does not exist or is ambiguous/i)
    })

    it('throws on an ambiguous fall-back wall time', () => {
      expect(() =>
        zonedPartsToUtcStrict({
          year: 2026,
          month: 11,
          day: 1,
          hour: 1,
          minute: 30,
          timeZone: 'America/New_York',
        }),
      ).toThrow(/does not exist or is ambiguous/i)
    })
  })

  // A human-picked wall time in a DST gap must still be refused (the two cases
  // directly above) — but a DAY BOUNDARY is not a picked time. Five IANA zones
  // move their clocks AT midnight, so their day boundary IS the gap/overlap:
  // asking for their transition day used to throw the same refusal, which the
  // availability routes turn into a 500 for that day AND the day before it
  // (the previous day's end bound is this day's midnight).
  describe('getUtcBoundsForLocalDate — zones whose DST transition is AT midnight', () => {
    const CASES = [
      // [zone, local day, first instant, first instant of the NEXT day, hours]
      [
        'America/Havana',
        '2026-03-08',
        '2026-03-08T05:00:00.000Z',
        '2026-03-09T04:00:00.000Z',
        23,
      ],
      [
        'America/Havana',
        '2026-10-31',
        '2026-10-31T04:00:00.000Z',
        '2026-11-01T04:00:00.000Z',
        24,
      ],
      [
        'America/Havana',
        '2026-11-01',
        '2026-11-01T04:00:00.000Z',
        '2026-11-02T05:00:00.000Z',
        25,
      ],
      [
        'America/Santiago',
        '2026-09-06',
        '2026-09-06T04:00:00.000Z',
        '2026-09-07T03:00:00.000Z',
        23,
      ],
      [
        'Atlantic/Azores',
        '2026-03-29',
        '2026-03-29T01:00:00.000Z',
        '2026-03-30T00:00:00.000Z',
        23,
      ],
      [
        'Africa/Cairo',
        '2026-04-24',
        '2026-04-23T22:00:00.000Z',
        '2026-04-24T21:00:00.000Z',
        23,
      ],
      [
        'Asia/Beirut',
        '2026-03-29',
        '2026-03-28T22:00:00.000Z',
        '2026-03-29T21:00:00.000Z',
        23,
      ],
    ] as const

    it.each(CASES)(
      'returns the real bounds instead of throwing (%s %s)',
      (zone, day, startIso, endIso, hours) => {
        const bounds = getUtcBoundsForLocalDate(day, zone)

        expect(bounds.startUtc.toISOString()).toBe(startIso)
        expect(bounds.endUtc.toISOString()).toBe(endIso)
        expect(
          (bounds.endUtc.getTime() - bounds.startUtc.getTime()) / 3_600_000,
        ).toBe(hours)

        // The window covers exactly this local day: its first instant is on it,
        // and the last instant before the end bound is still on it.
        expect(utcDateToLocalYmd(bounds.startUtc, zone)).toBe(day)
        expect(
          utcDateToLocalYmd(new Date(bounds.endUtc.getTime() - 1), zone),
        ).toBe(day)
      },
    )

    it('tiles with the previous day, leaving neither a gap nor an overlap', () => {
      const zone = 'America/Havana'

      expect(getUtcBoundsForLocalDate('2026-03-07', zone).endUtc.toISOString())
        .toBe(getUtcBoundsForLocalDate('2026-03-08', zone).startUtc.toISOString())
      expect(getUtcBoundsForLocalDate('2026-10-31', zone).endUtc.toISOString())
        .toBe(getUtcBoundsForLocalDate('2026-11-01', zone).startUtc.toISOString())
    })

    it('is unchanged for an ordinary zone on its own transition days', () => {
      const zone = 'America/Los_Angeles'

      expect(
        getUtcBoundsForLocalDate('2026-11-01', zone).startUtc.toISOString(),
      ).toBe('2026-11-01T07:00:00.000Z')
      expect(
        getUtcBoundsForLocalDate('2027-03-14', zone).startUtc.toISOString(),
      ).toBe('2027-03-14T08:00:00.000Z')
    })
  })
})