// lib/booking/discoveryFee.ts
//
// New-client discovery deposit + one-time platform fee policy.
//
// Tovis charges a small, flat, one-time platform fee (plus the pro's deposit) ONLY
// when a brand-new client books a pro they discovered through the Looks feed or the
// Discovery tab — i.e. a cold match the platform created. Clients who found the pro
// any other way (searched them by name/email, were invited, messaged them, tapped the
// pro's NFC card, or have a prior booking) are exempt: the platform takes nothing.
//
// This module is PURE and unit-testable. It performs no I/O — callers load the
// relationship signals (see DiscoveryClientSignals) inside the booking-finalize
// transaction and pass them in. The Stripe charge / application_fee wiring lives in
// the finalize route + write boundary, not here.
//
// Refund-reset rule (product decision 2026-06-17): the discovery fee marks a
// (client, pro) pair as "known" only while a NON-refunded fee exists. If the client
// cancels and the fee is refunded, the pair reverts to "new" and the fee is charged
// again on the next discovery booking. Callers MUST therefore compute
// `establishedBookingCount` so that it EXCLUDES cancelled bookings whose discovery fee
// was refunded. See app/api/bookings/finalize for the query.

import { BookingDiscoveryProvenance } from '@prisma/client'

/**
 * Default one-time discovery platform fee, in cents. Client pays this on top of the
 * pro's deposit; the pro keeps the full deposit. Flat (not a percentage) so it always
 * clears Stripe's ~2.9% + $0.30 per-transaction cost. Launch value $5; product may
 * raise toward $10 once conversion data exists. Override with TOVIS_DISCOVERY_FEE_CENTS.
 */
export const DEFAULT_DISCOVERY_FEE_CENTS = 500

/** Hard bounds so a misconfigured env var can't produce a nonsensical fee. */
export const MIN_DISCOVERY_FEE_CENTS = 0
export const MAX_DISCOVERY_FEE_CENTS = 1000

/**
 * Resolve the configured discovery fee (cents), clamped to [MIN, MAX]. A non-finite or
 * out-of-range env value falls back to the default rather than charging a bad amount.
 */
export function resolveDiscoveryFeeCents(
  raw: string | undefined = process.env.TOVIS_DISCOVERY_FEE_CENTS,
): number {
  if (raw == null || raw.trim() === '') return DEFAULT_DISCOVERY_FEE_CENTS
  const parsed = Number(raw)
  if (!Number.isFinite(parsed) || !Number.isInteger(parsed)) {
    return DEFAULT_DISCOVERY_FEE_CENTS
  }
  if (parsed < MIN_DISCOVERY_FEE_CENTS) return MIN_DISCOVERY_FEE_CENTS
  if (parsed > MAX_DISCOVERY_FEE_CENTS) return MAX_DISCOVERY_FEE_CENTS
  return parsed
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

  const hasPriorRelationship =
    signals.establishedBookingCount > 0 ||
    signals.acceptedInviteCount > 0 ||
    signals.threadCount > 0 ||
    signals.arrivedViaProNfc

  return !hasPriorRelationship
}
