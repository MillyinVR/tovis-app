// lib/time/relativeTime.test.ts
import { describe, expect, it } from 'vitest'

import { formatRelativeTimeAgo, formatRelativeTimeCompact } from './relativeTime'

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
