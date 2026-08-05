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
//
// 🔴 The gate is CONTACT, not CHART. It was `assertProCanViewClient` — the full
// chart assert — and that is the wrong tier for this resource twice over:
//
//   1. What it protects is a WORLD-READABLE page. /u/[handle] renders for a
//      signed-out stranger. The only thing this route adds is the clientId →
//      handle correlation, which the CONTACT tier already exceeds: that tier is
//      defined as "may see who this client IS — display name and avatar".
//      Gating a public page behind the private chart is the same mistake W5
//      called out on messaging ("gating those on the chart assert would trap the
//      pro in the opposite failure").
//   2. Refusing it broke the pro app in a way that read as a deploy problem.
//      iOS treats a 404 here as "route not shipped yet" and falls back to
//      "This client's public profile is viewable on the web for now." So a pro
//      past their 30-day chart window — the single most likely caller — was told
//      the feature didn't exist, about a page they could open in a browser.
//
// A pro with NO relationship is still refused, and still without confirming the
// id exists. That is the part that was load-bearing.
import { jsonFail, jsonOk, pickString, requirePro } from '@/app/api/_utils'
import {
  resolveRouteParams,
  type RouteContext,
} from '@/app/api/_utils/routeContext'
import { assertProCanContactClient } from '@/lib/clientVisibility'
import { chartRefusal } from '@/lib/clients/chartAccessCopy'
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

    // Don't reveal existence to a pro with no relationship to this client. The
    // CONTACT tier is enough (see the header note) — the chart tier is not
    // required to read a page the whole internet can read.
    const gate = await assertProCanContactClient(proId, clientId)
    if (!gate.ok) {
      // canContactClient is false here, so chartRefusal returns the flat
      // "Client not found." / NO_CLIENT_RELATIONSHIP copy — which is the right
      // answer for a stranger and never names the client.
      const refusal = chartRefusal(gate.visibility, 404)
      return jsonFail(refusal.status, refusal.message, { code: refusal.code })
    }

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
