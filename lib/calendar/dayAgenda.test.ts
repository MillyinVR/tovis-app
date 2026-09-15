// lib/calendar/dayAgenda.test.ts

import { describe, expect, it } from 'vitest'

import { BOOKING_BLOCKING_STATUSES } from '@/lib/booking/constants'

import { DAY_AGENDA_MAX_ENTRIES, dayAgendaEntries } from './dayAgenda'

// A UTC day, so the fixtures read as wall clock.
const DAY_START = '2026-10-01T00:00:00.000Z'
const DAY_END = '2026-10-02T00:00:00.000Z'

function booking(overrides: Record<string, unknown> = {}) {
  return {
    id: 'bk_1',
    kind: 'BOOKING',
    startsAt: '2026-10-01T14:00:00.000Z',
    endsAt: '2026-10-01T15:30:00.000Z',
    title: 'Silk press',
    clientName: 'Sam Rivers',
    status: 'ACCEPTED',
    ...overrides,
  }
}

function read(events: unknown[]) {
  return dayAgendaEntries({
    data: { events },
    dayStartIso: DAY_START,
    dayEndIso: DAY_END,
  })
}

describe('dayAgendaEntries', () => {
  it('reads a booking down to who, what and when', () => {
    expect(read([booking()])).toEqual([
      {
        id: 'bk_1',
        kind: 'BOOKING',
        startsAt: '2026-10-01T14:00:00.000Z',
        endsAt: '2026-10-01T15:30:00.000Z',
        name: 'Sam Rivers',
        detail: 'Silk press',
        statusLabel: 'Confirmed',
        continuesBefore: false,
        continuesAfter: false,
      },
    ])
  })

  it('keeps every status the busy-days dot counts, and nothing else', () => {
    const kept = BOOKING_BLOCKING_STATUSES.map((status, i) =>
      booking({ id: `bk_${i}`, status }),
    )
    expect(read(kept)).toHaveLength(BOOKING_BLOCKING_STATUSES.length)

    // The feed ships these; they own no time, so the dot never counted them
    // and neither may the list underneath it.
    for (const status of ['NO_SHOW', 'DECLINED', 'CANCELLED']) {
      expect(read([booking({ status })])).toEqual([])
    }
  })

  it('keeps blocks and holds, labelled as their own kind', () => {
    const entries = read([
      {
        id: 'block:b1',
        kind: 'BLOCK',
        startsAt: '2026-10-01T09:00:00.000Z',
        endsAt: '2026-10-01T10:00:00.000Z',
        title: 'School run',
        clientName: 'Personal',
        status: 'BLOCKED',
      },
      {
        id: 'hold:h1',
        kind: 'HOLD',
        startsAt: '2026-10-01T11:00:00.000Z',
        endsAt: '2026-10-01T12:00:00.000Z',
        title: 'Booking in progress',
        clientName: 'Held',
        status: 'HELD',
      },
    ])

    expect(entries.map((e) => [e.kind, e.name, e.detail, e.statusLabel])).toEqual([
      ['BLOCK', 'Personal', 'School run', null],
      ['HOLD', 'Held', 'Booking in progress', null],
    ])
  })

  it('sorts by start time regardless of feed order', () => {
    const entries = read([
      booking({ id: 'late', startsAt: '2026-10-01T16:00:00.000Z', endsAt: '2026-10-01T17:00:00.000Z' }),
      booking({ id: 'early', startsAt: '2026-10-01T08:00:00.000Z', endsAt: '2026-10-01T09:00:00.000Z' }),
    ])
    expect(entries.map((e) => e.id)).toEqual(['early', 'late'])
  })

  it('is half-open on both ends of the day', () => {
    // Ends exactly at midnight — belongs to the day it ran in.
    expect(
      read([
        booking({
          id: 'ends-at-midnight',
          startsAt: '2026-09-30T23:00:00.000Z',
          endsAt: DAY_START,
        }),
      ]),
    ).toEqual([])

    // Starts exactly at midnight — belongs to THIS day.
    expect(
      read([
        booking({
          id: 'starts-at-midnight',
          startsAt: DAY_START,
          endsAt: '2026-10-01T01:00:00.000Z',
        }),
      ]).map((e) => e.id),
    ).toEqual(['starts-at-midnight'])

    // Starts exactly at the next midnight — not this day's problem.
    expect(
      read([
        booking({
          id: 'tomorrow',
          startsAt: DAY_END,
          endsAt: '2026-10-02T01:00:00.000Z',
        }),
      ]),
    ).toEqual([])
  })

  it('marks an entry that spills across the day boundary', () => {
    const [entry] = read([
      {
        id: 'block:overnight',
        kind: 'BLOCK',
        startsAt: '2026-09-30T20:00:00.000Z',
        endsAt: '2026-10-02T08:00:00.000Z',
        title: 'Away',
        clientName: 'Personal',
        status: 'BLOCKED',
      },
    ])
    expect(entry?.continuesBefore).toBe(true)
    expect(entry?.continuesAfter).toBe(true)
  })

  it('falls back rather than rendering a blank row', () => {
    const [entry] = read([booking({ clientName: '   ', title: '' })])
    expect(entry?.name).toBe('Client')
    expect(entry?.detail).toBe('Appointment')
  })

  it('drops malformed rows instead of throwing', () => {
    expect(
      read([
        null,
        'nope',
        booking({ id: '' }),
        booking({ id: 'bad-start', startsAt: 'not-a-date' }),
        booking({ id: 'inverted', startsAt: '2026-10-01T15:00:00.000Z', endsAt: '2026-10-01T14:00:00.000Z' }),
        booking({ id: 'zero-width', endsAt: '2026-10-01T14:00:00.000Z' }),
        { id: 'other', kind: 'WAITLIST', startsAt: '2026-10-01T14:00:00.000Z', endsAt: '2026-10-01T15:00:00.000Z' },
      ]),
    ).toEqual([])
  })

  it('returns nothing for a non-payload or an inverted day', () => {
    expect(dayAgendaEntries({ data: null, dayStartIso: DAY_START, dayEndIso: DAY_END })).toEqual([])
    expect(dayAgendaEntries({ data: {}, dayStartIso: DAY_START, dayEndIso: DAY_END })).toEqual([])
    expect(
      dayAgendaEntries({ data: { events: booking() }, dayStartIso: DAY_START, dayEndIso: DAY_END }),
    ).toEqual([])
    expect(
      dayAgendaEntries({ data: { events: [booking()] }, dayStartIso: DAY_END, dayEndIso: DAY_START }),
    ).toEqual([])
  })

  it('caps the list so a nonsense payload cannot become a nonsense render', () => {
    const many = Array.from({ length: DAY_AGENDA_MAX_ENTRIES + 20 }, (_, i) =>
      booking({ id: `bk_${i}` }),
    )
    expect(read(many)).toHaveLength(DAY_AGENDA_MAX_ENTRIES)
  })
})
