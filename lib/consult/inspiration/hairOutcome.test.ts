import { describe, expect, it } from 'vitest'
import { defaultClientConsultInspirationCopy as copy } from '@/lib/brand/defaultClientConsultInspirationCopy'
import { buildConsultInspirationCards, composeConsultInspirationUnderstanding, deriveConsultInspirationPreferences } from './cards'
import { HAIR_COLOR_INSPIRATION_CARD_PACK } from './packs/hairColor'
import { HAIR_GENERAL_INSPIRATION_CARD_PACK } from './packs/hairGeneral'
import { applyConsultInspirationReopen, buildConsultInspirationExactDetails, deriveConsultInspirationCatalogDetails, buildConsultInspirationPossibleInterpretation, evaluateConsultInspirationProgress, findConsultInspirationPack, validateConsultInspirationAnswer } from './registry'

const answers = {
  spark_focus: ['the-color', 'the-layers'],
  keep_as_is: ['my-length'],
  look_match: ['adapt-selected-parts'],
  understanding_check: ['thats-right'],
}

for (const pack of [HAIR_COLOR_INSPIRATION_CARD_PACK, HAIR_GENERAL_INSPIRATION_CARD_PACK]) {
  describe(`${pack.id} outcome preferences`, () => {
    it('lets a client select color and layers while keeping their length, regardless of the linked category', () => {
      expect(validateConsultInspirationAnswer(pack, { questionKey: 'spark_focus', selectedValues: answers.spark_focus }).ok).toBe(true)
      const preferences = deriveConsultInspirationPreferences({ pack, answers, copy, reading: null })
      expect(preferences).toEqual({ wants: ['The color', 'The layers'], avoids: [], unsure: [], keep: ['My length'] })
      const summary = composeConsultInspirationUnderstanding({ pack, answers, copy, reading: null, professionalDisplayName: 'Sam' })
      expect(summary).toContain('like the color, like the layers')
      expect(summary).toContain('want to keep your length')
      expect(summary).toContain('want those parts adapted to you')
      expect(summary).not.toMatch(/extensions|blonde|balayage/i)
    })

    it('shows the whole reference for unobserved cut and layer details, with no invented color crop', () => {
      const { coarse } = buildConsultInspirationCards({ pack, answers, copy, reading: null, professionalDisplayName: 'Sam' })
      expect(coarse.map((card) => card.questionKey)).toEqual(['spark_focus', 'keep_as_is', 'look_match', 'understanding_check'])
      expect(coarse[0]?.question.kind).toBe('MULTI_SELECT')
      expect(coarse[0]?.optionRegions).toEqual([])
    })

    it('requires match intent before confirmation, and allows uncertainty without inventing a goal', () => {
      const progress = evaluateConsultInspirationProgress(pack, { spark_focus: ['not-sure'], keep_as_is: ['nothing-in-particular'] })
      expect(progress.currentQuestion?.key).toBe('look_match')
      expect(progress.canComplete).toBe(false)
      expect(evaluateConsultInspirationProgress(pack, { spark_focus: ['not-sure'], keep_as_is: ['nothing-in-particular'], look_match: ['not-sure'], understanding_check: ['thats-right'] }).canComplete).toBe(true)
    })

    it('withdraws the old confirmation when an answer changes, then asks for a new summary check', () => {
      const focus = pack.questions.find((question) => question.key === 'spark_focus')!
      const revised = applyConsultInspirationReopen(focus, ['the-movement'], answers)
      expect(revised).toEqual({ spark_focus: ['the-movement'], keep_as_is: ['my-length'] })
      expect(evaluateConsultInspirationProgress(pack, revised).canComplete).toBe(false)
      const match = pack.questions.find((question) => question.key === 'look_match')!
      const matched = applyConsultInspirationReopen(match, ['match-selected-parts'], revised)
      expect(evaluateConsultInspirationProgress(pack, matched).currentQuestion?.key).toBe('understanding_check')
      const check = pack.questions.find((question) => question.key === 'understanding_check')!
      expect(applyConsultInspirationReopen(check, ['change-something'], answers)).toEqual({})
    })

    it('does not interpret color attraction as consent to every observed color attribute', () => {
      const interpretations = buildConsultInspirationPossibleInterpretation(pack, buildConsultInspirationExactDetails(pack, answers))
      expect(interpretations.find((item) => item.clientDetailValue === 'the-color')?.possibleMeaning).toContain('does not establish an exact tone')
    })

    it('keeps the previous pack and its single-select answers readable', () => {
      const previous = findConsultInspirationPack(pack.id, pack.version - 1)!
      expect(previous.questions[0]?.kind).toBe('SINGLE_SELECT')
      expect(evaluateConsultInspirationProgress(previous, { spark_focus: ['the-shape'], keep_as_is: ['my-length'], understanding_check: ['thats-right'] }).canComplete).toBe(true)
    })

    it('does not treat color or layers as a request for added length or fullness', () => {
      expect(deriveConsultInspirationCatalogDetails(pack, answers)).toEqual([])
      expect(deriveConsultInspirationCatalogDetails(pack, { spark_focus: ['the-length', 'the-fullness'] })).toEqual(['LENGTH', 'FULLNESS'])
    })

    it('rejects unsure combined with an explicit attraction', () => {
      expect(validateConsultInspirationAnswer(pack, { questionKey: 'spark_focus', selectedValues: ['the-color', 'not-sure'] }).ok).toBe(false)
    })
  })
}
