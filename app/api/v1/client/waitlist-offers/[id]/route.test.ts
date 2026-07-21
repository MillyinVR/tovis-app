// app/api/v1/client/waitlist-offers/[id]/route.test.ts

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  jsonFail: vi.fn(),
  jsonOk: vi.fn(),
  pickString: vi.fn((value: unknown) =>
    typeof value === 'string' && value.trim() ? value.trim() : null,
  ),
  requireClient: vi.fn(),
  upper: vi.fn((value: unknown) =>
    typeof value === 'string' ? value.trim().toUpperCase() : '',
  ),

  withRouteIdempotency: vi.fn(),
  bookingJsonFail: vi.fn(),
  bookingErrorJsonFail: vi.fn(),
  isBookingError: vi.fn(() => false),
  confirmClientWaitlistOffer: vi.fn(),
  declineClientWaitlistOffer: vi.fn(),
  kickNotificationDrain: vi.fn(),
  broadcastBookingChange: vi.fn(),
  captureBookingException: vi.fn(),
  safeError: vi.fn((error: unknown) => ({
    name: error instanceof Error ? error.name : 'UnknownError',
    message: error instanceof Error ? error.message : 'Unknown error',
  })),
}))

vi.mock('@/app/api/_utils', () => ({
  jsonFail: mocks.jsonFail,
  jsonOk: mocks.jsonOk,
  pickString: mocks.pickString,
  requireClient: mocks.requireClient,
  upper: mocks.upper,
}))

vi.mock('@/app/api/_utils/idempotency', () => ({
  withRouteIdempotency: mocks.withRouteIdempotency,
}))

vi.mock('@/app/api/_utils/bookingResponses', () => ({
  bookingJsonFail: mocks.bookingJsonFail,
  bookingErrorJsonFail: mocks.bookingErrorJsonFail,
}))

vi.mock('@/lib/booking/writeBoundary', () => ({
  confirmClientWaitlistOffer: mocks.confirmClientWaitlistOffer,
  declineClientWaitlistOffer: mocks.declineClientWaitlistOffer,
}))

vi.mock('@/lib/booking/errors', () => ({
  isBookingError: mocks.isBookingError,
}))

vi.mock('@/lib/notifications/delivery/kickNotificationDrain', () => ({
  kickNotificationDrain: mocks.kickNotificationDrain,
}))

vi.mock('@/lib/live/broadcastBooking', () => ({
  broadcastBookingChange: mocks.broadcastBookingChange,
}))

vi.mock('@/lib/observability/bookingEvents', () => ({
  captureBookingException: mocks.captureBookingException,
}))

vi.mock('@/lib/security/logging', () => ({
  safeError: mocks.safeError,
}))

vi.mock('@/lib/idempotency', () => ({
  IDEMPOTENCY_ROUTES: {
    CLIENT_WAITLIST_OFFER: 'POST /api/v1/client/waitlist-offers/[id]',
  },
}))

import { POST } from './route'

type TestCtx = { params: Promise<{ id: string }> }

function makeCtx(id = 'offer_1'): TestCtx {
  return { params: Promise.resolve({ id }) }
}

function makeRequest(args?: { body?: unknown; headers?: HeadersInit }): Request {
  return new Request(
    'http://localhost/api/v1/client/waitlist-offers/offer_1',
    {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(args?.headers ?? {}) },
      body:
        args && Object.prototype.hasOwnProperty.call(args, 'body')
          ? JSON.stringify(args.body)
          : undefined,
    },
  )
}

