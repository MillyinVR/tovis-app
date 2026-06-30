// GET /api/v1/pro/aftercare — the native aftercare list (web /pro/aftercare
// parity). Returns the derived cards (Draft / Sent / Finished + rebook chip +
// before/after thumbs) via the shared loader, so this and the web page never
// drift.
import { jsonFail, jsonOk } from '@/app/api/_utils'
import { requirePro } from '@/app/api/_utils/auth/requirePro'
import { loadProAftercareList } from '@/lib/aftercare/loadProAftercareList'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET() {
  try {
    const auth = await requirePro()
    if (!auth.ok) return auth.res

    const items = await loadProAftercareList({
      professionalId: auth.professionalId,
      professionalTimeZone: auth.user.professionalProfile?.timeZone,
    })

    return jsonOk({ items })
  } catch (error) {
    console.error('GET /api/v1/pro/aftercare error', error)
    return jsonFail(500, 'Internal server error')
  }
}
