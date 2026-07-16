// GET /api/v1/pro/visibility — the pro-side transparency read (spec §6.5,
// "why aren't I showing up"). Native parity for the "Your visibility" section
// on web /pro/dashboard: both call the same loadProVisibilityHealth, so the
// page and the native screen can never drift.
import { jsonFail, jsonOk } from '@/app/api/_utils'
import { requirePro } from '@/app/api/_utils/auth/requirePro'
import {
  loadProVisibilityHealth,
  type ProVisibilityHealthDTO,
} from '@/lib/pro/visibilityHealth'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET() {
  try {
    const auth = await requirePro()
    if (!auth.ok) return auth.res

    const visibility: ProVisibilityHealthDTO = await loadProVisibilityHealth({
      professionalId: auth.professionalId,
      now: new Date(),
    })

    return jsonOk({ visibility }, 200)
  } catch (error) {
    console.error('GET /api/v1/pro/visibility error', error)
    return jsonFail(500, 'Internal server error')
  }
}
