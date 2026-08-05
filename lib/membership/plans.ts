// lib/membership/plans.ts
//
// Membership plan catalog (pricing + Stripe Billing price ids). Entitlements for each
// plan live in lib/pro/entitlements.ts; this is purely the commercial side. Stripe
// price ids come from env so test/live use different Billing objects.
//
// 🔴 `amountCents` here is DISPLAY ONLY. Checkout sends `line_items: [{ price:
// stripePriceId }]` (app/api/v1/pro/membership/checkout/route.ts:43), so Stripe
// charges whatever its Price object says. If the two disagree, the pro is shown one
// number and billed another — silently, with no error anywhere. Any change to an
// amount below REQUIRES the matching Stripe Price object to be checked by hand.
//
// PRICE DECISION (2026-08-04, docs/design/membership-value-brief.md §7.1 option A):
// Pro $25/mo · $240/yr, Premium $45/mo · $432/yr. This supersedes the 2026-06-17
// spec's $29 recommendation, which the brief re-examined against the 2026 competitor
// set and explicitly advised against changing ("the $4 delta is noise next to fixing
// the entitlements"). The code was already $25; the spec is the side that moved.
// Tori must still confirm the live Stripe Price objects match — see the Stripe
// checklist in membership-value-brief.md §10.

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

/**
 * How a plan is acquired.
 * - `free`     — nothing to buy.
 * - `self-serve` — Stripe Checkout, priced on the card.
 * - `contact`  — an enterprise tier: shown, but no price and no buy button. It is
 *   granted by an admin comp after a conversation, never bought in the product.
 */
export type MembershipAcquisition = 'free' | 'self-serve' | 'contact'

export type MembershipPlan = {
  key: PlanKey
  name: string
  blurb: string
  trialDays: number
  acquisition: MembershipAcquisition
  /** Monthly AI-camera image allowance (from the entitlement matrix). */
  cameraImagesPerMonth: number
  /** Billing options; empty for free and contact-only plans. */
  prices: MembershipPrice[]
}

export function getMembershipPlans(): MembershipPlan[] {
  return [
    {
      key: 'free',
      name: 'Free',
      blurb: 'Take bookings, get paid, and accept any payment method.',
      trialDays: 0,
      acquisition: 'free',
      cameraImagesPerMonth: CAMERA_IMAGES_PER_MONTH.free,
      prices: [],
    },
    {
      key: 'pro',
      name: 'Pro',
      // 🔴 The discovery-fee waiver was REMOVED from this blurb (Tori, 2026-08-04):
      // as coded it waives the CLIENT's fee, which is not the intended perk. The
      // intended perk waives a PRO-side fee that does not exist yet (§8.5). Do not
      // re-add it until that fee ships and has been measured.
      blurb:
        'Custom handle, tax exports + receipt inbox, retention insights, and priority in Discovery.',
      trialDays: PRO_TRIAL_DAYS,
      acquisition: 'self-serve',
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
      // Do NOT re-add "group bookings join here when they ship" — naming an
      // unshipped feature on a paid card is the same mis-sell class as the
      // `advanced_analytics` entitlement (membership-value-brief.md §5.1.F).
      blurb:
        'Everything in Pro plus the full AI photographer allowance — for a busy chair or a two-chair studio.',
      trialDays: PRO_TRIAL_DAYS,
      acquisition: 'self-serve',
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
    // Studio — an ENTERPRISE card (Tori, 2026-08-04, brief §8.6). Visible so salons
    // know the tier exists, but with no price and no buy button: it is granted by
    // admin comp after a conversation.
    //
    // 🔴 Copy is limited to what is true today. It must NOT list white-label or any
    // other unbuilt feature — that is the same mis-sell this whole change removed,
    // and white-label specifically has no implementation anywhere.
    //
    // 🔴 Product rule for the future build: salon-only, and a salon must have a
    // minimum number of pros before it may purchase (threshold TBD). That is why
    // there is no self-serve path here and why adding one needs a salon entity and
    // a seat-count gate first.
    {
      key: 'studio',
      name: 'Studio',
      blurb: 'For salons and teams — custom setup, billed by arrangement.',
      trialDays: 0,
      acquisition: 'contact',
      cameraImagesPerMonth: CAMERA_IMAGES_PER_MONTH.studio,
      prices: [],
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
 * contact-only tiers, unknown plans/intervals, or an unconfigured price id.
 *
 * 🔴 The `acquisition` refusal is deliberate belt-and-braces. Studio has no prices,
 * so it would already fall through — but Studio is comp-granted and salon-gated, and
 * "nobody configured a price id" is a weak reason for that to stay true. This makes
 * the refusal the RULE rather than a side effect of an empty array, so a stray env
 * var can never turn an enterprise tier into a self-serve checkout.
 */
export function getPurchasablePrice(
  planKey: string,
  interval: string,
): { plan: MembershipPlan; price: MembershipPrice & { stripePriceId: string } } | null {
  const plan = getMembershipPlan(planKey)
  if (!plan || plan.acquisition !== 'self-serve') return null

  const normalizedInterval: BillingInterval = interval === 'year' ? 'year' : 'month'
  const price = plan.prices.find((p) => p.interval === normalizedInterval)
  if (!price || !price.stripePriceId) return null

  return { plan, price: { ...price, stripePriceId: price.stripePriceId } }
}
