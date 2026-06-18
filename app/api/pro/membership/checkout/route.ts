// app/api/pro/membership/checkout/route.ts
//
// Starts a Stripe Billing Checkout (mode: subscription) for a pro upgrading to a paid
// plan. This is the pro paying the platform — a platform-account charge, NOT a Connect
// destination charge. First month is free via the plan's trial.

import { jsonFail, jsonOk, requirePro } from '@/app/api/_utils'
import { isRecord } from '@/lib/guards'
import { getPurchasablePrice } from '@/lib/membership/plans'
import { ensureBillingCustomer } from '@/lib/membership/subscription'
import { getStripe } from '@/lib/stripe/server'
import { membershipReturnUrl } from '@/lib/membership/urls'

export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  try {
    const auth = await requirePro()
    if (!auth.ok) return auth.res

    const body = await req.json().catch(() => ({}) as Record<string, unknown>)
    const planKey =
      isRecord(body) && typeof body.planKey === 'string' ? body.planKey.trim() : ''
    const interval =
      isRecord(body) && typeof body.interval === 'string' ? body.interval.trim() : 'month'

    const purchasable = getPurchasablePrice(planKey, interval)
    if (!purchasable) {
      return jsonFail(400, 'That membership plan is not available for checkout.')
    }
    const { plan, price } = purchasable

    const customerId = await ensureBillingCustomer({
      professionalId: auth.professionalId,
      email: auth.user.email,
    })

    const stripe = getStripe()
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      customer: customerId,
      line_items: [{ price: price.stripePriceId, quantity: 1 }],
      subscription_data: {
        ...(plan.trialDays > 0 ? { trial_period_days: plan.trialDays } : {}),
        metadata: {
          professionalId: auth.professionalId,
          planKey: plan.key,
          interval: price.interval,
          kind: 'TOVIS_MEMBERSHIP',
        },
      },
      success_url: membershipReturnUrl('success'),
      cancel_url: membershipReturnUrl('cancelled'),
      metadata: {
        professionalId: auth.professionalId,
        planKey: plan.key,
        kind: 'TOVIS_MEMBERSHIP',
      },
    })

    return jsonOk({ ok: true, url: session.url, sessionId: session.id }, 200)
  } catch (e: unknown) {
    console.error('POST /api/pro/membership/checkout error', e)
    return jsonFail(500, 'Failed to start membership checkout.', {
      message: e instanceof Error ? e.message : String(e),
    })
  }
}
