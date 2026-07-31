// lib/booking/paymentBadge.ts
//
// THE canonical at-a-glance payment state of a booking — ONE derived badge,
// computed here and nowhere else, rendered by the pro calendar card, the pro
// bookings list and the booking-detail header (and consumed verbatim by iOS
// over the wire — the device renders `label`/`tone`, it never recomputes them).
//
// Why one helper: a payment label re-derived per surface drifts, and a money
// label that drifts is the worst kind (one-code-two-meanings /
// display-check-on-a-write-path). Before this existed the only place a pro
// could see deposit state was the MoneyTrailInspector on the booking detail
// page — nothing on the calendar or the list said "this client already paid".
//
// Honesty rules (M4 / M11 display-truth — the two states this badge must
// never get wrong):
//   - A DISPUTED charge must never render as money safely collected. That
//     covers BOTH charges: the deposit's own PaymentIntent (depositDisputedAt)
//     and the final bill's (stripePaymentStatus DISPUTED). Stripe has already
//     pulled the funds; a green "Paid" here would be a lie.
//   - A PARTIALLY refunded charge stays PAID-shaped and must not read as fully
//     refunded. depositStatus only flips to REFUNDED at full refund; the badge
//     mirrors that and shows the NET amount still held.
//
// This module is a PURE transform over already-loaded Booking columns
// (PAYMENT_BADGE_SELECT) — no DB access, no Stripe I/O — like its bigger
// sibling lib/booking/moneyTrail.ts. The caller owns the query + authz.

import {
  BookingCheckoutStatus,
  BookingDepositStatus,
  StripePaymentStatus,
} from '@prisma/client'
import type { Prisma } from '@prisma/client'

import type { BadgeTone } from '@/app/_components/ui'
import {
  DEPOSIT_CREDIT_SELECT,
  deriveDepositCredit,
} from '@/lib/booking/depositCredit'
import { formatCents } from '@/lib/money'

/**
 * The exact Booking columns the badge derives from. Spread this into any
 * surface's Prisma select so the wire payload and the badge can never disagree
 * about their inputs.
 */
export const PAYMENT_BADGE_SELECT = {
  // The deposit axis's columns come from the credit helper rather than being
  // restated here, so widening what the credit reads cannot leave the badge
  // deriving from a narrower row than the charge it describes.
  ...DEPOSIT_CREDIT_SELECT,
  checkoutStatus: true,
  paymentCollectedAt: true,
  stripePaymentStatus: true,
  stripeAmountTotal: true,
  stripeAmountRefunded: true,
} satisfies Prisma.BookingSelect

export type PaymentBadgeBookingRow = Prisma.BookingGetPayload<{
  select: typeof PAYMENT_BADGE_SELECT
}>

/**
 * Every state the badge can name. `DEPOSIT_PAID` / `PREPAID_IN_FULL` are the
 * pre-session deposit axis; the rest follow the final bill. PREPAID_IN_FULL is
 * derived (net deposit covers the booking total), so the K10 "prepay as a 100%
 * deposit" work lights it up with no new wire state.
 */
export const PAYMENT_BADGE_KINDS = [
  'UNPAID',
  'DEPOSIT_DUE',
  'DEPOSIT_PAID',
  'PREPAID_IN_FULL',
  'PARTIALLY_PAID',
  'AWAITING_CONFIRMATION',
  'PAID',
  'WAIVED',
  'REFUNDED',
  'DISPUTED',
] as const

export type PaymentBadgeKind = (typeof PAYMENT_BADGE_KINDS)[number]

export type PaymentBadge = {
  kind: PaymentBadgeKind
  /** Ready-to-render wording — iOS shows this string verbatim (K2 parity). */
  label: string
  tone: BadgeTone
  /**
   * false only for UNPAID: dense surfaces (the calendar card) skip the badge
   * there — a wall of "Unpaid" on every upcoming appointment is noise, and
   * absence already reads as "nothing collected". List/detail surfaces may
   * still render it. The DECISION lives here so surfaces can't drift on it.
   */
  significant: boolean
}

/**
 * Presentation per kind — tone and density in ONE table so a surface can
 * reconstruct a full badge from a bare kind (the calendar wire parser does).
 * Tones reuse the app-wide Badge vocabulary; no raw colors anywhere.
 */
const PAYMENT_BADGE_PRESENTATION: Record<
  PaymentBadgeKind,
  { tone: BadgeTone; significant: boolean }
> = {
  UNPAID: { tone: 'neutral', significant: false },
  DEPOSIT_DUE: { tone: 'pending', significant: true },
  DEPOSIT_PAID: { tone: 'info', significant: true },
  PREPAID_IN_FULL: { tone: 'success', significant: true },
  PARTIALLY_PAID: { tone: 'pending', significant: true },
  AWAITING_CONFIRMATION: { tone: 'warn', significant: true },
  PAID: { tone: 'success', significant: true },
  WAIVED: { tone: 'neutral', significant: true },
  REFUNDED: { tone: 'neutral', significant: true },
  DISPUTED: { tone: 'danger', significant: true },
}

/**
 * Fixed wording per kind. DEPOSIT_PAID appends the NET amount still held at
 * derive time ("Deposit paid $40.00"), which is why labels ship on the wire
 * rather than being reconstructed from the kind on device.
 */
