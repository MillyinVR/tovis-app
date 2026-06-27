// app/api/v1/client/looks/[id]/route.ts
//
// Per-look visibility toggle for client-authored looks (Public on profile vs
// Save-to-profile-only). Client mirror of PATCH /api/v1/pro/looks/[id].

import { jsonFail, jsonOk, pickString, requireClient } from '@/app/api/_utils'
import {
  resolveRouteParams,
  type RouteContext,
} from '@/app/api/_utils/routeContext'
import { isRecord } from '@/lib/guards'
import {
  ClientLookError,
  updateClientLookVisibility,
} from '@/lib/looks/publication/clientLookService'
import { prisma } from '@/lib/prisma'
import { safeError } from '@/lib/security/logging'

export const dynamic = 'force-dynamic'

export async function PATCH(req: Request, ctx: RouteContext) {
  try {
    const auth = await requireClient()
    if (!auth.ok) return auth.res

    const { id: rawId } = await resolveRouteParams(ctx)
    const lookPostId = pickString(rawId)
    if (!lookPostId) return jsonFail(400, 'Missing look id.')

    const body: unknown = await req.json().catch(() => null)
    if (!isRecord(body) || typeof body.isPublic !== 'boolean') {
      return jsonFail(400, 'isPublic (boolean) is required.')
    }

    const result = await updateClientLookVisibility(prisma, {
      clientId: auth.clientId,
      lookPostId,
      isPublic: body.isPublic,
    })

    return jsonOk({ ok: true, look: result }, 200)
  } catch (error: unknown) {
    if (error instanceof ClientLookError) {
      return jsonFail(error.httpStatus, error.message)
    }
    console.error('PATCH /api/v1/client/looks/[id] error', { error: safeError(error) })
    return jsonFail(500, 'Internal server error.')
  }
}
