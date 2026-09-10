import { effectiveConsultLookPlan } from './lookBriefPlan'
import 'server-only'

import { isDeepStrictEqual } from 'node:util'
import { ConsultRevisionKind, type Prisma } from '@prisma/client'

import { defaultClientConsultInspirationCopy } from '@/lib/brand/defaultClientConsultInspirationCopy'
import { isRecord } from '@/lib/guards'
import { loadConsultLookBriefVersion } from './lookBrief'
import type {
  ConsultAnalysisConfidenceDTO,
  ConsultLookBriefVersionDTO,
  ConsultLookPlanDTO,
} from '@/lib/dto/consult'
import { hasConsultLookPlanMinimumIntake } from './lookPlanning'

import { normalizeStoredConsultAnalysisPayload } from './analysisRevision'
import {
  buildHairColorProBriefPayload,
  buildLegacyHairColorProBriefPayload,
  CONSULT_PRO_BRIEF_PROMPT_VERSION,
  CONSULT_PRO_BRIEF_SCHEMA_VERSION,
  LEGACY_CONSULT_PRO_BRIEF_PROMPT_VERSION,
  LEGACY_CONSULT_PRO_BRIEF_SCHEMA_VERSION,
  toBriefJsonPayload,
  toLegacyBriefJsonPayload,
  type HairColorProBriefPayload,
} from './briefContract'
import { normalizeConsultIntakePayload } from './intake/registry'
import {
  CONSULT_SUITABILITY_PROMPT_VERSION,
  CONSULT_SUITABILITY_SCHEMA_VERSION,
  type ConsultSuitabilityTranslation,
} from './suitabilityTranslation'
import {
  normalizeStoredInspirationPayload,
} from './inspirationPack'

export class ImmutableConsultResultError extends Error {
  constructor() {
    super('Consult result unavailable.')
    this.name = 'ImmutableConsultResultError'
  }
}

export function selectLatestConsultRevision<T extends { revision: number }>(
  revisions: readonly T[],
): T | null {
  let latest: T | null = null
  for (const revision of revisions) {
    if (!latest || revision.revision > latest.revision) latest = revision
  }
  return latest
}

function sourceAnalysisId(payload: Prisma.JsonValue): string | null {
  return isRecord(payload) && typeof payload.sourceAnalysisRevisionId === 'string'
    ? payload.sourceAnalysisRevisionId
    : null
}

/**
 * The INTAKE revision a stored brief was built from.
 *
 * P7a-3: this used to be "the latest intake", and that was only ever right
 * because a consult could hold one plan. 🔴 The moment a client edits an answer
 * on a completed consult — which is the entire point of the living document —
 * "latest" stops being the revision this brief was pinned to, the byte
 * comparison below fails, and her whole plan disappears off both screens until
 * the rerun lands. It is pinned IN the payload; read it from there.
 */
function briefIntakeRevisionId(payload: Prisma.JsonValue): string | null {
  return isRecord(payload) && typeof payload.intakeRevisionId === 'string'
    ? payload.intakeRevisionId
    : null
}

/** The INSPIRATION revision a stored brief was built from. Same rule. */
function briefInspirationRevisionId(payload: Prisma.JsonValue): string | null {
  if (!isRecord(payload)) return null
  const inspiration = payload.inspiration
  return isRecord(inspiration) && typeof inspiration.revisionId === 'string'
    ? inspiration.revisionId
    : null
}

export type ImmutableConsultResult = {
  lookPlan?: ConsultLookPlanDTO
  lookBrief?: ConsultLookBriefVersionDTO
  briefRevisionId: string
  briefRevision: number
  analysisRevisionId: string
  analysisRevision: number
  intakeRevisionId: string
  payload: HairColorProBriefPayload
  suitability?: ConsultSuitabilityTranslation
  createdAt: Date
}

type ConsultSuitabilityClientSentiment = 'LIKE' | 'DISLIKE' | 'GOAL' | 'CONTEXT'

