// app/api/pro/membership/portal/route.ts
//
// Opens a Stripe Billing Portal session so a pro can manage / cancel / update payment
// for their membership. Requires an existing Billing customer (i.e. they've subscribed).

import { jsonFail, jsonOk, requirePro } from '@/app/api/_utils'
import { getProSubscription } from '@/lib/membership/subscription'
import { getStripe } from '@/lib/stripe/server'
import { membershipPortalReturnUrl } from '@/lib/membership/urls'

export const dynamic = 'force-dynamic'

export async function POST() {
  try {
    const auth = await requirePro()
    if (!auth.ok) return auth.res

    const sub = await getProSubscription(auth.professionalId)
    if (!sub?.stripeCustomerId) {
      return jsonFail(400, 'No membership billing account yet. Upgrade first.')
    }

    const stripe = getStripe()
    const session = await stripe.billingPortal.sessions.create({
      customer: sub.stripeCustomerId,
      return_url: membershipPortalReturnUrl(),
    })

    return jsonOk({ ok: true, url: session.url }, 200)
  } catch (e: unknown) {
    console.error('POST /api/pro/membership/portal error', e)
    return jsonFail(500, 'Failed to open the billing portal.', {
      message: e instanceof Error ? e.message : String(e),
    })
  }
}
