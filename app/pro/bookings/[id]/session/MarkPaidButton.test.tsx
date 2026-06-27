import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

const mocks = vi.hoisted(() => ({
  refresh: vi.fn(),
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: mocks.refresh }),
}))

import MarkPaidButton from './MarkPaidButton'

const METHODS = [
  { value: 'CASH' as const, label: 'Cash' },
  { value: 'VENMO' as const, label: 'Venmo' },
]

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

describe('MarkPaidButton', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('fetch', vi.fn())
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  it('shows a hint and no action when the pro has no payment methods', () => {
    render(<MarkPaidButton bookingId="b1" methods={[]} />)

    expect(screen.getByText(/turn on a payment method/i)).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: /mark as paid/i }),
    ).not.toBeInTheDocument()
  })

  it('posts the selected method to the mark-paid route and refreshes on success', async () => {
    const fetchMock = vi.mocked(fetch)
    fetchMock.mockResolvedValue(jsonResponse(200, { ok: true }))

    render(<MarkPaidButton bookingId="booking_1" methods={METHODS} />)

    fireEvent.click(screen.getByRole('button', { name: /mark as paid/i }))

    await waitFor(() => expect(mocks.refresh).toHaveBeenCalledTimes(1))

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] ?? []
    expect(String(url)).toBe(
      '/api/v1/pro/bookings/booking_1/checkout/mark-paid',
    )
    expect(JSON.parse(String(init?.body))).toEqual({
      selectedPaymentMethod: 'CASH',
    })
  })

  it('surfaces an error and does not refresh when the request fails', async () => {
    const fetchMock = vi.mocked(fetch)
    fetchMock.mockResolvedValue(
      jsonResponse(400, { error: 'That payment method is not enabled.' }),
    )

    render(<MarkPaidButton bookingId="booking_1" methods={METHODS} />)

    fireEvent.click(screen.getByRole('button', { name: /mark as paid/i }))

    expect(
      await screen.findByText('That payment method is not enabled.'),
    ).toBeInTheDocument()
    expect(mocks.refresh).not.toHaveBeenCalled()
  })
})
