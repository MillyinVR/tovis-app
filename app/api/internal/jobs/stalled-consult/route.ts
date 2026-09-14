// app/api/internal/jobs/stalled-consult/route.ts
//
// Cron: 38 10 * * * (daily; see vercel.json)
//
// One gentle reminder for a consult the client STARTED and never finished,
// pooled under the §8.1 re-engagement budget. Until this landed, an unfinished
// consult was unreachable by anything in the product: every consult
// notification requires a COMPLETED consult and a live booking, and on
// 2026-09-13 six of the seven consults ever started in production were sitting
// in a pre-completion status with nothing left to touch them.
//
// Runs BEFORE the hesitation-consult cron (40 10) and after rebook (35 10),
// matching its priority in RE_ENGAGEMENT_TRIGGER_PRIORITY — the same
// cron-ordering approximation of cross-trigger priority the unified dispatcher
// (50 10) removes. Daily, never hourly: a reminder about something she chose to
// put down should be calm, and delivery-time quiet hours still apply.
//
// 🔴 The selection rules that make this a reminder rather than nagging live in
// lib/notifications/stalledConsultNudge.ts — in particular, a consult waiting on
// the SYSTEM (queued or failing analysis) is never nudged, and neither is one
// whose input window has closed.

import { jsonFail, jsonOk } from '@/app/api/_utils'
import {
  getInternalJobSecret,
  isAuthorizedJobRequest,
} from '@/app/api/_utils/auth/internalJob'
import { unifiedReEngagementDispatchEnabled } from '@/lib/notifications/reEngagementDispatchFlag'
import { runStalledConsultNudges } from '@/lib/notifications/stalledConsultNudge'
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

  // While the unified re-engagement dispatcher is ON it owns this trigger's
  // pooled allocation (global priority); this per-trigger cron no-ops to avoid
  // double work and a duplicate budget spend. Default OFF → this cron is the
  // path that actually runs today.
  if (unifiedReEngagementDispatchEnabled()) {
    return jsonOk({ skipped: true, reason: 'unified-dispatch', sent: 0 })
  }

  try {
    const summary = await runStalledConsultNudges(prisma, { now: new Date() })

    // §9 observability: one structured line per run. mutedOptOut is the
    // per-trigger opt-out signal; budgetBlocked is pooled-cap pressure.
    console.log(
      JSON.stringify({
        event: 'reengagement_activation_serve',
        trigger: 'UNFINISHED_CONSULT',
        idleSessions: summary.idleSessions,
        scanCapped: summary.scanCapped,
        candidates: summary.candidates,
        mutedOptOut: summary.mutedOptOut,
        budgetBlocked: summary.budgetBlocked,
        sent: summary.sent,
        computedAt: summary.computedAt.toISOString(),
      }),
    )

    return jsonOk({
      idleSessions: summary.idleSessions,
      scanCapped: summary.scanCapped,
      candidates: summary.candidates,
      mutedOptOut: summary.mutedOptOut,
      budgetBlocked: summary.budgetBlocked,
      sent: summary.sent,
      computedAt: summary.computedAt.toISOString(),
    })
  } catch (error: unknown) {
    console.error('GET /api/internal/jobs/stalled-consult error', {
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
