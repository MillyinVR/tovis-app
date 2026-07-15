// app/api/internal/jobs/event-countdown/route.ts
//
// Cron: 5 10 * * * (daily; see vercel.json)
//
// §8 event-date countdown, the HIGHEST-priority re-engagement trigger under the
// §8.1 notification budget. Scans dated bridal/prom boards (Board.eventDate, #511)
// approaching a milestone (30/14/7/3 days out), excludes boards already nudged for
// their current milestone, and sends at most one gentle "N days until your event —
// there's still time to book" nudge per client per run — pooled under the weekly
// re-engagement cap (lib/notifications/reEngagementBudget.ts).
//
// Scheduled EARLIER in the day than the §6.8 saved-look-activation cron (20 10)
// so the countdown — the top priority tier — claims the shared budget first on a
// day when a client qualifies for both (design decision (a), see the emitter).
// Daily (not hourly): a milestone reminder is calm; delivery-time quiet hours
// still apply.
//
// Emits a structured `reengagement_activation_serve` log for the §9 metrics tail
// (opt-out signal = mutedOptOut; budget pressure = budgetBlocked).

import { jsonFail, jsonOk } from '@/app/api/_utils'
import {
  getInternalJobSecret,
  isAuthorizedJobRequest,
} from '@/app/api/_utils/auth/internalJob'
import { runEventCountdownNotifications } from '@/lib/notifications/eventCountdownNotifications'
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

  // While the unified re-engagement dispatcher is ON, it owns this trigger's pooled
  // budget allocation (global priority); this per-trigger cron no-ops to avoid double
  // work and a duplicate budget spend. Default OFF → runs exactly as before.
  if (unifiedReEngagementDispatchEnabled()) {
    return jsonOk({ skipped: true, reason: 'unified-dispatch', sent: 0 })
  }

  try {
    const summary = await runEventCountdownNotifications(prisma, {
      now: new Date(),
    })

    // §9 observability: one structured line per run. mutedOptOut is the per-trigger
    // opt-out signal (§8.1); budgetBlocked is pooled-cap pressure.
    console.log(
      JSON.stringify({
        event: 'reengagement_activation_serve',
        trigger: 'EVENT_COUNTDOWN',
        datedBoards: summary.datedBoards,
        scanCapped: summary.scanCapped,
        candidateBoards: summary.candidateBoards,
        mutedOptOut: summary.mutedOptOut,
        budgetBlocked: summary.budgetBlocked,
        sent: summary.sent,
        computedAt: summary.computedAt.toISOString(),
      }),
    )

    return jsonOk({
      datedBoards: summary.datedBoards,
      scanCapped: summary.scanCapped,
      candidateBoards: summary.candidateBoards,
      mutedOptOut: summary.mutedOptOut,
      budgetBlocked: summary.budgetBlocked,
      sent: summary.sent,
      computedAt: summary.computedAt.toISOString(),
    })
  } catch (error: unknown) {
    console.error('GET /api/internal/jobs/event-countdown error', {
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
