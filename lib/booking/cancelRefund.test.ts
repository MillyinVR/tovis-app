import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BookingRefundTrigger, Role } from '@prisma/client'

const mocks = vi.hoisted(() => ({
  refundBookingPayment: vi.fn(),
  refundDiscoveryDeposit: vi.fn(),
  bookingFindUnique: vi.fn(),
  captureException: vi.fn(),
  captureLateCaptureOnCancelledBooking: vi.fn(),
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

vi.mock('@/lib/observability/bookingEvents', () => ({
  captureLateCaptureOnCancelledBooking:
    mocks.captureLateCaptureOnCancelledBooking,
}))

import { BookingDepositStatus } from '@prisma/client'

import {
  applyAutoCancelRefund,
  applyDiscoveryDepositCancelRefund,
  applyLateCaptureCancelRefund,
  isAutoCancelRefundEligible,
  summarizeCancelRefund,
  CLIENT_FULL_REFUND_WINDOW_MS,
  type AutoCancelRefundResult,
  type DepositCancelRefundResult,
} from './cancelRefund'
import { BookingRefundStatus, type BookingRefund } from '@prisma/client'

const NOW = new Date('2026-04-10T12:00:00.000Z')

beforeEach(() => {
  mocks.refundBookingPayment.mockReset()
  mocks.refundDiscoveryDeposit.mockReset()
  mocks.bookingFindUnique.mockReset()
  mocks.captureException.mockReset()
  mocks.captureLateCaptureOnCancelledBooking.mockReset()
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

// ─── M1: late-captured payment on a CANCELLED booking ────────────────────────
//
// A Stripe success that lands AFTER the cancel must settle by the SAME policy
// the cancel ran, decided AS OF the cancel: actor from cancelledByRole, the 24h
// window evaluated at cancelledAt — never at webhook-delivery time.
describe('applyLateCaptureCancelRefund', () => {
  const SCHEDULED_FOR = new Date('2026-04-12T12:00:00.000Z')
  // 26h before the appointment — outside the 24h window (refund-eligible).
  const CANCELLED_EARLY = new Date('2026-04-11T10:00:00.000Z')
  // 2h before the appointment — inside the 24h window (forfeit).
  const CANCELLED_LATE = new Date('2026-04-12T10:00:00.000Z')

  function primeProvenance(args: {
    cancelledAt: Date | null
    cancelledByRole: Role | null
    status?: string
  }) {
    mocks.bookingFindUnique.mockResolvedValueOnce({
      status: args.status ?? 'CANCELLED',
      cancelledAt: args.cancelledAt,
      cancelledByRole: args.cancelledByRole,
    })
  }

  it('SERVICE × admin cancel → full refund through refundBookingPayment', async () => {
    primeProvenance({
      cancelledAt: CANCELLED_LATE,
      cancelledByRole: Role.ADMIN,
    })

    const result = await applyLateCaptureCancelRefund({
      bookingId: 'booking_1',
      flavor: 'SERVICE',
    })

    expect(mocks.refundBookingPayment).toHaveBeenCalledWith(
      expect.objectContaining({
        bookingId: 'booking_1',
        trigger: BookingRefundTrigger.AUTO_CANCELLATION,
        actor: { userId: null, role: Role.ADMIN },
        reason: 'Automatic refund on payment captured after admin cancellation.',
      }),
    )
    expect(result.outcome).toBe('REFUNDED')
  })

  it('SERVICE × client cancel ≥24h out → refund, judged at cancelledAt', async () => {
    primeProvenance({
      cancelledAt: CANCELLED_EARLY,
      cancelledByRole: Role.CLIENT,
    })
    // applyAutoCancelRefund's own read of scheduledFor.
    mocks.bookingFindUnique.mockResolvedValueOnce({
      scheduledFor: SCHEDULED_FOR,
    })

    const result = await applyLateCaptureCancelRefund({
      bookingId: 'booking_1',
      flavor: 'SERVICE',
    })

    expect(mocks.refundBookingPayment).toHaveBeenCalledOnce()
    expect(result.outcome).toBe('REFUNDED')
  })

  it('SERVICE × client cancel <24h out → policy says no refund, no Stripe call', async () => {
    primeProvenance({
      cancelledAt: CANCELLED_LATE,
      cancelledByRole: Role.CLIENT,
    })
    mocks.bookingFindUnique.mockResolvedValueOnce({
      scheduledFor: SCHEDULED_FOR,
    })

    const result = await applyLateCaptureCancelRefund({
      bookingId: 'booking_1',
      flavor: 'SERVICE',
    })

    expect(mocks.refundBookingPayment).not.toHaveBeenCalled()
    expect(result.outcome).toBe('NOT_ATTEMPTED')
  })

  it('SERVICE × pro cancel → pro discretion, no auto refund', async () => {
    primeProvenance({
      cancelledAt: CANCELLED_EARLY,
      cancelledByRole: Role.PRO,
    })

    const result = await applyLateCaptureCancelRefund({
      bookingId: 'booking_1',
      flavor: 'SERVICE',
    })

    expect(mocks.refundBookingPayment).not.toHaveBeenCalled()
    expect(result.outcome).toBe('NOT_ATTEMPTED')
  })

  it('DEPOSIT × client cancel ≥24h out → deposit back, fee kept', async () => {
    primeProvenance({
      cancelledAt: CANCELLED_EARLY,
      cancelledByRole: Role.CLIENT,
    })
    // applyDiscoveryDepositCancelRefund's own booking read.
    mocks.bookingFindUnique.mockResolvedValueOnce({
      scheduledFor: SCHEDULED_FOR,
      depositStatus: BookingDepositStatus.PAID,
      depositStripePaymentIntentId: 'pi_deposit_1',
      depositAmount: 25, // dollars -> 2500 cents
      discoveryFeeAmount: 500,
    })
    mocks.refundDiscoveryDeposit.mockResolvedValue({
      outcome: 'REFUNDED',
      refundAmountCents: 2500,
      feeRefunded: false,
    })

    const result = await applyLateCaptureCancelRefund({
      bookingId: 'booking_1',
      flavor: 'DEPOSIT',
    })

    expect(mocks.refundDiscoveryDeposit).toHaveBeenCalledWith(
      expect.objectContaining({
        paymentIntentId: 'pi_deposit_1',
        refundAmountCents: 2500,
        refundFee: false,
        // Policy must be evaluated AS OF the cancel, not delivery time.
        now: CANCELLED_EARLY,
      }),
    )
    expect(result.outcome).toBe('REFUNDED')
  })

  it('DEPOSIT × client cancel <24h out → forfeited, no Stripe call', async () => {
    primeProvenance({
      cancelledAt: CANCELLED_LATE,
      cancelledByRole: Role.CLIENT,
    })
    mocks.bookingFindUnique.mockResolvedValueOnce({
      scheduledFor: SCHEDULED_FOR,
      depositStatus: BookingDepositStatus.PAID,
      depositStripePaymentIntentId: 'pi_deposit_1',
      depositAmount: 25,
      discoveryFeeAmount: 500,
    })

    const result = await applyLateCaptureCancelRefund({
      bookingId: 'booking_1',
      flavor: 'DEPOSIT',
    })

    expect(mocks.refundDiscoveryDeposit).not.toHaveBeenCalled()
    expect(result.outcome).toBe('FORFEITED')
  })

  it('DEPOSIT × pro cancel → deposit AND fee back', async () => {
    primeProvenance({
      cancelledAt: CANCELLED_LATE,
      cancelledByRole: Role.PRO,
    })
    mocks.bookingFindUnique.mockResolvedValueOnce({
      scheduledFor: SCHEDULED_FOR,
      depositStatus: BookingDepositStatus.PAID,
      depositStripePaymentIntentId: 'pi_deposit_1',
      depositAmount: 25,
      discoveryFeeAmount: 500,
    })
    mocks.refundDiscoveryDeposit.mockResolvedValue({
      outcome: 'REFUNDED',
      refundAmountCents: 3000,
      feeRefunded: true,
    })

    const result = await applyLateCaptureCancelRefund({
      bookingId: 'booking_1',
      flavor: 'DEPOSIT',
    })

    expect(mocks.refundDiscoveryDeposit).toHaveBeenCalledWith(
      expect.objectContaining({ refundAmountCents: 3000, refundFee: true }),
    )
    expect(result.outcome).toBe('REFUNDED')
  })

  it('unknown provenance (pre-migration cancel) → alert, no refund attempt', async () => {
    primeProvenance({ cancelledAt: null, cancelledByRole: null })

    const result = await applyLateCaptureCancelRefund({
      bookingId: 'booking_1',
      flavor: 'DEPOSIT',
    })

    expect(mocks.captureLateCaptureOnCancelledBooking).toHaveBeenCalledWith(
      expect.objectContaining({
        bookingId: 'booking_1',
        flavor: 'DEPOSIT',
        reason: 'UNKNOWN_CANCEL_PROVENANCE',
      }),
    )
    expect(mocks.refundBookingPayment).not.toHaveBeenCalled()
    expect(mocks.refundDiscoveryDeposit).not.toHaveBeenCalled()
    expect(result.outcome).toBe('UNKNOWN_PROVENANCE')
  })

  it('booking no longer CANCELLED → silent no-op', async () => {
    primeProvenance({
      cancelledAt: CANCELLED_EARLY,
      cancelledByRole: Role.CLIENT,
      status: 'ACCEPTED',
    })

    const result = await applyLateCaptureCancelRefund({
      bookingId: 'booking_1',
      flavor: 'SERVICE',
    })

    expect(mocks.refundBookingPayment).not.toHaveBeenCalled()
    expect(mocks.captureLateCaptureOnCancelledBooking).not.toHaveBeenCalled()
    expect(result.outcome).toBe('NOT_ATTEMPTED')
  })

  it('refund FAILED → pages via the late-capture alert', async () => {
    primeProvenance({
      cancelledAt: CANCELLED_LATE,
      cancelledByRole: Role.ADMIN,
    })
    mocks.refundBookingPayment.mockResolvedValue({
      outcome: 'FAILED',
      refund: { id: 'refund_1' },
      message: 'stripe exploded',
    })

    const result = await applyLateCaptureCancelRefund({
      bookingId: 'booking_1',
      flavor: 'SERVICE',
    })

    expect(mocks.captureLateCaptureOnCancelledBooking).toHaveBeenCalledWith(
      expect.objectContaining({
        reason: 'REFUND_FAILED',
        detail: 'stripe exploded',
      }),
    )
    expect(result.outcome).toBe('FAILED')
  })

  it('refund FAILED from the RETRY_SWEEP source → no per-attempt page, distinct log identity', async () => {
    primeProvenance({
      cancelledAt: CANCELLED_LATE,
      cancelledByRole: Role.ADMIN,
    })
    mocks.refundBookingPayment.mockResolvedValue({
      outcome: 'FAILED',
      refund: { id: 'refund_1' },
      message: 'stripe exploded',
    })
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    const result = await applyLateCaptureCancelRefund({
      bookingId: 'booking_1',
      flavor: 'SERVICE',
      source: 'RETRY_SWEEP',
    })

    expect(result.outcome).toBe('FAILED')
    // The sweep owns escalation (retries-exhausted); a per-attempt page here
    // would fire hourly for a booking the sweep is still working.
    expect(mocks.captureLateCaptureOnCancelledBooking).not.toHaveBeenCalled()

    const events = logSpy.mock.calls.map((call) => {
      try {
        return (JSON.parse(String(call[0])) as { event?: string }).event ?? null
      } catch {
        return null
      }
    })
    expect(events).toContain('auto_cancel_refund_retry')
    expect(events).not.toContain('late_capture_cancel_refund')
  })

  it('unknown provenance still pages even from the RETRY_SWEEP source', async () => {
    primeProvenance({ cancelledAt: null, cancelledByRole: null })

    const result = await applyLateCaptureCancelRefund({
      bookingId: 'booking_1',
      flavor: 'DEPOSIT',
      source: 'RETRY_SWEEP',
    })

    expect(result.outcome).toBe('UNKNOWN_PROVENANCE')
    expect(mocks.captureLateCaptureOnCancelledBooking).toHaveBeenCalledWith(
      expect.objectContaining({ reason: 'UNKNOWN_CANCEL_PROVENANCE' }),
    )
  })
})

describe('summarizeCancelRefund', () => {
  // A type-complete BookingRefund (summarizeCancelRefund reads only amountCents,
  // but the AutoCancelRefundResult.REFUNDED variant carries the whole row).
  function makeRefund(amountCents: number): BookingRefund {
    return {
      id: 'refund_1',
      bookingId: 'booking_1',
      amountCents,
      currency: 'usd',
      status: BookingRefundStatus.SUCCEEDED,
      trigger: BookingRefundTrigger.AUTO_CANCELLATION,
      reverseTransfer: true,
      applicationFeeRefunded: false,
      initiatedByUserId: null,
      initiatedByRole: null,
      reason: null,
      stripePaymentIntentId: 'pi_1',
      stripeRefundId: 're_1',
      failureCode: null,
      failureMessage: null,
      createdAt: NOW,
      updatedAt: NOW,
    }
  }

  const serviceRefunded = (amountCents: number): AutoCancelRefundResult => ({
    outcome: 'REFUNDED',
    refund: makeRefund(amountCents),
    bookingFullyRefunded: true,
  })
  const serviceNone: AutoCancelRefundResult = { outcome: 'NOT_ATTEMPTED' }
  const serviceSkipped: AutoCancelRefundResult = {
    outcome: 'SKIPPED',
    reason: 'PAYMENT_NOT_CAPTURED',
  }
  const serviceFailed: AutoCancelRefundResult = {
    outcome: 'FAILED',
    refund: makeRefund(5000),
    message: 'card_declined',
  }

  const depositNone: DepositCancelRefundResult = { outcome: 'NOT_ATTEMPTED' }
  const depositRefunded = (
    refundAmountCents: number,
  ): DepositCancelRefundResult => ({
    outcome: 'REFUNDED',
    refundAmountCents,
    feeRefunded: true,
  })
  const depositForfeited: DepositCancelRefundResult = { outcome: 'FORFEITED' }
  const depositFailed: DepositCancelRefundResult = {
    outcome: 'FAILED',
    message: 'no such payment_intent',
  }

  it('REFUND_ISSUED when the service payment refunded — names the amount', () => {
    const s = summarizeCancelRefund({
      service: serviceRefunded(8000),
      deposit: depositNone,
    })
    expect(s.status).toBe('REFUND_ISSUED')
    expect(s.refundedAmountCents).toBe(8000)
    expect(s.message).toContain('$80.00')
    expect(s.message).toContain('on its way')
  })

  it('REFUND_ISSUED when the deposit refunded', () => {
    const s = summarizeCancelRefund({
      service: serviceNone,
      deposit: depositRefunded(4000),
    })
    expect(s.status).toBe('REFUND_ISSUED')
    expect(s.refundedAmountCents).toBe(4000)
    expect(s.message).toContain('$40.00')
  })

  it('sums service + deposit when both refunded', () => {
    const s = summarizeCancelRefund({
      service: serviceRefunded(8000),
      deposit: depositRefunded(4000),
    })
    expect(s.status).toBe('REFUND_ISSUED')
    expect(s.refundedAmountCents).toBe(12000)
    expect(s.message).toContain('$120.00')
  })

  it('FORFEITED when a client cancel <24h forfeits the deposit', () => {
    const s = summarizeCancelRefund({
      service: serviceNone,
      deposit: depositForfeited,
    })
    expect(s.status).toBe('FORFEITED')
    expect(s.refundedAmountCents).toBeUndefined()
    expect(s.message).toContain('non-refundable')
  })

  it('PROCESSING — never dresses a FAILED refund up as "on its way"', () => {
    expect(
      summarizeCancelRefund({ service: serviceFailed, deposit: depositNone })
        .status,
    ).toBe('PROCESSING')
    expect(
      summarizeCancelRefund({ service: serviceNone, deposit: depositFailed })
        .status,
    ).toBe('PROCESSING')
    const s = summarizeCancelRefund({
      service: serviceFailed,
      deposit: depositNone,
    })
    expect(s.message).not.toContain('on its way')
    expect(s.message).toContain('finalizing')
  })

  it('a real refund + a failed one still surfaces the success + notes the rest', () => {
    const s = summarizeCancelRefund({
      service: serviceRefunded(8000),
      deposit: depositFailed,
    })
    expect(s.status).toBe('REFUND_ISSUED')
    expect(s.refundedAmountCents).toBe(8000)
    expect(s.message).toContain('still being processed')
  })

  it('NONE when nothing was captured to refund and nothing was forfeited', () => {
    const s = summarizeCancelRefund({
      service: serviceSkipped,
      deposit: depositNone,
    })
    expect(s.status).toBe('NONE')
    expect(s.refundedAmountCents).toBeUndefined()
    expect(s.message).toBe('Your booking is cancelled.')
  })

  // ─── M15: late-cancel fee folded into the honest summary ───────────────────

  it('FEE_CHARGED when a late-cancel fee was charged and nothing was refunded/forfeited', () => {
    const s = summarizeCancelRefund({
      service: serviceNone,
      deposit: depositNone,
      lateCancelFeeChargedCents: 1500,
    })
    // Must NOT be NONE — iOS gates its alert on status !== 'NONE', so a fee that
    // fell through to NONE would be charged silently ([[green-tests-wrong-artifact]]).
    expect(s.status).toBe('FEE_CHARGED')
    expect(s.lateCancelFeeChargedCents).toBe(1500)
    expect(s.refundedAmountCents).toBeUndefined()
    expect(s.message).toContain('$15.00')
    expect(s.message).toContain('late-cancellation fee')
  })

  it('a refund and a late-cancel fee co-exist (pro window wider than 24h) — both surfaced', () => {
    const s = summarizeCancelRefund({
      service: serviceNone,
      deposit: depositRefunded(2000),
      lateCancelFeeChargedCents: 1200,
    })
    expect(s.status).toBe('REFUND_ISSUED')
    expect(s.refundedAmountCents).toBe(2000)
    expect(s.lateCancelFeeChargedCents).toBe(1200)
    expect(s.message).toContain('$20.00') // the refund
    expect(s.message).toContain('$12.00') // the fee
    expect(s.message).toContain('late-cancellation fee')
  })

  it('a zero/omitted fee never adds a fee field or sentence', () => {
    const omitted = summarizeCancelRefund({
      service: serviceNone,
      deposit: depositNone,
    })
    expect(omitted.status).toBe('NONE')
    expect(omitted.lateCancelFeeChargedCents).toBeUndefined()
    expect(omitted.message).not.toContain('fee')

    const zero = summarizeCancelRefund({
      service: serviceNone,
      deposit: depositNone,
      lateCancelFeeChargedCents: 0,
    })
    expect(zero.status).toBe('NONE')
    expect(zero.lateCancelFeeChargedCents).toBeUndefined()
    expect(zero.message).not.toContain('fee')
  })
})
