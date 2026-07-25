// lib/availability/core/dayComputation.test.ts
//
// The DST truth of the slot engine itself (B6).
//
// `app/api/v1/availability/day/route.test.ts` has a suite called "DST behavior",
// but it MOCKS `computeDaySlotsFast` and asserts on the slot array the test
// itself wrote — it pins the route's pass-through, not the engine's arithmetic.
// Nothing exercised the real engine on a transition day until this file.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import {
  computeDayBoundsUtc,
  computeDaySlotsFast,
  localSlotToUtcOrNull,
} from './dayComputation'
import { utcDateToLocalYmd } from '@/lib/booking/dateTime'

const ALL_DAY = {
  sun: { enabled: true, start: '00:00', end: '23:59' },
  mon: { enabled: true, start: '00:00', end: '23:59' },
  tue: { enabled: true, start: '00:00', end: '23:59' },
  wed: { enabled: true, start: '00:00', end: '23:59' },
  thu: { enabled: true, start: '00:00', end: '23:59' },
  fri: { enabled: true, start: '00:00', end: '23:59' },
  sat: { enabled: true, start: '00:00', end: '23:59' },
}

const LA = 'America/Los_Angeles'

const SPRING_FORWARD = { year: 2027, month: 3, day: 14 } // 02:00 -> 03:00 PST->PDT
const FALL_BACK = { year: 2026, month: 11, day: 1 } // 02:00 -> 01:00 PDT->PST
const ORDINARY = { year: 2026, month: 10, day: 31 }

// `computeDaySlotsFast` reads the wall clock itself (`const nowUtc = new Date()`)
// and drops every start before it, so a real-clock run would quietly return an
// empty grid for any transition date that has since gone past — the suite would
// rot into a false green one day and a confusing red the next. Freeze "now"
// before every transition day used here instead.
beforeAll(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2025-12-31T12:00:00.000Z'))
})

afterAll(() => {
  vi.useRealTimers()
})

function localHm(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(iso))
}

async function slotsFor(
  dateYMD: { year: number; month: number; day: number },
  timeZone: string,
) {
  const result = await computeDaySlotsFast({
    dateYMD,
    durationMinutes: 30,
    stepMinutes: 30,
    timeZone,
    workingHours: ALL_DAY,
    leadTimeMinutes: 0,
    locationBufferMinutes: 0,
    maxAdvanceDays: 3650,
    busy: [],
    debug: true,
  })

  if (!result.ok) throw new Error(`expected slots, got ${result.code}`)
  return result
}

describe('computeDaySlotsFast — DST transition days', () => {
  it('spring forward: the skipped hour is not offered, the rest of the day is', async () => {
    const result = await slotsFor(SPRING_FORWARD, LA)
    const locals = result.slots.map((iso) => localHm(iso, LA))

    // 02:00 and 02:30 local do not exist on this date.
    expect(locals).not.toContain('02:00')
    expect(locals).not.toContain('02:30')

    // Everything either side of the gap still is.
    expect(locals).toContain('01:30')
    expect(locals).toContain('03:00')
    expect(locals).toContain('09:00')
  })

  it('fall back: the repeated hour is not offered, and no instant is offered twice', async () => {
    const result = await slotsFor(FALL_BACK, LA)
    const locals = result.slots.map((iso) => localHm(iso, LA))

    // 01:00 and 01:30 local happen TWICE on this date. An ambiguous wall time
    // is never offered — the same rule the pro-side wall-clock pickers apply
    // when they refuse one with DST_INVALID. Both occurrences are dropped, which
    // is the safe direction: the offer stays a subset of what the write accepts.
    expect(locals).not.toContain('01:00')
    expect(locals).not.toContain('01:30')

    expect(locals).toContain('00:30')
    expect(locals).toContain('02:00')

    // Every offered start is a distinct instant.
    expect(new Set(result.slots).size).toBe(result.slots.length)
  })

  it('reports the skipped wall times in debug, on both transition days', async () => {
    const spring = await slotsFor(SPRING_FORWARD, LA)
    const autumn = await slotsFor(FALL_BACK, LA)
    const ordinary = await slotsFor(ORDINARY, LA)

    const skipped = (result: { debug?: unknown }) =>
      (result.debug as { skippedDstWallTimes?: string[] }).skippedDstWallTimes

    expect(skipped(spring)).toEqual(['02:00', '02:30'])
    expect(skipped(autumn)).toEqual(['01:00', '01:30'])
    expect(skipped(ordinary)).toEqual([])
  })

  it('day bounds are whole LOCAL days: 23h in spring, 25h in autumn', async () => {
    const spring = await slotsFor(SPRING_FORWARD, LA)
    const autumn = await slotsFor(FALL_BACK, LA)
    const ordinary = await slotsFor(ORDINARY, LA)

    const hours = (r: { dayStartUtc: Date; dayEndExclusiveUtc: Date }) =>
      (r.dayEndExclusiveUtc.getTime() - r.dayStartUtc.getTime()) / 3_600_000

    expect(hours(spring)).toBe(23)
    expect(hours(autumn)).toBe(25)
    expect(hours(ordinary)).toBe(24)
  })
})

