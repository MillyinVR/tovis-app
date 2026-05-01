import { beforeEach, describe, expect, it, vi } from 'vitest'
import { BookingStatus, SessionStep } from '@prisma/client'
import { bookingError } from '@/lib/booking/errors'

const IDEMPOTENCY_ROUTE = 'POST /api/pro/bookings/[id]/start'

const defaultStartResponse = {
  booking: {
    id: 'booking_1',
    status: BookingStatus.IN_PROGRESS,
    sessionStep: SessionStep.CONSULTATION,
    startedAt: '2026-03-17T13:00:00.000Z',
  },
  nextHref: '/pro/bookings/booking_1/session',
  meta: {
    mutated: true,
    noOp: false,
  },
}

const mocks = vi.hoisted(() => ({
  requirePro: vi.fn(),
  jsonFail: vi.fn(),
  jsonOk: vi.fn(),
  pickString: vi.fn(),

  startBookingSession: vi.fn(),

  beginIdempotency: vi.fn(),
  completeIdempotency: vi.fn(),
  failIdempotency: vi.fn(),
}))

vi.mock('@/app/api/_utils', () => ({
  requirePro: mocks.requirePro,
  jsonFail: mocks.jsonFail,
  jsonOk: mocks.jsonOk,
  pickString: mocks.pickString,
}))

vi.mock('@/lib/booking/writeBoundary', () => ({
  startBookingSession: mocks.startBookingSession,
}))

vi.mock('@/lib/idempotency', () => ({
  beginIdempotency: mocks.beginIdempotency,
  completeIdempotency: mocks.completeIdempotency,
  failIdempotency: mocks.failIdempotency,
  IDEMPOTENCY_ROUTES: {
    BOOKING_START_SESSION: 'POST /api/pro/bookings/[id]/start',
  },
}))

import { POST } from './route'

function makeRequest(headers?: Record<string, string>): Request {
  return new Request('http://localhost/api/pro/bookings/booking_1/start', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(headers ?? {}),
    },
  })
}

function makeIdempotentRequest(key = 'idem_start_booking_1'): Request {
  return makeRequest({
    'idempotency-key': key,
  })
}

function makeCtx(id = 'booking_1') {
  return {
    params: Promise.resolve({ id }),
  }
}

