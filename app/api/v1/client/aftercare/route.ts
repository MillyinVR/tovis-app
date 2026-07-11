// app/api/v1/client/aftercare/route.ts
//
// GET /api/v1/client/aftercare — the native counterpart to the web
// /client/aftercare inbox page. Both load through the shared
// loadClientAftercareInbox SSOT so the list can't drift between platforms.
import { jsonFail, jsonOk } from '@/app/api/_utils'
import { requireClient } from '@/app/api/_utils/auth/requireClient'
import { loadClientAftercareInbox } from '@/lib/aftercare/loadClientAftercareInbox'
import type { ClientAftercareInboxDTO } from '@/lib/dto/clientAftercareInbox'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const auth = await requireClient()
    if (!auth.ok) return auth.res

    const items = await loadClientAftercareInbox(auth.clientId)

    const payload: ClientAftercareInboxDTO = { items }
    return jsonOk(payload, 200)
  } catch (err: unknown) {
    console.error('GET /api/v1/client/aftercare error', err)
    const message = err instanceof Error ? err.message : 'Internal server error'
    return jsonFail(500, message)
  }
}
