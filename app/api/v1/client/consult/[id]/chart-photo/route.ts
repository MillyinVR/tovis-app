import { requireClient } from '@/app/api/_utils/auth/requireClient'
import { readJsonRecord } from '@/app/api/_utils/readJsonRecord'
import { resolveRouteParams, type RouteContext } from '@/app/api/_utils/routeContext'
import { jsonOk, jsonFail } from '@/app/api/_utils'
import { confirmClientChartPhoto } from '@/lib/consult/chartPhoto'
import { consultWriteErrorResponse, consultNotFoundResponse } from '@/lib/consult/apiErrors'
import { loadConsultCaptureState } from '@/lib/consult/captureContract'
import { safeError } from '@/lib/security/logging'
import { enforceRateLimit, rateLimitIdentity } from '@/app/api/_utils/rateLimit'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 60
export async function POST(req: Request, ctx: RouteContext) {
  try {
    const auth = await requireClient()
    if (!auth.ok) return auth.res
    const { id } = await resolveRouteParams(ctx)
    if (!id) return consultNotFoundResponse()
    const limited = await enforceRateLimit({ bucket: 'client:consult:write', identity: await rateLimitIdentity(auth.user.id) })
    if (limited) return limited
    const body = await readJsonRecord(req)
    if (typeof body.mediaAssetId !== 'string' || typeof body.idempotencyKey !== 'string') return jsonFail(400, 'Invalid photo confirmation.')
    await confirmClientChartPhoto({ consultSessionId: id, clientId: auth.clientId, actorUserId: auth.user.id,
      mediaAssetId: body.mediaAssetId, idempotencyKey: body.idempotencyKey })
    return jsonOk({ capture: await loadConsultCaptureState({ consultSessionId: id, clientId: auth.clientId, actorUserId: auth.user.id }) })
  } catch (error) {
    const response = consultWriteErrorResponse(error)
    if (response) return response
    console.error('Chart photo failed', { error: safeError(error) })
    return jsonFail(500, 'Chart photo unavailable.')
  }
}
