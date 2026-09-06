import { describe, expect, it } from 'vitest'

import { defaultClientConsultInspirationCopy } from '@/lib/brand/defaultClientConsultInspirationCopy'
import type { ConsultInspirationAnalysisAttributesDTO } from '@/lib/dto/consult'

import {
  buildConsultInspirationCards,
  composeConsultInspirationUnderstanding,
  CONSULT_INSPIRATION_PREP_CARD_MIN_CONFIDENCE,
  deriveConsultInspirationPreferences,
  unionConsultInspirationRegions,
} from './cards'
import { GENERAL_SERVICE_INSPIRATION_CARD_PACK } from './packs/generalService'
import { HAIR_COLOR_INSPIRATION_CARD_PACK } from './packs/hairColor'
import { evaluateConsultInspirationProgress } from './registry'

const copy = defaultClientConsultInspirationCopy
const pack = HAIR_COLOR_INSPIRATION_CARD_PACK
const PRO = 'Susie'

/**
 * 🔴 The default confidence is 0.4–0.65 — the range a real inspiration read
 * actually answers with, and the range the integration fakes produce. It is
 * the default here on purpose: a test that used 0.7–0.9 would have passed
 * happily with a floor set above every real reading.
 */
function observed(
  value: string,
  region: { x: number; y: number; w: number; h: number } | null,
  confidence = { min: 0.4, max: 0.65 },
) {
  return { value, confidence, evidence: ['inspiration' as const], region }
}

const UNREAD = observed('UNKNOWN', null, { min: 0.05, max: 0.3 })

/**
 * A LIGHT BLONDE reference, as the vision model actually answers one: a level
 * 6 base melting to a level 9, cool, babylights through the mids and ends.
 *
 * The regions are deliberately in two different parts of the frame — the
 * colour attributes low and central, the arrangement attributes high and wide
 * — because "the coarse crops visibly correspond to color vs shape" is a claim
 * about geometry, and a test that used one box everywhere could not tell.
 */
const BLONDE: ConsultInspirationAnalysisAttributesDTO = {
  baseLevel: observed('LEVEL_6', { x: 0.35, y: 0.05, w: 0.3, h: 0.15 }),
  lightestLevel: observed('LEVEL_9', { x: 0.3, y: 0.6, w: 0.4, h: 0.3 }),
  tone: observed('COOL', { x: 0.32, y: 0.5, w: 0.36, h: 0.25 }),
  technique: observed('BABYLIGHTS', { x: 0.1, y: 0.2, w: 0.8, h: 0.4 }),
  placement: observed('MIDS_TO_ENDS', { x: 0.12, y: 0.3, w: 0.75, h: 0.5 }),
  rootBlend: observed('SEAMLESS_MELT', { x: 0.3, y: 0.1, w: 0.4, h: 0.3 }),
  finish: observed('HIGH_SHINE', { x: 0.4, y: 0.45, w: 0.2, h: 0.2 }),
  // Left unread on purpose: it is what the understanding check says it could
  // not see, and it must produce NO card.
  dimension: UNREAD,
} as ConsultInspirationAnalysisAttributesDTO

function cards(
  answers: Record<string, readonly string[]> = {},
  reading: ConsultInspirationAnalysisAttributesDTO | null = BLONDE,
  definition = pack,
) {
  return buildConsultInspirationCards({
    pack: definition,
    reading,
    copy,
    professionalDisplayName: PRO,
    answers,
  })
}

