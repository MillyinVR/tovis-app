// lib/looks/availabilityStats.test.ts
//
// Pure-function coverage for the availability primitive summary math
// (personalization spec §4.2/§4.4). The DB refresh + reader are exercised by
// tests/integration/pro-availability-stats.test.ts against real Postgres.

import { describe, expect, it } from 'vitest'

import {
  PRO_AVAILABILITY_STAT,
  computeProAvailabilitySummary,
  intervalOverlapMinutes,
  type OccupancyInterval,
} from '@/lib/looks/availabilityStats'

// A fixed winter instant so PST (UTC-8) is unambiguous (no DST). Local time is
// 2026-01-14 06:00 America/Los_Angeles → the workday hasn't started, so day 0
// offers its full window.
const NOW_EARLY = new Date('2026-01-14T14:00:00.000Z')
const TZ = 'America/Los_Angeles'

// Every weekday open 09:00–17:00 → 480 minutes of capacity per day.
const ALWAYS_OPEN = {
  sun: { enabled: true, start: '09:00', end: '17:00' },
  mon: { enabled: true, start: '09:00', end: '17:00' },
  tue: { enabled: true, start: '09:00', end: '17:00' },
  wed: { enabled: true, start: '09:00', end: '17:00' },
  thu: { enabled: true, start: '09:00', end: '17:00' },
  fri: { enabled: true, start: '09:00', end: '17:00' },
  sat: { enabled: true, start: '09:00', end: '17:00' },
}

// Local wall time (PST) → the UTC instant, for building occupancy fixtures.
function pst(iso: string): Date {
  // PST is UTC-8; append the offset so the Date parses to the right instant.
  return new Date(`${iso}-08:00`)
}

const DAY0_LOCAL_MIDNIGHT_UTC = '2026-01-14T08:00:00.000Z'
const DAY1_LOCAL_MIDNIGHT_UTC = '2026-01-15T08:00:00.000Z'
const CAPACITY_PER_DAY = 480
const CAPACITY_14D = CAPACITY_PER_DAY * PRO_AVAILABILITY_STAT.fullnessWindowDays

describe('intervalOverlapMinutes', () => {
  it('returns the overlap in minutes for intersecting intervals', () => {
    const overlap = intervalOverlapMinutes(
      new Date('2026-01-14T17:00:00.000Z'),
      new Date('2026-01-14T18:00:00.000Z'),
      new Date('2026-01-14T17:30:00.000Z'),
      new Date('2026-01-14T19:00:00.000Z'),
    )
    expect(overlap).toBe(30)
  })

  it('returns 0 for disjoint or merely touching intervals', () => {
    expect(
      intervalOverlapMinutes(
        new Date('2026-01-14T10:00:00.000Z'),
        new Date('2026-01-14T11:00:00.000Z'),
        new Date('2026-01-14T11:00:00.000Z'),
        new Date('2026-01-14T12:00:00.000Z'),
      ),
    ).toBe(0)
    expect(
      intervalOverlapMinutes(
        new Date('2026-01-14T10:00:00.000Z'),
        new Date('2026-01-14T11:00:00.000Z'),
        new Date('2026-01-14T12:00:00.000Z'),
        new Date('2026-01-14T13:00:00.000Z'),
      ),
    ).toBe(0)
  })

  it('returns the contained interval length and 0 on invalid dates', () => {
    expect(
      intervalOverlapMinutes(
        new Date('2026-01-14T10:00:00.000Z'),
        new Date('2026-01-14T10:30:00.000Z'),
        new Date('2026-01-14T09:00:00.000Z'),
        new Date('2026-01-14T17:00:00.000Z'),
      ),
    ).toBe(30)
    expect(
      intervalOverlapMinutes(
        new Date('invalid'),
        new Date('2026-01-14T10:30:00.000Z'),
        new Date('2026-01-14T09:00:00.000Z'),
        new Date('2026-01-14T17:00:00.000Z'),
      ),
    ).toBe(0)
  })
})