describe('app/api/v1/client/waitlist-offers/[id]/route.ts', () => {
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    vi.clearAllMocks()

    consoleErrorSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined)

    mocks.jsonFail.mockImplementation((status: number, error: string) => ({
      ok: false,
      status,
      error,
    }))
    mocks.jsonOk.mockImplementation((body: unknown, status = 200) => ({
      ok: true,
      status,
      body,
    }))
    mocks.requireClient.mockResolvedValue({ ok: true, clientId: 'client_1' })
    mocks.isBookingError.mockReturnValue(false)

    mocks.withRouteIdempotency.mockImplementation(
      async (
        _args: unknown,
        run: (ctx: {
          idempotencyKey: string
        }) => Promise<{ status: number; body: unknown }>,
      ) => {
        const { status, body } = await run({ idempotencyKey: 'idem_key' })
        return { ok: true, status, body }
      },
    )
  })

  afterEach(() => {
    consoleErrorSpy.mockRestore()
  })

  it('returns auth response when requireClient fails', async () => {
    const authRes = { ok: false, status: 401, error: 'Unauthorized' }
    mocks.requireClient.mockResolvedValueOnce({ ok: false, res: authRes })

    const result = await POST(
      makeRequest({ body: { action: 'CONFIRM' } }),
      makeCtx(),
    )

    expect(result).toBe(authRes)
    expect(mocks.confirmClientWaitlistOffer).not.toHaveBeenCalled()
  })

  it('returns 400 for an invalid action', async () => {
    const result = await POST(
      makeRequest({ body: { action: 'MAYBE' } }),
      makeCtx(),
    )

    expect(mocks.jsonFail).toHaveBeenCalledWith(400, 'Invalid action.')
    expect(mocks.confirmClientWaitlistOffer).not.toHaveBeenCalled()
    expect(mocks.declineClientWaitlistOffer).not.toHaveBeenCalled()
  })

  it('DECLINE frees the offer and returns ok (no idempotency wrapper)', async () => {
    mocks.declineClientWaitlistOffer.mockResolvedValueOnce({ ok: true })

    const result = await POST(
      makeRequest({ body: { action: 'DECLINE' } }),
      makeCtx(),
    )

    expect(mocks.declineClientWaitlistOffer).toHaveBeenCalledWith({
      offerId: 'offer_1',
      clientId: 'client_1',
    })
    expect(mocks.jsonOk).toHaveBeenCalledWith({ ok: true })
    expect(mocks.kickNotificationDrain).toHaveBeenCalledTimes(1)
    expect(mocks.withRouteIdempotency).not.toHaveBeenCalled()
    expect(result).toEqual({ ok: true, status: 200, body: { ok: true } })
  })

  it('CONFIRM books through the idempotency wrapper and broadcasts the new booking', async () => {
    mocks.confirmClientWaitlistOffer.mockResolvedValueOnce({
      booking: {
        id: 'booking_9',
        status: 'ACCEPTED',
        scheduledFor: new Date('2026-07-10T17:00:00.000Z'),
      },
    })

    const result = await POST(
      makeRequest({
        body: { action: 'CONFIRM' },
        headers: { 'x-request-id': 'req_1', 'idempotency-key': 'idem_1' },
      }),
      makeCtx(),
    )

    expect(mocks.withRouteIdempotency).toHaveBeenCalledTimes(1)
    expect(mocks.confirmClientWaitlistOffer).toHaveBeenCalledWith({
      offerId: 'offer_1',
      clientId: 'client_1',
      requestId: 'req_1',
      idempotencyKey: 'idem_key',
    })
    expect(mocks.broadcastBookingChange).toHaveBeenCalledWith(
      'booking_9',
      'bookings',
    )
    expect(result).toEqual({
      ok: true,
      status: 201,
      body: {
        ok: true,
        booking: {
          id: 'booking_9',
          status: 'ACCEPTED',
          scheduledFor: '2026-07-10T17:00:00.000Z',
        },
      },
    })
  })

  it('maps a thrown bookingError to bookingJsonFail', async () => {
    const bookingErr = {
      code: 'WAITLIST_OFFER_NOT_PENDING',
      message: 'Waitlist offer is not pending.',
      userMessage: 'This offer has already been responded to or has expired.',
    }
    mocks.declineClientWaitlistOffer.mockRejectedValueOnce(bookingErr)
    mocks.isBookingError.mockReturnValue(true)
    mocks.bookingErrorJsonFail.mockReturnValue({ ok: false, status: 409 })

    const result = await POST(
      makeRequest({ body: { action: 'DECLINE' } }),
      makeCtx(),
    )

    // Forwards the ERROR itself, so a call-site uiAction override survives.
    expect(mocks.bookingErrorJsonFail).toHaveBeenCalledWith(bookingErr)
    expect(result).toEqual({ ok: false, status: 409 })
  })

  it('returns 500 and logs a safe error on an unexpected throw', async () => {
    const thrown = new Error('db blew up')
    mocks.declineClientWaitlistOffer.mockRejectedValueOnce(thrown)
    mocks.isBookingError.mockReturnValue(false)

    const result = await POST(
      makeRequest({ body: { action: 'DECLINE' } }),
      makeCtx(),
    )

    expect(mocks.safeError).toHaveBeenCalledWith(thrown)
    expect(mocks.jsonFail).toHaveBeenCalledWith(500, 'Internal server error')
    expect(result).toEqual({
      ok: false,
      status: 500,
      error: 'Internal server error',
    })
  })
})
