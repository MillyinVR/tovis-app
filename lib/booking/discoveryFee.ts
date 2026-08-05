// lib/booking/discoveryFee.ts
//
// New-client discovery deposit + one-time platform fee policy.
//
// The platform charges its one-time fees (alongside the pro's deposit) ONLY when a
// brand-new client books a pro they discovered through the Looks feed or the
// Discovery tab — i.e. a cold match the platform created. Clients who found the pro
// any other way (searched them by name/email, were invited, messaged them, tapped the
// pro's NFC card, or have a prior booking) are exempt: the platform takes nothing.
//
// This module is PURE and unit-testable. It performs no I/O — callers load the
// relationship signals (see DiscoveryClientSignals) inside the booking-finalize
// transaction and pass them in. The Stripe charge / application_fee wiring lives in
// the finalize route + write boundary, not here.
//
// ── The fee model (Tori, 2026-08-04; docs/design/membership-value-brief.md §11.5) ──
// TWO fees, both once per (client, pro) pair on the first cold-discovery appointment:
//   • CLIENT convenience fee — 10% of the DEPOSIT, floor $2, cap $10. Paid by the
//     client ON TOP of the deposit. Never waived by a pro's membership.
//   • PRO fee — $5 flat, collected OUT OF the pro's deposit payout. Waived entirely
//     for members — the pitch is that members keep every dollar the platform brings
//     them (see `feePitchBody` for the brand-resolved wording).
// This replaced a flat $5 client fee + no pro fee. Expected take ~$8–13 per cold match.
//
// Refund-reset rule (product decision 2026-06-17): the discovery fee marks a
// (client, pro) pair as "known" only while a NON-refunded fee exists. If the client
// cancels and the fee is refunded, the pair reverts to "new" and the fee is charged
// again on the next discovery booking. Callers MUST therefore compute
// `establishedBookingCount` so that it EXCLUDES cancelled bookings whose discovery fee
// was refunded. See app/api/v1/bookings/finalize for the query.

import { BookingDiscoveryProvenance } from '@prisma/client'

/**
 * Master switch for CHARGING the platform fees. Off (unset) => both fees resolve to
 * 0 and the deposit is collected on its own, which is the behaviour every booking has
 * had to date. Flipping this on is a deliberate, Tori-only act: the sequencing decided
 * in §11.5 is fees live -> measure conversion -> only THEN advertise the pro waiver as
 * a membership perk.
 *
 * Deliberately separate from ENABLE_MEMBERSHIP_ENFORCEMENT: that switch governs what a
 * membership RESTRICTS, this one governs what the platform CHARGES. The waiver needs
 * both (there is nothing to waive while the fees are off).
 */
export function platformFeesEnabled(): boolean {
  const raw = process.env.ENABLE_PLATFORM_FEES
  if (typeof raw !== 'string') return false
  const v = raw.trim().toLowerCase()
  return v === '1' || v === 'true' || v === 'yes'
}

/** Client convenience fee: this percent of the DEPOSIT (not the service price). */
export const CLIENT_CONVENIENCE_FEE_PERCENT = 10
/** Floor — below this the fee wouldn't clear Stripe's ~2.9% + $0.30 per-charge cost. */
export const CLIENT_CONVENIENCE_FEE_MIN_CENTS = 200
/** Cap — "growth over extraction": the fee never scales past this on a big deposit. */
export const CLIENT_CONVENIENCE_FEE_MAX_CENTS = 1000

/** The pro's one-time fee on a cold match, taken out of their deposit payout. */
export const PRO_DISCOVERY_FEE_CENTS = 500

export type PlatformFeeSplit = Readonly<{
  /** Paid by the client ON TOP of the deposit. Never waived by a pro membership. */
  clientFeeCents: number
  /** Taken OUT OF the pro's deposit payout. 0 when waived or when fees are off. */
  proFeeCents: number
  /**
   * Whether a membership waiver actually suppressed a pro fee that would otherwise
   * have been charged. False when the fees are off or no deposit is due — there was
   * nothing to waive — so the measurement cohorts stay honest.
   */
  proFeeWaived: boolean
}>

const NO_FEES: PlatformFeeSplit = {
  clientFeeCents: 0,
  proFeeCents: 0,
  proFeeWaived: false,
}

/**
 * The client's convenience fee for a deposit of this size: 10% of the deposit,
 * clamped to [$2, $10]. Exported for the surfaces that quote the fee before a
 * booking exists; the booking's stamped `discoveryFeeAmount` is the source of truth
 * once one does.
 */
export function computeClientConvenienceFeeCents(depositCents: number): number {
  const deposit = Math.max(0, Math.round(depositCents))
  if (deposit <= 0) return 0

  const raw = Math.round((deposit * CLIENT_CONVENIENCE_FEE_PERCENT) / 100)
  if (raw < CLIENT_CONVENIENCE_FEE_MIN_CENTS) {
    return CLIENT_CONVENIENCE_FEE_MIN_CENTS
  }
  if (raw > CLIENT_CONVENIENCE_FEE_MAX_CENTS) {
    return CLIENT_CONVENIENCE_FEE_MAX_CENTS
  }
  return raw
}

