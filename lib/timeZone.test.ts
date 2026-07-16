import { describe, expect, it } from 'vitest'

import {
  DEFAULT_TIME_ZONE,
  getZonedParts,
  isValidIanaTimeZone,
  pickTimeZoneOrNull,
  sanitizeTimeZone,
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
