// lib/consult/analysisRunner.ts
//
// P4b: the batch that drains ConsultAnalysisRun, and the in-request kick that
// starts one immediately.
//
// This is the `kickNotificationDrain` shape
// (lib/notifications/delivery/kickNotificationDrain.ts), for the same reason:
// a cron-only queue means the client stares at "we're building your plan" for
// up to a cron tick before anything begins. So the start request enqueues,
// responds, and then `waitUntil`s one run; the every-minute cron is the
// backstop that covers a killed function, a retry's backoff, and a `waitUntil`
// that never got a serverless scope to run in.
//
// 🔴 BATCH SIZE IS ONE, and that is not a tuning knob.
//
// A single run makes three sequential paid calls with a combined 245-second
// ceiling. The looks/social drain — the pattern this borrows from — processes
// up to 100 jobs per invocation under `maxDuration = 60`. Putting analysis
// runs in that queue would kill every one of them mid-flight AND starve the
// rest of the batch, so this has its own runner route at `maxDuration = 300`
// that takes exactly one run per invocation. Two due runs are two cron ticks
// (or two kicks), which is correct: they are minutes of provider time each.

import 'server-only'

import { waitUntil } from '@vercel/functions'

import { safeError } from '@/lib/security/logging'

import {
  executeConsultAnalysisRun,
  type ConsultAnalysisRunOutcome,
} from './analysisContract'
import { dueConsultAnalysisRunIds } from './analysisRun'
import { notifyConsultAnalysisRunSettled } from './analysisNotifications'
import { kickNotificationDrain } from '@/lib/notifications/delivery/kickNotificationDrain'

export type ProcessConsultAnalysisRunsResult = {
  scannedCount: number
  outcomes: ConsultAnalysisRunOutcome[]
}

/**
 * Drain due runs. `take` defaults to 1 — see the header before raising it.
 */
export async function processConsultAnalysisRuns(args?: {
  now?: Date
  take?: number
}): Promise<ProcessConsultAnalysisRunsResult> {
  const now = args?.now ?? new Date()
  const take = Math.max(1, Math.min(3, Math.trunc(args?.take ?? 1)))
  const runIds = await dueConsultAnalysisRunIds({ now, take })

  const outcomes: ConsultAnalysisRunOutcome[] = []
  let settled = false
  for (const runId of runIds) {
    const outcome = await executeConsultAnalysisRun({ runId, now })
    outcomes.push(outcome)
    // The client is told the moment the run reaches a terminal state — and
    // never for a scheduled retry, which is not something she should hear
    // about (it is the system doing its job, and the spinner is still right).
    if (outcome.result === 'COMPLETED' || outcome.result === 'FAILED_FINAL') {
      await notifyConsultAnalysisRunSettled({ runId: outcome.runId })
      settled = true
    }
  }

  // Send what was just enqueued rather than waiting for the notification
  // cron's own tick. Here rather than in the runner route so the in-request
  // KICK gets the same latency as the cron — a client who left the app is the
  // whole reason those rows exist.
  if (settled) kickNotificationDrain()

  return { scannedCount: runIds.length, outcomes }
}

/**
 * Fire-and-forget: start the run this request just enqueued, after the
 * response is sent.
 *
 * Safe by construction, exactly like the notification kick:
 *  - never blocks or fails the request — the promise's rejection is swallowed;
 *  - `waitUntil` being unavailable (non-serverless, tests) is caught, and the
 *    every-minute cron is the backstop either way;
 *  - concurrency-safe — `claimConsultAnalysisRun` leases the row atomically,
 *    so overlapping with the cron or another kick produces one winner.
 */
export function kickConsultAnalysisRun(): void {
  // Never fire a live drain inside the test runner: this would make real paid
  // provider calls from any unit test that touches the start route. The
  // integration tests drive `processConsultAnalysisRuns` explicitly instead,
  // which is also what makes their timing deterministic.
  if (process.env.VITEST) return

  const run = () =>
    processConsultAnalysisRuns({ take: 1 }).then(
      () => undefined,
      (error: unknown) => {
        console.error('kickConsultAnalysisRun: run failed', {
          error: safeError(error),
        })
      },
    )

  try {
    waitUntil(run())
  } catch (error: unknown) {
    // Only available inside a serverless request scope. Outside one the cron
    // backstop picks the run up within a minute — latency, not loss.
    console.warn(
      'kickConsultAnalysisRun: waitUntil unavailable; relying on cron',
      { error: safeError(error) },
    )
  }
}
