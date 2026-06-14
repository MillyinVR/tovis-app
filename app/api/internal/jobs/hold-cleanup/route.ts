// app/api/internal/jobs/hold-cleanup/route.ts
//
// Cron: */5 * * * * (every 5 minutes)
// Sweeps expired BookingHold rows so stale holds never permanently lock slots,
// and bumps the scheduleConfigVersion for every affected professional so
// cached availability surfaces re-render the freed slots immediately.
//
import { jsonFail, jsonOk } from '@/app/api/_utils'
import { getInternalJobSecret, isAuthorizedJobRequest } from '@/app/api/_utils/auth/internalJob'
import { cleanupAllExpiredHolds } from '@/lib/booking/writeBoundary'
import { captureBookingException } from '@/lib/observability/bookingEvents'

export const dynamic = 'force-dynamic'
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
    const { deletedCount, affectedProfessionalIds } =
      await cleanupAllExpiredHolds({ now })

    return jsonOk({
      deleted: deletedCount,
      affectedProfessionalIds: affectedProfessionalIds.length,
      ranAt: now.toISOString(),
    })
  } catch (error: unknown) {
    captureBookingException({
      error,
      route: 'GET /api/internal/jobs/hold-cleanup',
      event: 'HOLD_SWEEP_ERROR',
    })
    throw error
  }
}

export async function GET(req: Request) {
  return runJob(req)
}

export async function POST(req: Request) {
  return runJob(req)
}
