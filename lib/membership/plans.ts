// lib/membership/plans.ts
//
// Membership plan catalog (pricing + Stripe Billing price ids). Entitlements for each
// plan live in lib/pro/entitlements.ts; this is purely the commercial side. Stripe
// price ids come from env so test/live use different Billing objects.

import type { PlanKey } from '@/lib/pro/entitlements'

/** First month free on Pro (a trial on top of the permanent free tier). */
export const PRO_TRIAL_DAYS = 30

export type MembershipPlan = {
  key: PlanKey
  name: string
  priceCents: number
  interval: 'month' | null
  /** Stripe recurring Price id; null for free / when unconfigured. */
  stripePriceId: string | null
  trialDays: number
  blurb: string
}

export function getMembershipPlans(): MembershipPlan[] {
  return [
    {
      key: 'free',
      name: 'Free',
      priceCents: 0,
      interval: null,
      stripePriceId: null,
      trialDays: 0,
      blurb: 'Take bookings, get paid, and accept any payment method.',
    },
    {
      key: 'pro',
      name: 'Pro',
      priceCents: 2900,
      interval: 'month',
      stripePriceId: process.env.STRIPE_PRO_MONTHLY_PRICE_ID ?? null,
      trialDays: PRO_TRIAL_DAYS,
      blurb:
        'Custom handle, quarterly tax export, advanced analytics, and priority in Discovery.',
    },
  ]
}

export function getMembershipPlan(key: string): MembershipPlan | null {
  return getMembershipPlans().find((plan) => plan.key === key) ?? null
}

/** A paid plan that is fully configured for Stripe Checkout. */
export function getPurchasablePlan(key: string): MembershipPlan | null {
  const plan = getMembershipPlan(key)
  if (!plan || plan.key === 'free' || !plan.stripePriceId) return null
  return plan
}
