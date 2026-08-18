import { ConsultActorType } from '@prisma/client'
import { jsonFail, jsonOk, pickNonEmptyString, requireClient } from '@/app/api/_utils'
import { readJsonRecord } from '@/app/api/_utils/readJsonRecord'
import { resolveRouteParams, type RouteContext } from '@/app/api/_utils/routeContext'
import { consultNotFoundResponse, consultWriteErrorResponse } from '@/lib/consult/apiErrors'
import { ConsultWriteError } from '@/lib/consult/errors'
import { issueConsultInspirationUpload } from '@/lib/consult/inspirationContract'
import type { ConsultInspirationIssueUploadResponseDTO } from '@/lib/dto/consult'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
const integer = (value: unknown) =>
  typeof value === 'number' && Number.isInteger(value) ? value : null

export async function POST(request: Request, context: RouteContext) {
  try {
    const auth = await requireClient()
    if (!auth.ok) return auth.res
    const { id } = await resolveRouteParams(context)
    if (!id) return consultNotFoundResponse()
    const body = await readJsonRecord(request)
    const idempotencyKey = pickNonEmptyString(body.idempotencyKey)
    const schemaVersion = integer(body.schemaVersion)
    const sizeBytes = integer(body.sizeBytes)
    const checksumSha256 =
      body.checksumSha256 == null
        ? null
        : pickNonEmptyString(body.checksumSha256)
    if (
      !idempotencyKey ||
      schemaVersion === null ||
      sizeBytes === null ||
      !pickNonEmptyString(body.contentType) ||
      (body.checksumSha256 != null && !checksumSha256)
    ) {
      throw new ConsultWriteError('INVALID_REQUEST', 'Invalid request.')
    }
    const result = await issueConsultInspirationUpload({
      consultSessionId: id,
      clientId: auth.clientId,
      actor: { type: ConsultActorType.CLIENT, id: auth.user.id },
      input: {
        idempotencyKey,
        schemaVersion,
        sizeBytes,
        contentType: body.contentType,
        checksumSha256,
      },
    })
    return jsonOk<ConsultInspirationIssueUploadResponseDTO>(result)
  } catch (error) {
    const known = consultWriteErrorResponse(error)
    if (known) return known
    console.error('POST consult inspiration upload error', {
      name: error instanceof Error ? error.name : 'UnknownError',
    })
    return jsonFail(500, 'Internal server error')
  }
}
