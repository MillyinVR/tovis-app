import { requirePro } from '@/app/api/_utils'
import { acknowledgeLookRequest } from '@/app/api/_utils/consultLookBrief'
import type { RouteContext } from '@/app/api/_utils/routeContext'
export const dynamic = 'force-dynamic'
export async function POST(request: Request, context: RouteContext) {
  const auth = await requirePro()
  if (!auth.ok) return auth.res
  return acknowledgeLookRequest(request, context, { professionalId: auth.professionalId, actorUserId: auth.user.id })
}
