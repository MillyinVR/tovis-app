// lib/lastMinute/pickTierPlan.ts
//
// Single source of truth for "which tier plan's incentive applies" to a last-minute opening.
// Used by BOTH the read paths that DISPLAY the incentive (app/api/v1/client/openings,
// app/api/openings) AND the write path that CHARGES it (lib/booking/writeBoundary at finalize).
// Keeping one implementation guarantees the discount charged matches the discount advertised.
//
// Structurally typed (not bound to a specific Prisma payload) so each caller can pass its own
// select shape — the pickers only need the tier + scheduledFor.

import { LastMinuteTier, LastMinuteVisibilityMode } from '@prisma/client'

/**
 * The plan that was offered to a notified recipient: the plan for their matched tier
 * (notifiedTier, falling back to firstMatchedTier). Mirrors app/api/v1/client/openings.
 */
export function pickRecipientTierPlan<P extends { tier: LastMinuteTier }>(args: {
  notifiedTier: LastMinuteTier | null
  firstMatchedTier: LastMinuteTier
  tierPlans: P[]
}): P | null {
  const matchedTier = args.notifiedTier ?? args.firstMatchedTier
  return args.tierPlans.find((plan) => plan.tier === matchedTier) ?? null
}

/**
 * The plan a public/discovery viewer (no recipient row) would see. Mirrors app/api/v1/openings:
 * DISCOVERY tier for PUBLIC_AT_DISCOVERY; for PUBLIC_IMMEDIATE the latest plan already started
 * by `now` (else the first). Returns null for TARGETED_ONLY (no public incentive).
 */
export function pickPublicTierPlan<P extends { tier: LastMinuteTier; scheduledFor: Date }>(
  args: {
    visibilityMode: LastMinuteVisibilityMode
    tierPlans: P[]
  },
  now: Date,
): P | null {
  const plans = args.tierPlans
  if (plans.length === 0) return null

  if (args.visibilityMode === LastMinuteVisibilityMode.PUBLIC_AT_DISCOVERY) {
    return plans.find((plan) => plan.tier === LastMinuteTier.DISCOVERY) ?? null
  }

  if (args.visibilityMode === LastMinuteVisibilityMode.PUBLIC_IMMEDIATE) {
    const started = plans.filter((plan) => plan.scheduledFor.getTime() <= now.getTime())
    if (started.length > 0) {
      return started[started.length - 1] ?? null
    }
    return plans[0] ?? null
  }

  return null
}
