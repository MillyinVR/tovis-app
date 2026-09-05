// lib/consult/analysisRun.ts
//
// P4b: the ConsultAnalysisRun record — the queue, the lease, the stage, and
// the client-facing projection of all three.
//
// This file owns run-row writes and nothing else. It deliberately imports
// nothing from analysisContract.ts (which owns the pipeline) so the dependency
// runs one way: contract → run, runner → both.
//
// ## The rule this file exists to hold
//
// The lifecycle CLAIM (ANALYSIS_PENDING → ANALYZING) is permitted at most once
// per consult, for all time, by a partial unique index on the audit trail
// (`ConsultAuditEvent_one_analysis_claim_transition`, migration
// 20260908000000). Before P4b that was invisible, because the claim and the
// provider calls shared one transaction: a failure rolled the claim back and
// nothing had ever been committed.
//
// A background run commits the claim. So a retry can NEVER walk the session
// back to ANALYSIS_PENDING and claim again — the audit insert would violate
// that index and the consult would be permanently wedged in a state no screen
// offers a way out of. Instead the session STAYS in ANALYZING and the retry is
// a new run row. Two levels of retry, deliberately different:
//
//   * `attemptCount` — the worker's own budget for a transient failure
//     (provider timeout, storage blip). Same row, re-queued with backoff.
//   * a NEW run — what the client's retry button creates, once the previous
//     run has exhausted its attempts and gone FAILED.
//
// A partial unique index (`ConsultAnalysisRun_one_live_run_per_session`) keeps
// at most one QUEUED-or-RUNNING run per consult, so neither path can produce
// two workers paying for the same analysis twice.

import 'server-only'

import {
  ConsultAnalysisRunStage,
  ConsultAnalysisRunStatus,
  Prisma,
} from '@prisma/client'

import type { ConsultAnalysisRunDTO } from '@/lib/dto/consult'
import { prisma } from '@/lib/prisma'

/**
 * Backoff before a re-queued attempt becomes claimable again.
 *
 * Short on purpose: a client is watching a spinner. The cron backstop runs
 * every minute, and the in-request kick usually picks the retry up sooner than
 * that, so this is the floor rather than the expected wait.
 */
const RUN_RETRY_BACKOFF_MS = 15_000

/**
 * How long a RUNNING run may hold its lease before another worker may take it.
 *
 * Must exceed the worst case the pipeline can legitimately take — 50s
 * inspiration + 45s profile + 150s direction = 245s of provider time, plus
 * image reads and the finalize transaction. 420s leaves headroom without
 * leaving a client staring at a dead run for long. A run whose function was
 * killed mid-flight (a deploy, an OOM) is recovered by exactly this path.
 */
const STALE_LEASE_MS = 420_000

export const CONSULT_ANALYSIS_RUN_SELECT = {
  id: true,
  consultSessionId: true,
  status: true,
  stage: true,
  attemptCount: true,
  maxAttempts: true,
  idempotencyKey: true,
  schemaVersion: true,
  promptVersion: true,
  requestHash: true,
  photoCount: true,
  runAt: true,
  claimedAt: true,
  startedAt: true,
  finishedAt: true,
  failureCode: true,
  lastError: true,
  analysisRevisionId: true,
  createdAt: true,
} satisfies Prisma.ConsultAnalysisRunSelect

export type ConsultAnalysisRunRow = Prisma.ConsultAnalysisRunGetPayload<{
  select: typeof CONSULT_ANALYSIS_RUN_SELECT
}>

/** QUEUED and RUNNING are the two states a client is still waiting through. */
export function isLiveConsultAnalysisRun(row: {
  status: ConsultAnalysisRunStatus
}): boolean {
  return (
    row.status === ConsultAnalysisRunStatus.QUEUED ||
    row.status === ConsultAnalysisRunStatus.RUNNING
  )
}

/**
 * The wire shape. `retryable` is computed here rather than by each client, so
 * web and iOS cannot disagree about when the retry button is live.
 */
