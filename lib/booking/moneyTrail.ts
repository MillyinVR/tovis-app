// lib/booking/moneyTrail.ts
//
// Booking "money trail" assembler — the read side of the Phase 2.5 refund
// inspector. Assembles a single, trustworthy view of everything money that ever
// happened to a booking (the final-bill charge, the up-front deposit charge, the
// one-time discovery fee, any no-show / late-cancel fee, and every refund row)
// plus the capability flags the inspector uses to gate its refund / waive
// actions.
//
// This module is deliberately a PURE transform over a single already-loaded
// Booking row (MONEY_TRAIL_SELECT) — no DB access, no Stripe I/O — so it stays
// trivially unit-testable and the caller owns the query + authorization. The
// numbers here are DISPLAY numbers; the refund service (lib/booking/refunds.ts)
// re-derives and enforces the authoritative refundable amount under a lock, so
// capabilities.refundableRemainingCents is a safe hint, never a promise.

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

/**
 * The exact Booking selection the assembler needs. The route selects with this
 * so `assembleMoneyTrail` receives a fully-typed row and nothing extra leaks.
 * `professionalId` is included for the caller's ownership check and is NOT
 * echoed into the trail.
 */
export const MONEY_TRAIL_SELECT = {
  id: true,
  professionalId: true,

  paymentProvider: true,
  stripeCurrency: true,
  stripePaymentStatus: true,
  stripeAmountTotal: true,
  stripeAmountRefunded: true,
  stripeApplicationFeeAmount: true,
  stripePaidAt: true,

  checkoutStatus: true,
  selectedPaymentMethod: true,
  paymentCollectedAt: true,

  totalAmount: true,
  serviceSubtotalSnapshot: true,
  subtotalSnapshot: true,
  tipAmount: true,
  taxAmount: true,
  discountAmount: true,

  depositStatus: true,
  depositAmount: true,
  depositPaidAt: true,
  depositCreditedAt: true,
  depositRefundedCents: true,

  discoveryFeeAmount: true,
  discoveryFeeRefundedAt: true,

  noShowMarkedAt: true,
  noShowFeeStatus: true,
  noShowFeeReason: true,
  noShowFeeAmount: true,
  noShowFeeChargedAt: true,

  refunds: {
    select: {
      id: true,
      amountCents: true,
      currency: true,
      status: true,
      trigger: true,
      reason: true,
      initiatedByRole: true,
      failureMessage: true,
      createdAt: true,
    },
    orderBy: { createdAt: 'asc' },
  },
} satisfies Prisma.BookingSelect

export type MoneyTrailBookingRow = Prisma.BookingGetPayload<{
  select: typeof MONEY_TRAIL_SELECT
}>

export type MoneyTrailRefund = {
  id: string
  amountCents: number
  currency: string
  status: BookingRefundStatus
  trigger: BookingRefundTrigger
  reason: string | null
  initiatedByRole: Role | null
  failureMessage: string | null
  createdAt: string
}

export type BookingMoneyTrail = {
  bookingId: string
  currency: string
  paymentProvider: PaymentProvider
  bill: {
    totalCents: number | null
    serviceSubtotalCents: number | null
    tipCents: number | null
    taxCents: number | null
    discountCents: number | null
    checkoutStatus: BookingCheckoutStatus
    selectedPaymentMethod: PaymentMethod | null
    collectedAt: string | null
  }
  finalCharge: {
    status: StripePaymentStatus
    capturedCents: number
    applicationFeeCents: number | null
    paidAt: string | null
  } | null
  deposit: {
    status: BookingDepositStatus
    amountCents: number | null
    paidAt: string | null
    creditedAt: string | null
    refundedCents: number
  } | null
  discoveryFee: {
    amountCents: number
    refundedAt: string | null
  } | null
  noShowFee: {
    status: NoShowFeeStatus
    reason: NoShowFeeReason | null
    amountCents: number | null
    chargedAt: string | null
    markedAt: string | null
  } | null
  refunds: MoneyTrailRefund[]
  summary: {
    capturedCents: number
    refundedCents: number
    pendingRefundCents: number
    netCents: number
  }
  capabilities: {
    canRefund: boolean
    refundableRemainingCents: number
    canWaiveNoShowFee: boolean
  }
}

/** Decimal dollars → integer cents (bankers-safe rounding). */
function decimalToCents(value: Prisma.Decimal | null): number | null {
  if (value == null) return null
  return Math.round(value.toNumber() * 100)
}

function toIso(value: Date | null): string | null {
  return value ? value.toISOString() : null
}

