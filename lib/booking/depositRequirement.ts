// lib/booking/depositRequirement.ts
//
// Does THIS booking owe the pro money up front, and why? The single reader of
// `ProfessionalPaymentSettings.depositScope` and of the per-service prepay
// requirement (`ProfessionalServiceOffering.prepayScope`).
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
// K10 (2026-07-30) added the second reason: a service the pro marked
// prepay-required. It answers WHETHER there is a charge; the AMOUNT is
// lib/booking/prepay.ts's job.
//
// 🔴 The one-time platform DISCOVERY FEE is NOT scoped by either. It stays
// limited to the new-via-discovery subset (`isNewDiscoveryClient`) whatever the
// pro picks — the schema comment on `DepositScope` says so, and widening it
// would charge the platform's matchmaking fee on bookings the platform did not
// match. Deposit and fee are two decisions that happen to ride one Stripe
// PaymentIntent; this module answers only the first.

import { DepositScope } from '@prisma/client'
import type { BookingDiscoveryProvenance, OfferingPrepayScope } from '@prisma/client'

import { isDiscoveryProvenance } from '@/lib/booking/discoveryFee'

export type DepositRequirementSignals = Readonly<{
  /** The pro's chosen scope. */
  scope: DepositScope
  /** Pro has deposits turned on at all. Off => no scope-driven deposit. */
  proDepositEnabled: boolean
  /** Pro can actually take a platform-processed charge (Connect charges + payouts). */
  proStripeReady: boolean
  /** Server-validated provenance for this booking (never client input). */
  provenance: BookingDiscoveryProvenance
  /** Any prior relationship signal for this pair — see lib/booking/discoveryFee.ts. */
  hasPriorRelationship: boolean
  /**
   * K10: the BASE offering's per-service prepay requirement, or null. Non-null
   * means this service is paid in full up front, whatever the account-wide
   * settings say.
   */
  offeringPrepayScope: OfferingPrepayScope | null
}>

export type DepositRequirement = Readonly<{
  /**
   * There is an up-front charge on this booking, for either reason. The gate
   * every caller should branch on.
   */
  required: boolean
  /**
   * The pro's `depositScope` (plus `depositEnabled`) calls for a deposit here.
   * Kept separate from `required` because it sizes the ORDINARY deposit term:
   * a booking can be prepay-required while the scope says nothing, and then the
   * pro's flat/percent deposit must NOT also be added on top.
   */
  scopeRequired: boolean
  /**
   * The prepay requirement in force, or null. Sizes the 100% term and decides
   * whether add-ons are included (lib/booking/prepay.ts).
   */
  prepayScope: OfferingPrepayScope | null
}>

const NO_DEPOSIT: DepositRequirement = {
  required: false,
  scopeRequired: false,
  prepayScope: null,
}

/**
 * Whether this booking takes money up front, and under which rule(s).
 *
 * Order matters, and it is not the order the pre-K10 version used:
 *
 *  1. **Stripe-readiness first.** Not a policy call — a pro who cannot receive
 *     a destination charge cannot be handed a deposit, so requiring one would
 *     only strand the booking in PENDING with no way to pay it. This gate binds
 *     prepay too: a per-service requirement the pro cannot collect on is worse
 *     than no requirement at all.
 *  2. **Per-service prepay OVERRIDES the account-wide `depositEnabled` switch**
 *     (Tori, 2026-07-30). A pro with deposits off who marks one service
 *     prepay-required gets prepay on it — which is why `proDepositEnabled` can
 *     no longer be an early return for the whole function.
 *  3. The scope rule, unchanged. NEW_DISCOVERY_ONLY (the default) reproduces
 *     `isNewDiscoveryClient` exactly, so every pro who never touched the
 *     setting sees no change — pinned by a test that drives both functions over
 *     the same signal matrix.
 */
export function resolveDepositRequirement(
  signals: DepositRequirementSignals,
): DepositRequirement {
  if (!signals.proStripeReady) return NO_DEPOSIT

  const prepayScope = signals.offeringPrepayScope
  const scopeRequired = signals.proDepositEnabled && matchesDepositScope(signals)

  return {
    required: scopeRequired || prepayScope != null,
    scopeRequired,
    prepayScope,
  }
}

function matchesDepositScope(signals: DepositRequirementSignals): boolean {
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
