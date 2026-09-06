import 'server-only'

import { createHash } from 'node:crypto'
import { ConsultActorType, ConsultRevisionKind, Prisma } from '@prisma/client'

import type { ConsultInspirationAnalysisDTO } from '@/lib/dto/consult'
import { logAiConsultInspirationAnalysis } from '@/lib/observability/aiConsultEvents'
import { prisma } from '@/lib/prisma'

import { requireCurrentConsultAgreementAcceptances } from './agreementContract'
import { ConsultWriteError } from './errors'
import { fetchConsultInspirationImage } from './inspirationImage'
import {
  lockConsultSessionRow,
  mintConsultInspirationReadUrl,
  requireLockedConsultInspirationStageScope,
  resolveLockedConsultInspirationReadTarget,
  sourceDto,
  type ConsultInspirationReadTarget,
} from './inspirationContract'
import type { ConsultInspirationStorage } from './inspirationStorage'
import type { ConsultProviderMeterSink } from './providerMeter'
import { normalizeStoredConsultInspirationAnalysis } from './inspirationAnalysisRead'
import {
  CONSULT_INSPIRATION_ANALYSIS_FIELDS,
  CONSULT_INSPIRATION_ANALYSIS_PROMPT_VERSION,
  CONSULT_INSPIRATION_ANALYSIS_SCHEMA_VERSION,
  ConsultInspirationVisionError,
  countKnownConsultInspirationAttributes,
  runConsultInspirationVision,
  toConsultInspirationAnalysisJson,
  type ConsultInspirationAnalysis,
  type ConsultInspirationVisionProvider,
} from './inspirationVision'
import { appendLockedConsultInspirationAnalysisRevision } from './writeBoundary'

/**
 * P4 — Stage 1 of the consultation pipeline.
 *
 * Reads the client's active inspiration reference with the vision model and
 * stores the result as its own immutable revision, identified by the
 * inspiration ROW it read (P5b — see the request-hash note below for why it is
 * no longer the guided-inspiration revision).
 *
 * WHERE IT RUNS (P5b): in its OWN stage, in MEDIA_READY, the moment the client
 * has attached a reference — `readConsultInspiration` below. The analysis run
 * still composes the same three phases, and now almost always finds the
 * artefact already written and pays nothing.
 *
 * Why it moved: P5's inspiration cards are generated FROM this reading, and
 * they are shown before the client has answered anything. The read could not
 * stay inside a run that cannot start until she has.
 *
 * WHERE IT RUNS (P4b): in the background worker, in ANALYZING, split across
 * the run's three phases —
 *
 *   1. `prepareConsultInspirationRead`  — read-only, no lock. Resolves the
 *      target and the request hash, and returns an already-stored artefact if
 *      this exact reference has been read under this exact prompt before.
 *   2. `performConsultInspirationRead`  — the paid call. NO database handle at
 *      all, by signature: this is the phase that must not be able to hold a
 *      row lock while a model is thinking.
 *   3. `persistLockedConsultInspirationAnalysis` — the revision write, inside
 *      the finalize transaction alongside the analysis artefact.
 *
 * `analyzeLockedConsultInspiration` still composes all three for the narrow
 * re-read entry point below, which is not on the analysis path.
 *
 * SPEND: it is a paid provider call in the same run as the two analysis calls,
 * so it sits inside the SAME `client:consult:vision` rate-limit bucket the
 * analysis route enforces at start time (40/day/user). No new bucket — what
 * that bucket bounds is total provider spend per client, and this is part of
 * it. One analysis attempt costs three calls, all three metered
 * (lib/consult/providerMeter.ts).
 */

/**
 * The session fields the read target needs. Kept beside the caller rather than
 * re-exported from the inspiration contract so the select and the type that
 * consumes it are checked together.
 */
export const CONSULT_INSPIRATION_ANALYSIS_SESSION_SELECT = {
  id: true,
  clientId: true,
  professionalId: true,
} satisfies Prisma.ConsultSessionSelect

type InspirationSessionScope = Parameters<
  typeof resolveLockedConsultInspirationReadTarget
>[1]

export type ConsultInspirationAnalysisArtefact = {
  revisionId: string
  inspirationId: string
  source: ConsultInspirationAnalysisDTO['source']
  model: string
  analysis: ConsultInspirationAnalysis
}

