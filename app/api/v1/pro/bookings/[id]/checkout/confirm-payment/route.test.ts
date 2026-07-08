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

  confirmProBookingPaymentReceived: vi.fn(),
  kickNotificationDrain: vi.fn(),

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
  confirmProBookingPaymentReceived: mocks.confirmProBookingPaymentReceived,
}))

vi.mock('@/lib/notifications/delivery/kickNotificationDrain', () => ({
  kickNotificationDrain: mocks.kickNotificationDrain,
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
    PRO_BOOKING_CHECKOUT_CONFIRM_PAYMENT:
      'POST /api/v1/pro/bookings/[id]/checkout/confirm-payment',
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
    headers: { 'content-type': 'application/json' },
  })
}

function makeRequest(headers?: Record<string, string>): Request {
  return new Request(
    'http://localhost/api/v1/pro/bookings/booking_1/checkout/confirm-payment',
    {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(headers ?? {}) },
    },
  )
}

function makeContext(id = 'booking_1'): RouteContext {
  return { params: Promise.resolve({ id }) }
}

function makeSuccessResult() {
  return {
    booking: {
      id: 'booking_1',
      checkoutStatus: 'PAID',
      paymentCollectedAt: new Date('2026-05-02T16:00:00.000Z'),
      status: BookingStatus.COMPLETED,
      sessionStep: SessionStep.DONE,
    },
    meta: {
      mutated: true,
      noOp: false,
      completedBooking: true,
    },
    approvedNextAppointmentBookingIds: ['rebook_1'],
  }
}

function makeSuccessResponseBody() {
  return {
    booking: {
      id: 'booking_1',
      checkoutStatus: 'PAID',
      paymentCollectedAt: '2026-05-02T16:00:00.000Z',
      status: BookingStatus.COMPLETED,
      sessionStep: SessionStep.DONE,
    },
    meta: {
      mutated: true,
      noOp: false,
      completedBooking: true,
      approvedNextAppointmentBookingIds: ['rebook_1'],
    },
  }
}

