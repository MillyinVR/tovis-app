import 'server-only'

import { isDeepStrictEqual } from 'node:util'
import { ConsultRevisionKind, type Prisma } from '@prisma/client'

import { isRecord } from '@/lib/guards'

import { normalizeStoredHairColorAnalysisPayload } from './analysisRevision'
import {
  buildHairColorProBriefPayload,
  CONSULT_PRO_BRIEF_PROMPT_VERSION,
  CONSULT_PRO_BRIEF_SCHEMA_VERSION,
  toBriefJsonPayload,
  type HairColorProBriefPayload,
} from './briefContract'
import { normalizeHairColorIntakePayload } from './intakePack'

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

  const normalizedIntake = normalizeHairColorIntakePayload(intake.payload)
  if (!normalizedIntake?.complete) throw new ImmutableConsultResultError()

  let payload: HairColorProBriefPayload
  try {
    payload = buildHairColorProBriefPayload({
      intakeRevisionId: intake.id,
      intakeAnswers: normalizedIntake.answers,
      analysisRevisionId: analysis.id,
      analysisRevision: analysis.revision,
      analysis: normalizeStoredHairColorAnalysisPayload(analysis.payload),
    })
  } catch {
    throw new ImmutableConsultResultError()
  }

  const brief = selectLatestConsultRevision(
    revisions.filter(
      (revision) =>
        revision.kind === ConsultRevisionKind.BRIEF &&
        revision.schemaVersion === CONSULT_PRO_BRIEF_SCHEMA_VERSION &&
        revision.promptVersion === CONSULT_PRO_BRIEF_PROMPT_VERSION &&
        sourceAnalysisId(revision.payload) === analysis.id,
    ),
  )
  if (!brief || !isDeepStrictEqual(brief.payload, toBriefJsonPayload(payload))) {
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
