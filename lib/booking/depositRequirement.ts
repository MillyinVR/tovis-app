// lib/booking/depositRequirement.ts
//
// Does THIS booking owe the pro a deposit up front? The single reader of
// `ProfessionalPaymentSettings.depositScope`.
//
// Why this file exists (K10-A, 2026-07-30): `depositScope` shipped with the
// deposit rail, is offered to every pro as three radio buttons in
// `EditPaymentSettingsButton`, is validated and persisted by
// `PATCH /api/v1/pro/payment-settings` — and NOTHING read it. The deposit rode
// entirely on `isNewDiscoveryClient`, so a pro who chose "every booking" got
// deposits from new-via-discovery clients only, exactly as if they had chosen
// the default. A registered policy with no call site looks protective while
// being wide open (registered-policy-with-no-call-site).
//
// 🔴 The one-time platform DISCOVERY FEE is NOT scoped by this. It stays
// limited to the new-via-discovery subset (`isNewDiscoveryClient`) whatever the
// pro picks — the schema comment on `DepositScope` says so, and widening it
// would charge the platform's matchmaking fee on bookings the platform did not
// match. Deposit and fee are two decisions that happen to ride one Stripe
// PaymentIntent; this module answers only the first.

import { DepositScope } from '@prisma/client'
import type { BookingDiscoveryProvenance } from '@prisma/client'

import { isDiscoveryProvenance } from '@/lib/booking/discoveryFee'

export type DepositRequirementSignals = Readonly<{
  /** The pro's chosen scope. */
  scope: DepositScope
  /** Pro has deposits turned on at all. Off => never a deposit. */
  proDepositEnabled: boolean
  /** Pro can actually take a platform-processed charge (Connect charges + payouts). */
  proStripeReady: boolean
  /** Server-validated provenance for this booking (never client input). */
  provenance: BookingDiscoveryProvenance
  /** Any prior relationship signal for this pair — see lib/booking/discoveryFee.ts. */
  hasPriorRelationship: boolean
}>

/**
 * Whether the pro's settings call for a deposit on this booking.
 *
 * NEW_DISCOVERY_ONLY (the default) reproduces `isNewDiscoveryClient` exactly, so
 * every pro who never touched the setting sees no change in behaviour — pinned
 * by a test that drives both functions over the same signal matrix.
 */
export function isDepositRequired(signals: DepositRequirementSignals): boolean {
  if (!signals.proDepositEnabled) return false
  // Not a policy call: a pro who cannot receive a destination charge cannot be
  // handed a deposit, so requiring one would only strand the booking in
  // PENDING with no way to pay it.
  if (!signals.proStripeReady) return false

  switch (signals.scope) {
    case DepositScope.ALL_CLIENTS:
      return true

    case DepositScope.ALL_NEW_CLIENTS:
      return !signals.hasPriorRelationship

    case DepositScope.NEW_DISCOVERY_ONLY:
      return (
        !signals.hasPriorRelationship && isDiscoveryProvenance(signals.provenance)
      )
  }
}
