// app/api/v1/pro/membership/status/route.ts
//
// Current membership for the authed pro: effective plan, entitlements, and renewal
// info. A pro with no subscription row is reported as the free plan.

import { jsonFail, jsonOk, requirePro } from '@/app/api/_utils'
import { resolveDiscoveryFeeCents } from '@/lib/booking/discoveryFee'
import {
  activeCompPlanKey,
  resolveEffectiveEntitlements,
  resolveEffectivePlanKey,
} from '@/lib/pro/entitlements'
import { getProSubscription } from '@/lib/membership/subscription'
import { safeError } from '@/lib/security/logging'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const auth = await requirePro()
    if (!auth.ok) return auth.res

    const sub = await getProSubscription(auth.professionalId)
    const now = new Date()
    const state = {
      planKey: sub?.planKey ?? 'free',
      status: sub?.status ?? null,
      compPlanKey: sub?.compPlanKey ?? null,
      compUntil: sub?.compUntil ?? null,
    }
    const compPlan = activeCompPlanKey(state, now)

    return jsonOk(
      {
        ok: true,
        membership: {
          planKey: resolveEffectivePlanKey(state, now),
          rawPlanKey: state.planKey,
          status: state.status,
          compPlanKey: compPlan,
          compUntil: compPlan ? (sub?.compUntil?.toISOString() ?? null) : null,
          entitlements: resolveEffectiveEntitlements(state, now),
          currentPeriodEnd: sub?.currentPeriodEnd?.toISOString() ?? null,
          cancelAtPeriodEnd: sub?.cancelAtPeriodEnd ?? false,
          trialEndsAt: sub?.trialEndsAt?.toISOString() ?? null,
          hasBillingAccount: Boolean(sub?.stripeCustomerId),
          // The live one-time discovery platform fee, in cents. Sent so the iOS
          // membership screen can state the real amount in the commission pitch
          // instead of hardcoding $5 — the fee is env-overridable up to $10
          // (lib/booking/discoveryFee.ts), and a copy line that drifts from what
          // clients are actually charged is a mis-sell of the same class this
          // change removed. Clients treat it as OPTIONAL: an older build reading a
          // server without this field simply omits the amount.
          discoveryFeeCents: resolveDiscoveryFeeCents(),
        },
      },
      200,
    )
  } catch (e: unknown) {
    console.error('GET /api/v1/pro/membership/status error', {
      error: safeError(e),
    })
    return jsonFail(500, 'Failed to load membership status.', {
      message: e instanceof Error ? e.message : String(e),
    })
  }
}