const PAYMENT_BADGE_LABELS: Record<PaymentBadgeKind, string> = {
  UNPAID: 'Unpaid',
  DEPOSIT_DUE: 'Deposit due',
  DEPOSIT_PAID: 'Deposit paid',
  PREPAID_IN_FULL: 'Prepaid in full',
  PARTIALLY_PAID: 'Partially paid',
  AWAITING_CONFIRMATION: 'Awaiting confirmation',
  PAID: 'Paid',
  WAIVED: 'Waived',
  REFUNDED: 'Refunded',
  DISPUTED: '⚠ Disputed',
}

function badgeOf(kind: PaymentBadgeKind, label?: string): PaymentBadge {
  return {
    kind,
    label: label ?? PAYMENT_BADGE_LABELS[kind],
    ...PAYMENT_BADGE_PRESENTATION[kind],
  }
}

/**
 * Derive the one payment badge for a booking row.
 *
 * Precedence, most-critical first:
 *   1. A live/lost dispute on EITHER charge → DISPUTED (never "Paid").
 *   2. Final-bill outcome (paid / fully refunded / waived / attested
 *      off-platform / partially paid) — once the bill has a story, it wins.
 *   3. The up-front deposit axis (due / paid $net / prepaid in full /
 *      refunded) — the pre-session view.
 *   4. UNPAID — nothing collected, nothing owed up front.
 */
export function derivePaymentBadge(row: PaymentBadgeBookingRow): PaymentBadge {
  // 1 — disputes freeze everything. depositDisputedAt is set while the deposit
  // charge is under (or lost) a dispute and cleared on a WIN; stripePaymentStatus
  // DISPUTED is the final bill's equivalent (M11).
  if (
    row.depositDisputedAt != null ||
    row.stripePaymentStatus === StripePaymentStatus.DISPUTED
  ) {
    return badgeOf('DISPUTED')
  }

  // 2 — the final bill. Collected = the pro confirmed receipt
  // (paymentCollectedAt), Stripe settled it (SUCCEEDED), or closeout marked it
  // PAID — same trio the booking-detail payment tile trusts.
  const capturedCents = row.stripeAmountTotal ?? 0
  const refundedCents = row.stripeAmountRefunded
  const isPaid =
    row.paymentCollectedAt != null ||
    row.stripePaymentStatus === StripePaymentStatus.SUCCEEDED ||
    row.checkoutStatus === BookingCheckoutStatus.PAID

  if (isPaid) {
    const fullyRefunded = capturedCents > 0 && refundedCents >= capturedCents
    // A partial refund stays PAID — "Refunded" is reserved for the full amount.
    return badgeOf(fullyRefunded ? 'REFUNDED' : 'PAID')
  }

  if (row.checkoutStatus === BookingCheckoutStatus.WAIVED) {
    return badgeOf('WAIVED')
  }

  // Client attested an off-platform payment (cash / Venmo / …) that the pro
  // hasn't confirmed yet — money is claimed, not collected.
  if (row.checkoutStatus === BookingCheckoutStatus.AWAITING_CONFIRMATION) {
    return badgeOf('AWAITING_CONFIRMATION')
  }

  if (row.checkoutStatus === BookingCheckoutStatus.PARTIALLY_PAID) {
    return badgeOf('PARTIALLY_PAID')
  }

  // 3 — no final-bill story yet: the deposit axis. The net-held and
  // covers-the-total math lives in lib/booking/depositCredit.ts, which is also
  // what the client's final-bill charge and the zero-due closeout read — so the
  // badge that says "Prepaid in full" and the checkout that asks for $0 can
  // never disagree about which it is.
  if (row.depositStatus === BookingDepositStatus.PAID) {
    const credit = deriveDepositCredit(row)

    if (credit.coversTotal) {
      return badgeOf('PREPAID_IN_FULL')
    }

    // Show the NET still held so a partially-refunded deposit reads honestly
    // ("Deposit paid $40.00" after refunding $20 of $60), never as untouched.
    return badgeOf(
      'DEPOSIT_PAID',
      credit.netDepositHeldCents > 0
        ? `${PAYMENT_BADGE_LABELS.DEPOSIT_PAID} ${formatCents(credit.netDepositHeldCents)}`
        : PAYMENT_BADGE_LABELS.DEPOSIT_PAID,
    )
  }

  if (row.depositStatus === BookingDepositStatus.REFUNDED) {
    return badgeOf('REFUNDED')
  }

  // PENDING (checkout created, unpaid) and FAILED (charge failed / expired)
  // both mean the same thing to a glancing pro: the deposit is still owed.
  if (
    row.depositStatus === BookingDepositStatus.PENDING ||
    row.depositStatus === BookingDepositStatus.FAILED
  ) {
    return badgeOf('DEPOSIT_DUE')
  }

  // 4 — nothing collected, nothing owed up front.
  return badgeOf('UNPAID')
}

function isPaymentBadgeKind(value: unknown): value is PaymentBadgeKind {
  return (
    typeof value === 'string' &&
    (PAYMENT_BADGE_KINDS as readonly string[]).includes(value)
  )
}

/**
 * Normalize a badge that arrived over the wire (the calendar client re-parses
 * its JSON defensively). The kind must be known; tone/significance are then
 * reconstructed from the canonical table (they cannot drift with the payload),
 * and the label is trusted as sent — it may carry a server-formatted amount.
 */
export function parsePaymentBadgeWire(value: unknown): PaymentBadge | null {
  if (typeof value !== 'object' || value === null) return null

  const record = value as Record<string, unknown>
  if (!isPaymentBadgeKind(record.kind)) return null

  const label =
    typeof record.label === 'string' && record.label.trim()
      ? record.label.trim()
      : PAYMENT_BADGE_LABELS[record.kind]

  return badgeOf(record.kind, label)
}
