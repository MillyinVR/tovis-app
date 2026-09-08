import { requireClient } from '@/app/api/_utils/auth/requireClient'
import { readJsonRecord } from '@/app/api/_utils/readJsonRecord'
import { resolveRouteParams, type RouteContext } from '@/app/api/_utils/routeContext'
import { jsonOk, jsonFail } from '@/app/api/_utils'
import { answerConsultChartFact } from '@/lib/consult/chartReviewContract'
import { consultWriteErrorResponse, consultNotFoundResponse } from '@/lib/consult/apiErrors'
import { loadConsultIntakeState } from '@/lib/consult/intakeContract'
import { safeError } from '@/lib/security/logging'
import { enforceRateLimit, rateLimitIdentity } from '@/app/api/_utils/rateLimit'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export async function POST(req: Request, ctx: RouteContext) {
  try {
    const auth = await requireClient()
    if (!auth.ok) return auth.res
    const { id } = await resolveRouteParams(ctx)
    if (!id) return consultNotFoundResponse()
    const limited = await enforceRateLimit({ bucket: 'client:consult:write', identity: await rateLimitIdentity(auth.user.id) })
    if (limited) return limited
    const body = await readJsonRecord(req)
    if (typeof body.sourceId !== 'string' || typeof body.questionKey !== 'string' || typeof body.value !== 'string' || typeof body.idempotencyKey !== 'string') return jsonFail(400, 'Invalid chart confirmation.')
    const result = await answerConsultChartFact({ consultSessionId: id, actorUserId: auth.user.id,
      sourceId: body.sourceId, questionKey: body.questionKey, value: body.value, idempotencyKey: body.idempotencyKey })
    return jsonOk({ intake: await loadConsultIntakeState({ consultSessionId: id, clientId: auth.clientId }), replayed: result.replayed })
  } catch (error) {
    const response = consultWriteErrorResponse(error)
    if (response) return response
    console.error('Chart review failed', { error: safeError(error) })
    return jsonFail(500, 'Chart review unavailable.')
  }
}
