import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Role } from '@prisma/client'

const mocks = vi.hoisted(() => ({
  requireUser: vi.fn(),
  withRouteIdempotency: vi.fn(),
  refundNoShowFee: vi.fn(),
  bookingFindUnique: vi.fn(),
  enforceRateLimit: vi.fn(),
  resolveRouteParams: vi.fn(async () => ({ id: 'booking_1' })),
  kickNotificationDrain: vi.fn(),
  readJsonRecord: vi.fn(async () => ({})),
}))

vi.mock('@/app/api/_utils/auth/requireUser', () => ({
  requireUser: mocks.requireUser,
}))

vi.mock('@/app/api/_utils/idempotency', () => ({
  withRouteIdempotency: mocks.withRouteIdempotency,
}))

vi.mock('@/app/api/_utils', () => ({
  jsonFail: (status: number, error: string, extra?: Record<string, unknown>) =>
    new Response(JSON.stringify({ ok: false, error, ...(extra ?? {}) }), {
      status,
      headers: { 'content-type': 'application/json' },
    }),
}))

vi.mock('@/app/api/_utils/pick', () => ({
  pickString: (v: unknown) =>
    typeof v === 'string' && v.trim() ? v.trim() : null,
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

// Mock only the refund fn; the error catalog (getBookingErrorMeta) stays REAL so
// the NOT_ATTEMPTED → HTTP mapping is exercised honestly.
vi.mock('@/lib/booking/refunds', () => ({
  refundNoShowFee: mocks.refundNoShowFee,
}))

vi.mock('@/lib/notifications/delivery/kickNotificationDrain', () => ({
  kickNotificationDrain: mocks.kickNotificationDrain,
}))

vi.mock('@/lib/idempotency', () => ({
  IDEMPOTENCY_ROUTES: {
    BOOKING_NO_SHOW_FEE_REFUND: 'POST /api/v1/bookings/[id]/no-show-fee/refund',
  },
}))

vi.mock('@/lib/rateLimit/enforce', () => ({
  enforceRateLimit: mocks.enforceRateLimit,
}))

vi.mock('@/lib/rateLimit/identity', () => ({
  proRateLimitKey: () => 'rl-key',
}))

vi.mock('@/lib/rateLimit/response', () => ({
  rateLimitExceededResponse: () => new Response('rate limited', { status: 429 }),
}))

vi.mock('@/lib/security/logging', () => ({
  safeError: (e: unknown) => ({ message: e instanceof Error ? e.message : 'x' }),
}))

import { POST } from './route'

const ctx = { params: Promise.resolve({ id: 'booking_1' }) }

function makeReq() {
  return new Request(
    'http://localhost/api/v1/bookings/booking_1/no-show-fee/refund',
    { method: 'POST' },
  )
}

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
  mocks.enforceRateLimit.mockResolvedValue({ allowed: true })
  mocks.readJsonRecord.mockResolvedValue({})
  mocks.bookingFindUnique.mockResolvedValue({
    id: 'booking_1',
    professionalId: 'pro_1',
  })
  mocks.refundNoShowFee.mockResolvedValue({
    outcome: 'REFUNDED',
    refundAmountCents: 2500,
  })
  // Drive the idempotency wrapper by invoking the run callback.
  mocks.withRouteIdempotency.mockImplementation(
    async (
      _opts: unknown,
      run: () => Promise<{ status: number; body: unknown }>,
    ) => {
      const { status, body } = await run()
      return new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json' },
      })
    },
  )
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('POST /api/v1/bookings/[id]/no-show-fee/refund', () => {
  it('passes through a failed auth response', async () => {
    const res = new Response(null, { status: 401 })
    mocks.requireUser.mockResolvedValue({ ok: false, res })

    const result = await POST(makeReq(), ctx)
    expect(result).toBe(res)
    expect(mocks.requireUser).toHaveBeenCalledWith({
      roles: [Role.PRO, Role.ADMIN],
    })
  })

  it('lets a pro refund the fee on their own booking', async () => {
    mocks.requireUser.mockResolvedValue(proAuth('pro_1'))

    const result = await POST(makeReq(), ctx)
    const body = await result.json()

    expect(result.status).toBe(200)
    expect(body.noShowFee).toEqual({ status: 'REFUNDED', refundedCents: 2500 })
    expect(mocks.refundNoShowFee).toHaveBeenCalledWith({
      bookingId: 'booking_1',
      reason: null,
      actor: { userId: 'user_pro', role: Role.PRO },
    })
    // A successful refund kicks the notification drain (the receipt is enqueued).
    expect(mocks.kickNotificationDrain).toHaveBeenCalledTimes(1)
  })

  it('returns a uniform 404 when a pro refunds a booking they do not own', async () => {
    mocks.requireUser.mockResolvedValue(proAuth('pro_1'))
    mocks.bookingFindUnique.mockResolvedValue({
      id: 'booking_1',
      professionalId: 'pro_OTHER',
    })

    const result = await POST(makeReq(), ctx)
    expect(result.status).toBe(404)
    expect(mocks.refundNoShowFee).not.toHaveBeenCalled()
  })

  it('lets an admin refund, acting on the booking’s professional', async () => {
    mocks.requireUser.mockResolvedValue(adminAuth())
    mocks.bookingFindUnique.mockResolvedValue({
      id: 'booking_1',
      professionalId: 'pro_owner',
    })

    const result = await POST(makeReq(), ctx)
    expect(result.status).toBe(200)
    expect(mocks.refundNoShowFee).toHaveBeenCalledWith({
      bookingId: 'booking_1',
      reason: null,
      actor: { userId: 'user_admin', role: Role.ADMIN },
    })
  })

  it('maps each NOT_ATTEMPTED refusal code to a 409 via the error catalog', async () => {
    mocks.requireUser.mockResolvedValue(proAuth('pro_1'))

    for (const code of [
      'NO_SHOW_FEE_NOT_REFUNDABLE',
      'NO_SHOW_FEE_ALREADY_REFUNDED',
      'NO_SHOW_FEE_REFUND_FROZEN_DISPUTED',
    ] as const) {
      mocks.refundNoShowFee.mockResolvedValueOnce({
        outcome: 'NOT_ATTEMPTED',
        code,
      })

      const result = await POST(makeReq(), ctx)
      const body = await result.json()
      expect(result.status).toBe(409)
      expect(body.code).toBe(code)
      expect(typeof body.error).toBe('string')
    }
  })

  it('maps a FAILED Stripe refund to a 502 REFUND_FAILED', async () => {
    mocks.requireUser.mockResolvedValue(proAuth('pro_1'))
    mocks.refundNoShowFee.mockResolvedValue({
      outcome: 'FAILED',
      message: 'card_declined',
    })

    const result = await POST(makeReq(), ctx)
    const body = await result.json()
    expect(result.status).toBe(502)
    expect(body.code).toBe('REFUND_FAILED')
  })

  it('returns 404 when the booking does not exist', async () => {
    mocks.requireUser.mockResolvedValue(adminAuth())
    mocks.bookingFindUnique.mockResolvedValue(null)

    const result = await POST(makeReq(), ctx)
    expect(result.status).toBe(404)
    expect(mocks.refundNoShowFee).not.toHaveBeenCalled()
  })
})
