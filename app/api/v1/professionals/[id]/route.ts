// app/api/v1/professionals/[id]/route.ts
import { jsonFail, jsonOk } from '@/app/api/_utils/responses'
import { resolveRouteParams, type RouteContext } from '@/app/api/_utils/routeContext'
import { getCurrentUser } from '@/lib/currentUser'
import { safeError } from '@/lib/security/logging'
import { loadProPublicProfile } from '@/app/professionals/[id]/_data/loadProPublicProfile'

export const dynamic = 'force-dynamic'

export async function GET(_req: Request, ctx: RouteContext<{ id: string }>) {
  try {
    const { id } = await resolveRouteParams(ctx)
    if (!id) return jsonFail(404, 'Professional not found.')

    // Optional viewer context: a PRO owner can see their own pending surface, a
    // CLIENT viewer gets favorite + helpful-review state. Everyone else: guest.
    const viewer = await getCurrentUser().catch(() => null)
    const viewerContext =
      viewer
        ? {
            id: viewer.id,
            role: viewer.role,
            professionalProfile: viewer.professionalProfile
              ? { id: viewer.professionalProfile.id }
              : null,
          }
        : null

    // Returns null when the profile is missing OR not viewable (pending
    // verification) — both collapse to a uniform 404, matching the page's
    // notFound() / pending gate (no leak of which case it is).
    const profile = await loadProPublicProfile({
      professionalId: id,
      viewer: viewerContext,
    })

    if (!profile) {
      return jsonFail(404, 'Professional not found.')
    }

    // The publicProfileMappers already convert Decimal -> string and Date -> ISO.
    return jsonOk({ professional: profile }, 200)
  } catch (error: unknown) {
    console.error('GET /api/v1/professionals/[id] error', {
      error: safeError(error),
    })
    return jsonFail(500, 'Failed to load professional.')
  }
}
