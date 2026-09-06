// lib/consult/analysisRerun.ts
//
// P7a-3 — the rerun: what happens to a finished plan when the client changes
// her mind.
//
// The consult is a living document until the appointment, so "she added a
// photo" and "she changed a card" have to reach the plan. They must NOT reach
// it once per tap: a rerun is a direction call, ~$0.05–0.07 (handoff Part 2,
// "Cost"), and a client working through five prep cards would otherwise spend
// five of them to arrive at the same answer. Hence the two numbers in this
// file — a debounce that collapses a burst of edits into one rerun, and a cap
// that bounds what one consult can ever spend.
//
// ## Why an audit row and not a column
//
// "A rerun is pending" is derived, never stored:
//
//   a rerun is pending  ⟺  the newest ANALYSIS_RERUN_REQUESTED audit row is
//                          newer than the newest ANALYSIS revision
//
// That is exactly the fact "an input changed after the current plan was
// built", read off rows that already had to exist. A boolean column would be a
// second copy of it, and the interesting failure — a crash between the edit and
// the flag — is the one a derived answer cannot have.
//
// ## Why the cron promotes it
//
// The debounce means the rerun starts LATER than the edit that asked for it,
// so something has to come back. The every-minute analysis cron already does
// (lib/consult/analysisRunner.ts) and is already the backstop for the whole
// queue, so promotion rides on it rather than inventing a second schedule.

import 'server-only'

import {
  ConsultActorType,
  ConsultAnalysisRunStatus,
  ConsultAuditAction,
  ConsultCaptureStatus,
  ConsultRevisionKind,
  ConsultSessionStatus,
  Prisma,
} from '@prisma/client'

import type { ConsultAnalysisPayloadDTO } from '@/lib/dto/consult'
import { prisma } from '@/lib/prisma'

import { normalizeStoredConsultAnalysisPayload } from './analysisRevision'

/**
 * How long a burst of edits is collapsed into one rerun.
 *
 * Ninety seconds is a working-through-the-prep-cards pause, not a network one:
 * the point is that answering four cards in a row costs ONE direction call.
 * Every edit inside the window pushes the fire time out, so the rerun starts
 * when she stops, not when she started.
 */
export const CONSULT_RERUN_DEBOUNCE_MS = 90_000

/**
 * The most plan versions one consult may ever hold, first analysis included.
 *
 * Four means the client can rework the plan three times. At ~$0.095 a run
 * (P4b's measured figure) that is a bounded ~$0.38 for a consult that would
 * otherwise have no ceiling at all — a client who reopens the thread every
 * evening for a fortnight is a real person, not an abuser, and a cap is how
 * that stays affordable rather than becoming a reason to close the document.
 */
export const CONSULT_MAX_PLAN_VERSIONS = 4

/**
 * Record that an input changed on a consult whose plan is already built.
 *
 * Called from inside the write's own locked transaction, so an edit and its
 * rerun request commit together or not at all. A no-op on a consult that has
 * not completed its first analysis — that flow has its own entry point
 * (`startConsultAnalysis`) and its own readiness rules.
 *
 * Deliberately does NOT create the run. Creating it here would mean a burst of
 * five edits raced five inserts against the one-live-run index and four of them
 * lost with a constraint violation; the debounce is a decision about WHEN, and
 * this function only records THAT.
 */
export async function recordLockedConsultRerunRequest(
  tx: Prisma.TransactionClient,
  args: {
    consultSessionId: string
    actor: { type: ConsultActorType; id: string | null }
  },
): Promise<{ requested: boolean; reason?: 'NOT_COMPLETED' | 'CAP_REACHED' }> {
  // Read the status here rather than taking it as an argument. Four different
  // writers call this, each already holding the row lock, and a status passed
  // in is a status one of them will eventually pass stale.
  const session = await tx.consultSession.findUnique({
    where: { id: args.consultSessionId },
    select: { status: true },
  })
  if (session?.status !== ConsultSessionStatus.COMPLETED) {
    return { requested: false, reason: 'NOT_COMPLETED' }
  }

  // The cap counts VERSIONS, not runs: a failed run that retried three times is
  // three rows and one version, and it is versions the client actually gets.
  const highest = await tx.consultAnalysisRun.aggregate({
    where: { consultSessionId: args.consultSessionId },
    _max: { planVersion: true },
  })
  if ((highest._max.planVersion ?? 1) >= CONSULT_MAX_PLAN_VERSIONS) {
    return { requested: false, reason: 'CAP_REACHED' }
  }

  await tx.consultAuditEvent.create({
    data: {
      consultSessionId: args.consultSessionId,
      action: ConsultAuditAction.ANALYSIS_RERUN_REQUESTED,
      actorType: args.actor.type,
      actorId: args.actor.id,
    },
  })
  return { requested: true }
}

