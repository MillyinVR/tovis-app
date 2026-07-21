// app/api/v1/client/bookings/[id]/media-consent/route.ts
//
// The client grants (or revokes) the pro the right to feature THIS session's
// photos/video publicly (portfolio/Looks) — the aftercare media-use consent
// (B3b). This is a second client-authorized public-share unlock alongside
// review-promotion; it UNLOCKS the pro's publish action (see
// lib/media/publicShareGuard.ts) and does NOT auto-make anything public.

import { jsonFail, jsonOk, pickBool, pickString, requireClient } from '@/app/api/_utils'
import { resolveRouteParams, type RouteContext } from '@/app/api/_utils/routeContext'
import { requireClientBookingOwnership } from '@/app/api/_utils/auth/requireClientBookingOwnership'
import { bookingErrorJsonFail } from '@/app/api/_utils/bookingResponses'
import { isBookingError } from '@/lib/booking/errors'
import { setClientBookingMediaUseConsent } from '@/lib/booking/writeBoundary'
import { broadcastBookingChange } from '@/lib/live/broadcastBooking'
import { safeError } from '@/lib/security/logging'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

type MediaConsentResponseDTO = {
  ok: true
  mediaUseConsent: boolean
}

export async function POST(req: Request, ctx: RouteContext) {
  try {
    const auth = await requireClient()
    if (!auth.ok) return auth.res
    const { clientId } = auth

    const { id: rawId } = await resolveRouteParams(ctx)
    const bookingId = pickString(rawId)
    if (!bookingId) return jsonFail(400, 'Missing booking id.')

    const own = await requireClientBookingOwnership(bookingId, clientId)
    if (!own.ok) return own.res

    const body = (await req.json().catch(() => ({}))) as { granted?: unknown }
    const granted = pickBool(body?.granted)
    if (granted === null) return jsonFail(400, 'A boolean `granted` is required.')

    const result = await setClientBookingMediaUseConsent({ bookingId, clientId, granted })

    // Let the pro's surfaces reflect the new permission without a manual reload.
    await broadcastBookingChange(bookingId, 'bookings')

    return jsonOk({ mediaUseConsent: result.mediaUseConsent } satisfies Omit<MediaConsentResponseDTO, 'ok'>)
  } catch (error: unknown) {
    if (isBookingError(error)) {
      return bookingErrorJsonFail(error)
    }
    console.error('POST /api/v1/client/bookings/[id]/media-consent error', {
      error: safeError(error),
    })
    return jsonFail(500, 'Internal server error')
  }
}
