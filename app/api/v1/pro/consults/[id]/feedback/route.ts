import { jsonFail, jsonOk, requirePro } from '@/app/api/_utils'
import { readJsonRecord } from '@/app/api/_utils/readJsonRecord'
import {
  resolveRouteParams,
  type RouteContext,
} from '@/app/api/_utils/routeContext'
import { recordConsultBriefFeedback } from '@/lib/consult/proBrief'
import { proConsultBriefErrorResponse } from '@/lib/consult/proBriefApi'
import { pickString } from '@/lib/pick'

export const dynamic = 'force-dynamic'

export async function POST(request: Request, context: RouteContext) {
  const auth = await requirePro()
  if (!auth.ok) return auth.res

  const params = await resolveRouteParams(context)
  const consultSessionId = pickString(params.id)
  const body = await readJsonRecord(request)
  const rating = pickString(body.rating)
  if (
    !consultSessionId ||
    (rating !== 'ACCURATE_USEFUL' && rating !== 'OFF')
  ) {
    return jsonFail(400, 'Invalid consult brief request.', {
      code: 'CONSULT_BRIEF_INVALID_REQUEST',
    })
  }

  try {
    const result = await recordConsultBriefFeedback({
      consultSessionId,
      professionalId: auth.professionalId,
      rating,
    })
    return jsonOk(result)
  } catch (error: unknown) {
    return proConsultBriefErrorResponse(error)
  }
}
