// lib/privacy/adminMembershipDirectory.ts
//
// PII boundary for the admin memberships dashboard (SUPER_ADMIN support
// surface). Searching pros by name/email and showing a contact email is a
// legitimate admin need, but plaintext-PII reads must cross HERE — inside
// lib/privacy — so the crossing stays audited and the route/UI never touch
// raw `email`/`firstName`/`lastName` fields themselves. Output PII is limited
// to one contact email + a human display label.

import { prisma } from '@/lib/prisma'
import {
  activeCompPlanKey,
  resolveEffectivePlanKey,
} from '@/lib/pro/entitlements'
import { platformCrossTenantProVisibilityFilter } from '@/lib/tenant'

export type AdminMembershipDirectoryRow = {
  professionalId: string
  /** businessName, else the pro's personal name, else the handle. */
  displayLabel: string
  handle: string | null
  /** Account email, for admin support lookups only. */
  contactEmail: string | null
  isPremium: boolean
  effectivePlanKey: string
  paidPlanKey: string
  paidStatus: string | null
  hasStripeSubscription: boolean
  currentPeriodEnd: string | null
  cancelAtPeriodEnd: boolean
  compPlanKey: string | null
  compUntil: string | null
  compNote: string | null
}

const MAX_RESULTS = 20

export async function searchAdminMembershipDirectory(
  q: string,
  now: Date = new Date(),
): Promise<AdminMembershipDirectoryRow[]> {
  const query = q.trim()
  if (query.length < 2) return []

  const pros = await prisma.professionalProfile.findMany({
    where: {
      // Platform-operator surface: admins intentionally search across ALL
      // tenants (the explicit cross-tenant opt-out, not a discovery leak).
      ...platformCrossTenantProVisibilityFilter(),
      OR: [
        { businessName: { contains: query, mode: 'insensitive' } },
        { handle: { contains: query, mode: 'insensitive' } },
        { firstName: { contains: query, mode: 'insensitive' } },
        { lastName: { contains: query, mode: 'insensitive' } },
        { user: { email: { contains: query, mode: 'insensitive' } } },
      ],
    },
    take: MAX_RESULTS,
    orderBy: { id: 'asc' },
    select: {
      id: true,
      businessName: true,
      firstName: true,
      lastName: true,
      handle: true,
      isPremium: true,
      user: { select: { email: true } },
      subscription: {
        select: {
          planKey: true,
          status: true,
          stripeSubscriptionId: true,
          currentPeriodEnd: true,
          cancelAtPeriodEnd: true,
          compPlanKey: true,
          compUntil: true,
          compNote: true,
        },
      },
    },
  })

  return pros.map((pro) => {
    const sub = pro.subscription
    const state = {
      planKey: sub?.planKey ?? 'free',
      status: sub?.status ?? null,
      compPlanKey: sub?.compPlanKey ?? null,
      compUntil: sub?.compUntil ?? null,
    }
    const compPlan = activeCompPlanKey(state, now)
    const personalName = [pro.firstName, pro.lastName]
      .filter(Boolean)
      .join(' ')
      .trim()

    return {
      professionalId: pro.id,
      displayLabel:
        pro.businessName?.trim() || personalName || pro.handle || pro.id,
      handle: pro.handle,
      contactEmail: pro.user?.email ?? null,
      isPremium: pro.isPremium,
      effectivePlanKey: resolveEffectivePlanKey(state, now),
      paidPlanKey: state.planKey,
      paidStatus: state.status,
      hasStripeSubscription: Boolean(sub?.stripeSubscriptionId),
      currentPeriodEnd: sub?.currentPeriodEnd?.toISOString() ?? null,
      cancelAtPeriodEnd: sub?.cancelAtPeriodEnd ?? false,
      compPlanKey: compPlan,
      compUntil: compPlan ? (sub?.compUntil?.toISOString() ?? null) : null,
      compNote: compPlan ? (sub?.compNote ?? null) : null,
    }
  })
}
