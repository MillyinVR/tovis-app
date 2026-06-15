// lib/booking/conflictEngineParity.test.ts
//
// REGRESSION GUARD for the unified scheduling-conflict busy-interval math.
//
// The codebase used to have two engines that computed a booking's busy window
// differently:
//   Engine A — lib/booking/schedulingConflicts.ts (findSchedulingConflicts, the
//              write-boundary gate) via a local calculateWindowEnd: no clamping.
//   Engine B — lib/booking/conflictQueries.ts (getTimeRangeConflict, the
//              availability/hold/policy checks) via bookingToBusyInterval
//              (lib/booking/conflicts.ts): clamps duration to
//              [15, MAX_SLOT_DURATION_MINUTES], buffer to [0, MAX_BUFFER_MINUTES],
//              and floors the start to the minute.
//
// They could disagree on edge cases (out-of-range duration/buffer, sub-minute
// start), so availability could classify a window differently from the final
// write-boundary check. Engine A's BOOKING path now delegates to the canonical
// `bookingToBusyInterval`, so the two engines compute identical booking windows.
//
// This test pins that: `toBookingSchedulingConflict` (the write-boundary mapper)
// must produce the same interval as `bookingToBusyInterval` (the canonical
// helper) for ALL inputs — in-range AND the former-divergence edge cases.

import { describe, expect, it } from 'vitest'

import { toBookingSchedulingConflict } from '@/lib/booking/schedulingConflicts'
import { bookingToBusyInterval } from '@/lib/booking/conflicts'
import {
  MAX_BUFFER_MINUTES,
  MAX_SLOT_DURATION_MINUTES,
} from '@/lib/booking/constants'

const PRO_ID = 'pro_1'
const BOOKING_ID = 'booking_1'

function mapperInterval(
  scheduledFor: Date,
  totalDurationMinutes: number,
  bufferMinutes: number,
) {
  const conflict = toBookingSchedulingConflict({
    id: BOOKING_ID,
    professionalId: PRO_ID,
    scheduledFor,
    totalDurationMinutes,
    bufferMinutes,
  })
  return { start: conflict.startsAt, end: conflict.endsAt }
}

function canonicalInterval(
  scheduledFor: Date,
  totalDurationMinutes: number,
  bufferMinutes: number,
) {
  return bookingToBusyInterval({
    scheduledFor,
    totalDurationMinutes,
    bufferMinutes,
  })
}

describe('conflict-engine unification: booking busy-interval', () => {
  describe('write-boundary mapper matches the canonical bookingToBusyInterval', () => {
    const start = new Date('2026-06-20T15:00:00.000Z')
    // Include in-range values AND the inputs the two engines used to disagree
    // on: below the [15] floor, above the [MAX_SLOT] ceiling, zero/negative
    // duration, and buffer above the [MAX_BUFFER] ceiling.
    const durations = [
      15,
      30,
      60,
      90,
      MAX_SLOT_DURATION_MINUTES,
      10, // below floor
      MAX_SLOT_DURATION_MINUTES + 80, // above ceiling
      0, // invalid -> fallback
      -30, // invalid -> fallback
    ]
    const buffers = [0, 10, 60, MAX_BUFFER_MINUTES, MAX_BUFFER_MINUTES + 120]

    for (const duration of durations) {
      for (const buffer of buffers) {
        it(`agrees at duration=${duration}, buffer=${buffer}`, () => {
          const mapper = mapperInterval(start, duration, buffer)
          const canonical = canonicalInterval(start, duration, buffer)

          expect(mapper.start.getTime()).toBe(canonical.start.getTime())
          expect(mapper.end.getTime()).toBe(canonical.end.getTime())
        })
      }
    }

    it('floors a sub-minute start to the minute (matches the canonical helper)', () => {
      const startWithSeconds = new Date('2026-06-20T15:00:30.000Z')
      const mapper = mapperInterval(startWithSeconds, 60, 0)
      const canonical = canonicalInterval(startWithSeconds, 60, 0)

      expect(mapper.start.getTime()).toBe(canonical.start.getTime())
      expect(mapper.end.getTime()).toBe(canonical.end.getTime())
      // Confirm it really floored (start is at :00, not :30).
      expect(mapper.start.toISOString()).toBe('2026-06-20T15:00:00.000Z')
    })
  })

  describe('production-realistic bookings are unchanged by the unification', () => {
    // Real bookings carry validated, in-range, minute-aligned values, so the
    // unified math must equal the simple start + (duration + buffer) result.
    it('keeps the obvious window for in-range minute-aligned input', () => {
      const start = new Date('2026-06-20T17:00:00.000Z')
      const { start: s, end } = mapperInterval(start, 50, 10)
      expect(s.getTime()).toBe(start.getTime())
      expect(end.getTime()).toBe(start.getTime() + 60 * 60_000)
    })
  })
})
