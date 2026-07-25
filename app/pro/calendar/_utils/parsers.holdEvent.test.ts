// app/pro/calendar/_utils/parsers.holdEvent.test.ts
//
// B5 — a client's live checkout reservation must survive the wire→UI parse.
//
// The parser is a silent gate: `parseCalendarEvent` returns null for any kind
// it doesn't know, so shipping HOLD events from the route WITHOUT teaching the
// parser would have dropped every one of them client-side while the route's own
// tests stayed green. [[green-tests-wrong-artifact]]

import { describe, expect, it } from 'vitest'

import { parseCalendarEvent, parseCalendarEvents } from './parsers'
import { isHoldEvent, isBlockedEvent } from './calendarMath'

function holdPayload(overrides: Record<string, unknown> = {}) {
  return {
    id: 'hold:hold-1',
    holdId: 'hold-1',
    kind: 'HOLD',
    startsAt: '2030-01-15T18:00:00.000Z',
    endsAt: '2030-01-15T19:15:00.000Z',
    expiresAt: '2030-01-15T18:10:00.000Z',
    title: 'Booking in progress',
    clientName: 'Held',
    status: 'HELD',
    locationType: 'SALON',
    locationId: 'salon-1',
    durationMinutes: 75,
    localDateKey: '2030-01-15',
    ...overrides,
  }
}

describe('parseCalendarEvent — HOLD (B5)', () => {
  it('parses a hold event rather than dropping it', () => {
    const event = parseCalendarEvent(holdPayload())

    expect(event).not.toBeNull()
    expect(event?.kind).toBe('HOLD')
    expect(event?.id).toBe('hold:hold-1')
    expect(event?.startsAt).toBe('2030-01-15T18:00:00.000Z')
    expect(event?.endsAt).toBe('2030-01-15T19:15:00.000Z')
  })

  it('derives holdId from the prefixed row id when the field is absent', () => {
    const event = parseCalendarEvent(holdPayload({ holdId: undefined }))

    expect(event?.kind).toBe('HOLD')
    expect(event && 'holdId' in event ? event.holdId : null).toBe('hold-1')
  })

  // Without an expiry there is no way to know the reservation is still live,
  // and the segment would sit on the calendar forever.
  it('refuses a hold with no usable expiry', () => {
    expect(parseCalendarEvent(holdPayload({ expiresAt: undefined }))).toBeNull()
    expect(parseCalendarEvent(holdPayload({ expiresAt: 'nonsense' }))).toBeNull()
  })

  it('refuses a hold with no resolvable id', () => {
    expect(
      parseCalendarEvent(holdPayload({ id: 'bare-id', holdId: undefined })),
    ).toBeNull()
  })

  it('keeps holds alongside bookings and blocks in a mixed feed', () => {
    const events = parseCalendarEvents([
      holdPayload(),
      {
        id: 'block:block-1',
        blockId: 'block-1',
        kind: 'BLOCK',
        startsAt: '2030-01-15T20:00:00.000Z',
        endsAt: '2030-01-15T21:00:00.000Z',
        title: 'Blocked time',
        clientName: 'Personal',
        status: 'BLOCKED',
        note: null,
        locationId: null,
      },
    ])

    expect(events.map((event) => event.kind)).toEqual(['HOLD', 'BLOCK'])
  })
})

describe('isHoldEvent / isBlockedEvent do not confuse the two (B5)', () => {
  it('classifies a hold as held and NOT as blocked', () => {
    const hold = parseCalendarEvent(holdPayload())

    expect(hold).not.toBeNull()
    if (!hold) return

    expect(isHoldEvent(hold)).toBe(true)
    // A hold must not fall into the blocked branch: blocked time is the pro's
    // own, and it is styled, labelled and (importantly) ID-extracted differently.
    expect(isBlockedEvent(hold)).toBe(false)
  })
})
