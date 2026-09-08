import type { ConsultInspirationAnalysisAttributesDTO } from '@/lib/dto/consult'
import { hairOutcomeCards, UNDERSTANDING_CHECK_KEY } from './cardQuestions'
import { consultInspirationAttributeIsCardworthy } from './evidence'
import { inspirationCard, type ConsultInspirationPackQuestion } from './types'

type Answers = Readonly<Record<string, readonly string[]>>

/** All choices describe visible results, never a technique inferred from a photo. */
const VISUAL_QUESTIONS = [
  { key: 'color_roots', attribute: 'baseLevel', values: ['match-reference', 'keep-natural', 'change-base', 'not-sure'] },
  { key: 'color_root_change', attribute: 'baseLevel', values: ['lighter', 'darker', 'not-sure'] },
  { key: 'color_root_blend', attribute: 'rootBlend', values: ['match-reference', 'closer-to-roots', 'farther-from-roots', 'soft-blend', 'not-sure'] },
  { key: 'color_lightness', attribute: 'lightestLevel', values: ['match-reference', 'lighter', 'darker', 'not-sure'] },
  { key: 'color_tone', attribute: 'tone', values: ['match-reference', 'different-tone', 'not-sure'] },
  { key: 'color_placement', attribute: 'placement', values: ['match-reference', 'softer', 'bolder', 'different-placement', 'not-sure'] },
  { key: 'color_dimension', attribute: 'dimension', values: ['match-reference', 'softer', 'more-contrast', 'not-sure'] },
] as const

/** Shared by card rendering, progress and writes: hidden choices cannot be submitted. */
export function resolveVisualDialogueQuestion(
  question: ConsultInspirationPackQuestion,
  answers: Answers,
  reading: ConsultInspirationAnalysisAttributesDTO | null,
): ConsultInspirationPackQuestion | null {
  if (!question.visualDialogue) return question
  if (!answers.spark_focus?.includes('the-color') || answers.keep_as_is?.includes('my-color')) return null
  const attribute = question.attribute
  if (!attribute || !consultInspirationAttributeIsCardworthy(reading, attribute) || !reading?.[attribute].region) return null
  if (question.key === 'color_root_change' && !answers.color_roots?.includes('change-base')) return null
  const keepNatural = answers.keep_as_is?.includes('my-natural-roots') || answers.color_roots?.includes('keep-natural')
  if (question.key === 'color_roots' && answers.keep_as_is?.includes('my-natural-roots')) return null
  if (question.key === 'color_dimension' && reading.dimension.value === 'FLAT') return null
  if (question.key === 'color_root_blend' && reading.dimension.value === 'FLAT' &&
    reading.baseLevel.value !== 'UNKNOWN' && reading.baseLevel.value === reading.lightestLevel.value) return null
  let options = question.options
  if (question.key === 'color_root_blend') {
    const solid = reading.rootBlend.value === 'SOLID_TO_ROOT'
    options = options.filter(({ value }) => {
      if (value === 'closer-to-roots') return !solid && !keepNatural
      if (value === 'match-reference' && solid && keepNatural) return false
      if (value === 'soft-blend') return reading.rootBlend.value !== 'SEAMLESS_MELT'
      return true
    })
  }
  if (question.key === 'color_lightness') {
    options = options.filter(({ value }) =>
      !(value === 'lighter' && reading.lightestLevel.value === 'LEVEL_10') &&
      !(value === 'darker' && reading.lightestLevel.value === 'LEVEL_1'))
  }
  if (question.key === 'color_dimension') {
    options = options.filter(({ value }) =>
      !(value === 'more-contrast' && reading.dimension.value === 'HIGH_CONTRAST'))
  }
  return { ...question, options }
}

/** Six possible crop questions plus a root-change follow-up, filtered to this reference and goal. */
export function hairVisualDialogueCards(): ConsultInspirationPackQuestion[] {
  const visualKeys = VISUAL_QUESTIONS.map(({ key }) => key)
  const visual = VISUAL_QUESTIONS.map(({ key, attribute, values }) => ({
    ...inspirationCard({
      key, attribute, values, tier: 'COARSE', kind: 'SINGLE_SELECT', detailSentiment: 'GOAL',
      valueSentiments: { 'match-reference': 'LIKE' },
      reopens: Object.fromEntries(values.map((value) => [value,
        key === 'color_roots' ? ['color_root_change', 'color_root_blend', UNDERSTANDING_CHECK_KEY] : [UNDERSTANDING_CHECK_KEY],
      ])),
    }),
    visualDialogue: true,
  }))
  const coarse = hairOutcomeCards().map((question) => ({
    ...question,
    reopens: Object.fromEntries(Object.entries(question.reopens ?? {}).map(([value, cleared]) => [
      value, question.key === 'spark_focus' || question.key === 'keep_as_is' || question.key === UNDERSTANDING_CHECK_KEY
        ? [...cleared, ...visualKeys] : cleared,
    ])),
  }))
  return [...coarse.filter(({ key }) => key !== UNDERSTANDING_CHECK_KEY), ...visual,
    ...coarse.filter(({ key }) => key === UNDERSTANDING_CHECK_KEY)]
}
