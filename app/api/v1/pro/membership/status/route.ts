// app/api/v1/pro/membership/status/route.ts
//
// Current membership for the authed pro: effective plan, entitlements, and renewal
// info. A pro with no subscription row is reported as the free plan.

import { jsonFail, jsonOk, requirePro } from '@/app/api/_utils'
import {
  effectivePlanKey,
  resolveEntitlements,
} from '@/lib/pro/entitlements'
import { getProSubscription } from '@/lib/membership/subscription'
import { safeError } from '@/lib/security/logging'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const auth = await requirePro()
    if (!auth.ok) return auth.res

    const sub = await getProSubscription(auth.professionalId)
    const planKey = sub?.planKey ?? 'free'
    const status = sub?.status ?? null

    return jsonOk(
      {
        ok: true,
        membership: {
          planKey: effectivePlanKey({ planKey, status }),
          rawPlanKey: planKey,
          status,
          entitlements: resolveEntitlements({ planKey, status }),
          currentPeriodEnd: sub?.currentPeriodEnd?.toISOString() ?? null,
          cancelAtPeriodEnd: sub?.cancelAtPeriodEnd ?? false,
          trialEndsAt: sub?.trialEndsAt?.toISOString() ?? null,
          hasBillingAccount: Boolean(sub?.stripeCustomerId),
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
