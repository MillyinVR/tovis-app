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

  reopenProBookingCheckout: vi.fn(),

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
  reopenProBookingCheckout: mocks.reopenProBookingCheckout,
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
    PRO_BOOKING_CHECKOUT_REOPEN:
      'POST /api/v1/pro/bookings/[id]/checkout/reopen',
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

function makeRequest(headers?: Record<string, string>): Request {
  return new Request(
    'http://localhost/api/v1/pro/bookings/booking_1/checkout/reopen',
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(headers ?? {}),
      },
    },
  )
}

function makeContext(id = 'booking_1'): RouteContext {
  return {
    params: Promise.resolve({ id }),
  }
}

// A reopen that actually reversed a manual PAID close-out: checkout back to
// READY, collected timestamp cleared, booking still IN_PROGRESS.
function makeReopenedResult() {
  return {
    booking: {
      id: 'booking_1',
      checkoutStatus: 'READY',
      paymentCollectedAt: null,
      status: BookingStatus.IN_PROGRESS,
      sessionStep: SessionStep.AFTER_PHOTOS,
    },
    meta: {
      mutated: true,
      noOp: false,
      reopened: true,
    },
  }
}

function makeReopenedResponseBody() {
  return {
    booking: {
      id: 'booking_1',
      checkoutStatus: 'READY',
      paymentCollectedAt: null,
      status: BookingStatus.IN_PROGRESS,
      sessionStep: SessionStep.AFTER_PHOTOS,
    },
    meta: {
      mutated: true,
      noOp: false,
      reopened: true,
    },
  }
}

// The idempotent no-op: nothing was closed out, so nothing to reverse.
function makeNoOpResult() {
  return {
    booking: {
      id: 'booking_1',
      checkoutStatus: 'READY',
      paymentCollectedAt: null,
      status: BookingStatus.IN_PROGRESS,
      sessionStep: SessionStep.AFTER_PHOTOS,
    },
    meta: {
      mutated: false,
      noOp: true,
      reopened: false,
    },
  }
}