/**
 * Both platform fees for one booking. Pure; the caller supplies the already-sized
 * deposit (lib/booking/prepay.ts), the cold-match verdict (isNewDiscoveryClient),
 * the flag, and whether the pro's membership waives their fee.
 *
 * 🔴 No deposit, no fees. The client fee is defined as a percentage OF the deposit and
 * is charged when the client pays it, and the pro fee is collected OUT OF the deposit
 * payout — so with `depositCents === 0` there is nothing to take either fee from, and
 * charging one would bill a client for a payment that does not exist. Reachable: a pro
 * can have deposits enabled with a flat amount of 0.
 *
 * 🔴 The pro fee is clamped to the deposit. Stripe caps `application_fee_amount` at
 * the charge total, and the pro's payout IS the deposit — we can never collect more
 * than it. A $5 deposit therefore yields a $5 pro fee and a $0 payout, not a debt.
 */
export function computePlatformFees(args: {
  depositCents: number
  feeEligible: boolean
  feesEnabled: boolean
  proFeeWaived: boolean
}): PlatformFeeSplit {
  const depositCents = Math.max(0, Math.round(args.depositCents))
  if (!args.feeEligible || !args.feesEnabled || depositCents <= 0) {
    return NO_FEES
  }

  return {
    clientFeeCents: computeClientConvenienceFeeCents(depositCents),
    proFeeCents: args.proFeeWaived
      ? 0
      : Math.min(PRO_DISCOVERY_FEE_CENTS, depositCents),
    proFeeWaived: args.proFeeWaived,
  }
}

/**
 * Pre-loaded, server-derived relationship signals for a (client, pro) pair. All counts
 * are for THIS pair only.
 *
 * IMPORTANT: `source` and `arrivedViaProNfc` must be derived/validated server-side, not
 * taken from client input — they decide whether money is charged.
 */
/**
 * The provenance values that represent a cold platform match (Looks feed or the
 * Discovery tab) and are therefore eligible for the one-time platform fee. Every
 * other provenance (direct profile, name search, NFC, aftercare, pro-created,
 * unknown) means the client did not find the pro purely through discovery.
 */
export function isDiscoveryProvenance(p: BookingDiscoveryProvenance): boolean {
  return (
    p === BookingDiscoveryProvenance.LOOKS_FEED ||
    p === BookingDiscoveryProvenance.DISCOVERY_SEARCH
  )
}

export type DiscoveryClientSignals = Readonly<{
  /**
   * Server-validated provenance for this booking (from BookingHold, never client
   * input). Only LOOKS_FEED / DISCOVERY_SEARCH are eligible for the fee.
   */
  provenance: BookingDiscoveryProvenance
  /** Pro has enabled deposits. No deposit setting => no discovery deposit/fee. */
  proDepositEnabled: boolean
  /** Pro can actually take a platform-processed charge (Connect charges + payouts on). */
  proStripeReady: boolean
  /**
   * Count of prior bookings that ESTABLISH the relationship: active or completed AND
   * NOT cancelled-with-fee-refunded. Must exclude refund-reset bookings (see file
   * header). > 0 => returning client => exempt.
   */
  establishedBookingCount: number
  /** Accepted ProClientInvite rows for the pair (on the pro's roster) => exempt. */
  acceptedInviteCount: number
  /** Prior message threads for the pair (they've been in contact) => exempt. */
  threadCount: number
  /** Client arrived via THIS pro's NFC card => exempt. */
  arrivedViaProNfc: boolean
}>

/**
 * Whether this booking is a brand-new client who found the pro purely through
 * discovery (Looks feed / Discovery tab) and therefore owes the one-time platform fee
 * (and the pro's deposit). Returns false for any prior relationship signal, and for
 * pros that can't take a deposit (disabled or not Stripe-ready).
 */
export function isNewDiscoveryClient(signals: DiscoveryClientSignals): boolean {
  if (!isDiscoveryProvenance(signals.provenance)) return false
  if (!signals.proDepositEnabled) return false
  if (!signals.proStripeReady) return false

  return !hasPriorRelationship(signals)
}

/**
 * Whether this (client, pro) pair has ANY prior relationship signal — a
 * non-reset booking, an accepted roster invite, a message thread, or an NFC
 * tap. "New client" everywhere in the app means this returning false.
 *
 * Extracted so the deposit-scope policy (lib/booking/depositRequirement.ts) and
 * the platform-fee gate answer "is this client new?" from ONE definition. They
 * differ on WHICH new clients owe money, never on who counts as new.
 */
export function hasPriorRelationship(
  signals: Pick<
    DiscoveryClientSignals,
    | 'establishedBookingCount'
    | 'acceptedInviteCount'
    | 'threadCount'
    | 'arrivedViaProNfc'
  >,
): boolean {
  return (
    signals.establishedBookingCount > 0 ||
    signals.acceptedInviteCount > 0 ||
    signals.threadCount > 0 ||
    signals.arrivedViaProNfc
  )
}
