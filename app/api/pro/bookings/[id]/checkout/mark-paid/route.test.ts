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

  markProBookingCheckoutPaid: vi.fn(),

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
  markProBookingCheckoutPaid: mocks.markProBookingCheckoutPaid,
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
    PRO_BOOKING_CHECKOUT_MARK_PAID:
      'POST /api/pro/bookings/[id]/checkout/mark-paid',
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
  headers?: Record<string, string>,
  body: Record<string, unknown> | null = { selectedPaymentMethod: 'CASH' },
): Request {
  return new Request(
    'http://localhost/api/pro/bookings/booking_1/checkout/mark-paid',
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(headers ?? {}),
      },
      ...(body === null ? {} : { body: JSON.stringify(body) }),
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
      checkoutStatus: 'PAID',
      paymentCollectedAt: new Date('2026-03-17T13:30:00.000Z'),
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
      checkoutStatus: 'PAID',
      paymentCollectedAt: '2026-03-17T13:30:00.000Z',
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

function expectIdempotencyStarted(key = 'idem_mark_paid_1'): void {
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

describe('POST /api/pro/bookings/[id]/checkout/mark-paid', () => {
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

    mocks.markProBookingCheckoutPaid.mockResolvedValue(makeSuccessResult())
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
    expect(mocks.markProBookingCheckoutPaid).not.toHaveBeenCalled()
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
    expect(mocks.markProBookingCheckoutPaid).not.toHaveBeenCalled()
    expect(mocks.completeRouteIdempotency).not.toHaveBeenCalled()
    expect(mocks.failStartedRouteIdempotency).not.toHaveBeenCalled()
  })

  it('rejects with 400 when no payment method is supplied, before rate limit or idempotency', async () => {
    const result = await POST(makeRequest(undefined, null), makeContext())

    expect(result.status).toBe(400)
    await expect(result.json()).resolves.toEqual({
      ok: false,
      error:
        'Choose how the client paid (cash, tap to pay, Venmo, Zelle, Apple Cash, or card on file).',
    })

    expect(mocks.proRateLimitKey).not.toHaveBeenCalled()
    expect(mocks.enforceRateLimit).not.toHaveBeenCalled()
    expect(mocks.beginRouteIdempotency).not.toHaveBeenCalled()
    expect(mocks.markProBookingCheckoutPaid).not.toHaveBeenCalled()
  })

  it('returns rate-limit response before idempotency or mark-paid mutation', async () => {
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
      makeRequest({
        'idempotency-key': 'idem_mark_paid_1',
      }),
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
    expect(mocks.markProBookingCheckoutPaid).not.toHaveBeenCalled()
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

    expect(mocks.markProBookingCheckoutPaid).not.toHaveBeenCalled()
    expect(mocks.completeRouteIdempotency).not.toHaveBeenCalled()
    expect(mocks.failStartedRouteIdempotency).not.toHaveBeenCalled()
  })

  it('marks checkout paid through the write boundary and completes idempotency', async () => {
    const result = await POST(
      makeRequest({
        'idempotency-key': 'idem_mark_paid_1',
        'x-request-id': 'req_123',
      }),
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
      route: IDEMPOTENCY_ROUTES.PRO_BOOKING_CHECKOUT_MARK_PAID,
      requestLabel: 'pro booking checkout mark paid',
      requestBody: {
        bookingId: 'booking_1',
        professionalId: 'pro_123',
        action: 'MARK_PAID',
        selectedPaymentMethod: 'CASH',
      },
      messages: {
        missingKey: 'Missing idempotency key.',
        inProgress:
          'A matching checkout mark-paid request is already in progress.',
        conflict:
          'This idempotency key was already used with a different checkout mark-paid request.',
      },
    })

    expect(mocks.markProBookingCheckoutPaid).toHaveBeenCalledWith({
      bookingId: 'booking_1',
      professionalId: 'pro_123',
      actorUserId: 'user_pro_1',
      selectedPaymentMethod: 'CASH',
      requestId: 'req_123',
      idempotencyKey: 'idem_mark_paid_1',
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

  it('normalizes missing request id to null', async () => {
    await POST(
      makeRequest({
        'idempotency-key': 'idem_mark_paid_1',
      }),
      makeContext(),
    )

    expect(mocks.markProBookingCheckoutPaid).toHaveBeenCalledWith(
      expect.objectContaining({
        requestId: null,
      }),
    )
  })

  it('maps BookingError and fails started idempotency', async () => {
    const descriptor = getBookingErrorDescriptor('BOOKING_NOT_FOUND')

    mocks.markProBookingCheckoutPaid.mockRejectedValueOnce(
      new BookingError('BOOKING_NOT_FOUND'),
    )

    const result = await POST(
      makeRequest({
        'idempotency-key': 'idem_mark_paid_1',
      }),
      makeContext(),
    )

    expect(mocks.failStartedRouteIdempotency).toHaveBeenCalledWith({
      idempotencyRecordId: 'idem_record_1',
      operation: 'POST /api/pro/bookings/[id]/checkout/mark-paid',
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

    mocks.markProBookingCheckoutPaid.mockRejectedValueOnce(error)

    const result = await POST(
      makeRequest({
        'idempotency-key': 'idem_mark_paid_1',
      }),
      makeContext(),
    )

    expect(mocks.failStartedRouteIdempotency).toHaveBeenCalledWith({
      idempotencyRecordId: 'idem_record_1',
      operation: 'POST /api/pro/bookings/[id]/checkout/mark-paid',
    })

    expect(mocks.safeError).toHaveBeenCalledWith(error)
    expect(mocks.safeLogMeta).toHaveBeenCalledWith({
      route: 'POST /api/pro/bookings/[id]/checkout/mark-paid',
      idempotencyRecordId: 'idem_record_1',
    })

    expect(consoleErrorSpy).toHaveBeenCalledWith(
      'POST /api/pro/bookings/[id]/checkout/mark-paid error',
      {
        error: {
          name: 'Error',
          message: 'boom',
        },
        meta: {
          route: 'POST /api/pro/bookings/[id]/checkout/mark-paid',
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

    const markPaidError = new Error('mark paid exploded')
    const failError = new Error('idempotency cleanup exploded')

    mocks.markProBookingCheckoutPaid.mockRejectedValueOnce(markPaidError)
    mocks.failStartedRouteIdempotency.mockRejectedValueOnce(failError)

    const result = await POST(
      makeRequest({
        'idempotency-key': 'idem_mark_paid_cleanup_error_1',
      }),
      makeContext(),
    )

    expect(mocks.safeError).toHaveBeenCalledWith(failError)
    expect(mocks.safeLogMeta).toHaveBeenCalledWith({
      route: 'POST /api/pro/bookings/[id]/checkout/mark-paid',
      idempotencyRecordId: 'idem_record_1',
    })

    expect(consoleErrorSpy).toHaveBeenCalledWith(
      'POST /api/pro/bookings/[id]/checkout/mark-paid idempotency failure update error',
      {
        error: {
          name: 'Error',
          message: 'idempotency cleanup exploded',
        },
        meta: {
          route: 'POST /api/pro/bookings/[id]/checkout/mark-paid',
          idempotencyRecordId: 'idem_record_1',
        },
      },
    )

    expect(result.status).toBe(500)
    expectBookingFailPayload(await result.json(), 'INTERNAL_ERROR', {
      error: 'Internal server error',
      message: 'mark paid exploded',
    })

    expect(mocks.completeRouteIdempotency).not.toHaveBeenCalled()

    consoleErrorSpy.mockRestore()
  })
})