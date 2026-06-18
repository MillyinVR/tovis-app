// app/pro/membership/page.tsx
import { Role } from '@prisma/client'
import { redirect } from 'next/navigation'

import { getCurrentUser } from '@/lib/currentUser'
import {
  effectivePlanKey,
  resolveEntitlements,
} from '@/lib/pro/entitlements'
import { getProSubscription } from '@/lib/membership/subscription'
import { getMembershipPlans } from '@/lib/membership/plans'
import MembershipClient from './MembershipClient'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const MEMBERSHIP_PATH = '/pro/membership'
const LOGIN_PATH = `/login?from=${encodeURIComponent(MEMBERSHIP_PATH)}`

export default async function ProMembershipPage() {
  const user = await getCurrentUser().catch(() => null)
  const professionalProfile =
    user?.role === Role.PRO ? user.professionalProfile : null

  if (!professionalProfile) {
    redirect(LOGIN_PATH)
  }

  const sub = await getProSubscription(professionalProfile.id)
  const planKey = sub?.planKey ?? 'free'
  const status = sub?.status ?? null

  return (
    <MembershipClient
      currentPlanKey={effectivePlanKey({ planKey, status })}
      status={status}
      entitlements={resolveEntitlements({ planKey, status })}
      currentPeriodEnd={sub?.currentPeriodEnd?.toISOString() ?? null}
      cancelAtPeriodEnd={sub?.cancelAtPeriodEnd ?? false}
      trialEndsAt={sub?.trialEndsAt?.toISOString() ?? null}
      hasBillingAccount={Boolean(sub?.stripeCustomerId)}
      plans={getMembershipPlans().map((p) => ({
        key: p.key,
        name: p.name,
        blurb: p.blurb,
        trialDays: p.trialDays,
        prices: p.prices.map((price) => ({
          interval: price.interval,
          amountCents: price.amountCents,
          perMonthCents: price.perMonthCents,
          purchasable: Boolean(price.stripePriceId),
        })),
      }))}
    />
  )
}
