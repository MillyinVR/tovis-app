import { describe, expect, it } from 'vitest'
import {
  BookingCheckoutStatus,
  BookingDepositStatus,
  BookingRefundStatus,
  BookingRefundTrigger,
  NoShowFeeReason,
  NoShowFeeStatus,
  PaymentMethod,
  PaymentProvider,
  Prisma,
  Role,
  StripePaymentStatus,
} from '@prisma/client'

import { assembleMoneyTrail, type MoneyTrailBookingRow } from './moneyTrail'

function makeRow(overrides?: Partial<MoneyTrailBookingRow>): MoneyTrailBookingRow {
  const base: MoneyTrailBookingRow = {
    id: 'booking_1',
    professionalId: 'pro_1',

    paymentProvider: PaymentProvider.STRIPE,
    stripeCurrency: 'usd',
    stripePaymentStatus: StripePaymentStatus.SUCCEEDED,
    stripeAmountTotal: 18500,
    stripeAmountRefunded: 0,
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
    noShowFeeStatus: null,
    noShowFeeReason: null,
    noShowFeeAmount: null,
    noShowFeeChargedAt: null,

    refunds: [],
  }
  return { ...base, ...overrides }
}

describe('assembleMoneyTrail', () => {
  it('summarizes a captured Stripe booking with no refunds as fully refundable', () => {
    const trail = assembleMoneyTrail(makeRow())

    expect(trail.currency).toBe('usd')
    expect(trail.finalCharge).toEqual({
      status: StripePaymentStatus.SUCCEEDED,
      capturedCents: 18500,
      applicationFeeCents: null,
      paidAt: '2026-04-12T19:36:00.000Z',
    })
    expect(trail.summary).toEqual({
      capturedCents: 18500,
      refundedCents: 0,
      pendingRefundCents: 0,
      netCents: 18500,
    })
    expect(trail.capabilities.canRefund).toBe(true)
    expect(trail.capabilities.refundableRemainingCents).toBe(18500)
    expect(trail.bill.totalCents).toBe(18500)
    expect(trail.bill.tipCents).toBe(2000)
  })

  it('subtracts settled and pending refunds from the refundable remainder', () => {
    const trail = assembleMoneyTrail(
      makeRow({
        stripeAmountRefunded: 5000, // one SUCCEEDED refund already reflected by Stripe
        refunds: [
          {
            id: 'refund_ok',
            amountCents: 5000,
            currency: 'usd',
            status: BookingRefundStatus.SUCCEEDED,
            trigger: BookingRefundTrigger.DISCRETIONARY,
            reason: 'client cancelled late',
            initiatedByRole: Role.PRO,
            failureMessage: null,
            createdAt: new Date('2026-04-13T10:00:00.000Z'),
          },
          {
            id: 'refund_pending',
            amountCents: 2500,
            currency: 'usd',
            status: BookingRefundStatus.PENDING,
            trigger: BookingRefundTrigger.DISCRETIONARY,
            reason: null,
            initiatedByRole: Role.ADMIN,
            failureMessage: null,
            createdAt: new Date('2026-04-13T11:00:00.000Z'),
          },
        ],
      }),
    )

    expect(trail.summary.refundedCents).toBe(5000)
    expect(trail.summary.pendingRefundCents).toBe(2500)
    // 18500 captured − 5000 settled − 2500 reserved = 11000 remaining.
    expect(trail.capabilities.refundableRemainingCents).toBe(11000)
    expect(trail.summary.netCents).toBe(13500)
    expect(trail.refunds).toHaveLength(2)
    expect(trail.refunds[0]?.id).toBe('refund_ok')
  })

  it('blocks refund once the booking is fully refunded', () => {
    const trail = assembleMoneyTrail(
      makeRow({ stripeAmountRefunded: 18500 }),
    )
    expect(trail.capabilities.canRefund).toBe(false)
    expect(trail.capabilities.refundableRemainingCents).toBe(0)
    expect(trail.summary.netCents).toBe(0)
  })

  it('blocks refund when the payment is not a captured Stripe charge', () => {
    const manual = assembleMoneyTrail(
      makeRow({
        paymentProvider: PaymentProvider.MANUAL,
        stripePaymentStatus: null,
        stripeAmountTotal: null,
      }),
    )
    expect(manual.finalCharge).toBeNull()
    expect(manual.capabilities.canRefund).toBe(false)

    const disputed = assembleMoneyTrail(
      makeRow({ stripePaymentStatus: StripePaymentStatus.DISPUTED }),
    )
    expect(disputed.capabilities.canRefund).toBe(false)
  })

  it('surfaces the deposit charge only when a deposit exists', () => {
    expect(assembleMoneyTrail(makeRow()).deposit).toBeNull()

    const trail = assembleMoneyTrail(
      makeRow({
        depositStatus: BookingDepositStatus.PAID,
        depositAmount: new Prisma.Decimal(40),
        depositPaidAt: new Date('2026-04-01T12:00:00.000Z'),
        depositRefundedCents: 0,
      }),
    )
    expect(trail.deposit).toEqual({
      status: BookingDepositStatus.PAID,
      amountCents: 4000,
      paidAt: '2026-04-01T12:00:00.000Z',
      creditedAt: null,
      refundedCents: 0,
    })
  })

  it('surfaces the discovery fee and its refund state', () => {
    const trail = assembleMoneyTrail(
      makeRow({
        discoveryFeeAmount: 500,
        discoveryFeeRefundedAt: new Date('2026-04-14T00:00:00.000Z'),
      }),
    )
    expect(trail.discoveryFee).toEqual({
      amountCents: 500,
      refundedAt: '2026-04-14T00:00:00.000Z',
    })
  })

  it('allows waiving a no-show fee only when the charge FAILED', () => {
    const failed = assembleMoneyTrail(
      makeRow({
        noShowFeeStatus: NoShowFeeStatus.FAILED,
        noShowFeeReason: NoShowFeeReason.NO_SHOW,
        noShowFeeAmount: new Prisma.Decimal(35),
        noShowMarkedAt: new Date('2026-04-12T18:30:00.000Z'),
      }),
    )
    expect(failed.noShowFee).toEqual({
      status: NoShowFeeStatus.FAILED,
      reason: NoShowFeeReason.NO_SHOW,
      amountCents: 3500,
      chargedAt: null,
      markedAt: '2026-04-12T18:30:00.000Z',
    })
    expect(failed.capabilities.canWaiveNoShowFee).toBe(true)

    for (const status of [
      NoShowFeeStatus.CHARGED,
      NoShowFeeStatus.SKIPPED,
      NoShowFeeStatus.WAIVED,
    ]) {
      const trail = assembleMoneyTrail(makeRow({ noShowFeeStatus: status }))
      expect(trail.capabilities.canWaiveNoShowFee).toBe(false)
    }

    expect(assembleMoneyTrail(makeRow()).noShowFee).toBeNull()
  })

  it('defaults a missing currency to usd', () => {
    const trail = assembleMoneyTrail(makeRow({ stripeCurrency: null }))
    expect(trail.currency).toBe('usd')
  })
})
