import { describe, expect, it } from 'vitest'

import { parseDurationMinutes } from './parseDurationMinutes'

describe('parseDurationMinutes', () => {
  it('reads bare numbers as minutes', () => {
    expect(parseDurationMinutes('90')).toBe(90)
    expect(parseDurationMinutes(' 45 ')).toBe(45)
  })

  it('reads minute-tagged values', () => {
    expect(parseDurationMinutes('60 min')).toBe(60)
    expect(parseDurationMinutes('75 minutes')).toBe(75)
    expect(parseDurationMinutes('30m')).toBe(30)
  })

  it('reads hour-tagged values as hours, not minutes', () => {
    expect(parseDurationMinutes('3 hours')).toBe(180)
    expect(parseDurationMinutes('1 hr')).toBe(60)
    expect(parseDurationMinutes('1.5 hr')).toBe(90)
    expect(parseDurationMinutes('2h')).toBe(120)
  })

  it('reads combined hours and minutes', () => {
    expect(parseDurationMinutes('1h 15m')).toBe(75)
    expect(parseDurationMinutes('1 hour 30 min')).toBe(90)
  })

  it('reads clock-style durations', () => {
    expect(parseDurationMinutes('1:00')).toBe(60)
    expect(parseDurationMinutes('1:15')).toBe(75)
    expect(parseDurationMinutes('01:05')).toBe(65)
  })

  it('returns null for empty or numberless cells', () => {
    expect(parseDurationMinutes(undefined)).toBeNull()
    expect(parseDurationMinutes('')).toBeNull()
    expect(parseDurationMinutes('   ')).toBeNull()
    expect(parseDurationMinutes('n/a')).toBeNull()
  })
})
