// lib/proClientPolicy/policy.ts
//
// K16 — what ONE pro's policy for ONE client actually requires, resolved once.
//
// The single reader of `ProClientPolicy`. Four switches, four call sites, and
// this module is the only thing that decides what each one MEANS; the call sites
// branch on the resolved answer and never re-derive it. That shape is deliberate
// and is the same one K1 (paymentBadge), K5 (relationshipLabel) and K11
// (clientConfirmation) use — the alternative is per-surface branching that
// drifts, which is how one code comes to mean two things.
//
// 🔴 Every switch here is a REQUIREMENT, not a characterisation. Nothing in this
// module — or in the table it reads — records WHY a pro set it. That is not an
// oversight to fill in later: a boolean is not a statement about a person, and
// free text is discoverable in a dispute. The pro's prose lives in
// `ClientProfessionalNote`.
//
// Two of the four switches carry a gate that is not about policy at all:
//
//   * `requireCardOnFile` is dead while ENABLE_NO_SHOW_PROTECTION is off,
//     because the only way to COMPLY with it — the setup-intent route and the
//     save-card surface — is dark behind that same flag. Requiring something a
//     client has no means to do is an offered option that cannot be accepted, so
//     the requirement resolves FALSE rather than refusing bookings nobody can
//     rescue ([[offered-option-must-be-an-accepted-write]]).
//
//   * `requireDeposit` widens the pro's deposit SCOPE; it does not conjure an
//     AMOUNT. `computeDepositCents` returns 0 when the pro's account-wide
//     deposit is disabled or unconfigured, so a per-client deposit on such a pro
//     would be "required: true, $0 to pay" — a booking stranded on a charge that
//     does not exist. It therefore stays subject to `proDepositEnabled`, and the
//     write route REFUSES to set the switch for a pro who has no usable deposit
//     configured (`describeDepositRequirementBlocker`) instead of storing a rule
//     that silently does nothing.
//
// 🔴 Prepay is the deliberate asymmetry: `prepayScope` DOES override
// `depositEnabled`, exactly as K10's per-service requirement does, because
// prepay carries its own amount (100% of the covered slice, PREPAY_DEPOSIT_SETTINGS)
// and needs nothing from the pro's deposit configuration. The two rules differ
// because one of them can size itself and the other cannot.
//
// Pure: no DB access, no env reads. The caller owns the query and passes the
// flag in, so this stays unit-testable and so a test can drive both flag states.

import { DepositType, OfferingPrepayScope } from '@prisma/client'

/** The stored row's shape — exactly the columns this module reads. */
export type ProClientPolicyRow = Readonly<{
  requireDeposit: boolean
  prepayScope: OfferingPrepayScope | null
  requireCardOnFile: boolean
  blockSelfServeBooking: boolean
}>

export type ProClientPolicySignals = Readonly<{
  /** The stored policy, or null when the pro has set nothing for this client. */
  policy: ProClientPolicyRow | null
  /**
   * Whether the card-on-file rail is live (`noShowProtectionEnabled()`). Passed
   * in rather than read here so the resolver stays pure and both states are
   * drivable from a test.
   */
  cardOnFileRailEnabled: boolean
}>

export type ResolvedProClientPolicy = Readonly<{
  /** Widen the pro's deposit scope to cover this client. */
  requiresDeposit: boolean
  /** Per-client prepay requirement in force, or null. */
  prepayScope: OfferingPrepayScope | null
  /** Client must have a saved card before this booking can be finalized. */
  requiresCardOnFile: boolean
  /** Client may not create a NEW appointment themselves. */
  blocksSelfServeBooking: boolean
  /** Anything at all set — drives the pro-facing "policy active" mark. */
  anyRequirement: boolean
}>

const NO_POLICY: ResolvedProClientPolicy = {
  requiresDeposit: false,
  prepayScope: null,
  requiresCardOnFile: false,
  blocksSelfServeBooking: false,
  anyRequirement: false,
}

/**
 * The resolved policy for one (pro, client) pair.
 *
 * An absent row resolves to every default, which is why nothing in the codebase
 * has to create a policy row before reading one.
 */
