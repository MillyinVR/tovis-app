import { jsonFail, jsonOk, requirePro } from '@/app/api/_utils'
import {
  resolveRouteParams,
  type RouteContext,
} from '@/app/api/_utils/routeContext'
import {
  loadAuthorizedProConsultBriefs,
  ProConsultBriefError,
} from '@/lib/consult/proBrief'
import { proConsultBriefErrorResponse } from '@/lib/consult/proBriefApi'
import { pickString } from '@/lib/pick'

export const dynamic = 'force-dynamic'

export async function GET(_request: Request, context: RouteContext) {
  const auth = await requirePro()
  if (!auth.ok) return auth.res

  const params = await resolveRouteParams(context)
  const bookingId = pickString(params.id)
  if (!bookingId) {
    return jsonFail(400, 'Invalid consult brief request.', {
      code: 'CONSULT_BRIEF_INVALID_REQUEST',
    })
  }

  try {
    const briefs = await loadAuthorizedProConsultBriefs({
      professionalId: auth.professionalId,
      bookingId,
    })
    const brief = briefs[0]
    if (!brief) {
      return proConsultBriefErrorResponse(new ProConsultBriefError('NOT_FOUND'))
    }
    return jsonOk({ brief })
  } catch (error: unknown) {
    return proConsultBriefErrorResponse(error)
  }
}
