// app/pro/calendar/_components/_grid/EventCard.recurring.test.tsx
//
// The RECURRING mark (K19-C, shipped in K20) — the channel call, pinned.
//
// Three things are worth holding still, and none of them is "an svg renders":
//
//  1. A booking with NO series renders a card byte-identical to pre-K20. That
//     is every booking while `ENABLE_RECURRING_APPOINTMENTS` is unset, so the
//     absent case is the one almost every pro will ever see.
//  2. The mark lands in the TIME ROW, not in the top chip row. That is the
//     whole decision — the top row is where a card runs out of width first and
//     the last chip renders off-tile on the phone
//     ([[web-row-order-is-not-phone-priority-order]]). A test that only asserted
//     "the mark exists" would stay green through exactly the mistake this call
//     was made to avoid.
//  3. The WORDS reach the accessible name. The mark is aria-hidden, so without
//     this a screen-reader user learns nothing (K5's words-not-shapes rule).
import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { defaultProCalendarCopy } from '@/lib/brand/defaultProCalendarCopy'
import type { CalendarEvent } from '../../_types'
import { parseCalendarEvents } from '../../_utils/parsers'
import { EventCard } from './EventCard'

const copy = defaultProCalendarCopy('tovis')

type WireBooking = Record<string, unknown>

function bookingWire(overrides: WireBooking = {}): WireBooking {
  return {
    id: 'b1',
    kind: 'BOOKING',
    startsAt: '2026-07-30T16:15:00.000Z',
    endsAt: '2026-07-30T17:00:00.000Z',
    title: 'Balayage',
    clientName: 'Test Client',
    status: 'ACCEPTED',
    locationType: 'SALON',
    locationId: 'loc1',
    durationMinutes: 45,
    timeZone: 'America/Los_Angeles',
    timeZoneSource: 'BOOKING_SNAPSHOT',
    localDateKey: '2026-07-30',
    viewLocalDateKey: '2026-07-30',
    details: { serviceName: 'Balayage', bufferMinutes: 0, serviceItems: [] },
    ...overrides,
  }
}

function renderCard(wire: WireBooking): HTMLElement {
  const [event]: CalendarEvent[] = parseCalendarEvents([wire])

  if (!event) throw new Error('fixture did not parse as a calendar event')

  const suppressClickRef = { current: false }

  const { container } = render(
    <EventCard
      copy={copy}
      ev={event}
      entityType="booking"
      apiId={event.id}
      conflict={false}
      topPx={0}
      heightPx={54}
      timeLabel="9:15 AM"
      compact={false}
      micro={false}
      locationLabel="SALON"
      day={new Date('2026-07-30T12:00:00.000Z')}
      startMinutes={540}
      originalDuration={45}
      getColumnTop={() => 0}
      suppressClickRef={suppressClickRef}
      onClickEvent={() => {}}
      onDragStart={() => {}}
      onDropOnDayColumn={() => {}}
      onBeginResize={() => {}}
    />,
  )

  return container
}

const RECURRING = '.brand-pro-calendar-event-recurring'
const TIME_ROW = '.brand-pro-calendar-event-time'
const CHIP_ROW = '.brand-pro-calendar-event-row'

describe('EventCard — the recurring mark', () => {
  it('renders NOTHING for a booking that is not part of a series', () => {
    const container = renderCard(bookingWire())

    expect(container.querySelector(RECURRING)).toBeNull()

    const card = container.querySelector('[data-cal-event="1"]')
    expect(card?.getAttribute('title') ?? '').not.toMatch(/repeat/i)
  })

  it('drops the mark when the wire carries no seriesId — never an invented one', () => {
    const container = renderCard(
      bookingWire({ recurring: { occurrenceNumber: 3 } }),
    )

    expect(container.querySelector(RECURRING)).toBeNull()
  })

  it('🔴 puts the mark in the TIME row, not in the top chip row', () => {
    const container = renderCard(
      bookingWire({
        recurring: {
          seriesId: 'ser_1',
          occurrenceNumber: 3,
          description: 'Repeating appointment 3',
        },
      }),
    )

    const mark = container.querySelector(RECURRING)
    expect(mark).not.toBeNull()

    // The decision, asserted as containment rather than as existence.
    expect(container.querySelector(TIME_ROW)?.contains(mark ?? null)).toBe(true)
    expect(container.querySelector(CHIP_ROW)?.contains(mark ?? null)).toBe(false)

    // Beside the location chip, in the row that already says "when and where".
    expect(
      container.querySelector(
        `${TIME_ROW} .brand-pro-calendar-event-location`,
      ),
    ).not.toBeNull()
  })

  it('hides the shape from assistive tech and puts the words on the card', () => {
    const container = renderCard(
      bookingWire({
        recurring: {
          seriesId: 'ser_1',
          occurrenceNumber: 3,
          description: 'Repeating appointment 3',
        },
      }),
    )

    const mark = container.querySelector(RECURRING)
    expect(mark?.getAttribute('aria-hidden')).toBe('true')
    expect(mark?.getAttribute('title')).toBe('Repeating appointment 3')

    const card = container.querySelector('[data-cal-event="1"]')
    expect(card?.getAttribute('title')).toContain('Repeating appointment 3')
  })

  it('still marks a COMPLETED occurrence — recurrence is a fact, not a warning that goes stale', () => {
    const container = renderCard(
      bookingWire({
        status: 'COMPLETED',
        recurring: {
          seriesId: 'ser_1',
          occurrenceNumber: 2,
          description: 'Repeating appointment 2',
        },
      }),
    )

    expect(container.querySelector(RECURRING)).not.toBeNull()
  })
})