export function resolveProClientPolicy(
  signals: ProClientPolicySignals,
): ResolvedProClientPolicy {
  const { policy } = signals
  if (!policy) return NO_POLICY

  // The rail gate, not a policy decision — see the file header.
  const requiresCardOnFile =
    policy.requireCardOnFile && signals.cardOnFileRailEnabled

  const requiresDeposit = policy.requireDeposit
  const prepayScope = policy.prepayScope
  const blocksSelfServeBooking = policy.blockSelfServeBooking

  return {
    requiresDeposit,
    prepayScope,
    requiresCardOnFile,
    blocksSelfServeBooking,
    anyRequirement:
      requiresDeposit ||
      prepayScope != null ||
      requiresCardOnFile ||
      blocksSelfServeBooking,
  }
}

/**
 * The wider of two prepay requirements, or null when neither applies.
 *
 * `ENTIRE_BOOKING` strictly contains `SERVICE_ONLY`, so when a client-level rule
 * and K10's per-service rule both fire, the wider one wins. This is a scope
 * union, NOT an amount: `computeUpfrontDepositCents` still takes the max of the
 * money terms and never their sum, so widening the scope can raise what is
 * collected up front but can never double-charge it.
 */
export function widerPrepayScope(
  left: OfferingPrepayScope | null,
  right: OfferingPrepayScope | null,
): OfferingPrepayScope | null {
  if (left == null) return right
  if (right == null) return left

  return left === OfferingPrepayScope.ENTIRE_BOOKING ||
    right === OfferingPrepayScope.ENTIRE_BOOKING
    ? OfferingPrepayScope.ENTIRE_BOOKING
    : OfferingPrepayScope.SERVICE_ONLY
}

/**
 * Whether the pro's account-wide deposit configuration can produce a non-zero
 * charge at all.
 *
 * Asked of the CONFIGURATION, not of a price: a PERCENT deposit's amount depends
 * on the booking, so "20% of something" is usable even though this function is
 * given no bill. Only a switched-off deposit, a flat $0, or a 0% rate are
 * structurally incapable of ever charging anything — and those are exactly the
 * states in which `computeDepositCents` returns 0 for every booking.
 */
export function hasUsableDepositConfiguration(settings: {
  depositEnabled: boolean
  depositType: DepositType
  depositFlatAmountCents: number | null
  depositPercent: number | null
}): boolean {
  if (!settings.depositEnabled) return false

  return settings.depositType === DepositType.FLAT
    ? (settings.depositFlatAmountCents ?? 0) > 0
    : (settings.depositPercent ?? 0) > 0
}

/**
 * Why this pro cannot require a DEPOSIT from a client right now, or null when
 * they can.
 *
 * Read by the write route, which refuses rather than storing a switch that would
 * resolve to a $0 charge. Both blockers are the pro's own account state, so both
 * messages point at the setting that fixes it.
 */
export function describeDepositRequirementBlocker(args: {
  hasUsableDepositConfiguration: boolean
  proStripeReady: boolean
}): string | null {
  if (!args.proStripeReady) {
    return 'Finish connecting payments before requiring a deposit — a deposit you cannot receive would leave the booking unpayable.'
  }

  if (!args.hasUsableDepositConfiguration) {
    return 'Set a deposit amount in your payment settings before requiring a deposit from a client — otherwise the requirement asks for $0.'
  }

  return null
}

/**
 * Why this pro cannot require PREPAY from a client right now, or null.
 *
 * Only Stripe readiness binds: prepay sizes itself from the bill, so it needs
 * nothing from the pro's deposit configuration (the asymmetry in the header).
 */
export function describePrepayRequirementBlocker(args: {
  proStripeReady: boolean
}): string | null {
  return args.proStripeReady
    ? null
    : 'Finish connecting payments before requiring prepayment — a charge you cannot receive would leave the booking unpayable.'
}

/**
 * Why this pro cannot require a CARD ON FILE right now, or null.
 *
 * The rail gate is a real blocker at the CONTROL, not only at enforcement: a pro
 * who could tick this box while the rail is dark would be told the client must
 * save a card, on a platform where no client can save one
 * ([[kill-switch-must-reach-the-control]]).
 */
export function describeCardOnFileRequirementBlocker(args: {
  cardOnFileRailEnabled: boolean
}): string | null {
  return args.cardOnFileRailEnabled
    ? null
    : 'Saved cards are not available yet, so this cannot be required.'
}
