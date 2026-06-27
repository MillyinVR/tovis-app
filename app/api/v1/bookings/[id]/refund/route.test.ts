import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BookingRefundTrigger, Role } from '@prisma/client'

const mocks = vi.hoisted(() => ({
  requireUser: vi.fn(),
  withRouteIdempotency: vi.fn(),
  refundBookingPayment: vi.fn(),
  bookingFindUnique: vi.fn(),
  enforceRateLimit: vi.fn(),
  proRateLimitKey: vi.fn(() => 'rl-key'),
  rateLimitExceededResponse: vi.fn(
    () => new Response('rate limited', { status: 429 }),
  ),
  resolveRouteParams: vi.fn(async () => ({ id: 'booking_1' })),
  readJsonRecord: vi.fn(async () => ({})),
}))

vi.mock('@/app/api/_utils/auth/requireUser', () => ({
  requireUser: mocks.requireUser,
}))

vi.mock('@/app/api/_utils/idempotency', () => ({
  withRouteIdempotency: mocks.withRouteIdempotency,
}))

vi.mock('@/app/api/_utils/pick', () => ({
  pickString: (v: unknown) =>
    typeof v === 'string' && v.trim() ? v.trim() : null,
}))

vi.mock('@/app/api/_utils/responses', () => ({
  jsonFail: (status: number, error: string, extra?: Record<string, unknown>) =>
    new Response(JSON.stringify({ ok: false, error, ...(extra ?? {}) }), {
      status,
      headers: { 'content-type': 'application/json' },
    }),
}))

vi.mock('@/app/api/_utils/readJsonRecord', () => ({
  readJsonRecord: mocks.readJsonRecord,
}))

vi.mock('@/app/api/_utils/routeContext', () => ({
  resolveRouteParams: mocks.resolveRouteParams,
}))

vi.mock('@/lib/prisma', () => ({
  prisma: { booking: { findUnique: mocks.bookingFindUnique } },
}))

vi.mock('@/lib/booking/refunds', () => ({
  refundBookingPayment: mocks.refundBookingPayment,
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
  safeError: (e: unknown) => ({ message: e instanceof Error ? e.message : 'x' }),
}))

import { POST } from './route'

function makeRequest() {
  return new Request('http://localhost/api/v1/bookings/booking_1/refund', {
    method: 'POST',
  })
}

const ctx = { params: Promise.resolve({ id: 'booking_1' }) }

function proAuth(professionalId = 'pro_1') {
  return {
    ok: true,
    user: {
      id: 'user_pro',
      role: Role.PRO,
      professionalProfile: { id: professionalId },
      clientProfile: null,
    },
  }
}

