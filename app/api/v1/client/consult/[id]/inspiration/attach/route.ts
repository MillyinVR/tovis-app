import { ConsultActorType } from '@prisma/client'
import { jsonFail, jsonOk, pickNonEmptyString, requireClient } from '@/app/api/_utils'
import { enforceRateLimit, rateLimitIdentity } from '@/app/api/_utils/rateLimit'
import { readJsonRecord } from '@/app/api/_utils/readJsonRecord'
import { resolveRouteParams, type RouteContext } from '@/app/api/_utils/routeContext'
import { consultNotFoundResponse, consultWriteErrorResponse } from '@/lib/consult/apiErrors'
import { ConsultWriteError } from '@/lib/consult/errors'
import { attachConsultInspirationUpload } from '@/lib/consult/inspirationContract'
import type { ConsultInspirationMutationResponseDTO } from '@/lib/dto/consult'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export async function POST(request: Request, context: RouteContext) {
  try {
    const auth = await requireClient()
    if (!auth.ok) return auth.res
    const limited = await enforceRateLimit({
      bucket: 'client:consult:write',
      identity: await rateLimitIdentity(auth.user.id),
    })
    if (limited) return limited
    const { id } = await resolveRouteParams(context)
    if (!id) return consultNotFoundResponse()
    const body = await readJsonRecord(request)
    const idempotencyKey = pickNonEmptyString(body.idempotencyKey)
    const inspirationId = pickNonEmptyString(body.inspirationId)
    if (
      !idempotencyKey ||
      !inspirationId ||
      typeof body.schemaVersion !== 'number' ||
      !Number.isInteger(body.schemaVersion)
    ) {
      throw new ConsultWriteError('INVALID_REQUEST', 'Invalid request.')
    }
    const result = await attachConsultInspirationUpload({
      consultSessionId: id,
      clientId: auth.clientId,
      actor: { type: ConsultActorType.CLIENT, id: auth.user.id },
      input: {
        idempotencyKey,
        inspirationId,
        schemaVersion: body.schemaVersion,
      },
    })
    return jsonOk<ConsultInspirationMutationResponseDTO>({
      inspiration: result.state,
      replayed: result.replayed,
    })
  } catch (error) {
    const known = consultWriteErrorResponse(error)
    if (known) return known
    console.error('POST consult inspiration attach error', {
      name: error instanceof Error ? error.name : 'UnknownError',
    })
    return jsonFail(500, 'Internal server error')
  }
}
