import { ConsultActorType } from '@prisma/client'

import { jsonFail, jsonOk, pickString, requireClient } from '@/app/api/_utils'
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
import { revokeConsultAgreement } from '@/lib/consult/writeBoundary'
import { purgeConsultSessionRawObjects } from '@/lib/consult/capturePurge'
import type { ConsultAgreementStateResponseDTO } from '@/lib/dto/consult'
import { safeError } from '@/lib/security/logging'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function POST(req: Request, ctx: RouteContext) {
  try {
    const auth = await requireClient()
    if (!auth.ok) return auth.res

    const { id } = await resolveRouteParams(ctx)
    if (!id) return consultNotFoundResponse()

    const session = await findOwnedPilotConsult({
      consultSessionId: id,
      clientId: auth.clientId,
    })
    if (!session) return consultNotFoundResponse()

    const body = await readJsonRecord(req)
    const acceptanceId = pickString(body.acceptanceId)
    const reason = pickString(body.reason)
    if (!acceptanceId || !reason || reason.length > 500) {
      return consultAgreementFail(
        400,
        'Invalid request.',
        'CONSULT_INVALID_REQUEST',
      )
    }

    await revokeConsultAgreement({
      consultSessionId: session.id,
      acceptanceId,
      reason,
      actor: { type: ConsultActorType.CLIENT, id: auth.user.id },
    })
    // Revocation's DB trigger stamps every raw object purge-eligible in the
    // same transaction. Attempt deletion before responding; individual
    // storage failures remain retriable through the cleanup job.
    await purgeConsultSessionRawObjects(session.id)
    const agreementState = await loadConsultAgreementState(session.id)
    return jsonOk<ConsultAgreementStateResponseDTO>({ agreementState })
  } catch (error: unknown) {
    const response = consultWriteErrorResponse(error)
    if (response) return response
    console.error('POST /api/v1/client/consult/[id]/agreements/revoke error', {
      error: safeError(error),
    })
    return jsonFail(500, 'Internal server error')
  }
}