const ALLOWED_CLIENT_SENTIMENTS = new Set<ConsultSuitabilityClientSentiment>([
  'LIKE',
  'DISLIKE',
  'GOAL',
  'CONTEXT',
])

function isConsultSuitabilitySentiment(
  value: string,
): value is ConsultSuitabilityClientSentiment {
  return ALLOWED_CLIENT_SENTIMENTS.has(value as ConsultSuitabilityClientSentiment)
}

type ConsultSuitabilitySourceDTO =
  | {
      id: string
      revisionId: string
      value: string
      provenance: 'CLIENT_REPORTED'
      sentiment: ConsultSuitabilityClientSentiment
    }
  | {
      id: string
      revisionId: string
      value: string
      provenance: 'OBSERVED'
      confidence: ConsultAnalysisConfidenceDTO
      evidence: Array<'image' | 'inspiration' | 'profile' | 'core' | string>
    }
type ConsultSuitabilityClientSource = Extract<
  ConsultSuitabilitySourceDTO,
  { provenance: 'CLIENT_REPORTED' }
>

function sanitizeConfidence(
  value: unknown,
): { min: number; max: number } | null {
  if (!isRecord(value)) return null
  if (typeof value.min !== 'number' || typeof value.max !== 'number') return null
  if (value.min < 0 || value.max > 1 || value.min > value.max) return null
  return { min: value.min, max: value.max }
}

function normalizeStoredSuitabilitySource(
  value: unknown,
): ConsultSuitabilitySourceDTO | null {
  if (!isRecord(value)) return null
  if (
    typeof value.id !== 'string' ||
    typeof value.revisionId !== 'string' ||
    typeof value.value !== 'string' ||
    typeof value.provenance !== 'string'
  ) {
    return null
  }
  if (value.provenance === 'CLIENT_REPORTED') {
    if (typeof value.sentiment !== 'string' || !isConsultSuitabilitySentiment(value.sentiment)) {
      return null
    }
    const sentiment = value.sentiment as ConsultSuitabilityClientSentiment
    return {
      id: value.id,
      revisionId: value.revisionId,
      value: value.value,
      provenance: 'CLIENT_REPORTED',
      sentiment,
    }
  }
  if (value.provenance !== 'OBSERVED') return null
  if (
    !Array.isArray(value.evidence) ||
    typeof value.revisionId !== 'string' ||
    typeof value.value !== 'string'
  ) {
    return null
  }
  const confidence = sanitizeConfidence(value.confidence)
  if (!confidence) return null
  return {
    id: value.id,
    revisionId: value.revisionId,
    value: value.value,
    provenance: 'OBSERVED',
    confidence,
    evidence: [...value.evidence],
  }
}

function normalizeStoredWhatYouLovedSource(
  value: unknown,
): ConsultSuitabilityClientSource | null {
  if (!isRecord(value)) return null
  if (
    typeof value.id !== 'string' ||
    typeof value.revisionId !== 'string' ||
    typeof value.value !== 'string' ||
    typeof value.provenance !== 'string' ||
    value.provenance !== 'CLIENT_REPORTED' ||
    typeof value.sentiment !== 'string' ||
    !isConsultSuitabilitySentiment(value.sentiment)
  ) {
    return null
  }
  return {
    id: value.id,
    revisionId: value.revisionId,
    value: value.value,
    provenance: 'CLIENT_REPORTED',
    sentiment: value.sentiment as ConsultSuitabilityClientSentiment,
  }
}

