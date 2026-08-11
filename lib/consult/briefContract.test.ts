import { describe, expect, it } from 'vitest'

import type { ConsultAnalysisPayloadDTO } from '@/lib/dto/consult'

import { buildHairColorProBriefPayload, toBriefJsonPayload } from './briefContract'

function analysis(): ConsultAnalysisPayloadDTO {
  const confidence = { min: 0.4, max: 0.7 }
  return {
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

  it('cannot carry raw image material or unsupported traits into durable JSON', () => {
    const json = JSON.stringify(
      toBriefJsonPayload(
        buildHairColorProBriefPayload({
          intakeRevisionId: 'intake_1',
          intakeAnswers: { desired_color: 'red' },
          analysisRevisionId: 'analysis_1',
          analysisRevision: 4,
          analysis: analysis(),
        }),
      ),
    )

    for (const forbidden of [
      'base64',
      'storagePath',
      'storageBucket',
      'signedUrl',
      'skinTone',
      'undertone',
      'faceShape',
      'eyeShape',
      'ethnicity',
      'health',
    ]) {
      expect(json).not.toContain(forbidden)
    }
  })
})
