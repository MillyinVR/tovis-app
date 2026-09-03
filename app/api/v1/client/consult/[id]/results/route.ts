import { jsonOk, requireClient } from '@/app/api/_utils'
import { getBrandForTenantContext } from '@/lib/brand/forTenant'
import { resolveTenantContextForRequest } from '@/lib/tenant'
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

export async function GET(request: Request, context: RouteContext) {
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
    // The heading is brand copy, resolved for the tenant this request is
    // served under — the same source the web results page reads it from.
    const copy = getBrandForTenantContext(
      await resolveTenantContextForRequest(request),
    ).clientConsultResults
    return jsonOk<ConsultClientResultsResponseDTO>({
      results: { ...results, directionsTitle: copy.recommendationsTitle },
    })
  } catch (error: unknown) {
    return clientConsultResultsErrorResponse(error)
  }
}
