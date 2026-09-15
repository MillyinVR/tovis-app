// app/api/v1/pro/viral-requests/route.ts
//
// The approved viral looks this pro was matched to.
//
// The read half the fan-out never had. `VIRAL_REQUEST_APPROVED` has been
// telling pros "a viral request matches your services" since the feature
// shipped, and the only destination it ever carried was an admin route that
// 404s (dropped in #1189). This is where that notification will point once the
// parity fixture for the new href lands.
//
// `/pro/viral-requests` renders the SAME `loadProViralRequestLibrary` output
// server-side, so the page and the phone cannot disagree about which looks a
// pro was matched to or whether they are offering one.
import { jsonFail, jsonOk, requirePro } from '@/app/api/_utils'
import {
  buildProViralRequestListDTO,
  type ProViralRequestListResponseDTO,
} from '@/lib/dto/proViralRequests'
import { loadProViralRequestLibrary } from '@/lib/viralRequests/proLibrary'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const auth = await requirePro()
    if (!auth.ok) return auth.res

    const entries = await loadProViralRequestLibrary(auth.professionalId)
    const response: ProViralRequestListResponseDTO =
      buildProViralRequestListDTO(entries)

    return jsonOk(response)
  } catch (e) {
    console.error('GET /api/v1/pro/viral-requests error', e)
    return jsonFail(500, 'Failed to load viral requests.')
  }
}
