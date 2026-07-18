// app/client/(gated)/bookings/[id]/BookingActions.test.tsx
// @vitest-environment jsdom
//
// Regression: this component sent NO idempotency header at all, while
// POST /api/v1/bookings/[id]/cancel runs through withRouteIdempotency — so
// the client "Cancel booking" button got a 400 IDEMPOTENCY_KEY_REQUIRED and
// could never cancel. (The round-3 audit's `crypto.randomUUID` grep missed
// this site precisely BECAUSE it had no key builder to find.)
//
// Proof is two-step and gapless: drive the real component to capture the
// headers it actually sends, then feed those exact headers into the real
// idempotency wrapper and assert it no longer short-circuits.

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { BookingStatus, Role } from '@prisma/client'
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

// Minimal ledger stub: reaching these at all is the point — the missing-key
// branch returns BEFORE any query, so a query happening proves the key landed.
const ledger = vi.hoisted(() => ({
  findUnique: vi.fn(async () => null),
  create: vi.fn(async () => ({ id: 'idem_1' })),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: { idempotencyKey: ledger },
}))

import BookingActions from './BookingActions'
import { beginRouteIdempotency } from '@/app/api/_utils/idempotency'

const BOOKING_ID = 'booking_1'
const FROZEN_NOW = 1_752_000_000_000

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

describe('client BookingActions cancel idempotency', () => {
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

  async function clickCancel() {
    render(
      <BookingActions
        bookingId={BOOKING_ID}
        status={BookingStatus.ACCEPTED}
        scheduledFor="2026-08-01T17:00:00.000Z"
        appointmentTz="America/Los_Angeles"
      />,
    )

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Cancel booking' })).toBeTruthy()
    })

    fireEvent.click(screen.getByRole('button', { name: 'Cancel booking' }))

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalled()
    })

    return headersFromCall(fetchMock.mock.calls[0])
  }

  it('now sends the deterministic lifecycle key on cancel', async () => {
    const sent = await clickCancel()

    expect(sent['Idempotency-Key']).toBe(
      buildClientIdempotencyKey({
        scope: 'booking-lifecycle',
        entityId: BOOKING_ID,
        action: 'CLIENT_CANCEL',
      }),
    )
    expect(sent['x-idempotency-key']).toBe(sent['Idempotency-Key'])

    // It really is the cancel route being called.
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      `/api/v1/bookings/${BOOKING_ID}/cancel`,
    )
  })

  it('those exact headers clear the real idempotency wrapper (no more 400)', async () => {
    const sent = await clickCancel()

    const result = await beginRouteIdempotency({
      request: new Request(`http://localhost/api/v1/bookings/${BOOKING_ID}/cancel`, {
        method: 'POST',
        headers: sent,
      }),
      actor: { actorUserId: 'user_client_1', actorRole: Role.CLIENT },
      route: 'POST /api/v1/bookings/[id]/cancel',
      requestBody: { bookingId: BOOKING_ID },
      messages: {
        missingKey: 'Missing idempotency key for booking cancellation.',
      },
    })

    // Before the fix this was {kind:'handled'} carrying the 400. The wrapper
    // now gets past the key check and reaches the ledger.
    if (result.kind === 'handled') {
      const body = await result.response.json()
      throw new Error(
        `still short-circuited: ${result.response.status} ${JSON.stringify(body)}`,
      )
    }

    expect(result.kind).toBe('started')
    // It genuinely queried the ledger under the component's key.
    expect(ledger.findUnique).toHaveBeenCalled()
    expect(ledger.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ key: sent['Idempotency-Key'] }),
      }),
    )
  })

  it('a repeat cancel of the same booking reuses the key so the server replays', async () => {
    const first = await clickCancel()
    cleanup()
    const second = await clickCancel()

    expect(second['Idempotency-Key']).toBe(first['Idempotency-Key'])
  })
})
