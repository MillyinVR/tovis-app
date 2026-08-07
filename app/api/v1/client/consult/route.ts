// app/api/v1/client/consult/route.ts
//
// AI Consult (docs/design/ai-consult.md), Phase 0, C1: schema + route
// skeleton. Creates (or, on retry, returns) the pre-visit consult for a
// booking the client owns. Founder-gated (lib/consult/access.ts) on the
// booking's professional — dark for everyone else. No intake, capture, or
// analysis yet; those are C2-C4. `bookingId` is unique on ConsultSession, so
// this is an upsert: idempotent under a retried create.
//
// ⚠️ Unrelated to the existing "Consultation" (ConsultationApproval /
// BookingConsultation) mid-appointment price-approval flow — never read or
// write those models from here.

import { jsonFail, jsonOk, pickNonEmptyString, requireClient } from '@/app/api/_utils'
import { readJsonRecord } from '@/app/api/_utils/readJsonRecord'
import { requireClientBookingOwnership } from '@/app/api/_utils/auth/requireClientBookingOwnership'
import { isAiConsultEnabledForPro } from '@/lib/consult/access'
import { toConsultSessionDTO } from '@/lib/consult/mapConsultSession'
import { prisma } from '@/lib/prisma'
import { safeError } from '@/lib/security/logging'

export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  try {
    const auth = await requireClient()
    if (!auth.ok) return auth.res
    const { clientId } = auth

    const body = await readJsonRecord(req)
    const bookingId = pickNonEmptyString(body.bookingId)
    if (!bookingId) return jsonFail(400, 'Missing bookingId.')

    const own = await requireClientBookingOwnership(bookingId, clientId)
    if (!own.ok) return own.res

    const booking = await prisma.booking.findUnique({
      where: { id: bookingId },
      select: {
        professionalId: true,
        service: { select: { categoryId: true } },
      },
    })
    if (!booking) return jsonFail(404, 'Booking not found.')

    if (!isAiConsultEnabledForPro(booking.professionalId)) {
      return jsonFail(404, 'Not found.')
    }

    const session = await prisma.consultSession.upsert({
      where: { bookingId },
      create: {
        clientId,
        bookingId,
        professionalId: booking.professionalId,
        serviceCategoryId: booking.service.categoryId,
      },
      update: {},
    })

    return jsonOk({ consult: toConsultSessionDTO(session) })
  } catch (e: unknown) {
    console.error('POST /api/v1/client/consult error', { error: safeError(e) })
    return jsonFail(500, 'Internal server error')
  }
}
