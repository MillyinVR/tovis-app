import { describe, expect, it } from 'vitest'
import { BookingStatus } from '@prisma/client'

import { getBrandConfig } from '@/lib/brand'
import type { CalendarEvent } from '../_types'

import { eventStatusLabel } from './proCalendarDisplay'

// `eventStatusLabel` is newly SHARED (it was copied verbatim into EventCard and
// CalendarDesktopShell, both private), so there is no pre-fix export to A/B
// against — the proof is mutation testing: each arm below was inverted in turn
// and only its own case failed.

const copy = getBrandConfig().proCalendar

function bookingEvent(status: string): CalendarEvent {
  return {
    kind: 'BOOKING',
    id: 'evt_1',
    title: 'Balayage',
    clientName: 'Jane Doe',
    status,
    locationType: null,
    locationId: null,
    startsAt: '2026-08-01T17:00:00.000Z',
    endsAt: '2026-08-01T18:00:00.000Z',
    durationMinutes: 60,
    timeZone: 'America/Los_Angeles',
    timeZoneSource: 'BOOKING_SNAPSHOT',
    localDateKey: '2026-08-01',
    details: { serviceName: 'Balayage', bufferMinutes: 0, serviceItems: [] },
  }
}

describe('eventStatusLabel', () => {
  it('names a session the pro already started', () => {
    // Both copies ended `return copy.statusLabels.accepted`, so an IN_PROGRESS
    // booking — which the feed emits, it filters only CANCELLED — was labelled
    // "Accepted" on the pro's own calendar. Prod had two of these live.
    expect(eventStatusLabel(bookingEvent(BookingStatus.IN_PROGRESS), copy)).toBe(
      'In progress',
    )
  })

  it('names a no-show a no-show', () => {
    expect(eventStatusLabel(bookingEvent(BookingStatus.NO_SHOW), copy)).toBe(
      'No-show',
    )
  })

  it('labels the states that already had an arm', () => {
    expect(eventStatusLabel(bookingEvent(BookingStatus.PENDING), copy)).toBe(
      copy.statusLabels.pending,
    )
    expect(eventStatusLabel(bookingEvent(BookingStatus.COMPLETED), copy)).toBe(
      copy.statusLabels.completed,
    )
    expect(eventStatusLabel(bookingEvent(BookingStatus.CANCELLED), copy)).toBe(
      copy.statusLabels.cancelled,
    )
    expect(eventStatusLabel(bookingEvent('DECLINED'), copy)).toBe(
      copy.statusLabels.cancelled,
    )
    expect(eventStatusLabel(bookingEvent('WAITLIST'), copy)).toBe(
      copy.statusLabels.waitlist,
    )
    expect(eventStatusLabel(bookingEvent(BookingStatus.ACCEPTED), copy)).toBe(
      copy.statusLabels.accepted,
    )
  })

  it('keeps the non-booking kinds on their own words', () => {
    // A hold stays anonymous and a block stays the pro's own time (B5) — the
    // kind is checked BEFORE the status, and must stay that way.
    const block: CalendarEvent = {
      kind: 'BLOCK',
      id: 'block:1',
      blockId: '1',
      title: 'Lunch',
      clientName: '',
      status: 'BLOCKED',
      note: null,
      locationId: null,
      startsAt: '2026-08-01T19:00:00.000Z',
      endsAt: '2026-08-01T20:00:00.000Z',
    }
    const hold: CalendarEvent = {
      kind: 'HOLD',
      id: 'hold:1',
      holdId: '1',
      title: 'Held',
      clientName: '',
      status: 'HELD',
      locationType: null,
      locationId: null,
      expiresAt: '2026-08-01T21:15:00.000Z',
      startsAt: '2026-08-01T21:00:00.000Z',
      endsAt: '2026-08-01T22:00:00.000Z',
    }

    expect(eventStatusLabel(block, copy)).toBe(copy.statusLabels.blocked)
    expect(eventStatusLabel(hold, copy)).toBe(copy.statusLabels.held)
  })
})
