// app/api/internal/jobs/re-engagement-dispatch/route.ts
//
// Cron: 50 10 * * * (daily; see vercel.json)
//
// §8.1 UNIFIED re-engagement dispatcher — the capstone that enforces cross-trigger
// priority GLOBALLY. Gathers every re-engagement trigger's candidates (event-date
// countdown §8, saved-look availability-opened §6.8, rebook cadence §6.7), merges
// them per client, and allocates the pooled weekly budget ONCE per user under strict
// priority (countdown > availability > rebook), then emits the winners.
//
// Gated by ENABLE_UNIFIED_REENGAGEMENT_DISPATCH (reEngagementDispatchFlag.ts):
//   - OFF (default): this endpoint is a NO-OP and the three per-trigger crons run as
//     before → byte-identical deploy.
//   - ON: this endpoint does all the work and the three per-trigger crons no-op, so a
//     client's daily budget is allocated by ONE global priority pass. All four crons
//     share the idempotent dedupeKey ledger, so the cutover never double-sends.
//
// Emits a structured `reengagement_dispatch_serve` log for the §9 metrics tail
// (opt-out signal = mutedOptOut; budget pressure = budgetBlocked; per-trigger sends).

import { jsonFail, jsonOk } from '@/app/api/_utils'
import {
  getInternalJobSecret,
  isAuthorizedJobRequest,
} from '@/app/api/_utils/auth/internalJob'
import { runReEngagementDispatch } from '@/lib/notifications/reEngagementDispatcher'
import { unifiedReEngagementDispatchEnabled } from '@/lib/notifications/reEngagementDispatchFlag'
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

  // Cutover flag: while OFF, the three per-trigger crons own the work — this
  // dispatcher stays a registered no-op so the deploy is byte-identical.
  if (!unifiedReEngagementDispatchEnabled()) {
    return jsonOk({ skipped: true, reason: 'flag-off', sent: 0 })
  }

  try {
    const summary = await runReEngagementDispatch(prisma, { now: new Date() })

    // §9 observability: one structured line per run. mutedOptOut is the pooled
    // opt-out signal (§8.1); budgetBlocked is pooled-cap pressure; the per-trigger
    // sent breakdown lets us watch global priority in action.
    console.log(
      JSON.stringify({
        event: 'reengagement_dispatch_serve',
        datedBoards: summary.datedBoards,
        savedOpenPros: summary.savedOpenPros,
        savedAgingSaves: summary.savedAgingSaves,
        rebookOpenPros: summary.rebookOpenPros,
        rebookCompletedVisits: summary.rebookCompletedVisits,
        consultAgingSaves: summary.consultAgingSaves,
        scanCapped: summary.scanCapped,
        candidatesByTrigger: summary.candidatesByTrigger,
        mutedOptOut: summary.mutedOptOut,
        budgetBlocked: summary.budgetBlocked,
        sentByTrigger: summary.sentByTrigger,
        sent: summary.sent,
        computedAt: summary.computedAt.toISOString(),
      }),
    )

    return jsonOk({
      datedBoards: summary.datedBoards,
      savedOpenPros: summary.savedOpenPros,
      savedAgingSaves: summary.savedAgingSaves,
      rebookOpenPros: summary.rebookOpenPros,
      rebookCompletedVisits: summary.rebookCompletedVisits,
      consultAgingSaves: summary.consultAgingSaves,
      scanCapped: summary.scanCapped,
      candidatesByTrigger: summary.candidatesByTrigger,
      mutedOptOut: summary.mutedOptOut,
      budgetBlocked: summary.budgetBlocked,
      sentByTrigger: summary.sentByTrigger,
      sent: summary.sent,
      computedAt: summary.computedAt.toISOString(),
    })
  } catch (error: unknown) {
    console.error('GET /api/internal/jobs/re-engagement-dispatch error', {
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
