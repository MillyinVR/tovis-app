// lib/booking/paymentBadge.test.ts
//
// Pins every state the payment badge can name, with the two M-series honesty
// rules front and center: a disputed charge (either PI) must never read as
// money safely collected, and a partially-refunded deposit stays PAID-shaped
// showing the NET held — never "Refunded".

import { describe, expect, it } from 'vitest'
import {
  BookingCheckoutStatus,
  BookingDepositStatus,
  Prisma,
  StripePaymentStatus,
} from '@prisma/client'

import {
  PAYMENT_BADGE_KINDS,
  derivePaymentBadge,
  parsePaymentBadgeWire,
  type PaymentBadgeBookingRow,
} from './paymentBadge'

function row(
  overrides: Partial<PaymentBadgeBookingRow> = {},
): PaymentBadgeBookingRow {
  return {
    checkoutStatus: BookingCheckoutStatus.NOT_READY,
    paymentCollectedAt: null,
    stripePaymentStatus: null,
    stripeAmountTotal: null,
    stripeAmountRefunded: 0,
    totalAmount: null,
    depositStatus: BookingDepositStatus.NONE,
    depositAmount: null,
    depositRefundedCents: 0,
    depositDisputedAt: null,
    ...overrides,
  }
}

const dollars = (v: string) => new Prisma.Decimal(v)

describe('derivePaymentBadge', () => {
  it('defaults to UNPAID, the only non-significant state', () => {
    const badge = derivePaymentBadge(row())
    expect(badge).toEqual({
      kind: 'UNPAID',
      label: 'Unpaid',
      tone: 'neutral',
      significant: false,
    })
  })

  it('PENDING and FAILED deposits both read "Deposit due"', () => {
    for (const depositStatus of [
      BookingDepositStatus.PENDING,
      BookingDepositStatus.FAILED,
    ]) {
      const badge = derivePaymentBadge(row({ depositStatus }))
      expect(badge.kind).toBe('DEPOSIT_DUE')
      expect(badge.label).toBe('Deposit due')
      expect(badge.tone).toBe('pending')
      expect(badge.significant).toBe(true)
    }
  })

  it('a paid deposit shows the amount held', () => {
    const badge = derivePaymentBadge(
      row({
        depositStatus: BookingDepositStatus.PAID,
        depositAmount: dollars('60.00'),
        totalAmount: dollars('200.00'),
      }),
    )
    expect(badge.kind).toBe('DEPOSIT_PAID')
    expect(badge.label).toBe('Deposit paid $60.00')
    expect(badge.tone).toBe('info')
  })

  it('a paid deposit with no recorded amount still reads "Deposit paid"', () => {
    const badge = derivePaymentBadge(
      row({ depositStatus: BookingDepositStatus.PAID }),
    )
    expect(badge.kind).toBe('DEPOSIT_PAID')
    expect(badge.label).toBe('Deposit paid')
  })

  it('a PARTIALLY refunded deposit stays DEPOSIT_PAID and shows the NET held', () => {
    const badge = derivePaymentBadge(
      row({
        depositStatus: BookingDepositStatus.PAID,
        depositAmount: dollars('60.00'),
        depositRefundedCents: 2000,
        totalAmount: dollars('200.00'),
      }),
    )
    expect(badge.kind).toBe('DEPOSIT_PAID')
    expect(badge.label).toBe('Deposit paid $40.00')
  })

  it('a deposit covering the whole total reads "Prepaid in full"', () => {
    const badge = derivePaymentBadge(
      row({
        depositStatus: BookingDepositStatus.PAID,
        depositAmount: dollars('200.00'),
        totalAmount: dollars('200.00'),
      }),
    )
    expect(badge.kind).toBe('PREPAID_IN_FULL')
    expect(badge.label).toBe('Prepaid in full')
    expect(badge.tone).toBe('success')
  })

  it('a partial refund knocks a full prepay back to the net deposit', () => {
    const badge = derivePaymentBadge(
      row({
        depositStatus: BookingDepositStatus.PAID,
        depositAmount: dollars('200.00'),
        depositRefundedCents: 1,
        totalAmount: dollars('200.00'),
      }),
    )
    expect(badge.kind).toBe('DEPOSIT_PAID')
    expect(badge.label).toBe('Deposit paid $199.99')
  })

  it('a FULLY refunded deposit reads "Refunded"', () => {
    const badge = derivePaymentBadge(
      row({ depositStatus: BookingDepositStatus.REFUNDED }),
    )
    expect(badge.kind).toBe('REFUNDED')
    expect(badge.tone).toBe('neutral')
  })

  it('a disputed deposit NEVER renders as money safely collected', () => {
    // Even alongside a green final bill — the dispute wins.
    const badge = derivePaymentBadge(
      row({
        depositStatus: BookingDepositStatus.PAID,
        depositAmount: dollars('60.00'),
        depositDisputedAt: new Date('2026-07-01T00:00:00Z'),
        checkoutStatus: BookingCheckoutStatus.PAID,
        paymentCollectedAt: new Date('2026-07-01T00:00:00Z'),
        stripePaymentStatus: StripePaymentStatus.SUCCEEDED,
      }),
    )
    expect(badge.kind).toBe('DISPUTED')
    expect(badge.label).toBe('⚠ Disputed')
    expect(badge.tone).toBe('danger')
  })

  it('a disputed FINAL BILL never renders as paid either', () => {
    const badge = derivePaymentBadge(
      row({
        checkoutStatus: BookingCheckoutStatus.PAID,
        stripePaymentStatus: StripePaymentStatus.DISPUTED,
        stripeAmountTotal: 10000,
      }),
    )
    expect(badge.kind).toBe('DISPUTED')
  })

  it('reads "Paid" from any of the three collection signals', () => {
    const signals: Partial<PaymentBadgeBookingRow>[] = [
      { paymentCollectedAt: new Date('2026-07-01T00:00:00Z') },
      { stripePaymentStatus: StripePaymentStatus.SUCCEEDED },
      { checkoutStatus: BookingCheckoutStatus.PAID },
    ]
    for (const overrides of signals) {
      const badge = derivePaymentBadge(row(overrides))
      expect(badge.kind).toBe('PAID')
      expect(badge.tone).toBe('success')
    }
  })

  it('the final bill outranks the deposit once paid', () => {
    const badge = derivePaymentBadge(
      row({
        depositStatus: BookingDepositStatus.PAID,
        depositAmount: dollars('60.00'),
        checkoutStatus: BookingCheckoutStatus.PAID,
      }),
    )
    expect(badge.kind).toBe('PAID')
  })

  it('a PARTIALLY refunded bill stays "Paid", never "Refunded"', () => {
    const badge = derivePaymentBadge(
      row({
        stripePaymentStatus: StripePaymentStatus.SUCCEEDED,
        stripeAmountTotal: 10000,
        stripeAmountRefunded: 5000,
      }),
    )
    expect(badge.kind).toBe('PAID')
  })

  it('a FULLY refunded bill reads "Refunded"', () => {
    const badge = derivePaymentBadge(
      row({
        stripePaymentStatus: StripePaymentStatus.SUCCEEDED,
        stripeAmountTotal: 10000,
        stripeAmountRefunded: 10000,
      }),
    )
    expect(badge.kind).toBe('REFUNDED')
  })

  it('maps the remaining checkout states directly', () => {
    expect(
      derivePaymentBadge(
        row({ checkoutStatus: BookingCheckoutStatus.WAIVED }),
      ).kind,
    ).toBe('WAIVED')
    expect(
      derivePaymentBadge(
        row({ checkoutStatus: BookingCheckoutStatus.AWAITING_CONFIRMATION }),
      ),
    ).toMatchObject({ kind: 'AWAITING_CONFIRMATION', tone: 'warn' })
    expect(
      derivePaymentBadge(
        row({ checkoutStatus: BookingCheckoutStatus.PARTIALLY_PAID }),
      ),
    ).toMatchObject({ kind: 'PARTIALLY_PAID', tone: 'pending' })
  })
})

