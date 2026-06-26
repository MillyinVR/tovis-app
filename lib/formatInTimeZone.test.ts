// lib/formatInTimeZone.test.ts
import { describe, expect, it } from 'vitest'

import { formatInTimeZone, formatRangeInTimeZone } from './formatInTimeZone'

// A fixed UTC instant: 2026-06-15T20:30:00Z.
const INSTANT = new Date('2026-06-15T20:30:00.000Z')

describe('formatInTimeZone (memoized formatter)', () => {
  it('formats a known instant correctly per timezone', () => {
    // 20:30 UTC → 16:30 in New York (EDT, UTC-4), 13:30 in Los Angeles (PDT).
    expect(
      formatInTimeZone(INSTANT, 'America/New_York', {
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      }),
    ).toBe('16:30')
    expect(
      formatInTimeZone(INSTANT, 'America/Los_Angeles', {
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      }),
    ).toBe('13:30')
  })

  it('is independent of option property order (stable cache key)', () => {
    const a = formatInTimeZone(INSTANT, 'UTC', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    })
    const b = formatInTimeZone(INSTANT, 'UTC', {
      year: 'numeric',
      day: 'numeric',
      month: 'short',
    })
    expect(a).toBe(b)
  })

  it('keeps distinct timezones / options / locales distinct', () => {
    const ny = formatInTimeZone(INSTANT, 'America/New_York', { hour: 'numeric' })
    const utc = formatInTimeZone(INSTANT, 'UTC', { hour: 'numeric' })
    expect(ny).not.toBe(utc)

    const enUs = formatInTimeZone(INSTANT, 'UTC', { weekday: 'long' }, 'en-US')
    const frFr = formatInTimeZone(INSTANT, 'UTC', { weekday: 'long' }, 'fr-FR')
    expect(enUs).not.toBe(frFr)
  })

  it('returns identical output on repeated (cached) calls', () => {
    const opts = { dateStyle: 'medium', timeStyle: 'short' } as const
    const first = formatInTimeZone(INSTANT, 'America/Chicago', opts)
    const second = formatInTimeZone(INSTANT, 'America/Chicago', opts)
    expect(first).toBe(second)
  })

  it('returns "Invalid date" for unparseable input', () => {
    expect(formatInTimeZone('nonsense', 'UTC', { hour: 'numeric' })).toBe(
      'Invalid date',
    )
  })
})

describe('formatRangeInTimeZone', () => {
  it('renders a zoned start → end range', () => {
    const end = new Date('2026-06-15T21:45:00.000Z')
    const out = formatRangeInTimeZone(INSTANT, end, 'UTC')
    expect(out).toContain('→')
    expect(out).toContain('Jun 15')
  })
})
