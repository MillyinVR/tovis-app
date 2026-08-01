import { describe, expect, it } from 'vitest'
import { BookingStatus } from '@prisma/client'

import {
  classifySeriesOccurrenceCancel,
  type SeriesOccurrenceCancelCandidate,
} from './cancelScope'

const NOW = new Date('2026-09-01T17:00:00.000Z')
const FUTURE = new Date('2026-09-15T17:00:00.000Z')
const PAST = new Date('2026-08-15T17:00:00.000Z')

function candidate(
  overrides: Partial<SeriesOccurrenceCancelCandidate> = {},
): SeriesOccurrenceCancelCandidate {
  return {
    occurrenceIndex: 3,
    status: BookingStatus.ACCEPTED,
    startedAt: null,
    scheduledFor: FUTURE,
    ...overrides,
  }
}

describe('classifySeriesOccurrenceCancel', () => {
  it('cancels an untouched future occurrence', () => {
    expect(
      classifySeriesOccurrenceCancel(candidate(), { scope: 'ALL', now: NOW }),
    ).toEqual({ cancellable: true })
  })

  it('cancels a PENDING future occurrence too', () => {
    expect(
      classifySeriesOccurrenceCancel(
        candidate({ status: BookingStatus.PENDING }),
        { scope: 'ALL', now: NOW },
      ),
    ).toEqual({ cancellable: true })
  })

  // 🔴 The decision the step had to make: "all" cannot mean the same thing for
  // an occurrence that already happened as for an untouched future one. Each of
  // these would be a rewritten history, a cancelled visit mid-session, or a
  // retroactive cancel of a date that has been and gone.
  it.each([
    [
      'a completed visit',
      { status: BookingStatus.COMPLETED, scheduledFor: PAST },
      'ALREADY_HAPPENED',
    ],
    [
      'a no-show',
      { status: BookingStatus.NO_SHOW, scheduledFor: PAST },
      'ALREADY_HAPPENED',
    ],
    [
      'an already-cancelled occurrence',
      { status: BookingStatus.CANCELLED },
      'ALREADY_CANCELLED',
    ],
    [
      'a session in progress',
      { status: BookingStatus.IN_PROGRESS, startedAt: NOW },
      'IN_PROGRESS',
    ],
    [
      'an ACCEPTED row whose session was started',
      { status: BookingStatus.ACCEPTED, startedAt: NOW },
      'IN_PROGRESS',
    ],
    [
      'a past date nobody ever started',
      { status: BookingStatus.ACCEPTED, scheduledFor: PAST },
      'IN_PAST',
    ],
  ])('leaves %s alone', (_label, overrides, reason) => {
    expect(
      classifySeriesOccurrenceCancel(candidate(overrides), {
        scope: 'ALL',
        now: NOW,
      }),
    ).toEqual({ cancellable: false, reason })
  })

  it('treats the occurrence exactly at `now` as past, not future', () => {
    expect(
      classifySeriesOccurrenceCancel(candidate({ scheduledFor: NOW }), {
        scope: 'ALL',
        now: NOW,
      }),
    ).toEqual({ cancellable: false, reason: 'IN_PAST' })
  })

  describe('THIS_AND_FUTURE', () => {
    it('excludes an earlier occurrence, even a perfectly cancellable one', () => {
      expect(
        classifySeriesOccurrenceCancel(candidate({ occurrenceIndex: 2 }), {
          scope: 'THIS_AND_FUTURE',
          fromOccurrenceIndex: 3,
          now: NOW,
        }),
      ).toEqual({ cancellable: false, reason: 'OUT_OF_SCOPE' })
    })

    it('includes the occurrence it was invoked from', () => {
      expect(
        classifySeriesOccurrenceCancel(candidate({ occurrenceIndex: 3 }), {
          scope: 'THIS_AND_FUTURE',
          fromOccurrenceIndex: 3,
          now: NOW,
        }),
      ).toEqual({ cancellable: true })
    })

    it('includes every later occurrence', () => {
      expect(
        classifySeriesOccurrenceCancel(candidate({ occurrenceIndex: 9 }), {
          scope: 'THIS_AND_FUTURE',
          fromOccurrenceIndex: 3,
          now: NOW,
        }),
      ).toEqual({ cancellable: true })
    })

    // The scope's own answer wins for a row it excluded: the pro asked "why
    // didn't the call I just made touch this", and "you cancelled from #4" is
    // that answer, whatever else is true of #2.
    it('reports OUT_OF_SCOPE for an earlier occurrence that also already happened', () => {
      expect(
        classifySeriesOccurrenceCancel(
          candidate({
            occurrenceIndex: 0,
            status: BookingStatus.COMPLETED,
            scheduledFor: PAST,
          }),
          { scope: 'THIS_AND_FUTURE', fromOccurrenceIndex: 3, now: NOW },
        ),
      ).toEqual({ cancellable: false, reason: 'OUT_OF_SCOPE' })
    })

    // An indexless row (`seriesOccurrenceIndex` is nullable on Booking, so the
    // callers pass -1) must fall OUT of every scope rather than into all of
    // them, which a 0 default would do.
    it('excludes an indexless row from THIS_AND_FUTURE', () => {
      expect(
        classifySeriesOccurrenceCancel(candidate({ occurrenceIndex: -1 }), {
          scope: 'THIS_AND_FUTURE',
          fromOccurrenceIndex: 0,
          now: NOW,
        }),
      ).toEqual({ cancellable: false, reason: 'OUT_OF_SCOPE' })
    })
  })
})
