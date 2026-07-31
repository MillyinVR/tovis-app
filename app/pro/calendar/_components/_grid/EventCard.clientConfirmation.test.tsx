// app/pro/calendar/_components/_grid/EventCard.clientConfirmation.test.tsx
//
// The CONFIRMATION channel (K11): the corner glyph K7's budget reserved.
// Both halves matter — a booking with NO confirmation state must render a card
// IDENTICAL to pre-K11 (until K12 ships the writers, that is every booking),
// and a booking WITH one must render a circled glyph that stays distinct from
// CompletedCheck's bare ✓ (K7-A) while the words ride the accessible name.
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

function glyphOf(container: HTMLElement): HTMLElement | null {
  const glyph = container.querySelector('.brand-pro-calendar-event-confirmation')
  return glyph instanceof HTMLElement ? glyph : null
}

function cardOf(container: HTMLElement): HTMLElement {
  const card = container.querySelector('[data-cal-event]')
  if (!(card instanceof HTMLElement)) throw new Error('no card rendered')
  return card
}

describe('EventCard — the client-confirmation channel', () => {
  it('renders NOTHING for a booking with no confirmation state (K7 byte-identity bar)', () => {
    const absent = renderCard(bookingWire())

    expect(glyphOf(absent)).toBeNull()
    // The accessible name gains no attendance words either.
    expect(cardOf(absent).getAttribute('aria-label')).not.toMatch(
      /confirmation|Awaiting client|declined/i,
    )

    // And a server that DID send NOT_REQUESTED (insignificant) renders the
    // exact same DOM as an absent field — one honest display for "nobody
    // asked", regardless of how the wire spelled it.
    const notRequested = renderCard(
      bookingWire({ clientConfirmation: { kind: 'NOT_REQUESTED' } }),
    )
    expect(notRequested.innerHTML).toBe(absent.innerHTML)
  })

  it('drops a malformed wire value rather than inventing a state', () => {
    const container = renderCard(
      bookingWire({ clientConfirmation: { kind: 'MAYBE' } }),
    )
    expect(glyphOf(container)).toBeNull()
  })

  it('AWAITING_CLIENT → hollow ? ring, pending tone, words in title + accessible name', () => {
    const container = renderCard(
      bookingWire({ clientConfirmation: { kind: 'AWAITING_CLIENT' } }),
    )

    const glyph = glyphOf(container)
    expect(glyph).not.toBeNull()
    expect(glyph!.getAttribute('data-kind')).toBe('AWAITING_CLIENT')
    expect(glyph!.getAttribute('data-tone')).toBe('pending')
    // The glyph itself is silent; the words are the accessible surface.
    expect(glyph!.getAttribute('aria-hidden')).toBe('true')
    expect(glyph!.getAttribute('title')).toBe('Awaiting client confirmation')
    expect(cardOf(container).getAttribute('aria-label')).toContain(
      'Awaiting client confirmation',
    )
    // Hollow family: a stroked ring, no knockout mask.
    expect(glyph!.querySelector('mask')).toBeNull()
    expect(glyph!.querySelector('circle')).not.toBeNull()
  })

  it('CLIENT_CONFIRMED → filled disc with knocked-out ✓, success tone', () => {
    const container = renderCard(
      bookingWire({ clientConfirmation: { kind: 'CLIENT_CONFIRMED' } }),
    )

    const glyph = glyphOf(container)
    expect(glyph).not.toBeNull()
    expect(glyph!.getAttribute('data-tone')).toBe('success')
    // Filled family: the answer marks knock out via an SVG mask.
    expect(glyph!.querySelector('mask')).not.toBeNull()
    expect(cardOf(container).getAttribute('aria-label')).toContain(
      'Client confirmed this appointment',
    )
  })

  it('DECLINED → filled disc with knocked-out ✕, danger tone', () => {
    const container = renderCard(
      bookingWire({ clientConfirmation: { kind: 'DECLINED' } }),
    )

    const glyph = glyphOf(container)
    expect(glyph).not.toBeNull()
    expect(glyph!.getAttribute('data-tone')).toBe('danger')
    expect(glyph!.querySelector('mask')).not.toBeNull()
    expect(cardOf(container).getAttribute('aria-label')).toContain(
      'Client declined this appointment',
    )
  })

  it('K7-A: coexists with CompletedCheck as a DIFFERENT shape, never a second bare ✓', () => {
    const container = renderCard(
      bookingWire({
        status: 'COMPLETED',
        clientConfirmation: { kind: 'CLIENT_CONFIRMED' },
      }),
    )

    const completed = container.querySelector(
      '.brand-pro-calendar-event-completed-check',
    )
    const glyph = glyphOf(container)

    // Both render — two channels, one row.
    expect(completed).not.toBeNull()
    expect(glyph).not.toBeNull()

    // Distinct shape family: the completed check is a bare stroked polyline
    // with no circle; the confirmation mark is a circled disc. If someone
    // "simplifies" the glyph into a second bare check, this is the test that
    // goes red.
    expect(completed!.querySelector('circle')).toBeNull()
    expect(glyph!.querySelector('circle')).not.toBeNull()

    // Confirmation renders BEFORE the completed check (stable reading order).
    const row = glyph!.parentElement
    expect(row).not.toBeNull()
    const children = Array.from(row!.children)
    expect(children.indexOf(glyph!)).toBeLessThan(
      children.indexOf(completed as Element),
    )
  })
})
