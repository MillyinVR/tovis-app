// app/api/v1/client/consult/look/availability/route.ts
//
// Whether the AI consult entry surface is open for a LOOK — the look-anchored
// twin of GET /api/v1/client/consult/availability?bookingId= (#1016). That
// endpoint is read by shipped iOS builds and is deliberately untouched; this
// one sits beside it with its own DTOs.
//
// Same no-leak contract: a pro outside the founder pilot, or a look the caller
// cannot see, answers `available: false` with NO reason — indistinguishable
// from the entry point simply not rendering. Reasons are attached only where
// naming them leaks nothing: a look with no service linkage, or one linked
// outside the pilot vertical.

import { jsonFail, jsonOk, requireClient } from '@/app/api/_utils'
import { loadConsultLookAvailability } from '@/lib/consult/lookConsultEntry'
import type { ConsultLookAvailabilityResponseDTO } from '@/lib/dto'
import { safeError } from '@/lib/security/logging'

export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  try {
    const auth = await requireClient()
    if (!auth.ok) return auth.res

    const lookPostId = new URL(req.url).searchParams.get('lookPostId')?.trim()
    if (!lookPostId) return jsonFail(400, 'Missing lookPostId.')

    const body: ConsultLookAvailabilityResponseDTO = {
      availability: await loadConsultLookAvailability({
        lookPostId,
        clientId: auth.clientId,
      }),
    }
    return jsonOk(body)
  } catch (e: unknown) {
    console.error('GET /api/v1/client/consult/look/availability error', {
      error: safeError(e),
    })
    return jsonFail(500, 'Internal server error')
  }
}
