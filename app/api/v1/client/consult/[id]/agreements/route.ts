import { jsonFail, jsonOk, requireClient } from '@/app/api/_utils'
import {
  resolveRouteParams,
  type RouteContext,
} from '@/app/api/_utils/routeContext'
import {
  consultNotFoundResponse,
  consultWriteErrorResponse,
} from '@/lib/consult/apiErrors'
import {
  findOwnedPilotConsult,
  loadConsultAgreementState,
} from '@/lib/consult/agreementContract'
import type { ConsultAgreementStateResponseDTO } from '@/lib/dto/consult'
import { safeError } from '@/lib/security/logging'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(_req: Request, ctx: RouteContext) {
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

    const agreementState = await loadConsultAgreementState(session.id)
    return jsonOk<ConsultAgreementStateResponseDTO>({ agreementState })
  } catch (error: unknown) {
    const response = consultWriteErrorResponse(error)
    if (response) return response
    console.error('GET /api/v1/client/consult/[id]/agreements error', {
      error: safeError(error),
    })
    return jsonFail(500, 'Internal server error')
  }
}
