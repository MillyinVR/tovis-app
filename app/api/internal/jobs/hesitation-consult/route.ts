// app/api/internal/jobs/hesitation-consult/route.ts
//
// Cron: 40 10 * * * (daily; see vercel.json)
//
// §6.8 hesitation blocker response, gated by the §8.1 re-engagement notification
// budget. Scans aging saves on high-/medium-commitment looks (permanent makeup,
// color, extensions, lashes, skin) whose pro the client never booked, and sends at
// most one gentle "have questions? book a consult" nudge per client per run —
// pooled under the weekly re-engagement cap (lib/notifications/reEngagementBudget.ts),
// at the lowest live priority. Daily (not hourly) because re-engagement nudges
// should be calm; delivery-time quiet hours still apply.
//
// Runs AFTER the countdown (5 10) / saved-look (20 10) / rebook (35 10) crons so
// higher-priority triggers claim the pooled budget first — design decision (a),
// the same cron-ordering approximation the unified dispatcher (50 10) removes.
//
// Emits a structured `reengagement_activation_serve` log for the §9 metrics tail
// (opt-out signal = mutedOptOut; budget pressure = budgetBlocked).

import { jsonFail, jsonOk } from '@/app/api/_utils'
import {
  getInternalJobSecret,
  isAuthorizedJobRequest,
} from '@/app/api/_utils/auth/internalJob'
import { runHesitationConsultNudges } from '@/lib/notifications/hesitationConsultNudge'
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
    const summary = await runHesitationConsultNudges(prisma, { now: new Date() })

    // §9 observability: one structured line per run. mutedOptOut is the per-trigger
    // opt-out signal (§8.1); budgetBlocked is pooled-cap pressure.
    console.log(
      JSON.stringify({
        event: 'reengagement_activation_serve',
        trigger: 'HESITATION_CONSULT',
        agingSaves: summary.agingSaves,
        scanCapped: summary.scanCapped,
        candidatePairs: summary.candidatePairs,
        mutedOptOut: summary.mutedOptOut,
        budgetBlocked: summary.budgetBlocked,
        sent: summary.sent,
        computedAt: summary.computedAt.toISOString(),
      }),
    )

    return jsonOk({
      agingSaves: summary.agingSaves,
      scanCapped: summary.scanCapped,
      candidatePairs: summary.candidatePairs,
      mutedOptOut: summary.mutedOptOut,
      budgetBlocked: summary.budgetBlocked,
      sent: summary.sent,
      computedAt: summary.computedAt.toISOString(),
    })
  } catch (error: unknown) {
    console.error('GET /api/internal/jobs/hesitation-consult error', {
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
