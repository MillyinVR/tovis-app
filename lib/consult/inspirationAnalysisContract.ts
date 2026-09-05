import 'server-only'

import { createHash } from 'node:crypto'
import { ConsultActorType, ConsultRevisionKind, Prisma } from '@prisma/client'

import type { ConsultInspirationAnalysisDTO } from '@/lib/dto/consult'
import { isRecord } from '@/lib/guards'
import { logAiConsultInspirationAnalysis } from '@/lib/observability/aiConsultEvents'
import { prisma } from '@/lib/prisma'

import { requireCurrentConsultAgreementAcceptances } from './agreementContract'
import { ConsultWriteError } from './errors'
import { fetchConsultInspirationImage } from './inspirationImage'
import {
  mintConsultInspirationReadUrl,
  resolveLockedConsultInspirationReadTarget,
  sourceDto,
  type ConsultInspirationReadTarget,
} from './inspirationContract'
import type { ConsultInspirationStorage } from './inspirationStorage'
import type { ConsultProviderMeterSink } from './providerMeter'
import {
  CONSULT_INSPIRATION_ANALYSIS_FIELDS,
  CONSULT_INSPIRATION_ANALYSIS_PROMPT_VERSION,
  CONSULT_INSPIRATION_ANALYSIS_SCHEMA_VERSION,
  CONSULT_INSPIRATION_FIELD_VALUES,
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
 * stores the result as its own immutable revision, pinned to the guided-
 * inspiration revision it was read against.
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
  inspirationRevisionId: string
  inspirationId: string
  source: ConsultInspirationAnalysisDTO['source']
  model: string
  analysis: ConsultInspirationAnalysis
}

/**
 * The artefact's own request identity — what makes it "keyed to the
 * inspiration revision". Two runs against the same reference under the same
 * prompt hash identically; a re-answered inspiration step or a prompt bump
 * does not.
 */
function inspirationAnalysisRequestHash(args: {
  inspirationRevisionId: string
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
  inspirationRevisionId: string
  inspirationId: string
  source: ConsultInspirationAnalysisDTO['source']
  analysis: ConsultInspirationAnalysis
}): Prisma.InputJsonObject {
  return {
    schemaVersion: CONSULT_INSPIRATION_ANALYSIS_SCHEMA_VERSION,
    inspirationRevisionId: args.inspirationRevisionId,
    inspirationId: args.inspirationId,
    source: args.source,
    attributes: toConsultInspirationAnalysisJson(args.analysis),
  }
}

