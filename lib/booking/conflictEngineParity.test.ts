// lib/booking/conflictEngineParity.test.ts
//
// REGRESSION GUARD for the unified scheduling-conflict busy-interval math.
//
// The codebase used to have TWO engines that computed how much time a booking or
// hold occupies:
//   Engine A — lib/booking/schedulingConflicts.ts (findSchedulingConflicts, the
//              WRITE-BOUNDARY gate) via a local calculateWindowEnd.
//   Engine B — lib/booking/conflictQueries.ts (getTimeRangeConflict, the
//              availability/hold/policy reads) via lib/booking/conflicts.ts.
//
// Engine A is gone (F3). `findBookingAndHoldConflicts` in conflictQueries.ts now
// serves the write boundary from the same primitives every other conflict read
// uses, so a booking and a hold occupy the same window no matter who asks.
//
// What still needs pinning is the invariant that outlives the deletion: every
// runtime busy window must be >= the durable database EXCLUDE range for the same
// row, or availability can clear a slot Postgres then rejects with a raw 23P01.
// Engine A carried that floor for holds (GREATEST(1, dur+buf)); Engine B never
// did, and Engine B is the one that survived.

import { describe, expect, it } from 'vitest'

import { ServiceLocationType } from '@prisma/client'

import {
  bookingToBusyInterval,
  sqlBusyWindowMinutes,
} from '@/lib/booking/conflicts'
import { holdRecordToBusyInterval } from '@/lib/booking/conflictQueries'
import {
  DEFAULT_DURATION_MINUTES,
  MAX_BUFFER_MINUTES,
  MAX_SLOT_DURATION_MINUTES,
} from '@/lib/booking/constants'

