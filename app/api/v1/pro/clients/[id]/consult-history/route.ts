import { jsonFail, jsonOk, requirePro } from '@/app/api/_utils'
import {
  resolveRouteParams,
  type RouteContext,
} from '@/app/api/_utils/routeContext'
import { loadAuthorizedProConsultBriefs } from '@/lib/consult/proBrief'
import { proConsultBriefErrorResponse } from '@/lib/consult/proBriefApi'
import { pickString } from '@/lib/pick'

export const dynamic = 'force-dynamic'

export async function GET(_request: Request, context: RouteContext) {
  const auth = await requirePro()
  if (!auth.ok) return auth.res

  const params = await resolveRouteParams(context)
  const clientId = pickString(params.id)
  if (!clientId) {
    return jsonFail(400, 'Invalid consult brief request.', {
      code: 'CONSULT_BRIEF_INVALID_REQUEST',
    })
  }

  try {
    const briefs = await loadAuthorizedProConsultBriefs({
      professionalId: auth.professionalId,
      clientId,
    })
    return jsonOk({ briefs })
  } catch (error: unknown) {
    return proConsultBriefErrorResponse(error)
  }
}
