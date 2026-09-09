import type { ConsultAnalysisObservationDTO } from '@/lib/dto/consult'
import { unknownFaceColorProfile } from '@/lib/consult/analysisEngine'
import type { ConsultSuitabilityInput } from '@/lib/consult/suitabilityTranslation'

/** Entirely synthetic source records; no real client photos, identifiers or text. */
export function syntheticSuitabilityInput(): ConsultSuitabilityInput {
  const unknown = (): ConsultAnalysisObservationDTO<'UNKNOWN'> => ({
    value: 'UNKNOWN', confidence: { min: 0, max: 0.35 }, evidence: [],
  })
  return {
    analysisRevisionId: 'synthetic-analysis', clientRevisionId: 'synthetic-client-choice', clientSource: 'INSPIRATION',
    clientChoices: [
      { clientWords: 'Soft copper color around my face', sentiment: 'LIKE' },
      { clientWords: 'Keep my own length', sentiment: 'GOAL' },
      { clientWords: 'No bold stripes', sentiment: 'DISLIKE' },
    ],
    analysis: {
      profile: {
        skinUndertone: { value: 'WARM', confidence: { min: 0.7, max: 0.85 }, evidence: ['face_front'] },
        contrastLevel: unknown(), colorSeason: unknown(), faceProportion: unknown(),
        jawline: unknown(), foreheadProportion: unknown(), featureBalance: unknown(),
        eyeShape: unknown(), eyeSpacing: unknown(), browDensity: unknown(), browShape: unknown(),
      },
      core: { baseLevel: unknown(), lightestLevel: unknown(), currentTone: unknown(),
        visibleCondition: unknown(), density: unknown(), texture: unknown() },
    },
    faceColor: { analysisRevisionId: 'synthetic-analysis', profile: {
      ...unknownFaceColorProfile(),
      skinDepth: { value: 'MEDIUM', confidence: { min: 0.65, max: 0.8 }, evidence: ['face_front'] },
    } },
  }
}
