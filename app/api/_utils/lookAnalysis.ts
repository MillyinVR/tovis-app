import { enforceRateLimit } from '@/lib/rateLimit/enforce'
import { proRateLimitKey } from '@/lib/rateLimit/identity'
import { rateLimitExceededResponse } from '@/lib/rateLimit/response'
import { AdminPermissionRole, Role } from '@prisma/client'
import { jsonFail, jsonOk, requirePro } from '@/app/api/_utils'
import { requireUser } from './auth/requireUser'
import { requireAdminPermission } from './auth/requireAdminPermission'
import { kickNotificationDrain } from '@/lib/notifications/delivery/kickNotificationDrain'
import { LookAnalysisError, listLookAnalyses, mutateLookAnalysis, parseLookReview, readReviewFrame, type LookReviewScope } from '@/lib/looks/analysis/review'
import { resolveRouteParams, type RouteContext } from './routeContext'

const headers = { 'Cache-Control': 'private, no-store' }
async function authorize(admin: boolean): Promise<LookReviewScope | Response> {
  if (!admin) {
    const auth = await requirePro()
    return auth.ok ? { actorUserId: auth.user.id, professionalId: auth.professionalId, admin } : auth.res
  }
  const auth = await requireUser({ roles: [Role.ADMIN] })
  if (!auth.ok) return auth.res
  const permission = await requireAdminPermission({ adminUserId: auth.user.id, allowedRoles: [AdminPermissionRole.SUPER_ADMIN] })
  return permission.ok ? { actorUserId: auth.user.id, professionalId: null, admin } : permission.res
}
function failure(error: unknown): Response {
  return error instanceof LookAnalysisError ? jsonFail(error.status, error.message) : jsonFail(500, 'Look review unavailable')
}
export async function lookAnalysisList(admin: boolean) {
  try {
    const scope = await authorize(admin)
    if (scope instanceof Response) return scope
    return jsonOk({ items: await listLookAnalyses(scope) }, { headers })
  } catch (error) { return failure(error) }
}
export async function lookAnalysisMutation(request: Request, context: RouteContext, admin: boolean) {
  try {
    const scope = await authorize(admin)
    if (scope instanceof Response) return scope
    const limited = await enforceRateLimit({ bucket: 'pro:media:write', key: proRateLimitKey({ professionalId: scope.professionalId, userId: scope.actorUserId, request }) })
    if (!limited.allowed) return rateLimitExceededResponse(limited)
    const { id } = await resolveRouteParams(context)
    if (!id) return jsonFail(404, 'Not found')
    if (Number(request.headers.get('content-length')) > 16_384) return jsonFail(413, 'Review too large')
    const text = await request.text()
    if (text.length > 16_384) return jsonFail(413, 'Review too large')
    let raw: unknown
    try { raw = JSON.parse(text) } catch { return jsonFail(400, 'Invalid review') }
    await mutateLookAnalysis(scope, id, parseLookReview(raw))
    kickNotificationDrain()
    return jsonOk({}, { headers })
  } catch (error) { return failure(error) }
}
export async function lookAnalysisFrame(context: RouteContext<{ id: string; frame: string }>, admin: boolean) {
  try {
    const scope = await authorize(admin)
    if (scope instanceof Response) return scope
    const { id, frame } = await resolveRouteParams(context)
    if (!id || typeof frame !== 'string' || !/^[0-2]$/.test(frame)) return jsonFail(404, 'Not found')
    const bytes = await readReviewFrame(scope, id, Number(frame))
    return new Response(new Uint8Array(bytes), { headers: { ...headers, 'Content-Type': 'image/jpeg', 'X-Content-Type-Options': 'nosniff' } })
  } catch (error) { return failure(error) }
}