/**
 * The artefact's own request identity — what makes it "keyed to the
 * inspiration ROW". Two reads of the same photograph under the same prompt
 * hash identically; a swapped reference or a prompt bump does not.
 *
 * 🔴 It used to include the guided-inspiration REVISION id, and that was a
 * standing double charge. Every answer the client gives writes a new
 * INSPIRATION revision, so the revision current when the artefact was written
 * is never the revision current when the analysis runs: the hash missed, the
 * reference was read and billed a second time (~$0.012), and a duplicate
 * artefact was stored. The reading describes a PHOTOGRAPH — it cannot change
 * because she answered a question about it — so the photograph is what
 * identifies it. (P5b; the same change is what lets the read happen before any
 * revision exists at all.)
 */
function inspirationAnalysisRequestHash(args: {
  inspirationId: string
  promptVersion: string
  schemaVersion: number
}): string {
  return createHash('sha256').update(JSON.stringify(args)).digest('hex')
}

/**
 * The analysis run's idempotency key, namespaced. The ANALYSIS revision uses
 * the client's key verbatim and `ConsultRevision` is uniquely indexed on
 * (consultSessionId, idempotencyKey) — so reusing it here would collide with
 * the analysis row written moments later in the same transaction.
 */
function inspirationAnalysisIdempotencyKey(analysisIdempotencyKey: string): string {
  return `inspiration-analysis:${analysisIdempotencyKey}`.slice(0, 128)
}

function toArtefactPayload(args: {
  inspirationId: string
  source: ConsultInspirationAnalysisDTO['source']
  analysis: ConsultInspirationAnalysis
}): Prisma.InputJsonObject {
  return {
    schemaVersion: CONSULT_INSPIRATION_ANALYSIS_SCHEMA_VERSION,
    inspirationId: args.inspirationId,
    source: args.source,
    attributes: toConsultInspirationAnalysisJson(args.analysis),
  }
}

function surfacedFailure(kind: ConsultInspirationVisionError['kind']): ConsultWriteError {
  // `unreadable` is about THIS PHOTOGRAPH — the model looked and could name
  // nothing — so the client is asked for a clearer one. Everything else is the
  // provider, and is a retry. Neither ever degrades to a static question list.
  return kind === 'unreadable'
    ? new ConsultWriteError(
        'INSPIRATION_ANALYSIS_UNREADABLE',
        'We could not read this inspiration photo.',
      )
    : new ConsultWriteError(
        'INSPIRATION_ANALYSIS_UNAVAILABLE',
        'Inspiration analysis is unavailable.',
      )
}

/**
 * Phase 1 — read-only. Resolve which reference this run reads, and whether it
 * has already been read under this exact prompt.
 *
 * Takes a plain `db` handle rather than a transaction because it must be safe
 * to call OUTSIDE one: the worker runs it with no lock held. The "locked"
 * naming stays off this function deliberately — nothing here is locked.
 */
export async function prepareConsultInspirationRead(
  db: Prisma.TransactionClient,
  args: {
    session: InspirationSessionScope
    now: Date
  },
): Promise<ConsultInspirationReadPlan> {
  const target: ConsultInspirationReadTarget =
    await resolveLockedConsultInspirationReadTarget(db, args.session, args.now)
  const requestHash = inspirationAnalysisRequestHash({
    inspirationId: target.inspirationId,
    promptVersion: CONSULT_INSPIRATION_ANALYSIS_PROMPT_VERSION,
    schemaVersion: CONSULT_INSPIRATION_ANALYSIS_SCHEMA_VERSION,
  })

  return {
    target,
    requestHash,
    artefact: await findStoredConsultInspirationArtefact(db, {
      consultSessionId: args.session.id,
      requestHash,
    }),
  }
}

/**
 * An artefact already read against this exact reference under this exact
 * prompt is the same artefact. Reuse it rather than paying for the call again
 * — the request hash is what makes that safe to say.
 *
 * Two callers, on purpose: `prepareConsultInspirationRead` asks before paying,
 * and the persist phase asks AGAIN under the row lock. The second ask is what
 * bounds a race between two clients (or a client and the analysis worker)
 * arriving at an unread reference at once — both may pay, but only one
 * artefact is ever stored, so nothing downstream sees two readings of one
 * photograph.
 */
