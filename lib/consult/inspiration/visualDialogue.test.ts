import { describe, expect, it } from 'vitest'
import { defaultClientConsultInspirationCopy as copy } from '@/lib/brand/defaultClientConsultInspirationCopy'
import type { ConsultInspirationAnalysisAttributesDTO, ConsultInspirationAnalysisRegionDTO } from '@/lib/dto/consult'
import { buildConsultInspirationCards, composeConsultInspirationUnderstanding, deriveConsultInspirationPreferences } from './cards'
import { HAIR_COLOR_INSPIRATION_CARD_PACK as colorPack, HAIR_COLOR_INSPIRATION_CARD_PACK_V4 } from './packs/hairColor'
import { HAIR_GENERAL_INSPIRATION_CARD_PACK as generalPack } from './packs/hairGeneral'
import { applyConsultInspirationReopen, evaluateConsultInspirationProgress, findConsultInspirationPack, resolveConsultInspirationPayloadV2 } from './registry'
import { resolveVisualDialogueQuestion } from './visualDialogue'

const root = { x: 0.3, y: 0.05, w: 0.4, h: 0.2 }
const ends = { x: 0.2, y: 0.55, w: 0.6, h: 0.35 }
function observed<T extends string>(value: T, region: ConsultInspirationAnalysisRegionDTO | null = ends) {
  return { value, region, confidence: { min: 0.4, max: 0.65 }, evidence: ['inspiration' as const] }
}
const reading: ConsultInspirationAnalysisAttributesDTO = {
  baseLevel: observed('LEVEL_5', root), rootBlend: observed('SHADOW_ROOT', root),
  lightestLevel: observed('LEVEL_9'), tone: observed('WARM'), placement: observed('FACE_FRAMING'),
  dimension: observed('MEDIUM'), technique: observed('BALAYAGE'), finish: observed('HIGH_SHINE'),
}
const initial = { spark_focus: ['the-color', 'the-layers'], keep_as_is: ['my-length'], look_match: ['adapt-selected-parts'] }

