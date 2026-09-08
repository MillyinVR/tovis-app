import { effectiveConsultLookPlan } from './lookBriefPlan'
import 'server-only'

import { isDeepStrictEqual } from 'node:util'
import { ConsultRevisionKind, type Prisma } from '@prisma/client'

import { defaultClientConsultInspirationCopy } from '@/lib/brand/defaultClientConsultInspirationCopy'
import { isRecord } from '@/lib/guards'
import { loadConsultLookBriefVersion } from './lookBrief'
import type { ConsultLookBriefVersionDTO, ConsultLookPlanDTO } from '@/lib/dto/consult'
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
  createdAt: Date
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
    ...(lookPlan ? { lookPlan } : {}),
    createdAt: brief.createdAt,
  }
}
