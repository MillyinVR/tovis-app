// app/api/v1/client/consult/availability/route.ts
//
// Whether the AI consult entry surface is open for a booking the caller owns —
// the exact rule the web booking page uses to render its consult card
// (evaluateAiConsultBookingEligibility + existing-session ownership). Built for
// the iOS app, whose consult entry is server-driven: the device shows an entry
// point only when this answers `available: true`, instead of shipping its own
// copy of the founder gate (which could never mirror the eval-deferral
// decision recorded in lib/consult/access.ts).
//
// No-leak contract: hidden ineligibility reasons (pilot dark for the pro,
// vertical not enabled) answer `available: false` with no reason attached —
// the same signal as the web card simply not rendering. Ownership failures
// keep requireClientBookingOwnership's uniform 404.

import { jsonFail, jsonOk, requireClient } from '@/app/api/_utils'
import { requireClientBookingOwnership } from '@/app/api/_utils/auth/requireClientBookingOwnership'
import {
  AI_CONSULT_ELIGIBILITY_BOOKING_SELECT,
  evaluateAiConsultBookingEligibility,
} from '@/lib/consult/eligibility'
import { toConsultSessionDTO } from '@/lib/consult/mapConsultSession'
import type { ConsultAvailabilityResponseDTO } from '@/lib/dto'
import { prisma } from '@/lib/prisma'
import { safeError } from '@/lib/security/logging'

export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  try {
    const auth = await requireClient()
    if (!auth.ok) return auth.res
    const { clientId } = auth

    const bookingId = new URL(req.url).searchParams.get('bookingId')?.trim()
    if (!bookingId) return jsonFail(400, 'Missing bookingId.')

    const own = await requireClientBookingOwnership(bookingId, clientId)
    if (!own.ok) return own.res

    const booking = await prisma.booking.findUnique({
      where: { id: bookingId },
      select: AI_CONSULT_ELIGIBILITY_BOOKING_SELECT,
    })
    if (!booking) return jsonFail(404, 'Booking not found.')

    const session = await prisma.consultSession.findUnique({
      where: { bookingId },
    })

    // A session created by another client for this booking blocks the surface
    // rather than leaking that it exists.
    const ownsSession = !session || session.clientId === clientId
    const available =
      evaluateAiConsultBookingEligibility(booking).eligible && ownsSession

    const body: ConsultAvailabilityResponseDTO = {
      availability: {
        available,
        consult:
          available && session ? toConsultSessionDTO(session) : null,
      },
    }
    return jsonOk(body)
  } catch (e: unknown) {
    console.error('GET /api/v1/client/consult/availability error', {
      error: safeError(e),
    })
    return jsonFail(500, 'Internal server error')
  }
}
