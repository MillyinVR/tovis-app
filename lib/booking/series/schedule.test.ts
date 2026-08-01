// lib/booking/series/schedule.test.ts
//
// K18 — the recurrence generator, with the clock PINNED.
//
// Every case below names an absolute date on purpose. A suite that passes in
// August and fails in November is the bug this module exists to prevent, so
// nothing here reads `new Date()` and every DST assertion carries the UTC
// instant it expects, not "an hour later than the last one".

import { describe, expect, it } from 'vitest'

import {
  computeSeriesOccurrenceInstants,
  countOccurrencesToMaterialize,
  resolveLocalWallTimeInZone,
  SERIES_MATERIALIZE_HORIZON,
} from './schedule'

const LA = 'America/Los_Angeles'

/** Friday 30 Oct 2026, 9:00am PDT — one week before the fall-back Sunday. */
const FRIDAY_9AM_BEFORE_FALL_BACK = new Date('2026-10-30T16:00:00.000Z')

/** Sunday 1 Mar 2026, 2:30am PST — one week before the spring-forward Sunday. */
const SUNDAY_230AM_BEFORE_SPRING_FORWARD = new Date('2026-03-01T10:30:00.000Z')

/** Sunday 25 Oct 2026, 1:30am PDT — one week before the fall-back Sunday. */
const SUNDAY_130AM_BEFORE_FALL_BACK = new Date('2026-10-25T08:30:00.000Z')

describe('computeSeriesOccurrenceInstants — DST', () => {
  it('keeps the LOCAL 9am across the fall-back boundary (not +7×24h)', () => {
    const instants = computeSeriesOccurrenceInstants({
      recurrence: {
        anchorAt: FRIDAY_9AM_BEFORE_FALL_BACK,
        timeZone: LA,
        intervalWeeks: 1,
      },
      fromIndex: 0,
      count: 2,
    })

    expect(instants[0]).toEqual({
      kind: 'EXACT',
      index: 0,
      at: FRIDAY_9AM_BEFORE_FALL_BACK,
    })

    // Friday 6 Nov 2026 is PST (UTC-8), so 9am local is 17:00Z. Naive
    // millisecond arithmetic would have produced 16:00Z — 8am, an hour early,
    // for every occurrence for the next four months.
    expect(instants[1]).toEqual({
      kind: 'EXACT',
      index: 1,
      at: new Date('2026-11-06T17:00:00.000Z'),
    })

    // Stated as elapsed time, which is the crux: one calendar week apart is
    // seven days AND AN HOUR of real time here. Anything asserting 7×24h is
    // asserting the bug.
    const second = instants[1]
    if (second === undefined || second.kind === 'NONEXISTENT') {
      throw new Error('expected occurrence 1 to resolve to an instant')
    }
    expect(
      second.at.getTime() - FRIDAY_9AM_BEFORE_FALL_BACK.getTime(),
    ).toBe(7 * 24 * 60 * 60_000 + 60 * 60_000)
  })

  it('keeps the LOCAL 9am across the spring-forward boundary', () => {
    // Friday 6 Mar 2026 9:00am PST = 17:00Z; the next Friday is PDT.
    const anchorAt = new Date('2026-03-06T17:00:00.000Z')

    const instants = computeSeriesOccurrenceInstants({
      recurrence: { anchorAt, timeZone: LA, intervalWeeks: 1 },
      fromIndex: 0,
      count: 2,
    })

    expect(instants[1]).toEqual({
      kind: 'EXACT',
      index: 1,
      at: new Date('2026-03-13T16:00:00.000Z'),
    })
  })

  it('SKIPS an occurrence whose wall time does not exist, and never shifts it', () => {
    const instants = computeSeriesOccurrenceInstants({
      recurrence: {
        anchorAt: SUNDAY_230AM_BEFORE_SPRING_FORWARD,
        timeZone: LA,
        intervalWeeks: 1,
      },
      fromIndex: 0,
      count: 3,
    })

    // 8 Mar 2026 02:30 local does not exist in Los Angeles — the clocks go
    // 01:59:59 → 03:00:00.
    expect(instants[1]).toEqual({
      kind: 'NONEXISTENT',
      index: 1,
      localWallTime: '2026-03-08T02:30',
    })

    // 3:30am would have been the "helpful" answer. It is a different
    // appointment, so it must not appear anywhere in the output.
    expect(
      instants.some(
        (i) =>
          i.kind !== 'NONEXISTENT' &&
          i.at.toISOString() === '2026-03-08T10:30:00.000Z',
      ),
    ).toBe(false)

    // The series carries on: the week after is an ordinary 2:30am PDT.
    expect(instants[2]).toEqual({
      kind: 'EXACT',
      index: 2,
      at: new Date('2026-03-15T09:30:00.000Z'),
    })
  })

  it('takes the FIRST instant when the wall time happens twice', () => {
    const instants = computeSeriesOccurrenceInstants({
      recurrence: {
        anchorAt: SUNDAY_130AM_BEFORE_FALL_BACK,
        timeZone: LA,
        intervalWeeks: 1,
      },
      fromIndex: 0,
      count: 2,
    })

    // 1 Nov 2026 01:30 local happens at 08:30Z (PDT) and again at 09:30Z (PST).
    expect(instants[1]).toEqual({
      kind: 'AMBIGUOUS',
      index: 1,
      at: new Date('2026-11-01T08:30:00.000Z'),
    })
  })

  it('is stable under a zone that never changes its clocks', () => {
    const anchorAt = new Date('2026-10-30T16:00:00.000Z')

    const instants = computeSeriesOccurrenceInstants({
      recurrence: { anchorAt, timeZone: 'UTC', intervalWeeks: 1 },
      fromIndex: 0,
      count: 3,
    })

    expect(instants.map((i) => (i.kind === 'NONEXISTENT' ? null : i.at.toISOString()))).toEqual([
      '2026-10-30T16:00:00.000Z',
      '2026-11-06T16:00:00.000Z',
      '2026-11-13T16:00:00.000Z',
    ])
  })
})

