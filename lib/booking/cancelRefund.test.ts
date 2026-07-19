import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BookingRefundTrigger, Role } from '@prisma/client'

const mocks = vi.hoisted(() => ({
  refundBookingPayment: vi.fn(),
  refundDiscoveryDeposit: vi.fn(),
  bookingFindUnique: vi.fn(),
  captureException: vi.fn(),
}))

vi.mock('@/lib/booking/refunds', () => ({
  refundBookingPayment: mocks.refundBookingPayment,
  refundDiscoveryDeposit: mocks.refundDiscoveryDeposit,
}))

vi.mock('@/lib/prisma', () => ({
  prisma: { booking: { findUnique: mocks.bookingFindUnique } },
}))

vi.mock('@sentry/nextjs', () => ({
  captureException: mocks.captureException,
}))

import { BookingDepositStatus } from '@prisma/client'

import {
  applyAutoCancelRefund,
  applyDiscoveryDepositCancelRefund,
  isAutoCancelRefundEligible,
  CLIENT_FULL_REFUND_WINDOW_MS,
} from './cancelRefund'

const NOW = new Date('2026-04-10T12:00:00.000Z')

beforeEach(() => {
  mocks.refundBookingPayment.mockReset()
  mocks.refundDiscoveryDeposit.mockReset()
  mocks.bookingFindUnique.mockReset()
  mocks.captureException.mockReset()
  mocks.refundBookingPayment.mockResolvedValue({
    outcome: 'REFUNDED',
    refund: { id: 'refund_1' },
    bookingFullyRefunded: true,
  })
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('isAutoCancelRefundEligible', () => {
  it('always allows an admin cancellation regardless of timing', () => {
    const soon = new Date(NOW.getTime() + 60 * 1000) // 1 minute out
    expect(
      isAutoCancelRefundEligible({ actorKind: 'admin', scheduledFor: soon, now: NOW }),
    ).toBe(true)
    expect(
      isAutoCancelRefundEligible({ actorKind: 'admin', scheduledFor: null, now: NOW }),
    ).toBe(true)
  })

  // Policy change 2026-07-19: a pro cancel no longer auto-refunds the service
  // payment (the discovery deposit still refunds — see discoveryDepositPlan).
  it('never allows a pro cancellation, however far out it is', () => {
    const farOut = new Date(NOW.getTime() + 30 * CLIENT_FULL_REFUND_WINDOW_MS)
    expect(
      isAutoCancelRefundEligible({ actorKind: 'pro', scheduledFor: farOut, now: NOW }),
    ).toBe(false)
    expect(
      isAutoCancelRefundEligible({ actorKind: 'pro', scheduledFor: null, now: NOW }),
    ).toBe(false)
  })

  it('allows a client cancellation exactly at the 24h boundary', () => {
    const at24h = new Date(NOW.getTime() + CLIENT_FULL_REFUND_WINDOW_MS)
    expect(
      isAutoCancelRefundEligible({
        actorKind: 'client',
        scheduledFor: at24h,
        now: NOW,
      }),
    ).toBe(true)
  })

  it('blocks a client cancellation inside the 24h window', () => {
    const justInside = new Date(
      NOW.getTime() + CLIENT_FULL_REFUND_WINDOW_MS - 60 * 1000,
    )
    expect(
      isAutoCancelRefundEligible({
        actorKind: 'client',
        scheduledFor: justInside,
        now: NOW,
      }),
    ).toBe(false)
  })
})

describe('applyAutoCancelRefund', () => {
  it('does nothing when the cancellation did not mutate (idempotent re-cancel)', async () => {
    const result = await applyAutoCancelRefund({
      bookingId: 'booking_1',
      actorKind: 'pro',
      actorUserId: 'user_pro',
      cancelMutated: false,
    })

    expect(result).toEqual({ outcome: 'NOT_ATTEMPTED' })
    expect(mocks.refundBookingPayment).not.toHaveBeenCalled()
  })

  // Policy change 2026-07-19: a pro cancel no longer auto-refunds the service
  // payment. It stays a pro-discretion refund, like a late client cancel. The
  // discovery deposit is a SEPARATE PaymentIntent and still refunds in full —
  // that path is applyDiscoveryDepositCancelRefund and is deliberately untouched.
  it('does not auto-refund the service payment for a pro cancel', async () => {
    const result = await applyAutoCancelRefund({
      bookingId: 'booking_1',
      actorKind: 'pro',
      actorUserId: 'user_pro',
      cancelMutated: true,
      now: NOW,
      reason: 'pro sick',
    })

    expect(result).toEqual({ outcome: 'NOT_ATTEMPTED' })
    expect(mocks.refundBookingPayment).not.toHaveBeenCalled()
    // Still no scheduledFor read — a pro cancel never depended on the window.
    expect(mocks.bookingFindUnique).not.toHaveBeenCalled()
  })

  it('refunds an admin cancel with the admin role', async () => {
    await applyAutoCancelRefund({
      bookingId: 'booking_1',
      actorKind: 'admin',
      actorUserId: 'user_admin',
      cancelMutated: true,
      now: NOW,
    })

    expect(mocks.refundBookingPayment).toHaveBeenCalledWith(
      expect.objectContaining({ actor: { userId: 'user_admin', role: Role.ADMIN } }),
    )
  })

  it('refunds a client cancel made at least 24h out', async () => {
    mocks.bookingFindUnique.mockResolvedValue({
      scheduledFor: new Date(NOW.getTime() + CLIENT_FULL_REFUND_WINDOW_MS + 60 * 1000),
    })

    const result = await applyAutoCancelRefund({
      bookingId: 'booking_1',
      actorKind: 'client',
      actorUserId: 'user_client',
      cancelMutated: true,
      now: NOW,
    })

    expect(mocks.bookingFindUnique).toHaveBeenCalled()
    expect(mocks.refundBookingPayment).toHaveBeenCalledWith(
      expect.objectContaining({ actor: { userId: 'user_client', role: Role.CLIENT } }),
    )
    expect(result.outcome).toBe('REFUNDED')
  })

  it('does NOT refund a client cancel inside the 24h window', async () => {
    mocks.bookingFindUnique.mockResolvedValue({
      scheduledFor: new Date(NOW.getTime() + 60 * 60 * 1000), // 1h out
    })

    const result = await applyAutoCancelRefund({
      bookingId: 'booking_1',
      actorKind: 'client',
      actorUserId: 'user_client',
      cancelMutated: true,
      now: NOW,
    })

    expect(result).toEqual({ outcome: 'NOT_ATTEMPTED' })
    expect(mocks.refundBookingPayment).not.toHaveBeenCalled()
  })

  it('swallows unexpected errors and reports them (never throws)', async () => {
    mocks.bookingFindUnique.mockRejectedValue(new Error('db down'))

    const result = await applyAutoCancelRefund({
      bookingId: 'booking_1',
      actorKind: 'client',
      actorUserId: 'user_client',
      cancelMutated: true,
      now: NOW,
    })

    expect(result).toEqual({ outcome: 'NOT_ATTEMPTED' })
    expect(mocks.captureException).toHaveBeenCalled()
  })

  it('returns the FAILED outcome from the refund service without throwing', async () => {
    mocks.refundBookingPayment.mockResolvedValue({
      outcome: 'FAILED',
      refund: { id: 'refund_x' },
      message: 'stripe boom',
    })

    // Admin, not pro: this asserts FAILED propagates out of the refund service,
    // and since 2026-07-19 a pro cancel never reaches that service at all.
    const result = await applyAutoCancelRefund({
      bookingId: 'booking_1',
      actorKind: 'admin',
      actorUserId: 'user_admin',
      cancelMutated: true,
      now: NOW,
    })

    expect(result.outcome).toBe('FAILED')
  })
})

// Guards the deliberate split introduced on 2026-07-19: a pro cancel stops
// auto-refunding the SERVICE PAYMENT but must keep refunding the discovery
// DEPOSIT in full, because a brand-new client should not be out of pocket on a
// cancellation they did not cause. The two policies live in different files and
// nothing else asserts they stay apart.
describe('applyDiscoveryDepositCancelRefund — pro cancel still refunds', () => {
  it('refunds deposit AND fee for a pro cancel, even inside the 24h window', async () => {
    mocks.bookingFindUnique.mockResolvedValue({
      // Deliberately inside the client 24h window: the deposit policy branches
      // on the ACTOR, so a pro cancel must refund regardless of timing.
      scheduledFor: new Date(NOW.getTime() + 60 * 1000),
      depositStatus: BookingDepositStatus.PAID,
      depositStripePaymentIntentId: 'pi_deposit_1',
      depositAmount: 20, // dollars -> 2000 cents
      discoveryFeeAmount: 500, // already cents
    })
    mocks.refundDiscoveryDeposit.mockResolvedValue({
      outcome: 'REFUNDED',
      refundAmountCents: 2500,
      feeRefunded: true,
    })

    const result = await applyDiscoveryDepositCancelRefund({
      bookingId: 'booking_1',
      actorKind: 'pro',
      actorUserId: 'user_pro',
      cancelMutated: true,
      now: NOW,
    })

    expect(mocks.refundDiscoveryDeposit).toHaveBeenCalledWith(
      expect.objectContaining({
        paymentIntentId: 'pi_deposit_1',
        refundAmountCents: 2500, // deposit 2000 + fee 500
        refundFee: true,
        actor: { userId: 'user_pro', role: Role.PRO },
      }),
    )
    expect(result).toEqual({
      outcome: 'REFUNDED',
      refundAmountCents: 2500,
      feeRefunded: true,
    })
  })
})
