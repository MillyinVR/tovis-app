// app/api/v1/client/consult/[id]/route.ts
//
// AI Consult Phase 0 lifecycle foundation. Fetches the consent-first consult
// shell the client owns. Founder-gated
// (lib/consult/access.ts) on the booking's professional, same as create —
// checked again here so toggling the pilot off also darkens reads of
// already-created sessions.
//
// A session owned by another client is treated identically to a missing one:
// both yield a uniform 404 (mirrors requireClientBookingOwnership's no-leak
// contract).

import { jsonFail, jsonOk, requireClient } from '@/app/api/_utils'
import { resolveRouteParams, type RouteContext } from '@/app/api/_utils/routeContext'
import { isAiConsultEnabledForPro } from '@/lib/consult/access'
import { toConsultSessionDTO } from '@/lib/consult/mapConsultSession'
import { prisma } from '@/lib/prisma'
import { safeError } from '@/lib/security/logging'

export const dynamic = 'force-dynamic'

export async function GET(_req: Request, ctx: RouteContext) {
  try {
    const auth = await requireClient()
    if (!auth.ok) return auth.res
    const { clientId } = auth

    const { id } = await resolveRouteParams(ctx)
    if (!id) return jsonFail(404, 'Not found.')

    const session = await prisma.consultSession.findUnique({ where: { id } })
    if (!session || session.clientId !== clientId) {
      return jsonFail(404, 'Not found.')
    }

    if (!isAiConsultEnabledForPro(session.professionalId)) {
      return jsonFail(404, 'Not found.')
    }

    return jsonOk({ consult: toConsultSessionDTO(session) })
  } catch (e: unknown) {
    console.error('GET /api/v1/client/consult/[id] error', { error: safeError(e) })
    return jsonFail(500, 'Internal server error')
  }
}
