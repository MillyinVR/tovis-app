import { requirePro, jsonOk, jsonFail } from '@/app/api/_utils'
import { resolveRouteParams, type RouteContext } from '@/app/api/_utils/routeContext'
import { loadProConsultTranscript } from '@/lib/consult/proTranscript'
import { ConsultWriteError } from '@/lib/consult/errors'

export const dynamic = 'force-dynamic'
export async function GET(request: Request, context: RouteContext) {
  const auth = await requirePro()
  if (!auth.ok) return auth.res
  const { id } = await resolveRouteParams(context)
  if (!id) return jsonFail(404, 'Consultation not found.')
  try {
    const transcript = await loadProConsultTranscript({ consultSessionId: id,
      professionalId: auth.professionalId, actorUserId: auth.user.id,
      cursor: new URL(request.url).searchParams.get('cursor') })
    const response = jsonOk({ transcript })
    response.headers.set('Cache-Control', 'private, no-store')
    return response
  } catch (error) {
    if (error instanceof ConsultWriteError) return error.code === 'INVALID_REQUEST'
      ? jsonFail(400, 'Invalid consultation history request.') : jsonFail(404, 'Consultation not found.')
    return jsonFail(500, 'Consultation history is unavailable.')
  }
}
