import { enforceRateLimit } from '@/lib/rateLimit/enforce'
import { proRateLimitKey } from '@/lib/rateLimit/identity'
import { rateLimitExceededResponse } from '@/lib/rateLimit/response'
import { jsonFail, jsonOk } from '@/app/api/_utils'
import { resolveRouteParams, type RouteContext } from './routeContext'
import { acknowledgeConsultLookBrief } from '@/lib/consult/lookBrief'
import { ConsultWriteError } from '@/lib/consult/errors'
import { ConsultProposalEntryError } from '@/lib/consult/proposalEntry'
import { isRecord } from '@/lib/guards'
import { exactKeys } from '@/lib/consult/analysisValidation'

export async function acknowledgeLookRequest(request: Request, context: RouteContext,
  actor: { actorUserId: string } & ({ clientId: string; professionalId?: never } | { professionalId: string; clientId?: never })) {
  if (actor.professionalId !== undefined) {
    const limited = await enforceProLookRateLimit(request, actor.professionalId, actor.actorUserId)
    if (limited) return limited
  }
  const { id } = await resolveRouteParams(context)
  let body: unknown
  try { body = await request.json() } catch { return jsonFail(400, 'Invalid look confirmation.') }
  if (!id || !isRecord(body) || !exactKeys(body, ['expectedVersion']) || typeof body.expectedVersion !== 'number') {
    return jsonFail(400, 'Invalid look confirmation.')
  }
  try {
    return jsonOk({ lookBrief: await acknowledgeConsultLookBrief({ ...actor, consultSessionId: id, expectedVersion: body.expectedVersion }) })
  } catch (error) {
    if (error instanceof ConsultProposalEntryError || (error instanceof ConsultWriteError && error.code === 'NOT_FOUND')) return jsonFail(404, 'Consultation not found.')
    if (error instanceof ConsultWriteError) return jsonFail(409, error.message, { code: error.code })
    throw error
  }
}

export async function enforceProLookRateLimit(request: Request, professionalId: string, userId: string) {
  const result = await enforceRateLimit({ bucket: 'pro:bookings:write', key: proRateLimitKey({ professionalId, userId, request }) })
  return result.allowed ? null : rateLimitExceededResponse(result)
}