/**
 * Assemble the money trail for a single booking row. Pure — the caller has
 * already loaded the row (MONEY_TRAIL_SELECT) and authorized the viewer.
 */
export function assembleMoneyTrail(row: MoneyTrailBookingRow): BookingMoneyTrail {
  const currency = (row.stripeCurrency ?? 'usd').toLowerCase()

  // Final-bill Stripe charge (distinct from the deposit + no-show fee charges).
  // Only surface it once Stripe has an actual payment status; a MANUAL/cash
  // booking has none.
  const finalCharge =
    row.paymentProvider === PaymentProvider.STRIPE &&
    row.stripePaymentStatus != null
      ? {
          status: row.stripePaymentStatus,
          capturedCents: row.stripeAmountTotal ?? 0,
          applicationFeeCents: row.stripeApplicationFeeAmount ?? null,
          paidAt: toIso(row.stripePaidAt),
        }
      : null

  const deposit =
    row.depositStatus === BookingDepositStatus.NONE
      ? null
      : {
          status: row.depositStatus,
          amountCents: decimalToCents(row.depositAmount),
          paidAt: toIso(row.depositPaidAt),
          creditedAt: toIso(row.depositCreditedAt),
          refundedCents: row.depositRefundedCents,
        }

  const discoveryFee =
    row.discoveryFeeAmount == null
      ? null
      : {
          amountCents: row.discoveryFeeAmount,
          refundedAt: toIso(row.discoveryFeeRefundedAt),
        }

  const noShowFee =
    row.noShowFeeStatus == null
      ? null
      : {
          status: row.noShowFeeStatus,
          reason: row.noShowFeeReason,
          amountCents: decimalToCents(row.noShowFeeAmount),
          chargedAt: toIso(row.noShowFeeChargedAt),
          markedAt: toIso(row.noShowMarkedAt),
        }

  const refunds: MoneyTrailRefund[] = row.refunds.map((r) => ({
    id: r.id,
    amountCents: r.amountCents,
    currency: r.currency,
    status: r.status,
    trigger: r.trigger,
    reason: r.reason,
    initiatedByRole: r.initiatedByRole,
    failureMessage: r.failureMessage,
    createdAt: r.createdAt.toISOString(),
  }))

  // Captured = the final-bill charge total. Refunded = Stripe's authoritative
  // cumulative SUCCEEDED-refund total (includes Dashboard refunds). Pending rows
  // are reserved-but-not-yet-settled and must also be held back so the inspector
  // never invites a refund the service would reject.
  const capturedCents = row.stripeAmountTotal ?? 0
  const refundedCents = row.stripeAmountRefunded
  const pendingRefundCents = refunds
    .filter((r) => r.status === BookingRefundStatus.PENDING)
    .reduce((sum, r) => sum + r.amountCents, 0)

  const refundableRemainingCents = Math.max(
    0,
    capturedCents - refundedCents - pendingRefundCents,
  )

  const canRefund =
    row.paymentProvider === PaymentProvider.STRIPE &&
    row.stripePaymentStatus === StripePaymentStatus.SUCCEEDED &&
    refundableRemainingCents > 0

  // A no-show / late-cancel fee can be forgiven in-app only when it was assessed
  // but never successfully collected (a declined off-session charge → FAILED).
  // A CHARGED fee lives on its own PaymentIntent — giving that money back is a
  // refund, not a waive, and is intentionally out of scope here. SKIPPED means
  // nothing was ever owed; there is nothing to forgive.
  const canWaiveNoShowFee = row.noShowFeeStatus === NoShowFeeStatus.FAILED

  return {
    bookingId: row.id,
    currency,
    paymentProvider: row.paymentProvider,
    bill: {
      totalCents: decimalToCents(row.totalAmount),
      serviceSubtotalCents: decimalToCents(
        row.serviceSubtotalSnapshot ?? row.subtotalSnapshot,
      ),
      tipCents: decimalToCents(row.tipAmount),
      taxCents: decimalToCents(row.taxAmount),
      discountCents: decimalToCents(row.discountAmount),
      checkoutStatus: row.checkoutStatus,
      selectedPaymentMethod: row.selectedPaymentMethod,
      collectedAt: toIso(row.paymentCollectedAt),
    },
    finalCharge,
    deposit,
    discoveryFee,
    noShowFee,
    refunds,
    summary: {
      capturedCents,
      refundedCents,
      pendingRefundCents,
      netCents: Math.max(0, capturedCents - refundedCents),
    },
    capabilities: {
      canRefund,
      refundableRemainingCents,
      canWaiveNoShowFee,
    },
  }
}
