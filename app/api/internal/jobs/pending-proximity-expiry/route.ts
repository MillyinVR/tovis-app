// app/api/internal/jobs/pending-proximity-expiry/route.ts
//
// Cron: */15 * * * * (every 15 minutes; see vercel.json)
//
// Book the Look, slice B4 — the safety piece that makes request-mode impulse
// honest (docs/product/BOOK-THE-LOOK-DIRECTION.md). A client who commits at
// 3 AM to a slot the pro must confirm has her time reserved and her deposit
// taken; if the pro never answers, this releases the slot before the
// appointment arrives, notifies her, and refunds what she paid.
//
// Kill switch: PENDING_PROXIMITY_EXPIRY_ENABLED (default on; off ⇒ observe).
// Windows: PENDING_PROXIMITY_EXPIRY_HOURS (default 6) and
// PENDING_PROXIMITY_MIN_ANSWER_HOURS (default 2).

import { jsonFail, jsonOk } from '@/app/api/_utils'
import {
  getInternalJobSecret,
  isAuthorizedJobRequest,
} from '@/app/api/_utils/auth/internalJob'
import { expireProximatePendingBookings } from '@/lib/booking/pendingProximityExpirySweep'
import { captureBookingException } from '@/lib/observability/bookingEvents'

export const dynamic = 'force-dynamic'
export const maxDuration = 60
export const runtime = 'nodejs'

async function runJob(req: Request) {
  const secret = getInternalJobSecret()
  if (!secret) {
    return jsonFail(
      500,
      'Missing INTERNAL_JOB_SECRET or CRON_SECRET configuration.',
    )
  }

  if (!isAuthorizedJobRequest(req)) {
    return jsonFail(401, 'Unauthorized')
  }

  try {
    const result = await expireProximatePendingBookings({ now: new Date() })

    return jsonOk({
      enabled: result.enabled,
      proximityHours: result.proximityHours,
      minAnswerHours: result.minAnswerHours,
      candidatesScanned: result.candidatesScanned,
      expired: result.expiredCount,
      refunded: result.refundedCount,
      capped: result.capped,
      tally: result.tally,
      ranAt: new Date().toISOString(),
    })
  } catch (error: unknown) {
    captureBookingException({
      error,
      route: 'GET /api/internal/jobs/pending-proximity-expiry',
      event: 'PENDING_PROXIMITY_EXPIRY_SWEEP_ERROR',
    })
    throw error
  }
}

export async function GET(req: Request) {
  try {
    return await runJob(req)
  } catch {
    return jsonFail(500, 'Internal server error')
  }
}

export async function POST(req: Request) {
  try {
    return await runJob(req)
  } catch {
    return jsonFail(500, 'Internal server error')
  }
}
