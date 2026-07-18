// app/_components/booking/MoneyTrailInspector.test.tsx
// @vitest-environment jsdom
//
// Closes the loop that moneyTrailIdempotency.test.ts alone cannot: that test
// drives the real route with a key the TEST builds. This one drives the real
// COMPONENT and captures the key it actually puts on the wire — so the two
// halves are provably the same string, not two independent constructions that
// happen to agree ([[wire-shape-vs-mock-drift]]).

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { buildClientIdempotencyKey } from '@/lib/idempotency/client'

vi.mock('@/lib/http', () => ({
  safeJson: async (res: Response) => res.json(),
}))

import MoneyTrailInspector from './MoneyTrailInspector'

const BOOKING_ID = 'booking_1'
const FROZEN_NOW = 1_752_000_000_000

const TRAIL = {
  currency: 'usd',
  deposit: null,
  finalCharge: null,
  discoveryFee: null,
  noShowFee: null,
  refunds: [],
  summary: {
    collectedCents: 5000,
    refundedCents: 0,
    netCents: 5000,
  },
  capabilities: {
    canRefund: true,
    refundableRemainingCents: 5000,
    canWaiveNoShowFee: true,
  },
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
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

function actionCall(fetchMock: ReturnType<typeof vi.fn>, suffix: string) {
  return fetchMock.mock.calls.find(
    (call) => typeof call[0] === 'string' && call[0].endsWith(suffix),
  )
}

describe('MoneyTrailInspector idempotency keys on the wire', () => {
  const fetchMock = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('fetch', fetchMock)
    vi.spyOn(Date, 'now').mockReturnValue(FROZEN_NOW)
    vi.spyOn(window, 'confirm').mockReturnValue(true)

    fetchMock.mockImplementation(async (url: string) => {
      if (url.includes('/money-trail')) return jsonResponse({ ok: true, trail: TRAIL })
      return jsonResponse({ ok: true })
    })
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('sends exactly the deterministic refund key the ledger test replays', async () => {
    render(<MoneyTrailInspector bookingId={BOOKING_ID} />)

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Refund…' })).toBeTruthy()
    })

    fireEvent.click(screen.getByRole('button', { name: 'Refund…' }))
    fireEvent.click(screen.getByRole('button', { name: 'Confirm refund' }))

    await waitFor(() => {
      expect(actionCall(fetchMock, '/refund')).toBeTruthy()
    })

    const sent = headersFromCall(actionCall(fetchMock, '/refund'))

    // The exact key the route-level replay test drives.
    expect(sent['Idempotency-Key']).toBe(
      buildClientIdempotencyKey({
        scope: 'money-trail',
        entityId: BOOKING_ID,
        action: 'refund',
      }),
    )
    expect(sent['x-idempotency-key']).toBe(sent['Idempotency-Key'])
    // Never a bare UUID again.
    expect(sent['Idempotency-Key']).not.toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    )
  })

  it('sends exactly the deterministic waive key, distinct from refund', async () => {
    render(<MoneyTrailInspector bookingId={BOOKING_ID} />)

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Waive no-show fee' })).toBeTruthy()
    })

    fireEvent.click(screen.getByRole('button', { name: 'Waive no-show fee' }))

    await waitFor(() => {
      expect(actionCall(fetchMock, '/no-show-fee/waive')).toBeTruthy()
    })

    const sent = headersFromCall(actionCall(fetchMock, '/no-show-fee/waive'))

    expect(sent['Idempotency-Key']).toBe(
      buildClientIdempotencyKey({
        scope: 'money-trail',
        entityId: BOOKING_ID,
        action: 'waive',
      }),
    )

    // Waiving must never reuse the refund bucket on the same booking.
    expect(sent['Idempotency-Key']).not.toBe(
      buildClientIdempotencyKey({
        scope: 'money-trail',
        entityId: BOOKING_ID,
        action: 'refund',
      }),
    )
  })
})
