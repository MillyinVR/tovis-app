import { enforceRateLimit } from '@/lib/rateLimit/enforce'
import { clientRateLimitKey } from '@/lib/rateLimit/identity'
import { rateLimitExceededResponse } from '@/lib/rateLimit/response'
import { requireClient } from '@/app/api/_utils'
import { acknowledgeLookRequest } from '@/app/api/_utils/consultLookBrief'
import type { RouteContext } from '@/app/api/_utils/routeContext'
export const dynamic = 'force-dynamic'
export async function POST(request: Request, context: RouteContext) {
  const auth = await requireClient()
  if (!auth.ok) return auth.res
  const limit = await enforceRateLimit({ bucket: 'client:consult:write', key: clientRateLimitKey({ clientId: auth.clientId, userId: auth.user.id, request }) })
  if (!limit.allowed) return rateLimitExceededResponse(limit)
  return acknowledgeLookRequest(request, context, { clientId: auth.clientId, actorUserId: auth.user.id })
}