function normalizeStoredSuitabilityTranslation(
  raw: Prisma.JsonValue,
  analysisRevisionId: string,
  clientRevisionId: string,
): ConsultSuitabilityTranslation | null {
  if (!isRecord(raw)) return null
  if (
    raw.schemaVersion !== CONSULT_SUITABILITY_SCHEMA_VERSION ||
    raw.promptVersion !== CONSULT_SUITABILITY_PROMPT_VERSION ||
    raw.analysisRevisionId !== analysisRevisionId ||
    raw.clientRevisionId !== clientRevisionId ||
    raw.requiresProfessionalReview !== true ||
    (raw.clientSource !== 'INTAKE' && raw.clientSource !== 'INSPIRATION')
  ) {
    return null
  }

  if (!Array.isArray(raw.whatYouLoved) || !Array.isArray(raw.tailoring) || !Array.isArray(raw.proConfirmations)) {
    return null
  }
  const whatYouLoved: ConsultSuitabilityClientSource[] = []
  for (const source of raw.whatYouLoved) {
    const parsed = normalizeStoredWhatYouLovedSource(source)
    if (!parsed) return null
    whatYouLoved.push(parsed)
  }

  const tailoring = raw.tailoring
  const proConfirmations = raw.proConfirmations
  if (
    tailoring.length < 1 || tailoring.length > 3 ||
    proConfirmations.length < 1 || proConfirmations.length > 4
  ) return null

  const mappedTailoring: ConsultSuitabilityTranslation['tailoring'] = []
  for (const direction of tailoring) {
    if (
      !isRecord(direction) ||
      typeof direction.clientExplanation !== 'string' ||
      typeof direction.professionalDirection !== 'string' ||
      (direction.status !== 'SUPPORTED' && direction.status !== 'NEEDS_PRO_CONFIRMATION') ||
      direction.provenance !== 'DERIVED_GUIDANCE' ||
      !Array.isArray(direction.sources)
    ) {
      return null
    }
    const sources = direction.sources.map((source) => normalizeStoredSuitabilitySource(source))
    if (!sources.every((source): source is ConsultSuitabilitySourceDTO => source !== null)) return null
    const status = direction.status === 'SUPPORTED'
      ? 'SUPPORTED' as const
      : 'NEEDS_PRO_CONFIRMATION' as const
    mappedTailoring.push({
      clientExplanation: direction.clientExplanation,
      professionalDirection: direction.professionalDirection,
      status,
      provenance: 'DERIVED_GUIDANCE' as const,
      sources: sources as ConsultSuitabilityTranslation['tailoring'][number]['sources'],
    })
  }

  const mappedProConfirmations: ConsultSuitabilityTranslation['proConfirmations'] = []
  for (const confirmation of proConfirmations) {
    if (
      !isRecord(confirmation) ||
      typeof confirmation.clientExplanation !== 'string' ||
      typeof confirmation.professionalCheck !== 'string' ||
      confirmation.provenance !== 'NEEDS_PRO_CONFIRMATION' ||
      !Array.isArray(confirmation.sources)
    ) {
      return null
    }
    const sources = confirmation.sources.map((source) => normalizeStoredSuitabilitySource(source))
    if (!sources.every((source): source is ConsultSuitabilitySourceDTO => source !== null)) return null
    mappedProConfirmations.push({
      clientExplanation: confirmation.clientExplanation,
      professionalCheck: confirmation.professionalCheck,
      provenance: 'NEEDS_PRO_CONFIRMATION' as const,
      sources: sources as ConsultSuitabilityTranslation['proConfirmations'][number]['sources'],
    })
  }

  return {
    schemaVersion: CONSULT_SUITABILITY_SCHEMA_VERSION,
    promptVersion: CONSULT_SUITABILITY_PROMPT_VERSION,
    requiresProfessionalReview: true,
    analysisRevisionId,
    clientRevisionId,
    clientSource: raw.clientSource,
    whatYouLoved: whatYouLoved,
    tailoring: mappedTailoring,
    proConfirmations: mappedProConfirmations,
  }
}

/**
 * One immutable result projection shared by pro and client renderers. The
 * latest ANALYSIS is authoritative; its matching pinned BRIEF must be present
 * and byte-structurally equal to the deterministic projection before either
 * audience can see it. Code drift can therefore never reinterpret history.
 */
