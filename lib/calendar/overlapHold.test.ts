// lib/calendar/overlapHold.test.ts
//
// B5 — the pro's double-book warnings must SEE a client's live checkout.
//
// Two surfaces warn a pro that they are about to sit on someone else's time:
// the new-booking form's passive note and the calendar confirm modal's. Both
// read `/api/v1/pro/calendar`'s `events` array, which before B5 carried BOOKING
// and BLOCK only — so both were structurally silent about holds while the write
// path authorized the overlap (PRO_AUTHORIZED_OVERLAP) and the client was
// refused at their own confirm. [[reserving-a-slot-needs-a-surface]]

import { describe, expect, it } from 'vitest'

import {
  normalizeCalendarOverlapEvents,
  overlappingClientNamesForRange,
} from './overlap'
import { OVERLAP_FALLBACK_NAME, OVERLAP_HOLD_NAME } from './constants'

const HOLD_EVENT = {
  id: 'hold:hold-1',
  kind: 'HOLD',
  startsAt: '2030-01-15T18:00:00.000Z',
  endsAt: '2030-01-15T19:15:00.000Z',
  clientName: 'Held',
  status: 'HELD',
}

const BOOKING_EVENT = {
  id: 'booking-1',
  kind: 'BOOKING',
  startsAt: '2030-01-15T21:00:00.000Z',
  endsAt: '2030-01-15T22:00:00.000Z',
  clientName: 'Sam Rivera',
  status: 'ACCEPTED',
}

const BLOCK_EVENT = {
  id: 'block:block-1',
  kind: 'BLOCK',
  startsAt: '2030-01-15T18:00:00.000Z',
  endsAt: '2030-01-15T19:00:00.000Z',
  clientName: 'Personal',
  status: 'BLOCKED',
}

function normalize(events: unknown[]) {
  return normalizeCalendarOverlapEvents({
    data: { events },
    holdName: OVERLAP_HOLD_NAME,
  })
}

describe('normalizeCalendarOverlapEvents (B5)', () => {
  it('keeps a hold so the pro can be warned about it', () => {
    const normalized = normalize([HOLD_EVENT])

    expect(normalized).toHaveLength(1)
    expect(normalized[0]?.id).toBe('hold:hold-1')
  })

  // The anonymity decision has to survive into the warning sentence: "This
  // overlaps Held" would be both ugly and a tell.
  it('describes a hold with the neutral phrase, not its Held label', () => {
    const normalized = normalize([HOLD_EVENT])

    expect(normalized[0]?.clientName).toBe(OVERLAP_HOLD_NAME)
    expect(normalized[0]?.clientName).not.toBe('Held')
  })

  it('still drops the pro OWN blocked time', () => {
    const normalized = normalize([BLOCK_EVENT])

    expect(normalized).toHaveLength(0)
  })

  it('keeps bookings and holds together, blocks excluded', () => {
    const normalized = normalize([BOOKING_EVENT, BLOCK_EVENT, HOLD_EVENT])

    expect(normalized.map((event) => event.id)).toEqual([
      'booking-1',
      'hold:hold-1',
    ])
  })

  it('skips rows missing an id or either endpoint', () => {
    expect(normalize([{ ...HOLD_EVENT, id: '' }])).toHaveLength(0)
    expect(normalize([{ ...HOLD_EVENT, startsAt: undefined }])).toHaveLength(0)
    expect(normalize([{ ...HOLD_EVENT, endsAt: undefined }])).toHaveLength(0)
  })

  it('tolerates a malformed payload', () => {
    expect(normalizeCalendarOverlapEvents({ data: null, holdName: 'x' })).toEqual([])
    expect(
      normalizeCalendarOverlapEvents({ data: { events: 'nope' }, holdName: 'x' }),
    ).toEqual([])
  })
})

describe('the warning a pro actually sees over a live hold (B5)', () => {
  // The end-to-end shape of the finding: a pro proposing 18:30 lands inside a
  // client's live 18:00–19:15 reservation and is now told so.
  it('names the hold when the proposed time lands inside it', () => {
    const names = overlappingClientNamesForRange(
      {
        startsAt: '2030-01-15T18:30:00.000Z',
        endsAt: '2030-01-15T19:30:00.000Z',
      },
      normalize([HOLD_EVENT]),
      OVERLAP_FALLBACK_NAME,
    )

    expect(names).toEqual([OVERLAP_HOLD_NAME])
  })

  // Half-open: butting up against the end of a hold is not a collision.
  it('stays silent for a booking that merely touches the hold end', () => {
    const names = overlappingClientNamesForRange(
      {
        startsAt: '2030-01-15T19:15:00.000Z',
        endsAt: '2030-01-15T20:00:00.000Z',
      },
      normalize([HOLD_EVENT]),
      OVERLAP_FALLBACK_NAME,
    )

    expect(names).toEqual([])
  })

  it('stays silent when the only overlap is the pro own blocked time', () => {
    const names = overlappingClientNamesForRange(
      {
        startsAt: '2030-01-15T18:30:00.000Z',
        endsAt: '2030-01-15T18:45:00.000Z',
      },
      normalize([BLOCK_EVENT]),
      OVERLAP_FALLBACK_NAME,
    )

    expect(names).toEqual([])
  })
})
