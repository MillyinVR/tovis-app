// app/api/v1/client/bookings/[id]/aftercare-rebook/route.test.ts

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  prismaBookingFindUnique: vi.fn(),

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
  confirmClientAftercareNextAppointment: vi.fn(),
  declineClientAftercareNextAppointment: vi.fn(),
  captureBookingException: vi.fn(),
  safeError: vi.fn((error: unknown) => ({
    name: error instanceof Error ? error.name : 'UnknownError',
    message: error instanceof Error ? error.message : 'Unknown error',
  })),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    booking: {
      findUnique: mocks.prismaBookingFindUnique,
    },
  },
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
  confirmClientAftercareNextAppointment:
    mocks.confirmClientAftercareNextAppointment,
  declineClientAftercareNextAppointment:
    mocks.declineClientAftercareNextAppointment,
}))

vi.mock('@/lib/booking/errors', () => ({
  isBookingError: mocks.isBookingError,
}))

vi.mock('@/lib/observability/bookingEvents', () => ({
  captureBookingException: mocks.captureBookingException,
}))

vi.mock('@/lib/security/logging', () => ({
  safeError: mocks.safeError,
}))

vi.mock('@/lib/idempotency', () => ({
  IDEMPOTENCY_ROUTES: {
    CLIENT_AFTERCARE_REBOOK: 'POST /api/v1/client/rebook/[token]',
  },
}))

import { POST } from './route'

type TestCtx = { params: Promise<{ id: string }> }

function makeCtx(id = 'booking_1'): TestCtx {
  return { params: Promise.resolve({ id }) }
}

function makeRequest(args?: { body?: unknown; headers?: HeadersInit }): Request {
  return new Request(
    'http://localhost/api/v1/client/bookings/booking_1/aftercare-rebook',
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

describe('app/api/v1/client/bookings/[id]/aftercare-rebook/route.ts', () => {
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
    mocks.prismaBookingFindUnique.mockResolvedValue({
      id: 'booking_1',
      clientId: 'client_1',
    })
    mocks.isBookingError.mockReturnValue(false)

    // Drive the idempotency wrapper: invoke the run callback and surface its body.
    mocks.withRouteIdempotency.mockImplementation(
      async (_args: unknown, run: (ctx: { idempotencyKey: string }) => Promise<{ status: number; body: unknown }>) => {
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

    const result = await POST(makeRequest({ body: { action: 'CONFIRM' } }), makeCtx())

    expect(result).toBe(authRes)
    expect(mocks.prismaBookingFindUnique).not.toHaveBeenCalled()
  })

  it('returns 404 when booking is not found', async () => {
    mocks.prismaBookingFindUnique.mockResolvedValueOnce(null)

    const result = await POST(makeRequest({ body: { action: 'CONFIRM' } }), makeCtx())

    expect(mocks.jsonFail).toHaveBeenCalledWith(404, 'Booking not found.')
    expect(result).toEqual({ ok: false, status: 404, error: 'Booking not found.' })
  })

  it('returns 404 when booking belongs to another client (no existence leak)', async () => {
    mocks.prismaBookingFindUnique.mockResolvedValueOnce({
      id: 'booking_1',
      clientId: 'other_client',
    })

    const result = await POST(makeRequest({ body: { action: 'CONFIRM' } }), makeCtx())

    expect(mocks.jsonFail).toHaveBeenCalledWith(404, 'Booking not found.')
    expect(result).toEqual({ ok: false, status: 404, error: 'Booking not found.' })
  })

  it('returns 400 for an invalid action', async () => {
    const result = await POST(makeRequest({ body: { action: 'MAYBE' } }), makeCtx())

    expect(mocks.jsonFail).toHaveBeenCalledWith(400, 'Invalid action.')
    expect(result).toEqual({ ok: false, status: 400, error: 'Invalid action.' })
    expect(mocks.confirmClientAftercareNextAppointment).not.toHaveBeenCalled()
    expect(mocks.declineClientAftercareNextAppointment).not.toHaveBeenCalled()
  })

  it('DECLINE clears the proposal and returns ok', async () => {
    mocks.declineClientAftercareNextAppointment.mockResolvedValueOnce({ ok: true })

    const result = await POST(makeRequest({ body: { action: 'DECLINE' } }), makeCtx())

    expect(mocks.declineClientAftercareNextAppointment).toHaveBeenCalledWith({
      bookingId: 'booking_1',
      clientId: 'client_1',
    })
    expect(mocks.jsonOk).toHaveBeenCalledWith({ ok: true })
    expect(result).toEqual({ ok: true, status: 200, body: { ok: true } })
    expect(mocks.withRouteIdempotency).not.toHaveBeenCalled()
  })

  it('CONFIRM creates the booking through the idempotency wrapper', async () => {
    mocks.confirmClientAftercareNextAppointment.mockResolvedValueOnce({
      booking: {
        id: 'rebook_1',
        status: 'ACCEPTED',
        scheduledFor: new Date('2026-07-01T17:00:00.000Z'),
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
    expect(mocks.confirmClientAftercareNextAppointment).toHaveBeenCalledWith({
      bookingId: 'booking_1',
      clientId: 'client_1',
      requestId: 'req_1',
      idempotencyKey: 'idem_key',
    })
    expect(result).toEqual({
      ok: true,
      status: 201,
      body: {
        ok: true,
        booking: {
          id: 'rebook_1',
          status: 'ACCEPTED',
          scheduledFor: '2026-07-01T17:00:00.000Z',
        },
      },
    })
  })

  it('maps a thrown bookingError to bookingJsonFail', async () => {
    const bookingErr = {
      code: 'AFTERCARE_NOT_COMPLETED',
      message: 'No proposed next appointment to confirm.',
      userMessage: 'There is no proposed next appointment to confirm.',
    }
    mocks.declineClientAftercareNextAppointment.mockRejectedValueOnce(bookingErr)
    mocks.isBookingError.mockReturnValue(true)
    mocks.bookingErrorJsonFail.mockReturnValue({ ok: false, status: 409 })

    const result = await POST(makeRequest({ body: { action: 'DECLINE' } }), makeCtx())

    // Forwards the ERROR itself, so a call-site uiAction override survives.
    expect(mocks.bookingErrorJsonFail).toHaveBeenCalledWith(bookingErr)
    expect(result).toEqual({ ok: false, status: 409 })
  })

  it('returns 500 and logs a safe error on an unexpected throw', async () => {
    const thrown = new Error('db blew up')
    mocks.declineClientAftercareNextAppointment.mockRejectedValueOnce(thrown)
    mocks.isBookingError.mockReturnValue(false)

    const result = await POST(makeRequest({ body: { action: 'DECLINE' } }), makeCtx())

    expect(mocks.safeError).toHaveBeenCalledWith(thrown)
    expect(mocks.jsonFail).toHaveBeenCalledWith(500, 'Internal server error')
    expect(result).toEqual({ ok: false, status: 500, error: 'Internal server error' })
  })
})
