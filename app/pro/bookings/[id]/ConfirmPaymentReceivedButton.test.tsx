import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'

const mocks = vi.hoisted(() => ({
  refresh: vi.fn(),
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: mocks.refresh }),
}))

import ConfirmPaymentReceivedButton from './ConfirmPaymentReceivedButton'

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

describe('ConfirmPaymentReceivedButton', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('fetch', vi.fn())
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  it('posts to the confirm-payment route (no body) and refreshes on success', async () => {
    const fetchMock = vi.mocked(fetch)
    fetchMock.mockResolvedValue(jsonResponse(200, { booking: {}, meta: {} }))

    render(<ConfirmPaymentReceivedButton bookingId="booking_1" />)

    fireEvent.click(
      screen.getByRole('button', { name: /confirm payment received/i }),
    )

    await waitFor(() => expect(mocks.refresh).toHaveBeenCalledTimes(1))

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] ?? []
    expect(String(url)).toBe(
      '/api/v1/pro/bookings/booking_1/checkout/confirm-payment',
    )
    expect(init?.method).toBe('POST')
    // No request body — the payment method was recorded at client checkout.
    expect(init?.body).toBeUndefined()
    // Idempotency key header must be present (the route rejects a missing key).
    const headers = new Headers(init?.headers as HeadersInit)
    expect(headers.get('Idempotency-Key')).toBeTruthy()
  })

  it('surfaces an error and does not refresh when the request fails', async () => {
    const fetchMock = vi.mocked(fetch)
    fetchMock.mockResolvedValue(
      jsonResponse(409, { error: 'Payment is not awaiting confirmation.' }),
    )

    render(<ConfirmPaymentReceivedButton bookingId="booking_1" />)

    fireEvent.click(
      screen.getByRole('button', { name: /confirm payment received/i }),
    )

    expect(
      await screen.findByText('Payment is not awaiting confirmation.'),
    ).toBeInTheDocument()
    expect(mocks.refresh).not.toHaveBeenCalled()
  })
})
