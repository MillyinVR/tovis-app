// app/api/v1/pro/bookings/[id]/aftercare/send/route.test.ts

import { beforeEach, describe, expect, it, vi } from 'vitest'

const OPERATION = 'POST /api/v1/pro/bookings/[id]/aftercare/send'

const mocks = vi.hoisted(() => ({
  requirePro: vi.fn(),
  jsonFail: vi.fn(),
  jsonOk: vi.fn(),
  pickString: vi.fn(),

  bookingJsonFail: vi.fn(),
  isBookingError: vi.fn(),

  sendExistingAftercareDraft: vi.fn(),
  kickNotificationDrain: vi.fn(),
  captureBookingException: vi.fn(),

  enforceRateLimit: vi.fn(),
  proRateLimitKey: vi.fn(),
  rateLimitExceededResponse: vi.fn(),

  safeError: vi.fn((error: unknown) => ({
    name: error instanceof Error ? error.name : 'NonErrorThrown',
    message: error instanceof Error ? error.message : String(error),
  })),
}))

vi.mock('@/app/api/_utils', () => ({
  jsonFail: mocks.jsonFail,
  jsonOk: mocks.jsonOk,
  pickString: mocks.pickString,
  requirePro: mocks.requirePro,
}))

vi.mock('@/app/api/_utils/bookingResponses', () => ({
  bookingJsonFail: mocks.bookingJsonFail,
}))

vi.mock('@/lib/booking/errors', () => ({
  isBookingError: mocks.isBookingError,
}))

vi.mock('@/lib/booking/writeBoundary', () => ({
  sendExistingAftercareDraft: mocks.sendExistingAftercareDraft,
}))

vi.mock('@/lib/notifications/delivery/kickNotificationDrain', () => ({
  kickNotificationDrain: mocks.kickNotificationDrain,
}))

