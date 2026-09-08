import { requireClient } from '@/app/api/_utils/auth/requireClient'
import { readJsonRecord } from '@/app/api/_utils/readJsonRecord'
import { resolveRouteParams, type RouteContext } from '@/app/api/_utils/routeContext'
import { jsonOk, jsonFail } from '@/app/api/_utils'
import { answerConsultChartReview } from '@/lib/consult/chartReviewContract'
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
    if (typeof body.fingerprint !== 'string' || typeof body.idempotencyKey !== 'string' ||
      !['CONFIRMED', 'BOX_DYE_ONLY', 'CHANGED'].includes(String(body.decision))) return jsonFail(400, 'Invalid chart review.')
    const result = await answerConsultChartReview({ consultSessionId: id, actorUserId: auth.user.id,
      fingerprint: body.fingerprint, idempotencyKey: body.idempotencyKey,
      decision: body.decision === 'CONFIRMED' ? 'CONFIRMED' : body.decision === 'BOX_DYE_ONLY' ? 'BOX_DYE_ONLY' : 'CHANGED' })
    return jsonOk({ intake: await loadConsultIntakeState({ consultSessionId: id, clientId: auth.clientId }), replayed: result.replayed })
  } catch (error) {
    const response = consultWriteErrorResponse(error)
    if (response) return response
    console.error('Chart review failed', { error: safeError(error) })
    return jsonFail(500, 'Chart review unavailable.')
  }
}
