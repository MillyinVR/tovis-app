// app/api/v1/pro/clients/[id]/chart-share/route.ts
//
// W5 — the pro's side of chart consent: see where the request stands, and ask.
//
// 🔴 Gated on `assertProCanContactClient`, NOT `assertProCanViewClient`. Asking
// to see a chart is precisely the thing a pro does when they cannot see it, so
// gating this on chart access would make the button unusable exactly when it is
// needed. Contact tier is still a real gate — a pro with no thread and no
// booking has no relationship to this client and cannot ask at all.

import { jsonFail, jsonOk, pickString, requirePro } from '@/app/api/_utils'
import {
  resolveRouteParams,
  type RouteContext,
} from '@/app/api/_utils/routeContext'
import { assertProCanContactClient } from '@/lib/clientVisibility'
import { loadChartShare, requestChartShare } from '@/lib/clients/chartShare'

export const dynamic = 'force-dynamic'

const REQUEST_REFUSAL_MESSAGES: Record<string, string> = {
  ALREADY_GRANTED: 'This client already shares their chart with you.',
  REQUEST_PENDING: 'You already have a request waiting with this client.',
  DECLINED: 'This client declined to share their chart.',
}

export async function GET(_req: Request, context: RouteContext) {
  try {
    const auth = await requirePro()
    if (!auth.ok) return auth.res
    const professionalId = auth.professionalId

    const { id } = await resolveRouteParams(context)
    const clientId = pickString(id)
    if (!clientId) return jsonFail(400, 'Missing client id.')

    const gate = await assertProCanContactClient(professionalId, clientId)
    if (!gate.ok) return jsonFail(403, 'Forbidden.')

    const share = await loadChartShare({ clientId, professionalId })

    return jsonOk(
      {
        chartShare: {
          status: share.status,
          requestedAt: share.requestedAt?.toISOString() ?? null,
          respondedAt: share.respondedAt?.toISOString() ?? null,
          revokedAt: share.revokedAt?.toISOString() ?? null,
          // Why the pro can (or cannot) see the chart right now, so the UI never
          // has to re-derive the policy.
          canViewChart: gate.visibility.canViewClient,
          visibilityReason: gate.visibility.reason,
        },
      },
      200,
    )
  } catch (error) {
    console.error('GET /api/v1/pro/clients/[id]/chart-share error', error)
    return jsonFail(500, 'Failed to load chart share.')
  }
}

export async function POST(_req: Request, context: RouteContext) {
  try {
    const auth = await requirePro()
    if (!auth.ok) return auth.res
    const professionalId = auth.professionalId

    const { id } = await resolveRouteParams(context)
    const clientId = pickString(id)
    if (!clientId) return jsonFail(400, 'Missing client id.')

    const gate = await assertProCanContactClient(professionalId, clientId)
    if (!gate.ok) return jsonFail(403, 'Forbidden.')

    const result = await requestChartShare({ clientId, professionalId })

    if (!result.ok) {
      // 409, not 400: the request is well-formed, the pair is just already in a
      // state that has an answer. One open ask at a time, and a "no" stays no.
      return jsonFail(
        409,
        REQUEST_REFUSAL_MESSAGES[result.code] ?? 'Cannot request access.',
        { code: result.code },
      )
    }

    return jsonOk({ chartShare: { status: result.status } }, 201)
  } catch (error) {
    console.error('POST /api/v1/pro/clients/[id]/chart-share error', error)
    return jsonFail(500, 'Failed to request chart access.')
  }
}