export function mapConsultAnalysisRun(
  row: ConsultAnalysisRunRow,
): ConsultAnalysisRunDTO {
  return {
    runId: row.id,
    status: row.status,
    stage: row.stage,
    photoCount: row.photoCount,
    attemptCount: row.attemptCount,
    maxAttempts: row.maxAttempts,
    queuedAt: row.createdAt.toISOString(),
    startedAt: row.startedAt?.toISOString() ?? null,
    finishedAt: row.finishedAt?.toISOString() ?? null,
    failureCode: row.failureCode,
    retryable: row.status === ConsultAnalysisRunStatus.FAILED,
  }
}

/** The newest run for a consult, or null. The client's poll reads this. */
export async function latestConsultAnalysisRun(
  db: Prisma.TransactionClient,
  consultSessionId: string,
): Promise<ConsultAnalysisRunRow | null> {
  return db.consultAnalysisRun.findFirst({
    where: { consultSessionId },
    select: CONSULT_ANALYSIS_RUN_SELECT,
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
  })
}

/**
 * Create the run for a claim that has just been made.
 *
 * Called INSIDE the claim transaction, so the run row and the ANALYZING
 * transition commit together: there is no instant at which a consult is
 * ANALYZING with nothing scheduled to analyze it.
 */
export async function createLockedConsultAnalysisRun(
  tx: Prisma.TransactionClient,
  args: {
    consultSessionId: string
    idempotencyKey: string
    schemaVersion: number
    promptVersion: string
    requestHash: string
    photoCount: number
    now: Date
  },
): Promise<ConsultAnalysisRunRow> {
  return tx.consultAnalysisRun.create({
    data: {
      consultSessionId: args.consultSessionId,
      idempotencyKey: args.idempotencyKey,
      schemaVersion: args.schemaVersion,
      promptVersion: args.promptVersion,
      requestHash: args.requestHash,
      photoCount: args.photoCount,
      runAt: args.now,
    },
    select: CONSULT_ANALYSIS_RUN_SELECT,
  })
}

/**
 * Take the lease on one run, atomically.
 *
 * Two shapes are claimable, and the `where` says so rather than a comment:
 *   * a QUEUED run whose `runAt` has arrived;
 *   * a RUNNING run whose lease has expired — the crashed-worker case.
 *
 * `updateMany` + a status/lease predicate is the whole concurrency story: two
 * workers racing the same row produce one winner and one `count === 0`.
 */
export async function claimConsultAnalysisRun(args: {
  runId: string
  now: Date
}): Promise<ConsultAnalysisRunRow | null> {
  const staleBefore = new Date(args.now.getTime() - STALE_LEASE_MS)
  const claimed = await prisma.consultAnalysisRun.updateMany({
    where: {
      id: args.runId,
      OR: [
        { status: ConsultAnalysisRunStatus.QUEUED, runAt: { lte: args.now } },
        {
          status: ConsultAnalysisRunStatus.RUNNING,
          claimedAt: { lt: staleBefore },
        },
      ],
    },
    data: {
      status: ConsultAnalysisRunStatus.RUNNING,
      stage: ConsultAnalysisRunStage.READING_PHOTOS,
      claimedAt: args.now,
      startedAt: args.now,
      attemptCount: { increment: 1 },
    },
  })
  if (claimed.count !== 1) return null

  return prisma.consultAnalysisRun.findUnique({
    where: { id: args.runId },
    select: CONSULT_ANALYSIS_RUN_SELECT,
  })
}

/**
 * Runs the worker should look at, oldest first.
 *
 * Includes expired RUNNING leases for the same reason `claimConsultAnalysisRun`
 * accepts them: a run whose worker died is otherwise invisible forever, and the
 * client is left on a spinner with no failure and no result.
 */
