import { ConsultActorType } from '@prisma/client'

import {
  jsonFail,
  jsonOk,
  pickNonEmptyString,
  requireClient,
} from '@/app/api/_utils'
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
  attachConsultCaptureUpload,
  loadConsultCaptureState,
} from '@/lib/consult/captureContract'
import { ConsultWriteError } from '@/lib/consult/errors'
import type { ConsultCaptureAttachResponseDTO } from '@/lib/dto/consult'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 60

function integer(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) ? value : null
}
async function readInput(req: Request) {
  const body = await readJsonRecord(req)
  const idempotencyKey = pickNonEmptyString(body.idempotencyKey)
  const uploadSessionId = pickNonEmptyString(body.uploadSessionId)
  const shotKey = pickNonEmptyString(body.shotKey)
  const shotPackVersion = integer(body.shotPackVersion)
  const schemaVersion = integer(body.schemaVersion)
  if (
    !idempotencyKey ||
    !uploadSessionId ||
    !shotKey ||
    shotPackVersion === null ||
    schemaVersion === null
  ) {
    throw new ConsultWriteError('INVALID_REQUEST', 'Invalid request.')
  }
  return {
    idempotencyKey,
    uploadSessionId,
    shotKey,
    shotPackVersion,
    schemaVersion,
  }
}

export async function POST(req: Request, ctx: RouteContext) {
  try {
    const auth = await requireClient()
    if (!auth.ok) return auth.res
    const { id } = await resolveRouteParams(ctx)
    if (!id) return consultNotFoundResponse()

    const result = await attachConsultCaptureUpload({
      consultSessionId: id,
      clientId: auth.clientId,
      actor: { type: ConsultActorType.CLIENT, id: auth.user.id },
      loadInput: () => readInput(req),
    })
    const capture = await loadConsultCaptureState({
      consultSessionId: id,
      clientId: auth.clientId,
      actorUserId: auth.user.id,
    })
    return jsonOk<ConsultCaptureAttachResponseDTO>({
      capture,
      captureId: result.captureId,
      replayed: result.replayed,
    })
  } catch (error: unknown) {
    const response = consultWriteErrorResponse(error)
    if (response) return response
    console.error('POST consult capture attach error', {
      name: error instanceof Error ? error.name : 'UnknownError',
    })
    return jsonFail(500, 'Internal server error')
  }
}
