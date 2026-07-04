import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NoShowFeeStatus, Role } from '@prisma/client'

import { bookingError } from '@/lib/booking/errors'

const mocks = vi.hoisted(() => ({
  requireUser: vi.fn(),
  withRouteIdempotency: vi.fn(),
  waiveNoShowFee: vi.fn(),
  bookingFindUnique: vi.fn(),
  enforceRateLimit: vi.fn(),
  resolveRouteParams: vi.fn(async () => ({ id: 'booking_1' })),
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

vi.mock('@/app/api/_utils/routeContext', () => ({
  resolveRouteParams: mocks.resolveRouteParams,
}))

vi.mock('@/lib/prisma', () => ({
  prisma: { booking: { findUnique: mocks.bookingFindUnique } },
}))

vi.mock('@/lib/booking/writeBoundary', () => ({
  waiveNoShowFee: mocks.waiveNoShowFee,
}))

vi.mock('@/lib/idempotency', () => ({
  IDEMPOTENCY_ROUTES: {
    BOOKING_NO_SHOW_FEE_WAIVE: 'POST /api/v1/bookings/[id]/no-show-fee/waive',
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
    'http://localhost/api/v1/bookings/booking_1/no-show-fee/waive',
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
  mocks.bookingFindUnique.mockResolvedValue({
    id: 'booking_1',
    professionalId: 'pro_1',
  })
  mocks.waiveNoShowFee.mockResolvedValue({
    status: NoShowFeeStatus.WAIVED,
    meta: { mutated: true, noOp: false },
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

describe('POST /api/v1/bookings/[id]/no-show-fee/waive', () => {
  it('passes through a failed auth response', async () => {
    const res = new Response(null, { status: 401 })
    mocks.requireUser.mockResolvedValue({ ok: false, res })

    const result = await POST(makeReq(), ctx)
    expect(result).toBe(res)
    expect(mocks.requireUser).toHaveBeenCalledWith({
      roles: [Role.PRO, Role.ADMIN],
    })
  })

  it('lets a pro waive on their own booking', async () => {
    mocks.requireUser.mockResolvedValue(proAuth('pro_1'))

    const result = await POST(makeReq(), ctx)
    const body = await result.json()

    expect(result.status).toBe(200)
    expect(body.noShowFee).toEqual({ status: 'WAIVED', waived: true })
    expect(mocks.waiveNoShowFee).toHaveBeenCalledWith({
      bookingId: 'booking_1',
      professionalId: 'pro_1',
    })
  })

  it('returns a uniform 404 when a pro waives a booking they do not own', async () => {
    mocks.requireUser.mockResolvedValue(proAuth('pro_1'))
    mocks.bookingFindUnique.mockResolvedValue({
      id: 'booking_1',
      professionalId: 'pro_OTHER',
    })

    const result = await POST(makeReq(), ctx)
    expect(result.status).toBe(404)
    expect(mocks.waiveNoShowFee).not.toHaveBeenCalled()
  })

  it('lets an admin waive, acting on the booking’s professional', async () => {
    mocks.requireUser.mockResolvedValue(adminAuth())
    mocks.bookingFindUnique.mockResolvedValue({
      id: 'booking_1',
      professionalId: 'pro_owner',
    })

    const result = await POST(makeReq(), ctx)
    expect(result.status).toBe(200)
    expect(mocks.waiveNoShowFee).toHaveBeenCalledWith({
      bookingId: 'booking_1',
      professionalId: 'pro_owner',
    })
  })

  it('maps a NO_SHOW_FEE_NOT_WAIVABLE booking error to 409', async () => {
    mocks.requireUser.mockResolvedValue(proAuth('pro_1'))
    mocks.waiveNoShowFee.mockRejectedValue(
      bookingError('NO_SHOW_FEE_NOT_WAIVABLE'),
    )

    const result = await POST(makeReq(), ctx)
    const body = await result.json()
    expect(result.status).toBe(409)
    expect(body.code).toBe('NO_SHOW_FEE_NOT_WAIVABLE')
  })

  it('returns 404 when the booking does not exist', async () => {
    mocks.requireUser.mockResolvedValue(adminAuth())
    mocks.bookingFindUnique.mockResolvedValue(null)

    const result = await POST(makeReq(), ctx)
    expect(result.status).toBe(404)
    expect(mocks.waiveNoShowFee).not.toHaveBeenCalled()
  })
})