function adminAuth() {
  return {
    ok: true,
    user: {
      id: 'user_admin',
      role: Role.ADMIN,
      professionalProfile: null,
      clientProfile: null,
    },
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.resolveRouteParams.mockResolvedValue({ id: 'booking_1' })
  mocks.readJsonRecord.mockResolvedValue({})
  mocks.proRateLimitKey.mockReturnValue('rl-key')
  mocks.rateLimitExceededResponse.mockReturnValue(
    new Response('rate limited', { status: 429 }),
  )
  mocks.enforceRateLimit.mockResolvedValue({ allowed: true })
  mocks.bookingFindUnique.mockResolvedValue({
    id: 'booking_1',
    professionalId: 'pro_1',
  })
  // Drive the idempotency wrapper by invoking the run callback and turning the
  // {status, body} into a Response.
  mocks.withRouteIdempotency.mockImplementation(
    async (_opts: unknown, run: () => Promise<{ status: number; body: unknown }>) => {
      const { status, body } = await run()
      return new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json' },
      })
    },
  )
  mocks.refundBookingPayment.mockResolvedValue({
    outcome: 'REFUNDED',
    refund: {
      id: 'refund_1',
      bookingId: 'booking_1',
      amountCents: 10000,
      currency: 'usd',
      status: 'SUCCEEDED',
    },
    bookingFullyRefunded: true,
  })
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('POST /api/v1/bookings/[id]/refund', () => {
  it('passes through a failed auth response', async () => {
    const res = new Response(null, { status: 401 })
    mocks.requireUser.mockResolvedValue({ ok: false, res })

    const result = await POST(makeRequest(), ctx)
    expect(result).toBe(res)
    expect(mocks.requireUser).toHaveBeenCalledWith({
      roles: [Role.PRO, Role.ADMIN],
    })
  })

  it('returns 404 when the booking does not exist', async () => {
    mocks.requireUser.mockResolvedValue(adminAuth())
    mocks.bookingFindUnique.mockResolvedValue(null)

    const result = await POST(makeRequest(), ctx)
    expect(result.status).toBe(404)
    expect(mocks.refundBookingPayment).not.toHaveBeenCalled()
  })

  it('returns 403 when a pro refunds a booking they do not own', async () => {
    mocks.requireUser.mockResolvedValue(proAuth('pro_1'))
    mocks.bookingFindUnique.mockResolvedValue({
      id: 'booking_1',
      professionalId: 'pro_OTHER',
    })

    const result = await POST(makeRequest(), ctx)
    expect(result.status).toBe(403)
    expect(mocks.refundBookingPayment).not.toHaveBeenCalled()
  })

  it('lets a pro refund their own booking (full)', async () => {
    mocks.requireUser.mockResolvedValue(proAuth('pro_1'))

    const result = await POST(makeRequest(), ctx)
    const body = await result.json()

    expect(result.status).toBe(200)
    expect(body.refund.bookingFullyRefunded).toBe(true)
    expect(mocks.refundBookingPayment).toHaveBeenCalledWith({
      bookingId: 'booking_1',
      trigger: BookingRefundTrigger.DISCRETIONARY,
      amountCents: null,
      reason: null,
      actor: { userId: 'user_pro', role: Role.PRO },
    })
  })

  it('lets an admin refund any booking, with a partial amount + reason', async () => {
    mocks.requireUser.mockResolvedValue(adminAuth())
    mocks.bookingFindUnique.mockResolvedValue({
      id: 'booking_1',
      professionalId: 'pro_other',
    })
    mocks.readJsonRecord.mockResolvedValue({ amountCents: 2500, reason: 'goodwill' })
    mocks.refundBookingPayment.mockResolvedValue({
      outcome: 'REFUNDED',
      refund: {
        id: 'refund_2',
        bookingId: 'booking_1',
        amountCents: 2500,
        currency: 'usd',
        status: 'SUCCEEDED',
      },
      bookingFullyRefunded: false,
    })

    const result = await POST(makeRequest(), ctx)
    const body = await result.json()

    expect(result.status).toBe(200)
    expect(body.refund.amountCents).toBe(2500)
    expect(body.refund.bookingFullyRefunded).toBe(false)
    expect(mocks.refundBookingPayment).toHaveBeenCalledWith(
      expect.objectContaining({ amountCents: 2500, reason: 'goodwill' }),
    )
  })

  it('rejects a non-integer / non-positive amount with 400', async () => {
    mocks.requireUser.mockResolvedValue(adminAuth())
    mocks.readJsonRecord.mockResolvedValue({ amountCents: -5 })

    const result = await POST(makeRequest(), ctx)
    expect(result.status).toBe(400)
    expect(mocks.refundBookingPayment).not.toHaveBeenCalled()
  })

  it('maps NOTHING_TO_REFUND to 409', async () => {
    mocks.requireUser.mockResolvedValue(adminAuth())
    mocks.refundBookingPayment.mockResolvedValue({
      outcome: 'SKIPPED',
      reason: 'NOTHING_TO_REFUND',
    })

    const result = await POST(makeRequest(), ctx)
    expect(result.status).toBe(409)
  })

  it('maps NOT_STRIPE_PAYMENT to 422', async () => {
    mocks.requireUser.mockResolvedValue(adminAuth())
    mocks.refundBookingPayment.mockResolvedValue({
      outcome: 'SKIPPED',
      reason: 'NOT_STRIPE_PAYMENT',
    })

    const result = await POST(makeRequest(), ctx)
    expect(result.status).toBe(422)
  })

  it('maps INVALID_AMOUNT from the service to 400', async () => {
    mocks.requireUser.mockResolvedValue(adminAuth())
    mocks.refundBookingPayment.mockResolvedValue({
      outcome: 'INVALID',
      code: 'INVALID_AMOUNT',
      message: 'too much',
    })

    const result = await POST(makeRequest(), ctx)
    expect(result.status).toBe(400)
  })

  it('maps a Stripe FAILED outcome to 502', async () => {
    mocks.requireUser.mockResolvedValue(adminAuth())
    mocks.refundBookingPayment.mockResolvedValue({
      outcome: 'FAILED',
      refund: { id: 'refund_f' },
      message: 'stripe down',
    })

    const result = await POST(makeRequest(), ctx)
    expect(result.status).toBe(502)
  })

  it('returns the rate-limit response when throttled', async () => {
    mocks.requireUser.mockResolvedValue(adminAuth())
    mocks.enforceRateLimit.mockResolvedValue({ allowed: false })

    const result = await POST(makeRequest(), ctx)
    expect(result.status).toBe(429)
    expect(mocks.withRouteIdempotency).not.toHaveBeenCalled()
  })
})
