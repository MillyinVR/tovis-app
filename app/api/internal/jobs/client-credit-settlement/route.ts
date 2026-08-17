// app/api/internal/jobs/client-credit-settlement/route.ts
//
// Cron: 15 * * * * (hourly; see vercel.json)
//
// The credit ledger's two housekeeping duties (lib/credit/creditSettlement.ts):
// hand back reservations that were quoted into a checkout nobody paid, then pay
// every professional the platform still owes for a credit a client actually
// spent.
//
// 🔴 THE SECOND HALF MOVES REAL MONEY. The client's final bill is a destination
// charge with no application fee, so a bill reduced by credit reduces the pro's
// payout by exactly that much. This job is what puts it back and makes
// "platform-funded" true. If it stops, no client is over-charged and no pro is
// paid twice — the debt simply accrues, stays queryable as
// `platformTopUpAt IS NULL`, and is reported below as `outstandingCents`.
//
// Hourly, offset to :15 so it does not contend with the other hourly aggregates
// (pro-badge-stats :10, pro-availability-stats :25, look-conversion-stats :40,
// client-creator-stats :55).

import { jsonFail, jsonOk } from '@/app/api/_utils'
import {
  getInternalJobSecret,
  isAuthorizedJobRequest,
} from '@/app/api/_utils/auth/internalJob'
import {
  releaseExpiredCreditReservations,
  settleCreditTopUps,
} from '@/lib/credit/creditSettlement'
import { prisma } from '@/lib/prisma'
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

  try {
    const now = new Date()

    // Releases first: a reservation freed here is spendable balance again on the
    // client's very next checkout, and nothing in the top-up pass reads it.
    const released = await releaseExpiredCreditReservations(prisma, now)
    const toppedUp = await settleCreditTopUps(prisma, now)

    return jsonOk({
      releasedReservations: released.released,
      releaseCutoff: released.cutoff.toISOString(),
      topUpsSettled: toppedUp.settled,
      topUpsSettledCents: toppedUp.settledCents,
      topUpsFailed: toppedUp.failed,
      // What the platform still owes professionals for credit already spent.
      // Non-zero is not automatically a fault — a spend that settled minutes ago
      // is simply waiting for this job — but it should not grow run over run.
      outstandingCents: toppedUp.outstandingCents,
      ranAt: now.toISOString(),
    })
  } catch (error: unknown) {
    console.error('GET /api/internal/jobs/client-credit-settlement error', {
      error: safeError(error),
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
