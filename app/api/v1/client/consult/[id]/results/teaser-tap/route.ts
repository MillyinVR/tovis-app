import { jsonOk, requireClient } from '@/app/api/_utils'
import { enforceRateLimit, rateLimitIdentity } from '@/app/api/_utils/rateLimit'
import {
  resolveRouteParams,
  type RouteContext,
} from '@/app/api/_utils/routeContext'
import {
  ClientConsultResultsError,
  recordLockedMeCardTeaserTap,
} from '@/lib/consult/clientResults'
import { clientConsultResultsErrorResponse } from '@/lib/consult/clientResultsApi'
import type { ConsultMeCardTeaserTapResponseDTO } from '@/lib/dto/consult'

export const dynamic = 'force-dynamic'

export async function POST(_request: Request, context: RouteContext) {
  const auth = await requireClient()
  if (!auth.ok) return auth.res
  const limited = await enforceRateLimit({
    bucket: 'client:consult:write',
    identity: await rateLimitIdentity(auth.user.id),
  })
  if (limited) return limited
  const { id } = await resolveRouteParams(context)
  if (!id) {
    return clientConsultResultsErrorResponse(
      new ClientConsultResultsError('NOT_FOUND'),
    )
  }

  try {
    const result = await recordLockedMeCardTeaserTap({
      consultSessionId: id,
      clientId: auth.clientId,
      actorUserId: auth.user.id,
    })
    return jsonOk<ConsultMeCardTeaserTapResponseDTO>({
      teaser: { locked: true, tapped: true },
      replayed: result.replayed,
    })
  } catch (error: unknown) {
    return clientConsultResultsErrorResponse(error)
  }
}
