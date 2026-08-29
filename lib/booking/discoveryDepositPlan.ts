// lib/booking/discoveryDepositPlan.ts
//
// Pure money math for the new-client discovery deposit + the one-time platform fees.
// Given a pro's deposit settings, the service price, and whether this booking is a
// fee-eligible new discovery client (see lib/booking/discoveryFee.ts), compute the
// deposit and both fees to collect up front. No I/O; fully unit-testable.
//
// ── How the two fees ride ONE Stripe PaymentIntent ─────────────────────────────
// The customer is charged `deposit + clientFee`. The whole charge is a destination
// charge to the pro, carrying `application_fee_amount = clientFee + proFee`.
//
// 🔴 Verified empirically against the Stripe sandbox, because the intuitive reading
// is wrong: on a destination charge Stripe transfers the FULL charge amount to the
// connected account and then pulls the application fee back — `transfer.amount`
// equals `charge.amount`, NOT `charge.amount - application_fee_amount`. The pro's NET
// is `deposit - proFee`, which is what "the pro fee comes out of the payout" means.
// This is also why the existing refund flags are correct as they stand:
//   • full refund + reverse_transfer + refund_application_fee -> pro 0, platform 0
//     (a pro/admin cancel unwinds the match completely, including the pro's fee);
//   • partial refund of just the deposit + reverse_transfer -> pro -proFee,
//     platform +clientFee+proFee (a client cancel >=24h out keeps both earned fees).
// Reversing the transfer explicitly instead would over-collect. Don't "fix" it.
//
// That combined charge must clear Stripe's minimum, so if deposit + clientFee is below
// the floor we collect nothing rather than create an un-processable sub-minimum charge.

import { DepositType } from '@/lib/prismaEnums'

import { computePlatformFees } from '@/lib/booking/discoveryFee'

/** Stripe's minimum charge for USD, in cents. */
export const STRIPE_MIN_CHARGE_CENTS = 50

export type DepositSettings = Readonly<{
  depositEnabled: boolean
  depositType: DepositType
  /** Flat deposit in cents (when depositType === FLAT). */
  depositFlatAmountCents: number | null
  /** Percent of service price, 1–100 (when depositType === PERCENT). */
  depositPercent: number | null
}>

export type DiscoveryDepositPlan = Readonly<{
  /** Deposit to collect, in cents (settles to the pro, credits the final total). */
  depositCents: number
  /** Client convenience fee, in cents — charged ON TOP of the deposit. */
  clientFeeCents: number
  /** Pro fee, in cents — taken OUT OF the pro's deposit payout. */
  proFeeCents: number
  /** Whether a membership waiver suppressed a pro fee that was otherwise due. */
  proFeeWaived: boolean
  /** deposit + clientFee — the single up-front PaymentIntent amount. */
  totalUpfrontCents: number
  /** clientFee + proFee — the Stripe `application_fee_amount` on that charge. */
  applicationFeeCents: number
}>

const EMPTY_PLAN: DiscoveryDepositPlan = {
  depositCents: 0,
  clientFeeCents: 0,
  proFeeCents: 0,
  proFeeWaived: false,
  totalUpfrontCents: 0,
  applicationFeeCents: 0,
}

/** The raw deposit a pro's settings call for on a service of this price (cents). */
export function computeDepositCents(args: {
  settings: DepositSettings
  servicePriceCents: number
}): number {
  const { settings, servicePriceCents } = args
  if (!settings.depositEnabled) return 0

  if (settings.depositType === DepositType.FLAT) {
    const flat = settings.depositFlatAmountCents ?? 0
    return Math.max(0, Math.round(flat))
  }

  // PERCENT
  const pct = settings.depositPercent ?? 0
  if (pct <= 0 || servicePriceCents <= 0) return 0
  return Math.max(0, Math.round((servicePriceCents * Math.min(pct, 100)) / 100))
}

/**
 * Full up-front plan for a booking. Returns an all-zero plan when nothing is
 * owed up front, or when the combined deposit + fee can't clear Stripe's
 * minimum charge.
 *
 * 🔴 The deposit and the fee are SEPARATE decisions and must stay that way
 * (K10-A): the deposit follows the pro's `depositScope` and, since K10, the
 * per-service prepay requirement — both sized by
 * `computeUpfrontDepositCents` (lib/booking/prepay.ts), which is why this
 * function takes an already-computed `depositCents`. `feeEligible` is the
 * platform's new-via-discovery gate (lib/booking/discoveryFee.ts) and never
 * widens with either. Collapsing them back into one boolean is how the pro's
 * scope setting came to have no reader.
 */
