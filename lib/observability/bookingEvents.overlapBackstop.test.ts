// lib/observability/bookingEvents.overlapBackstop.test.ts
//
// Coverage for captureOverlapBackstopFired.
//
// The database overlap EXCLUDE constraint refusing a write means the app-level
// gate let it through — an invariant violation that is INVISIBLE from every
// client-facing surface, because both layers refuse with the same TIME_BOOKED.
// It therefore has to reach a human on its own, at error level.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const sentry = vi.hoisted(() => ({
  captureMessage: vi.fn(),
  captureException: vi.fn(),
  withScope: vi.fn((cb: (scope: unknown) => void) =>
    cb({
      setLevel: vi.fn(),
      setTag: vi.fn(),
      setContext: vi.fn(),
    }),
  ),
}))

vi.mock('@sentry/nextjs', () => sentry)

import { captureOverlapBackstopFired } from './bookingEvents'

const REQUESTED_START = new Date('2030-05-01T18:00:00.000Z')
const REQUESTED_END = new Date('2030-05-01T19:15:00.000Z')

beforeEach(() => {
  sentry.captureMessage.mockReset()
  sentry.withScope.mockClear()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('captureOverlapBackstopFired', () => {
  it('raises an ERROR-level Sentry message naming the professional', () => {
    captureOverlapBackstopFired({
      action: 'BOOKING_CREATE',
      professionalId: 'pro_1',
      bookingId: null,
      holdId: null,
      requestedStart: REQUESTED_START,
      requestedEnd: REQUESTED_END,
      constraint: 'Booking_no_active_professional_overlap',
    })

    expect(sentry.captureMessage).toHaveBeenCalledTimes(1)
    expect(sentry.captureMessage).toHaveBeenCalledWith(
      expect.stringContaining('pro_1'),
      // NOT 'warning'. No bad data was written — Postgres refused — but the
      // app-level no-double-book guarantee is gone and nothing else will say so.
      'error',
    )
  })

  it('tags the scope so the event is filterable without reading the message', () => {
    const setTag = vi.fn()
    const setLevel = vi.fn()
    const setContext = vi.fn()
    sentry.withScope.mockImplementationOnce((cb: (scope: unknown) => void) =>
      cb({ setLevel, setTag, setContext }),
    )

    captureOverlapBackstopFired({
      action: 'BOOKING_UPDATE',
      professionalId: 'pro_2',
      bookingId: 'booking_9',
      holdId: null,
      requestedStart: REQUESTED_START,
      requestedEnd: REQUESTED_END,
      constraint: 'Booking_no_active_professional_overlap',
    })

    expect(setLevel).toHaveBeenCalledWith('error')
    expect(setTag).toHaveBeenCalledWith(
      'booking.event',
      'overlap_backstop_fired',
    )
    expect(setTag).toHaveBeenCalledWith('booking.action', 'BOOKING_UPDATE')
    expect(setTag).toHaveBeenCalledWith('booking.id', 'booking_9')

    expect(setContext).toHaveBeenCalledWith(
      'overlap_backstop',
      expect.objectContaining({
        professionalId: 'pro_2',
        requestedStart: REQUESTED_START.toISOString(),
        requestedEnd: REQUESTED_END.toISOString(),
        constraint: 'Booking_no_active_professional_overlap',
      }),
    )
  })
})
