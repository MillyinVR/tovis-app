// app/api/v1/u/[handle]/boards/[slug]/route.ts
import { Role } from '@prisma/client'

import { jsonFail, jsonOk } from '@/app/api/_utils/responses'
import { resolveRouteParams, type RouteContext } from '@/app/api/_utils/routeContext'
import { getCurrentUser } from '@/lib/currentUser'
import { loadPublicBoard } from '@/lib/boards/publicBoard'
import { safeError } from '@/lib/security/logging'

export const dynamic = 'force-dynamic'

export async function GET(
  _req: Request,
  ctx: RouteContext<{ handle: string; slug: string }>,
) {
  try {
    const { handle, slug } = await resolveRouteParams(ctx)

    // Mirror the public board page's viewer resolution: only a signed-in CLIENT
    // carries a viewerClientId (drives viewer.isOwn / followingOwner). Everyone
    // else — guests, pros, admins — views as a guest.
    const viewer = await getCurrentUser().catch(() => null)
    const viewerClientId =
      viewer && viewer.role === Role.CLIENT
        ? (viewer.clientProfile?.id ?? null)
        : null

    // PublicBoardData is already JSON-safe (strings / booleans / null; media URLs
    // are pre-rendered) so it's returned as-is.
    const board = await loadPublicBoard(handle, slug, { viewerClientId })
    if (!board) {
      // A private / hidden / non-existent board is indistinguishable — no
      // enumeration, matching the page's notFound().
      return jsonFail(404, 'Board not found.')
    }

    return jsonOk({ board }, 200)
  } catch (error: unknown) {
    console.error('GET /api/v1/u/[handle]/boards/[slug] error', {
      error: safeError(error),
    })
    return jsonFail(500, 'Failed to load board.')
  }
}
