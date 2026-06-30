// GET /api/v1/pro/last-minute/workspace — the native "last minute" workspace
// (web /pro/last-minute parity): the LastMinuteSettings (enabled, priority offer,
// tiers, per-day disables) with its service rules + blocks, plus the active
// offerings. Returned via the shared loader so this and the page never drift.
import { jsonFail, jsonOk } from '@/app/api/_utils'
import { requirePro } from '@/app/api/_utils/auth/requirePro'
import { loadLastMinuteWorkspace } from '@/lib/pro/loadLastMinuteWorkspace'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET() {
  try {
    const auth = await requirePro()
    if (!auth.ok) return auth.res

    const workspace = await loadLastMinuteWorkspace({
      professionalId: auth.professionalId,
      professionalTimeZone: auth.user.professionalProfile?.timeZone,
    })

    return jsonOk(workspace)
  } catch (error) {
    console.error('GET /api/v1/pro/last-minute/workspace error', error)
    return jsonFail(500, 'Internal server error')
  }
}
