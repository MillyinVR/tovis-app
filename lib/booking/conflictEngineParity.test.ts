// lib/booking/conflictEngineParity.test.ts
//
// PARITY / CHARACTERIZATION SPEC for the two scheduling-conflict engines.
//
// The codebase has two engines that compute a busy interval's END time from a
// start + duration + buffer:
//
//   Engine A — lib/booking/schedulingConflicts.ts  (findSchedulingConflicts)
//              via calculateWindowEnd(): NO clamping, NO duration fallback,
//              does NOT normalize the start to the minute.
//   Engine B — lib/booking/conflictQueries.ts      (getTimeRangeConflict)
//              via bookingToBusyInterval() (lib/booking/conflicts.ts): clamps
//              duration to [15, MAX_SLOT_DURATION_MINUTES], buffer to
//              [0, MAX_BUFFER_MINUTES], falls back to DEFAULT_DURATION_MINUTES
//              for invalid durations, and floors the start to the minute.
//
// The async query layers differ only in (a) this interval math and (b) the DB
// window/query mechanics; the BEHAVIORAL divergence is entirely in the math
// below. This file pins it so a future merge of the two engines is a conscious,
// test-guarded decision rather than a silent behavior change.
//
// Two kinds of assertions:
//   - AGREEMENT REGION: inputs where the engines already produce identical
//     results. A merged engine MUST preserve these.
//   - DIVERGENCE: inputs where they differ today, with the exact current
//     behavior of each pinned. A merge must consciously pick a winner here.

import { describe, expect, it } from 'vitest'

import { calculateWindowEnd } from '@/lib/booking/schedulingConflicts'
import { bookingToBusyInterval } from '@/lib/booking/conflicts'
import {
  DEFAULT_DURATION_MINUTES,
  MAX_BUFFER_MINUTES,
  MAX_SLOT_DURATION_MINUTES,
} from '@/lib/booking/constants'

const MS_PER_MIN = 60_000

// A whole-minute start (seconds + ms zeroed) — the only start precision where
// the two engines can agree, since Engine B floors to the minute.
const WHOLE_MINUTE_START = new Date('2026-06-20T15:00:00.000Z')

function engineAEnd(
  start: Date,
  durationMinutes: number | null,
  bufferMinutes: number | null,
): Date {
  return calculateWindowEnd({ startsAt: start, durationMinutes, bufferMinutes })
}

function engineBInterval(
  start: Date,
  durationMinutes: number | null,
  bufferMinutes: number | null,
) {
  return bookingToBusyInterval({
    scheduledFor: start,
    totalDurationMinutes: durationMinutes,
    bufferMinutes,
  })
}

function minutesAfter(start: Date, minutes: number): number {
  return start.getTime() + minutes * MS_PER_MIN
}

