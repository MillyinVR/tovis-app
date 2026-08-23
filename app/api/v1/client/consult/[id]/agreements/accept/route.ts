import { ConsultActorType, ConsultAgreementKind } from '@prisma/client'

import { jsonFail, jsonOk, pickString, requireClient } from '@/app/api/_utils'
import { enforceRateLimit, rateLimitIdentity } from '@/app/api/_utils/rateLimit'
import { readJsonRecord } from '@/app/api/_utils/readJsonRecord'
import {
  resolveRouteParams,
  type RouteContext,
} from '@/app/api/_utils/routeContext'
import {
  consultAgreementFail,
  consultNotFoundResponse,
  consultWriteErrorResponse,
} from '@/lib/consult/apiErrors'
import {
  findOwnedPilotConsult,
  loadConsultAgreementState,
} from '@/lib/consult/agreementContract'
import { acceptConsultAgreement } from '@/lib/consult/writeBoundary'
import type { ConsultAgreementAcceptResponseDTO } from '@/lib/dto/consult'
import { safeError } from '@/lib/security/logging'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

function parseAgreementKind(value: unknown): ConsultAgreementKind | null {
  if (value === ConsultAgreementKind.SENSITIVE_DATA_CONSENT) return value
  if (value === ConsultAgreementKind.ADULT_18_PLUS_ATTESTATION) return value
  return null
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

    const session = await findOwnedPilotConsult({
      consultSessionId: id,
      clientId: auth.clientId,
    })
    if (!session) return consultNotFoundResponse()

    const body = await readJsonRecord(req)
    const agreementVersionId = pickString(body.agreementVersionId)
    const kind = parseAgreementKind(body.kind)
    if (!agreementVersionId || !kind) {
      return consultAgreementFail(
        400,
        'Invalid request.',
        'CONSULT_INVALID_REQUEST',
      )
    }

    const result = await acceptConsultAgreement({
      consultSessionId: session.id,
      agreementVersionId,
      expectedKind: kind,
      actor: { type: ConsultActorType.CLIENT, id: auth.user.id },
    })
    const agreementState = await loadConsultAgreementState(session.id)
    return jsonOk<ConsultAgreementAcceptResponseDTO>({
      agreementState,
      replayed: result.replayed,
    })
  } catch (error: unknown) {
    const response = consultWriteErrorResponse(error)
    if (response) return response
    console.error('POST /api/v1/client/consult/[id]/agreements/accept error', {
      error: safeError(error),
    })
    return jsonFail(500, 'Internal server error')
  }
}
