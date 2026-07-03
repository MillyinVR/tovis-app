// lib/membership/comp.ts
//
// Admin-granted complimentary membership ("free months"). Comp state lives on
// ProfessionalSubscription BESIDE the paid Stripe fields — webhooks never
// write it — so a comp survives real-subscription churn, and entitlements
// resolve to the better of paid vs comp (lib/pro/entitlements). Expiry is
// implicit (compUntil comparison); the daily sweep only exists to recompute
// the isPremium backfill once a comp lapses.

import { prisma } from '@/lib/prisma'
import { applyCustomHandleBackfill } from '@/lib/membership/customHandleBackfill'
import {
  normalizePlanKey,
  resolveEffectiveEntitlements,
  type PlanKey,
} from '@/lib/pro/entitlements'

export const COMP_MIN_MONTHS = 1
export const COMP_MAX_MONTHS = 24

/** Plans an admin may comp (never 'free' — revoke handles that). */
export function parseCompPlanKey(value: unknown): Exclude<PlanKey, 'free'> | null {
  if (typeof value !== 'string') return null
  const key = normalizePlanKey(value.trim().toLowerCase())
  return key === 'free' ? null : key
}

export function parseCompMonths(value: unknown): number | null {
  const n = typeof value === 'number' ? value : Number(value)
  if (!Number.isInteger(n)) return null
  if (n < COMP_MIN_MONTHS || n > COMP_MAX_MONTHS) return null
  return n
}

/**
 * Calendar-month addition in UTC. Month-end overflow rolls forward per Date
 * semantics (Jan 31 + 1mo → Mar 2/3) — a comp being a day or two generous at
 * month ends is fine.
 */
export function addUtcMonths(from: Date, months: number): Date {
  const d = new Date(from.getTime())
  d.setUTCMonth(d.getUTCMonth() + months)
  return d
}

export type CompGrantResult = {
  professionalId: string
  compPlanKey: string
  compUntil: Date
}

/**
 * Grant (or extend) a comp. Months stack: the new expiry counts from whichever
 * is later — now or the existing comp's expiry. The latest grant's plan wins.
 */
export async function grantMembershipComp(args: {
  professionalId: string
  planKey: Exclude<PlanKey, 'free'>
  months: number
  note: string | null
  grantedByUserId: string
  now?: Date
}): Promise<CompGrantResult> {
  const now = args.now ?? new Date()

  return prisma.$transaction(async (tx) => {
    const existing = await tx.professionalSubscription.upsert({
      where: { professionalId: args.professionalId },
      create: { professionalId: args.professionalId },
      update: {},
      select: {
        planKey: true,
        status: true,
        compUntil: true,
      },
    })

    const base =
      existing.compUntil && existing.compUntil.getTime() > now.getTime()
        ? existing.compUntil
        : now
    const compUntil = addUtcMonths(base, args.months)

    await tx.professionalSubscription.update({
      where: { professionalId: args.professionalId },
      data: {
        compPlanKey: args.planKey,
        compUntil,
        compNote: args.note,
        compGrantedByUserId: args.grantedByUserId,
      },
    })

    const grantsCustomHandle = resolveEffectiveEntitlements(
      {
        planKey: existing.planKey,
        status: existing.status,
        compPlanKey: args.planKey,
        compUntil,
      },
      now,
    ).includes('custom_handle')

    await applyCustomHandleBackfill(tx, {
      professionalId: args.professionalId,
      grantsCustomHandle,
    })

    return {
      professionalId: args.professionalId,
      compPlanKey: args.planKey,
      compUntil,
    }
  })
}

/** Remove a comp immediately; entitlements fall back to the paid state. */
export async function revokeMembershipComp(args: {
  professionalId: string
  now?: Date
}): Promise<{ professionalId: string; hadComp: boolean }> {
  const now = args.now ?? new Date()

  return prisma.$transaction(async (tx) => {
    const existing = await tx.professionalSubscription.findUnique({
      where: { professionalId: args.professionalId },
      select: { planKey: true, status: true, compPlanKey: true },
    })

    if (!existing) {
      return { professionalId: args.professionalId, hadComp: false }
    }

    await tx.professionalSubscription.update({
      where: { professionalId: args.professionalId },
      data: {
        compPlanKey: null,
        compUntil: null,
        compNote: null,
        compGrantedByUserId: null,
      },
    })

    const grantsCustomHandle = resolveEffectiveEntitlements(
      { planKey: existing.planKey, status: existing.status },
      now,
    ).includes('custom_handle')

    await applyCustomHandleBackfill(tx, {
      professionalId: args.professionalId,
      grantsCustomHandle,
    })

    return {
      professionalId: args.professionalId,
      hadComp: existing.compPlanKey != null,
    }
  })
}

/**
 * Clear expired comps and recompute the isPremium backfill for each affected
 * pro. Entitlement reads already ignore an expired comp, so the only real work
 * here is the backfill; the sweep just keeps rows tidy.
 */
export async function runMembershipCompExpiry(
  now: Date,
): Promise<{ expired: number }> {
  const expired = await prisma.professionalSubscription.findMany({
    where: { compPlanKey: { not: null }, compUntil: { lte: now } },
    select: { professionalId: true, planKey: true, status: true },
    take: 200,
  })

  for (const row of expired) {
    await prisma.$transaction(async (tx) => {
      await tx.professionalSubscription.update({
        where: { professionalId: row.professionalId },
        data: {
          compPlanKey: null,
          compUntil: null,
          compNote: null,
          compGrantedByUserId: null,
        },
      })

      const grantsCustomHandle = resolveEffectiveEntitlements(
        { planKey: row.planKey, status: row.status },
        now,
      ).includes('custom_handle')

      await applyCustomHandleBackfill(tx, {
        professionalId: row.professionalId,
        grantsCustomHandle,
      })
    })
  }

  return { expired: expired.length }
}
