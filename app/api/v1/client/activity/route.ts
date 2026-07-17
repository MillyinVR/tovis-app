// app/api/v1/client/activity/route.ts
//
// JSON twin of the server-rendered /client/activity page — both read the same
// loader, so the native feed and the web page cannot drift.
import { requireClient } from '@/app/api/_utils/auth/requireClient'
import { jsonFail, jsonOk } from '@/app/api/_utils/responses'
import { loadClientActivityPage } from '@/app/client/(gated)/activity/_data/loadClientActivityPage'
import { serializeClientActivityFeed } from '@/lib/dto/clientActivity'
import { safeError } from '@/lib/security/logging'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    // Gate with the JSON auth helper first so a non-client gets a 401/403 JSON
    // response instead of the loader's page-level redirect() to /login. Once
    // confirmed, the loader's own internal auth re-resolves the same client and
    // succeeds.
    const auth = await requireClient()
    if (!auth.ok) return auth.res

    const data = await loadClientActivityPage()

    return jsonOk({ activity: serializeClientActivityFeed(data) }, 200)
  } catch (error: unknown) {
    console.error('GET /api/v1/client/activity error', { error: safeError(error) })
    return jsonFail(500, 'Failed to load activity.')
  }
}
