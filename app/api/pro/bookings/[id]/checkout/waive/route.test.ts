import { beforeEach, describe, expect, it, vi } from 'vitest'
import { BookingStatus, Role, SessionStep } from '@prisma/client'

import { BookingError, getBookingErrorDescriptor } from '@/lib/booking/errors'

const mocks = vi.hoisted(() => ({
  requirePro: vi.fn(),
  jsonFail: vi.fn(),
  jsonOk: vi.fn(),
  pickString: vi.fn(),

  beginRouteIdempotency: vi.fn(),
  completeRouteIdempotency: vi.fn(),
  failStartedRouteIdempotency: vi.fn(),
  isRouteIdempotencyHandled: vi.fn(),

  waiveProBookingCheckout: vi.fn(),

  enforceRateLimit: vi.fn(),
  proRateLimitKey: vi.fn(),
  rateLimitExceededResponse: vi.fn(),

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

vi.mock('@/lib/booking/writeBoundary', () => ({
  waiveProBookingCheckout: mocks.waiveProBookingCheckout,
}))

vi.mock('@/lib/rateLimit/enforce', () => ({
  enforceRateLimit: mocks.enforceRateLimit,
}))

vi.mock('@/lib/rateLimit/identity', () => ({
  proRateLimitKey: mocks.proRateLimitKey,
}))

vi.mock('@/lib/rateLimit/response', () => ({
  rateLimitExceededResponse: mocks.rateLimitExceededResponse,
}))

vi.mock('@/lib/idempotency', () => ({
  IDEMPOTENCY_ROUTES: {
    PRO_BOOKING_CHECKOUT_WAIVE:
      'POST /api/pro/bookings/[id]/checkout/waive',
  },
}))

vi.mock('@/lib/security/logging', () => ({
  safeError: mocks.safeError,
  safeLogMeta: mocks.safeLogMeta,
}))

import { IDEMPOTENCY_ROUTES } from '@/lib/idempotency'
import { POST } from './route'

type RouteContext = Parameters<typeof POST>[1]

function makeJsonResponse(status: number, payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'content-type': 'application/json',
    },
  })
}

function makeRequest(
  body: unknown = {},
  headers?: Record<string, string>,
): Request {
  return new Request(
    'http://localhost/api/pro/bookings/booking_1/checkout/waive',
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(headers ?? {}),
      },
      body: JSON.stringify(body),
    },
  )
}

function makeContext(id = 'booking_1'): RouteContext {
  return {
    params: Promise.resolve({ id }),
  }
}

function makeSuccessResult() {
  return {
    booking: {
      id: 'booking_1',
      checkoutStatus: 'WAIVED',
      paymentCollectedAt: null,
      status: BookingStatus.COMPLETED,
      sessionStep: SessionStep.DONE,
    },
    meta: {
      mutated: true,
      noOp: false,
      completedBooking: true,
    },
  }
}

function makeSuccessResponseBody() {
  return {
    booking: {
      id: 'booking_1',
      checkoutStatus: 'WAIVED',
      paymentCollectedAt: null,
      status: BookingStatus.COMPLETED,
      sessionStep: SessionStep.DONE,
    },
    meta: {
      mutated: true,
      noOp: false,
      completedBooking: true,
    },
  }
}

