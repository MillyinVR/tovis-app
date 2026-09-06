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
import { ConsultActorType } from '@prisma/client'

import { prisma } from '@/lib/prisma'
import { safeError } from '@/lib/security/logging'

import {
  executeConsultAnalysisRun,
  startConsultAnalysisRerun,
  type ConsultAnalysisRunOutcome,
} from './analysisContract'
import { dueConsultRerunSessionIds } from './analysisRerun'
import { dueConsultAnalysisRunIds } from './analysisRun'
import { notifyConsultAnalysisRunSettled } from './analysisNotifications'
import { generateConsultFollowUpRound } from './followUpContract'
import { kickNotificationDrain } from '@/lib/notifications/delivery/kickNotificationDrain'

export type ProcessConsultAnalysisRunsResult = {
  scannedCount: number
  outcomes: ConsultAnalysisRunOutcome[]
  /** P7a-3: debounced reruns this tick turned into queued runs. */
  promotedRerunCount: number
}

/**
 * P7a-3: turn debounced rerun requests into runs, before draining.
 *
 * Before, not after, and that is the whole reason it lives here: a run
 * promoted at the top of this function is due at the bottom of it, so a client
 * who stopped editing ninety seconds ago gets her update on THIS tick rather
 * than waiting a second minute for the next one.
 *
 * Every refusal is ordinary — she is out of versions, her photos expired, her
 * appointment started while the debounce ran — so none of them is an error
 * here. The thread reads the same state and says which one it is.
 */
async function promoteDueConsultReruns(now: Date, take: number): Promise<number> {
  const sessionIds = await dueConsultRerunSessionIds({ now, take })
  let promoted = 0
  for (const consultSessionId of sessionIds) {
    const result = await startConsultAnalysisRerun({ consultSessionId, now })
    if (result.started) promoted += 1
  }
  return promoted
}

/**
 * P5g — buy the FIRST follow-up round for a plan that just published.
 *
 * Here, and not on the thread read, for two reasons. This is a background
 * context with the budget for a provider call, so nobody waits on it; and a GET
 * that spends money is a GET a retry or a poll can spend twice.
 *
 * "After the photos" in the P5g brief is this instant: the guided pack is what
 * produced the plan, so a plan existing IS the photos being in. Rounds two and
 * three are bought by the answer that closes the round before them
 * (lib/consult/followUpContract.ts).
 *
 * 🔴 Never allowed to fail the run. The analysis is finished and published by
 * the time this is called; throwing here would turn a completed plan into a
 * FAILED tick and re-run three paid calls for the sake of a follow-up question.
 * Every failure inside `generateConsultFollowUpRound` already has a designed
 * answer (the safety fallback), so what is caught here is only the unexpected.
 */
async function openFollowUpRound(runId: string, now: Date): Promise<void> {
  try {
    const run = await prisma.consultAnalysisRun.findUnique({
      where: { id: runId },
      select: { consultSessionId: true },
    })
    if (!run) return
    await generateConsultFollowUpRound(
      {
        consultSessionId: run.consultSessionId,
        actor: { type: ConsultActorType.SYSTEM, id: null },
      },
      { now },
    )
  } catch (error) {
    console.error('consult follow-up round could not be opened', {
      runId,
      error: safeError(error),
    })
  }
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
  const promotedRerunCount = await promoteDueConsultReruns(now, take)
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
    if (outcome.result === 'COMPLETED') {
      await openFollowUpRound(outcome.runId, now)
    }
  }

  // Send what was just enqueued rather than waiting for the notification
  // cron's own tick. Here rather than in the runner route so the in-request
  // KICK gets the same latency as the cron — a client who left the app is the
  // whole reason those rows exist.
  if (settled) kickNotificationDrain()

  return { scannedCount: runIds.length, outcomes, promotedRerunCount }
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
