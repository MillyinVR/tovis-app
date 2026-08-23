import { ConsultActorType } from '@prisma/client'

import {
  jsonFail,
  jsonOk,
  pickNonEmptyString,
  requireClient,
} from '@/app/api/_utils'
import { enforceRateLimit, rateLimitIdentity } from '@/app/api/_utils/rateLimit'
import { readJsonRecord } from '@/app/api/_utils/readJsonRecord'
import {
  resolveRouteParams,
  type RouteContext,
} from '@/app/api/_utils/routeContext'
import {
  consultNotFoundResponse,
  consultWriteErrorResponse,
} from '@/lib/consult/apiErrors'
import {
  checkConsultCaptureQuality,
  loadConsultCaptureState,
} from '@/lib/consult/captureContract'
import { ConsultWriteError } from '@/lib/consult/errors'
import type { ConsultCaptureQualityResponseDTO } from '@/lib/dto/consult'
import { isTransactionSerializationError } from '@/lib/prismaErrors'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 60

type Params = { id: string; captureId: string }

function integer(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) ? value : null
}
async function readInput(req: Request) {
  const body = await readJsonRecord(req)
  const idempotencyKey = pickNonEmptyString(body.idempotencyKey)
  const shotPackVersion = integer(body.shotPackVersion)
  const schemaVersion = integer(body.schemaVersion)
  if (!idempotencyKey || shotPackVersion === null || schemaVersion === null) {
    throw new ConsultWriteError('INVALID_REQUEST', 'Invalid request.')
  }
  return { idempotencyKey, shotPackVersion, schemaVersion }
}

export async function POST(req: Request, ctx: RouteContext<Params>) {
  try {
    const auth = await requireClient()
    if (!auth.ok) return auth.res

    // Paid provider call: the vision bucket bounds per-user daily spend, and
    // the per-session structural cap inside checkConsultCaptureQuality still
    // holds if Redis is unavailable (redis-only buckets fail open).
    const limited = await enforceRateLimit({
      bucket: 'client:consult:vision',
      identity: await rateLimitIdentity(auth.user.id),
    })
    if (limited) return limited
    const { id, captureId } = await resolveRouteParams(ctx)
    if (!id || !captureId) return consultNotFoundResponse()

    const result = await checkConsultCaptureQuality({
      consultSessionId: id,
      captureId,
      clientId: auth.clientId,
      actor: { type: ConsultActorType.CLIENT, id: auth.user.id },
      loadInput: () => readInput(req),
    })
    const capture = await loadConsultCaptureState({
      consultSessionId: id,
      clientId: auth.clientId,
      actorUserId: auth.user.id,
    })
    return jsonOk<ConsultCaptureQualityResponseDTO>({
      quality: result.quality,
      capture,
      replayed: result.replayed,
    })
  } catch (error: unknown) {
    const response = consultWriteErrorResponse(error)
    if (response) return response
    if (isTransactionSerializationError(error)) {
      const conflictResponse = consultWriteErrorResponse(
        new ConsultWriteError('INVALID_STATE', 'Consult state changed.'),
      )
      if (conflictResponse) return conflictResponse
    }
    console.error('POST consult capture quality error', {
      name: error instanceof Error ? error.name : 'UnknownError',
    })
    return jsonFail(500, 'Internal server error')
  }
}