function expectIdempotencyStarted(key = 'idem_waive_1'): void {
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

function expectBookingFailPayload(
  responseBody: unknown,
  code: Parameters<typeof getBookingErrorDescriptor>[0],
  overrides?: {
    error?: string
    message?: string
  },
) {
  const descriptor = getBookingErrorDescriptor(code)

  expect(responseBody).toEqual({
    ok: false,
    error: overrides?.error ?? descriptor.userMessage,
    code: descriptor.code,
    retryable: descriptor.retryable,
    uiAction: descriptor.uiAction,
    message: overrides?.message ?? descriptor.message,
  })
}

describe('POST /api/pro/bookings/[id]/checkout/waive', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    mocks.requirePro.mockResolvedValue({
      ok: true,
      professionalId: 'pro_123',
      user: {
        id: 'user_pro_1',
      },
    })

    mocks.jsonFail.mockImplementation(
      (status: number, error: string, extra?: Record<string, unknown>) =>
        makeJsonResponse(status, {
          ok: false,
          error,
          ...(extra ?? {}),
        }),
    )

    mocks.jsonOk.mockImplementation(
      (data: Record<string, unknown>, status = 200) =>
        makeJsonResponse(status, {
          ok: true,
          ...(data ?? {}),
        }),
    )

    mocks.pickString.mockImplementation((value: unknown) =>
      typeof value === 'string' && value.trim() ? value.trim() : null,
    )

    mocks.safeError.mockImplementation((error: unknown) => ({
      name: error instanceof Error ? error.name : 'UnknownError',
      message: error instanceof Error ? error.message : String(error),
    }))

    mocks.safeLogMeta.mockImplementation((meta: unknown) => meta)

    mocks.proRateLimitKey.mockImplementation(
      (args: { professionalId?: string | null; userId?: string | null }) =>
        `user:${args.userId}|pro:${args.professionalId}|ip:unknown-ip`,
    )

    mocks.enforceRateLimit.mockResolvedValue({
      allowed: true,
      bucket: 'pro:bookings:write',
      key: 'user:user_pro_1|pro:pro_123|ip:unknown-ip',
      limit: 30,
      remaining: 29,
      resetAt: new Date('2026-03-17T13:31:00.000Z'),
      retryAfterSeconds: 60,
      source: 'redis',
    })

    expectIdempotencyStarted()

    mocks.waiveProBookingCheckout.mockResolvedValue(makeSuccessResult())
    mocks.completeRouteIdempotency.mockResolvedValue(undefined)
    mocks.failStartedRouteIdempotency.mockResolvedValue(undefined)
  })

  it('returns auth response when requirePro fails before rate limit or idempotency', async () => {
    const authRes = makeJsonResponse(401, {
      ok: false,
      error: 'Unauthorized',
    })

    mocks.requirePro.mockResolvedValueOnce({
      ok: false,
      res: authRes,
    })

    const result = await POST(makeRequest(), makeContext())

    expect(result).toBe(authRes)

    expect(mocks.proRateLimitKey).not.toHaveBeenCalled()
    expect(mocks.enforceRateLimit).not.toHaveBeenCalled()
    expect(mocks.beginRouteIdempotency).not.toHaveBeenCalled()
    expect(mocks.waiveProBookingCheckout).not.toHaveBeenCalled()
    expect(mocks.completeRouteIdempotency).not.toHaveBeenCalled()
    expect(mocks.failStartedRouteIdempotency).not.toHaveBeenCalled()
  })

  it('returns BOOKING_ID_REQUIRED when booking id is blank before rate limit or idempotency', async () => {
    const descriptor = getBookingErrorDescriptor('BOOKING_ID_REQUIRED')

    const result = await POST(makeRequest(), makeContext('   '))

    expect(result.status).toBe(descriptor.httpStatus)
    expectBookingFailPayload(await result.json(), 'BOOKING_ID_REQUIRED')

    expect(mocks.proRateLimitKey).not.toHaveBeenCalled()
    expect(mocks.enforceRateLimit).not.toHaveBeenCalled()
    expect(mocks.beginRouteIdempotency).not.toHaveBeenCalled()
    expect(mocks.waiveProBookingCheckout).not.toHaveBeenCalled()
    expect(mocks.completeRouteIdempotency).not.toHaveBeenCalled()
    expect(mocks.failStartedRouteIdempotency).not.toHaveBeenCalled()
  })

  it('returns rate-limit response before idempotency or waive mutation', async () => {
    const blockedDecision = {
      allowed: false,
      bucket: 'pro:bookings:write',
      key: 'user:user_pro_1|pro:pro_123|ip:unknown-ip',
      limit: 30,
      remaining: 0,
      resetAt: new Date('2026-03-17T13:31:00.000Z'),
      retryAfterSeconds: 60,
      source: 'redis',
      reason: 'rate_limited',
    } as const

    const limitedResponse = makeJsonResponse(429, {
      ok: false,
      error: 'Too many requests. Please try again later.',
      code: 'RATE_LIMITED',
    })

    mocks.enforceRateLimit.mockResolvedValueOnce(blockedDecision)
    mocks.rateLimitExceededResponse.mockReturnValueOnce(limitedResponse)

    const result = await POST(
      makeRequest(
        {
          reason: 'Client comped by salon manager',
        },
        {
          'idempotency-key': 'idem_waive_1',
        },
      ),
      makeContext(),
    )

    expect(result).toBe(limitedResponse)

    expect(mocks.proRateLimitKey).toHaveBeenCalledWith({
      professionalId: 'pro_123',
      userId: 'user_pro_1',
      request: expect.any(Request),
    })

    expect(mocks.enforceRateLimit).toHaveBeenCalledWith({
      bucket: 'pro:bookings:write',
      key: 'user:user_pro_1|pro:pro_123|ip:unknown-ip',
    })

    expect(mocks.rateLimitExceededResponse).toHaveBeenCalledWith(
      blockedDecision,
    )

    expect(mocks.beginRouteIdempotency).not.toHaveBeenCalled()
    expect(mocks.waiveProBookingCheckout).not.toHaveBeenCalled()
    expect(mocks.completeRouteIdempotency).not.toHaveBeenCalled()
    expect(mocks.failStartedRouteIdempotency).not.toHaveBeenCalled()
  })

  it('returns handled idempotency response without calling boundary', async () => {
    const handledResponse = makeJsonResponse(400, {
      ok: false,
      error: 'Missing idempotency key.',
      code: 'IDEMPOTENCY_KEY_REQUIRED',
    })

    mocks.beginRouteIdempotency.mockResolvedValueOnce({
      kind: 'handled',
      response: handledResponse,
    })

    const result = await POST(makeRequest(), makeContext())

    expect(result).toBe(handledResponse)

    expect(mocks.proRateLimitKey).toHaveBeenCalledWith({
      professionalId: 'pro_123',
      userId: 'user_pro_1',
      request: expect.any(Request),
    })

    expect(mocks.enforceRateLimit).toHaveBeenCalledWith({
      bucket: 'pro:bookings:write',
      key: 'user:user_pro_1|pro:pro_123|ip:unknown-ip',
    })

    expect(mocks.waiveProBookingCheckout).not.toHaveBeenCalled()
    expect(mocks.completeRouteIdempotency).not.toHaveBeenCalled()
    expect(mocks.failStartedRouteIdempotency).not.toHaveBeenCalled()
  })

  it('waives checkout through the write boundary and completes idempotency', async () => {
    const result = await POST(
      makeRequest(
        {
          reason: 'Client comped by salon manager',
        },
        {
          'idempotency-key': 'idem_waive_1',
          'x-request-id': 'req_123',
        },
      ),
      makeContext(),
    )

    expect(mocks.proRateLimitKey).toHaveBeenCalledWith({
      professionalId: 'pro_123',
      userId: 'user_pro_1',
      request: expect.any(Request),
    })

    expect(mocks.enforceRateLimit).toHaveBeenCalledWith({
      bucket: 'pro:bookings:write',
      key: 'user:user_pro_1|pro:pro_123|ip:unknown-ip',
    })

    expect(mocks.beginRouteIdempotency).toHaveBeenCalledWith({
      request: expect.any(Request),
      actor: {
        actorUserId: 'user_pro_1',
        actorRole: Role.PRO,
      },
      route: IDEMPOTENCY_ROUTES.PRO_BOOKING_CHECKOUT_WAIVE,
      requestLabel: 'pro booking checkout waive',
      requestBody: {
        bookingId: 'booking_1',
        professionalId: 'pro_123',
        action: 'WAIVE',
        reason: 'Client comped by salon manager',
      },
      messages: {
        missingKey: 'Missing idempotency key.',
        inProgress: 'A matching checkout waive request is already in progress.',
        conflict:
          'This idempotency key was already used with a different checkout waive request.',
      },
    })

    expect(mocks.waiveProBookingCheckout).toHaveBeenCalledWith({
      bookingId: 'booking_1',
      professionalId: 'pro_123',
      actorUserId: 'user_pro_1',
      requestId: 'req_123',
      idempotencyKey: 'idem_waive_1',
      reason: 'Client comped by salon manager',
    })

    expect(mocks.completeRouteIdempotency).toHaveBeenCalledWith({
      idempotencyRecordId: 'idem_record_1',
      responseStatus: 200,
      responseBody: makeSuccessResponseBody(),
    })

    expect(result.status).toBe(200)
    await expect(result.json()).resolves.toEqual({
      ok: true,
      ...makeSuccessResponseBody(),
    })
  })

  it('normalizes blank waive reason to null', async () => {
    await POST(
      makeRequest(
        {
          reason: '   ',
        },
        {
          'idempotency-key': 'idem_waive_1',
        },
      ),
      makeContext(),
    )

    expect(mocks.beginRouteIdempotency).toHaveBeenCalledWith(
      expect.objectContaining({
        requestBody: expect.objectContaining({
          reason: null,
        }),
      }),
    )

    expect(mocks.waiveProBookingCheckout).toHaveBeenCalledWith(
      expect.objectContaining({
        reason: null,
      }),
    )
  })

  it('truncates waive reason to 500 characters', async () => {
    const reason = 'a'.repeat(600)

    await POST(
      makeRequest(
        {
          reason,
        },
        {
          'idempotency-key': 'idem_waive_1',
        },
      ),
      makeContext(),
    )

    expect(mocks.waiveProBookingCheckout).toHaveBeenCalledWith(
      expect.objectContaining({
        reason: 'a'.repeat(500),
      }),
    )

    expect(mocks.beginRouteIdempotency).toHaveBeenCalledWith(
      expect.objectContaining({
        requestBody: expect.objectContaining({
          reason: 'a'.repeat(500),
        }),
      }),
    )
  })

  it('normalizes missing request id to null', async () => {
    await POST(
      makeRequest(
        {
          reason: 'Comped',
        },
        {
          'idempotency-key': 'idem_waive_1',
        },
      ),
      makeContext(),
    )

    expect(mocks.waiveProBookingCheckout).toHaveBeenCalledWith(
      expect.objectContaining({
        requestId: null,
      }),
    )
  })

  it('maps BookingError and fails started idempotency', async () => {
    const descriptor = getBookingErrorDescriptor('BOOKING_NOT_FOUND')

    mocks.waiveProBookingCheckout.mockRejectedValueOnce(
      new BookingError('BOOKING_NOT_FOUND'),
    )

    const result = await POST(
      makeRequest(
        {},
        {
          'idempotency-key': 'idem_waive_1',
        },
      ),
      makeContext(),
    )

    expect(mocks.failStartedRouteIdempotency).toHaveBeenCalledWith({
      idempotencyRecordId: 'idem_record_1',
      operation: 'POST /api/pro/bookings/[id]/checkout/waive',
    })

    expect(result.status).toBe(descriptor.httpStatus)
    expectBookingFailPayload(await result.json(), 'BOOKING_NOT_FOUND')
    expect(mocks.completeRouteIdempotency).not.toHaveBeenCalled()
  })

  it('returns INTERNAL_ERROR for unexpected failures, logs safely, and fails started idempotency', async () => {
    const consoleErrorSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined)

    const error = new Error('boom')

    mocks.waiveProBookingCheckout.mockRejectedValueOnce(error)

    const result = await POST(
      makeRequest(
        {
          reason: 'Client comp',
        },
        {
          'idempotency-key': 'idem_waive_1',
        },
      ),
      makeContext(),
    )

    expect(mocks.failStartedRouteIdempotency).toHaveBeenCalledWith({
      idempotencyRecordId: 'idem_record_1',
      operation: 'POST /api/pro/bookings/[id]/checkout/waive',
    })

    expect(mocks.safeError).toHaveBeenCalledWith(error)
    expect(mocks.safeLogMeta).toHaveBeenCalledWith({
      route: 'POST /api/pro/bookings/[id]/checkout/waive',
      idempotencyRecordId: 'idem_record_1',
    })

    expect(consoleErrorSpy).toHaveBeenCalledWith(
      'POST /api/pro/bookings/[id]/checkout/waive error',
      {
        error: {
          name: 'Error',
          message: 'boom',
        },
        meta: {
          route: 'POST /api/pro/bookings/[id]/checkout/waive',
          idempotencyRecordId: 'idem_record_1',
        },
      },
    )

    expect(result.status).toBe(500)
    expectBookingFailPayload(await result.json(), 'INTERNAL_ERROR', {
      error: 'Internal server error',
      message: 'boom',
    })

    expect(mocks.completeRouteIdempotency).not.toHaveBeenCalled()

    consoleErrorSpy.mockRestore()
    })
    it('logs idempotency failure-update errors safely without masking the original error', async () => {
    const consoleErrorSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined)

    const waiveError = new Error('waive exploded')
    const failError = new Error('idempotency cleanup exploded')

    mocks.waiveProBookingCheckout.mockRejectedValueOnce(waiveError)
    mocks.failStartedRouteIdempotency.mockRejectedValueOnce(failError)

    const result = await POST(
      makeRequest(
        {
          reason: 'Client comp',
        },
        {
          'idempotency-key': 'idem_waive_cleanup_error_1',
        },
      ),
      makeContext(),
    )

    expect(mocks.safeError).toHaveBeenCalledWith(failError)
    expect(mocks.safeLogMeta).toHaveBeenCalledWith({
      route: 'POST /api/pro/bookings/[id]/checkout/waive',
      idempotencyRecordId: 'idem_record_1',
    })

    expect(consoleErrorSpy).toHaveBeenCalledWith(
      'POST /api/pro/bookings/[id]/checkout/waive idempotency failure update error',
      {
        error: {
          name: 'Error',
          message: 'idempotency cleanup exploded',
        },
        meta: {
          route: 'POST /api/pro/bookings/[id]/checkout/waive',
          idempotencyRecordId: 'idem_record_1',
        },
      },
    )

    expect(result.status).toBe(500)
    expectBookingFailPayload(await result.json(), 'INTERNAL_ERROR', {
      error: 'Internal server error',
      message: 'waive exploded',
    })

    expect(mocks.completeRouteIdempotency).not.toHaveBeenCalled()

    consoleErrorSpy.mockRestore()
  })
})