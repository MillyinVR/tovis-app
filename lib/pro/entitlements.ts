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

export type PlanKey = 'free' | 'pro' | 'premium' | 'studio'

export type Entitlement =
  | 'custom_handle' // custom .tovis handle (today's ProfessionalProfile.isPremium)
  | 'tax_export' // transaction ledger + quarterly/CSV tax export
  | 'advanced_analytics' // retention insights beyond the monthly dashboard
  | 'priority_discovery' // priority placement on discovery surfaces
  | 'discovery_fee_waiver' // member's new discovery clients pay no platform fee
  | 'white_label' // salon white-label / multi-pro

const FREE: Entitlement[] = []

const PRO: Entitlement[] = [
  'custom_handle',
  'tax_export',
  'advanced_analytics',
  'priority_discovery',
  'discovery_fee_waiver',
]

// Premium's extra value is the full AI-camera allowance (a QUOTA, not a boolean —
// see cameraImageMonthlyQuota below), so its boolean entitlements equal Pro's.
const PREMIUM: Entitlement[] = [...PRO]

const STUDIO: Entitlement[] = [...PREMIUM, 'white_label']

const PLAN_ENTITLEMENTS: Record<PlanKey, Entitlement[]> = {
  free: FREE,
  pro: PRO,
  premium: PREMIUM,
  studio: STUDIO,
}

/**
 * Monthly AI-camera image allowance per plan. Every plan gets a taste (the camera
 * is the product's viral wedge); Premium/Studio get the working allowance. Each
 * analyzed image counts once (a look-brief = 1, a set-critique = its photo count).
 * Enforced in lib/pro/cameraQuota.ts only while membership enforcement is on.
 */
export const CAMERA_IMAGES_PER_MONTH: Record<PlanKey, number> = {
  free: 3,
  pro: 6,
  premium: 30,
  studio: 30,
}

/** Subscription states that actually grant the plan's paid entitlements. */
const ENTITLED_STATUSES: ReadonlySet<SubscriptionStatus> = new Set([
  SubscriptionStatus.ACTIVE,
  SubscriptionStatus.TRIALING,
])

export function normalizePlanKey(key: string | null | undefined): PlanKey {
  if (key === 'pro' || key === 'premium' || key === 'studio') return key
  return 'free'
}

/**
 * Plan keys whose ENTITLED holders carry this entitlement — for call sites that
 * must express the entitlement check in SQL (e.g. the search index priority
 * boost). Keeps the matrix here as the single source of truth.
 */
export function planKeysGranting(entitlement: Entitlement): PlanKey[] {
  return (Object.keys(PLAN_ENTITLEMENTS) as PlanKey[]).filter((key) =>
    PLAN_ENTITLEMENTS[key].includes(entitlement),
  )
}

/** SubscriptionStatus values that grant paid entitlements, for SQL call sites. */
export function entitledStatuses(): SubscriptionStatus[] {
  return [...ENTITLED_STATUSES]
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

// ── admin comps ─────────────────────────────────────────────────────────────
//
// An admin can grant complimentary months of a paid tier (compPlanKey +
// compUntil on ProfessionalSubscription). Comp state lives beside the paid
// Stripe state and is never written by webhooks. Because every tier is a
// strict superset of the one below it, "paid + comp" resolves to whichever
// plan is higher — entitlements, camera quota, and display all follow.

/** The subscription-row fields that decide what a pro is entitled to. */
export type SubscriptionEntitlementState = {
  planKey: string | null | undefined
  status: SubscriptionStatus | null | undefined
  compPlanKey?: string | null
  compUntil?: Date | null
}

const PLAN_ORDER: Record<PlanKey, number> = {
  free: 0,
  pro: 1,
  premium: 2,
  studio: 3,
}

/** The comp's plan while it is still in the future, else null. */
export function activeCompPlanKey(
  state: Pick<SubscriptionEntitlementState, 'compPlanKey' | 'compUntil'>,
  now: Date,
): PlanKey | null {
  if (!state.compPlanKey || !state.compUntil) return null
  if (state.compUntil.getTime() <= now.getTime()) return null
  const key = normalizePlanKey(state.compPlanKey)
  return key === 'free' ? null : key
}

/** Effective plan across paid + comp: whichever grants more. */
export function resolveEffectivePlanKey(
  state: SubscriptionEntitlementState,
  now: Date = new Date(),
): PlanKey {
  const paid = effectivePlanKey(state)
  const comp = activeCompPlanKey(state, now) ?? 'free'
  return PLAN_ORDER[comp] > PLAN_ORDER[paid] ? comp : paid
}

/** Entitlements across paid + comp (the higher plan's set). */
export function resolveEffectiveEntitlements(
  state: SubscriptionEntitlementState,
  now: Date = new Date(),
): Entitlement[] {
  return PLAN_ENTITLEMENTS[resolveEffectivePlanKey(state, now)]
}

/** The row fields every entitlement lookup needs (paid + comp). */
const ENTITLEMENT_STATE_SELECT = {
  planKey: true,
  status: true,
  compPlanKey: true,
  compUntil: true,
} as const

/**
 * Load a pro's current subscription and return their entitlements (paid + any
 * active admin comp). A missing row = free plan (every pro is implicitly free).
 * Performs one indexed lookup.
 */
export async function getProEntitlements(
  professionalId: string,
): Promise<Entitlement[]> {
  const sub = await prisma.professionalSubscription.findUnique({
    where: { professionalId },
    select: ENTITLEMENT_STATE_SELECT,
  })

  return resolveEffectiveEntitlements({
    planKey: sub?.planKey ?? 'free',
    status: sub?.status ?? null,
    compPlanKey: sub?.compPlanKey ?? null,
    compUntil: sub?.compUntil ?? null,
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

/**
 * Pure resolver: the monthly AI-camera image allowance the subscription state
 * grants (paid + any active comp — the higher plan wins). Non-entitled paid
 * statuses collapse to the free allowance, mirroring resolveEntitlements.
 */
export function resolveCameraImageMonthlyQuota(
  state: SubscriptionEntitlementState,
  now: Date = new Date(),
): number {
  return CAMERA_IMAGES_PER_MONTH[resolveEffectivePlanKey(state, now)]
}

/** A pro's current monthly AI-camera image allowance. Missing row = free plan. */
export async function getProCameraImageMonthlyQuota(
  professionalId: string,
): Promise<number> {
  const sub = await prisma.professionalSubscription.findUnique({
    where: { professionalId },
    select: ENTITLEMENT_STATE_SELECT,
  })

  return resolveCameraImageMonthlyQuota({
    planKey: sub?.planKey ?? 'free',
    status: sub?.status ?? null,
    compPlanKey: sub?.compPlanKey ?? null,
    compUntil: sub?.compUntil ?? null,
  })
}
