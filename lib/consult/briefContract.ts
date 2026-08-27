import type { Prisma } from '@prisma/client'

import type {
  ConsultAnalysisFeatureProfileDTO,
  ConsultAnalysisPayloadDTO,
  ConsultBriefAchievabilityDirectionDTO,
  ConsultBriefAiObservationsDTO,
  ConsultBriefClientIntakeItemDTO,
  ConsultBriefRecommendationDirectionDTO,
  ConsultBriefInspirationDTO,
  ConsultStyleDirectionDTO,
} from '@/lib/dto/consult'

import {
  HAIR_COLOR_INTAKE_PACK,
  type HairColorIntakeQuestionKey,
} from './intakePack'

export const CONSULT_PRO_BRIEF_SCHEMA_VERSION = 3
export const CONSULT_PRO_BRIEF_PROMPT_VERSION = 'full-analysis-pro-brief-v3'
export const LEGACY_CONSULT_PRO_BRIEF_SCHEMA_VERSION = 1
export const LEGACY_CONSULT_PRO_BRIEF_PROMPT_VERSION = 'hair-color-pro-brief-v1'

type HairColorProBriefCore = {
  schemaVersion: number
  sourceAnalysisRevisionId: string
  sourceAnalysisRevision: number
  intakeRevisionId: string
  clientIntake: ConsultBriefClientIntakeItemDTO[]
  aiObservations: ConsultBriefAiObservationsDTO
  // Brief schema v3 (full analysis): the feature profile and per-domain style
  // directions ride beside the hair observations as distinct AI structures.
  profile: ConsultAnalysisFeatureProfileDTO
  styleDirections: ConsultStyleDirectionDTO[]
  safetyFlags: ConsultAnalysisPayloadDTO['safetyFlags']
  achievabilityDirection: ConsultBriefAchievabilityDirectionDTO
  recommendationDirections: ConsultBriefRecommendationDirectionDTO[]
}

export type LegacyHairColorProBriefPayload = HairColorProBriefCore
export type HairColorProBriefPayload = HairColorProBriefCore & {
  inspiration: ConsultBriefInspirationDTO
}

function structuredCloneProfile(
  profile: ConsultAnalysisFeatureProfileDTO,
): ConsultAnalysisFeatureProfileDTO {
  const entries = Object.entries(profile).map(([field, observation]) => [
    field,
    {
      value: observation.value,
      confidence: { ...observation.confidence },
      evidence: [...observation.evidence],
    },
  ])
  return Object.fromEntries(entries) as ConsultAnalysisFeatureProfileDTO
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
type HairColorProBriefBuildArgs = {
  intakeRevisionId: string
  intakeAnswers: Readonly<Record<string, string>>
  analysisRevisionId: string
  analysisRevision: number
  analysis: ConsultAnalysisPayloadDTO
}

function buildHairColorProBriefCore(
  args: HairColorProBriefBuildArgs,
  schemaVersion: number,
): HairColorProBriefCore {
  const clientIntake = intakeItems(args.intakeAnswers)
  if (clientIntake.length === 0) {
    throw new Error('Consult brief intake is unavailable.')
  }

  return {
    schemaVersion,
    sourceAnalysisRevisionId: args.analysisRevisionId,
    sourceAnalysisRevision: args.analysisRevision,
    intakeRevisionId: args.intakeRevisionId,
    // Rendering always places this client-authored selection list first.
    clientIntake,
    // AI-derived content is a distinct second structure, never blended into
    // the client's own statements.
    profile: structuredCloneProfile(args.analysis.profile),
    styleDirections: args.analysis.styleDirections.map((direction) => ({
      ...direction,
      evidence: [...direction.evidence],
      confidence: { ...direction.confidence },
    })),
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

export function buildHairColorProBriefPayload(
  args: HairColorProBriefBuildArgs & { inspiration: ConsultBriefInspirationDTO },
): HairColorProBriefPayload {
  return {
    ...buildHairColorProBriefCore(args, CONSULT_PRO_BRIEF_SCHEMA_VERSION),
    inspiration: args.inspiration,
  }
}

export function buildLegacyHairColorProBriefPayload(
  args: HairColorProBriefBuildArgs,
): LegacyHairColorProBriefPayload {
  return buildHairColorProBriefCore(
    args,
    LEGACY_CONSULT_PRO_BRIEF_SCHEMA_VERSION,
  )
}

export function toBriefJsonPayload(
  payload: HairColorProBriefPayload,
): Prisma.InputJsonValue {
  return {
    ...payload,
    clientIntake: payload.clientIntake.map((item) => ({ ...item })),
    profile: structuredCloneProfile(payload.profile),
    styleDirections: payload.styleDirections.map((direction) => ({
      ...direction,
      evidence: [...direction.evidence],
      confidence: { ...direction.confidence },
    })),
    inspiration: {
      ...payload.inspiration,
      exactClientDetails: payload.inspiration.exactClientDetails.map((item) => ({ ...item })),
      possibleProfessionalInterpretation: payload.inspiration.possibleProfessionalInterpretation.map((item) => ({ ...item })),
      catalogGuidance: payload.inspiration.catalogGuidance.map((item) => ({ ...item })),
    },
    aiObservations: { ...payload.aiObservations },
    safetyFlags: payload.safetyFlags.map((flag) => ({ ...flag })),
    achievabilityDirection: { ...payload.achievabilityDirection },
    recommendationDirections: payload.recommendationDirections.map((item) => ({
      ...item,
      reference: { ...item.reference },
    })),
  }
}

export function toLegacyBriefJsonPayload(
  payload: LegacyHairColorProBriefPayload,
): Prisma.InputJsonValue {
  return {
    ...payload,
    clientIntake: payload.clientIntake.map((item) => ({ ...item })),
    profile: structuredCloneProfile(payload.profile),
    styleDirections: payload.styleDirections.map((direction) => ({
      ...direction,
      evidence: [...direction.evidence],
      confidence: { ...direction.confidence },
    })),
    aiObservations: { ...payload.aiObservations },
    safetyFlags: payload.safetyFlags.map((flag) => ({ ...flag })),
    achievabilityDirection: { ...payload.achievabilityDirection },
    recommendationDirections: payload.recommendationDirections.map((item) => ({
      ...item,
      reference: { ...item.reference },
    })),
  }
}