export function computeDiscoveryDepositPlan(args: {
  /** The deposit to collect, already sized — see lib/booking/prepay.ts. */
  depositCents: number
  feeEligible: boolean
  /** ENABLE_PLATFORM_FEES — resolved by the caller inside the trust boundary. */
  feesEnabled: boolean
  /** The pro's membership waives their $5 (never the client's fee). */
  proFeeWaived: boolean
}): DiscoveryDepositPlan {
  const depositCents = Math.max(0, Math.round(args.depositCents))
  const fees = computePlatformFees({
    depositCents,
    feeEligible: args.feeEligible,
    feesEnabled: args.feesEnabled,
    proFeeWaived: args.proFeeWaived,
  })

  const totalUpfrontCents = depositCents + fees.clientFeeCents

  // One combined charge — if it can't clear the Stripe minimum, collect nothing.
  if (totalUpfrontCents < STRIPE_MIN_CHARGE_CENTS) return EMPTY_PLAN

  return {
    depositCents,
    clientFeeCents: fees.clientFeeCents,
    proFeeCents: fees.proFeeCents,
    proFeeWaived: fees.proFeeWaived,
    totalUpfrontCents,
    applicationFeeCents: fees.clientFeeCents + fees.proFeeCents,
  }
}

export type DepositRefundActorKind = 'client' | 'pro' | 'admin'

export type DepositRefundPlan = Readonly<{
  /** Deposit portion to return to the client (clawed back from the pro). */
  refundDepositCents: number
  /** Whether the one-time platform fee is also returned (triggers refund-reset). */
  refundFee: boolean
  /** Total to refund on the deposit PaymentIntent = deposit + (fee if refundFee). */
  refundAmountCents: number
}>

const NO_REFUND: DepositRefundPlan = {
  refundDepositCents: 0,
  refundFee: false,
  refundAmountCents: 0,
}

/**
 * How much of a paid discovery deposit + client fee to return when a booking is
 * cancelled. `feeCents` here is the CLIENT convenience fee — the only fee the
 * customer paid, and so the only one that can be refunded TO them. The pro's fee
 * never touches this number; it is settled by the transfer reversal (below).
 *
 * Policy (locked 2026-06-17; fee split extended 2026-08-05):
 *   - pro / admin cancel        -> refund deposit AND client fee (not the client's
 *                                  fault). Ledger: client whole, pro whole (their $5
 *                                  comes back), platform 0. Refund-reset fires.
 *   - client cancel, >=24h out  -> refund deposit, KEEP the client fee (one-time match
 *                                  fee already earned). Ledger: client out the
 *                                  convenience fee, pro out their $5, platform keeps
 *                                  both. The kept fee keeps the pair "established".
 *   - client cancel, <24h out   -> refund nothing (deposit forfeited to the pro minus
 *                                  their $5, both fees kept).
 * Only when the client fee is refunded (pro/admin path) does the pair revert to "new".
 *
 * 🔴 Each of those three ledgers is what Stripe ALREADY produces from the existing
 * `reverse_transfer` / `refund_application_fee` flags in lib/booking/refunds.ts, once
 * the pro fee rides inside `application_fee_amount` — verified against the sandbox,
 * see the header of this file. Changing those flags breaks the policy; don't.
 */
export function resolveDepositRefundPlan(args: {
  actorKind: DepositRefundActorKind
  depositCents: number
  feeCents: number
  /** Client cancelled at least the full-refund window before the appointment. */
  clientWithinFullRefundWindow: boolean
}): DepositRefundPlan {
  const depositCents = Math.max(0, Math.round(args.depositCents))
  const feeCents = Math.max(0, Math.round(args.feeCents))

  if (args.actorKind === 'pro' || args.actorKind === 'admin') {
    return {
      refundDepositCents: depositCents,
      refundFee: true,
      refundAmountCents: depositCents + feeCents,
    }
  }

  // client
  if (!args.clientWithinFullRefundWindow) return NO_REFUND

  return {
    refundDepositCents: depositCents,
    refundFee: false,
    refundAmountCents: depositCents,
  }
}
