import { describe, expect, it } from 'vitest'

import type { ConsultAnalysisPayloadDTO } from '@/lib/dto/consult'

import {
  buildHairColorProBriefPayload,
  buildLegacyHairColorProBriefPayload,
  toBriefJsonPayload,
  toLegacyBriefJsonPayload,
} from './briefContract'

function analysis(): ConsultAnalysisPayloadDTO {
  const confidence = { min: 0.4, max: 0.7 }
  const faceObservation = <T extends string>(value: T) => ({
    value,
    confidence,
    evidence: ['face_front' as const],
  })
  return {
    profile: {
      skinUndertone: faceObservation('NEUTRAL'),
      contrastLevel: faceObservation('MEDIUM'),
      colorSeason: { value: 'UNKNOWN', confidence: { min: 0, max: 0.2 }, evidence: [] },
      faceProportion: faceObservation('BALANCED'),
      jawline: faceObservation('SOFTLY_ROUNDED'),
      foreheadProportion: faceObservation('BALANCED'),
      featureBalance: faceObservation('SOFT'),
      eyeShape: faceObservation('HOODED'),
      eyeSpacing: faceObservation('BALANCED'),
      browDensity: faceObservation('FULL'),
      browShape: faceObservation('SOFT_ARCH'),
    },
    styleDirections: [
      'HAIR_COLOR_HARMONY',
      'CUT_AND_SHAPE',
      'BANGS',
      'BROWS',
      'LASHES',
      'MAKEUP',
      'COLOR_PALETTE',
    ].map((domain) => ({
      domain: domain as ConsultAnalysisPayloadDTO['styleDirections'][number]['domain'],
      title: 'A soft, harmonizing direction',
      direction: 'Discuss a soft, blended direction for this domain together.',
      whyItFlatters:
        'Low observed contrast and soft feature balance favor blended choices.',
      confidence,
      evidence: ['face_front' as const],
      discussWithProfessional: true as const,
    })),
    core: {
      currentLevel: {
        min: 4,
        max: 5,
        confidence,
        evidence: ['hair_back'],
      },
      currentTone: { value: 'MIXED', confidence, evidence: ['hair_left'] },
      visibleCondition: {
        value: 'POSSIBLE_COMPROMISE',
        confidence,
        evidence: ['hair_crown'],
      },
      density: { value: 'UNKNOWN', confidence, evidence: [] },
      texture: { value: 'WAVY', confidence, evidence: ['hair_back'] },
    },
    hairColorLens: {
      goal: 'A noticeable red direction.',
      history: 'Recent box dye was reported.',
      constraints: 'Review chemical history.',
      maintenance: 'Open to regular maintenance.',
      appointmentContext: 'No fixed event date.',
      achievability: 'REQUIRES_PRO_ASSESSMENT',
      achievabilityReason: 'Condition and history need an in-person check.',
      discussWithProfessional: true,
    },
    safetyFlags: [
      {
        code: 'RECENT_BOX_DYE',
        summary: 'Recent box dye was reported.',
        discussWithProfessional: true,
      },
    ],
    recommendations: [
      {
        serviceIntent: 'COLOR_CONSULTATION',
        title: 'Color consultation',
        rationale: 'Review the direction and history together.',
        achievability: 'The professional should confirm the plan.',
        discussWithProfessional: true,
        reference: {
          type: 'SERVICE_CATEGORY',
          serviceId: null,
          serviceCategoryId: 'hair-color-category',
        },
      },
    ],
  }
}

describe('hair-color pro brief contract', () => {
  const inspiration = {
    revisionId: 'inspiration_1',
    source: 'NONE' as const,
    inspirationId: null,
    lookPostId: null,
    mediaEndpoint: null,
    referenceNote: 'An inspiration image is a reference, not a guarantee.',
    exactClientDetails: [],
    possibleProfessionalInterpretation: [],
    catalogGuidance: [],
  }

  it('puts client intake first, AI observations second, and safety in a separate always-present field', () => {
    const payload = buildHairColorProBriefPayload({
      intakeRevisionId: 'intake_1',
      intakeAnswers: {
        current_color: 'brunette',
        desired_color: 'red',
      },
      analysisRevisionId: 'analysis_1',
      analysisRevision: 4,
      analysis: analysis(),
      inspiration,
    })

    expect(Object.keys(payload).indexOf('clientIntake')).toBeLessThan(
      Object.keys(payload).indexOf('aiObservations'),
    )
    expect(Object.keys(payload).indexOf('aiObservations')).toBeLessThan(
      Object.keys(payload).indexOf('safetyFlags'),
    )
    expect(payload.clientIntake.map((item) => item.answer)).toEqual([
      'Brunette',
      'Red',
    ])
    expect(payload.safetyFlags).toEqual(analysis().safetyFlags)
  })

  it('frames achievability and every recommendation as discussion, never a promise', () => {
    const payload = buildHairColorProBriefPayload({
      intakeRevisionId: 'intake_1',
      intakeAnswers: { desired_color: 'red' },
      analysisRevisionId: 'analysis_1',
      analysisRevision: 4,
      analysis: analysis(),
      inspiration,
    })
    const framing = JSON.stringify({
      achievabilityDirection: payload.achievabilityDirection,
      recommendationDirections: payload.recommendationDirections,
    }).toLowerCase()

    expect(payload.achievabilityDirection.discussWithProfessional).toBe(true)
    expect(payload.achievabilityDirection.direction).toContain('Discuss')
    expect(
      payload.recommendationDirections.every(
        (item) =>
          item.discussWithProfessional && item.direction.includes('discuss'),
      ),
    ).toBe(true)
    expect(framing).not.toMatch(/guarantee|promise|will achieve/)
  })

  it('cannot carry raw image material or forbidden traits into durable JSON', () => {
    // Decision 2026-08-26: cosmetic feature observations (undertone, face and
    // eye descriptors) are now first-class brief content. Raw image material
    // and identity/medical traits remain forbidden.
    const json = JSON.stringify(
      toBriefJsonPayload(
        buildHairColorProBriefPayload({
          intakeRevisionId: 'intake_1',
          intakeAnswers: { desired_color: 'red' },
          analysisRevisionId: 'analysis_1',
          analysisRevision: 4,
          analysis: analysis(),
          inspiration,
        }),
      ),
    )

    for (const forbidden of [
      'base64',
      'storagePath',
      'storageBucket',
      'signedUrl',
      'ethnicity',
      'health',
    ]) {
      expect(json).not.toContain(forbidden)
    }
    expect(json).toContain('styleDirections')
    expect(json).toContain('skinUndertone')
  })

  it('retains the exact v1 projection for immutable historical briefs', () => {
    const legacy = buildLegacyHairColorProBriefPayload({
      intakeRevisionId: 'intake_1',
      intakeAnswers: { desired_color: 'red' },
      analysisRevisionId: 'analysis_1',
      analysisRevision: 4,
      analysis: analysis(),
    })

    expect(toLegacyBriefJsonPayload(legacy)).toMatchObject({
      schemaVersion: 1,
      sourceAnalysisRevisionId: 'analysis_1',
      intakeRevisionId: 'intake_1',
    })
    expect(toLegacyBriefJsonPayload(legacy)).not.toHaveProperty('inspiration')
  })
})