describe('conflict-engine parity: booking busy-interval math', () => {
  describe('AGREEMENT REGION — a merged engine must preserve these', () => {
    // duration ∈ [15, MAX_SLOT_DURATION_MINUTES], buffer ∈ [0, MAX_BUFFER_MINUTES],
    // whole-minute start: both engines must produce the same end time.
    const durations = [15, 30, 45, 60, 90, 240, MAX_SLOT_DURATION_MINUTES]
    const buffers = [0, 5, 10, 30, 60, MAX_BUFFER_MINUTES]

    for (const duration of durations) {
      for (const buffer of buffers) {
        it(`agree at duration=${duration}, buffer=${buffer}`, () => {
          const a = engineAEnd(WHOLE_MINUTE_START, duration, buffer)
          const b = engineBInterval(WHOLE_MINUTE_START, duration, buffer)

          // Both equal start + (duration + buffer) minutes.
          expect(a.getTime()).toBe(
            minutesAfter(WHOLE_MINUTE_START, duration + buffer),
          )
          expect(b.end.getTime()).toBe(a.getTime())
          // Engine B leaves a whole-minute start untouched.
          expect(b.start.getTime()).toBe(WHOLE_MINUTE_START.getTime())
        })
      }
    }

    it('agree when buffer is negative or zero (both treat as 0)', () => {
      for (const buffer of [0, -1, -30]) {
        const a = engineAEnd(WHOLE_MINUTE_START, 60, buffer)
        const b = engineBInterval(WHOLE_MINUTE_START, 60, buffer)
        expect(a.getTime()).toBe(minutesAfter(WHOLE_MINUTE_START, 60))
        expect(b.end.getTime()).toBe(a.getTime())
      }
    })
  })

  describe('DIVERGENCE — pinned current behavior; a merge must choose', () => {
    it('duration below the [15] floor: A uses raw, B clamps up to 15', () => {
      const a = engineAEnd(WHOLE_MINUTE_START, 10, 0)
      const b = engineBInterval(WHOLE_MINUTE_START, 10, 0)

      expect(a.getTime()).toBe(minutesAfter(WHOLE_MINUTE_START, 10))
      expect(b.end.getTime()).toBe(minutesAfter(WHOLE_MINUTE_START, 15))
      expect(b.end.getTime()).toBeGreaterThan(a.getTime())
    })

    it(`duration above the [${MAX_SLOT_DURATION_MINUTES}] ceiling: A uses raw, B clamps down`, () => {
      const overMax = MAX_SLOT_DURATION_MINUTES + 80
      const a = engineAEnd(WHOLE_MINUTE_START, overMax, 0)
      const b = engineBInterval(WHOLE_MINUTE_START, overMax, 0)

      expect(a.getTime()).toBe(minutesAfter(WHOLE_MINUTE_START, overMax))
      expect(b.end.getTime()).toBe(
        minutesAfter(WHOLE_MINUTE_START, MAX_SLOT_DURATION_MINUTES),
      )
      expect(b.end.getTime()).toBeLessThan(a.getTime())
    })

    it(`zero/invalid duration: A contributes 0, B falls back to ${DEFAULT_DURATION_MINUTES}`, () => {
      for (const badDuration of [0, null, -30]) {
        const a = engineAEnd(WHOLE_MINUTE_START, badDuration, 0)
        const b = engineBInterval(WHOLE_MINUTE_START, badDuration, 0)

        // Engine A: invalid duration => 0 contribution => end === start (+buffer 0).
        expect(a.getTime()).toBe(WHOLE_MINUTE_START.getTime())
        // Engine B: invalid duration => fallback DEFAULT_DURATION_MINUTES.
        expect(b.end.getTime()).toBe(
          minutesAfter(WHOLE_MINUTE_START, DEFAULT_DURATION_MINUTES),
        )
      }
    })

    it(`buffer above the [${MAX_BUFFER_MINUTES}] ceiling: A uses raw, B clamps down`, () => {
      const overMax = MAX_BUFFER_MINUTES + 120
      const a = engineAEnd(WHOLE_MINUTE_START, 60, overMax)
      const b = engineBInterval(WHOLE_MINUTE_START, 60, overMax)

      expect(a.getTime()).toBe(minutesAfter(WHOLE_MINUTE_START, 60 + overMax))
      expect(b.end.getTime()).toBe(
        minutesAfter(WHOLE_MINUTE_START, 60 + MAX_BUFFER_MINUTES),
      )
      expect(b.end.getTime()).toBeLessThan(a.getTime())
    })

    it('sub-minute start: A keeps the seconds, B floors the start to the minute', () => {
      const startWithSeconds = new Date('2026-06-20T15:00:30.000Z')
      const a = engineAEnd(startWithSeconds, 60, 0)
      const b = engineBInterval(startWithSeconds, 60, 0)

      // Engine A starts at :30 and ends 60m later at :30.
      expect(a.getTime()).toBe(minutesAfter(startWithSeconds, 60))

      // Engine B floors start to :00, so its interval is shifted 30s earlier.
      const flooredStart = new Date('2026-06-20T15:00:00.000Z')
      expect(b.start.getTime()).toBe(flooredStart.getTime())
      expect(b.end.getTime()).toBe(minutesAfter(flooredStart, 60))
      expect(a.getTime() - b.end.getTime()).toBe(30_000)
    })
  })

  describe('hold fallback-end note', () => {
    // Engine A resolves a hold end via calculateWindowEnd({ fallbackEndsAt }):
    // when a snapshot end is present it is returned verbatim, bypassing the
    // duration/buffer math. Engine B's hold path (holdRecordToBusyInterval in
    // conflictQueries.ts) likewise prefers endsAtSnapshot verbatim, so the
    // snapshot path AGREES; divergence only resurfaces on the no-snapshot path
    // through the same duration/buffer clamping pinned above.
    it('A returns a present fallback end verbatim (snapshot path)', () => {
      const snapshotEnd = new Date('2026-06-20T16:23:45.000Z')
      const end = calculateWindowEnd({
        startsAt: WHOLE_MINUTE_START,
        durationMinutes: 9999,
        bufferMinutes: 9999,
        fallbackEndsAt: snapshotEnd,
      })
      expect(end.getTime()).toBe(snapshotEnd.getTime())
    })
  })
})
