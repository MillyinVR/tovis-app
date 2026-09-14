// app/api/internal/jobs/consult-health/route.ts
//
// Reads the consult provider meter for the last day and reports what it found:
// one structured `ai_consult_provider_health` line always, plus one Sentry
// issue per call kind whose failure rate has crossed the threshold.
//
// It also reports the consult STALL funnel (`ai_consult_stall_funnel`) — how
// many consults have gone quiet and at which step. The two answer different
// questions and both were unanswered until 2026-09-13: the meter says whether
// the MODEL is working, the funnel says whether anyone is getting through the
// PRODUCT. On that date the model had a 44% failure rate on one call kind and
// six of seven consults were stuck, and neither fact had ever been reported.
//
// Cron: 10 9 * * * (daily, before the 10:00 re-engagement block so a morning's
// alerts are already in the inbox; 09:10 because every other minute in that
// hour is already taken). Scheduled in vercel.json. Vercel cron invokes via
// GET; the POST export stays for manual/internal triggers.
//
// Read-only: this job writes nothing to the database and takes no action on a
// consult. Its entire output is a log line and, when something is broken, an
// alert. Auth matches the other internal jobs.

import { jsonFail, jsonOk } from '@/app/api/_utils'
import { isAuthorizedJobRequest } from '@/app/api/_utils/auth/internalJob'
import { readConsultProviderHealth } from '@/lib/consult/providerHealth'
import { readConsultStallFunnel } from '@/lib/consult/stallFunnel'
import {
  logAiConsultProviderHealth,
  logAiConsultStallFunnel,
} from '@/lib/observability/aiConsultEvents'
import { captureConsultProviderHealthAlert } from '@/lib/observability/consultAlerts'
import { safeError } from '@/lib/security/logging'

export const dynamic = 'force-dynamic'
export const maxDuration = 60
export const runtime = 'nodejs'

async function runJob(req: Request) {
  if (!isAuthorizedJobRequest(req)) {
    return jsonFail(401, 'Unauthorized')
  }

  try {
    const [report, funnel] = await Promise.all([
      readConsultProviderHealth(),
      readConsultStallFunnel(),
    ])

    logAiConsultProviderHealth({
      windowHours: report.windowHours,
      since: report.since,
      until: report.until,
      totalCalls: report.totalCalls,
      failedCalls: report.failedCalls,
      badOutputCalls: report.badOutputCalls,
      costMicroUsd: report.costMicroUsd,
      byKind: report.byKind.map((row) => ({
        kind: row.kind,
        totalCalls: row.totalCalls,
        failedCalls: row.failedCalls,
        failureRate: row.failureRate,
        costMicroUsd: row.costMicroUsd,
        topFailureChecks: row.topFailureChecks,
      })),
      alertingKinds: report.alerts.map((alert) => alert.kind),
    })

    for (const alert of report.alerts) {
      captureConsultProviderHealthAlert({
        kind: alert.kind,
        windowHours: report.windowHours,
        totalCalls: alert.totalCalls,
        failedCalls: alert.failedCalls,
        failureRate: alert.failureRate,
        topFailureChecks: alert.topFailureChecks,
      })
    }

    logAiConsultStallFunnel({
      minAgeHours: funnel.minAgeHours,
      until: funnel.until,
      totalStalled: funnel.totalStalled,
      awaitingClient: funnel.awaitingClient,
      awaitingSystem: funnel.awaitingSystem,
      byStatus: funnel.byStatus.map((row) => ({
        status: row.status,
        sessions: row.sessions,
        awaitingClient: row.awaitingClient,
        oldestAgeHours: row.oldestAgeHours,
      })),
    })

    return jsonOk({
      windowHours: report.windowHours,
      totalCalls: report.totalCalls,
      failedCalls: report.failedCalls,
      alerted: report.alerts.map((alert) => alert.kind),
      totalStalled: funnel.totalStalled,
      awaitingClient: funnel.awaitingClient,
      awaitingSystem: funnel.awaitingSystem,
    })
  } catch (error: unknown) {
    console.error('/api/internal/jobs/consult-health error', {
      error: safeError(error),
    })
    return jsonFail(500, 'Internal server error')
  }
}

export async function GET(req: Request) {
  return runJob(req)
}

export async function POST(req: Request) {
  return runJob(req)
}
