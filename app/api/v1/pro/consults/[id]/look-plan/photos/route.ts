import { jsonFail, jsonOk, requirePro } from '@/app/api/_utils'
import { resolveRouteParams, type RouteContext } from '@/app/api/_utils/routeContext'
import { consultWriteErrorResponse } from '@/lib/consult/apiErrors'
import { loadProLookBriefPhotos } from '@/lib/consult/lookBriefPhotos'
export const dynamic = 'force-dynamic'
export async function GET(_request: Request, context: RouteContext) {
  const auth = await requirePro()
  if (!auth.ok) return auth.res
  const { id } = await resolveRouteParams(context)
  if (!id) return jsonFail(404, 'Consultation not found.')
  try {
    return jsonOk(await loadProLookBriefPhotos({ consultSessionId: id, professionalId: auth.professionalId, actorUserId: auth.user.id }),
      { headers: { 'Cache-Control': 'private, no-store' } })
  } catch (error) {
    return consultWriteErrorResponse(error) ?? jsonFail(503, 'Consultation photos are temporarily unavailable.')
  }
}
