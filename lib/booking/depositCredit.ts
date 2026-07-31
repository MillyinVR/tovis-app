// lib/booking/depositCredit.ts
//
// THE canonical answer to "how much of this booking's bill has the up-front
// deposit already covered, and what is still due?" — computed here and nowhere
// else, consumed by the client's final-bill Stripe checkout, the zero-due
// closeout path, the pro's collect surfaces and the payment badge.
//
// Why this file exists at all (K10-A, 2026-07-30):
// `Booking.depositCreditedAt`'s schema comment has said "when the deposit was
// applied against the final total" since the deposit rail shipped, and
// `ClientDepositCard` has promised the client their deposit "is held and will
// be credited toward your service total". Neither was true: NOTHING wrote
// `depositCreditedAt`, and `computeCheckoutTotal` had no deposit term, so the
// final bill charged the whole total a second time. A client who paid a deposit
// paid it twice. This module is the missing half of that promise
// (promise-site-runs-the-commit-site-gate).
//
// Honesty rules — the three states this must never get wrong:
//   - A DISPUTED deposit credits NOTHING. `depositDisputedAt` means Stripe has
//     already pulled the funds back out of the pro's balance; crediting it
//     against the bill would hand the client the service for free and bill the
//     pro for the privilege. This mirrors the badge's DISPUTED precedence (M4).
//   - A PARTIALLY refunded deposit credits only the NET still held. Refunding
//     $20 of a $60 deposit leaves a $40 credit, not $60 — `depositStatus` stays
//     PAID through a partial refund, so the status alone cannot be trusted.
//   - The credit is CAPPED at the total. A deposit larger than the final bill
//     (the pro discounted the service after the deposit landed) must not
//     produce a negative amount due, and must not silently become a refund —
//     returning the difference is a deliberate money movement the refund rail
//     owns, not something a display helper may imply.
//
// This module is a PURE transform over already-loaded Booking columns
// (DEPOSIT_CREDIT_SELECT) — no DB access, no Stripe I/O — like its siblings
// lib/booking/paymentBadge.ts and lib/booking/moneyTrail.ts. The caller owns
// the query + authz.

import { BookingDepositStatus } from '@prisma/client'
import type { Prisma } from '@prisma/client'

import { decimalToCents } from '@/lib/money'

/**
 * The exact Booking columns the credit derives from. Spread this into any
 * surface's Prisma select so a charge amount and the badge that describes it
 * can never disagree about their inputs.
 */
export const DEPOSIT_CREDIT_SELECT = {
  depositStatus: true,
  depositAmount: true,
  depositRefundedCents: true,
  depositDisputedAt: true,
  totalAmount: true,
} satisfies Prisma.BookingSelect

export type DepositCreditBookingRow = Prisma.BookingGetPayload<{
  select: typeof DEPOSIT_CREDIT_SELECT
}>

export type DepositCredit = {
  /**
   * Deposit money actually still held on the pro's side: the captured deposit
   * minus anything refunded, and 0 outright while the charge is disputed.
   * NOT capped at the total — this is the money, not the credit.
   */
  netDepositHeldCents: number
  /**
   * What the deposit takes off this bill: `netDepositHeldCents` capped at the
   * total. Capped and net differ only when the deposit exceeds the final bill.
   */
  creditCents: number
  /** The booking's full bill in cents (0 when `totalAmount` is null). */
  totalCents: number
  /** What the client still owes after the credit. Never negative. */
  amountDueCents: number
  /**
   * The deposit covers the entire bill — closeout must settle at $0 due rather
   * than opening a charge. False for a $0 total: a bill with nothing on it is
   * not "prepaid", and treating it as such would let an empty booking close
   * itself out. The K1 badge's PREPAID_IN_FULL reads this exact flag.
   */
  coversTotal: boolean
  /**
   * Deposit held BEYOND the bill, in cents. Non-zero only when the total was
   * reduced after the deposit landed. Surfaced so a pro/admin can see money
   * that needs returning; this module never returns it on its own.
   */
  excessHeldCents: number
}

/**
 * Derive the deposit credit for a booking row.
 *
 * Only a PAID deposit credits anything. PENDING / FAILED are money that never
 * arrived; NONE is no deposit at all; REFUNDED is money already returned in
 * full. A dispute zeroes the credit regardless of status, because
 * `depositStatus` stays PAID while the funds are gone.
 */
export function deriveDepositCredit(row: DepositCreditBookingRow): DepositCredit {
  const totalCents = Math.max(0, decimalToCents(row.totalAmount) ?? 0)

  const netDepositHeldCents = deriveNetDepositHeldCents(row)
  const creditCents = Math.min(netDepositHeldCents, totalCents)

  return {
    netDepositHeldCents,
    creditCents,
    totalCents,
    amountDueCents: totalCents - creditCents,
    coversTotal: totalCents > 0 && creditCents >= totalCents,
    excessHeldCents: netDepositHeldCents - creditCents,
  }
}

/**
 * Does this booking's deposit — once paid, or already paid — settle the whole
 * bill? The question a K10 prepay surface asks.
 *
 * `deriveDepositCredit` deliberately cannot answer it for a deposit that has
 * not landed: a PENDING deposit holds no money, so its credit is 0 and
 * `coversTotal` is false. Correct for sizing a charge, wrong for describing
 * one — a client staring at a prepay-required booking is about to pay for the
 * appointment in full, and the surface asking for that money must say so rather
 * than calling it a deposit that will be "credited later".
 *
 * The ONE thing this drops relative to `deriveNetDepositHeldCents` is the
 * `depositStatus === PAID` gate. Refunds and disputes still apply: a prepay with
 * $50 handed back does NOT cover the bill any more, and a card that says
 * "Paid in full ✓ — nothing to pay on the day" over a $50 balance is exactly
 * the display lie M11 exists to stop. False for a $0 total, matching
 * `coversTotal`.
 */
export function depositWouldCoverTotal(row: DepositCreditBookingRow): boolean {
  const totalCents = Math.max(0, decimalToCents(row.totalAmount) ?? 0)
  if (totalCents <= 0) return false

  if (row.depositDisputedAt != null) return false

  const depositCents = decimalToCents(row.depositAmount)
  if (depositCents == null) return false

  return Math.max(0, depositCents - row.depositRefundedCents) >= totalCents
}

/**
 * Deposit money still held, before any cap against the bill. Exported so the
 * payment badge can print the net a pro still holds ("Deposit paid $40.00")
 * without re-deriving the refund/dispute rules that produce it.
 */
export function deriveNetDepositHeldCents(row: DepositCreditBookingRow): number {
  // A disputed deposit is money Stripe has already clawed back. It credits
  // nothing and it is not "held" — see the file header.
  if (row.depositDisputedAt != null) return 0

  if (row.depositStatus !== BookingDepositStatus.PAID) return 0

  const depositCents = decimalToCents(row.depositAmount)
  if (depositCents == null) return 0

  return Math.max(0, depositCents - row.depositRefundedCents)
}
