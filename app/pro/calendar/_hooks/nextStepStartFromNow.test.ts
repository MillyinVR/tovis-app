import { describe, expect, it } from 'vitest'

import { getZonedParts } from '@/lib/timeZone'

import { nextStepStartFromNow } from './useBlockActions'

// `nextStepStartFromNow` seeds the calendar "+" flows: the block modal (no
// `day`, anchored to today) and the new-appointment route (`day` = viewed day).
describe('nextStepStartFromNow', () => {
  const timeZone = 'America/New_York'

  it('anchors the next step-aligned wall-clock time to the provided day', () => {
    const now = new Date('2026-07-10T17:07:00Z') // 13:07 ET
    const viewedDay = new Date('2026-07-20T12:00:00Z')

    const start = nextStepStartFromNow({
      now,
      day: viewedDay,
      timeZone,
      stepMinutes: 15,
    })

    const parts = getZonedParts(start, timeZone)
    const dayParts = getZonedParts(viewedDay, timeZone)
    const nowParts = getZonedParts(now, timeZone)

    // Lands on the viewed day, not today.
    expect(parts.year).toBe(dayParts.year)
    expect(parts.month).toBe(dayParts.month)
    expect(parts.day).toBe(dayParts.day)

    // Time-of-day is the next 15-min step rounded up from `now`'s wall clock.
    const nowMinutes = nowParts.hour * 60 + nowParts.minute
    const expected = Math.ceil(nowMinutes / 15) * 15
    expect(parts.hour * 60 + parts.minute).toBe(expected)
    expect(parts.minute % 15).toBe(0)
  })

  it('defaults the anchor day to now when `day` is omitted (block behavior)', () => {
    const now = new Date('2026-07-10T17:07:00Z')

    const start = nextStepStartFromNow({ now, timeZone, stepMinutes: 15 })

    const parts = getZonedParts(start, timeZone)
    const nowParts = getZonedParts(now, timeZone)

    expect(parts.year).toBe(nowParts.year)
    expect(parts.month).toBe(nowParts.month)
    expect(parts.day).toBe(nowParts.day)
  })

  it('clamps to the last step of the viewed day near midnight', () => {
    const now = new Date('2026-07-11T03:58:00Z') // 23:58 ET on the 10th
    const viewedDay = new Date('2026-07-20T12:00:00Z')

    const start = nextStepStartFromNow({
      now,
      day: viewedDay,
      timeZone,
      stepMinutes: 15,
    })

    const parts = getZonedParts(start, timeZone)
    const dayParts = getZonedParts(viewedDay, timeZone)

    // snapMinutes clamps to [0, 1440 - step], so the rounded time never spills
    // past midnight — it lands on the last slot of the viewed day (23:45).
    expect(parts.day).toBe(dayParts.day)
    expect(parts.hour * 60 + parts.minute).toBe(24 * 60 - 15)
  })
})
