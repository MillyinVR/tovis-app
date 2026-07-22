import { describe, expect, it } from 'vitest'

import {
  DEFAULT_TIME_ZONE,
  daySerialInTimeZone,
  getZonedParts,
  isValidIanaTimeZone,
  pickTimeZoneOrNull,
  sanitizeTimeZone,
  startOfDayUtcInTimeZone,
} from './timeZone'

describe('isValidIanaTimeZone', () => {
  it('accepts canonical IANA zones', () => {
    expect(isValidIanaTimeZone('America/Los_Angeles')).toBe(true)
    expect(isValidIanaTimeZone('UTC')).toBe(true)
    expect(isValidIanaTimeZone('Australia/Eucla')).toBe(true)
  })

  it('accepts legacy link/alias zones that Intl still resolves', () => {
    // These are absent from Intl.supportedValuesOf('timeZone') but remain valid
    // inputs, so validity must stay Intl-derived rather than set-membership.
    expect(isValidIanaTimeZone('US/Pacific')).toBe(true)
    expect(isValidIanaTimeZone('Asia/Calcutta')).toBe(true)
  })

  it('rejects malformed, empty and non-string input', () => {
    expect(isValidIanaTimeZone('Not/AZone')).toBe(false)
    expect(isValidIanaTimeZone('')).toBe(false)
    expect(isValidIanaTimeZone('   ')).toBe(false)
    expect(isValidIanaTimeZone(null)).toBe(false)
    expect(isValidIanaTimeZone(undefined)).toBe(false)
  })

  it('returns a stable verdict when called repeatedly (memoized path)', () => {
    for (let i = 0; i < 3; i++) {
      expect(isValidIanaTimeZone('Europe/Berlin')).toBe(true)
      expect(isValidIanaTimeZone('Nope/Nope')).toBe(false)
    }
  })

  it('keeps evaluating correctly past the validity-cache bound', () => {
    // Distinct invalid zones are caller-supplied, so the cache stops growing —
    // but the verdicts must stay right after it stops admitting entries.
    for (let i = 0; i < 600; i++) {
      expect(isValidIanaTimeZone(`Bogus/Zone_${i}`)).toBe(false)
    }
    expect(isValidIanaTimeZone('America/New_York')).toBe(true)
    expect(isValidIanaTimeZone('Bogus/Zone_1')).toBe(false)
  })
})

describe('sanitizeTimeZone / pickTimeZoneOrNull', () => {
  it('passes valid zones through and falls back for invalid ones', () => {
    expect(sanitizeTimeZone('America/Chicago')).toBe('America/Chicago')
    expect(sanitizeTimeZone('  America/Chicago  ')).toBe('America/Chicago')
    expect(sanitizeTimeZone('Not/AZone')).toBe(DEFAULT_TIME_ZONE)
    expect(sanitizeTimeZone(undefined, 'America/Denver')).toBe('America/Denver')
  })

  it('returns null rather than inventing a zone', () => {
    expect(pickTimeZoneOrNull('America/Chicago')).toBe('America/Chicago')
    expect(pickTimeZoneOrNull('Not/AZone')).toBeNull()
    expect(pickTimeZoneOrNull(42)).toBeNull()
  })
})

describe('getZonedParts', () => {
  it('converts a UTC instant to wall-clock parts in the target zone', () => {
    const parts = getZonedParts(
      new Date('2026-07-16T19:30:00.000Z'),
      'America/Los_Angeles',
    )
    expect(parts).toMatchObject({
      year: 2026,
      month: 7,
      day: 16,
      hour: 12,
      minute: 30,
    })
  })

  it('falls back to UTC for an invalid zone', () => {
    const at = new Date('2026-07-16T19:30:00.000Z')
    expect(getZonedParts(at, 'Not/AZone')).toMatchObject(
      getZonedParts(at, 'UTC'),
    )
  })
})

describe('startOfDayUtcInTimeZone dayOffset', () => {
  const TZ = 'America/New_York'

  // A local day is 23h on the spring transition and 25h on the autumn one, so
  // `startOfDay + 86_400_000` misses the next local midnight by an hour in both
  // directions. Every case below is a real 2026 US transition.
  it.each([
    ['spring forward', '2026-03-08T17:00:00.000Z', '2026-03-09T04:00:00.000Z'],
    ['fall back', '2026-11-01T17:00:00.000Z', '2026-11-02T05:00:00.000Z'],
    ['ordinary day', '2026-06-10T17:00:00.000Z', '2026-06-11T04:00:00.000Z'],
  ])('lands on the next LOCAL midnight (%s)', (_label, from, expected) => {
    expect(
      startOfDayUtcInTimeZone(new Date(from), TZ, 1).toISOString(),
    ).toBe(expected)
  })

  it('is never a fixed 24h step across a transition', () => {
    const springStart = startOfDayUtcInTimeZone(
      new Date('2026-03-08T17:00:00.000Z'),
      TZ,
    )
    const autumnStart = startOfDayUtcInTimeZone(
      new Date('2026-11-01T17:00:00.000Z'),
      TZ,
    )

    expect(
      startOfDayUtcInTimeZone(springStart, TZ, 1).getTime() -
        springStart.getTime(),
    ).toBe(23 * 60 * 60 * 1000)
    expect(
      startOfDayUtcInTimeZone(autumnStart, TZ, 1).getTime() -
        autumnStart.getTime(),
    ).toBe(25 * 60 * 60 * 1000)
  })

  it('rolls over month and year boundaries, and steps backwards', () => {
    expect(
      startOfDayUtcInTimeZone(new Date('2026-01-31T17:00:00.000Z'), 'UTC', 1)
        .toISOString(),
    ).toBe('2026-02-01T00:00:00.000Z')
    expect(
      startOfDayUtcInTimeZone(new Date('2026-12-31T17:00:00.000Z'), 'UTC', 1)
        .toISOString(),
    ).toBe('2027-01-01T00:00:00.000Z')
    expect(
      startOfDayUtcInTimeZone(new Date('2026-03-01T17:00:00.000Z'), 'UTC', -1)
        .toISOString(),
    ).toBe('2026-02-28T00:00:00.000Z')
  })

  it('defaults to the containing local day, unchanged', () => {
    const at = new Date('2026-06-10T17:00:00.000Z')
    expect(startOfDayUtcInTimeZone(at, TZ, 0).toISOString()).toBe(
      startOfDayUtcInTimeZone(at, TZ).toISOString(),
    )
  })
})

describe('daySerialInTimeZone', () => {
  it('counts whole local days between two instants', () => {
    const tz = 'America/New_York'
    const a = new Date('2026-03-08T17:00:00.000Z')
    const b = new Date('2026-03-09T17:00:00.000Z')
    expect(daySerialInTimeZone(b, tz) - daySerialInTimeZone(a, tz)).toBe(1)
  })

  it('gives the same serial for both ends of one local day, across a DST shift', () => {
    const tz = 'America/New_York'
    // 2026-03-08 00:30 and 23:30 local — the day that loses an hour.
    const early = new Date('2026-03-08T05:30:00.000Z')
    const late = new Date('2026-03-09T03:30:00.000Z')
    expect(daySerialInTimeZone(early, tz)).toBe(daySerialInTimeZone(late, tz))
  })

  it('reads the local day, not the UTC one', () => {
    // 2026-06-11 02:00Z is still 2026-06-10 in New York.
    const at = new Date('2026-06-11T02:00:00.000Z')
    expect(daySerialInTimeZone(at, 'UTC')).toBe(
      daySerialInTimeZone(at, 'America/New_York') + 1,
    )
  })
})
