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
import { issueConsultCaptureUpload } from '@/lib/consult/captureContract'
import { ConsultWriteError } from '@/lib/consult/errors'
import type { ConsultCaptureIssueUploadResponseDTO } from '@/lib/dto/consult'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 60

function integer(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) ? value : null
}
async function readInput(req: Request) {
  const body = await readJsonRecord(req)
  const idempotencyKey = pickNonEmptyString(body.idempotencyKey)
  const shotPackVersion = integer(body.shotPackVersion)
  const schemaVersion = integer(body.schemaVersion)
  const sizeBytes = integer(body.sizeBytes)
  if (
    !idempotencyKey ||
    !pickNonEmptyString(body.shotKey) ||
    !pickNonEmptyString(body.contentType) ||
    shotPackVersion === null ||
    schemaVersion === null ||
    sizeBytes === null
  ) {
    throw new ConsultWriteError('INVALID_REQUEST', 'Invalid request.')
  }
  const checksum = body.checksumSha256
  if (checksum != null && typeof checksum !== 'string') {
    throw new ConsultWriteError('INVALID_REQUEST', 'Invalid request.')
  }
  return {
    idempotencyKey,
    shotKey: body.shotKey,
    shotPackVersion,
    schemaVersion,
    contentType: body.contentType,
    sizeBytes,
    checksumSha256: typeof checksum === 'string' ? checksum : null,
  }
}

export async function POST(req: Request, ctx: RouteContext) {
  try {
    const auth = await requireClient()
    if (!auth.ok) return auth.res

    const limited = await enforceRateLimit({
      bucket: 'client:consult:write',
      identity: await rateLimitIdentity(auth.user.id),
    })
    if (limited) return limited
    const { id } = await resolveRouteParams(ctx)
    if (!id) return consultNotFoundResponse()

    const result = await issueConsultCaptureUpload({
      consultSessionId: id,
      clientId: auth.clientId,
      actor: { type: ConsultActorType.CLIENT, id: auth.user.id },
      loadInput: () => readInput(req),
    })
    return jsonOk<ConsultCaptureIssueUploadResponseDTO>(result)
  } catch (error: unknown) {
    const response = consultWriteErrorResponse(error)
    if (response) return response
    console.error('POST consult capture upload error', {
      name: error instanceof Error ? error.name : 'UnknownError',
    })
    return jsonFail(500, 'Internal server error')
  }
}