export async function dueConsultAnalysisRunIds(args: {
  now: Date
  take: number
}): Promise<string[]> {
  const staleBefore = new Date(args.now.getTime() - STALE_LEASE_MS)
  const rows = await prisma.consultAnalysisRun.findMany({
    where: {
      OR: [
        { status: ConsultAnalysisRunStatus.QUEUED, runAt: { lte: args.now } },
        {
          status: ConsultAnalysisRunStatus.RUNNING,
          claimedAt: { lt: staleBefore },
        },
      ],
    },
    select: { id: true },
    orderBy: [{ runAt: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
    take: args.take,
  })
  return rows.map((row) => row.id)
}

/**
 * Move a running run to its next stage. Guarded on RUNNING so a stage write
 * from a worker whose lease was stolen cannot overwrite the new worker's
 * progress — the client would see the bar go backwards.
 */
export async function advanceConsultAnalysisRunStage(args: {
  runId: string
  stage: ConsultAnalysisRunStage
}): Promise<void> {
  await prisma.consultAnalysisRun.updateMany({
    where: { id: args.runId, status: ConsultAnalysisRunStatus.RUNNING },
    data: { stage: args.stage },
  })
}

/**
 * Terminal success. Written in the SAME transaction as the artefact, so
 * "COMPLETED" and "there is a revision to open" are one fact, not two.
 */
export async function completeLockedConsultAnalysisRun(
  tx: Prisma.TransactionClient,
  args: { runId: string; analysisRevisionId: string; finishedAt: Date },
): Promise<void> {
  const updated = await tx.consultAnalysisRun.updateMany({
    where: { id: args.runId, status: ConsultAnalysisRunStatus.RUNNING },
    data: {
      status: ConsultAnalysisRunStatus.COMPLETED,
      stage: ConsultAnalysisRunStage.DONE,
      analysisRevisionId: args.analysisRevisionId,
      finishedAt: args.finishedAt,
      claimedAt: null,
      failureCode: null,
      lastError: null,
    },
  })
  if (updated.count !== 1) {
    // The lease was stolen mid-finalize. Rolling the whole transaction back is
    // the only safe answer: the other worker is about to write the same
    // artefact, and `one_analysis_per_session` will let exactly one of us win.
    throw new Error(
      `consult analysis run ${args.runId} was not RUNNING at finalize`,
    )
  }
}

export type ConsultAnalysisRunFailure = {
  runId: string
  /** A code from the consult error vocabulary — never a raw provider message. */
  failureCode: string
  message: string
  now: Date
  /**
   * A failure the same inputs would reproduce (a stale schema version, a
   * changed prerequisite). Retrying it just spends money to fail again, so it
   * skips the attempt budget and goes straight to FAILED.
   */
  terminal?: boolean
}

/**
 * Record a failed attempt: re-queue with backoff while attempts remain,
 * otherwise mark the run FAILED.
 *
 * Returns which of the two happened — the caller uses it to decide whether to
 * notify the client, because a re-queued attempt is not a failure she should
 * hear about.
 */
export async function failConsultAnalysisRunAttempt(
  args: ConsultAnalysisRunFailure,
): Promise<{ outcome: 'RETRY_SCHEDULED' | 'FAILED_FINAL'; runAt: Date | null }> {
  const row = await prisma.consultAnalysisRun.findUnique({
    where: { id: args.runId },
    select: { attemptCount: true, maxAttempts: true, status: true },
  })
  if (!row) return { outcome: 'FAILED_FINAL', runAt: null }

  const exhausted = args.terminal || row.attemptCount >= row.maxAttempts
  if (exhausted) {
    await prisma.consultAnalysisRun.updateMany({
      where: { id: args.runId, status: ConsultAnalysisRunStatus.RUNNING },
      data: {
        status: ConsultAnalysisRunStatus.FAILED,
        finishedAt: args.now,
        claimedAt: null,
        failureCode: args.failureCode,
        lastError: args.message.slice(0, 1_000),
      },
    })
    return { outcome: 'FAILED_FINAL', runAt: null }
  }

  const runAt = new Date(args.now.getTime() + RUN_RETRY_BACKOFF_MS)
  await prisma.consultAnalysisRun.updateMany({
    where: { id: args.runId, status: ConsultAnalysisRunStatus.RUNNING },
    data: {
      status: ConsultAnalysisRunStatus.QUEUED,
      // Keep the stage it died in: it is the cheapest signal for where the
      // pipeline loses runs, and the client's copy reads status before stage.
      runAt,
      claimedAt: null,
      failureCode: args.failureCode,
      lastError: args.message.slice(0, 1_000),
    },
  })
  return { outcome: 'RETRY_SCHEDULED', runAt }
}
