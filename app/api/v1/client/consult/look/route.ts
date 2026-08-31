// app/api/v1/client/consult/look/route.ts
//
// "Book this look" — creates (or, on a retry, returns) the consent-required
// consult shell anchored to a LOOK and its professional, with NO booking
// (docs/product/BOOK-THE-LOOK-DIRECTION.md, decision 12).
//
// Beside, never inside, the booking-anchored POST /api/v1/client/consult: that
// route and its availability twin are read by shipped iOS builds and keep
// their exact shape. Everything downstream — agreements, intake, inspiration,
// capture, analysis, results — is the SAME flow; only the anchor differs.
//
// ⚠️ Unrelated to the "Consultation" (ConsultationApproval / BookingConsultation)
// mid-appointment price-approval flow — never read or write those models here.

import { jsonFail, jsonOk, pickNonEmptyString, requireClient } from '@/app/api/_utils'
import { enforceRateLimit, rateLimitIdentity } from '@/app/api/_utils/rateLimit'
import { readJsonRecord } from '@/app/api/_utils/readJsonRecord'
import { consultWriteErrorResponse } from '@/lib/consult/apiErrors'
import { startLookAnchoredConsult } from '@/lib/consult/lookConsultEntry'
import type { ConsultLookStartResponseDTO } from '@/lib/dto'
import { safeError } from '@/lib/security/logging'

export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  try {
    const auth = await requireClient()
    if (!auth.ok) return auth.res
    const { clientId } = auth

    const limited = await enforceRateLimit({
      bucket: 'client:consult:write',
      identity: await rateLimitIdentity(auth.user.id),
    })
    if (limited) return limited

    const body = await readJsonRecord(req)
    const lookPostId = pickNonEmptyString(body.lookPostId)
    if (!lookPostId) return jsonFail(400, 'Missing lookPostId.')

    const consult = await startLookAnchoredConsult({
      lookPostId,
      clientId,
      actorUserId: auth.user.id,
    })
    const response: ConsultLookStartResponseDTO = { consult }
    return jsonOk(response)
  } catch (e: unknown) {
    const mapped = consultWriteErrorResponse(e)
    if (mapped) return mapped
    console.error('POST /api/v1/client/consult/look error', { error: safeError(e) })
    return jsonFail(500, 'Internal server error')
  }
}