describe('computeSeriesOccurrenceInstants — cadence + windowing', () => {
  it('steps fortnightly when intervalWeeks is 2', () => {
    const anchorAt = new Date('2026-06-05T16:00:00.000Z')

    const instants = computeSeriesOccurrenceInstants({
      recurrence: { anchorAt, timeZone: LA, intervalWeeks: 2 },
      fromIndex: 0,
      count: 3,
    })

    expect(instants.map((i) => (i.kind === 'NONEXISTENT' ? null : i.at.toISOString()))).toEqual([
      '2026-06-05T16:00:00.000Z',
      '2026-06-19T16:00:00.000Z',
      '2026-07-03T16:00:00.000Z',
    ])
  })

  it('resumes from an arbitrary index without recomputing the earlier ones', () => {
    const recurrence = {
      anchorAt: FRIDAY_9AM_BEFORE_FALL_BACK,
      timeZone: LA,
      intervalWeeks: 1,
    }

    const all = computeSeriesOccurrenceInstants({
      recurrence,
      fromIndex: 0,
      count: 6,
    })
    const tail = computeSeriesOccurrenceInstants({
      recurrence,
      fromIndex: 4,
      count: 2,
    })

    // K20's roll-forward continues from nextOccurrenceIndex; the instants it
    // computes must be byte-identical to the ones the first pass would have.
    expect(tail).toEqual(all.slice(4))
  })

  it('anchors index 0 on the exact instant the pro picked', () => {
    // A 09:07 anchor is not on any slot grid; the series must not round it.
    const anchorAt = new Date('2026-06-05T16:07:00.000Z')

    const [first] = computeSeriesOccurrenceInstants({
      recurrence: { anchorAt, timeZone: LA, intervalWeeks: 1 },
      fromIndex: 0,
      count: 1,
    })

    expect(first).toEqual({ kind: 'EXACT', index: 0, at: anchorAt })
  })
})

