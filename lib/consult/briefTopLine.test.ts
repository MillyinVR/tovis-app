import { describe, expect, it } from 'vitest'

import type { ConsultInspirationAnalysisAttributesDTO } from '@/lib/dto/consult'

import {
  composeConsultBriefTopLine,
  type ConsultBriefTopLineArgs,
  type ConsultBriefTopLineInspiration,
} from './briefTopLine'
import { consultProBriefTopLineCopy } from '@/lib/brand/consultProBriefTopLineCopy'

import { KEEP_AS_IS_KEY, SPARK_FOCUS_KEY } from './inspiration/cardQuestions'
import {
  HAIR_COLOR_INSPIRATION_CARD_PACK,
  HAIR_COLOR_INSPIRATION_CARD_PACK_V2,
  HAIR_COLOR_INSPIRATION_CARD_PACK_V4,
} from './inspiration/packs/hairColor'
import {
  CONSULT_INSPIRATION_PACK_ARCHIVE,
  CONSULT_INSPIRATION_PACKS,
} from './inspiration/registry'
import { CONSULT_INSPIRATION_NEUTRAL_VALUES } from './inspiration/types'
import { CONSULT_INTAKE_PACK_ARCHIVE, CONSULT_INTAKE_PACKS } from './intake/registry'
import { GOAL_DIRECTION_UNRESOLVED_VALUE } from './intake/sharedOptions'

// The same light-blonde reading the card tests use: level 6 base melting to a
// level 9, cool, babylights through the mids and ends, dimension unread.
function observed<TValue extends string>(
  value: TValue,
  region: { x: number; y: number; w: number; h: number } | null,
  confidence = { min: 0.4, max: 0.65 },
) {
  return { value, confidence, evidence: ['inspiration' as const], region }
}
const UNREAD = observed('UNKNOWN', null, { min: 0.05, max: 0.3 })
const BLONDE = {
  baseLevel: observed('LEVEL_6', { x: 0.35, y: 0.05, w: 0.3, h: 0.15 }),
  lightestLevel: observed('LEVEL_9', { x: 0.3, y: 0.6, w: 0.4, h: 0.3 }),
  tone: observed('COOL', { x: 0.32, y: 0.5, w: 0.36, h: 0.25 }),
  technique: observed('BABYLIGHTS', { x: 0.1, y: 0.2, w: 0.8, h: 0.4 }),
  placement: observed('MIDS_TO_ENDS', { x: 0.12, y: 0.3, w: 0.75, h: 0.5 }),
  rootBlend: observed('SEAMLESS_MELT', { x: 0.3, y: 0.1, w: 0.4, h: 0.3 }),
  finish: observed('HIGH_SHINE', { x: 0.4, y: 0.45, w: 0.2, h: 0.2 }),
  dimension: UNREAD,
} as ConsultInspirationAnalysisAttributesDTO

function inspiration(
  overrides: Partial<ConsultBriefTopLineInspiration> = {},
): ConsultBriefTopLineInspiration {
  return {
    source: 'EXTERNAL_UPLOAD',
    pack: HAIR_COLOR_INSPIRATION_CARD_PACK,
    reading: BLONDE,
    answers: {},
    exactClientDetails: [],
    ...overrides,
  }
}

function intake(answers: Record<string, string>): ConsultBriefTopLineArgs['clientIntake'] {
  return Object.entries(answers).map(([questionKey, answerCode]) => ({ questionKey, answerCode }))
}

/**
 * The rule the memory records as "a model quotes your internal codes back":
 * no shouted enum (`LEVEL_9`, `COOL`), no snake_case key, no `attr_` card key,
 * no `attribute:VALUE` pair, and none of the "Question → Answer" detail
 * strings the preference derivation also produces.
 */
function expectNoInternalCode(sentence: string | null) {
  expect(sentence).not.toMatch(/\b[A-Z][A-Z0-9_]{2,}\b/)
  expect(sentence).not.toMatch(/[a-z]_[a-z]/)
  expect(sentence).not.toMatch(/attr_|→|:/)
}

