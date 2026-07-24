// app/api/internal/jobs/deposit-release/route.ts
//
// Cron: */15 * * * * (every 15 minutes; see vercel.json)
//
// Two sweeps over the new-client discovery-deposit population, in order:
//
// 1. RECOVER lost deposit successes (M14): a deposit whose
//    payment_intent.succeeded webhook was lost stays depositStatus=PENDING with
//    the money already captured at Stripe. recoverAbandonedDepositSuccesses polls
//    Stripe for these and re-drives the deposit-paid path. Runs FIRST so a
//    paid-but-unrecorded deposit is marked PAID before the release sweep below
//    considers cancelling its slot this tick.
//    Kill switch: DEPOSIT_SUCCESS_RECOVERY_ENABLED (default on; off ⇒ observe).
//
// 2. RELEASE abandoned unpaid holds (M5): a booking whose deposit was never paid
//    squats the pro's calendar because the deposit was meant to secure the slot
//    and nothing else frees it. Once an unpaid deposit is older than the deadline
//    (DEPOSIT_UNPAID_DEADLINE_HOURS, default 24), this cancels the booking
//    (SYSTEM provenance), freeing the slot, and notifies the client to rebook.
//    Kill switch: DEPOSIT_AUTO_RELEASE_ENABLED (default on; off ⇒ observe).
//
// The two are independent (recovery mutating a deposit to PAID drops it from the
// release sweep's PENDING candidate set), so recovery's failure never blocks the
// release, and vice-versa.
import { jsonFail, jsonOk } from '@/app/api/_utils'
import { getInternalJobSecret, isAuthorizedJobRequest } from '@/app/api/_utils/auth/internalJob'
import { recoverAbandonedDepositSuccesses } from '@/lib/booking/depositSuccessRecoverySweep'
import { releaseAbandonedDepositBookings } from '@/lib/booking/depositReleaseSweep'
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
    const now = new Date()

    // Recover lost deposit successes FIRST — a deposit it marks PAID drops out of
    // the release sweep's PENDING candidate set below, so a client who actually
    // paid never has their slot freed in the same tick.
    //
    // Isolated (§21.4 R5): the two sweeps are data-independent, but a top-level
    // recovery throw (its candidate query) previously skipped the release sweep
    // for the whole tick. Recovery failure now pages via Sentry and release still
    // runs; the failure is surfaced in the response body.
    let recovery: Awaited<ReturnType<typeof recoverAbandonedDepositSuccesses>> | null =
      null
    try {
      recovery = await recoverAbandonedDepositSuccesses({ now })
    } catch (recoveryError: unknown) {
      captureBookingException({
        error: recoveryError,
        route: 'GET /api/internal/jobs/deposit-release',
        event: 'DEPOSIT_RECOVERY_SWEEP_ERROR',
      })
    }

    const result = await releaseAbandonedDepositBookings({ now })

    return jsonOk({
      enabled: result.enabled,
      deadlineHours: result.deadlineHours,
      candidatesScanned: result.candidatesScanned,
      released: result.releasedCount,
      capped: result.capped,
      tally: result.tally,
      recovery: recovery
        ? {
            enabled: recovery.enabled,
            candidatesScanned: recovery.candidatesScanned,
            recovered: recovery.recoveredCount,
            capped: recovery.capped,
            tally: recovery.tally,
          }
        : { failed: true },
      ranAt: new Date().toISOString(),
    })
  } catch (error: unknown) {
    captureBookingException({
      error,
      route: 'GET /api/internal/jobs/deposit-release',
      event: 'DEPOSIT_RELEASE_SWEEP_ERROR',
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
