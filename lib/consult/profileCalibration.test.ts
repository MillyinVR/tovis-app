import { describe, expect, it } from 'vitest'
import type { ConsultAnalysisFeatureProfileDTO } from '@/lib/dto/consult'
import { consultCalibrationAnswerItems, needsConsultProfileCalibration } from './profileCalibration'

const unknown = { value: 'UNKNOWN' as const, confidence: { min: 0, max: 0.3 }, evidence: [] }
const profile: ConsultAnalysisFeatureProfileDTO = {
  skinUndertone: unknown, contrastLevel: unknown, colorSeason: unknown,
  faceProportion: unknown, jawline: unknown, foreheadProportion: unknown,
  featureBalance: unknown, eyeShape: unknown, eyeSpacing: unknown,
  browDensity: unknown, browShape: unknown,
}

describe('optional profile clarification', () => {
  it('requires the feature flag and a profile with both readings uncertain', () => {
    expect(needsConsultProfileCalibration(profile, false)).toBe(false)
    expect(needsConsultProfileCalibration(null, true)).toBe(false)
    expect(needsConsultProfileCalibration(profile, true)).toBe(true)
    expect(needsConsultProfileCalibration({ ...profile, contrastLevel: {
      value: 'MEDIUM', confidence: { min: 0.5, max: 0.8 }, evidence: ['face_front'],
    } }, true)).toBe(false)
  })

  it('keeps valid later client answers separate from observed facts and preserves skip', () => {
    const items = consultCalibrationAnswerItems([
      { answers: { color_jewelry_preference: ['gold'], color_sun_response: ['tan'] } },
      { answers: { color_jewelry_preference: ['silver'], color_sun_response: ['unsure'] } },
    ])
    expect(items.map((item) => item.answerCode)).toEqual(['silver', 'unsure'])
    expect(items.every((item) => item.question.includes('client-reported'))).toBe(true)
    expect(profile.skinUndertone.value).toBe('UNKNOWN')
    expect(consultCalibrationAnswerItems([{ answers: { color_sun_response: ['invented'] } }])).toEqual([])
  })
})