describe('composeConsultBriefTopLine', () => {
  it('composes every clause from the current (v5) cards and the intake', () => {
    const sentence = composeConsultBriefTopLine({
      inspiration: inspiration({
        answers: {
          spark_focus: ['the-color'],
          keep_as_is: ['my-length'],
          look_match: ['match-selected-parts'],
          color_roots: ['keep-natural'],
          color_lightness: ['match-reference'],
          color_tone: ['match-reference'],
        },
      }),
      clientIntake: intake({
        change_scale: 'noticeable',
        goal_direction: 'lighter',
        maintenance_tolerance: 'low',
      }),
    })
    expect(sentence).toBe(
      'Client wants the color, the light blonde, and the cool, silvery cast (as close to the picture as possible) because the goal is a change people will notice, mainly going lighter. Must preserve the length and the natural roots and avoid heavy upkeep.',
    )
    expectNoInternalCode(sentence)
  })

  it('names the regions she tapped on the v4 love/change cards from the reading, in her words', () => {
    const sentence = composeConsultBriefTopLine({
      inspiration: inspiration({
        pack: HAIR_COLOR_INSPIRATION_CARD_PACK_V4,
        answers: {
          spark_focus: ['the-color', 'the-length'],
          keep_as_is: ['my-natural-roots'],
          love_regions: ['tone', 'technique'],
          change_regions: ['finish'],
        },
      }),
      clientIntake: [],
    })
    expect(sentence).toBe(
      'Client wants the color, the length, the cool, silvery cast, and the very fine light pieces. Must preserve the natural roots and avoid the glassy shine.',
    )
    expectNoInternalCode(sentence)
  })

  it('reads an archived v2 pack with per-attribute answers, dropping an attribute the reading never settled', () => {
    const sentence = composeConsultBriefTopLine({
      inspiration: inspiration({
        pack: HAIR_COLOR_INSPIRATION_CARD_PACK_V2,
        answers: {
          spark_focus: ['the-color'],
          keep_as_is: ['my-natural-roots'],
          attr_tone: ['yes'],
          attr_finish: ['not-this'],
          // Dimension is UNREAD on this reference: a "yes" here is a tap on a
          // card she was never shown, and contributes nothing.
          attr_dimension: ['yes'],
        },
      }),
      clientIntake: [],
    })
    expect(sentence).toBe(
      'Client wants the color and the cool, silvery cast. Must preserve the natural roots and avoid the glassy shine.',
    )
    expectNoInternalCode(sentence)
  })

  it('says "the overall look" for an all-unsure inspiration rather than inventing a part', () => {
    const sentence = composeConsultBriefTopLine({
      inspiration: inspiration({
        pack: HAIR_COLOR_INSPIRATION_CARD_PACK_V4,
        answers: {
          spark_focus: ['not-sure'],
          keep_as_is: ['nothing-in-particular'],
          look_match: ['not-sure'],
          love_regions: ['not-sure'],
          change_regions: ['nothing-to-change'],
        },
      }),
      clientIntake: [],
    })
    expect(sentence).toBe('Client wants the overall look.')
  })

  it('says "the overall look" for the v2 "the whole thing" tap', () => {
    const sentence = composeConsultBriefTopLine({
      inspiration: inspiration({
        pack: HAIR_COLOR_INSPIRATION_CARD_PACK_V2,
        answers: { spark_focus: ['the-whole-thing'] },
      }),
      clientIntake: [],
    })
    expect(sentence).toBe('Client wants the overall look.')
  })

  it('drops region taps on a look with no readable regions and keeps what the spark said', () => {
    const base = {
      pack: HAIR_COLOR_INSPIRATION_CARD_PACK_V4,
      source: 'PLATFORM_LOOK' as const,
      reading: null,
    }
    expect(
      composeConsultBriefTopLine({
        inspiration: inspiration({
          ...base,
          answers: { spark_focus: ['the-cut'], love_regions: ['tone'], change_regions: ['finish'] },
        }),
        clientIntake: [],
      }),
    ).toBe('Client wants the cut.')
    // Nothing readable and nothing specific tapped: the picture is the want.
    expect(
      composeConsultBriefTopLine({
        inspiration: inspiration({ ...base, answers: { spark_focus: ['not-sure'] } }),
        clientIntake: [],
      }),
    ).toBe('Client wants the overall look.')
  })

  it('leaves a region she both loved and would change out of both lists', () => {
    const sentence = composeConsultBriefTopLine({
      inspiration: inspiration({
        pack: HAIR_COLOR_INSPIRATION_CARD_PACK_V4,
        answers: { spark_focus: ['the-color'], love_regions: ['tone'], change_regions: ['tone'] },
      }),
      clientIntake: [],
    })
    expect(sentence).toBe('Client wants the color.')
  })

  describe('each clause absent', () => {
    it('omits "because" when intake gave no reason', () => {
      expect(
        composeConsultBriefTopLine({
          inspiration: inspiration({ answers: { spark_focus: ['the-color'] } }),
          clientIntake: [],
        }),
      ).toBe('Client wants the color.')
    })

    it('omits an unresolved goal direction', () => {
      expect(
        composeConsultBriefTopLine({
          inspiration: inspiration({ answers: { spark_focus: ['the-color'] } }),
          clientIntake: intake({ goal_direction: 'not-sure' }),
        }),
      ).toBe('Client wants the color.')
    })

    it('stands on the intake alone when there is no reference', () => {
      const none = inspiration({ source: 'NONE', reading: null, answers: {} })
      expect(
        composeConsultBriefTopLine({ inspiration: none, clientIntake: intake({ change_scale: 'subtle' }) }),
      ).toBe('Client is after a small change.')
      expect(
        composeConsultBriefTopLine({ inspiration: none, clientIntake: intake({ goal_direction: 'lighter' }) }),
      ).toBe('Client is after going lighter.')
      expect(
        composeConsultBriefTopLine({
          inspiration: null,
          clientIntake: intake({ change_scale: 'total', goal_direction: 'gray-blending' }),
        }),
      ).toBe('Client is after a completely different look, mainly blending the gray.')
    })

    it('writes "Must avoid" alone, and "Must preserve" alone', () => {
      expect(
        composeConsultBriefTopLine({
          inspiration: null,
          clientIntake: intake({ maintenance_tolerance: 'low' }),
        }),
      ).toBe('Must avoid heavy upkeep.')
      expect(
        composeConsultBriefTopLine({
          inspiration: inspiration({ source: 'NONE', answers: { keep_as_is: ['my-length'] } }),
          clientIntake: intake({ maintenance_tolerance: 'high' }),
        }),
      ).toBe('Must preserve the length.')
    })

    it('is null when nothing the client said supports a clause', () => {
      expect(composeConsultBriefTopLine({ inspiration: null, clientIntake: [] })).toBeNull()
      expect(
        composeConsultBriefTopLine({
          inspiration: inspiration({ source: 'NONE', reading: null, answers: {} }),
          clientIntake: intake({ goal_direction: 'not-sure', maintenance_tolerance: 'medium' }),
        }),
      ).toBeNull()
    })
  })

  it('reads the other packs’ goal directions and the "adapt to me" match intent', () => {
    expect(
      composeConsultBriefTopLine({
        inspiration: inspiration({
          pack: HAIR_COLOR_INSPIRATION_CARD_PACK_V4,
          answers: { spark_focus: ['the-layers'], look_match: ['adapt-selected-parts'] },
        }),
        clientIntake: intake({ change_scale: 'subtle', goal_direction: 'texture-movement' }),
      }),
    ).toBe(
      'Client wants the layers (adapted to the client) because the goal is a small change, mainly a change in texture or movement.',
    )
    expect(
      composeConsultBriefTopLine({ inspiration: null, clientIntake: intake({ goal_direction: 'bolder' }) }),
    ).toBe('Client is after a bolder look.')
  })

  it('uses a contract-v1 answer’s own label, which is already words', () => {
    const sentence = composeConsultBriefTopLine({
      inspiration: inspiration({
        pack: null,
        reading: null,
        exactClientDetails: [
          { questionKey: 'favorite_colors', value: 'lightest-pieces', clientWords: 'Lightest pieces', sentiment: 'LIKE' },
          { questionKey: 'avoid_colors', value: 'warm-golden', clientWords: 'Warm golden', sentiment: 'DISLIKE' },
          { questionKey: 'current_styling', value: 'no', clientWords: 'No', sentiment: 'CONTEXT' },
        ],
      }),
      clientIntake: [],
    })
    expect(sentence).toBe('Client wants lightest pieces. Must avoid warm golden.')
    expectNoInternalCode(sentence)
  })

  it('never lets an unknown value through as a code', () => {
    const sentence = composeConsultBriefTopLine({
      inspiration: inspiration({
        pack: HAIR_COLOR_INSPIRATION_CARD_PACK_V4,
        answers: { spark_focus: ['the-color'], keep_as_is: ['my-color'], look_match: ['not-sure'] },
      }),
      clientIntake: intake({ change_scale: 'ENORMOUS', goal_direction: 'reason_now', maintenance_tolerance: 'none' }),
    })
    expect(sentence).toBe('Client wants the color. Must preserve the current color.')
    expectNoInternalCode(sentence)
  })

  // A value with no words is DROPPED from the sentence, silently. That is the
  // right failure for an unknown value at runtime and the wrong one for a
  // value a pack actually offers: C2-6c adds questions and reworded packs, and
  // a new option without an entry here would vanish from every Brief with no
  // test going red. So every registered pack — current and archived — must be
  // fully worded.
  describe('the copy table covers every value a registered pack can answer with', () => {
    const packs = [...CONSULT_INTAKE_PACKS, ...CONSULT_INTAKE_PACK_ARCHIVE]
    const tables = {
      change_scale: consultProBriefTopLineCopy.changeScale,
      goal_direction: consultProBriefTopLineCopy.goalDirection,
    } as const

    for (const [key, table] of Object.entries(tables)) {
      it(`words every ${key} option`, () => {
        for (const pack of packs) {
          const question = pack.questions.find((entry) => entry.key === key)
          if (!question) continue
          for (const option of question.options) {
            if (option.value === GOAL_DIRECTION_UNRESOLVED_VALUE) continue
            expect(table[option.value], `${pack.id}@${pack.version} ${key}:${option.value}`).toBeTruthy()
          }
        }
      })
    }

    it('words every spark and keep value on every inspiration card pack', () => {
      for (const pack of [...CONSULT_INSPIRATION_PACKS, ...CONSULT_INSPIRATION_PACK_ARCHIVE]) {
        for (const question of pack.questions) {
          if (question.key !== SPARK_FOCUS_KEY && question.key !== KEEP_AS_IS_KEY) continue
          for (const option of question.options) {
            if (CONSULT_INSPIRATION_NEUTRAL_VALUES.has(option.value)) continue
            const phrase =
              question.key === SPARK_FOCUS_KEY
                ? option.value === 'the-whole-thing'
                  ? consultProBriefTopLineCopy.overallLook
                  : consultProBriefTopLineCopy.sparkFocus[option.value]
                : consultProBriefTopLineCopy.keep[`${KEEP_AS_IS_KEY}:${option.value}`]
            expect(phrase, `${pack.id}@${pack.version} ${question.key}:${option.value}`).toBeTruthy()
          }
        }
      }
    })
  })
})
