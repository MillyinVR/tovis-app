import 'server-only'

import { isDeepStrictEqual } from 'node:util'
import { ConsultRevisionKind, type Prisma } from '@prisma/client'

import { isRecord } from '@/lib/guards'

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
  CONSULT_INSPIRATION_REFERENCE_NOTE,
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

export type ImmutableConsultResult = {
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
  const intake = selectLatestConsultRevision(
    revisions.filter((revision) => revision.kind === ConsultRevisionKind.INTAKE),
  )
  if (!analysis || !intake) throw new ImmutableConsultResultError()

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

  const normalizedIntake = normalizeConsultIntakePayload(intake.payload)
  if (!normalizedIntake?.complete) throw new ImmutableConsultResultError()

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
          referenceNote: CONSULT_INSPIRATION_REFERENCE_NOTE,
          exactClientDetails: [],
          possibleProfessionalInterpretation: [],
          catalogGuidance: [],
        },
      }
    } else {
      const inspirationRevision = selectLatestConsultRevision(
        revisions.filter(
          (revision) => revision.kind === ConsultRevisionKind.INSPIRATION,
        ),
      )
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
          referenceNote: CONSULT_INSPIRATION_REFERENCE_NOTE,
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

  return {
    briefRevisionId: brief.id,
    briefRevision: brief.revision,
    analysisRevisionId: analysis.id,
    analysisRevision: analysis.revision,
    intakeRevisionId: intake.id,
    payload,
    createdAt: brief.createdAt,
  }
}
