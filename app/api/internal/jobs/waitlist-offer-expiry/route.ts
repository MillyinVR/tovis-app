// app/api/internal/jobs/waitlist-offer-expiry/route.ts
//
// Cron: 35 * * * * (hourly)
// Transitions lapsed waitlist offers to EXPIRED and puts their clients back on
// the pro's active waitlist.
//
// The split mirrors the account-deletion sweep: the offer's `expiresAt` is
// written when the pro makes the promise, and this job is the only thing that
// ever acts on it. Without it `WaitlistOfferStatus.EXPIRED` was unreachable —
// the countdown was enforced defensively at confirm time and nowhere else, so a
// client who never answered stayed NOTIFIED forever and quietly stopped being
// offerable. Nothing here is reachable without the internal job secret.
//
// Hourly is a deliberate trade against the 24h offer TTL: an entry can sit
// NOTIFIED for up to an hour past its countdown. That hour is invisible to the
// pro's calendar — the every-5-minute hold sweep frees the reserved slot on its
// own schedule — so the only thing it delays is the waitlist row going back to
// ACTIVE and the pro being told why.

import { jsonFail, jsonOk } from '@/app/api/_utils'
import {
  getInternalJobSecret,
  isAuthorizedJobRequest,
} from '@/app/api/_utils/auth/internalJob'
import { expireLapsedWaitlistOffers } from '@/lib/booking/writeBoundary'
import { captureScheduledJobException } from '@/lib/observability/scheduledJobEvents'
import { safeError } from '@/lib/security/logging'

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

  const now = new Date()

  try {
    const result = await expireLapsedWaitlistOffers({ now })

    return jsonOk({
      considered: result.considered,
      expired: result.expired,
      revivedEntries: result.revivedEntries,
      skipped: result.skipped,
      failed: result.failed,
      ranAt: now.toISOString(),
    })
  } catch (error: unknown) {
    console.error('waitlist-offer-expiry sweep error', { error: safeError(error) })
    // As this file's own header says, this job is the ONLY thing that ever acts
    // on an offer's expiresAt. While it is down a client sits NOTIFIED forever
    // and quietly stops being offerable, and the pro's calendar looks normal
    // throughout — there is no second signal.
    captureScheduledJobException({
      error,
      job: '/api/internal/jobs/waitlist-offer-expiry',
      event: 'WAITLIST_OFFER_EXPIRY_SWEEP_ERROR',
    })
    return jsonFail(500, 'Waitlist offer expiry sweep failed.')
  }
}

export async function GET(req: Request) {
  return runJob(req)
}

export async function POST(req: Request) {
  return runJob(req)
}