describe('conflict-engine unification: busy-interval math', () => {
  describe('booking busy-interval never under-reserves against the DB EXCLUDE floor', () => {
    const start = new Date('2026-06-20T15:00:00.000Z')
    // In-range values AND the inputs the two engines used to disagree on: below
    // the [15] floor, above the [MAX_SLOT] ceiling, zero/negative duration, and
    // buffer above the [MAX_BUFFER] ceiling.
    const durations = [
      15,
      30,
      60,
      90,
      MAX_SLOT_DURATION_MINUTES,
      10, // below floor
      0, // invalid -> fallback
      -30, // invalid -> fallback
    ]
    const buffers = [0, 10, 60, MAX_BUFFER_MINUTES]

    for (const duration of durations) {
      for (const buffer of buffers) {
        it(`reserves >= the SQL floor at duration=${duration}, buffer=${buffer}`, () => {
          const interval = bookingToBusyInterval({
            scheduledFor: start,
            totalDurationMinutes: duration,
            bufferMinutes: buffer,
          })

          expect(
            (interval.end.getTime() - interval.start.getTime()) / 60_000,
          ).toBeGreaterThanOrEqual(sqlBusyWindowMinutes(duration, buffer))
        })
      }
    }

    it('floors a sub-minute start to the minute', () => {
      const startWithSeconds = new Date('2026-06-20T15:00:30.000Z')
      const interval = bookingToBusyInterval({
        scheduledFor: startWithSeconds,
        totalDurationMinutes: 60,
        bufferMinutes: 0,
      })

      expect(interval.start.toISOString()).toBe('2026-06-20T15:00:00.000Z')
    })
  })

  // The HOLD path was never reconciled when the booking path was. Engine A
  // mapped a hold with no `endsAtSnapshot` through a local `calculateWindowEnd`
  // (GREATEST(1, dur+buf) — as little as ONE MINUTE when both snapshots were
  // null) while Engine B fell back to the offering's real duration. Engine A was
  // the write-boundary gate, so the write boundary could book straight over a
  // hold that availability correctly showed as busy.
  //
  // F3 deletes Engine A, which removes the divergence by construction. What
  // survives it — and is asserted here — is the invariant Engine A's floor was
  // carrying and Engine B never had: the single remaining builder must never
  // reserve LESS than the database EXCLUDE constraint for the same row.
  describe('hold busy-interval never under-reserves against the DB EXCLUDE floor', () => {
    const start = new Date('2026-06-20T15:00:00.000Z')

    function holdMinutes(
      durationMinutesSnapshot: number | null,
      bufferMinutesSnapshot: number | null,
      endsAtSnapshot: Date | null = null,
      offering: {
        salonDurationMinutes: number | null
        mobileDurationMinutes: number | null
      } | null = null,
    ) {
      const interval = holdRecordToBusyInterval({
        hold: {
          scheduledFor: start,
          locationType: ServiceLocationType.SALON,
          endsAtSnapshot,
          durationMinutesSnapshot,
          bufferMinutesSnapshot,
          offering,
          location: null,
        },
        defaultBufferMinutes: 0,
        fallbackDurationMinutes: DEFAULT_DURATION_MINUTES,
      })

      return (interval.end.getTime() - interval.start.getTime()) / 60_000
    }

    // `tovis_booking_overlap_range` keys off the SNAPSHOT COLUMNS, so these are
    // the inputs the database itself uses to decide what the row occupies.
    const cases: Array<{
      name: string
      duration: number | null
      buffer: number | null
    }> = [
      { name: 'typical service + buffer', duration: 60, buffer: 15 },
      { name: 'no buffer', duration: 90, buffer: 0 },
      { name: 'null buffer', duration: 45, buffer: null },
      { name: 'both snapshots null (legacy row)', duration: null, buffer: 20 },
      { name: 'duration and buffer both null', duration: null, buffer: null },
      { name: 'zero duration and buffer', duration: 0, buffer: 0 },
      { name: 'zero duration, real buffer', duration: 0, buffer: 10 },
    ]

    for (const testCase of cases) {
      it(`${testCase.name}: reserves >= the SQL floor`, () => {
        expect(
          holdMinutes(testCase.duration, testCase.buffer),
        ).toBeGreaterThanOrEqual(
          sqlBusyWindowMinutes(testCase.duration, testCase.buffer),
        )
      })
    }

    it('honours endsAtSnapshot when it is longer than the SQL floor', () => {
      const endsAt = new Date(start.getTime() + 75 * 60_000)
      expect(holdMinutes(60, 15, endsAt)).toBe(75)
    })

    it('does not let a short endsAtSnapshot under-reserve the DB range', () => {
      // The constraint would treat this row as occupying 60+15, so clearing the
      // slot on the strength of a 5-minute endsAtSnapshot earns a raw 23P01.
      const shortEndsAt = new Date(start.getTime() + 5 * 60_000)
      expect(holdMinutes(60, 15, shortEndsAt)).toBeGreaterThanOrEqual(75)
    })

    it('falls back to the offering duration when snapshots are absent', () => {
      expect(
        holdMinutes(null, null, null, {
          salonDurationMinutes: 90,
          mobileDurationMinutes: 120,
        }),
      ).toBe(90)
    })
  })

  describe('production-realistic rows are unchanged by the unification', () => {
    // Real bookings and holds carry validated, in-range, minute-aligned values,
    // so the unified math must equal the simple start + (duration + buffer)
    // result — the floor above must never inflate a well-formed window.
    const start = new Date('2026-06-20T17:00:00.000Z')

    it('keeps the obvious window for an in-range minute-aligned booking', () => {
      const { start: s, end } = bookingToBusyInterval({
        scheduledFor: start,
        totalDurationMinutes: 50,
        bufferMinutes: 10,
      })
      expect(s.getTime()).toBe(start.getTime())
      expect(end.getTime()).toBe(start.getTime() + 60 * 60_000)
    })

    it('keeps the obvious window for a hold written by the live create path', () => {
      // performLockedCreateHold always stores all three snapshots, consistent
      // with one another (writeBoundary.ts, holdCreateData).
      const { start: s, end } = holdRecordToBusyInterval({
        hold: {
          scheduledFor: start,
          locationType: ServiceLocationType.SALON,
          durationMinutesSnapshot: 50,
          bufferMinutesSnapshot: 10,
          endsAtSnapshot: new Date(start.getTime() + 60 * 60_000),
        },
        defaultBufferMinutes: 0,
        fallbackDurationMinutes: DEFAULT_DURATION_MINUTES,
      })
      expect(s.getTime()).toBe(start.getTime())
      expect(end.getTime()).toBe(start.getTime() + 60 * 60_000)
    })
  })
})
