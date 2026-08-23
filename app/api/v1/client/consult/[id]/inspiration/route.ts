import { ConsultActorType } from '@prisma/client'

import { jsonFail, jsonOk, pickNonEmptyString, requireClient } from '@/app/api/_utils'
import { enforceRateLimit, rateLimitIdentity } from '@/app/api/_utils/rateLimit'
import { readJsonRecord } from '@/app/api/_utils/readJsonRecord'
import { resolveRouteParams, type RouteContext } from '@/app/api/_utils/routeContext'
import { consultNotFoundResponse, consultWriteErrorResponse } from '@/lib/consult/apiErrors'
import {
  chooseConsultInspirationLook,
  loadConsultInspirationState,
  removeConsultInspiration,
  skipConsultInspiration,
} from '@/lib/consult/inspirationContract'
import { ConsultWriteError } from '@/lib/consult/errors'
import type {
  ConsultInspirationDeleteResponseDTO,
  ConsultInspirationMutationResponseDTO,
  ConsultInspirationStateResponseDTO,
} from '@/lib/dto/consult'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const integer = (value: unknown) =>
  typeof value === 'number' && Number.isInteger(value) ? value : null
const fail = (error: unknown, method: string) => {
  const known = consultWriteErrorResponse(error)
  if (known) return known
  console.error(`${method} consult inspiration error`, {
    name: error instanceof Error ? error.name : 'UnknownError',
  })
  return jsonFail(500, 'Internal server error')
}

export async function GET(_request: Request, context: RouteContext) {
  try {
    const auth = await requireClient()
    if (!auth.ok) return auth.res
    const { id } = await resolveRouteParams(context)
    if (!id) return consultNotFoundResponse()
    const inspiration = await loadConsultInspirationState({
      consultSessionId: id,
      clientId: auth.clientId,
      actorUserId: auth.user.id,
    })
    return jsonOk<ConsultInspirationStateResponseDTO>({ inspiration })
  } catch (error) {
    return fail(error, 'GET')
  }
}

export async function POST(request: Request, context: RouteContext) {
  try {
    const auth = await requireClient()
    if (!auth.ok) return auth.res
    const { id } = await resolveRouteParams(context)
    if (!id) return consultNotFoundResponse()
    const limited = await enforceRateLimit({
      bucket: 'client:consult:write',
      identity: await rateLimitIdentity(auth.user.id),
    })
    if (limited) return limited
    const body = await readJsonRecord(request)
    const idempotencyKey = pickNonEmptyString(body.idempotencyKey)
    const schemaVersion = integer(body.schemaVersion)
    if (!idempotencyKey || schemaVersion === null) {
      throw new ConsultWriteError('INVALID_REQUEST', 'Invalid request.')
    }
    const common = {
      consultSessionId: id,
      clientId: auth.clientId,
      actor: { type: ConsultActorType.CLIENT, id: auth.user.id },
    }
    const lookSource =
      body.source === 'PLATFORM_LOOK' || body.source === 'BOOKED_PRO_LOOK'
        ? body.source
        : null
    let result
    if (body.source === 'NONE') {
      result = await skipConsultInspiration({
        ...common,
        input: { idempotencyKey, schemaVersion },
      })
    } else {
      if (!lookSource) {
        throw new ConsultWriteError('INVALID_REQUEST', 'Invalid request.')
      }
      result = await chooseConsultInspirationLook({
        ...common,
        input: {
          idempotencyKey,
          schemaVersion,
          source: lookSource,
          lookPostId: pickNonEmptyString(body.lookPostId) ?? '',
        },
      })
    }
    return jsonOk<ConsultInspirationMutationResponseDTO>({
      inspiration: result.state,
      replayed: result.replayed,
    })
  } catch (error) {
    return fail(error, 'POST')
  }
}

export async function DELETE(_request: Request, context: RouteContext) {
  try {
    const auth = await requireClient()
    if (!auth.ok) return auth.res
    const { id } = await resolveRouteParams(context)
    if (!id) return consultNotFoundResponse()
    const limited = await enforceRateLimit({
      bucket: 'client:consult:write',
      identity: await rateLimitIdentity(auth.user.id),
    })
    if (limited) return limited
    await removeConsultInspiration({
      consultSessionId: id,
      clientId: auth.clientId,
      actor: { type: ConsultActorType.CLIENT, id: auth.user.id },
    })
    return jsonOk<ConsultInspirationDeleteResponseDTO>({ deleted: true })
  } catch (error) {
    return fail(error, 'DELETE')
  }
}