function expectIdempotencyStarted(key = 'idem_confirm_1'): void {
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
  overrides?: { error?: string; message?: string },
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

describe('POST /api/v1/pro/bookings/[id]/checkout/confirm-payment', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    mocks.requirePro.mockResolvedValue({
      ok: true,
      professionalId: 'pro_123',
      user: { id: 'user_pro_1' },
    })

    mocks.jsonFail.mockImplementation(
      (status: number, error: string, extra?: Record<string, unknown>) =>
        makeJsonResponse(status, { ok: false, error, ...(extra ?? {}) }),
    )

    mocks.jsonOk.mockImplementation((data: Record<string, unknown>, status = 200) =>
      makeJsonResponse(status, { ok: true, ...(data ?? {}) }),
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
      resetAt: new Date('2026-05-02T16:01:00.000Z'),
      retryAfterSeconds: 60,
      source: 'redis',
    })

    expectIdempotencyStarted()

    mocks.confirmProBookingPaymentReceived.mockResolvedValue(makeSuccessResult())
    mocks.completeRouteIdempotency.mockResolvedValue(undefined)
    mocks.failStartedRouteIdempotency.mockResolvedValue(undefined)
  })

  it('returns auth response when requirePro fails before rate limit or idempotency', async () => {
    const authRes = makeJsonResponse(401, { ok: false, error: 'Unauthorized' })
    mocks.requirePro.mockResolvedValueOnce({ ok: false, res: authRes })

    const result = await POST(makeRequest(), makeContext())

    expect(result).toBe(authRes)
    expect(mocks.enforceRateLimit).not.toHaveBeenCalled()
    expect(mocks.beginRouteIdempotency).not.toHaveBeenCalled()
    expect(mocks.confirmProBookingPaymentReceived).not.toHaveBeenCalled()
  })

  it('returns BOOKING_ID_REQUIRED when booking id is blank before rate limit or idempotency', async () => {
    const descriptor = getBookingErrorDescriptor('BOOKING_ID_REQUIRED')

    const result = await POST(makeRequest(), makeContext('   '))

    expect(result.status).toBe(descriptor.httpStatus)
    expectBookingFailPayload(await result.json(), 'BOOKING_ID_REQUIRED')
    expect(mocks.enforceRateLimit).not.toHaveBeenCalled()
    expect(mocks.confirmProBookingPaymentReceived).not.toHaveBeenCalled()
  })

  it('returns rate-limit response before idempotency or the mutation', async () => {
    const blockedDecision = {
      allowed: false,
      bucket: 'pro:bookings:write',
      key: 'user:user_pro_1|pro:pro_123|ip:unknown-ip',
      limit: 30,
      remaining: 0,
      resetAt: new Date('2026-05-02T16:01:00.000Z'),
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
      makeRequest({ 'idempotency-key': 'idem_confirm_1' }),
      makeContext(),
    )

    expect(result).toBe(limitedResponse)
    expect(mocks.beginRouteIdempotency).not.toHaveBeenCalled()
    expect(mocks.confirmProBookingPaymentReceived).not.toHaveBeenCalled()
  })

  it('returns handled idempotency response without calling the boundary', async () => {
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
    expect(mocks.confirmProBookingPaymentReceived).not.toHaveBeenCalled()
    expect(mocks.completeRouteIdempotency).not.toHaveBeenCalled()
  })

  it('confirms payment through the write boundary, returns approved rebooks, and drains notifications', async () => {
    const result = await POST(
      makeRequest({
        'idempotency-key': 'idem_confirm_1',
        'x-request-id': 'req_123',
      }),
      makeContext(),
    )

    expect(mocks.beginRouteIdempotency).toHaveBeenCalledWith(
      expect.objectContaining({
        route: IDEMPOTENCY_ROUTES.PRO_BOOKING_CHECKOUT_CONFIRM_PAYMENT,
        requestLabel: 'pro booking checkout confirm payment',
        requestBody: {
          bookingId: 'booking_1',
          professionalId: 'pro_123',
          action: 'CONFIRM_PAYMENT',
        },
      }),
    )

    expect(mocks.confirmProBookingPaymentReceived).toHaveBeenCalledWith({
      bookingId: 'booking_1',
      professionalId: 'pro_123',
      actorUserId: 'user_pro_1',
      requestId: 'req_123',
      idempotencyKey: 'idem_confirm_1',
    })

    expect(mocks.completeRouteIdempotency).toHaveBeenCalledWith({
      idempotencyRecordId: 'idem_record_1',
      responseStatus: 200,
      responseBody: makeSuccessResponseBody(),
    })

    expect(mocks.kickNotificationDrain).toHaveBeenCalledTimes(1)

    expect(result.status).toBe(200)
    await expect(result.json()).resolves.toEqual({
      ok: true,
      ...makeSuccessResponseBody(),
    })
  })

  it('maps a BookingError (e.g. not awaiting confirmation) and fails started idempotency', async () => {
    const descriptor = getBookingErrorDescriptor('FORBIDDEN')

    mocks.confirmProBookingPaymentReceived.mockRejectedValueOnce(
      new BookingError('FORBIDDEN'),
    )

    const result = await POST(
      makeRequest({ 'idempotency-key': 'idem_confirm_1' }),
      makeContext(),
    )

    expect(mocks.failStartedRouteIdempotency).toHaveBeenCalledWith({
      idempotencyRecordId: 'idem_record_1',
      operation: 'POST /api/v1/pro/bookings/[id]/checkout/confirm-payment',
    })
    expect(result.status).toBe(descriptor.httpStatus)
    expectBookingFailPayload(await result.json(), 'FORBIDDEN')
    expect(mocks.completeRouteIdempotency).not.toHaveBeenCalled()
    expect(mocks.kickNotificationDrain).not.toHaveBeenCalled()
  })
})
