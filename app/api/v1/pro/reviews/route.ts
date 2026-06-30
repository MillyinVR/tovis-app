// GET /api/v1/pro/reviews — the native pro reviews list (web /pro/reviews
// parity). Returns the 100 most recent reviews with rating / headline / body /
// client / date and render-safe before/after media tiles, via the shared loader.
import { jsonFail, jsonOk } from '@/app/api/_utils'
import { requirePro } from '@/app/api/_utils/auth/requirePro'
import { loadProReviewsList } from '@/lib/pro/loadProReviewsList'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET() {
  try {
    const auth = await requirePro()
    if (!auth.ok) return auth.res

    const items = await loadProReviewsList({
      professionalId: auth.professionalId,
      viewer: auth.user,
    })

    return jsonOk({ items })
  } catch (error) {
    console.error('GET /api/v1/pro/reviews error', error)
    return jsonFail(500, 'Internal server error')
  }
}
