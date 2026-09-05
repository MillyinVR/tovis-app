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

import { consultIntakeItems, findConsultIntakePack } from './intake/registry'
import {
  HAIR_COLOR_INTAKE_PACK_ID,
  HAIR_COLOR_INTAKE_PACK_V2_VERSION,
} from './intake/packs/hairColor'

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
  intakePackId: string,
  intakePackVersion: number | undefined,
  answers: Readonly<Record<string, string>>,
): ConsultBriefClientIntakeItemDTO[] {
  // The VERSION the answers were written under, so the brief shows the pro the
  // questions the client actually saw. Undefined only for a brief built before
  // any pack had a second version; that is the colour pack's v2.
  const pack = findConsultIntakePack(intakePackId, intakePackVersion)
  if (!pack) throw new Error('Consult brief intake pack is unknown.')
  return consultIntakeItems(pack, answers)
}

/**
 * Deterministic C6 render contract. It does not call a model and cannot carry
 * C3 object material: every field comes from the normalized C2 intake pack or
 * the normalized C4 hair-only analysis DTO.
 */
type HairColorProBriefBuildArgs = {
  intakeRevisionId: string
  /**
   * Which intake pack the answers were written under
   * (lib/consult/intake/registry.ts). Defaults to the colour pack, the only
   * pack any brief written before the service-aware consult could carry.
   */
  intakePackId?: string
  /**
   * Which VERSION of that pack. Defaults with `intakePackId` to the colour
   * pack v2 — the only pack/version pairing a brief written before the intake
   * diet could carry.
   */
  intakePackVersion?: number
  intakeAnswers: Readonly<Record<string, string>>
  analysisRevisionId: string
  analysisRevision: number
  analysis: ConsultAnalysisPayloadDTO
}

function buildHairColorProBriefCore(
  args: HairColorProBriefBuildArgs,
  schemaVersion: number,
): HairColorProBriefCore {
  const clientIntake = intakeItems(
    args.intakePackId ?? HAIR_COLOR_INTAKE_PACK_ID,
    args.intakePackVersion ?? HAIR_COLOR_INTAKE_PACK_V2_VERSION,
    args.intakeAnswers,
  )
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
      baseLevel: args.analysis.core.baseLevel,
      lightestLevel: args.analysis.core.lightestLevel,
      currentTone: args.analysis.core.currentTone,
      visibleCondition: args.analysis.core.visibleCondition,
      density: args.analysis.core.density,
      texture: args.analysis.core.texture,
      goalSummary: args.analysis.serviceLens.goal,
      historySummary: args.analysis.serviceLens.history,
      constraintsSummary: args.analysis.serviceLens.constraints,
      maintenanceSummary: args.analysis.serviceLens.maintenance,
      appointmentContextSummary: args.analysis.serviceLens.appointmentContext,
    },
    // Safety remains a top-level sibling, so no presentation tier can hide it
    // by trimming observations or recommendations.
    safetyFlags: args.analysis.safetyFlags.map((flag) => ({ ...flag })),
    achievabilityDirection: {
      direction:
        'Discuss this assessment with the professional; they will decide what is achievable in person.',
      assessment: args.analysis.serviceLens.achievability,
      context: args.analysis.serviceLens.achievabilityReason,
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
