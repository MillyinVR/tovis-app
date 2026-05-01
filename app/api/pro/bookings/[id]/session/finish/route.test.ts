import { beforeEach, describe, expect, it, vi } from 'vitest'
import { BookingStatus, SessionStep } from '@prisma/client'
import { bookingError } from '@/lib/booking/errors'

const IDEMPOTENCY_ROUTE = 'POST /api/pro/bookings/[id]/session/finish'

const defaultFinishResponse = {
  booking: {
    id: 'booking_1',
    status: BookingStatus.IN_PROGRESS,
    sessionStep: SessionStep.FINISH_REVIEW,
    startedAt: '2026-03-17T13:00:00.000Z',
    finishedAt: '2026-03-17T14:00:00.000Z',
  },
  nextHref: '/pro/bookings/booking_1/session',
  afterCount: 0,
  meta: {
    mutated: true,
    noOp: false,
  },
}

const afterPhotosResponse = {
  booking: {
    id: 'booking_1',
    status: BookingStatus.IN_PROGRESS,
    sessionStep: SessionStep.AFTER_PHOTOS,
    startedAt: '2026-03-17T13:00:00.000Z',
    finishedAt: '2026-03-17T14:00:00.000Z',
  },
  nextHref: '/pro/bookings/booking_1/session/after-photos',
  afterCount: 0,
  meta: {
    mutated: false,
    noOp: true,
  },
}

const aftercareReadyResponse = {
  booking: {
    id: 'booking_1',
    status: BookingStatus.IN_PROGRESS,
    sessionStep: SessionStep.AFTER_PHOTOS,
    startedAt: '2026-03-17T13:00:00.000Z',
    finishedAt: '2026-03-17T14:00:00.000Z',
  },
  nextHref: '/pro/bookings/booking_1/aftercare',
  afterCount: 2,
  meta: {
    mutated: false,
    noOp: true,
  },
}

const doneResponse = {
  booking: {
    id: 'booking_1',
    status: BookingStatus.COMPLETED,
    sessionStep: SessionStep.DONE,
    startedAt: '2026-03-17T13:00:00.000Z',
    finishedAt: '2026-03-17T14:00:00.000Z',
  },
  nextHref: '/pro/bookings/booking_1/aftercare',
  afterCount: 2,
  meta: {
    mutated: false,
    noOp: true,
  },
}

const mocks = vi.hoisted(() => ({
  requirePro: vi.fn(),
  jsonFail: vi.fn(),
  jsonOk: vi.fn(),
  pickString: vi.fn(),

  finishBookingSession: vi.fn(),

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
  finishBookingSession: mocks.finishBookingSession,
}))

vi.mock('@/lib/idempotency', () => ({
  beginIdempotency: mocks.beginIdempotency,
  completeIdempotency: mocks.completeIdempotency,
  failIdempotency: mocks.failIdempotency,
  IDEMPOTENCY_ROUTES: {
    BOOKING_FINISH_SESSION: 'POST /api/pro/bookings/[id]/session/finish',
  },
}))

import { POST } from './route'

function makeRequest(headers?: Record<string, string>): Request {
  return new Request(
    'http://localhost/api/pro/bookings/booking_1/session/finish',
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(headers ?? {}),
      },
    },
  )
}

function makeIdempotentRequest(key = 'idem_finish_booking_1'): Request {
  return makeRequest({
    'idempotency-key': key,
  })
}

function makeCtx(id = 'booking_1') {
  return {
    params: Promise.resolve({ id }),
  }
}

