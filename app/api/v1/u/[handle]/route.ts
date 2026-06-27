// app/api/v1/u/[handle]/route.ts
import { Role } from '@prisma/client'

import { jsonFail, jsonOk } from '@/app/api/_utils/responses'
import { resolveRouteParams, type RouteContext } from '@/app/api/_utils/routeContext'
import { getCurrentUser } from '@/lib/currentUser'
import { safeError } from '@/lib/security/logging'
import { loadPublicClientProfile } from '@/app/u/[handle]/_data/loadPublicClientProfile'

export const dynamic = 'force-dynamic'

export async function GET(_req: Request, ctx: RouteContext<{ handle: string }>) {
  try {
    const { handle } = await resolveRouteParams(ctx)

    // Mirror the page's viewer resolution: only a signed-in CLIENT carries a
    // viewerClientId (drives isOwn / following). Everyone else views as a guest.
    const viewer = await getCurrentUser().catch(() => null)
    const viewerClientId =
      viewer && viewer.role === Role.CLIENT
        ? (viewer.clientProfile?.id ?? null)
        : null

    // PublicClientProfileData is already JSON-safe (strings / numbers / null —
    // no Decimal or Date), so it's returned as-is.
    const profile = await loadPublicClientProfile(handle, { viewerClientId })
    if (!profile) {
      return jsonFail(404, 'Profile not found.')
    }

    return jsonOk({ profile }, 200)
  } catch (error: unknown) {
    console.error('GET /api/v1/u/[handle] error', { error: safeError(error) })
    return jsonFail(500, 'Failed to load profile.')
  }
}
