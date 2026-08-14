// lib/time/relativeTime.test.ts
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  formatRelativeDayAgo,
  formatRelativeTimeAgo,
  formatRelativeTimeCompact,
} from './relativeTime'

const MIN = 60_000
const HOUR = 60 * MIN
const DAY = 24 * HOUR
const WEEK = 7 * DAY

// Offset from "now" with a small margin so floor() lands inside the bucket and
// never on a boundary, independent of the few ms Date.now() advances mid-call.
function ago(ms: number): Date {
  return new Date(Date.now() - ms - 500)
}

describe('formatRelativeTimeCompact', () => {
  it('buckets into compact units, then a dated fallback with year', () => {
    expect(formatRelativeTimeCompact(ago(20_000))).toBe('now')
    expect(formatRelativeTimeCompact(ago(5 * MIN))).toBe('5m')
    expect(formatRelativeTimeCompact(ago(3 * HOUR))).toBe('3h')
    expect(formatRelativeTimeCompact(ago(2 * DAY))).toBe('2d')
    expect(formatRelativeTimeCompact(ago(4 * WEEK))).toBe('4w')
    expect(formatRelativeTimeCompact(ago(60 * WEEK))).toMatch(/\d{4}$/)
  })

  it('returns empty string for unparseable input', () => {
    expect(formatRelativeTimeCompact('not-a-date')).toBe('')
  })
})

describe('formatRelativeTimeAgo', () => {
  it('keeps the "ago" wording and a no-year fallback after ~a month', () => {
    expect(formatRelativeTimeAgo(ago(20_000))).toBe('just now')
    expect(formatRelativeTimeAgo(ago(5 * MIN))).toBe('5m ago')
    expect(formatRelativeTimeAgo(ago(3 * HOUR))).toBe('3h ago')
    expect(formatRelativeTimeAgo(ago(2 * DAY))).toBe('2d ago')
    expect(formatRelativeTimeAgo(ago(3 * WEEK))).toBe('3w ago')
    // > 5 weeks falls through to a short date with no year.
    expect(formatRelativeTimeAgo(ago(8 * WEEK))).not.toContain('ago')
  })

  it('returns empty string for unparseable input', () => {
    expect(formatRelativeTimeAgo('not-a-date')).toBe('')
  })
})

describe('formatRelativeDayAgo', () => {
  const NY = 'America/New_York'

  afterEach(() => {
    vi.useRealTimers()
  })

  function pinNow(iso: string): void {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(iso))
  }

  it('buckets by day, then week, then a calendar date', () => {
    // 2026-03-15T12:00:00Z is 08:00 on Mar 15 in New York.
    pinNow('2026-03-15T12:00:00Z')

    expect(formatRelativeDayAgo('2026-03-15T05:30:00Z', NY)).toBe('today')
    expect(formatRelativeDayAgo('2026-03-14T18:00:00Z', NY)).toBe('yesterday')
    expect(formatRelativeDayAgo('2026-03-12T18:00:00Z', NY)).toBe('3d ago')
    expect(formatRelativeDayAgo('2026-03-01T18:00:00Z', NY)).toBe('2w ago')
  })

  it('calls "yesterday" by the calendar day, not by elapsed hours', () => {
    // 00:10 on Mar 10 in New York — 20 minutes after 23:50 the night before,
    // which an elapsed-time bucket would still be calling "today".
    pinNow('2026-03-10T04:10:00Z')

    expect(formatRelativeDayAgo('2026-03-10T03:50:00Z', NY)).toBe('yesterday')
  })

  it('renders the older-than fallback in the given zone, not UTC', () => {
    pinNow('2026-03-15T12:00:00Z')

    // 02:00Z on Feb 1 is still 21:00 on Jan 31 in New York.
    expect(formatRelativeDayAgo('2026-02-01T02:00:00Z', NY)).toBe('Jan 31')
    expect(formatRelativeDayAgo('2026-02-01T02:00:00Z', 'UTC')).toBe('Feb 1')
  })

  it('clamps a future instant to today and rejects unparseable input', () => {
    pinNow('2026-03-15T12:00:00Z')

    expect(formatRelativeDayAgo('2026-03-20T12:00:00Z', NY)).toBe('today')
    expect(formatRelativeDayAgo('not-a-date', NY)).toBe('')
  })
})
