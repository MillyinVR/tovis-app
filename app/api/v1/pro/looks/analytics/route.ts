// GET /api/v1/pro/looks/analytics — the native "Your Looks performance" surface
// (web pro-dashboard C1 parity). Per-look engagement + follower growth + top
// looks for the authed pro, via the shared creator-analytics loader.
import { jsonFail, jsonOk } from '@/app/api/_utils'
import { requirePro } from '@/app/api/_utils/auth/requirePro'
import { loadCreatorLooksAnalytics } from '@/lib/looks/creatorAnalytics'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET() {
  try {
    const auth = await requirePro()
    if (!auth.ok) return auth.res

    const analytics = await loadCreatorLooksAnalytics({
      professionalId: auth.professionalId,
      now: new Date(),
    })

    return jsonOk({ analytics })
  } catch (error) {
    console.error('GET /api/v1/pro/looks/analytics error', error)
    return jsonFail(500, 'Internal server error')
  }
}
