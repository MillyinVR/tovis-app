// lib/booking/occupancyInvariant.test.ts
//
// Invariant: a hold reserves EXACTLY the occupancy its finalized booking takes.
//
// A hold's busy window is derived from the offering's per-mode duration
// (salon vs mobile) plus the location buffer. When the hold is finalized, the
// booking snapshots that resolved duration + buffer into totalDurationMinutes /
// bufferMinutes. If the two ever computed a different window, a slot a client
// held could be double-booked at finalize, or the booking could leave a phantom
// gap the hold had reserved.
//
// This pins the two public interval builders to agree across the booking matrix.
// It is not tautological: `holdToBusyInterval` resolves the duration by picking
// the salon/mobile field for the location type, while `bookingToBusyInterval`
// reads a single stored total — different code paths that must converge on the
// same window (including identical clamping of out-of-range values).

import { describe, expect, it } from 'vitest'
import { ServiceLocationType } from '@prisma/client'
import {
  addMinutes,
  bookingToBusyInterval,
  holdToBusyInterval,
  normalizeToMinute,
} from '@/lib/booking/conflicts'
import {
  DEFAULT_DURATION_MINUTES,
  MAX_BUFFER_MINUTES,
  MAX_SLOT_DURATION_MINUTES,
} from '@/lib/booking/constants'

const START = new Date('2030-05-01T18:00:00.000Z')

type Scenario = {
  name: string
  locationType: ServiceLocationType
  salonDuration: number
  mobileDuration: number
  buffer: number
  // The minute-length the hold/booking window should resolve to, after the
  // shared clamping rules in durationOrFallback / bufferOrZero.
  expectedMinutes: number
}

const MIN_DURATION = 15

const SCENARIOS: Scenario[] = [
  {
    name: 'salon, distinct salon/mobile durations, with buffer',
    locationType: ServiceLocationType.SALON,
    salonDuration: 60,
    mobileDuration: 90,
    buffer: 15,
    expectedMinutes: 60 + 15,
  },
  {
    name: 'mobile picks the mobile duration',
    locationType: ServiceLocationType.MOBILE,
    salonDuration: 60,
    mobileDuration: 90,
    buffer: 0,
    expectedMinutes: 90 + 0,
  },
  {
    name: 'equal durations, large buffer',
    locationType: ServiceLocationType.SALON,
    salonDuration: 30,
    mobileDuration: 30,
    buffer: 30,
    expectedMinutes: 30 + 30,
  },
  {
    name: 'mobile, long service',
    locationType: ServiceLocationType.MOBILE,
    salonDuration: 45,
    mobileDuration: 120,
    buffer: 10,
    expectedMinutes: 120 + 10,
  },
  {
    name: 'below-minimum duration clamps up the same on both paths',
    locationType: ServiceLocationType.SALON,
    salonDuration: 5,
    mobileDuration: 5,
    buffer: 10,
    expectedMinutes: MIN_DURATION + 10,
  },
  {
    name: 'over-max buffer clamps the same on both paths',
    locationType: ServiceLocationType.MOBILE,
    salonDuration: 60,
    mobileDuration: 60,
    buffer: MAX_BUFFER_MINUTES + 120,
    expectedMinutes: 60 + MAX_BUFFER_MINUTES,
  },
]

describe('booking occupancy invariant: hold window == finalized booking window', () => {
  for (const scenario of SCENARIOS) {
    it(scenario.name, () => {
      const resolvedModeDuration =
        scenario.locationType === ServiceLocationType.MOBILE
          ? scenario.mobileDuration
          : scenario.salonDuration

      const holdInterval = holdToBusyInterval({
        hold: { scheduledFor: START, locationType: scenario.locationType },
        salonDurationMinutes: scenario.salonDuration,
        mobileDurationMinutes: scenario.mobileDuration,
        bufferMinutes: scenario.buffer,
      })

      // The finalized booking carries the resolved mode duration + buffer as its
      // snapshot — exactly what the write boundary copies from the hold.
      const bookingInterval = bookingToBusyInterval({
        scheduledFor: START,
        totalDurationMinutes: resolvedModeDuration,
        bufferMinutes: scenario.buffer,
      })

      // Same start...
      expect(bookingInterval.start.getTime()).toBe(holdInterval.start.getTime())
      // ...and, crucially, the same end: identical occupancy.
      expect(bookingInterval.end.getTime()).toBe(holdInterval.end.getTime())

      // And both equal the offering-derived window after shared clamping.
      const expectedEnd = addMinutes(
        normalizeToMinute(START),
        scenario.expectedMinutes,
      )
      expect(holdInterval.end.getTime()).toBe(expectedEnd.getTime())
    })
  }

  it('keeps the duration ceiling consistent across both paths', () => {
    const huge = MAX_SLOT_DURATION_MINUTES + 600

    const holdInterval = holdToBusyInterval({
      hold: { scheduledFor: START, locationType: ServiceLocationType.SALON },
      salonDurationMinutes: huge,
      mobileDurationMinutes: huge,
      bufferMinutes: 0,
    })
    const bookingInterval = bookingToBusyInterval({
      scheduledFor: START,
      totalDurationMinutes: huge,
      bufferMinutes: 0,
    })

    expect(bookingInterval.end.getTime()).toBe(holdInterval.end.getTime())
    expect(holdInterval.end.getTime()).toBe(
      addMinutes(normalizeToMinute(START), MAX_SLOT_DURATION_MINUTES).getTime(),
    )
  })

  it('falls back to the default duration identically when the offering duration is missing', () => {
    const holdInterval = holdToBusyInterval({
      hold: { scheduledFor: START, locationType: ServiceLocationType.SALON },
      salonDurationMinutes: null,
      mobileDurationMinutes: null,
      bufferMinutes: 20,
    })
    // A booking whose snapshot is missing falls back to the same default.
    const bookingInterval = bookingToBusyInterval({
      scheduledFor: START,
      totalDurationMinutes: null,
      bufferMinutes: 20,
    })

    expect(bookingInterval.end.getTime()).toBe(holdInterval.end.getTime())
    expect(holdInterval.end.getTime()).toBe(
      addMinutes(normalizeToMinute(START), DEFAULT_DURATION_MINUTES + 20).getTime(),
    )
  })
})