describe('inspiration cards', () => {
  it('🔴 builds a card only for an attribute the reading actually settled', () => {
    const { coarse, prep } = cards()
    expect(coarse.map((card) => card.questionKey)).toEqual([
      'spark_focus',
      'keep_as_is',
      'understanding_check',
    ])
    // Seven read attributes → seven prep cards. `dimension` was UNKNOWN, so it
    // has none: an absence is never padded out with a card that says nothing.
    expect(prep.map((card) => card.attribute)).toEqual([
      'baseLevel',
      'lightestLevel',
      'tone',
      'technique',
      'placement',
      'rootBlend',
      'finish',
    ])
    expect(prep.some((card) => card.attribute === 'dimension')).toBe(false)
  })

  it('🔴 a light-blonde reference produces blonde cards and NO copper card (B5)', () => {
    const { prep } = cards()
    const names = prep.map((card) => card.name ?? '')
    expect(names.join(' ')).toContain('light blonde')
    expect(names.join(' ')).toContain('cooler, silvery cast')
    // The v1 question list asked every client about "the copper or red colors".
    // Nothing in a card can, because there is no list — only what was read.
    expect(names.join(' ').toLowerCase()).not.toContain('copper')
    expect(names.join(' ').toLowerCase()).not.toContain('red')
    for (const card of prep) {
      expect(card.question.options.map((option) => option.value)).toEqual([
        'yes',
        'not-this',
        'not-sure',
      ])
    }
  })

  it('drops a reading the model itself was not sure enough about', () => {
    const hedged = {
      ...BLONDE,
      tone: observed('COOL', { x: 0, y: 0, w: 1, h: 1 }, {
        min: CONSULT_INSPIRATION_PREP_CARD_MIN_CONFIDENCE - 0.01,
        max: 0.9,
      }),
    } as ConsultInspirationAnalysisAttributesDTO
    expect(cards({}, hedged).prep.some((card) => card.attribute === 'tone')).toBe(false)
  })

  it('🔴 the coarse crops for colour and shape are different parts of the picture', () => {
    const spark = cards().coarse[0]!
    const byValue = new Map(spark.optionRegions.map((option) => [option.value, option]))
    const colour = byValue.get('the-color')!.region!
    const shape = byValue.get('the-shape')!.region!
    // The colour crop is the union of the colour attributes' boxes; the shape
    // crop is the union of the arrangement ones. They must not be the same box,
    // or the card is asking her to tell two identical pictures apart.
    expect(colour).not.toEqual(shape)
    expect(shape.w).toBeGreaterThan(colour.w)
    expect(colour.y + colour.h).toBeGreaterThan(shape.y + shape.h)
    // "The whole thing" and "Not sure" are about the whole picture, so they
    // show it whole.
    expect(byValue.get('the-whole-thing')!.region).toBeNull()
    expect(byValue.get('not-sure')!.region).toBeNull()
  })

  it('falls back to the whole reference when there is no reading at all', () => {
    const { coarse, prep } = cards({}, null)
    expect(prep).toHaveLength(0)
    expect(coarse).toHaveLength(3)
    for (const option of coarse[0]!.optionRegions) {
      expect(option.region).toBeNull()
    }
    // The four options are still the four options — the question does not
    // change because the photograph could not be read.
    expect(coarse[0]!.question.options.map((option) => option.label)).toEqual([
      'The color',
      'The shape of it',
      'The whole thing',
      'Not sure',
    ])
  })

  it('gives a non-colour family its own cards, with its own keep options', () => {
    const { coarse, prep } = cards({}, null, GENERAL_SERVICE_INSPIRATION_CARD_PACK)
    expect(prep).toHaveLength(0)
    expect(coarse.map((card) => card.questionKey)).toEqual([
      'spark_focus',
      'keep_as_is',
      'understanding_check',
    ])
    expect(coarse[1]!.question.label).toBe('Anything you don’t want to change?')
    expect(coarse[1]!.question.options.map((option) => option.label)).toEqual([
      'My length',
      'My natural shape',
      'Nothing in particular',
    ])
  })

  it('words the hair keep card as hair', () => {
    expect(cards().coarse[1]!.question.label).toBe(
      'Anything about your hair you don’t want to change?',
    )
    expect(cards().coarse[1]!.question.options.map((option) => option.label)).toEqual([
      'My length',
      'My natural roots',
      'Nothing in particular',
    ])
  })

  describe('the understanding check', () => {
    const sentence = (
      answers: Record<string, readonly string[]>,
      reading: ConsultInspirationAnalysisAttributesDTO | null = BLONDE,
    ) =>
      composeConsultInspirationUnderstanding({
        answers,
        reading,
        copy,
        professionalDisplayName: PRO,
      })

    it('names the colour she pointed at, what she is keeping, and what is still open', () => {
      expect(
        sentence({ spark_focus: ['the-color'], keep_as_is: ['my-length'] }),
      ).toBe(
        'You like the light blonde, want to keep your length, and aren’t sure yet how much light and dark you want. We’ll help Susie work out the details.',
      )
    })

    it('reads as one clause when she kept nothing in particular', () => {
      expect(
        sentence({
          spark_focus: ['the-shape'],
          keep_as_is: ['nothing-in-particular'],
        }),
      ).toBe(
        'You like the shape of it and aren’t sure yet how much light and dark you want. We’ll help Susie work out the details.',
      )
    })

    it('says plainly that she is not sure, rather than inventing a preference', () => {
      expect(
        sentence({
          spark_focus: ['not-sure'],
          keep_as_is: ['my-length', 'my-natural-roots'],
        }),
      ).toBe(
        'You aren’t sure yet what pulled you in, want to keep your length, want to keep your natural roots, and aren’t sure yet how much light and dark you want. We’ll help Susie work out the details.',
      )
    })

    it('falls back rather than composing a sentence out of nothing', () => {
      expect(sentence({}, null)).toBe(
        'You’ve shown me the picture you’re after. We’ll help Susie work out the details.',
      )
    })

    it('🔴 never opens with a hedge she has not earned', () => {
      // The check renders (blocked) before she reaches it. With nothing
      // answered, a lone "aren't sure" clause reads as words put in her mouth
      // about a question nobody asked — so the fallback stands instead.
      expect(sentence({})).toBe(
        'You’ve shown me the picture you’re after. We’ll help Susie work out the details.',
      )
      expect(sentence({ keep_as_is: ['nothing-in-particular'] })).toBe(
        'You’ve shown me the picture you’re after. We’ll help Susie work out the details.',
      )
    })

    it('is what the card actually asks', () => {
      const check = cards({
        spark_focus: ['the-color'],
        keep_as_is: ['my-length'],
      }).coarse[2]!
      expect(check.question.label).toBe(
        sentence({ spark_focus: ['the-color'], keep_as_is: ['my-length'] }),
      )
      expect(check.question.options.map((option) => option.label)).toEqual([
        'That’s right',
        'Change something',
      ])
    })
  })

  describe('completion', () => {
    it('🔴 needs the coarse tier only — a prep card never blocks', () => {
      const coarseDone = {
        spark_focus: ['the-color'],
        keep_as_is: ['nothing-in-particular'],
        understanding_check: ['thats-right'],
      }
      const progress = evaluateConsultInspirationProgress(pack, coarseDone, copy)
      expect(progress.canComplete).toBe(true)
      expect(progress.currentQuestion).toBeNull()
      expect(progress.nextPrepQuestionKey).toBe('attr_base_level')
    })

    it('🔴 all-unsure is a valid completion', () => {
      const progress = evaluateConsultInspirationProgress(
        pack,
        {
          spark_focus: ['not-sure'],
          keep_as_is: ['nothing-in-particular'],
          understanding_check: ['thats-right'],
        },
        copy,
      )
      expect(progress.canComplete).toBe(true)
      expect(progress.specificDetailCount).toBe(0)
    })
  })

  describe('what the analysis is told', () => {
    it('pairs each tap with the attribute VALUE it was asked about', () => {
      const preferences = deriveConsultInspirationPreferences({
        pack,
        reading: BLONDE,
        copy,
        answers: {
          spark_focus: ['the-color'],
          keep_as_is: ['my-length'],
          attr_lightest_level: ['yes'],
          attr_tone: ['not-this'],
          attr_finish: ['not-sure'],
          // Answered, but its attribute was never read — so it says nothing,
          // rather than saying "yes" to an unknown.
          attr_dimension: ['yes'],
        },
      })
      expect(preferences.wants).toEqual(['The color', 'lightestLevel:LEVEL_9'])
      expect(preferences.avoids).toEqual(['tone:COOL'])
      expect(preferences.unsure).toEqual(['finish:HIGH_SHINE'])
      expect(preferences.keep).toEqual(['My length'])
    })

    it('records a coarse "not sure" as unsure, never as a want', () => {
      const preferences = deriveConsultInspirationPreferences({
        pack,
        reading: BLONDE,
        copy,
        answers: { spark_focus: ['not-sure'], keep_as_is: ['nothing-in-particular'] },
      })
      expect(preferences.wants).toEqual([])
      expect(preferences.unsure).toEqual(['Not sure'])
      expect(preferences.keep).toEqual([])
    })
  })

  it('unions regions into the box that contains them, clamped to the image', () => {
    expect(
      unionConsultInspirationRegions([
        { x: 0.1, y: 0.2, w: 0.2, h: 0.2 },
        { x: 0.5, y: 0.1, w: 0.6, h: 0.4 },
        null,
      ]),
    ).toEqual({ x: 0.1, y: 0.1, w: 0.9, h: 0.4 })
    expect(unionConsultInspirationRegions([null, null])).toBeNull()
  })
})
