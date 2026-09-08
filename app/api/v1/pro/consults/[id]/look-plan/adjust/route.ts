import { enforceProLookRateLimit } from '@/app/api/_utils/consultLookBrief'
import { jsonFail, jsonOk, requirePro } from '@/app/api/_utils'
import { resolveRouteParams, type RouteContext } from '@/app/api/_utils/routeContext'
import { isRecord } from '@/lib/guards'
import { exactKeys } from '@/lib/consult/analysisValidation'
import { adjustProfessionalConsultLook } from '@/lib/consult/lookBrief'
import { parseConsultLookAdjustments } from '@/lib/consult/lookAdjustments'
import { ConsultWriteError } from '@/lib/consult/errors'
export const dynamic = 'force-dynamic'
export async function POST(request: Request, context: RouteContext) {
  const auth = await requirePro()
  if (!auth.ok) return auth.res
  const limited = await enforceProLookRateLimit(request, auth.professionalId, auth.user.id)
  if (limited) return limited
  const { id } = await resolveRouteParams(context)
  let body: unknown
  try { body = await request.json() } catch { return jsonFail(400, 'Invalid look adjustment.') }
  if (!id || !isRecord(body) || !exactKeys(body, ['expectedVersion','idempotencyKey','adjustments']) ||
    typeof body.expectedVersion !== 'number' || typeof body.idempotencyKey !== 'string' || !Array.isArray(body.adjustments)) return jsonFail(400, 'Invalid look adjustment.')
  try {
    // Professional identity is server-owned, never accepted from the request.
    const adjustments = parseConsultLookAdjustments(body.adjustments.map(entry => {
      if (!isRecord(entry) || Object.hasOwn(entry, 'professionalId')) throw new ConsultWriteError('INVALID_REQUEST', 'Invalid look adjustment.')
      return { ...entry, professionalId: auth.professionalId }
    }))
    return jsonOk({ lookBrief: await adjustProfessionalConsultLook({ consultSessionId: id, professionalId: auth.professionalId,
      actorUserId: auth.user.id, expectedVersion: body.expectedVersion, idempotencyKey: body.idempotencyKey, adjustments }) })
  } catch (error) {
    if (error instanceof ConsultWriteError) return jsonFail(error.code === 'NOT_FOUND' ? 404 : error.code === 'INVALID_REQUEST' ? 400 : 409, error.message, { code: error.code })
    throw error
  }
}
