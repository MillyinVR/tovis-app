// app/api/bookings/[id]/reschedule/route.test.ts
import { BookingStatus, Role, ServiceLocationType } from '@prisma/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { BookingError, getBookingErrorDescriptor } from '@/lib/booking/errors'

const mocks = vi.hoisted(() => ({
  requireClient: vi.fn(),
  pickString: vi.fn((value: unknown) =>
    typeof value === 'string' && value.trim() ? value.trim() : null,
  ),
  jsonFail: vi.fn(),
  jsonOk: vi.fn(),

  normalizeLocationType: vi.fn(),
  rescheduleBookingFromHold: vi.fn(),

  beginRouteIdempotency: vi.fn(),
  completeRouteIdempotency: vi.fn(),
  failStartedRouteIdempotency: vi.fn(),
  isRouteIdempotencyHandled: vi.fn(),

  enforceRateLimit: vi.fn(),
  clientRateLimitKey: vi.fn(),
  rateLimitExceededResponse: vi.fn(),

  safeError: vi.fn(),
}))

vi.mock('@/app/api/_utils/auth/requireClient', () => ({
  requireClient: mocks.requireClient,
}))

vi.mock('@/app/api/_utils/pick', () => ({
  pickString: mocks.pickString,
}))

vi.mock('@/app/api/_utils/responses', () => ({
  jsonFail: mocks.jsonFail,
  jsonOk: mocks.jsonOk,
}))

vi.mock('@/app/api/_utils/idempotency', () => ({
  beginRouteIdempotency: mocks.beginRouteIdempotency,
  completeRouteIdempotency: mocks.completeRouteIdempotency,
  failStartedRouteIdempotency: mocks.failStartedRouteIdempotency,
  isRouteIdempotencyHandled: mocks.isRouteIdempotencyHandled,
}))

vi.mock('@/lib/timeZone', () => ({
  DEFAULT_TIME_ZONE: 'UTC',
}))

vi.mock('@/lib/booking/locationContext', () => ({
  normalizeLocationType: mocks.normalizeLocationType,
}))

vi.mock('@/lib/booking/writeBoundary', () => ({
  rescheduleBookingFromHold: mocks.rescheduleBookingFromHold,
}))

vi.mock('@/lib/rateLimit/enforce', () => ({
  enforceRateLimit: mocks.enforceRateLimit,
}))

vi.mock('@/lib/rateLimit/identity', () => ({
  clientRateLimitKey: mocks.clientRateLimitKey,
}))

vi.mock('@/lib/rateLimit/response', () => ({
  rateLimitExceededResponse: mocks.rateLimitExceededResponse,
}))

vi.mock('@/lib/security/logging', () => ({
  safeError: mocks.safeError,
}))

import { IDEMPOTENCY_ROUTES } from '@/lib/idempotency'
import { POST } from './route'

type TestCtx = { params: Promise<{ id: string }> }

function makeCtx(id = 'booking_1'): TestCtx {
  return {
    params: Promise.resolve({ id }),
  }
}

function makeRequest(body: unknown, headers?: HeadersInit): Request {
  return new Request('http://localhost/api/bookings/booking_1/reschedule', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...headers,
    },
    body: JSON.stringify(body),
  })
}

function expectIdempotencyStarted(key = 'idem_key_1'): void {
  mocks.beginRouteIdempotency.mockResolvedValue({
    kind: 'started',
    idempotencyRecordId: 'idem_record_1',
    idempotencyKey: key,
    requestHash: 'hash_1',
  })

  mocks.isRouteIdempotencyHandled.mockReturnValue(false)
}

