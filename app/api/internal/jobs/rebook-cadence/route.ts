// app/api/internal/jobs/rebook-cadence/route.ts
//
// Cron: 35 10 * * * (daily; see vercel.json)
//
// §6.7 cadence-timed rebook prompt, gated by the §8.1 re-engagement notification
// budget. Scans completed visits with pros who now have a near-term calendar
// opening (ProfessionalAvailabilityStat, #604), finds (client, pro) pairs that are
// DUE for a refresh — past that pair's cadence (learned from the client's own
// visit history via relationshipIntelligence's mean-gap, falling back to the
// offering's static rebookIntervalDays), but not so far past that they've churned —
// excludes pairs with an upcoming booking or a recent nudge, and sends at most one
// gentle "time for a refresh?" nudge per client per run, pooled under the weekly
// re-engagement cap (lib/notifications/reEngagementBudget.ts).
//
// Scheduled LATER in the day than the §8 event-countdown (5 10) and §6.8 saved-look
// (20 10) crons so those higher-priority triggers claim the shared budget first on
// a day when a client qualifies for several (design decision (a), see the emitter).
// Daily (not hourly): a rebook reminder is calm; delivery-time quiet hours still
// apply.
//
// Emits a structured `reengagement_activation_serve` log for the §9 metrics tail
// (opt-out signal = mutedOptOut; budget pressure = budgetBlocked).

import { jsonFail, jsonOk } from '@/app/api/_utils'
import {
  getInternalJobSecret,
  isAuthorizedJobRequest,
} from '@/app/api/_utils/auth/internalJob'
import { runRebookCadenceNotifications } from '@/lib/notifications/rebookCadenceNotifications'
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
    const summary = await runRebookCadenceNotifications(prisma, {
      now: new Date(),
    })

    // §9 observability: one structured line per run. mutedOptOut is the per-trigger
    // opt-out signal (§8.1); budgetBlocked is pooled-cap pressure.
    console.log(
      JSON.stringify({
        event: 'reengagement_activation_serve',
        trigger: 'REBOOK_CADENCE',
        openPros: summary.openPros,
        completedVisits: summary.completedVisits,
        scanCapped: summary.scanCapped,
        candidatePairs: summary.candidatePairs,
        learnedCadencePairs: summary.learnedCadencePairs,
        offeringCadencePairs: summary.offeringCadencePairs,
        mutedOptOut: summary.mutedOptOut,
        budgetBlocked: summary.budgetBlocked,
        sent: summary.sent,
        computedAt: summary.computedAt.toISOString(),
      }),
    )

    return jsonOk({
      openPros: summary.openPros,
      completedVisits: summary.completedVisits,
      scanCapped: summary.scanCapped,
      candidatePairs: summary.candidatePairs,
      learnedCadencePairs: summary.learnedCadencePairs,
      offeringCadencePairs: summary.offeringCadencePairs,
      mutedOptOut: summary.mutedOptOut,
      budgetBlocked: summary.budgetBlocked,
      sent: summary.sent,
      computedAt: summary.computedAt.toISOString(),
    })
  } catch (error: unknown) {
    console.error('GET /api/internal/jobs/rebook-cadence error', {
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
