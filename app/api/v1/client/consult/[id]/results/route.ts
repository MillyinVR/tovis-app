import { jsonOk, requireClient } from '@/app/api/_utils'
import {
  resolveRouteParams,
  type RouteContext,
} from '@/app/api/_utils/routeContext'
import {
  ClientConsultResultsError,
  loadAuthorizedClientConsultResults,
} from '@/lib/consult/clientResults'
import { clientConsultResultsErrorResponse } from '@/lib/consult/clientResultsApi'
import type { ConsultClientResultsResponseDTO } from '@/lib/dto/consult'

export const dynamic = 'force-dynamic'

export async function GET(_request: Request, context: RouteContext) {
  const auth = await requireClient()
  if (!auth.ok) return auth.res
  const { id } = await resolveRouteParams(context)
  if (!id) {
    return clientConsultResultsErrorResponse(
      new ClientConsultResultsError('NOT_FOUND'),
    )
  }

  try {
    const results = await loadAuthorizedClientConsultResults({
      consultSessionId: id,
      clientId: auth.clientId,
      actorUserId: auth.user.id,
    })
    return jsonOk<ConsultClientResultsResponseDTO>({ results })
  } catch (error: unknown) {
    return clientConsultResultsErrorResponse(error)
  }
}
