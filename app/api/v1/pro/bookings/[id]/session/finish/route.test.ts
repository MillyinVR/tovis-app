// app/api/v1/pro/bookings/[id]/session/finish/route.test.ts

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Role, SessionStep } from '@prisma/client'
import { bookingError } from '@/lib/booking/errors'

const IDEMPOTENCY_ROUTE = 'POST /api/v1/pro/bookings/[id]/session/finish'

function expectedBody(args: {
  sessionStep: SessionStep
  afterCount: number
  nextHref: string
}) {
  return {
    booking: {
      id: 'booking_1',
      sessionStep: args.sessionStep,
    },
    nextHref: args.nextHref,
    afterCount: args.afterCount,
  }
}

const afterPhotosResponse = expectedBody({
  sessionStep: SessionStep.AFTER_PHOTOS,
  afterCount: 0,
  nextHref: '/pro/bookings/booking_1/session/after-photos',
})

const wrapUpResponse = expectedBody({
  sessionStep: SessionStep.AFTER_PHOTOS,
  afterCount: 2,
  nextHref: '/pro/bookings/booking_1/aftercare',
})

const doneResponse = expectedBody({
  sessionStep: SessionStep.DONE,
  afterCount: 2,
  nextHref: '/pro/bookings/booking_1/aftercare',
})

const mocks = vi.hoisted(() => ({
  requirePro: vi.fn(),
  jsonFail: vi.fn(),
  jsonOk: vi.fn(),
  pickString: vi.fn(),

  finishSessionToAfterPhotos: vi.fn(),
  mediaCount: vi.fn(),

  beginRouteIdempotency: vi.fn(),
  completeRouteIdempotency: vi.fn(),
  failStartedRouteIdempotency: vi.fn(),
  isRouteIdempotencyHandled: vi.fn(),

  safeError: vi.fn(),
  safeLogMeta: vi.fn(),
}))

vi.mock('@/app/api/_utils', () => ({
  requirePro: mocks.requirePro,
  jsonFail: mocks.jsonFail,
  jsonOk: mocks.jsonOk,
  pickString: mocks.pickString,
}))

vi.mock('@/app/api/_utils/idempotency', () => ({
  beginRouteIdempotency: mocks.beginRouteIdempotency,
  completeRouteIdempotency: mocks.completeRouteIdempotency,
  failStartedRouteIdempotency: mocks.failStartedRouteIdempotency,
  isRouteIdempotencyHandled: mocks.isRouteIdempotencyHandled,
}))

vi.mock('@/lib/booking/finishSessionToAfterPhotos', () => ({
  finishSessionToAfterPhotos: mocks.finishSessionToAfterPhotos,
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    mediaAsset: {
      count: mocks.mediaCount,
    },
  },
}))

vi.mock('@/lib/idempotency', () => ({
  IDEMPOTENCY_ROUTES: {
    BOOKING_FINISH_SESSION: 'POST /api/v1/pro/bookings/[id]/session/finish',
  },
}))

vi.mock('@/lib/security/logging', () => ({
  safeError: mocks.safeError,
  safeLogMeta: mocks.safeLogMeta,
}))

import { POST } from './route'

