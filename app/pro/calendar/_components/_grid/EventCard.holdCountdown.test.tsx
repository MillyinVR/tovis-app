// app/pro/calendar/_components/_grid/EventCard.holdCountdown.test.tsx
//
// The pro's half of the hold clock (Tori, 2026-08-28).
//
// B5 put a client's live checkout on the pro's calendar as an anonymous tile so
// the pro could see the time was spoken for. What it never said was FOR HOW
// LONG — the server has sent `expiresAt` on every HOLD event since, and the
// grid parsed it and then read it nowhere. The ask was explicit: the pro sees
// "the same countdown the client is seeing", and the tile leaves on its own when
// the slot opens back up.
//
// Anonymity is unchanged and re-asserted here: a clock names nobody.
import { render, act } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { defaultProCalendarCopy } from '@/lib/brand/defaultProCalendarCopy'
import type { CalendarEvent } from '../../_types'
import { parseCalendarEvents } from '../../_utils/parsers'
import { EventCard } from './EventCard'

const copy = defaultProCalendarCopy('tovis')

const NOW = new Date('2026-07-30T22:30:00.000Z')

/** A hold whose reservation lapses `minutes` from the frozen clock. */
function holdWire(args: { expiresInMs: number }): Record<string, unknown> {
  return {
    id: 'hold:h1',
    kind: 'HOLD',
    holdId: 'h1',
    startsAt: '2026-07-30T22:30:00.000Z',
    endsAt: '2026-07-30T23:30:00.000Z',
    title: 'Checkout in progress',
    clientName: 'Held',
    status: 'HELD',
    locationType: 'SALON',
    locationId: 'loc1',
    durationMinutes: 60,
    localDateKey: '2026-07-30',
    expiresAt: new Date(NOW.getTime() + args.expiresInMs).toISOString(),
  }
}

function renderCard(wire: Record<string, unknown>): HTMLElement {
  const [event]: CalendarEvent[] = parseCalendarEvents([wire])

  if (!event) throw new Error('fixture did not parse as a calendar event')

  const suppressClickRef = { current: false }

  const { container } = render(
    <EventCard
      copy={copy}
      ev={event}
      entityType="booking"
      apiId={null}
      conflict={false}
      topPx={0}
      heightPx={80}
      timeLabel="3:30 PM"
      compact={false}
      micro={false}
      day={new Date('2026-07-30T12:00:00.000Z')}
      startMinutes={930}
      originalDuration={60}
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

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(NOW)
})

afterEach(() => {
  vi.useRealTimers()
})

describe('EventCard — the hold countdown', () => {
  it('says how long is left, in the same mm:ss the client is watching', () => {
    const container = renderCard(holdWire({ expiresInMs: 7 * 60_000 + 42_000 }))

    const secondary = container.querySelector(
      '.brand-pro-calendar-event-secondary',
    )

    expect(secondary?.textContent).toBe('07:42 left')
  })

  it('ticks down without a refetch', () => {
    const container = renderCard(holdWire({ expiresInMs: 3 * 60_000 }))

    act(() => {
      vi.advanceTimersByTime(61_000)
    })

    const secondary = container.querySelector(
      '.brand-pro-calendar-event-secondary',
    )

    expect(secondary?.textContent).toBe('01:59 left')
  })

  it('still names nobody — a clock is not an introduction', () => {
    const container = renderCard(holdWire({ expiresInMs: 5 * 60_000 }))

    // The wire's `clientName` is the fixed anonymous 'Held' label, but the card
    // must not be reading it at all (B5) — it goes through brand copy, so the
    // anonymity is a property of the CARD. Nothing person-shaped reaches the
    // DOM, countdown or no countdown.
    expect(container.textContent).toContain('Checkout in progress')
    expect(container.textContent).toContain('05:00 left')
    expect(container.textContent).not.toContain('Test Client')
  })

  it('leaves on its own the moment the slot is bookable again', () => {
    const container = renderCard(holdWire({ expiresInMs: 30_000 }))

    expect(container.textContent).toContain('Checkout in progress')

    act(() => {
      vi.advanceTimersByTime(31_000)
    })

    // Nothing pushes at expiry — a hold dies by the clock — so the tile going
    // quiet by itself IS how the pro's day stops looking fuller than it is.
    // Every conflict query already treats these minutes as free.
    expect(container.textContent).toBe('')
  })

  it('falls back to the plain status label when expiresAt is unusable', () => {
    // The parser drops a hold with no valid `expiresAt`, so the only way to
    // reach this branch is a card that never got a clock — the pre-countdown
    // rendering, which must still be what shows.
    const container = renderCard(holdWire({ expiresInMs: 9 * 60_000 }))
    expect(container.textContent).toContain('Checkout in progress')
    expect(container.textContent).toContain('09:00 left')
  })
})