describe('parsePaymentBadgeWire', () => {
  it('round-trips a derived badge through JSON unchanged', () => {
    const badge = derivePaymentBadge(
      row({
        depositStatus: BookingDepositStatus.PAID,
        depositAmount: dollars('60.00'),
        totalAmount: dollars('200.00'),
      }),
    )
    expect(parsePaymentBadgeWire(JSON.parse(JSON.stringify(badge)))).toEqual(
      badge,
    )
  })

  it('reconstructs tone/significance from the kind, ignoring wire tampering', () => {
    const parsed = parsePaymentBadgeWire({
      kind: 'DISPUTED',
      label: '⚠ Disputed',
      tone: 'success',
      significant: false,
    })
    expect(parsed).toMatchObject({ tone: 'danger', significant: true })
  })

  it('falls back to the canonical label when the wire label is missing', () => {
    expect(parsePaymentBadgeWire({ kind: 'PAID' })?.label).toBe('Paid')
  })

  it('rejects unknown kinds and non-objects', () => {
    expect(parsePaymentBadgeWire({ kind: 'GARBAGE' })).toBeNull()
    expect(parsePaymentBadgeWire(null)).toBeNull()
    expect(parsePaymentBadgeWire('PAID')).toBeNull()
    expect(parsePaymentBadgeWire(undefined)).toBeNull()
  })

  it('every kind parses to a complete badge', () => {
    for (const kind of PAYMENT_BADGE_KINDS) {
      const parsed = parsePaymentBadgeWire({ kind })
      expect(parsed).not.toBeNull()
      expect(parsed?.label.length).toBeGreaterThan(0)
    }
  })
})
