import { enforceProLookRateLimit } from '@/app/api/_utils/consultLookBrief'
import { requirePro, jsonOk, jsonFail } from '@/app/api/_utils'
import { resolveRouteParams, type RouteContext } from '@/app/api/_utils/routeContext'
import { authorProfessionalLookPlan, loadProfessionalLookPlanMenu, parseProfessionalLookPlanInput } from '@/lib/consult/professionalLookPlan'
import { consultWriteErrorResponse } from '@/lib/consult/apiErrors'
export const dynamic = 'force-dynamic'
export async function GET(_request: Request, context: RouteContext) {
  const auth = await requirePro(); if (!auth.ok) return auth.res
  const { id } = await resolveRouteParams(context); if (!id) return jsonFail(404, 'Not found.')
  try { return jsonOk({ offerings: await loadProfessionalLookPlanMenu({ consultSessionId: id, professionalId: auth.professionalId, actorUserId: auth.user.id }) }) }
  catch (error) { return consultWriteErrorResponse(error) ?? jsonFail(503, 'Menu temporarily unavailable.') }
}
export async function POST(request: Request, context: RouteContext) {
  const auth = await requirePro(); if (!auth.ok) return auth.res
  const limited = await enforceProLookRateLimit(request, auth.professionalId, auth.user.id)
  if (limited) return limited
  const { id } = await resolveRouteParams(context); if (!id) return jsonFail(404, 'Not found.')
  let raw: unknown
  try { raw = await request.json() } catch { return jsonFail(400, 'Invalid look plan.') }
  try { return jsonOk({ lookBrief: await authorProfessionalLookPlan({ consultSessionId: id, professionalId: auth.professionalId,
    actorUserId: auth.user.id, input: parseProfessionalLookPlanInput(raw) }) }) }
  catch (error) { return consultWriteErrorResponse(error) ?? jsonFail(503, 'Could not save the look plan.') }
}