function expectIdempotencyStarted(key = 'idem_reopen_1'): void {
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

describe('POST /api/v1/pro/bookings/[id]/checkout/reopen', () => {
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

    mocks.reopenProBookingCheckout.mockResolvedValue(makeReopenedResult())
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
    expect(mocks.reopenProBookingCheckout).not.toHaveBeenCalled()
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
    expect(mocks.reopenProBookingCheckout).not.toHaveBeenCalled()
  })

  it('returns rate-limit response before idempotency or reopen mutation', async () => {
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
      makeRequest({ 'idempotency-key': 'idem_reopen_1' }),
      makeContext(),
    )

    expect(result).toBe(limitedResponse)
    expect(mocks.beginRouteIdempotency).not.toHaveBeenCalled()
    expect(mocks.reopenProBookingCheckout).not.toHaveBeenCalled()
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
    expect(mocks.reopenProBookingCheckout).not.toHaveBeenCalled()
    expect(mocks.completeRouteIdempotency).not.toHaveBeenCalled()
  })

  it('reopens checkout through the write boundary and completes idempotency', async () => {
    const result = await POST(
      makeRequest({
        'idempotency-key': 'idem_reopen_1',
        'x-request-id': 'req_123',
      }),
      makeContext(),
    )

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
      route: IDEMPOTENCY_ROUTES.PRO_BOOKING_CHECKOUT_REOPEN,
      requestLabel: 'pro booking checkout reopen',
      requestBody: {
        bookingId: 'booking_1',
        professionalId: 'pro_123',
        action: 'REOPEN',
      },
      messages: {
        missingKey: 'Missing idempotency key.',
        inProgress:
          'A matching checkout reopen request is already in progress.',
        conflict:
          'This idempotency key was already used with a different checkout reopen request.',
      },
    })

    expect(mocks.reopenProBookingCheckout).toHaveBeenCalledWith({
      bookingId: 'booking_1',
      professionalId: 'pro_123',
      actorUserId: 'user_pro_1',
      requestId: 'req_123',
      idempotencyKey: 'idem_reopen_1',
    })

    expect(mocks.completeRouteIdempotency).toHaveBeenCalledWith({
      idempotencyRecordId: 'idem_record_1',
      responseStatus: 200,
      responseBody: makeReopenedResponseBody(),
    })

    expect(result.status).toBe(200)
    await expect(result.json()).resolves.toEqual({
      ok: true,
      ...makeReopenedResponseBody(),
    })
  })

  it('returns a 200 no-op body (mutated:false, reopened:false) when nothing was closed out', async () => {
    mocks.reopenProBookingCheckout.mockResolvedValueOnce(makeNoOpResult())

    const result = await POST(
      makeRequest({ 'idempotency-key': 'idem_reopen_noop' }),
      makeContext(),
    )

    expect(result.status).toBe(200)
    await expect(result.json()).resolves.toEqual({
      ok: true,
      booking: {
        id: 'booking_1',
        checkoutStatus: 'READY',
        paymentCollectedAt: null,
        status: BookingStatus.IN_PROGRESS,
        sessionStep: SessionStep.AFTER_PHOTOS,
      },
      meta: {
        mutated: false,
        noOp: true,
        reopened: false,
      },
    })
  })

  it('maps CHECKOUT_REOPEN_STRIPE_REQUIRES_REFUND to the wire and fails started idempotency', async () => {
    const descriptor = getBookingErrorDescriptor(
      'CHECKOUT_REOPEN_STRIPE_REQUIRES_REFUND',
    )

    mocks.reopenProBookingCheckout.mockRejectedValueOnce(
      new BookingError('CHECKOUT_REOPEN_STRIPE_REQUIRES_REFUND'),
    )

    const result = await POST(
      makeRequest({ 'idempotency-key': 'idem_reopen_1' }),
      makeContext(),
    )

    expect(mocks.failStartedRouteIdempotency).toHaveBeenCalledWith({
      idempotencyRecordId: 'idem_record_1',
      operation: 'POST /api/v1/pro/bookings/[id]/checkout/reopen',
    })

    expect(result.status).toBe(descriptor.httpStatus)
    expectBookingFailPayload(
      await result.json(),
      'CHECKOUT_REOPEN_STRIPE_REQUIRES_REFUND',
    )
    expect(mocks.completeRouteIdempotency).not.toHaveBeenCalled()
  })

  it('maps CHECKOUT_REOPEN_COMPLETED_UNSUPPORTED to the wire', async () => {
    const descriptor = getBookingErrorDescriptor(
      'CHECKOUT_REOPEN_COMPLETED_UNSUPPORTED',
    )

    mocks.reopenProBookingCheckout.mockRejectedValueOnce(
      new BookingError('CHECKOUT_REOPEN_COMPLETED_UNSUPPORTED'),
    )

    const result = await POST(
      makeRequest({ 'idempotency-key': 'idem_reopen_1' }),
      makeContext(),
    )

    expect(result.status).toBe(descriptor.httpStatus)
    expectBookingFailPayload(
      await result.json(),
      'CHECKOUT_REOPEN_COMPLETED_UNSUPPORTED',
    )
  })

  it('maps BOOKING_NOT_FOUND and fails started idempotency', async () => {
    const descriptor = getBookingErrorDescriptor('BOOKING_NOT_FOUND')

    mocks.reopenProBookingCheckout.mockRejectedValueOnce(
      new BookingError('BOOKING_NOT_FOUND'),
    )

    const result = await POST(
      makeRequest({ 'idempotency-key': 'idem_reopen_1' }),
      makeContext(),
    )

    expect(mocks.failStartedRouteIdempotency).toHaveBeenCalledWith({
      idempotencyRecordId: 'idem_record_1',
      operation: 'POST /api/v1/pro/bookings/[id]/checkout/reopen',
    })

    expect(result.status).toBe(descriptor.httpStatus)
    expectBookingFailPayload(await result.json(), 'BOOKING_NOT_FOUND')
    expect(mocks.completeRouteIdempotency).not.toHaveBeenCalled()
  })

  it('returns INTERNAL_ERROR for unexpected failures and fails started idempotency', async () => {
    const consoleErrorSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined)

    const error = new Error('boom')

    mocks.reopenProBookingCheckout.mockRejectedValueOnce(error)

    const result = await POST(
      makeRequest({ 'idempotency-key': 'idem_reopen_1' }),
      makeContext(),
    )

    expect(mocks.failStartedRouteIdempotency).toHaveBeenCalledWith({
      idempotencyRecordId: 'idem_record_1',
      operation: 'POST /api/v1/pro/bookings/[id]/checkout/reopen',
    })

    expect(result.status).toBe(500)
    expectBookingFailPayload(await result.json(), 'INTERNAL_ERROR', {
      error: 'Internal server error',
      message: 'boom',
    })

    expect(mocks.completeRouteIdempotency).not.toHaveBeenCalled()

    consoleErrorSpy.mockRestore()
  })
})
