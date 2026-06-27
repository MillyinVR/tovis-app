// app/api/v1/me/route.ts
import { requireClient } from '@/app/api/_utils/auth/requireClient'
import { jsonFail, jsonOk } from '@/app/api/_utils/responses'
import { safeError } from '@/lib/security/logging'
import { loadClientMePage } from '@/app/client/(gated)/me/_data/loadClientMePage'
import { serializeClientMePageData } from '@/lib/dto/clientMe'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    // Gate with the JSON auth helper first so a non-client gets a 401/403 JSON
    // response instead of the loader's page-level redirect(). Once confirmed, the
    // loader's own internal auth re-resolves the same client and succeeds.
    const auth = await requireClient()
    if (!auth.ok) return auth.res

    const data = await loadClientMePage()

    return jsonOk({ me: serializeClientMePageData(data) }, 200)
  } catch (error: unknown) {
    console.error('GET /api/v1/me error', { error: safeError(error) })
    return jsonFail(500, 'Failed to load client me.')
  }
}
