// lib/membership/plans.ts
//
// Membership plan catalog (pricing + Stripe Billing price ids). Entitlements for each
// plan live in lib/pro/entitlements.ts; this is purely the commercial side. Stripe
// price ids come from env so test/live use different Billing objects.

import { CAMERA_IMAGES_PER_MONTH, type PlanKey } from '@/lib/pro/entitlements'

/** First month free on paid plans (a trial on top of the permanent free tier). */
export const PRO_TRIAL_DAYS = 30

export type BillingInterval = 'month' | 'year'

export type MembershipPrice = {
  interval: BillingInterval
  /** Amount charged per billing period, in cents. */
  amountCents: number
  /** Effective monthly cost, in cents (for "$20/mo billed annually" display). */
  perMonthCents: number
  /** Stripe recurring Price id; null when unconfigured. */
  stripePriceId: string | null
}

export type MembershipPlan = {
  key: PlanKey
  name: string
  blurb: string
  trialDays: number
  /** Monthly AI-camera image allowance (from the entitlement matrix). */
  cameraImagesPerMonth: number
  /** Billing options; empty for the free plan. */
  prices: MembershipPrice[]
}

export function getMembershipPlans(): MembershipPlan[] {
  return [
    {
      key: 'free',
      name: 'Free',
      blurb: 'Take bookings, get paid, and accept any payment method.',
      trialDays: 0,
      cameraImagesPerMonth: CAMERA_IMAGES_PER_MONTH.free,
      prices: [],
    },
    {
      key: 'pro',
      name: 'Pro',
      blurb:
        'Custom handle, tax exports + receipt inbox, priority in Discovery — and your new clients book with no discovery fee.',
      trialDays: PRO_TRIAL_DAYS,
      cameraImagesPerMonth: CAMERA_IMAGES_PER_MONTH.pro,
      prices: [
        {
          interval: 'month',
          amountCents: 2500,
          perMonthCents: 2500,
          stripePriceId: process.env.STRIPE_PRO_MONTHLY_PRICE_ID ?? null,
        },
        {
          interval: 'year',
          amountCents: 24000,
          perMonthCents: 2000,
          stripePriceId: process.env.STRIPE_PRO_ANNUAL_PRICE_ID ?? null,
        },
      ],
    },
    {
      key: 'premium',
      name: 'Premium',
      blurb:
        'Everything in Pro plus the full AI photographer allowance. Group bookings join here when they ship.',
      trialDays: PRO_TRIAL_DAYS,
      cameraImagesPerMonth: CAMERA_IMAGES_PER_MONTH.premium,
      prices: [
        {
          interval: 'month',
          amountCents: 4500,
          perMonthCents: 4500,
          stripePriceId: process.env.STRIPE_PREMIUM_MONTHLY_PRICE_ID ?? null,
        },
        {
          interval: 'year',
          amountCents: 43200,
          perMonthCents: 3600,
          stripePriceId: process.env.STRIPE_PREMIUM_ANNUAL_PRICE_ID ?? null,
        },
      ],
    },
  ]
}

export function getMembershipPlan(key: string): MembershipPlan | null {
  return getMembershipPlans().find((plan) => plan.key === key) ?? null
}

/** All Stripe price ids configured across every plan (for webhook plan resolution). */
export function configuredPriceIds(): Array<{ planKey: PlanKey; priceId: string }> {
  return getMembershipPlans().flatMap((plan) =>
    plan.prices
      .filter((p): p is MembershipPrice & { stripePriceId: string } =>
        Boolean(p.stripePriceId),
      )
      .map((p) => ({ planKey: plan.key, priceId: p.stripePriceId })),
  )
}

/**
 * Resolve a purchasable (plan, interval) → its Stripe price. Returns null for free,
 * unknown plans/intervals, or an unconfigured price id.
 */
export function getPurchasablePrice(
  planKey: string,
  interval: string,
): { plan: MembershipPlan; price: MembershipPrice & { stripePriceId: string } } | null {
  const plan = getMembershipPlan(planKey)
  if (!plan || plan.key === 'free') return null

  const normalizedInterval: BillingInterval = interval === 'year' ? 'year' : 'month'
  const price = plan.prices.find((p) => p.interval === normalizedInterval)
  if (!price || !price.stripePriceId) return null

  return { plan, price: { ...price, stripePriceId: price.stripePriceId } }
}
