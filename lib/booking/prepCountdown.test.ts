import { describe, expect, it } from 'vitest'

import { buildPrepCountdown } from '@/lib/booking/prepCountdown'

const NY = 'America/New_York'

describe('buildPrepCountdown', () => {
  it('counts CALENDAR days, not 24h blocks', () => {
    // 🔴 The bug this guards. 11pm Monday → 9am Wednesday is 34 hours, which
    // `floor(hours / 24)` calls 1 ("Tomorrow") and a human calls 2 days.
    const now = new Date('2026-06-09T03:00:00.000Z') // Mon Jun 8, 11pm NY
    const appt = new Date('2026-06-10T13:00:00.000Z') // Wed Jun 10, 9am NY

    // 34 hours apart: floor(34 / 24) === 1 would say "Tomorrow".
    expect((appt.getTime() - now.getTime()) / 3_600_000).toBeCloseTo(34, 5)

    const result = buildPrepCountdown(appt, NY, now)
    expect(result.days).toBe(2)
    expect(result.label).toBe('In 2 days')
  })

  it('reads the day boundary in the APPOINTMENT’s zone', () => {
    // 9pm Tuesday in Los Angeles is already Wednesday in New York. The same
    // instant is "tomorrow" in one zone and "today" in the other; the
    // appointment's zone is the one that decides.
    const now = new Date('2026-06-10T04:00:00.000Z')
    const appt = new Date('2026-06-10T15:00:00.000Z')

    expect(buildPrepCountdown(appt, NY, now).label).toBe('Today')
    expect(buildPrepCountdown(appt, 'America/Los_Angeles', now).label).toBe(
      'Tomorrow',
    )
  })

  it('survives a DST transition inside the range', () => {
    // US DST starts 2026-03-08. Counting in hours across it drifts by one.
    const now = new Date('2026-03-05T17:00:00.000Z') // Thu Mar 5, noon NY
    const appt = new Date('2026-03-12T16:00:00.000Z') // Thu Mar 12, noon NY

    expect(buildPrepCountdown(appt, NY, now).days).toBe(7)
  })

  it('gives today and tomorrow the urgent tone', () => {
    const now = new Date('2026-06-10T15:00:00.000Z')
    expect(buildPrepCountdown(now, NY, now).tone).toBe('urgent')
    expect(
      buildPrepCountdown(new Date('2026-06-11T15:00:00.000Z'), NY, now).tone,
    ).toBe('urgent')
  })

  it('switches shape past a fortnight and speaks in weeks', () => {
    const now = new Date('2026-06-10T15:00:00.000Z')

    const near = buildPrepCountdown(
      new Date('2026-06-24T15:00:00.000Z'),
      NY,
      now,
    )
    expect(near.tone).toBe('near')
    expect(near.label).toBe('In 14 days')

    const far = buildPrepCountdown(new Date('2026-07-22T15:00:00.000Z'), NY, now)
    expect(far.tone).toBe('far')
    expect(far.label).toBe('In 6 weeks')
  })

  it('speaks in months once weeks stop being readable', () => {
    const now = new Date('2026-06-10T15:00:00.000Z')
    const far = buildPrepCountdown(new Date('2026-09-10T15:00:00.000Z'), NY, now)
    expect(far.label).toBe('In 3 months')
  })

  it('marks a past appointment rather than counting backwards at the client', () => {
    const now = new Date('2026-06-10T15:00:00.000Z')
    const result = buildPrepCountdown(
      new Date('2026-06-08T15:00:00.000Z'),
      NY,
      now,
    )
    expect(result.tone).toBe('past')
    expect(result.days).toBeLessThan(0)
  })
})
