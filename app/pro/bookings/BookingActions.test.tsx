// app/pro/bookings/BookingActions.test.tsx
// @vitest-environment jsdom
//
// The lifecycle action buttons used to mint `${hint}:${crypto.randomUUID()}`
// per click, so a double-click accepted/cancelled twice. They now build the
// deterministic client key from (booking, verb).

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

import BookingActions from './BookingActions'

const BOOKING_ID = 'booking_1'
const FROZEN_NOW = 1_752_000_000_000

/** Pull the sent headers off a recorded fetch call, failing loudly if absent. */
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

function headerKeyFromCall(call: unknown[] | undefined): string {
  const key = headersFromCall(call)['Idempotency-Key']
  if (!key) throw new Error('fetch call carried no Idempotency-Key header')
  return key
}

describe('BookingActions idempotency keys', () => {
  const fetchMock = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('fetch', fetchMock)
    vi.spyOn(Date, 'now').mockReturnValue(FROZEN_NOW)
    fetchMock.mockResolvedValue({ ok: true, status: 200 })
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('sends the deterministic key keyed on (booking, verb)', async () => {
    render(
      <BookingActions bookingId={BOOKING_ID} status={BookingStatus.PENDING} />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Accept' }))

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1)
    })

    const sentKey = headerKeyFromCall(fetchMock.mock.calls[0])

    expect(sentKey).toBe(
      buildClientIdempotencyKey({
        scope: 'booking-lifecycle',
        entityId: BOOKING_ID,
        action: 'ACCEPT',
      }),
    )
    expect(sentKey).toMatch(/^booking-lifecycle:booking_1:ACCEPT:/)

    // Both header spellings the server reads.
    expect(headersFromCall(fetchMock.mock.calls[0])['x-idempotency-key']).toBe(
      sentKey,
    )
  })

  it('Accept and Cancel on the same booking never share a key', () => {
    const accept = buildClientIdempotencyKey({
      scope: 'booking-lifecycle',
      entityId: BOOKING_ID,
      action: 'ACCEPT',
    })
    const cancel = buildClientIdempotencyKey({
      scope: 'booking-lifecycle',
      entityId: BOOKING_ID,
      action: 'CANCEL',
    })

    expect(accept).not.toBe(cancel)
  })

  it('a repeated Accept in the same bucket reuses one key so the server replays', async () => {
    const { unmount } = render(
      <BookingActions bookingId={BOOKING_ID} status={BookingStatus.PENDING} />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Accept' }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))

    // Remount (the in-flight guard blocks a literal second click) and repeat
    // the same intent — the key must be identical, not a fresh UUID.
    unmount()
    render(
      <BookingActions bookingId={BOOKING_ID} status={BookingStatus.PENDING} />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Accept' }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))

    expect(headerKeyFromCall(fetchMock.mock.calls[1])).toBe(
      headerKeyFromCall(fetchMock.mock.calls[0]),
    )
  })
})