vi.mock('@/lib/observability/bookingEvents', () => ({
  captureBookingException: mocks.captureBookingException,
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

vi.mock('@/lib/security/logging', () => ({
  safeError: mocks.safeError,
}))

import { POST } from './route'

function makeJsonResponse(status: number, payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function makeCtx(id = 'booking_1') {
  return { params: Promise.resolve({ id }) }
}

function makeRequest(): Request {
  return new Request(
    'http://localhost/api/v1/pro/bookings/booking_1/aftercare/send',
    { method: 'POST' },
  )
}

describe('app/api/v1/pro/bookings/[id]/aftercare/send/route.ts', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    mocks.requirePro.mockResolvedValue({
      ok: true,
      professionalId: 'pro_1',
      userId: 'user_1',
      user: { id: 'user_1' },
    })

    mocks.jsonFail.mockImplementation(
      (status: number, error: string, extra?: Record<string, unknown>) =>
        makeJsonResponse(status, { ok: false, error, ...(extra ?? {}) }),
    )

    mocks.jsonOk.mockImplementation((data: Record<string, unknown>, status = 200) =>
      makeJsonResponse(status, { ok: true, ...(data ?? {}) }),
    )

    mocks.pickString.mockImplementation((value: unknown) => {
      if (typeof value !== 'string') return null
      const trimmed = value.trim()
      return trimmed.length > 0 ? trimmed : null
    })

    mocks.bookingJsonFail.mockImplementation(
      (code: string, overrides?: { message?: string; userMessage?: string }) => {
        const statusByCode: Record<string, number> = {
          BOOKING_ID_REQUIRED: 400,
          BOOKING_NOT_FOUND: 404,
          AFTERCARE_NOT_COMPLETED: 409,
          FORBIDDEN: 403,
        }
        const messageByCode: Record<string, string> = {
          BOOKING_ID_REQUIRED: 'Missing booking id.',
          BOOKING_NOT_FOUND: 'Booking not found.',
          AFTERCARE_NOT_COMPLETED: 'Aftercare is not ready.',
          FORBIDDEN: 'Forbidden.',
        }
        return makeJsonResponse(statusByCode[code] ?? 409, {
          ok: false,
          error: overrides?.userMessage ?? messageByCode[code] ?? code,
          code,
        })
      },
    )

    mocks.isBookingError.mockReturnValue(false)

    mocks.proRateLimitKey.mockReturnValue('user:user_1|pro:pro_1|ip:unknown-ip')

    mocks.enforceRateLimit.mockResolvedValue({
      allowed: true,
      bucket: 'pro:bookings:write',
      key: 'user:user_1|pro:pro_1|ip:unknown-ip',
      limit: 30,
      remaining: 29,
      resetAt: new Date('2026-04-13T18:31:00.000Z'),
      retryAfterSeconds: 60,
      source: 'redis',
    })

    mocks.sendExistingAftercareDraft.mockResolvedValue({ ok: true })
  })

  it('returns the auth response when requirePro fails', async () => {
    const authRes = makeJsonResponse(401, { ok: false, error: 'Unauthorized' })
    mocks.requirePro.mockResolvedValueOnce({ ok: false, res: authRes })

    const result = await POST(makeRequest(), makeCtx())

    expect(result).toBe(authRes)
    expect(mocks.enforceRateLimit).not.toHaveBeenCalled()
    expect(mocks.sendExistingAftercareDraft).not.toHaveBeenCalled()
  })

  it('returns 400 when the booking id is missing', async () => {
    const result = await POST(makeRequest(), makeCtx('   '))

    expect(result.status).toBe(400)
    await expect(result.json()).resolves.toEqual({
      ok: false,
      error: 'Missing booking id.',
      code: 'BOOKING_ID_REQUIRED',
    })
    expect(mocks.enforceRateLimit).not.toHaveBeenCalled()
    expect(mocks.sendExistingAftercareDraft).not.toHaveBeenCalled()
  })

  it('returns the rate-limit response and never sends when throttled', async () => {
    const blocked = {
      allowed: false,
      bucket: 'pro:bookings:write',
      key: 'user:user_1|pro:pro_1|ip:unknown-ip',
      limit: 30,
      remaining: 0,
      resetAt: new Date('2026-04-13T18:31:00.000Z'),
      retryAfterSeconds: 60,
      source: 'redis',
      reason: 'rate_limited',
    } as const
    const limited = makeJsonResponse(429, {
      ok: false,
      error: 'Too many requests. Please try again later.',
      code: 'RATE_LIMITED',
    })

    mocks.enforceRateLimit.mockResolvedValueOnce(blocked)
    mocks.rateLimitExceededResponse.mockReturnValueOnce(limited)

    const result = await POST(makeRequest(), makeCtx())

    expect(result).toBe(limited)
    expect(mocks.proRateLimitKey).toHaveBeenCalledWith({
      professionalId: 'pro_1',
      userId: 'user_1',
      request: expect.any(Request),
    })
    expect(mocks.enforceRateLimit).toHaveBeenCalledWith({
      bucket: 'pro:bookings:write',
      key: 'user:user_1|pro:pro_1|ip:unknown-ip',
    })
    expect(mocks.rateLimitExceededResponse).toHaveBeenCalledWith(blocked)
    expect(mocks.sendExistingAftercareDraft).not.toHaveBeenCalled()
  })

  it('sends the draft, kicks delivery, and returns ok', async () => {
    const result = await POST(makeRequest(), makeCtx())

    expect(mocks.sendExistingAftercareDraft).toHaveBeenCalledWith({
      bookingId: 'booking_1',
      professionalId: 'pro_1',
      actorUserId: 'user_1',
    })
    // Delivery is kicked only after the boundary commits.
    expect(mocks.kickNotificationDrain).toHaveBeenCalledTimes(1)

    expect(result.status).toBe(200)
    await expect(result.json()).resolves.toEqual({ ok: true })
  })

  it('does not kick delivery when the send fails', async () => {
    mocks.sendExistingAftercareDraft.mockRejectedValueOnce({
      code: 'AFTERCARE_NOT_COMPLETED',
      message: 'No aftercare draft exists to send.',
      userMessage: 'Start an aftercare summary before sending it.',
    })
    mocks.isBookingError.mockReturnValueOnce(true)

    const result = await POST(makeRequest(), makeCtx())

    expect(mocks.kickNotificationDrain).not.toHaveBeenCalled()
    expect(mocks.bookingJsonFail).toHaveBeenCalledWith('AFTERCARE_NOT_COMPLETED', {
      message: 'No aftercare draft exists to send.',
      userMessage: 'Start an aftercare summary before sending it.',
    })

    expect(result.status).toBe(409)
    await expect(result.json()).resolves.toEqual({
      ok: false,
      error: 'Start an aftercare summary before sending it.',
      code: 'AFTERCARE_NOT_COMPLETED',
    })
  })

  it('maps a foreign/missing booking to a uniform 404', async () => {
    mocks.sendExistingAftercareDraft.mockRejectedValueOnce({
      code: 'BOOKING_NOT_FOUND',
      message: 'Booking not found.',
      userMessage: 'Booking not found.',
    })
    mocks.isBookingError.mockReturnValueOnce(true)

    const result = await POST(makeRequest(), makeCtx())

    expect(result.status).toBe(404)
    await expect(result.json()).resolves.toEqual({
      ok: false,
      error: 'Booking not found.',
      code: 'BOOKING_NOT_FOUND',
    })
  })

  it('returns 500, logs safely, and captures unexpected errors', async () => {
    const consoleErrorSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined)

    const thrown = new Error('boom for https://example.com/aftercare?token=secret')
    mocks.sendExistingAftercareDraft.mockRejectedValueOnce(thrown)

    const result = await POST(makeRequest(), makeCtx())

    expect(mocks.safeError).toHaveBeenCalledWith(thrown)
    expect(mocks.captureBookingException).toHaveBeenCalledWith({
      error: thrown,
      route: OPERATION,
    })
    expect(mocks.kickNotificationDrain).not.toHaveBeenCalled()

    expect(result.status).toBe(500)
    await expect(result.json()).resolves.toEqual({
      ok: false,
      error: 'Internal server error.',
    })

    consoleErrorSpy.mockRestore()
  })
})