describe('POST /api/pro/bookings/[id]/session/finish', () => {
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

    mocks.finishBookingSession.mockResolvedValue({
      booking: {
        id: 'booking_1',
        status: BookingStatus.IN_PROGRESS,
        sessionStep: SessionStep.FINISH_REVIEW,
        startedAt: new Date('2026-03-17T13:00:00.000Z'),
        finishedAt: new Date('2026-03-17T14:00:00.000Z'),
      },
      afterCount: 0,
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
    expect(mocks.finishBookingSession).not.toHaveBeenCalled()
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
    expect(mocks.finishBookingSession).not.toHaveBeenCalled()
    expect(result).toEqual(
      expect.objectContaining({
        ok: false,
        status: 400,
        code: 'BOOKING_ID_REQUIRED',
      }),
    )
  })

  it('returns missing idempotency key for valid finish request without idempotency header', async () => {
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

    expect(mocks.finishBookingSession).not.toHaveBeenCalled()
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
      error: 'A matching booking finish request is already in progress.',
      code: 'IDEMPOTENCY_REQUEST_IN_PROGRESS',
    })

    expect(mocks.finishBookingSession).not.toHaveBeenCalled()
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

    expect(mocks.finishBookingSession).not.toHaveBeenCalled()
    expect(mocks.completeIdempotency).not.toHaveBeenCalled()
  })

  it('replays completed idempotency response without finishing again', async () => {
    mocks.beginIdempotency.mockResolvedValueOnce({
      kind: 'replay',
      responseStatus: 200,
      responseBody: defaultFinishResponse,
    })

    const result = await POST(makeIdempotentRequest(), makeCtx())

    expect(result).toEqual({
      ok: true,
      status: 200,
      data: defaultFinishResponse,
    })

    expect(mocks.finishBookingSession).not.toHaveBeenCalled()
    expect(mocks.completeIdempotency).not.toHaveBeenCalled()
  })

  it('finishes the booking session, completes idempotency, and returns session hub href', async () => {
    const result = await POST(
      makeIdempotentRequest('idem_finish_success_1'),
      makeCtx(),
    )

    expect(mocks.beginIdempotency).toHaveBeenCalledWith({
      actor: {
        actorUserId: 'user_123',
        actorRole: 'PRO',
      },
      route: IDEMPOTENCY_ROUTE,
      key: 'idem_finish_success_1',
      requestBody: {
        professionalId: 'pro_123',
        actorUserId: 'user_123',
        bookingId: 'booking_1',
      },
    })

    expect(mocks.finishBookingSession).toHaveBeenCalledWith({
      bookingId: 'booking_1',
      professionalId: 'pro_123',
      requestId: null,
      idempotencyKey: 'idem_finish_success_1',
    })

    expect(mocks.completeIdempotency).toHaveBeenCalledWith({
      idempotencyRecordId: 'idem_record_1',
      responseStatus: 200,
      responseBody: defaultFinishResponse,
    })

    expect(mocks.jsonOk).toHaveBeenCalledWith(defaultFinishResponse, 200)

    expect(result).toEqual({
      ok: true,
      status: 200,
      data: defaultFinishResponse,
    })
  })

  it('passes request id header through to finishBookingSession', async () => {
    await POST(
      makeRequest({
        'idempotency-key': 'idem_finish_with_request_id_1',
        'x-request-id': 'request_123',
      }),
      makeCtx(),
    )

    expect(mocks.finishBookingSession).toHaveBeenCalledWith({
      bookingId: 'booking_1',
      professionalId: 'pro_123',
      requestId: 'request_123',
      idempotencyKey: 'idem_finish_with_request_id_1',
    })
  })

  it('routes AFTER_PHOTOS with zero after photos to after photos upload', async () => {
    mocks.finishBookingSession.mockResolvedValueOnce({
      booking: {
        id: 'booking_1',
        status: BookingStatus.IN_PROGRESS,
        sessionStep: SessionStep.AFTER_PHOTOS,
        startedAt: new Date('2026-03-17T13:00:00.000Z'),
        finishedAt: new Date('2026-03-17T14:00:00.000Z'),
      },
      afterCount: 0,
      meta: {
        mutated: false,
        noOp: true,
      },
    })

    const result = await POST(
      makeIdempotentRequest('idem_finish_after_photos_empty_1'),
      makeCtx(),
    )

    expect(mocks.completeIdempotency).toHaveBeenCalledWith({
      idempotencyRecordId: 'idem_record_1',
      responseStatus: 200,
      responseBody: afterPhotosResponse,
    })

    expect(result).toEqual({
      ok: true,
      status: 200,
      data: afterPhotosResponse,
    })
  })

  it('routes AFTER_PHOTOS with existing after photos to aftercare', async () => {
    mocks.finishBookingSession.mockResolvedValueOnce({
      booking: {
        id: 'booking_1',
        status: BookingStatus.IN_PROGRESS,
        sessionStep: SessionStep.AFTER_PHOTOS,
        startedAt: new Date('2026-03-17T13:00:00.000Z'),
        finishedAt: new Date('2026-03-17T14:00:00.000Z'),
      },
      afterCount: 2,
      meta: {
        mutated: false,
        noOp: true,
      },
    })

    const result = await POST(
      makeIdempotentRequest('idem_finish_after_photos_ready_1'),
      makeCtx(),
    )

    expect(mocks.completeIdempotency).toHaveBeenCalledWith({
      idempotencyRecordId: 'idem_record_1',
      responseStatus: 200,
      responseBody: aftercareReadyResponse,
    })

    expect(result).toEqual({
      ok: true,
      status: 200,
      data: aftercareReadyResponse,
    })
  })

  it('routes DONE to aftercare', async () => {
    mocks.finishBookingSession.mockResolvedValueOnce({
      booking: {
        id: 'booking_1',
        status: BookingStatus.COMPLETED,
        sessionStep: SessionStep.DONE,
        startedAt: new Date('2026-03-17T13:00:00.000Z'),
        finishedAt: new Date('2026-03-17T14:00:00.000Z'),
      },
      afterCount: 2,
      meta: {
        mutated: false,
        noOp: true,
      },
    })

    const result = await POST(
      makeIdempotentRequest('idem_finish_done_1'),
      makeCtx(),
    )

    expect(mocks.completeIdempotency).toHaveBeenCalledWith({
      idempotencyRecordId: 'idem_record_1',
      responseStatus: 200,
      responseBody: doneResponse,
    })

    expect(result).toEqual({
      ok: true,
      status: 200,
      data: doneResponse,
    })
  })

  it('maps booking errors to jsonFail and marks idempotency failed', async () => {
    mocks.finishBookingSession.mockRejectedValueOnce(
      bookingError('BOOKING_NOT_FOUND', {
        message: 'Booking was not found for this professional.',
        userMessage: 'Booking not found.',
      }),
    )

    const result = await POST(
      makeIdempotentRequest('idem_finish_not_found_1'),
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
    mocks.finishBookingSession.mockRejectedValueOnce(new Error('boom'))

    const result = await POST(
      makeIdempotentRequest('idem_finish_boom_1'),
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