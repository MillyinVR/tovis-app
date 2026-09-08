import { requirePro, jsonOk, jsonFail } from '@/app/api/_utils'
import { resolveRouteParams, type RouteContext } from '@/app/api/_utils/routeContext'
import { loadAuthorizedProLookBrief } from '@/lib/consult/proBrief'
import { ConsultWriteError } from '@/lib/consult/errors'
export const dynamic = 'force-dynamic'
export async function GET(_request: Request, context: RouteContext) {
  const auth = await requirePro()
  if (!auth.ok) return auth.res
  const { id } = await resolveRouteParams(context)
  if (!id) return jsonFail(404, 'Consultation not found.')
  try { return jsonOk({ brief: await loadAuthorizedProLookBrief({ consultSessionId: id, professionalId: auth.professionalId, actorUserId: auth.user.id }) }) }
  catch (error) { if (error instanceof ConsultWriteError) return jsonFail(404, 'Consultation not found.'); throw error }
}