// Five IANA zones move their clocks AT local midnight. Before B6 the day bounds
// went through the strict wall-time converter, which refuses a nonexistent or
// ambiguous time — so asking for one of these days threw, and the route turned
// that into a 500 for the transition day AND the day before it.
describe('computeDayBoundsUtc / computeDaySlotsFast — midnight-transition zones', () => {
  const CASES = [
    ['America/Havana', { year: 2026, month: 3, day: 8 }, 23],
    ['America/Havana', { year: 2026, month: 11, day: 1 }, 25],
    ['America/Santiago', { year: 2026, month: 9, day: 6 }, 23],
    ['Atlantic/Azores', { year: 2026, month: 3, day: 29 }, 23],
    ['Africa/Cairo', { year: 2026, month: 4, day: 24 }, 23],
    ['Asia/Beirut', { year: 2026, month: 3, day: 29 }, 23],
  ] as const

  it.each(CASES)('computes bounds instead of throwing (%s)', (zone, ymd, hours) => {
    const bounds = computeDayBoundsUtc(ymd, zone)

    expect(
      (bounds.dayEndExclusiveUtc.getTime() - bounds.dayStartUtc.getTime()) /
        3_600_000,
    ).toBe(hours)

    const expectedYmd = `${ymd.year}-${String(ymd.month).padStart(2, '0')}-${String(ymd.day).padStart(2, '0')}`
    expect(utcDateToLocalYmd(bounds.dayStartUtc, zone)).toBe(expectedYmd)
  })

  it.each(CASES)('still generates a full grid of slots (%s)', async (zone, ymd) => {
    const result = await slotsFor(ymd, zone)

    expect(result.slots.length).toBeGreaterThan(40)
    // The hour the clocks skip is the first hour of the day in these zones, so
    // the grid opens at 01:00 rather than 00:00 on a spring transition.
    expect(result.slots.every((iso) => Number.isFinite(Date.parse(iso)))).toBe(
      true,
    )
  })
})

describe('localSlotToUtcOrNull', () => {
  it('resolves an ordinary wall time', () => {
    expect(
      localSlotToUtcOrNull({
        year: 2026,
        month: 6,
        day: 10,
        hour: 9,
        minute: 30,
        timeZone: LA,
      })?.toISOString(),
    ).toBe('2026-06-10T16:30:00.000Z')
  })

  it('returns null for a wall time that does not exist', () => {
    expect(
      localSlotToUtcOrNull({
        year: 2027,
        month: 3,
        day: 14,
        hour: 2,
        minute: 30,
        timeZone: LA,
      }),
    ).toBeNull()
  })

  it('returns null for a wall time that happens twice', () => {
    expect(
      localSlotToUtcOrNull({
        year: 2026,
        month: 11,
        day: 1,
        hour: 1,
        minute: 30,
        timeZone: LA,
      }),
    ).toBeNull()
  })
})
