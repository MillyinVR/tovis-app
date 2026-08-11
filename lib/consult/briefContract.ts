import type { Prisma } from '@prisma/client'

import type {
  ConsultAnalysisPayloadDTO,
  ConsultBriefAchievabilityDirectionDTO,
  ConsultBriefAiObservationsDTO,
  ConsultBriefClientIntakeItemDTO,
  ConsultBriefRecommendationDirectionDTO,
} from '@/lib/dto/consult'

import {
  HAIR_COLOR_INTAKE_PACK,
  type HairColorIntakeQuestionKey,
} from './intakePack'

export const CONSULT_PRO_BRIEF_SCHEMA_VERSION = 1
export const CONSULT_PRO_BRIEF_PROMPT_VERSION = 'hair-color-pro-brief-v1'

export type HairColorProBriefPayload = {
  schemaVersion: number
  sourceAnalysisRevisionId: string
  sourceAnalysisRevision: number
  intakeRevisionId: string
  clientIntake: ConsultBriefClientIntakeItemDTO[]
  aiObservations: ConsultBriefAiObservationsDTO
  safetyFlags: ConsultAnalysisPayloadDTO['safetyFlags']
  achievabilityDirection: ConsultBriefAchievabilityDirectionDTO
  recommendationDirections: ConsultBriefRecommendationDirectionDTO[]
}

function intakeItems(
  answers: Readonly<Record<string, string>>,
): ConsultBriefClientIntakeItemDTO[] {
  const items: ConsultBriefClientIntakeItemDTO[] = []
  for (const question of HAIR_COLOR_INTAKE_PACK.questions) {
    const questionKey = question.key as HairColorIntakeQuestionKey
    const answerCode = answers[questionKey]
    if (!answerCode) continue
    const option = question.options.find((candidate) => candidate.value === answerCode)
    if (!option) continue
    items.push({
      questionKey,
      question: question.label,
      answerCode,
      answer: option.label,
    })
  }
  return items
}

/**
 * Deterministic C6 render contract. It does not call a model and cannot carry
 * C3 object material: every field comes from the normalized C2 intake pack or
 * the normalized C4 hair-only analysis DTO.
 */
export function buildHairColorProBriefPayload(args: {
  intakeRevisionId: string
  intakeAnswers: Readonly<Record<string, string>>
  analysisRevisionId: string
  analysisRevision: number
  analysis: ConsultAnalysisPayloadDTO
}): HairColorProBriefPayload {
  const clientIntake = intakeItems(args.intakeAnswers)
  if (clientIntake.length === 0) {
    throw new Error('Consult brief intake is unavailable.')
  }

  return {
    schemaVersion: CONSULT_PRO_BRIEF_SCHEMA_VERSION,
    sourceAnalysisRevisionId: args.analysisRevisionId,
    sourceAnalysisRevision: args.analysisRevision,
    intakeRevisionId: args.intakeRevisionId,
    // Rendering always places this client-authored selection list first.
    clientIntake,
    // AI-derived content is a distinct second structure, never blended into
    // the client's own statements.
    aiObservations: {
      currentLevel: args.analysis.core.currentLevel,
      currentTone: args.analysis.core.currentTone,
      visibleCondition: args.analysis.core.visibleCondition,
      density: args.analysis.core.density,
      texture: args.analysis.core.texture,
      goalSummary: args.analysis.hairColorLens.goal,
      historySummary: args.analysis.hairColorLens.history,
      constraintsSummary: args.analysis.hairColorLens.constraints,
      maintenanceSummary: args.analysis.hairColorLens.maintenance,
      appointmentContextSummary: args.analysis.hairColorLens.appointmentContext,
    },
    // Safety remains a top-level sibling, so no presentation tier can hide it
    // by trimming observations or recommendations.
    safetyFlags: args.analysis.safetyFlags.map((flag) => ({ ...flag })),
    achievabilityDirection: {
      direction:
        'Discuss this assessment with the professional; they will decide what is achievable in person.',
      assessment: args.analysis.hairColorLens.achievability,
      context: args.analysis.hairColorLens.achievabilityReason,
      discussWithProfessional: true,
    },
    recommendationDirections: args.analysis.recommendations.map(
      (recommendation) => ({
        title: recommendation.title,
        why: recommendation.rationale,
        direction: `Direction to discuss with the professional: ${recommendation.title}.`,
        reference: recommendation.reference,
        discussWithProfessional: true,
      }),
    ),
  }
}

export function toBriefJsonPayload(
  payload: HairColorProBriefPayload,
): Prisma.InputJsonValue {
  return {
    ...payload,
    clientIntake: payload.clientIntake.map((item) => ({ ...item })),
    aiObservations: { ...payload.aiObservations },
    safetyFlags: payload.safetyFlags.map((flag) => ({ ...flag })),
    achievabilityDirection: { ...payload.achievabilityDirection },
    recommendationDirections: payload.recommendationDirections.map((item) => ({
      ...item,
      reference: { ...item.reference },
    })),
  }
}