describe('resolveLocalWallTimeInZone', () => {
  it('classifies the three cases in one zone', () => {
    expect(
      resolveLocalWallTimeInZone({
        year: 2026,
        month: 3,
        day: 8,
        hour: 2,
        minute: 30,
        timeZone: LA,
      }),
    ).toEqual({ kind: 'NONEXISTENT' })

    expect(
      resolveLocalWallTimeInZone({
        year: 2026,
        month: 11,
        day: 1,
        hour: 1,
        minute: 30,
        timeZone: LA,
      }),
    ).toEqual({ kind: 'AMBIGUOUS', at: new Date('2026-11-01T08:30:00.000Z') })

    expect(
      resolveLocalWallTimeInZone({
        year: 2026,
        month: 7,
        day: 1,
        hour: 9,
        minute: 0,
        timeZone: LA,
      }),
    ).toEqual({ kind: 'EXACT', at: new Date('2026-07-01T16:00:00.000Z') })
  })

  it('handles a southern-hemisphere zone, where the transitions invert', () => {
    // Sydney springs forward on the first Sunday in October: 2:00 → 3:00.
    expect(
      resolveLocalWallTimeInZone({
        year: 2026,
        month: 10,
        day: 4,
        hour: 2,
        minute: 30,
        timeZone: 'Australia/Sydney',
      }),
    ).toEqual({ kind: 'NONEXISTENT' })

    // …and falls back on the first Sunday in April: 3:00 → 2:00, so 2:30 runs
    // twice. The first is still AEDT (UTC+11) = 15:30Z the previous day.
    expect(
      resolveLocalWallTimeInZone({
        year: 2026,
        month: 4,
        day: 5,
        hour: 2,
        minute: 30,
        timeZone: 'Australia/Sydney',
      }),
    ).toEqual({ kind: 'AMBIGUOUS', at: new Date('2026-04-04T15:30:00.000Z') })
  })

  it('handles a half-hour DST shift (Lord Howe moves the clock 30 minutes)', () => {
    // Lord Howe Island springs forward 2:00 → 2:30 on the first Sunday in
    // October, so 2:15 is the gap.
    expect(
      resolveLocalWallTimeInZone({
        year: 2026,
        month: 10,
        day: 4,
        hour: 2,
        minute: 15,
        timeZone: 'Australia/Lord_Howe',
      }),
    ).toEqual({ kind: 'NONEXISTENT' })
  })
})

describe('countOccurrencesToMaterialize', () => {
  it('fills the horizon for an open-ended series', () => {
    expect(
      countOccurrencesToMaterialize({
        nextOccurrenceIndex: 0,
        occurrenceCount: null,
      }),
    ).toBe(SERIES_MATERIALIZE_HORIZON)
  })

  it('never exceeds the planned total', () => {
    expect(
      countOccurrencesToMaterialize({
        nextOccurrenceIndex: 0,
        occurrenceCount: 5,
      }),
    ).toBe(5)

    expect(
      countOccurrencesToMaterialize({
        nextOccurrenceIndex: 3,
        occurrenceCount: 5,
      }),
    ).toBe(2)
  })

  it('answers zero once the series has run out', () => {
    expect(
      countOccurrencesToMaterialize({
        nextOccurrenceIndex: 5,
        occurrenceCount: 5,
      }),
    ).toBe(0)

    expect(
      countOccurrencesToMaterialize({
        nextOccurrenceIndex: 9,
        occurrenceCount: 5,
      }),
    ).toBe(0)
  })

  it('caps a long series at the horizon per pass', () => {
    expect(
      countOccurrencesToMaterialize({
        nextOccurrenceIndex: 0,
        occurrenceCount: 104,
      }),
    ).toBe(SERIES_MATERIALIZE_HORIZON)
  })
})
