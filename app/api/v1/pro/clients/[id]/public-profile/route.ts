// app/api/v1/pro/clients/[id]/public-profile/route.ts
//
// Read API for a client's PUBLIC creator profile — handle · avatar · bio ·
// follower/following/looks counts · published-looks grid — keyed by clientId.
// Backs the pro client chart's "public profile" view toggle: the web
// `/pro/clients/[id]?view=public` branch renders the exact same
// `loadPublicClientProfileByClientId` data through `PublicProfileView`. The pro
// views it as a neutral read-only viewer (web passes `followMode="hidden"`), so
// no viewer options are passed here — `viewer.isOwn`/`following` are always
// false. Returns `profile: null` (NOT a 404) when the client hasn't opted into a
// public profile, mirroring the web page's "No public profile yet" empty state
// rather than an error. PRO-only, per-client visibility-gated.
import { jsonFail, jsonOk, pickString, requirePro } from '@/app/api/_utils'
import {
  resolveRouteParams,
  type RouteContext,
} from '@/app/api/_utils/routeContext'
import { assertProCanViewClient } from '@/lib/clientVisibility'
import { loadPublicClientProfileByClientId } from '@/app/u/[handle]/_data/loadPublicClientProfile'

export const dynamic = 'force-dynamic'

export async function GET(_req: Request, ctx: RouteContext) {
  try {
    const auth = await requirePro()
    if (!auth.ok) return auth.res
    const proId = auth.professionalId

    const params = await resolveRouteParams(ctx)
    const clientId = pickString(params?.id)
    if (!clientId) return jsonFail(400, 'Missing client id.')

    // Don't reveal existence to a pro who can't currently view this client.
    const gate = await assertProCanViewClient(proId, clientId)
    if (!gate.ok) return jsonFail(404, 'Client not found.')

    // No viewer options: the pro is a neutral read-only viewer (follow hidden),
    // matching the web page's `followMode="hidden"`. `null` when the client has
    // no public profile / handle → native renders the empty state, not an error.
    // PublicClientProfileData is already JSON-safe (strings / numbers / null).
    const profile = await loadPublicClientProfileByClientId(clientId)

    return jsonOk({ profile })
  } catch (e) {
    console.error('GET /api/v1/pro/clients/[id]/public-profile error:', e)
    return jsonFail(500, 'Failed to load the public profile.')
  }
}
