// lib/noShowProtection/fee.ts
//
// Pure fee math for no-show / late-cancel charging (Phase 2 revenue protection).
// Given a pro's ProNoShowSettings policy and the booking's agreed service price,
// compute the money amount owed. NOTHING here reads the DB, calls Stripe, or
// writes a Booking — it is a deterministic helper so tests can exercise the
// policy in isolation. Mirrors the deposit-plan math in lib/booking/discoveryDepositPlan.

import { Prisma, NoShowFeeType } from '@prisma/client'

/** The subset of ProNoShowSettings that determines the fee amount. */
export type NoShowFeePolicy = {
  feeType: NoShowFeeType
  feeFlatAmount: Prisma.Decimal | null
  feePercent: number | null
}

const ZERO = new Prisma.Decimal(0)

/**
 * Compute the fee owed as a 2dp money Decimal, or null when the policy yields
 * nothing chargeable (misconfigured amount, non-positive result, zero base).
 *
 * `baseAmount` is the agreed service price — the booking's `subtotalSnapshot`,
 * which is set at booking creation and always available pre-service (unlike the
 * final `totalAmount`, which only exists after checkout). A flat fee is capped at
 * the service price so a no-show fee can never exceed the booking's own value; a
 * percent fee is `baseAmount * clamp(percent, 1..100) / 100`.
 */
export function computeNoShowFeeAmount(
  policy: NoShowFeePolicy,
  baseAmount: Prisma.Decimal | null | undefined,
): Prisma.Decimal | null {
  const base = baseAmount ?? ZERO
  if (base.lessThanOrEqualTo(ZERO)) return null

  if (policy.feeType === NoShowFeeType.FLAT) {
    const flat = policy.feeFlatAmount
    if (!flat || flat.lessThanOrEqualTo(ZERO)) return null
    const capped = flat.greaterThan(base) ? base : flat
    return capped.toDecimalPlaces(2)
  }

  // PERCENT
  const pct = policy.feePercent
  if (typeof pct !== 'number' || !Number.isFinite(pct) || pct <= 0) return null
  const clamped = Math.min(pct, 100)
  const amount = base.mul(clamped).div(100).toDecimalPlaces(2)
  return amount.lessThanOrEqualTo(ZERO) ? null : amount
}

/** Convert a money Decimal to integer minor units (cents) for Stripe. */
export function noShowFeeAmountToCents(amount: Prisma.Decimal): number {
  return Math.round(amount.toNumber() * 100)
}

/**
 * True when a client cancellation lands inside the pro's cancel window — i.e.
 * `now` is at or after `scheduledFor - windowHours`. A cancel comfortably ahead
 * of the window is not a "late cancel" and carries no fee.
 */
export function isWithinCancelWindow(args: {
  scheduledFor: Date
  windowHours: number
  now: Date
}): boolean {
  const windowMs = Math.max(0, args.windowHours) * 60 * 60 * 1000
  const threshold = args.scheduledFor.getTime() - windowMs
  return args.now.getTime() >= threshold
}