async function findStoredConsultInspirationArtefact(
  db: Prisma.TransactionClient,
  args: { consultSessionId: string; requestHash: string },
): Promise<ConsultInspirationAnalysisArtefact | null> {
  const existing = await db.consultRevision.findFirst({
    where: {
      consultSessionId: args.consultSessionId,
      kind: ConsultRevisionKind.INSPIRATION_ANALYSIS,
      requestHash: args.requestHash,
    },
    select: {
      id: true,
      payload: true,
      schemaVersion: true,
      promptVersion: true,
      model: true,
      createdAt: true,
    },
    orderBy: [{ revision: 'desc' }, { id: 'desc' }],
  })
  if (!existing) return null
  const stored = normalizeStoredConsultInspirationAnalysis(existing)
  const analysis = storedAnalysis(stored)
  if (!stored || !analysis) return null
  return {
    revisionId: stored.revisionId,
    inspirationId: stored.inspirationId,
    source: stored.source,
    model: stored.model,
    analysis,
  }
}

export type ConsultInspirationReadPlan = {
  target: ConsultInspirationReadTarget
  requestHash: string
  /** Non-null when this reference was already read — no call is needed. */
  artefact: ConsultInspirationAnalysisArtefact | null
}

/** What phase 2 produces and phase 3 writes. */
export type ConsultInspirationReadResult = {
  source: ConsultInspirationAnalysisDTO['source']
  model: string
  analysis: ConsultInspirationAnalysis
}

/**
 * Phase 2 — the paid call, and NOTHING else.
 *
 * 🔴 The absence of a database parameter here is the P4b contract, not an
 * oversight. Before P4b this work ran inside the analysis transaction, so a
 * `SELECT ... FOR UPDATE` on the consult was held for the whole of a model's
 * thinking time. A signature that cannot accept a transaction cannot
 * accidentally regain that behaviour.
 */
export async function performConsultInspirationRead(args: {
  plan: ConsultInspirationReadPlan
  consultSessionId: string
  clientId: string
  storage?: ConsultInspirationStorage
  provider?: ConsultInspirationVisionProvider
  meter?: ConsultProviderMeterSink | null
}): Promise<ConsultInspirationReadResult> {
  const startedAt = Date.now()
  const source = sourceDto(args.plan.target.source)
  const provider = args.provider ?? runConsultInspirationVision
  let result
  try {
    const read = await mintConsultInspirationReadUrl(
      args.plan.target,
      args.storage,
    )
    const image = await fetchConsultInspirationImage(read.url)
    result = await provider({ image, meter: args.meter })
  } catch (error) {
    logAiConsultInspirationAnalysis({
      consultId: args.consultSessionId,
      clientId: args.clientId,
      source,
      outcome:
        error instanceof ConsultInspirationVisionError
          ? (
              {
                unavailable: 'UNAVAILABLE',
                refused: 'REFUSED',
                bad_output: 'BAD_OUTPUT',
                unreadable: 'UNREADABLE',
              } as const
            )[error.kind]
          : 'UNAVAILABLE',
      knownAttributeCount: null,
      model: null,
      durationMs: Date.now() - startedAt,
    })
    if (error instanceof ConsultInspirationVisionError) throw surfacedFailure(error.kind)
    // A storage/read refusal is already a typed ConsultWriteError with its own
    // surfaced state; anything else is a bug and must not be swallowed.
    throw error
  }

  logAiConsultInspirationAnalysis({
    consultId: args.consultSessionId,
    clientId: args.clientId,
    source,
    outcome: 'OK',
    knownAttributeCount: countKnownConsultInspirationAttributes(result.analysis),
    model: result.model,
    durationMs: Date.now() - startedAt,
  })

  return { source, model: result.model, analysis: result.analysis }
}

/**
 * Phase 3 — the revision write, in the caller's finalize transaction.
 *
 * The lifecycle pin on this revision kind admits ANALYZING only, which is
 * exactly where the finalize transaction runs.
 */