export async function loadLatestImmutableConsultResult(
  tx: Prisma.TransactionClient,
  consultSessionId: string,
): Promise<ImmutableConsultResult> {
  const revisions = await tx.consultRevision.findMany({
    where: {
      consultSessionId,
      kind: {
        in: [
          ConsultRevisionKind.INTAKE,
          ConsultRevisionKind.INSPIRATION,
          ConsultRevisionKind.ANALYSIS,
          ConsultRevisionKind.BRIEF,
        ],
      },
    },
    select: {
      id: true,
      revision: true,
      kind: true,
      payload: true,
      schemaVersion: true,
      promptVersion: true,
      createdAt: true,
    },
    orderBy: [{ revision: 'desc' }, { id: 'desc' }],
  })
  const analysis = selectLatestConsultRevision(
    revisions.filter((revision) => revision.kind === ConsultRevisionKind.ANALYSIS),
  )
  if (!analysis) throw new ImmutableConsultResultError()

  const brief = selectLatestConsultRevision(
    revisions.filter(
      (revision) =>
        revision.kind === ConsultRevisionKind.BRIEF &&
        sourceAnalysisId(revision.payload) === analysis.id &&
        ((revision.schemaVersion === CONSULT_PRO_BRIEF_SCHEMA_VERSION &&
          revision.promptVersion === CONSULT_PRO_BRIEF_PROMPT_VERSION) ||
          (revision.schemaVersion === LEGACY_CONSULT_PRO_BRIEF_SCHEMA_VERSION &&
            revision.promptVersion === LEGACY_CONSULT_PRO_BRIEF_PROMPT_VERSION)),
    ),
  )
  if (!brief) throw new ImmutableConsultResultError()

  // The intake this BRIEF was built from — not the newest one the client has
  // since written. A brief is an immutable artefact and must be interpreted
  // against its own inputs; falling back to the latest keeps every brief
  // written before the pin existed projecting exactly as it did.
  const pinnedIntakeId = briefIntakeRevisionId(brief.payload)
  const intakeRevisions = revisions.filter(
    (revision) => revision.kind === ConsultRevisionKind.INTAKE,
  )
  const intake = pinnedIntakeId
    ? (intakeRevisions.find((revision) => revision.id === pinnedIntakeId) ?? null)
    : selectLatestConsultRevision(intakeRevisions)
  if (!intake) throw new ImmutableConsultResultError()

  const normalizedIntake = normalizeConsultIntakePayload(intake.payload)
  if (!normalizedIntake) throw new ImmutableConsultResultError()
  let lookPlan: ConsultLookPlanDTO | undefined

  let payload: HairColorProBriefPayload
  try {
    const buildArgs = {
      intakeRevisionId: intake.id,
      intakePackId: normalizedIntake.packId,
      intakePackVersion: normalizedIntake.packVersion,
      intakeAnswers: normalizedIntake.answers,
      analysisRevisionId: analysis.id,
      analysisRevision: analysis.revision,
      analysis: normalizeStoredConsultAnalysisPayload(
        analysis.payload,
        analysis.schemaVersion,
      ),
    }
    lookPlan = buildArgs.analysis.lookPlan
    if (!normalizedIntake.complete && !(lookPlan?.provisional && hasConsultLookPlanMinimumIntake(normalizedIntake))) {
      throw new ImmutableConsultResultError()
    }
    if (brief.schemaVersion === LEGACY_CONSULT_PRO_BRIEF_SCHEMA_VERSION) {
      const legacy = buildLegacyHairColorProBriefPayload(buildArgs)
      if (!isDeepStrictEqual(brief.payload, toLegacyBriefJsonPayload(legacy))) {
        throw new ImmutableConsultResultError()
      }
      payload = {
        ...legacy,
        inspiration: {
          revisionId: null,
          source: 'NONE',
          inspirationId: null,
          lookPostId: null,
          mediaEndpoint: null,
          // The brand DEFAULT, matching the writer in
          // lib/consult/writeBoundary.ts — this payload is compared
          // byte-for-byte against the stored brief.
          referenceNote: defaultClientConsultInspirationCopy.referenceNote,
          exactClientDetails: [],
          possibleProfessionalInterpretation: [],
          catalogGuidance: [],
        },
      }
    } else {
      // Pinned, for the same reason the intake is: answering another card on
      // a finished consult must not take her plan off the screen.
      const pinnedInspirationId = briefInspirationRevisionId(brief.payload)
      const inspirationRevisions = revisions.filter(
        (revision) => revision.kind === ConsultRevisionKind.INSPIRATION,
      )
      const inspirationRevision = pinnedInspirationId
        ? (inspirationRevisions.find(
            (revision) => revision.id === pinnedInspirationId,
          ) ?? null)
        : selectLatestConsultRevision(inspirationRevisions)
      if (!inspirationRevision) throw new ImmutableConsultResultError()
      const inspiration = normalizeStoredInspirationPayload(
        inspirationRevision.payload,
      )
      if (!inspiration?.complete) throw new ImmutableConsultResultError()
      const source = inspiration.inspirationId
        ? await tx.consultInspiration.findFirst({
            where: {
              id: inspiration.inspirationId,
              consultSessionId,
              status: 'ATTACHED',
            },
            select: { sourceLookPostId: true },
          })
        : null
      if (inspiration.inspirationId && !source) {
        throw new ImmutableConsultResultError()
      }
      payload = buildHairColorProBriefPayload({
        ...buildArgs,
        inspiration: {
          revisionId: inspirationRevision.id,
          source: inspiration.source,
          inspirationId: inspiration.inspirationId,
          lookPostId: source?.sourceLookPostId ?? null,
          mediaEndpoint:
            inspiration.source === 'EXTERNAL_UPLOAD'
              ? `/api/v1/pro/consults/${encodeURIComponent(consultSessionId)}/inspiration/media`
              : null,
          // The brand DEFAULT, matching the writer in
          // lib/consult/writeBoundary.ts — this payload is compared
          // byte-for-byte against the stored brief.
          referenceNote: defaultClientConsultInspirationCopy.referenceNote,
          exactClientDetails: inspiration.exactClientDetails,
          possibleProfessionalInterpretation:
            inspiration.possibleProfessionalInterpretation,
          catalogGuidance: inspiration.catalogGuidance,
        },
      })
      if (!isDeepStrictEqual(brief.payload, toBriefJsonPayload(payload))) {
        throw new ImmutableConsultResultError()
      }
    }
  } catch {
    throw new ImmutableConsultResultError()
  }

  const suitabilityTranslation = await tx.consultSuitabilityTranslation.findFirst({
    where: { consultSessionId, analysisRevisionId: analysis.id },
    select: {
      payload: true,
      clientRevisionId: true,
      analysisRevisionId: true,
      schemaVersion: true,
      promptVersion: true,
    },
  })

  const suitability = suitabilityTranslation
    ? normalizeStoredSuitabilityTranslation(
        suitabilityTranslation.payload,
        suitabilityTranslation.analysisRevisionId,
        suitabilityTranslation.clientRevisionId,
      )
    : undefined

  const lookBrief = lookPlan ? await loadConsultLookBriefVersion(tx, consultSessionId) : undefined
  if (lookPlan && (!lookBrief || lookBrief.sourceAnalysisRevisionId !== analysis.id)) throw new ImmutableConsultResultError()
  lookPlan = effectiveConsultLookPlan(normalizeStoredConsultAnalysisPayload(analysis.payload, analysis.schemaVersion), lookBrief)
  return {
    ...(lookBrief ? { lookBrief } : {}),
    briefRevisionId: brief.id,
    briefRevision: brief.revision,
    analysisRevisionId: analysis.id,
    analysisRevision: analysis.revision,
    intakeRevisionId: intake.id,
    payload,
    ...(suitability ? { suitability } : {}),
    ...(lookPlan ? { lookPlan } : {}),
    createdAt: brief.createdAt,
  }
}
