// app/api/v1/pro/capabilities/route.ts
//
// GET — which flag-held pro features are live on this deployment.
//
// 🔴 Deliberately NOT flag-gated. Every other surface of these features 404s
// while its flag is off; this one has to answer in exactly that case, because
// its whole job is to let a native client hide the entry point instead of
// walking the pro into a dead end. Auth-gated (PRO) so the flag state isn't a
// public readout.
import { jsonFail, jsonOk, requirePro } from '@/app/api/_utils'
import type { ProCapabilitiesResponseDTO } from '@/lib/dto/proCapabilities'
import { resolveProCapabilities } from '@/lib/proCapabilities/resolve'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const auth = await requirePro()
    if (!auth.ok) return auth.res

    const response: ProCapabilitiesResponseDTO = {
      capabilities: resolveProCapabilities(),
    }
    return jsonOk(response)
  } catch (error: unknown) {
    console.error('GET /api/v1/pro/capabilities error', error)
    return jsonFail(500, 'Failed to load capabilities.')
  }
}