function makeRequest(headers?: Record<string, string>): Request {
  return new Request(
    'http://localhost/api/v1/pro/bookings/booking_1/session/finish',
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

function expectIdempotencyStarted(key = 'idem_finish_booking_1'): void {
  mocks.beginRouteIdempotency.mockResolvedValue({
    kind: 'started',
    idempotencyRecordId: 'idem_record_1',
    idempotencyKey: key,
    requestHash: 'hash_1',
  })

  mocks.isRouteIdempotencyHandled.mockImplementation(
    (result: { kind: string }) => result.kind === 'handled',
  )
}

describe('POST /api/v1/pro/bookings/[id]/session/finish', () => {
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

    mocks.safeError.mockImplementation((error: unknown) => ({
      name: error instanceof Error ? error.name : 'UnknownError',
      message: error instanceof Error ? error.message : String(error),
    }))

    mocks.safeLogMeta.mockImplementation((meta: unknown) => meta)

    expectIdempotencyStarted()

    mocks.completeRouteIdempotency.mockResolvedValue(undefined)
    mocks.failStartedRouteIdempotency.mockResolvedValue(undefined)

    // Default: finishing service lands the booking in AFTER_PHOTOS with no
    // after photos captured yet.
    mocks.finishSessionToAfterPhotos.mockResolvedValue({
      sessionStep: SessionStep.AFTER_PHOTOS,
    })
    mocks.mediaCount.mockResolvedValue(0)
  })

  it('returns auth response when requirePro fails', async () => {
    const authRes = { ok: false, status: 401, error: 'Unauthorized' }

    mocks.requirePro.mockResolvedValueOnce({
      ok: false,
      res: authRes,
    })

    const result = await POST(makeRequest(), makeCtx())

    expect(result).toBe(authRes)
    expect(mocks.beginRouteIdempotency).not.toHaveBeenCalled()
    expect(mocks.finishSessionToAfterPhotos).not.toHaveBeenCalled()
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

    expect(mocks.beginRouteIdempotency).not.toHaveBeenCalled()
    expect(mocks.finishSessionToAfterPhotos).not.toHaveBeenCalled()
    expect(result).toEqual(
      expect.objectContaining({
        ok: false,
        status: 400,
        code: 'BOOKING_ID_REQUIRED',
      }),
    )
  })

  it('returns handled idempotency response for missing idempotency key', async () => {
    const handledResponse = {
      ok: false,
      status: 400,
      error: 'Missing idempotency key.',
      code: 'IDEMPOTENCY_KEY_REQUIRED',
    }

    mocks.beginRouteIdempotency.mockResolvedValueOnce({
      kind: 'handled',
      response: handledResponse,
    })

    const result = await POST(makeRequest(), makeCtx())

    expect(result).toBe(handledResponse)

    expect(mocks.beginRouteIdempotency).toHaveBeenCalledWith({
      request: expect.any(Request),
      actor: {
        actorUserId: 'user_123',
        actorRole: Role.PRO,
      },
      route: IDEMPOTENCY_ROUTE,
      requestLabel: 'booking finish',
      requestBody: {
        professionalId: 'pro_123',
        actorUserId: 'user_123',
        bookingId: 'booking_1',
      },
      messages: {
        missingKey: 'Missing idempotency key.',
        inProgress:
          'A matching booking finish request is already in progress.',
        conflict:
          'This idempotency key was already used with a different request body.',
      },
    })

    expect(mocks.finishSessionToAfterPhotos).not.toHaveBeenCalled()
    expect(mocks.completeRouteIdempotency).not.toHaveBeenCalled()
  })

  it('returns handled in-progress idempotency response', async () => {
    const handledResponse = {
      ok: false,
      status: 409,
      error: 'A matching booking finish request is already in progress.',
      code: 'IDEMPOTENCY_REQUEST_IN_PROGRESS',
    }

    mocks.beginRouteIdempotency.mockResolvedValueOnce({
      kind: 'handled',
      response: handledResponse,
    })

    const result = await POST(makeIdempotentRequest(), makeCtx())

    expect(result).toBe(handledResponse)
    expect(mocks.finishSessionToAfterPhotos).not.toHaveBeenCalled()
    expect(mocks.completeRouteIdempotency).not.toHaveBeenCalled()
  })

  it('returns handled conflict idempotency response', async () => {
    const handledResponse = {
      ok: false,
      status: 409,
      error:
        'This idempotency key was already used with a different request body.',
      code: 'IDEMPOTENCY_KEY_CONFLICT',
    }

    mocks.beginRouteIdempotency.mockResolvedValueOnce({
      kind: 'handled',
      response: handledResponse,
    })

    const result = await POST(makeIdempotentRequest(), makeCtx())

    expect(result).toBe(handledResponse)
    expect(mocks.finishSessionToAfterPhotos).not.toHaveBeenCalled()
    expect(mocks.completeRouteIdempotency).not.toHaveBeenCalled()
  })

  it('replays completed idempotency response without finishing again', async () => {
    const handledResponse = {
      ok: true,
      status: 200,
      data: afterPhotosResponse,
    }

    mocks.beginRouteIdempotency.mockResolvedValueOnce({
      kind: 'handled',
      response: handledResponse,
    })

    const result = await POST(makeIdempotentRequest(), makeCtx())

    expect(result).toBe(handledResponse)
    expect(mocks.finishSessionToAfterPhotos).not.toHaveBeenCalled()
    expect(mocks.completeRouteIdempotency).not.toHaveBeenCalled()
  })

  it('finishes the service, completes idempotency, and routes to after photos', async () => {
    expectIdempotencyStarted('idem_finish_success_1')

    const result = await POST(
      makeIdempotentRequest('idem_finish_success_1'),
      makeCtx(),
    )

    expect(mocks.beginRouteIdempotency).toHaveBeenCalledWith({
      request: expect.any(Request),
      actor: {
        actorUserId: 'user_123',
        actorRole: Role.PRO,
      },
      route: IDEMPOTENCY_ROUTE,
      requestLabel: 'booking finish',
      requestBody: {
        professionalId: 'pro_123',
        actorUserId: 'user_123',
        bookingId: 'booking_1',
      },
      messages: {
        missingKey: 'Missing idempotency key.',
        inProgress:
          'A matching booking finish request is already in progress.',
        conflict:
          'This idempotency key was already used with a different request body.',
      },
    })

    expect(mocks.finishSessionToAfterPhotos).toHaveBeenCalledWith({
      bookingId: 'booking_1',
      professionalId: 'pro_123',
      requestId: null,
      idempotencyKey: 'idem_finish_success_1',
    })

    expect(mocks.completeRouteIdempotency).toHaveBeenCalledWith({
      idempotencyRecordId: 'idem_record_1',
      responseStatus: 200,
      responseBody: afterPhotosResponse,
    })

    expect(mocks.jsonOk).toHaveBeenCalledWith(afterPhotosResponse, 200)

    expect(result).toEqual({
      ok: true,
      status: 200,
      data: afterPhotosResponse,
    })
  })

  it('passes request id header through to finishSessionToAfterPhotos', async () => {
    expectIdempotencyStarted('idem_finish_with_request_id_1')

    await POST(
      makeRequest({
        'idempotency-key': 'idem_finish_with_request_id_1',
        'x-request-id': 'request_123',
      }),
      makeCtx(),
    )

    expect(mocks.finishSessionToAfterPhotos).toHaveBeenCalledWith({
      bookingId: 'booking_1',
      professionalId: 'pro_123',
      requestId: 'request_123',
      idempotencyKey: 'idem_finish_with_request_id_1',
    })
  })

  it('routes AFTER_PHOTOS with zero after photos to after photos upload', async () => {
    expectIdempotencyStarted('idem_finish_after_photos_empty_1')

    mocks.finishSessionToAfterPhotos.mockResolvedValueOnce({
      sessionStep: SessionStep.AFTER_PHOTOS,
    })
    mocks.mediaCount.mockResolvedValueOnce(0)

    const result = await POST(
      makeIdempotentRequest('idem_finish_after_photos_empty_1'),
      makeCtx(),
    )

    expect(mocks.completeRouteIdempotency).toHaveBeenCalledWith({
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

  it('routes AFTER_PHOTOS with existing after photos to wrap-up (aftercare)', async () => {
    expectIdempotencyStarted('idem_finish_after_photos_ready_1')

    mocks.finishSessionToAfterPhotos.mockResolvedValueOnce({
      sessionStep: SessionStep.AFTER_PHOTOS,
    })
    mocks.mediaCount.mockResolvedValueOnce(2)

    const result = await POST(
      makeIdempotentRequest('idem_finish_after_photos_ready_1'),
      makeCtx(),
    )

    expect(mocks.completeRouteIdempotency).toHaveBeenCalledWith({
      idempotencyRecordId: 'idem_record_1',
      responseStatus: 200,
      responseBody: wrapUpResponse,
    })

    expect(result).toEqual({
      ok: true,
      status: 200,
      data: wrapUpResponse,
    })
  })

  it('routes DONE to aftercare', async () => {
    expectIdempotencyStarted('idem_finish_done_1')

    mocks.finishSessionToAfterPhotos.mockResolvedValueOnce({
      sessionStep: SessionStep.DONE,
    })
    mocks.mediaCount.mockResolvedValueOnce(2)

    const result = await POST(
      makeIdempotentRequest('idem_finish_done_1'),
      makeCtx(),
    )

    expect(mocks.completeRouteIdempotency).toHaveBeenCalledWith({
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
    mocks.finishSessionToAfterPhotos.mockRejectedValueOnce(
      bookingError('BOOKING_NOT_FOUND', {
        message: 'Booking was not found for this professional.',
        userMessage: 'Booking not found.',
      }),
    )

    const result = await POST(
      makeIdempotentRequest('idem_finish_not_found_1'),
      makeCtx(),
    )

    expect(mocks.failStartedRouteIdempotency).toHaveBeenCalledWith({
      idempotencyRecordId: 'idem_record_1',
      operation: 'POST /api/v1/pro/bookings/[id]/session/finish',
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

  it('logs unexpected errors through safe logging helpers, returns internal error, and marks idempotency failed', async () => {
    const consoleErrorSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined)

    const error = new Error('boom')
    mocks.finishSessionToAfterPhotos.mockRejectedValueOnce(error)

    try {
      const result = await POST(
        makeIdempotentRequest('idem_finish_boom_1'),
        makeCtx(),
      )

      expect(mocks.failStartedRouteIdempotency).toHaveBeenCalledWith({
        idempotencyRecordId: 'idem_record_1',
        operation: 'POST /api/v1/pro/bookings/[id]/session/finish',
      })

      expect(mocks.safeError).toHaveBeenCalledWith(error)
      expect(mocks.safeLogMeta).toHaveBeenCalledWith({
        route: 'POST /api/v1/pro/bookings/[id]/session/finish',
        idempotencyRecordId: 'idem_record_1',
      })

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        'POST /api/v1/pro/bookings/[id]/session/finish error',
        {
          error: {
            name: 'Error',
            message: 'boom',
          },
          meta: {
            route: 'POST /api/v1/pro/bookings/[id]/session/finish',
            idempotencyRecordId: 'idem_record_1',
          },
        },
      )

      expect(mocks.jsonFail).toHaveBeenCalledWith(500, 'Internal server error')

      expect(result).toEqual({
        ok: false,
        status: 500,
        error: 'Internal server error',
      })
    } finally {
      consoleErrorSpy.mockRestore()
    }
  })
})
