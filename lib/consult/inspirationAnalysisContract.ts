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
 * WHERE IT RUNS: inside the analysis transaction, in ANALYZING, immediately
 * before the analysis provider call — the same place `readVerifiedImages`
 * already does its Supabase round-trips, and the reason that transaction has a
 * 115-second budget. Running it at inspiration-completion time instead would
 * mean a vision outage could block the client from finishing the inspiration
 * step, which is a bigger blast radius for no gain: the analysis is the only
 * thing that consumes it.
 *
 * SPEND: it is a second paid provider call inside the same request as the
 * analysis, so it sits inside the SAME `client:consult:vision` rate-limit
 * bucket the analysis route already enforces (40/day/user). No new bucket —
 * what that bucket bounds is total provider spend per client, and this is part
 * of it. One analysis attempt now costs two calls rather than one.
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
 * The locked core. The caller owns the transaction and has already taken the
 * ConsultSession row FOR UPDATE and re-checked scope and consent.
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
  },
): Promise<ConsultInspirationAnalysisArtefact> {
  const target: ConsultInspirationReadTarget =
    await resolveLockedConsultInspirationReadTarget(tx, args.session, args.now)
  const requestHash = inspirationAnalysisRequestHash({
    inspirationRevisionId: args.inspirationRevisionId,
    inspirationId: target.inspirationId,
    promptVersion: CONSULT_INSPIRATION_ANALYSIS_PROMPT_VERSION,
    schemaVersion: CONSULT_INSPIRATION_ANALYSIS_SCHEMA_VERSION,
  })

  // An artefact already read against this exact reference under this exact
  // prompt is the same artefact. Reuse it rather than paying for the call
  // again — the request hash is what makes that safe to say.
  const existing = await tx.consultRevision.findFirst({
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
        revisionId: stored.revisionId,
        inspirationRevisionId: stored.inspirationRevisionId,
        inspirationId: stored.inspirationId,
        source: stored.source,
        model: stored.model,
        analysis,
      }
    }
  }

  const startedAt = Date.now()
  const source = sourceDto(target.source)
  const provider = args.provider ?? runConsultInspirationVision
  let result
  try {
    const read = await mintConsultInspirationReadUrl(target, args.storage)
    const image = await fetchConsultInspirationImage(read.url)
    result = await provider({ image })
  } catch (error) {
    logAiConsultInspirationAnalysis({
      consultId: args.session.id,
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
    consultId: args.session.id,
    clientId: args.clientId,
    source,
    outcome: 'OK',
    knownAttributeCount: countKnownConsultInspirationAttributes(result.analysis),
    model: result.model,
    durationMs: Date.now() - startedAt,
  })

  const revision = await appendLockedConsultInspirationAnalysisRevision(tx, {
    consultSessionId: args.session.id,
    payload: toArtefactPayload({
      inspirationRevisionId: args.inspirationRevisionId,
      inspirationId: target.inspirationId,
      source,
      analysis: result.analysis,
    }),
    model: result.model,
    idempotencyKey: inspirationAnalysisIdempotencyKey(args.analysisIdempotencyKey),
    requestHash,
    actor: args.actor,
  })

  return {
    revisionId: revision.id,
    inspirationRevisionId: args.inspirationRevisionId,
    inspirationId: target.inspirationId,
    source,
    model: result.model,
    analysis: result.analysis,
  }
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

