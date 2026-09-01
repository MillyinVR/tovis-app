// lib/format/duration.test.ts
//
// The one minutes → label rule, which two client surfaces had forked before B7
// needed a third caller. These cases pin the behaviour both forks had, so the
// extraction cannot quietly change what either of them renders.

import { describe, expect, it } from 'vitest'

import { formatDurationLabel } from './duration'

describe('formatDurationLabel', () => {
  it('reads in minutes below the hour', () => {
    expect(formatDurationLabel(20)).toBe('20 min')
    expect(formatDurationLabel(59)).toBe('59 min')
  })

  it('reads in hours at and above it, dropping a zero remainder', () => {
    expect(formatDurationLabel(60)).toBe('1h')
    expect(formatDurationLabel(90)).toBe('1h 30m')
    expect(formatDurationLabel(125)).toBe('2h 5m')
  })

  // Null, not "0 min": every caller renders its own dash or omits the line.
  it('is null when there is no duration worth printing', () => {
    expect(formatDurationLabel(0)).toBeNull()
    expect(formatDurationLabel(-5)).toBeNull()
    expect(formatDurationLabel(Number.NaN)).toBeNull()
    expect(formatDurationLabel(null)).toBeNull()
    expect(formatDurationLabel(undefined)).toBeNull()
  })
})