export type ConsultRerunPendingState = {
  /** An input changed after the current plan was built. */
  pending: boolean
  /** When the debounced rerun becomes claimable. Null when nothing is pending. */
  runAt: Date | null
  /** The version the current plan is, so the thread can name it. */
  planVersion: number
  /** False once the consult has spent its allowance. */
  moreVersionsAvailable: boolean
  /**
   * The rerun cannot run because there is no usable photograph left: the client
   * did not opt into chart copy, so completion purged the raw captures.
   *
   * Computed here rather than discovered when the cron tries, so the thread can
   * ask for a photo NOW instead of showing a spinner for ninety seconds and
   * then a failure. Part 0 rule 4: the client is told, never quietly served the
   * old observations again.
   */
  photosExpired: boolean
}

const PENDING_SELECT = {
  id: true,
  status: true,
} satisfies Prisma.ConsultSessionSelect

/**
 * Is a rerun pending for this consult, and when would it fire?
 *
 * Read by the thread (to say "updating your plan") and by the cron (to promote
 * it). One function, because a thread that promised an update the cron will
 * never make is worse than no promise.
 */
export async function resolveConsultRerunState(
  tx: Prisma.TransactionClient,
  consultSessionId: string,
): Promise<ConsultRerunPendingState> {
  const [latestAnalysis, latestRequest, highest, liveRun] = await Promise.all([
    tx.consultRevision.findFirst({
      where: { consultSessionId, kind: ConsultRevisionKind.ANALYSIS },
      orderBy: [{ revision: 'desc' }, { id: 'desc' }],
      select: { createdAt: true },
    }),
    tx.consultAuditEvent.findFirst({
      where: {
        consultSessionId,
        action: ConsultAuditAction.ANALYSIS_RERUN_REQUESTED,
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      select: { createdAt: true },
    }),
    tx.consultAnalysisRun.aggregate({
      where: { consultSessionId },
      _max: { planVersion: true },
    }),
    tx.consultAnalysisRun.findFirst({
      where: {
        consultSessionId,
        status: {
          in: [ConsultAnalysisRunStatus.QUEUED, ConsultAnalysisRunStatus.RUNNING],
        },
      },
      select: { id: true, runAt: true },
    }),
  ])

  // The same predicate `consult_revision_requires_agreements` applies to an
  // ANALYSIS revision, minus the pack/prompt-version detail: accepted, not
  // purge-marked, not expired. If none survives, a rerun has nothing to read.
  const usablePhotos = await tx.consultCapture.count({
    where: {
      consultSessionId,
      status: ConsultCaptureStatus.ACCEPTED,
      purgedAt: null,
      purgeEligibleAt: null,
      purgeRequestedAt: null,
      rawExpiresAt: { gt: new Date() },
    },
  })

  const planVersion = await countConsultPlanVersions(tx, consultSessionId)
  const moreVersionsAvailable =
    (highest._max.planVersion ?? 0) < CONSULT_MAX_PLAN_VERSIONS

  // A live run IS the pending update, whatever asked for it.
  if (liveRun) {
    return {
      pending: true,
      runAt: liveRun.runAt,
      planVersion,
      moreVersionsAvailable,
      photosExpired: false,
    }
  }

  const pending = Boolean(
    latestRequest &&
      (!latestAnalysis || latestRequest.createdAt > latestAnalysis.createdAt),
  )
  return {
    pending,
    runAt:
      pending && latestRequest
        ? new Date(latestRequest.createdAt.getTime() + CONSULT_RERUN_DEBOUNCE_MS)
        : null,
    planVersion,
    moreVersionsAvailable,
    photosExpired: pending && usablePhotos === 0,
  }
}

/**
 * How many plan versions this consult holds.
 *
 * Counted off the revisions rather than off the runs: a version the client can
 * open is an ANALYSIS revision, and a run that never published is not one.
 */
export async function countConsultPlanVersions(
  tx: Prisma.TransactionClient,
  consultSessionId: string,
): Promise<number> {
  return tx.consultRevision.count({
    where: { consultSessionId, kind: ConsultRevisionKind.ANALYSIS },
  })
}

/**
 * Consults whose debounced rerun is due, oldest request first.
 *
 * Deliberately returns SESSION ids and not run ids: the run does not exist yet.
 * The caller creates it through `startConsultAnalysisRerun`, which is the one
 * place that knows how to price a version and pin it.
 */
export async function dueConsultRerunSessionIds(args: {
  now: Date
  take: number
}): Promise<string[]> {
  const readyBefore = new Date(args.now.getTime() - CONSULT_RERUN_DEBOUNCE_MS)
  const rows = await prisma.consultAuditEvent.findMany({
    where: {
      action: ConsultAuditAction.ANALYSIS_RERUN_REQUESTED,
      createdAt: { lte: readyBefore },
      consultSession: {
        status: ConsultSessionStatus.COMPLETED,
        // Nothing may already be in flight: the one-live-run index would refuse
        // the insert anyway, and asking here turns a constraint violation into
        // a row this sweep simply skips.
        analysisRuns: {
          none: {
            status: {
              in: [
                ConsultAnalysisRunStatus.QUEUED,
                ConsultAnalysisRunStatus.RUNNING,
              ],
            },
          },
        },
      },
    },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    select: { consultSessionId: true, createdAt: true },
    // Over-read: several requests can belong to one consult (that is what the
    // debounce is), and the newest of them is what decides whether the wait is
    // really over. Deduped below.
    take: Math.max(args.take * 8, 24),
  })

  const seen = new Set<string>()
  const due: string[] = []
  for (const row of rows) {
    if (seen.has(row.consultSessionId)) continue
    seen.add(row.consultSessionId)
    due.push(row.consultSessionId)
    if (due.length >= args.take) break
  }

  // 🔴 The rows above are the OLDEST requests. A consult still inside its
  // debounce window has a newer request that this query did not see, so each
  // candidate is re-asked properly before it is promoted — otherwise the first
  // edit of a burst would fire the rerun that the fifth was supposed to delay.
  const settled: string[] = []
  for (const consultSessionId of due) {
    const state = await resolveConsultRerunState(prisma, consultSessionId)
    if (!state.pending || !state.runAt) continue
    if (state.runAt.getTime() > args.now.getTime()) continue
    if (!state.moreVersionsAvailable) continue
    settled.push(consultSessionId)
  }
  return settled
}

export const CONSULT_RERUN_SESSION_SELECT = PENDING_SELECT

export type ConsultPlanVersion = {
  revisionId: string
  revision: number
  createdAt: Date
  /**
   * Null when this consult holds only ONE version: there is nothing to diff it
   * against, so the payload is never read. Callers that diff must skip a null
   * — and with one version there is no pair to skip.
   */
  analysis: ConsultAnalysisPayloadDTO | null
}

/**
 * Every plan version this consult holds, OLDEST first.
 *
 * Oldest first because the thread renders the diffs in the order they happened
 * — v1→v2, then v2→v3 — and reversing that would tell the story backwards.
 *
 * 🔴 A revision whose payload will not project is SKIPPED, not thrown on. A
 * stored artefact from a schema version this build can no longer read is a real
 * possibility across a deploy, and one unreadable old version must not take the
 * whole thread down with it — the client's current plan is the one that matters
 * and it is the newest.
 */
export async function loadConsultPlanVersions(
  consultSessionId: string,
): Promise<ConsultPlanVersion[]> {
  // 🔴 Count before reading. The thread is POLLED while a run is going, and an
  // analysis payload is several KB of JSON — loading and normalizing up to four
  // of them on every poll to discover there is only one, and therefore nothing
  // to diff, is the whole cost for none of the benefit. The overwhelmingly
  // common shape is exactly one version.
  const versionCount = await countConsultPlanVersions(prisma, consultSessionId)
  if (versionCount < 2) {
    if (versionCount === 0) return []
    const only = await prisma.consultRevision.findFirstOrThrow({
      where: { consultSessionId, kind: ConsultRevisionKind.ANALYSIS },
      select: { id: true, revision: true, createdAt: true },
    })
    // The payload is deliberately NOT read: with one version there is nothing
    // to compare it against, and the plan card renders from its own state.
    return [
      {
        revisionId: only.id,
        revision: only.revision,
        createdAt: only.createdAt,
        analysis: null,
      },
    ]
  }

  const rows = await prisma.consultRevision.findMany({
    where: { consultSessionId, kind: ConsultRevisionKind.ANALYSIS },
    orderBy: [{ revision: 'asc' }, { id: 'asc' }],
    select: {
      id: true,
      revision: true,
      createdAt: true,
      payload: true,
      schemaVersion: true,
    },
  })

  const versions: ConsultPlanVersion[] = []
  for (const row of rows) {
    try {
      versions.push({
        revisionId: row.id,
        revision: row.revision,
        createdAt: row.createdAt,
        analysis: normalizeStoredConsultAnalysisPayload(
          row.payload,
          row.schemaVersion,
        ),
      })
    } catch {
      continue
    }
  }
  return versions
}
