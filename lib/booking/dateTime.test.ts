// lib/booking/dateTime.test.ts
import { describe, expect, it } from 'vitest'
import {
  getUtcBoundsForLocalDate,
  dateTimeLocalToUtcIso,
  utcIsoToDateTimeLocal,
  utcDateToLocalParts,
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
})