describe('POST /api/bookings/[id]/reschedule', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    mocks.safeError.mockImplementation((error: unknown) => ({
      name: error instanceof Error ? error.name : 'UnknownError',
      message: error instanceof Error ? error.message : 'Unknown error',
    }))

    mocks.requireClient.mockResolvedValue({
      ok: true,
      clientId: 'client_1',
      user: {
        id: 'user_1',
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

    mocks.clientRateLimitKey.mockImplementation(
      (args: { clientId?: string | null; userId?: string | null }) =>
        args.userId
          ? `user:${args.userId}|client:${args.clientId}|ip:unknown-ip`
          : `client:${args.clientId}|ip:unknown-ip`,
    )

    mocks.enforceRateLimit.mockResolvedValue({
      allowed: true,
      bucket: 'bookings:reschedule',
      key: 'user:user_1|client:client_1|ip:unknown-ip',
      limit: 8,
      remaining: 7,
      resetAt: new Date('2026-03-11T19:05:00.000Z'),
      retryAfterSeconds: 300,
      source: 'redis',
    })

    mocks.normalizeLocationType.mockImplementation((value: unknown) => {
      if (value === ServiceLocationType.SALON) return ServiceLocationType.SALON
      if (value === ServiceLocationType.MOBILE) {
        return ServiceLocationType.MOBILE
      }

      return null
    })

    mocks.rescheduleBookingFromHold.mockResolvedValue({
      booking: {
        id: 'booking_1',
        status: BookingStatus.ACCEPTED,
        scheduledFor: new Date('2026-03-11T19:30:00.000Z'),
        locationType: ServiceLocationType.SALON,
        bufferMinutes: 15,
        totalDurationMinutes: 60,
        locationTimeZone: 'America/Los_Angeles',
      },
      meta: {
        mutated: true,
        noOp: false,
      },
    })

    mocks.completeRouteIdempotency.mockResolvedValue(undefined)
    mocks.failStartedRouteIdempotency.mockResolvedValue(undefined)

    expectIdempotencyStarted()
  })

  it('returns auth response when auth fails', async () => {
    const authRes = { ok: false, status: 401, error: 'Unauthorized' }

    mocks.requireClient.mockResolvedValueOnce({
      ok: false,
      res: authRes,
    })

    const result = await POST(
      makeRequest({
        holdId: 'hold_1',
        locationType: ServiceLocationType.SALON,
      }),
      makeCtx(),
    )

    expect(result).toBe(authRes)

    expect(mocks.clientRateLimitKey).not.toHaveBeenCalled()
    expect(mocks.enforceRateLimit).not.toHaveBeenCalled()
    expect(mocks.beginRouteIdempotency).not.toHaveBeenCalled()
    expect(mocks.rescheduleBookingFromHold).not.toHaveBeenCalled()
    expect(mocks.completeRouteIdempotency).not.toHaveBeenCalled()
    expect(mocks.failStartedRouteIdempotency).not.toHaveBeenCalled()
  })

  it('returns BOOKING_ID_REQUIRED before starting idempotency when booking id is missing', async () => {
    const descriptor = getBookingErrorDescriptor('BOOKING_ID_REQUIRED')

    const result = await POST(
      makeRequest({
        holdId: 'hold_1',
      }),
      makeCtx(''),
    )

    expect(mocks.jsonFail).toHaveBeenCalledWith(
      descriptor.httpStatus,
      descriptor.userMessage,
      {
        code: descriptor.code,
        retryable: descriptor.retryable,
        uiAction: descriptor.uiAction,
        message: descriptor.message,
      },
    )

    expect(result).toEqual({
      ok: false,
      status: descriptor.httpStatus,
      error: descriptor.userMessage,
      code: descriptor.code,
      retryable: descriptor.retryable,
      uiAction: descriptor.uiAction,
      message: descriptor.message,
    })

    expect(mocks.clientRateLimitKey).not.toHaveBeenCalled()
    expect(mocks.enforceRateLimit).not.toHaveBeenCalled()
    expect(mocks.beginRouteIdempotency).not.toHaveBeenCalled()
    expect(mocks.rescheduleBookingFromHold).not.toHaveBeenCalled()
    expect(mocks.completeRouteIdempotency).not.toHaveBeenCalled()
    expect(mocks.failStartedRouteIdempotency).not.toHaveBeenCalled()
  })

  it('returns HOLD_ID_REQUIRED before starting idempotency when holdId is missing', async () => {
    const descriptor = getBookingErrorDescriptor('HOLD_ID_REQUIRED')

    const result = await POST(
      makeRequest({
        locationType: ServiceLocationType.SALON,
      }),
      makeCtx(),
    )

    expect(mocks.jsonFail).toHaveBeenCalledWith(
      descriptor.httpStatus,
      descriptor.userMessage,
      {
        code: descriptor.code,
        retryable: descriptor.retryable,
        uiAction: descriptor.uiAction,
        message: descriptor.message,
      },
    )

    expect(result).toEqual({
      ok: false,
      status: descriptor.httpStatus,
      error: descriptor.userMessage,
      code: descriptor.code,
      retryable: descriptor.retryable,
      uiAction: descriptor.uiAction,
      message: descriptor.message,
    })

    expect(mocks.clientRateLimitKey).not.toHaveBeenCalled()
    expect(mocks.enforceRateLimit).not.toHaveBeenCalled()
    expect(mocks.beginRouteIdempotency).not.toHaveBeenCalled()
    expect(mocks.rescheduleBookingFromHold).not.toHaveBeenCalled()
    expect(mocks.completeRouteIdempotency).not.toHaveBeenCalled()
    expect(mocks.failStartedRouteIdempotency).not.toHaveBeenCalled()
  })

  it('returns INVALID_LOCATION_TYPE before starting idempotency when locationType is invalid', async () => {
    const descriptor = getBookingErrorDescriptor('INVALID_LOCATION_TYPE')

    mocks.normalizeLocationType.mockReturnValueOnce(null)

    const result = await POST(
      makeRequest({
        holdId: 'hold_1',
        locationType: 'BOAT_SALON',
      }),
      makeCtx(),
    )

    expect(mocks.jsonFail).toHaveBeenCalledWith(
      descriptor.httpStatus,
      descriptor.userMessage,
      {
        code: descriptor.code,
        retryable: descriptor.retryable,
        uiAction: descriptor.uiAction,
        message: descriptor.message,
      },
    )

    expect(result).toEqual({
      ok: false,
      status: descriptor.httpStatus,
      error: descriptor.userMessage,
      code: descriptor.code,
      retryable: descriptor.retryable,
      uiAction: descriptor.uiAction,
      message: descriptor.message,
    })

    expect(mocks.clientRateLimitKey).not.toHaveBeenCalled()
    expect(mocks.enforceRateLimit).not.toHaveBeenCalled()
    expect(mocks.beginRouteIdempotency).not.toHaveBeenCalled()
    expect(mocks.rescheduleBookingFromHold).not.toHaveBeenCalled()
    expect(mocks.completeRouteIdempotency).not.toHaveBeenCalled()
    expect(mocks.failStartedRouteIdempotency).not.toHaveBeenCalled()
  })

  it('returns rate-limit response before idempotency or reschedule mutation', async () => {
    const blockedDecision = {
      allowed: false,
      bucket: 'bookings:reschedule',
      key: 'user:user_1|client:client_1|ip:unknown-ip',
      limit: 8,
      remaining: 0,
      resetAt: new Date('2026-03-11T19:05:00.000Z'),
      retryAfterSeconds: 300,
      source: 'redis',
      reason: 'rate_limited',
    } as const

    const limitedResponse = {
      ok: false,
      status: 429,
      error: 'Too many requests. Please try again later.',
      code: 'RATE_LIMITED',
    }

    mocks.enforceRateLimit.mockResolvedValueOnce(blockedDecision)
    mocks.rateLimitExceededResponse.mockReturnValueOnce(limitedResponse)

    const result = await POST(
      makeRequest(
        {
          holdId: 'hold_1',
          locationType: ServiceLocationType.SALON,
        },
        {
          'idempotency-key': 'idem_reschedule_1',
        },
      ),
      makeCtx(),
    )

    expect(result).toBe(limitedResponse)

    expect(mocks.clientRateLimitKey).toHaveBeenCalledWith({
      clientId: 'client_1',
      userId: 'user_1',
      request: expect.any(Request),
    })

    expect(mocks.enforceRateLimit).toHaveBeenCalledWith({
      bucket: 'bookings:reschedule',
      key: 'user:user_1|client:client_1|ip:unknown-ip',
    })

    expect(mocks.rateLimitExceededResponse).toHaveBeenCalledWith(
      blockedDecision,
    )

    expect(mocks.beginRouteIdempotency).not.toHaveBeenCalled()
    expect(mocks.rescheduleBookingFromHold).not.toHaveBeenCalled()
    expect(mocks.completeRouteIdempotency).not.toHaveBeenCalled()
    expect(mocks.failStartedRouteIdempotency).not.toHaveBeenCalled()
  })

  it('returns a handled idempotency response without calling rescheduleBookingFromHold', async () => {
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

    mocks.isRouteIdempotencyHandled.mockReturnValueOnce(true)

    const result = await POST(
      makeRequest({
        holdId: 'hold_1',
        locationType: ServiceLocationType.SALON,
      }),
      makeCtx(),
    )

    expect(result).toBe(handledResponse)
    expect(mocks.rescheduleBookingFromHold).not.toHaveBeenCalled()
    expect(mocks.completeRouteIdempotency).not.toHaveBeenCalled()
    expect(mocks.failStartedRouteIdempotency).not.toHaveBeenCalled()
  })

  it('starts idempotency with client, booking, hold, and location details', async () => {
    await POST(
      makeRequest(
        {
          holdId: 'hold_1',
          locationType: ServiceLocationType.SALON,
        },
        {
          'idempotency-key': 'idem_key_1',
        },
      ),
      makeCtx(),
    )

    expect(mocks.clientRateLimitKey).toHaveBeenCalledWith({
      clientId: 'client_1',
      userId: 'user_1',
      request: expect.any(Request),
    })

    expect(mocks.enforceRateLimit).toHaveBeenCalledWith({
      bucket: 'bookings:reschedule',
      key: 'user:user_1|client:client_1|ip:unknown-ip',
    })

    expect(mocks.beginRouteIdempotency).toHaveBeenCalledWith({
      request: expect.any(Request),
      actor: {
        actorKey: 'client:client_1',
        actorRole: Role.CLIENT,
      },
      route: IDEMPOTENCY_ROUTES.BOOKING_RESCHEDULE,
      requestLabel: 'booking reschedule',
      requestBody: {
        bookingId: 'booking_1',
        clientId: 'client_1',
        holdId: 'hold_1',
        requestedLocationType: ServiceLocationType.SALON,
      },
      messages: {
        missingKey: 'Missing idempotency key for booking reschedule.',
        inProgress:
          'A matching booking reschedule request is already in progress.',
        conflict:
          'This idempotency key was already used with different reschedule details.',
      },
    })
  })

  it('starts idempotency with null requestedLocationType when locationType is omitted', async () => {
    await POST(
      makeRequest({
        holdId: 'hold_1',
      }),
      makeCtx(),
    )

    expect(mocks.normalizeLocationType).not.toHaveBeenCalled()

    expect(mocks.clientRateLimitKey).toHaveBeenCalledWith({
      clientId: 'client_1',
      userId: 'user_1',
      request: expect.any(Request),
    })

    expect(mocks.enforceRateLimit).toHaveBeenCalledWith({
      bucket: 'bookings:reschedule',
      key: 'user:user_1|client:client_1|ip:unknown-ip',
    })

    expect(mocks.beginRouteIdempotency).toHaveBeenCalledWith(
      expect.objectContaining({
        requestBody: {
          bookingId: 'booking_1',
          clientId: 'client_1',
          holdId: 'hold_1',
          requestedLocationType: null,
        },
      }),
    )
  })

  it('calls rescheduleBookingFromHold after idempotency starts', async () => {
    const result = await POST(
      makeRequest({
        holdId: 'hold_1',
        locationType: ServiceLocationType.SALON,
      }),
      makeCtx(),
    )

    expect(mocks.clientRateLimitKey).toHaveBeenCalledWith({
      clientId: 'client_1',
      userId: 'user_1',
      request: expect.any(Request),
    })

    expect(mocks.enforceRateLimit).toHaveBeenCalledWith({
      bucket: 'bookings:reschedule',
      key: 'user:user_1|client:client_1|ip:unknown-ip',
    })

    expect(mocks.rescheduleBookingFromHold).toHaveBeenCalledWith({
      bookingId: 'booking_1',
      clientId: 'client_1',
      holdId: 'hold_1',
      requestedLocationType: ServiceLocationType.SALON,
      fallbackTimeZone: 'UTC',
    })

    expect(mocks.completeRouteIdempotency).toHaveBeenCalledWith({
      idempotencyRecordId: 'idem_record_1',
      responseStatus: 200,
      responseBody: {
        ok: true,
        booking: {
          id: 'booking_1',
          status: BookingStatus.ACCEPTED,
          scheduledFor: '2026-03-11T19:30:00.000Z',
          locationType: ServiceLocationType.SALON,
          bufferMinutes: 15,
          totalDurationMinutes: 60,
          locationTimeZone: 'America/Los_Angeles',
        },
        meta: {
          mutated: true,
          noOp: false,
        },
      },
    })

    expect(mocks.jsonOk).toHaveBeenCalledWith(
      {
        ok: true,
        booking: {
          id: 'booking_1',
          status: BookingStatus.ACCEPTED,
          scheduledFor: '2026-03-11T19:30:00.000Z',
          locationType: ServiceLocationType.SALON,
          bufferMinutes: 15,
          totalDurationMinutes: 60,
          locationTimeZone: 'America/Los_Angeles',
        },
        meta: {
          mutated: true,
          noOp: false,
        },
      },
      200,
    )

    expect(result).toEqual({
      ok: true,
      status: 200,
      data: {
        ok: true,
        booking: {
          id: 'booking_1',
          status: BookingStatus.ACCEPTED,
          scheduledFor: '2026-03-11T19:30:00.000Z',
          locationType: ServiceLocationType.SALON,
          bufferMinutes: 15,
          totalDurationMinutes: 60,
          locationTimeZone: 'America/Los_Angeles',
        },
        meta: {
          mutated: true,
          noOp: false,
        },
      },
    })
  })

  it('fails idempotency and maps BookingError from rescheduleBookingFromHold', async () => {
    const descriptor = getBookingErrorDescriptor('TIME_BOOKED')

    mocks.rescheduleBookingFromHold.mockRejectedValueOnce(
      new BookingError('TIME_BOOKED'),
    )

    const result = await POST(
      makeRequest({
        holdId: 'hold_1',
      }),
      makeCtx(),
    )

    expect(mocks.failStartedRouteIdempotency).toHaveBeenCalledWith({
      idempotencyRecordId: 'idem_record_1',
      operation: 'POST /api/bookings/[id]/reschedule',
    })

    expect(mocks.jsonFail).toHaveBeenCalledWith(
      descriptor.httpStatus,
      descriptor.userMessage,
      {
        code: descriptor.code,
        retryable: descriptor.retryable,
        uiAction: descriptor.uiAction,
        message: descriptor.message,
      },
    )

    expect(result).toEqual({
      ok: false,
      status: descriptor.httpStatus,
      error: descriptor.userMessage,
      code: descriptor.code,
      retryable: descriptor.retryable,
      uiAction: descriptor.uiAction,
      message: descriptor.message,
    })
  })

  it('fails idempotency and returns INTERNAL_ERROR for non-booking errors', async () => {
    const descriptor = getBookingErrorDescriptor('INTERNAL_ERROR')
    const thrown = new Error('boom')

    mocks.rescheduleBookingFromHold.mockRejectedValueOnce(thrown)

    const result = await POST(
      makeRequest({
        holdId: 'hold_1',
      }),
      makeCtx(),
    )

    expect(mocks.failStartedRouteIdempotency).toHaveBeenCalledWith({
      idempotencyRecordId: 'idem_record_1',
      operation: 'POST /api/bookings/[id]/reschedule',
    })

    expect(mocks.safeError).toHaveBeenCalledWith(thrown)

    expect(mocks.jsonFail).toHaveBeenCalledWith(
      descriptor.httpStatus,
      'Failed to reschedule booking.',
      {
        code: descriptor.code,
        retryable: descriptor.retryable,
        uiAction: descriptor.uiAction,
        message: 'boom',
      },
    )

    expect(result).toEqual({
      ok: false,
      status: descriptor.httpStatus,
      error: 'Failed to reschedule booking.',
      code: descriptor.code,
      retryable: descriptor.retryable,
      uiAction: descriptor.uiAction,
      message: 'boom',
    })
  })

  it('does not fail idempotency when an error happens before the ledger starts', async () => {
    const descriptor = getBookingErrorDescriptor('HOLD_ID_REQUIRED')

    await POST(
      makeRequest({
        locationType: ServiceLocationType.SALON,
      }),
      makeCtx(),
    )

    expect(mocks.jsonFail).toHaveBeenCalledWith(
      descriptor.httpStatus,
      descriptor.userMessage,
      {
        code: descriptor.code,
        retryable: descriptor.retryable,
        uiAction: descriptor.uiAction,
        message: descriptor.message,
      },
    )

    expect(mocks.failStartedRouteIdempotency).not.toHaveBeenCalled()
  })
})