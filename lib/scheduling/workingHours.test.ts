import { describe, expect, it } from 'vitest'

import { disabledWeekdayIndexes } from './workingHours'

describe('disabledWeekdayIndexes', () => {
  const openDay = { enabled: true, start: '09:00', end: '18:00' }

  it('returns the indexes of explicitly disabled days (0=Sun … 6=Sat)', () => {
    const off = disabledWeekdayIndexes({
      sun: { enabled: false, start: '09:00', end: '18:00' },
      mon: openDay,
      tue: openDay,
      wed: openDay,
      thu: openDay,
      fri: openDay,
      sat: { enabled: false, start: '09:00', end: '18:00' },
    })

    expect([...off].sort()).toEqual([0, 6])
  })

  it('is empty for a fully open week', () => {
    expect(
      disabledWeekdayIndexes({
        sun: openDay,
        mon: openDay,
        tue: openDay,
        wed: openDay,
        thu: openDay,
        fri: openDay,
        sat: openDay,
      }).size,
    ).toBe(0)
  })

  it('treats missing or malformed schedules as "not off" — only a deliberate off reads as off', () => {
    expect(disabledWeekdayIndexes(null).size).toBe(0)
    expect(disabledWeekdayIndexes(undefined).size).toBe(0)
    expect(disabledWeekdayIndexes('garbage').size).toBe(0)
    // A day that is missing or not an object is a server-side refusal case
    // (WORKING_HOURS_REQUIRED/INVALID), not an off-day to shade.
    expect(
      disabledWeekdayIndexes({ mon: openDay, tue: 'broken' }).size,
    ).toBe(0)
  })
})