export async function persistLockedConsultInspirationAnalysis(
  tx: Prisma.TransactionClient,
  args: {
    consultSessionId: string
    plan: ConsultInspirationReadPlan
    read: ConsultInspirationReadResult
    analysisIdempotencyKey: string
    actor: { type: typeof ConsultActorType.CLIENT; id: string }
  },
): Promise<ConsultInspirationAnalysisArtefact> {
  // Under the lock, and only now: did someone else store this same reading
  // while this caller was paying for it? If so theirs stands and this one is
  // dropped. Writing both would leave two artefacts for one photograph, and
  // every reader here takes the newest — so which reading the brief showed
  // would depend on insert order.
  const raced = await findStoredConsultInspirationArtefact(tx, {
    consultSessionId: args.consultSessionId,
    requestHash: args.plan.requestHash,
  })
  if (raced) return raced

  const revision = await appendLockedConsultInspirationAnalysisRevision(tx, {
    consultSessionId: args.consultSessionId,
    payload: toArtefactPayload({
      inspirationId: args.plan.target.inspirationId,
      source: args.read.source,
      analysis: args.read.analysis,
    }),
    model: args.read.model,
    idempotencyKey: inspirationAnalysisIdempotencyKey(args.analysisIdempotencyKey),
    requestHash: args.plan.requestHash,
    actor: args.actor,
  })

  return {
    revisionId: revision.id,
    inspirationId: args.plan.target.inspirationId,
    source: args.read.source,
    model: args.read.model,
    analysis: args.read.analysis,
  }
}

/**
 * The locked core, composed from the three phases above. The caller owns the
 * transaction and has already taken the ConsultSession row FOR UPDATE and
 * re-checked scope and consent.
 *
 * ⚠️ This composition DOES hold the row lock across the paid call, so it is no
 * longer on the analysis path — the worker calls the three phases separately.
 * It survives for the narrow standalone re-read (`analyzeConsultInspiration`),
 * where there is no analysis in flight and the whole operation is one call.
 */
export async function analyzeLockedConsultInspiration(
  tx: Prisma.TransactionClient,
  args: {
    session: InspirationSessionScope
    clientId: string
    analysisIdempotencyKey: string
    actor: { type: typeof ConsultActorType.CLIENT; id: string }
    now: Date
    storage?: ConsultInspirationStorage
    provider?: ConsultInspirationVisionProvider
    meter?: ConsultProviderMeterSink | null
  },
): Promise<ConsultInspirationAnalysisArtefact> {
  const plan = await prepareConsultInspirationRead(tx, {
    session: args.session,
    now: args.now,
  })
  if (plan.artefact) return plan.artefact

  const read = await performConsultInspirationRead({
    plan,
    consultSessionId: args.session.id,
    clientId: args.clientId,
    storage: args.storage,
    provider: args.provider,
    meter: args.meter,
  })

  return persistLockedConsultInspirationAnalysis(tx, {
    consultSessionId: args.session.id,
    plan,
    read,
    analysisIdempotencyKey: args.analysisIdempotencyKey,
    actor: args.actor,
  })
}

/** The DTO's attributes back into the engine's type — same shape, same values. */
function storedAnalysis(
  stored: ConsultInspirationAnalysisDTO | null,
): ConsultInspirationAnalysis | null {
  if (!stored) return null
  const analysis: Record<string, unknown> = {}
  for (const field of CONSULT_INSPIRATION_ANALYSIS_FIELDS) {
    const observed = stored.attributes[field]
    analysis[field] = {
      value: observed.value,
      confidence: { ...observed.confidence },
      evidence: [...observed.evidence],
      region: observed.region ? { ...observed.region } : null,
    }
  }
  return analysis as ConsultInspirationAnalysis
}

/**
 * P5b — THE STAGE. Read the client's reference now, in MEDIA_READY, as its own
 * step in the flow.
 *
 * This is the entry point the client calls once she has attached a reference,
 * and it is the one that makes P5's cards possible: they are generated from
 * this artefact, and they are shown before she has answered anything.
 *
 * It is `analyzeLockedConsultInspiration` with the lock DROPPED across the paid
 * call — the P4b split, applied here for the same reason it was applied there.
 * Three steps, and the middle one holds nothing:
 *
 *   1. a short transaction: lock, scope, consent, resolve the target, and
 *      return early if this photograph has already been read;
 *   2. no transaction at all: the paid call;
 *   3. a short transaction: re-lock, re-check scope and consent, and write.
 *
 * Phase 3 re-runs the whole scope check rather than trusting phase 1's answer.
 * Consent can be revoked, and the consult can leave MEDIA_READY, while the
 * model is thinking — a reading that arrives after either must not be stored.
 */