describe('POST /api/pro/bookings/[id]/start', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    mocks.requirePro.mockResolvedValue({
      ok: true,
      professionalId: 'pro_123',
      proId: 'pro_123',
      user: {
        id: 'user_123',
      },
    })

    mocks.jsonFail.mockImplementation(
      (status: number, error: string, extra?: unknown) => ({
        ok: false,
        status,
        error,
        ...(extra && typeof extra === 'object' ? extra : {}),
      }),
    )

    mocks.jsonOk.mockImplementation((data: unknown, status = 200) => ({
      ok: true,
      status,
      data,
    }))

    mocks.pickString.mockImplementation((value: unknown) =>
      typeof value === 'string' && value.trim() ? value.trim() : null,
    )

    mocks.beginIdempotency.mockImplementation(
      async (args: { key: string | null }) => {
        const key = args.key?.trim()

        if (!key) {
          return { kind: 'missing_key' }
        }

        return {
          kind: 'started',
          idempotencyRecordId: 'idem_record_1',
          requestHash: 'hash_1',
        }
      },
    )

    mocks.completeIdempotency.mockResolvedValue(undefined)
    mocks.failIdempotency.mockResolvedValue(undefined)

    mocks.startBookingSession.mockResolvedValue({
      booking: {
        id: 'booking_1',
        status: BookingStatus.IN_PROGRESS,
        sessionStep: SessionStep.CONSULTATION,
        startedAt: new Date('2026-03-17T13:00:00.000Z'),
      },
      meta: {
        mutated: true,
        noOp: false,
      },
    })
  })

  it('returns auth response when requirePro fails', async () => {
    const authRes = { ok: false, status: 401, error: 'Unauthorized' }

    mocks.requirePro.mockResolvedValueOnce({
      ok: false,
      res: authRes,
    })

    const result = await POST(makeRequest(), makeCtx())

    expect(result).toBe(authRes)
    expect(mocks.beginIdempotency).not.toHaveBeenCalled()
    expect(mocks.startBookingSession).not.toHaveBeenCalled()
  })

  it('returns BOOKING_ID_REQUIRED when route param id is missing', async () => {
    const result = await POST(makeRequest(), makeCtx(''))

    expect(mocks.jsonFail).toHaveBeenCalledWith(
      400,
      expect.any(String),
      expect.objectContaining({
        code: 'BOOKING_ID_REQUIRED',
      }),
    )

    expect(mocks.beginIdempotency).not.toHaveBeenCalled()
    expect(mocks.startBookingSession).not.toHaveBeenCalled()
    expect(result).toEqual(
      expect.objectContaining({
        ok: false,
        status: 400,
        code: 'BOOKING_ID_REQUIRED',
      }),
    )
  })

  it('returns missing idempotency key for valid start request without idempotency header', async () => {
    const result = await POST(makeRequest(), makeCtx())

    expect(result).toEqual({
      ok: false,
      status: 400,
      error: 'Missing idempotency key.',
      code: 'IDEMPOTENCY_KEY_REQUIRED',
    })

    expect(mocks.beginIdempotency).toHaveBeenCalledWith({
      actor: {
        actorUserId: 'user_123',
        actorRole: 'PRO',
      },
      route: IDEMPOTENCY_ROUTE,
      key: null,
      requestBody: {
        professionalId: 'pro_123',
        actorUserId: 'user_123',
        bookingId: 'booking_1',
      },
    })

    expect(mocks.startBookingSession).not.toHaveBeenCalled()
    expect(mocks.completeIdempotency).not.toHaveBeenCalled()
  })

  it('returns in-progress when idempotency ledger has an active matching request', async () => {
    mocks.beginIdempotency.mockResolvedValueOnce({
      kind: 'in_progress',
    })

    const result = await POST(makeIdempotentRequest(), makeCtx())

    expect(result).toEqual({
      ok: false,
      status: 409,
      error: 'A matching booking start request is already in progress.',
      code: 'IDEMPOTENCY_REQUEST_IN_PROGRESS',
    })

    expect(mocks.startBookingSession).not.toHaveBeenCalled()
    expect(mocks.completeIdempotency).not.toHaveBeenCalled()
  })

  it('returns conflict when idempotency key was reused with a different body', async () => {
    mocks.beginIdempotency.mockResolvedValueOnce({
      kind: 'conflict',
    })

    const result = await POST(makeIdempotentRequest(), makeCtx())

    expect(result).toEqual({
      ok: false,
      status: 409,
      error: 'This idempotency key was already used with a different request body.',
      code: 'IDEMPOTENCY_KEY_CONFLICT',
    })

    expect(mocks.startBookingSession).not.toHaveBeenCalled()
    expect(mocks.completeIdempotency).not.toHaveBeenCalled()
  })

  it('replays completed idempotency response without starting the booking again', async () => {
    mocks.beginIdempotency.mockResolvedValueOnce({
      kind: 'replay',
      responseStatus: 200,
      responseBody: defaultStartResponse,
    })

    const result = await POST(makeIdempotentRequest(), makeCtx())

    expect(result).toEqual({
      ok: true,
      status: 200,
      data: defaultStartResponse,
    })

    expect(mocks.startBookingSession).not.toHaveBeenCalled()
    expect(mocks.completeIdempotency).not.toHaveBeenCalled()
  })

  it('starts the booking session, completes idempotency, and returns nextHref', async () => {
    const result = await POST(
      makeIdempotentRequest('idem_start_success_1'),
      makeCtx(),
    )

    expect(mocks.beginIdempotency).toHaveBeenCalledWith({
      actor: {
        actorUserId: 'user_123',
        actorRole: 'PRO',
      },
      route: IDEMPOTENCY_ROUTE,
      key: 'idem_start_success_1',
      requestBody: {
        professionalId: 'pro_123',
        actorUserId: 'user_123',
        bookingId: 'booking_1',
      },
    })

    expect(mocks.startBookingSession).toHaveBeenCalledWith({
      bookingId: 'booking_1',
      professionalId: 'pro_123',
      requestId: null,
      idempotencyKey: 'idem_start_success_1',
    })

    expect(mocks.completeIdempotency).toHaveBeenCalledWith({
      idempotencyRecordId: 'idem_record_1',
      responseStatus: 200,
      responseBody: defaultStartResponse,
    })

    expect(mocks.jsonOk).toHaveBeenCalledWith(defaultStartResponse, 200)

    expect(result).toEqual({
      ok: true,
      status: 200,
      data: defaultStartResponse,
    })
  })

  it('passes request id header through to startBookingSession', async () => {
    await POST(
      makeRequest({
        'idempotency-key': 'idem_start_with_request_id_1',
        'x-request-id': 'request_123',
      }),
      makeCtx(),
    )

    expect(mocks.startBookingSession).toHaveBeenCalledWith({
      bookingId: 'booking_1',
      professionalId: 'pro_123',
      requestId: 'request_123',
      idempotencyKey: 'idem_start_with_request_id_1',
    })
  })

  it('maps booking errors to jsonFail and marks idempotency failed', async () => {
    mocks.startBookingSession.mockRejectedValueOnce(
      bookingError('BOOKING_NOT_FOUND', {
        message: 'Booking was not found for this professional.',
        userMessage: 'Booking not found.',
      }),
    )

    const result = await POST(
      makeIdempotentRequest('idem_start_not_found_1'),
      makeCtx(),
    )

    expect(mocks.failIdempotency).toHaveBeenCalledWith({
      idempotencyRecordId: 'idem_record_1',
    })

    expect(mocks.jsonFail).toHaveBeenCalledWith(
      404,
      'Booking not found.',
      expect.objectContaining({
        code: 'BOOKING_NOT_FOUND',
        message: 'Booking was not found for this professional.',
      }),
    )

    expect(result).toEqual(
      expect.objectContaining({
        ok: false,
        status: 404,
        code: 'BOOKING_NOT_FOUND',
      }),
    )
  })

  it('returns internal error and marks idempotency failed for unexpected errors', async () => {
    mocks.startBookingSession.mockRejectedValueOnce(new Error('boom'))

    const result = await POST(
      makeIdempotentRequest('idem_start_boom_1'),
      makeCtx(),
    )

    expect(mocks.failIdempotency).toHaveBeenCalledWith({
      idempotencyRecordId: 'idem_record_1',
    })

    expect(mocks.jsonFail).toHaveBeenCalledWith(500, 'Internal server error')

    expect(result).toEqual({
      ok: false,
      status: 500,
      error: 'Internal server error',
    })
  })
})