/** The stored JSON → the typed artefact, or null when the row cannot be read. */
export function normalizeStoredConsultInspirationAnalysis(revision: {
  id: string
  payload: Prisma.JsonValue
  schemaVersion: number
  promptVersion: string | null
  model: string | null
  createdAt: Date
}): ConsultInspirationAnalysisDTO | null {
  const payload = revision.payload
  if (
    revision.schemaVersion !== CONSULT_INSPIRATION_ANALYSIS_SCHEMA_VERSION ||
    revision.promptVersion !== CONSULT_INSPIRATION_ANALYSIS_PROMPT_VERSION ||
    !revision.model ||
    !isRecord(payload) ||
    typeof payload.inspirationRevisionId !== 'string' ||
    typeof payload.inspirationId !== 'string' ||
    !isRecord(payload.attributes)
  ) {
    return null
  }
  const source = (['PLATFORM_LOOK', 'BOOKED_PRO_LOOK', 'EXTERNAL_UPLOAD'] as const).find(
    (candidate) => candidate === payload.source,
  )
  if (!source) return null

  const attributes: Record<string, unknown> = {}
  for (const field of CONSULT_INSPIRATION_ANALYSIS_FIELDS) {
    const observed = payload.attributes[field]
    if (
      !isRecord(observed) ||
      typeof observed.value !== 'string' ||
      !CONSULT_INSPIRATION_FIELD_VALUES[field].includes(observed.value) ||
      !isRecord(observed.confidence) ||
      typeof observed.confidence.min !== 'number' ||
      typeof observed.confidence.max !== 'number' ||
      !Array.isArray(observed.evidence) ||
      observed.evidence.some((label) => label !== 'inspiration')
    ) {
      return null
    }
    let region: { x: number; y: number; w: number; h: number } | null = null
    if (observed.region !== null) {
      const raw = observed.region
      if (
        !isRecord(raw) ||
        typeof raw.x !== 'number' ||
        typeof raw.y !== 'number' ||
        typeof raw.w !== 'number' ||
        typeof raw.h !== 'number'
      ) {
        return null
      }
      region = { x: raw.x, y: raw.y, w: raw.w, h: raw.h }
    }
    attributes[field] = {
      value: observed.value,
      confidence: { min: observed.confidence.min, max: observed.confidence.max },
      evidence: observed.evidence.filter(
        (label): label is 'inspiration' => label === 'inspiration',
      ),
      region,
    }
  }

  return {
    revisionId: revision.id,
    inspirationRevisionId: payload.inspirationRevisionId,
    inspirationId: payload.inspirationId,
    source,
    schemaVersion: revision.schemaVersion,
    promptVersion: revision.promptVersion,
    model: revision.model,
    // The per-field loop above proved every field; the object it built is the
    // DTO's attribute set by construction.
    attributes: attributes as ConsultInspirationAnalysisDTO['attributes'],
    createdAt: revision.createdAt.toISOString(),
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
    inspirationRevisionId: string
    now: Date
  },
): Promise<ConsultInspirationReadPlan> {
  const target: ConsultInspirationReadTarget =
    await resolveLockedConsultInspirationReadTarget(db, args.session, args.now)
  const requestHash = inspirationAnalysisRequestHash({
    inspirationRevisionId: args.inspirationRevisionId,
    inspirationId: target.inspirationId,
    promptVersion: CONSULT_INSPIRATION_ANALYSIS_PROMPT_VERSION,
    schemaVersion: CONSULT_INSPIRATION_ANALYSIS_SCHEMA_VERSION,
  })

  // An artefact already read against this exact reference under this exact
  // prompt is the same artefact. Reuse it rather than paying for the call
  // again — the request hash is what makes that safe to say. This is also what
  // makes a RETRIED run cheap: attempt two does not re-read the reference.
  const existing = await db.consultRevision.findFirst({
    where: {
      consultSessionId: args.session.id,
      kind: ConsultRevisionKind.INSPIRATION_ANALYSIS,
      requestHash,
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
  if (existing) {
    const stored = normalizeStoredConsultInspirationAnalysis(existing)
    const analysis = storedAnalysis(stored)
    if (stored && analysis) {
      return {
        target,
        requestHash,
        artefact: {
          revisionId: stored.revisionId,
          inspirationRevisionId: stored.inspirationRevisionId,
          inspirationId: stored.inspirationId,
          source: stored.source,
          model: stored.model,
          analysis,
        },
      }
    }
  }

  return { target, requestHash, artefact: null }
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
    inspirationRevisionId: string
    plan: ConsultInspirationReadPlan
    read: ConsultInspirationReadResult
    analysisIdempotencyKey: string
    actor: { type: typeof ConsultActorType.CLIENT; id: string }
  },
): Promise<ConsultInspirationAnalysisArtefact> {
  const revision = await appendLockedConsultInspirationAnalysisRevision(tx, {
    consultSessionId: args.consultSessionId,
    payload: toArtefactPayload({
      inspirationRevisionId: args.inspirationRevisionId,
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
    inspirationRevisionId: args.inspirationRevisionId,
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
    inspirationRevisionId: string
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
    inspirationRevisionId: args.inspirationRevisionId,
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
    inspirationRevisionId: args.inspirationRevisionId,
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
      await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
        SELECT "id" FROM "ConsultSession" WHERE "id" = ${consultSession.id} FOR UPDATE
      `)
      const session = await tx.consultSession.findUnique({
        where: { id: consultSession.id },
        select: CONSULT_INSPIRATION_ANALYSIS_SESSION_SELECT,
      })
      if (!session) throw new ConsultWriteError('NOT_FOUND', 'Not found.')
      // Consent is re-checked here as well as at the trigger: a revoked
      // session must not have its reference read, and the lifecycle pin on the
      // artefact (ANALYZING only) is what refuses the write itself.
      await requireCurrentConsultAgreementAcceptances(tx, session.id)
      const inspirationRevision = await tx.consultRevision.findFirst({
        where: {
          consultSessionId: session.id,
          kind: ConsultRevisionKind.INSPIRATION,
        },
        select: { id: true },
        orderBy: [{ revision: 'desc' }, { id: 'desc' }],
      })
      if (!inspirationRevision) {
        throw new ConsultWriteError(
          'ANALYSIS_PREREQUISITES_REQUIRED',
          'Guided inspiration is incomplete.',
        )
      }
      return analyzeLockedConsultInspiration(tx, {
        session,
        clientId: consultSession.clientId,
        inspirationRevisionId: inspirationRevision.id,
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