describe('computeProAvailabilitySummary', () => {
  it('a wide-open calendar: first day is the next opening, zero fullness', () => {
    const summary = computeProAvailabilitySummary({
      now: NOW_EARLY,
      timeZone: TZ,
      workingHours: ALWAYS_OPEN,
      occupancy: [],
    })

    expect(summary.nextOpeningDate?.toISOString()).toBe(DAY0_LOCAL_MIDNIGHT_UTC)
    expect(summary.openDayCount14d).toBe(14)
    expect(summary.fullness14d).toBe(0)
    expect(summary.capacityMinutes14d).toBe(CAPACITY_14D)
    expect(summary.bookedMinutes14d).toBe(0)
  })

  it('a fully-booked first day pushes the next opening to day 1 and lifts fullness', () => {
    // A booking spanning the whole 09:00–17:00 window today.
    const occupancy: OccupancyInterval[] = [
      { startUtc: pst('2026-01-14T09:00:00'), endUtc: pst('2026-01-14T17:00:00') },
    ]

    const summary = computeProAvailabilitySummary({
      now: NOW_EARLY,
      timeZone: TZ,
      workingHours: ALWAYS_OPEN,
      occupancy,
    })

    expect(summary.nextOpeningDate?.toISOString()).toBe(DAY1_LOCAL_MIDNIGHT_UTC)
    expect(summary.openDayCount14d).toBe(13)
    expect(summary.bookedMinutes14d).toBe(CAPACITY_PER_DAY)
    expect(summary.capacityMinutes14d).toBe(CAPACITY_14D)
    expect(summary.fullness14d).toBeCloseTo(CAPACITY_PER_DAY / CAPACITY_14D, 5)
  })

  it('no working hours anywhere: no opening, zero capacity and fullness', () => {
    const closed = Object.fromEntries(
      Object.keys(ALWAYS_OPEN).map((k) => [
        k,
        { enabled: false, start: '09:00', end: '17:00' },
      ]),
    )

    const summary = computeProAvailabilitySummary({
      now: NOW_EARLY,
      timeZone: TZ,
      workingHours: closed,
      occupancy: [],
    })

    expect(summary.nextOpeningDate).toBeNull()
    expect(summary.openDayCount14d).toBe(0)
    expect(summary.capacityMinutes14d).toBe(0)
    expect(summary.fullness14d).toBe(0)
  })

  it('a nearly-full day below the opening floor does not count as an opening', () => {
    // Leave only 20 spare minutes today (< minOpeningMinutes = 30).
    const spare = PRO_AVAILABILITY_STAT.minOpeningMinutes - 10
    const bookedEnd = pst('2026-01-14T17:00:00').getTime() - spare * 60_000
    const occupancy: OccupancyInterval[] = [
      { startUtc: pst('2026-01-14T09:00:00'), endUtc: new Date(bookedEnd) },
    ]

    const summary = computeProAvailabilitySummary({
      now: NOW_EARLY,
      timeZone: TZ,
      workingHours: ALWAYS_OPEN,
      occupancy,
    })

    expect(summary.nextOpeningDate?.toISOString()).toBe(DAY1_LOCAL_MIDNIGHT_UTC)
    expect(summary.openDayCount14d).toBe(13)
  })

  it('a partial calendar block reduces fullness without closing the day', () => {
    // A 2h block today (still 6h spare) — day stays open, booked reflects it.
    const occupancy: OccupancyInterval[] = [
      { startUtc: pst('2026-01-14T09:00:00'), endUtc: pst('2026-01-14T11:00:00') },
    ]

    const summary = computeProAvailabilitySummary({
      now: NOW_EARLY,
      timeZone: TZ,
      workingHours: ALWAYS_OPEN,
      occupancy,
    })

    expect(summary.nextOpeningDate?.toISOString()).toBe(DAY0_LOCAL_MIDNIGHT_UTC)
    expect(summary.openDayCount14d).toBe(14)
    expect(summary.bookedMinutes14d).toBe(120)
  })

  it('floors an already-elapsed part of today so only remaining capacity counts', () => {
    // now = 15:00 local → today only offers 15:00–17:00 (120 min).
    const nowLate = new Date('2026-01-14T23:00:00.000Z')
    const summary = computeProAvailabilitySummary({
      now: nowLate,
      timeZone: TZ,
      workingHours: ALWAYS_OPEN,
      occupancy: [],
    })

    // Day 0 contributes 120, days 1–13 contribute 480 each.
    expect(summary.capacityMinutes14d).toBe(120 + 13 * CAPACITY_PER_DAY)
    expect(summary.nextOpeningDate?.toISOString()).toBe(DAY0_LOCAL_MIDNIGHT_UTC)
  })
})
