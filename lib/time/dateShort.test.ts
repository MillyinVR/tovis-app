// lib/time/dateShort.test.ts
import { describe, expect, it } from 'vitest'

import {
  formatDateShortInTimeZone,
  formatIsoDateShort,
} from '@/lib/time/dateShort'

describe('formatDateShortInTimeZone', () => {
  it('renders the app short date', () => {
    expect(
      formatDateShortInTimeZone('2026-08-09T19:00:00Z', 'America/Los_Angeles'),
    ).toBe('Aug 9, 2026')
  })

  /**
   * The reason this lives in `lib/time` at all. 02:00 UTC on the 9th is still
   * 19:00 on the 8th in Los Angeles and already 11:00 on the 9th in Tokyo — one
   * instant, two calendar days. A formatter that ignored the zone would print
   * the same day for both, which is what the ten hand-rolled copies risked
   * every time one of them was called without a timeZone.
   */
  it('resolves the calendar day in the given zone, not UTC', () => {
    const instant = '2026-08-09T02:00:00Z'

    expect(formatDateShortInTimeZone(instant, 'America/Los_Angeles')).toBe(
      'Aug 8, 2026',
    )
    expect(formatDateShortInTimeZone(instant, 'Asia/Tokyo')).toBe('Aug 9, 2026')
    expect(formatDateShortInTimeZone(instant, 'UTC')).toBe('Aug 9, 2026')
  })

  it('accepts a Date as well as an ISO string', () => {
    expect(
      formatDateShortInTimeZone(new Date('2026-01-02T12:00:00Z'), 'UTC'),
    ).toBe('Jan 2, 2026')
  })

  it('falls back to the default zone for a blank or unknown one', () => {
    const instant = '2026-08-09T12:00:00Z'

    expect(formatDateShortInTimeZone(instant, null)).toBe(
      formatDateShortInTimeZone(instant, undefined),
    )
    expect(formatDateShortInTimeZone(instant, 'Not/AZone')).toBe(
      formatDateShortInTimeZone(instant, null),
    )
  })
})

describe('formatIsoDateShort', () => {
  // Returns null rather than a placeholder so the caller decides what an
  // unknown date looks like. The wrappers this replaced disagreed on that:
  // six returned null, one returned '', and ReferralListClient's passed an
  // unparseable date straight to formatInTimeZone, which renders the literal
  // string "Invalid date" into the page.
  it('returns null for an absent date', () => {
    expect(formatIsoDateShort(null)).toBeNull()
    expect(formatIsoDateShort(undefined)).toBeNull()
    expect(formatIsoDateShort('')).toBeNull()
  })

  it('returns null for an unparseable date', () => {
    expect(formatIsoDateShort('not-a-date')).toBeNull()
    expect(formatIsoDateShort('2026-13-45T00:00:00Z')).toBeNull()
  })

  it('renders a valid instant in the app short-date shape', () => {
    // The viewer's zone decides the day, so assert the SHAPE rather than a
    // fixed day — a test pinned to one day would pass or fail on the machine's
    // timezone rather than on this code.
    expect(formatIsoDateShort('2026-08-09T12:00:00Z')).toMatch(
      /^[A-Z][a-z]{2} \d{1,2}, 2026$/,
    )
  })
})