for (const pack of [colorPack, generalPack]) describe(`${pack.id} visual dialogue`, () => {
  function cards(answers = initial, photo = reading) {
    return buildConsultInspirationCards({ pack, answers, reading: photo, copy, professionalDisplayName: 'Sam' }).coarse
  }
  it('uses the actual roots and ends, regardless of whether the reference was linked to a color service', () => {
    const shown = cards()
    expect(shown.find((card) => card.questionKey === 'color_roots')?.region).toEqual(root)
    expect(shown.find((card) => card.questionKey === 'color_lightness')?.region).toEqual(ends)
    expect(shown.filter((card) => card.attribute).every((card) => card.presentation === 'CROP')).toBe(true)
    expect(shown.some((card) => card.attribute === 'technique')).toBe(false)
    expect(shown.map((card) => card.name).join(' ')).not.toMatch(/balayage|extensions|platinum/i)
  })
  it('requires the image-specific questions before confirmation and does not trust an earlier broad confirmation', () => {
    const progress = evaluateConsultInspirationProgress(pack, { ...initial, understanding_check: ['thats-right'] }, copy, null, reading)
    expect(progress.currentQuestion?.key).toBe('color_roots')
    expect(progress.canComplete).toBe(false)
  })
  it('skips color questions when the attraction is only layers, or the client is preserving all their color', () => {
    for (const answers of [{ ...initial, spark_focus: ['the-layers'] }, { ...initial, keep_as_is: ['my-color'] }]) {
      expect(cards(answers).some((card) => card.attribute)).toBe(false)
      expect(evaluateConsultInspirationProgress(pack, answers, copy, null, reading).currentQuestion?.key).toBe('understanding_check')
    }
  })
  it('never creates a crop question from an unknown, uncertain, or unlocated observation', () => {
    for (const tone of [observed('UNKNOWN', null), { ...observed('COOL'), confidence: { min: 0.1, max: 0.3 } }, observed('WARM', null)]) {
      const photo = { ...reading, tone }
      expect(cards(initial, photo).some((card) => card.questionKey === 'color_tone')).toBe(false)
    }
  })
  it('confirms natural roots without asking again and removes conflicting scalp-brightness options', () => {
    const answers = { ...initial, keep_as_is: ['my-natural-roots'] }
    expect(cards(answers).some((card) => card.questionKey === 'color_roots')).toBe(false)
    const blend = cards(answers, { ...reading, rootBlend: observed('SOLID_TO_ROOT', root) }).find((card) => card.questionKey === 'color_root_blend')!
    expect(blend.question.options.map(({ value }) => value)).not.toContain('closer-to-roots')
    expect(blend.question.options.map(({ value }) => value)).not.toContain('match-reference')
  })
  it('asks about lightening or darkening the client’s own roots only after a request to change them', () => {
    expect(cards().some((card) => card.questionKey === 'color_root_change')).toBe(false)
    const changed = { ...initial, color_roots: ['change-base'] }
    expect(cards(changed).some((card) => card.questionKey === 'color_root_change')).toBe(true)
    expect(evaluateConsultInspirationProgress(pack, changed, copy, null, reading).currentQuestion?.key).toBe('color_root_change')
  })
  it('preserves shade uncertainty and a placement-only match without copying every color in the photo', () => {
    const answers = { ...initial, color_tone: ['not-sure'], color_placement: ['match-reference'], color_lightness: ['darker'] }
    const prefs = deriveConsultInspirationPreferences({ pack, answers, reading, copy })
    expect(prefs.wants).toContain('placement:FACE_FRAMING')
    expect(prefs.wants).not.toContain('tone:WARM')
    expect(prefs.wants).not.toContain('lightestLevel:LEVEL_9')
    expect(prefs.unsure.join(' ')).toContain('see options')
    const summary = composeConsultInspirationUnderstanding({ pack, answers, reading, copy, professionalDisplayName: 'Sam' })
    expect(summary).toContain('light pieces less light')
    expect(summary).toContain('compare shades visually')
    expect(summary).not.toContain('like the warm')
  })
  it('clears dependent answers and confirmation when the root goal changes', () => {
    const question = pack.questions.find((q) => q.key === 'color_roots')!
    const changed = applyConsultInspirationReopen(question, ['keep-natural'], {
      ...initial, color_roots: ['change-base'], color_root_change: ['lighter'], color_root_blend: ['closer-to-roots'], color_tone: ['match-reference'], understanding_check: ['thats-right'],
    })
    expect(changed.color_root_change).toBeUndefined()
    expect(changed.color_root_blend).toBeUndefined()
    expect(changed.understanding_check).toBeUndefined()
    expect(changed.color_tone).toEqual(['match-reference'])
  })
  it('can finish with explicit uncertainty and round-trips every revision through the persisted contract', () => {
    let answers: Record<string, readonly string[]> = { ...initial }
    for (let step = 0; step < 12; step += 1) {
      const progress = evaluateConsultInspirationProgress(pack, answers, copy, null, reading)
      if (!progress.currentQuestion) break
      const question = pack.questions.find((q) => q.key === progress.currentQuestion!.key)!
      answers = applyConsultInspirationReopen(question, [question.key === 'understanding_check' ? 'thats-right' : 'not-sure'], answers)
      const complete = evaluateConsultInspirationProgress(pack, answers, copy, null, reading).canComplete
      expect(resolveConsultInspirationPayloadV2({ packId: pack.id, packVersion: pack.version, schemaVersion: 2, source: 'PLATFORM_LOOK', inspirationId: 'ref-one', answers, complete, catalogGuidance: [] })).not.toBeNull()
    }
    expect(evaluateConsultInspirationProgress(pack, answers, copy, null, reading).canComplete).toBe(true)
  })
  it('does not offer impossible brighter-than-lightest or softer-than-flat reference directions', () => {
    const photo = { ...reading, lightestLevel: observed('LEVEL_10'), dimension: observed('FLAT') }
    const lightness = pack.questions.find((q) => q.key === 'color_lightness')!
    expect(resolveVisualDialogueQuestion(lightness, initial, photo)?.options.map((option) => option.value)).not.toContain('lighter')
    expect(cards(initial, photo).find((card) => card.questionKey === 'color_dimension')).toBeUndefined()
    const flat = { ...reading, baseLevel: observed('LEVEL_5'), lightestLevel: observed('LEVEL_5'), dimension: observed('FLAT') }
    expect(cards(initial, flat).some((card) => card.questionKey === 'color_root_blend')).toBe(false)
  })
})

it('retains the last broad preference pack unchanged for existing sessions', () => {
  expect(findConsultInspirationPack(colorPack.id, 4)).toBe(HAIR_COLOR_INSPIRATION_CARD_PACK_V4)
  expect(HAIR_COLOR_INSPIRATION_CARD_PACK_V4.questions.map((q) => q.key)).toEqual(['spark_focus', 'keep_as_is', 'look_match', 'understanding_check', 'love_regions', 'change_regions'])
})
