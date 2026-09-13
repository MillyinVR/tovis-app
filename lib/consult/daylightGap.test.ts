import { describe, expect, it } from 'vitest'

import { consultDaylightGap } from './daylightGap'

const HAIR_PACK = [
  'hair_back', 'hair_left', 'hair_right', 'hair_crown',
  'face_front', 'face_side', 'eyes_closeup',
] as const

const unknown = { value: 'UNKNOWN', confidence: { min: 0, max: 0.3 }, evidence: [] }
const provisional = (value: string) => ({
  value, confidence: { min: 0.3, max: 0.45 }, evidence: ['early_photo'],
})
const settled = (value: string) => ({
  value, confidence: { min: 0.6, max: 0.8 }, evidence: ['face_front'],
})

const allUnknownHair = {
  baseLevel: unknown, lightestLevel: unknown, currentTone: unknown,
  visibleCondition: unknown, density: unknown, texture: unknown,
}

const allUnknownProfile = {
  skinUndertone: unknown, colorSeason: unknown, contrastLevel: unknown,
  eyeShape: unknown, eyeSpacing: unknown, browDensity: unknown,
  browShape: unknown, eyeColor: unknown, skinDepth: unknown,
  surfaceOvertone: unknown,
}

describe('consultDaylightGap', () => {
  it('names every group a selfie-only consult could still settle', () => {
    const gap = consultDaylightGap({
      profile: allUnknownProfile,
      aiObservations: allUnknownHair,
      acceptedShotKeys: ['early_photo'],
      packShotKeys: [...HAIR_PACK],
    })
    expect(gap.unlocks).toEqual([
      'HAIR_LEVELS', 'HAIR_TONE_AND_CONDITION',
      'SKIN_TONE_AND_SEASON', 'EYE_AND_BROW_DETAIL',
    ])
    expect(gap.missingShotKeys).toContain('hair_back')
    expect(gap.missingShotKeys).toContain('face_front')
    // Each view appears once even though two groups want the hair views.
    expect(new Set(gap.missingShotKeys).size).toBe(gap.missingShotKeys.length)
  })

  it('🔴 says NOTHING about a group whose view she already sent', () => {
    // The honesty rule: a photograph she has taken cannot be offered as the
    // fix for an UNKNOWN. If the hair views landed and a level is still
    // unknown, no picture she can take will change it — so we do not imply
    // one would.
    const gap = consultDaylightGap({
      profile: allUnknownProfile,
      aiObservations: allUnknownHair,
      acceptedShotKeys: ['early_photo', 'hair_back'],
      packShotKeys: [...HAIR_PACK],
    })
    expect(gap.unlocks).not.toContain('HAIR_LEVELS')
    expect(gap.unlocks).not.toContain('HAIR_TONE_AND_CONDITION')
    expect(gap.missingShotKeys).not.toContain('hair_back')
    expect(gap.unlocks).toContain('SKIN_TONE_AND_SEASON')
  })

  it('🔴 says NOTHING about a group that was actually answered', () => {
    const gap = consultDaylightGap({
      profile: {
        ...allUnknownProfile,
        skinUndertone: settled('WARM'), colorSeason: settled('TRUE_AUTUMN'),
        contrastLevel: settled('HIGH'), skinDepth: settled('MEDIUM'),
        surfaceOvertone: settled('BALANCED'),
      },
      aiObservations: allUnknownHair,
      acceptedShotKeys: ['early_photo'],
      packShotKeys: [...HAIR_PACK],
    })
    expect(gap.unlocks).not.toContain('SKIN_TONE_AND_SEASON')
    expect(gap.unlocks).toContain('HAIR_LEVELS')
  })

  it('never offers a view this consult’s pack does not serve', () => {
    // An area pack has no hair or eye views, so nothing may point at one.
    const gap = consultDaylightGap({
      profile: allUnknownProfile,
      aiObservations: allUnknownHair,
      acceptedShotKeys: ['early_photo'],
      packShotKeys: ['area_wide', 'area_closeup'],
    })
    expect(gap.unlocks).toEqual([])
    expect(gap.missingShotKeys).toEqual([])
  })

  it('counts what the selfie DID buy, and does not count a settled reading', () => {
    const gap = consultDaylightGap({
      profile: {
        ...allUnknownProfile,
        eyeColor: provisional('BROWN'),
        skinDepth: provisional('LIGHT'),
        contrastLevel: settled('HIGH'),
      },
      aiObservations: allUnknownHair,
      acceptedShotKeys: ['early_photo'],
      packShotKeys: [...HAIR_PACK],
    })
    // The two provisional readings, not the settled one and not the UNKNOWNs.
    expect(gap.provisionalCount).toBe(2)
  })

  it('is empty for a complete consult, so the copy never renders', () => {
    const gap = consultDaylightGap({
      profile: Object.fromEntries(
        Object.keys(allUnknownProfile).map((key) => [key, settled('HIGH')]),
      ),
      aiObservations: Object.fromEntries(
        Object.keys(allUnknownHair).map((key) => [key, settled('HIGH')]),
      ),
      acceptedShotKeys: [...HAIR_PACK],
      packShotKeys: [...HAIR_PACK],
    })
    expect(gap.unlocks).toEqual([])
    expect(gap.provisionalCount).toBe(0)
  })
})
