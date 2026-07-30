// app/pro/calendar/_components/_grid/EventCard.serviceSwatch.test.tsx
//
// The SERVICE channel (K7): the event card's 4px accent stripe carries the pro's
// colour for the service, and falls back to the status tone when there isn't
// one. Both halves matter — the fallback is what keeps the calendar unchanged
// until a pro picks a colour in K8, and "unchanged" is this step's whole DoD.
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

function renderStripe(wire: WireBooking): HTMLElement {
  const [event]: CalendarEvent[] = parseCalendarEvents([wire])

  if (!event) throw new Error('fixture did not parse as a calendar event')

  const suppressClickRef = { current: false }

  const { container } = render(
    <EventCard
      copy={copy}
      ev={event}
      entityType={event.kind === 'BLOCK' ? 'block' : 'booking'}
      apiId={event.id}
      conflict={false}
      topPx={0}
      heightPx={54}
      timeLabel="9:15 AM"
      compact={false}
      micro={false}
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

  const stripe = container.querySelector('.brand-pro-calendar-event-accent')

  if (!(stripe instanceof HTMLElement)) {
    throw new Error('the card rendered no accent stripe')
  }

  return stripe
}

describe('EventCard — the service colour channel', () => {
  it('emits NO data-swatch when the booking has no service colour', () => {
    const stripe = renderStripe(bookingWire())

    // Not "data-swatch=''" — absent. The stylesheet's [data-swatch] rules must
    // not match at all, or the stripe stops showing the status tone.
    expect(stripe.hasAttribute('data-swatch')).toBe(false)
    expect(stripe.getAttribute('data-tone')).toBe('accepted')
  })

  it('paints the swatch while KEEPING the status tone on the element', () => {
    const stripe = renderStripe(bookingWire({ serviceSwatch: '04' }))

    expect(stripe.getAttribute('data-swatch')).toBe('04')
    // Both attributes are present: CSS decides which wins (the [data-swatch]
    // rules are declared after the [data-tone] ones), so the status tone stays
    // available and nothing has to be recomputed if the channels ever swap.
    expect(stripe.getAttribute('data-tone')).toBe('accepted')
  })

  it.each([
    ['an id outside the palette', '13'],
    ['a raw hex', '#ff0000'],
    ['an empty string', ''],
    ['a non-string', 7],
  ])('drops %s rather than emitting an attribute the CSS ignores', (_label, value) => {
    const stripe = renderStripe(bookingWire({ serviceSwatch: value }))

    expect(stripe.hasAttribute('data-swatch')).toBe(false)
    expect(stripe.getAttribute('data-tone')).toBe('accepted')
  })

  it('never claims the channel for a block — a block is not a service', () => {
    const stripe = renderStripe({
      id: 'block:x1',
      kind: 'BLOCK',
      startsAt: '2026-07-30T21:00:00.000Z',
      endsAt: '2026-07-30T22:00:00.000Z',
      title: 'Lunch',
      note: 'Lunch',
      locationId: 'loc1',
      timeZone: 'America/Los_Angeles',
      localDateKey: '2026-07-30',
      viewLocalDateKey: '2026-07-30',
      serviceSwatch: '04',
    })

    expect(stripe.hasAttribute('data-swatch')).toBe(false)
    expect(stripe.getAttribute('data-tone')).toBe('blocked')
  })

  it('never claims the channel for a hold — a hold is deliberately anonymous', () => {
    const stripe = renderStripe({
      id: 'hold:h1',
      kind: 'HOLD',
      startsAt: '2026-07-30T22:30:00.000Z',
      endsAt: '2026-07-30T23:00:00.000Z',
      title: 'Checkout in progress',
      holdId: 'h1',
      expiresAt: '2026-07-30T22:40:00.000Z',
      locationId: 'loc1',
      timeZone: 'America/Los_Angeles',
      localDateKey: '2026-07-30',
      viewLocalDateKey: '2026-07-30',
      serviceSwatch: '04',
    })

    expect(stripe.hasAttribute('data-swatch')).toBe(false)
    expect(stripe.getAttribute('data-tone')).toBe('held')
  })
})
