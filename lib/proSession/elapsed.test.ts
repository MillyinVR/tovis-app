import { describe, expect, it } from 'vitest'

import { formatElapsed } from './elapsed'

describe('formatElapsed', () => {
  const start = new Date('2026-06-13T12:00:00.000Z')
  const startMs = start.getTime()

  it('returns the zero placeholder for null/undefined', () => {
    expect(formatElapsed(null)).toBe('0:00:00')
    expect(formatElapsed(undefined)).toBe('0:00:00')
  })

  it('formats seconds, minutes, and hours as H:MM:SS', () => {
    expect(formatElapsed(start, startMs + 5_000)).toBe('0:00:05')
    expect(formatElapsed(start, startMs + 65_000)).toBe('0:01:05')
    expect(formatElapsed(start, startMs + 3_600_000 + 61_000)).toBe('1:01:01')
  })

  it('clamps negative elapsed (clock skew / future start) to zero', () => {
    expect(formatElapsed(start, startMs - 5_000)).toBe('0:00:00')
  })

  it('accepts ISO string input', () => {
    expect(formatElapsed(start.toISOString(), startMs + 5_000)).toBe('0:00:05')
  })

  it('returns the zero placeholder for an unparseable string', () => {
    expect(formatElapsed('not-a-date', startMs)).toBe('0:00:00')
  })
})
