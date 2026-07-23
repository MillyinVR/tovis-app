import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

const mocks = vi.hoisted(() => ({
  refresh: vi.fn(),
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: mocks.refresh }),
}))

import ReopenCheckoutButton from './ReopenCheckoutButton'

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

describe('ReopenCheckoutButton', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('fetch', vi.fn())
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  it('requires a confirm step before posting (guards accidental un-collection)', async () => {
    const fetchMock = vi.mocked(fetch)
    fetchMock.mockResolvedValue(jsonResponse(200, { ok: true }))

    render(<ReopenCheckoutButton bookingId="booking_1" />)

    // First tap only reveals the confirm control — no request yet.
    fireEvent.click(screen.getByRole('button', { name: /undo & reopen/i }))
    expect(fetchMock).not.toHaveBeenCalled()

    expect(
      screen.getByRole('button', { name: /confirm reopen/i }),
    ).toBeInTheDocument()
  })

  it('posts to the reopen route and refreshes once confirmed', async () => {
    const fetchMock = vi.mocked(fetch)
    fetchMock.mockResolvedValue(jsonResponse(200, { ok: true }))

    render(<ReopenCheckoutButton bookingId="booking_1" />)

    fireEvent.click(screen.getByRole('button', { name: /undo & reopen/i }))
    fireEvent.click(screen.getByRole('button', { name: /confirm reopen/i }))

    await waitFor(() => expect(mocks.refresh).toHaveBeenCalledTimes(1))

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] ?? []
    expect(String(url)).toBe('/api/v1/pro/bookings/booking_1/checkout/reopen')
    expect(init?.method).toBe('POST')
  })

  it('surfaces the server refusal message and does not refresh', async () => {
    const fetchMock = vi.mocked(fetch)
    fetchMock.mockResolvedValue(
      jsonResponse(409, {
        error:
          "This booking was paid by card, so it can't be reopened here. Issue a refund to return the money.",
      }),
    )

    render(<ReopenCheckoutButton bookingId="booking_1" />)

    fireEvent.click(screen.getByRole('button', { name: /undo & reopen/i }))
    fireEvent.click(screen.getByRole('button', { name: /confirm reopen/i }))

    expect(
      await screen.findByText(/paid by card, so it can't be reopened/i),
    ).toBeInTheDocument()
    expect(mocks.refresh).not.toHaveBeenCalled()
  })

  it('cancel dismisses the confirm without posting', () => {
    const fetchMock = vi.mocked(fetch)

    render(<ReopenCheckoutButton bookingId="booking_1" />)

    fireEvent.click(screen.getByRole('button', { name: /undo & reopen/i }))
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }))

    expect(fetchMock).not.toHaveBeenCalled()
    expect(
      screen.getByRole('button', { name: /undo & reopen/i }),
    ).toBeInTheDocument()
  })
})
