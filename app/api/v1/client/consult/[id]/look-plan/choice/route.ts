import { jsonFail, jsonOk, requireClient } from '@/app/api/_utils'
import { resolveRouteParams, type RouteContext } from '@/app/api/_utils/routeContext'
import { isRecord } from '@/lib/guards'
import { exactKeys } from '@/lib/consult/analysisValidation'
import { chooseClientConsultLookPath } from '@/lib/consult/lookBrief'
import { ConsultWriteError } from '@/lib/consult/errors'
import { ConsultProposalEntryError } from '@/lib/consult/proposalEntry'
import { enforceRateLimit } from '@/lib/rateLimit/enforce'
import { clientRateLimitKey } from '@/lib/rateLimit/identity'
import { rateLimitExceededResponse } from '@/lib/rateLimit/response'

export const dynamic = 'force-dynamic'

export async function POST(request: Request, context: RouteContext) {
  const auth = await requireClient()
  if (!auth.ok) return auth.res
  const { id } = await resolveRouteParams(context)
  if (!id) return jsonFail(404, 'Consultation not found.')
  const limit = await enforceRateLimit({ bucket: 'client:consult:write',
    key: clientRateLimitKey({ clientId: auth.clientId, userId: auth.user.id, request }) })
  if (!limit.allowed) return rateLimitExceededResponse(limit)
  let body: unknown
  try { body = await request.json() } catch { return jsonFail(400, 'Invalid look choice.') }
  if (!isRecord(body) || !exactKeys(body, ['expectedVersion', 'pathIndex', 'locationType', 'idempotencyKey']) ||
    typeof body.expectedVersion !== 'number' || typeof body.pathIndex !== 'number' || typeof body.idempotencyKey !== 'string' ||
    (body.locationType !== 'SALON' && body.locationType !== 'MOBILE')) return jsonFail(400, 'Invalid look choice.')
  try {
    const lookBrief = await chooseClientConsultLookPath({ consultSessionId: id, clientId: auth.clientId,
      actorUserId: auth.user.id, expectedVersion: body.expectedVersion, pathIndex: body.pathIndex,
      locationType: body.locationType, idempotencyKey: body.idempotencyKey })
    return jsonOk({ lookBrief })
  } catch (error) {
    if (error instanceof ConsultProposalEntryError) return jsonFail(404, 'Consultation not found.')
    if (error instanceof ConsultWriteError) return jsonFail(409, error.message, { code: error.code })
    return jsonFail(503, 'Your look could not be saved. Please try again.')
  }
}
