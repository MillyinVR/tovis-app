// lib/pro/entitlements.ts
//
// Membership entitlements — what each paid tier unlocks. The matrix is defined IN
// CODE (not the DB) so gating is deterministic and testable without seeded plan rows;
// SubscriptionPlan in the DB only carries pricing + Stripe Billing IDs + display copy.
//
// Hard rule: entitlements gate ONLY premium add-ons (custom handle, tax export,
// advanced analytics, …). Core earning paths — taking bookings, getting paid, basic
// dashboard — are NEVER gated on a subscription. A lapsed/canceled/past-due pro keeps
// working and just loses the paid extras (resolved here as the free tier).

import { SubscriptionStatus } from '@prisma/client'

import { prisma } from '@/lib/prisma'

export type PlanKey = 'free' | 'pro' | 'studio'

export type Entitlement =
  | 'custom_handle' // custom .tovis handle (today's ProfessionalProfile.isPremium)
  | 'tax_export' // transaction ledger + quarterly/CSV tax export
  | 'advanced_analytics' // retention insights beyond the monthly dashboard
  | 'priority_discovery' // priority placement / reduced discovery-fee share
  | 'reduced_platform_fee' // lower platform take on discovery deposits
  | 'white_label' // salon white-label / multi-pro

const FREE: Entitlement[] = []

const PRO: Entitlement[] = [
  'custom_handle',
  'tax_export',
  'advanced_analytics',
  'priority_discovery',
  'reduced_platform_fee',
]

const STUDIO: Entitlement[] = [...PRO, 'white_label']

const PLAN_ENTITLEMENTS: Record<PlanKey, Entitlement[]> = {
  free: FREE,
  pro: PRO,
  studio: STUDIO,
}

/** Subscription states that actually grant the plan's paid entitlements. */
const ENTITLED_STATUSES: ReadonlySet<SubscriptionStatus> = new Set([
  SubscriptionStatus.ACTIVE,
  SubscriptionStatus.TRIALING,
])

export function normalizePlanKey(key: string | null | undefined): PlanKey {
  if (key === 'pro' || key === 'studio') return key
  return 'free'
}

/**
 * Pure resolver: the entitlements a (planKey, status) pair grants. A non-entitled
 * status (past-due, canceled, incomplete) collapses to the free tier regardless of
 * planKey — so paid features switch off, but nothing core is touched.
 */
export function resolveEntitlements(args: {
  planKey: string | null | undefined
  status: SubscriptionStatus | null | undefined
}): Entitlement[] {
  if (!args.status || !ENTITLED_STATUSES.has(args.status)) return FREE
  return PLAN_ENTITLEMENTS[normalizePlanKey(args.planKey)]
}

export function planGrants(args: {
  planKey: string | null | undefined
  status: SubscriptionStatus | null | undefined
  entitlement: Entitlement
}): boolean {
  return resolveEntitlements(args).includes(args.entitlement)
}

/** The effective plan key for display (free when lapsed). */
export function effectivePlanKey(args: {
  planKey: string | null | undefined
  status: SubscriptionStatus | null | undefined
}): PlanKey {
  if (!args.status || !ENTITLED_STATUSES.has(args.status)) return 'free'
  return normalizePlanKey(args.planKey)
}

/**
 * Load a pro's current subscription and return their entitlements. A missing row =
 * free plan (every pro is implicitly free). Performs one indexed lookup.
 */
export async function getProEntitlements(
  professionalId: string,
): Promise<Entitlement[]> {
  const sub = await prisma.professionalSubscription.findUnique({
    where: { professionalId },
    select: { planKey: true, status: true },
  })

  return resolveEntitlements({
    planKey: sub?.planKey ?? 'free',
    status: sub?.status ?? null,
  })
}

/** Whether a pro currently has a specific entitlement. */
export async function hasEntitlement(
  professionalId: string,
  entitlement: Entitlement,
): Promise<boolean> {
  const entitlements = await getProEntitlements(professionalId)
  return entitlements.includes(entitlement)
}