export async function readConsultInspiration(args: {
  consultSessionId: string
  clientId: string
  actor: { type: typeof ConsultActorType.CLIENT; id: string }
  idempotencyKey: string
  now?: Date
  storage?: ConsultInspirationStorage
  provider?: ConsultInspirationVisionProvider
  meter?: ConsultProviderMeterSink | null
}): Promise<ConsultInspirationAnalysisArtefact> {
  const now = args.now ?? new Date()
  const scopeArgs = {
    consultSessionId: args.consultSessionId,
    clientId: args.clientId,
    actorUserId: args.actor.id,
    now,
  }

  // ── Phase 1: what are we reading, and has it been read? ──────────────────
  const plan = await prisma.$transaction(async (tx) => {
    await lockConsultSessionRow(tx, args.consultSessionId, 'SHARE')
    const session = await requireLockedConsultInspirationStageScope(tx, scopeArgs)
    return prepareConsultInspirationRead(tx, { session, now })
  })
  if (plan.artefact) return plan.artefact

  // ── Phase 2: the paid call, with nothing held ────────────────────────────
  //
  // 🔴 METERED by default, with no run to attach to. Every other paid call in
  // this pipeline is metered by the analysis worker, which owns the run and
  // supplies the sink; this one has no run — it happens before the analysis
  // exists, and often before the booking does. An unmetered default would have
  // made the one call that moved OUTSIDE the run the one call that stopped
  // being counted, so a consult's cost line would quietly under-report by the
  // read it now always makes. `analysisRunId` is nullable exactly for this.
  const read = await performConsultInspirationRead({
    plan,
    consultSessionId: args.consultSessionId,
    clientId: args.clientId,
    storage: args.storage,
    provider: args.provider,
    meter:
      args.meter === undefined
        ? { consultSessionId: args.consultSessionId, analysisRunId: null }
        : args.meter,
  })

  // ── Phase 3: write it, under the lock, against re-checked scope ──────────
  return prisma.$transaction(async (tx) => {
    await lockConsultSessionRow(tx, args.consultSessionId, 'UPDATE')
    await requireLockedConsultInspirationStageScope(tx, {
      ...scopeArgs,
      now: new Date(Math.max(now.getTime(), Date.now())),
    })
    return persistLockedConsultInspirationAnalysis(tx, {
      consultSessionId: args.consultSessionId,
      plan,
      read,
      analysisIdempotencyKey: args.idempotencyKey,
      actor: args.actor,
    })
  })
}

/**
 * The standalone entry point named in the P4 brief:
 * `analyzeConsultInspiration(inspirationId)`.
 *
 * It resolves the consult the row belongs to, takes the session lock itself,
 * and delegates to the locked core — so the two callers cannot drift. In the
 * shipped flow the analysis path calls the core directly (it already holds the
 * lock); this wrapper is for a one-off re-read and for tests.
 */
export async function analyzeConsultInspiration(
  inspirationId: string,
  options: {
    idempotencyKey: string
    now?: Date
    storage?: ConsultInspirationStorage
    provider?: ConsultInspirationVisionProvider
  },
): Promise<ConsultInspirationAnalysisArtefact> {
  const now = options.now ?? new Date()
  const row = await prisma.consultInspiration.findUnique({
    where: { id: inspirationId },
    select: {
      consultSession: {
        select: {
          id: true,
          clientId: true,
          client: { select: { userId: true } },
        },
      },
    },
  })
  const actorUserId = row?.consultSession.client.userId
  if (!row || !actorUserId) {
    throw new ConsultWriteError('NOT_FOUND', 'Not found.')
  }
  const { consultSession } = row

  return prisma.$transaction(
    async (tx) => {
      await lockConsultSessionRow(tx, consultSession.id, 'UPDATE')
      const session = await tx.consultSession.findUnique({
        where: { id: consultSession.id },
        select: CONSULT_INSPIRATION_ANALYSIS_SESSION_SELECT,
      })
      if (!session) throw new ConsultWriteError('NOT_FOUND', 'Not found.')
      // Consent is re-checked here as well as at the trigger: a revoked
      // session must not have its reference read, and the lifecycle pin on the
      // artefact (MEDIA_READY or ANALYZING) is what refuses the write itself.
      await requireCurrentConsultAgreementAcceptances(tx, session.id)
      // 🔴 No "guided inspiration must be complete" check any more, and its
      // absence is the P5b change in one line. The reading is of a
      // PHOTOGRAPH; requiring the client to have answered questions about it
      // first was only ever an artefact of where the read used to live.
      return analyzeLockedConsultInspiration(tx, {
        session,
        clientId: consultSession.clientId,
        analysisIdempotencyKey: options.idempotencyKey,
        actor: { type: ConsultActorType.CLIENT, id: actorUserId },
        now,
        storage: options.storage,
        provider: options.provider,
      })
    },
    { maxWait: 20_000, timeout: 90_000 },
  )
}

