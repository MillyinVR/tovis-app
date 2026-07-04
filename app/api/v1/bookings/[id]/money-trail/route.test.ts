import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  BookingCheckoutStatus,
  BookingDepositStatus,
  NoShowFeeStatus,
  PaymentMethod,
  PaymentProvider,
  Prisma,
  Role,
  StripePaymentStatus,
} from '@prisma/client'

const mocks = vi.hoisted(() => ({
  requireUser: vi.fn(),
  bookingFindUnique: vi.fn(),
  resolveRouteParams: vi.fn(async () => ({ id: 'booking_1' })),
}))

vi.mock('@/app/api/_utils/auth/requireUser', () => ({
  requireUser: mocks.requireUser,
}))

vi.mock('@/app/api/_utils', () => ({
  jsonOk: (payload: Record<string, unknown>) =>
    new Response(JSON.stringify({ ok: true, ...payload }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }),
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

vi.mock('@/lib/security/logging', () => ({
  safeError: (e: unknown) => ({ message: e instanceof Error ? e.message : 'x' }),
}))

import { GET } from './route'

const ctx = { params: Promise.resolve({ id: 'booking_1' }) }

function makeReq() {
  return new Request('http://localhost/api/v1/bookings/booking_1/money-trail')
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

function makeRow(overrides?: Record<string, unknown>) {
  return {
    id: 'booking_1',
    professionalId: 'pro_1',
    paymentProvider: PaymentProvider.STRIPE,
    stripeCurrency: 'usd',
    stripePaymentStatus: StripePaymentStatus.SUCCEEDED,
    stripeAmountTotal: 18500,
    stripeAmountRefunded: 5000,
    stripeApplicationFeeAmount: null,
    stripePaidAt: new Date('2026-04-12T19:36:00.000Z'),
    checkoutStatus: BookingCheckoutStatus.PAID,
    selectedPaymentMethod: PaymentMethod.STRIPE_CARD,
    paymentCollectedAt: new Date('2026-04-12T19:36:00.000Z'),
    totalAmount: new Prisma.Decimal(185),
    serviceSubtotalSnapshot: new Prisma.Decimal(165),
    subtotalSnapshot: new Prisma.Decimal(165),
    tipAmount: new Prisma.Decimal(20),
    taxAmount: null,
    discountAmount: null,
    depositStatus: BookingDepositStatus.NONE,
    depositAmount: null,
    depositPaidAt: null,
    depositCreditedAt: null,
    depositRefundedCents: 0,
    discoveryFeeAmount: null,
    discoveryFeeRefundedAt: null,
    noShowMarkedAt: null,
    noShowFeeStatus: NoShowFeeStatus.FAILED,
    noShowFeeReason: null,
    noShowFeeAmount: new Prisma.Decimal(35),
    noShowFeeChargedAt: null,
    refunds: [
      {
        id: 'refund_1',
        amountCents: 5000,
        currency: 'usd',
        status: 'SUCCEEDED',
        trigger: 'DISCRETIONARY',
        reason: 'goodwill',
        initiatedByRole: Role.PRO,
        failureMessage: null,
        createdAt: new Date('2026-04-13T10:00:00.000Z'),
      },
    ],
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.resolveRouteParams.mockResolvedValue({ id: 'booking_1' })
  mocks.bookingFindUnique.mockResolvedValue(makeRow())
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('GET /api/v1/bookings/[id]/money-trail', () => {
  it('passes through a failed auth response', async () => {
    const res = new Response(null, { status: 401 })
    mocks.requireUser.mockResolvedValue({ ok: false, res })

    const result = await GET(makeReq(), ctx)
    expect(result).toBe(res)
    expect(mocks.requireUser).toHaveBeenCalledWith({
      roles: [Role.PRO, Role.ADMIN],
    })
  })

  it('returns the assembled trail for a pro who owns the booking', async () => {
    mocks.requireUser.mockResolvedValue(proAuth('pro_1'))

    const result = await GET(makeReq(), ctx)
    const body = await result.json()

    expect(result.status).toBe(200)
    expect(body.trail.summary).toEqual({
      capturedCents: 18500,
      refundedCents: 5000,
      pendingRefundCents: 0,
      netCents: 13500,
    })
    expect(body.trail.capabilities.canRefund).toBe(true)
    expect(body.trail.capabilities.refundableRemainingCents).toBe(13500)
    expect(body.trail.capabilities.canWaiveNoShowFee).toBe(true)
    expect(body.trail.refunds).toHaveLength(1)
    // professionalId is used for auth but never echoed into the trail.
    expect(body.trail.professionalId).toBeUndefined()
  })

  it('returns a uniform 404 when a pro requests a booking they do not own', async () => {
    mocks.requireUser.mockResolvedValue(proAuth('pro_1'))
    mocks.bookingFindUnique.mockResolvedValue(
      makeRow({ professionalId: 'pro_OTHER' }),
    )

    const result = await GET(makeReq(), ctx)
    expect(result.status).toBe(404)
  })

  it('lets an admin view any booking', async () => {
    mocks.requireUser.mockResolvedValue(adminAuth())
    mocks.bookingFindUnique.mockResolvedValue(
      makeRow({ professionalId: 'pro_someone_else' }),
    )

    const result = await GET(makeReq(), ctx)
    expect(result.status).toBe(200)
  })

  it('returns 404 when the booking does not exist', async () => {
    mocks.requireUser.mockResolvedValue(adminAuth())
    mocks.bookingFindUnique.mockResolvedValue(null)

    const result = await GET(makeReq(), ctx)
    expect(result.status).toBe(404)
  })
})
