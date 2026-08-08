// app/client/(gated)/bookings/[id]/ClientBookingActionsCard.test.tsx
// @vitest-environment jsdom
//
// Regression twin of BookingActions.test.tsx: the client reschedule confirm
// POSTed /api/v1/bookings/[id]/reschedule with no idempotency header, while
// that route runs through withRouteIdempotency — so it 400'd
// IDEMPOTENCY_KEY_REQUIRED and client reschedule was dead.

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { BookingStatus } from '@prisma/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { buildClientIdempotencyKey } from '@/lib/idempotency/client'

const navMocks = vi.hoisted(() => ({ routerRefresh: vi.fn(), routerPush: vi.fn() }))

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    refresh: navMocks.routerRefresh,
    push: navMocks.routerPush,
  }),
}))

vi.mock('@/lib/http', () => ({
  safeJson: async () => ({ ok: true }),
}))

const HOLD = {
  holdId: 'hold_1',
  offeringId: 'off_1',
  locationType: 'SALON',
  slotISO: '2026-08-02T18:00:00.000Z',
  bookingSource: 'DIRECT',
  mediaId: null,
}

// Stand in for the availability drawer with a button that hands back a hold.
vi.mock('@/app/(main)/booking/AvailabilityDrawer/AvailabilityDrawer', () => ({
  default: ({
    open,
    onConfirmHold,
  }: {
    open: boolean
    onConfirmHold: (h: typeof HOLD) => void
  }) =>
    open ? (
      <button type="button" onClick={() => onConfirmHold(HOLD)}>
        pick-hold
      </button>
    ) : null,
}))

import ClientBookingActionsCard from './ClientBookingActionsCard'

const BOOKING_ID = 'booking_1'
const FROZEN_NOW = 1_752_000_000_000

function rescheduleCall(fetchMock: ReturnType<typeof vi.fn>) {
  return fetchMock.mock.calls.find(
    (call) => typeof call[0] === 'string' && call[0].includes('/reschedule'),
  )
}

function headersFromCall(call: unknown[] | undefined): Record<string, string> {
  const init = call?.[1]
  if (!init || typeof init !== 'object' || !('headers' in init)) {
    throw new Error('fetch call has no request init')
  }
  const headers = (init as RequestInit).headers
  if (!headers || typeof headers !== 'object' || Array.isArray(headers)) {
    throw new Error('fetch call has no plain headers object')
  }
  return headers as Record<string, string>
}

describe('client reschedule idempotency', () => {
  const fetchMock = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('fetch', fetchMock)
    vi.spyOn(Date, 'now').mockReturnValue(FROZEN_NOW)
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    fetchMock.mockResolvedValue({ ok: true, status: 200 })
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('sends a deterministic key keyed to the chosen hold', async () => {
    render(
      <ClientBookingActionsCard
        bookingId={BOOKING_ID}
        status={BookingStatus.ACCEPTED}
        scheduledFor="2026-08-01T17:00:00.000Z"
        appointmentTz="America/Los_Angeles"
        locationType="SALON"
        drawerContext={{ professionalId: 'pro_1' }}
      />,
    )

    // Open the reschedule panel, then the drawer, then pick a hold.
    fireEvent.click(screen.getByRole('button', { name: 'Reschedule' }))
    fireEvent.click(screen.getByRole('button', { name: 'Pick new time' }))
    fireEvent.click(screen.getByRole('button', { name: 'pick-hold' }))

    fireEvent.click(screen.getByRole('button', { name: 'Confirm new time' }))

    await waitFor(() => {
      expect(rescheduleCall(fetchMock)).toBeTruthy()
    })

    const call = rescheduleCall(fetchMock)
    const sent = headersFromCall(call)

    const expected = buildClientIdempotencyKey({
      scope: 'booking-lifecycle',
      entityId: BOOKING_ID,
      action: 'CLIENT_RESCHEDULE',
      nonce: JSON.stringify({
        holdId: HOLD.holdId,
        locationType: HOLD.locationType,
      }),
    })

    expect(sent['Idempotency-Key']).toBe(expected)
    expect(sent['x-idempotency-key']).toBe(expected)

    // The route parses a JSON body, so Content-Type must survive the spread.
    expect(sent['Content-Type']).toBe('application/json')

    // And the body still matches the nonce it was keyed from.
    expect(call?.[1]).toMatchObject({
      body: JSON.stringify({
        holdId: HOLD.holdId,
        locationType: HOLD.locationType,
      }),
    })
  })

  it('the reschedule key never collides with the cancel key', () => {
    const reschedule = buildClientIdempotencyKey({
      scope: 'booking-lifecycle',
      entityId: BOOKING_ID,
      action: 'CLIENT_RESCHEDULE',
      nonce: JSON.stringify({ holdId: 'hold_1', locationType: 'SALON' }),
    })
    const cancel = buildClientIdempotencyKey({
      scope: 'booking-lifecycle',
      entityId: BOOKING_ID,
      action: 'CLIENT_CANCEL',
    })

    expect(reschedule).not.toBe(cancel)
  })
})
