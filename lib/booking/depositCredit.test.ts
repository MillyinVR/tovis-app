import { describe, expect, it } from 'vitest'
import { BookingDepositStatus, Prisma } from '@prisma/client'

import {
  DEPOSIT_CREDIT_SELECT,
  deriveDepositCredit,
  deriveNetDepositHeldCents,
  type DepositCreditBookingRow,
} from '@/lib/booking/depositCredit'

function row(
  overrides: Partial<DepositCreditBookingRow> = {},
): DepositCreditBookingRow {
  return {
    depositStatus: BookingDepositStatus.NONE,
    depositAmount: null,
    depositRefundedCents: 0,
    depositDisputedAt: null,
    totalAmount: new Prisma.Decimal(200),
    ...overrides,
  }
}

const paidDeposit = (amount: number, overrides: Partial<DepositCreditBookingRow> = {}) =>
  row({
    depositStatus: BookingDepositStatus.PAID,
    depositAmount: new Prisma.Decimal(amount),
    ...overrides,
  })

describe('deriveDepositCredit', () => {
  it('credits nothing when there is no deposit at all', () => {
    const credit = deriveDepositCredit(row())

    expect(credit.creditCents).toBe(0)
    expect(credit.amountDueCents).toBe(20_000)
    expect(credit.coversTotal).toBe(false)
  })

  it('credits a paid deposit against the total and leaves the remainder due', () => {
    const credit = deriveDepositCredit(paidDeposit(60))

    expect(credit.netDepositHeldCents).toBe(6_000)
    expect(credit.creditCents).toBe(6_000)
    expect(credit.totalCents).toBe(20_000)
    expect(credit.amountDueCents).toBe(14_000)
    expect(credit.coversTotal).toBe(false)
  })

  // The bug this module exists to fix: before it, the final bill charged the
  // whole total again and the deposit was collected twice.
  it('never leaves the full total due once a deposit is paid', () => {
    const credit = deriveDepositCredit(paidDeposit(60))

    expect(credit.amountDueCents).toBeLessThan(credit.totalCents)
  })

  describe('a deposit that covers the whole bill', () => {
    it('settles to zero due when it exactly matches the total', () => {
      const credit = deriveDepositCredit(paidDeposit(200))

      expect(credit.amountDueCents).toBe(0)
      expect(credit.coversTotal).toBe(true)
      expect(credit.excessHeldCents).toBe(0)
    })

    it('caps the credit at the total and reports the excess separately', () => {
      const credit = deriveDepositCredit(paidDeposit(250))

      expect(credit.creditCents).toBe(20_000)
      expect(credit.amountDueCents).toBe(0)
      expect(credit.excessHeldCents).toBe(5_000)
      expect(credit.netDepositHeldCents).toBe(25_000)
    })

    it('never produces a negative amount due', () => {
      const credit = deriveDepositCredit(paidDeposit(1_000))

      expect(credit.amountDueCents).toBe(0)
      expect(credit.amountDueCents).toBeGreaterThanOrEqual(0)
    })

    // A $0 bill is not "prepaid" — treating it as covered would let a booking
    // with nothing on it close itself out.
    it('does not call a zero total covered', () => {
      const credit = deriveDepositCredit(
        paidDeposit(0, { totalAmount: new Prisma.Decimal(0) }),
      )

      expect(credit.totalCents).toBe(0)
      expect(credit.coversTotal).toBe(false)
      expect(credit.amountDueCents).toBe(0)
    })

    it('does not call a null total covered', () => {
      const credit = deriveDepositCredit(paidDeposit(60, { totalAmount: null }))

      expect(credit.totalCents).toBe(0)
      expect(credit.coversTotal).toBe(false)
    })
  })

  describe('refunds shrink the credit', () => {
    it('credits only the net still held after a partial refund', () => {
      const credit = deriveDepositCredit(
        paidDeposit(60, { depositRefundedCents: 2_000 }),
      )

      expect(credit.netDepositHeldCents).toBe(4_000)
      expect(credit.creditCents).toBe(4_000)
      expect(credit.amountDueCents).toBe(16_000)
    })

    // The M-series rule: depositStatus stays PAID through a partial refund, so
    // status alone cannot be trusted to size the credit.
    it('stops claiming full coverage once a prepay is partially refunded', () => {
      const prepaid = deriveDepositCredit(paidDeposit(200))
      expect(prepaid.coversTotal).toBe(true)

      const afterRefund = deriveDepositCredit(
        paidDeposit(200, { depositRefundedCents: 5_000 }),
      )

      expect(afterRefund.coversTotal).toBe(false)
      expect(afterRefund.amountDueCents).toBe(5_000)
    })

    it('credits nothing once the deposit is fully refunded', () => {
      const credit = deriveDepositCredit(
        row({
          depositStatus: BookingDepositStatus.REFUNDED,
          depositAmount: new Prisma.Decimal(60),
          depositRefundedCents: 6_000,
        }),
      )

      expect(credit.creditCents).toBe(0)
      expect(credit.amountDueCents).toBe(20_000)
    })

    it('never credits a negative amount if refunds exceed the deposit', () => {
      const credit = deriveDepositCredit(
        paidDeposit(60, { depositRefundedCents: 9_000 }),
      )

      expect(credit.netDepositHeldCents).toBe(0)
      expect(credit.creditCents).toBe(0)
    })
  })

  describe('a disputed deposit credits nothing', () => {
    // Stripe has already pulled the funds. Crediting them would hand the client
    // the service free and bill the pro for it.
    it('zeroes the credit even while depositStatus still reads PAID', () => {
      const credit = deriveDepositCredit(
        paidDeposit(200, { depositDisputedAt: new Date('2026-07-30T00:00:00Z') }),
      )

      expect(credit.netDepositHeldCents).toBe(0)
      expect(credit.creditCents).toBe(0)
      expect(credit.coversTotal).toBe(false)
      expect(credit.amountDueCents).toBe(20_000)
    })

    it('restores the credit when the dispute is won and the flag is cleared', () => {
      const disputed = deriveDepositCredit(
        paidDeposit(200, { depositDisputedAt: new Date('2026-07-30T00:00:00Z') }),
      )
      const won = deriveDepositCredit(paidDeposit(200, { depositDisputedAt: null }))

      expect(disputed.coversTotal).toBe(false)
      expect(won.coversTotal).toBe(true)
    })
  })

  describe('money that never arrived credits nothing', () => {
    it.each([
      BookingDepositStatus.NONE,
      BookingDepositStatus.PENDING,
      BookingDepositStatus.FAILED,
    ])('%s', (depositStatus) => {
      const credit = deriveDepositCredit(
        row({ depositStatus, depositAmount: new Prisma.Decimal(200) }),
      )

      expect(credit.creditCents).toBe(0)
      expect(credit.amountDueCents).toBe(20_000)
      expect(credit.coversTotal).toBe(false)
    })
  })

  it('rounds fractional dollars to whole cents', () => {
    const credit = deriveDepositCredit(
      paidDeposit(33.33, { totalAmount: new Prisma.Decimal(99.99) }),
    )

    expect(credit.creditCents).toBe(3_333)
    expect(credit.totalCents).toBe(9_999)
    expect(credit.amountDueCents).toBe(6_666)
  })
})

describe('deriveNetDepositHeldCents', () => {
  it('is the uncapped money, where the credit is the capped bill reduction', () => {
    const overpaid = paidDeposit(250)

    expect(deriveNetDepositHeldCents(overpaid)).toBe(25_000)
    expect(deriveDepositCredit(overpaid).creditCents).toBe(20_000)
  })
})

describe('DEPOSIT_CREDIT_SELECT', () => {
  // The select is the enforcement mechanism: a caller cannot hand this helper a
  // row missing a column the math needs without failing typecheck. Pin the
  // exact key set so widening the math forces a deliberate select change.
  it('names exactly the columns the credit derives from', () => {
    expect(Object.keys(DEPOSIT_CREDIT_SELECT).sort()).toEqual([
      'depositAmount',
      'depositDisputedAt',
      'depositRefundedCents',
      'depositStatus',
      'totalAmount',
    ])
  })
})
