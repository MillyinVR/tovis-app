// app/api/internal/jobs/consult-analysis/process/route.ts
//
// Cron: * * * * * (every minute; see vercel.json)
//
// P4b: drains ConsultAnalysisRun. This is the backstop behind the in-request
// kick (lib/consult/analysisRunner.ts), and the ONLY thing that recovers a run
// whose function was killed mid-flight, a retry waiting out its backoff, or a
// kick that never got a serverless scope to run in.
//
// 🔴 Two numbers here are load-bearing and are not the usual copy-paste:
//
//   maxDuration = 300 — one run makes three sequential paid calls with a
//   combined 245-second ceiling (50s inspiration + 45s profile + 150s
//   direction). The looks/social drain this route is modelled on runs at 60,
//   which would kill every analysis run it started.
//
//   take = 1 — for the same reason. A batch of analysis runs in one invocation
//   would run out of wall clock and leave the tail of the batch claimed but
//   unfinished, waiting on the stale-lease sweep. Two due runs are two ticks.
//
// Every-minute cadence is deliberate: this is the difference between a client
// seeing her plan and a client staring at a spinner. It costs one cheap query
// per minute when there is nothing due.

import { jsonFail, jsonOk } from '@/app/api/_utils'
import {
  getInternalJobSecret,
  isAuthorizedJobRequest,
} from '@/app/api/_utils/auth/internalJob'
import { processConsultAnalysisRuns } from '@/lib/consult/analysisRunner'
import { safeError } from '@/lib/security/logging'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 300

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

  const startedAtMs = Date.now()
  const result = await processConsultAnalysisRuns({ take: 1 })

  // The notification drain is kicked inside processConsultAnalysisRuns, so the
  // in-request kick path gets it too — not just this cron.

  return jsonOk({
    scannedCount: result.scannedCount,
    durationMs: Date.now() - startedAtMs,
    outcomes: result.outcomes.map((outcome) => ({
      runId: outcome.runId,
      result: outcome.result,
      failureCode: 'failureCode' in outcome ? outcome.failureCode : null,
    })),
  })
}

export async function GET(req: Request) {
  try {
    return await runJob(req)
  } catch (error: unknown) {
    console.error('GET /api/internal/jobs/consult-analysis/process error', {
      error: safeError(error),
    })
    return jsonFail(500, 'Internal server error')
  }
}

export async function POST(req: Request) {
  try {
    return await runJob(req)
  } catch (error: unknown) {
    console.error('POST /api/internal/jobs/consult-analysis/process error', {
      error: safeError(error),
    })
    return jsonFail(500, 'Internal server error')
  }
}
