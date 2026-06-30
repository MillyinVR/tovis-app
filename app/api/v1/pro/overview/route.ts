// GET /api/v1/pro/overview — the native pro Overview / dashboard (web
// /pro/dashboard parity). Returns the same monthly analytics view-model the page
// renders via the shared `loadProOverviewPage`, so this and the page never drift.
// `?month=YYYY-MM` selects a month (defaults to the current month).
import { jsonFail, jsonOk } from '@/app/api/_utils'
import { requirePro } from '@/app/api/_utils/auth/requirePro'
import { loadProOverviewPage } from '@/lib/analytics/proMonthlyAnalytics'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(req: Request) {
  try {
    const auth = await requirePro()
    if (!auth.ok) return auth.res

    const month = new URL(req.url).searchParams.get('month') ?? undefined

    const overview = await loadProOverviewPage({
      professionalId: auth.professionalId,
      professionalTimeZone: auth.user.professionalProfile?.timeZone,
      searchParams: month ? { month } : undefined,
      now: new Date(),
    })

    return jsonOk(overview)
  } catch (error) {
    console.error('GET /api/v1/pro/overview error', error)
    return jsonFail(500, 'Internal server error')
  }
}
