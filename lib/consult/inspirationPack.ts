import { isDeepStrictEqual } from 'node:util'
import type { Prisma } from '@prisma/client'

import type {
  ConsultInspirationAnswerDTO,
  ConsultInspirationCatalogGuidanceDTO,
  ConsultInspirationExactDetailDTO,
  ConsultInspirationPossibleInterpretationDTO,
  ConsultInspirationQuestionDTO,
  ConsultInspirationQuestionKeyDTO,
  ConsultInspirationReviewDTO,
  ConsultInspirationSourceDTO,
} from '@/lib/dto/consult'
import { isRecord } from '@/lib/guards'

import {
  CONSULT_INSPIRATION_TEXT_MAX_CHARS,
  CONSULT_INSPIRATION_UNSUPPORTED_TRAIT_LANGUAGE,
} from './inspirationTextRules'

export const CONSULT_INSPIRATION_SCHEMA_VERSION = 1
export const CONSULT_INSPIRATION_REQUIRED_DETAIL_COUNT = 3 as const

export const CONSULT_INSPIRATION_INTRODUCTION =
  'An inspiration picture is optional. It can help you and your professional get visually on the same page.'
export const CONSULT_INSPIRATION_REFERENCE_NOTE =
  'Use it as a reference, not a guarantee or something that can be copied directly onto you.'
export const CONSULT_INSPIRATION_REFLECTION_PROMPT =
  'A complete look can include color, length, fullness, and styling. Take a moment to choose what actually stands out to you.'

function options(
  values: ReadonlyArray<readonly [string, string]>,
): ConsultInspirationQuestionDTO['options'] {
  return values.map(([value, label]) => ({ value, label }))
}

export const CONSULT_INSPIRATION_QUESTIONS: readonly ConsultInspirationQuestionDTO[] = [
  {
    key: 'favorite_colors',
    label: 'Which color or colors in this picture are your favorite?',
    helpText: null,
    kind: 'MULTI_SELECT',
    options: options([
      ['lightest-pieces', 'The lightest pieces'],
      ['darkest-pieces', 'The darkest pieces'],
      ['warm-golden', 'The warm or golden colors'],
      ['cool-smoky', 'The cool or smoky colors'],
      ['copper-red', 'The copper or red colors'],
      ['whole-color-mix', 'The whole mix of colors'],
      ['not-sure', 'Not sure'],
    ]),
    minSelections: 1,
    maxSelections: 4,
    allowText: false,
  },
  {
    key: 'avoid_colors',
    label: 'Are there any colors in it that you are unsure about or do not want?',
    helpText: null,
    kind: 'MULTI_SELECT',
    options: options([
      ['lightest-pieces', 'The lightest pieces'],
      ['darkest-pieces', 'The darkest pieces'],
      ['warm-golden', 'The warm or golden colors'],
      ['cool-smoky', 'The cool or smoky colors'],
      ['copper-red', 'The copper or red colors'],
      ['none', 'None'],
      ['not-sure', 'Not sure'],
    ]),
    minSelections: 1,
    maxSelections: 4,
    allowText: false,
  },
  {
    key: 'length_goal',
    label: 'Is the length part of the look you want?',
    helpText: null,
    kind: 'SINGLE_SELECT',
    options: options([
      ['yes-same-length', 'Yes, about this length'],
      ['longer', 'Yes, but I want it longer'],
      ['shorter', 'Yes, but I want it shorter'],
      ['not-part-of-goal', 'Not part of my goal'],
      ['not-sure', 'Not sure'],
    ]),
    minSelections: 1,
    maxSelections: 1,
    allowText: false,
  },
  {
    key: 'fullness_goal',
    label: 'Is the fullness or amount of hair part of the look you want?',
    helpText: 'Fullness means how thick or full the hair looks.',
    kind: 'SINGLE_SELECT',
    options: options([
      ['yes-same-fullness', 'Yes, about this full'],
      ['more-full', 'Yes, I want it to look fuller'],
      ['less-full', 'Yes, I want less fullness'],
      ['not-part-of-goal', 'Not part of my goal'],
      ['not-sure', 'Not sure'],
    ]),
    minSelections: 1,
    maxSelections: 1,
    allowText: false,
  },
  {
    key: 'current_styling',
    label: 'Do you already style your hair this way?',
    helpText: null,
    kind: 'SINGLE_SELECT',
    options: options([
      ['yes-often', 'Yes, often'],
      ['sometimes', 'Sometimes'],
      ['no', 'No'],
      ['not-sure', 'Not sure'],
    ]),
    minSelections: 1,
    maxSelections: 1,
    allowText: false,
  },
  {
    key: 'styling_walkthrough',
    label: 'Would you like your professional to walk you through this style?',
    helpText: null,
    kind: 'SINGLE_SELECT',
    options: options([
      ['yes', 'Yes'],
      ['no', 'No'],
      ['not-sure', 'Not sure'],
    ]),
    minSelections: 1,
    maxSelections: 1,
    allowText: false,
  },
  {
    key: 'other_detail',
    label: 'Is there anything else that catches your eye—good or bad?',
    helpText: 'Use your own words, or choose “Nothing else.”',
    kind: 'TEXT',
    options: options([['nothing-else', 'Nothing else']]),
    minSelections: 0,
    maxSelections: 1,
    allowText: true,
  },
] as const

const QUESTIONS_BY_KEY = new Map(
  CONSULT_INSPIRATION_QUESTIONS.map((question) => [question.key, question]),
)

const UNSUPPORTED_TRAIT_LANGUAGE = CONSULT_INSPIRATION_UNSUPPORTED_TRAIT_LANGUAGE

const NEUTRAL_VALUES = new Set([
  'none',
  'not-sure',
  'not-part-of-goal',
  'nothing-else',
])

export type InspirationReviewPayload = {
  contractId: 'hair-color-guided-inspiration'
  contractVersion: 1
  schemaVersion: 1
  source: ConsultInspirationSourceDTO
  inspirationId: string | null
  complete: boolean
  answers: ConsultInspirationAnswerDTO[]
  exactClientDetails: ConsultInspirationExactDetailDTO[]
  possibleProfessionalInterpretation: ConsultInspirationPossibleInterpretationDTO[]
  catalogGuidance: ConsultInspirationCatalogGuidanceDTO[]
}

export type InspirationProgress = {
  currentQuestion: ConsultInspirationQuestionDTO | null
  answeredQuestionCount: number
  specificDetailCount: number
  canComplete: boolean
  blocker:
    | 'QUESTIONS_REMAINING'
    | 'AT_LEAST_THREE_DETAILS_REQUIRED'
    | null
}

function compactText(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

function validateText(value: unknown): string | null {
  if (value == null || value === '') return null
  if (typeof value !== 'string') throw new Error('Invalid inspiration answer.')
  const text = compactText(value)
  if (
    !text ||
    text.length > CONSULT_INSPIRATION_TEXT_MAX_CHARS ||
    UNSUPPORTED_TRAIT_LANGUAGE.test(text)
  ) {
    throw new Error('Invalid inspiration answer.')
  }
  return text
}

export function isConsultInspirationQuestionKey(
  value: unknown,
): value is ConsultInspirationQuestionKeyDTO {
  return (
    typeof value === 'string' &&
    QUESTIONS_BY_KEY.has(value as ConsultInspirationQuestionKeyDTO)
  )
}

export function validateConsultInspirationAnswer(raw: {
  questionKey: unknown
  selectedValues: unknown
  text?: unknown
  sentiment?: unknown
}): ConsultInspirationAnswerDTO {
  if (!isConsultInspirationQuestionKey(raw.questionKey)) {
    throw new Error('Invalid inspiration answer.')
  }
  const question = QUESTIONS_BY_KEY.get(raw.questionKey)
  if (!question || !Array.isArray(raw.selectedValues)) {
    throw new Error('Invalid inspiration answer.')
  }
  const selectedValues = raw.selectedValues.map((value) => {
    if (typeof value !== 'string') throw new Error('Invalid inspiration answer.')
    return value.trim()
  })
  if (
    new Set(selectedValues).size !== selectedValues.length ||
    selectedValues.length < question.minSelections ||
    selectedValues.length > question.maxSelections ||
    selectedValues.some(
      (value) => !question.options.some((option) => option.value === value),
    )
  ) {
    throw new Error('Invalid inspiration answer.')
  }

  const neutralSelections = selectedValues.filter((value) =>
    NEUTRAL_VALUES.has(value),
  )
  if (neutralSelections.length > 0 && selectedValues.length > 1) {
    throw new Error('Invalid inspiration answer.')
  }

  const text = validateText(raw.text)
  const sentiment =
    raw.sentiment === 'GOOD' ||
    raw.sentiment === 'BAD' ||
    raw.sentiment === 'BOTH' ||
    raw.sentiment === 'NONE'
      ? raw.sentiment
      : raw.sentiment == null
        ? null
        : undefined
  if (sentiment === undefined) throw new Error('Invalid inspiration answer.')

  if (question.allowText) {
    const choseNothing = selectedValues[0] === 'nothing-else'
    if (choseNothing === Boolean(text)) {
      throw new Error('Invalid inspiration answer.')
    }
    if (text && (!sentiment || sentiment === 'NONE')) {
      throw new Error('Invalid inspiration answer.')
    }
    if (choseNothing && sentiment && sentiment !== 'NONE') {
      throw new Error('Invalid inspiration answer.')
    }
  } else if (text || sentiment) {
    throw new Error('Invalid inspiration answer.')
  }

  return {
    questionKey: question.key,
    selectedValues,
    text,
    sentiment: question.allowText ? (sentiment ?? 'NONE') : null,
  }
}

function optionLabel(questionKey: ConsultInspirationQuestionKeyDTO, value: string) {
  return QUESTIONS_BY_KEY.get(questionKey)?.options.find(
    (option) => option.value === value,
  )?.label
}

export function buildExactClientDetails(
  answers: readonly ConsultInspirationAnswerDTO[],
): ConsultInspirationExactDetailDTO[] {
  const details: ConsultInspirationExactDetailDTO[] = []
  for (const answer of answers) {
    for (const value of answer.selectedValues) {
      if (NEUTRAL_VALUES.has(value)) continue
      const label = optionLabel(answer.questionKey, value)
      if (!label) continue
      details.push({
        questionKey: answer.questionKey,
        value,
        clientWords: label,
        sentiment:
          answer.questionKey === 'favorite_colors'
            ? 'LIKE'
            : answer.questionKey === 'avoid_colors'
              ? 'DISLIKE'
              : answer.questionKey === 'length_goal' ||
                  answer.questionKey === 'fullness_goal'
                ? 'GOAL'
                : 'CONTEXT',
      })
    }
    if (answer.questionKey === 'other_detail' && answer.text) {
      details.push({
        questionKey: answer.questionKey,
        value: 'client-text',
        clientWords: answer.text,
        sentiment: answer.sentiment === 'BAD' ? 'DISLIKE' : 'LIKE',
      })
    }
  }
  return details
}

function countsAsSpecific(detail: ConsultInspirationExactDetailDTO): boolean {
  return detail.questionKey !== 'styling_walkthrough'
}

const POSSIBLE_MEANINGS: Readonly<Record<string, string>> = {
  'favorite_colors:lightest-pieces': 'May point to a preference for lighter pieces in the hair.',
  'favorite_colors:darkest-pieces': 'May point to a preference for deeper pieces in the hair.',
  'favorite_colors:warm-golden': 'May point to a preference for warmer or golden-looking hair color.',
  'favorite_colors:cool-smoky': 'May point to a preference for cooler or smoky-looking hair color.',
  'favorite_colors:copper-red': 'May point to a preference for copper or red-looking hair color.',
  'favorite_colors:whole-color-mix': 'May point to the overall mix of lighter and deeper hair color.',
  'avoid_colors:lightest-pieces': 'The client may want to avoid the lightest pieces.',
  'avoid_colors:darkest-pieces': 'The client may want to avoid the deepest pieces.',
  'avoid_colors:warm-golden': 'The client may want to avoid warmer or golden-looking hair color.',
  'avoid_colors:cool-smoky': 'The client may want to avoid cooler or smoky-looking hair color.',
  'avoid_colors:copper-red': 'The client may want to avoid copper or red-looking hair color.',
  'length_goal:yes-same-length': 'Length appears to be part of the client’s goal.',
  'length_goal:longer': 'The client may want more length than the reference shows.',
  'length_goal:shorter': 'The client may want less length than the reference shows.',
  'fullness_goal:yes-same-fullness': 'The amount or fullness of hair appears to be part of the goal.',
  'fullness_goal:more-full': 'The client may want the hair to look fuller.',
  'fullness_goal:less-full': 'The client may want less fullness.',
  'current_styling:yes-often': 'The client already styles their hair in a similar way often.',
  'current_styling:sometimes': 'The client sometimes styles their hair in a similar way.',
  'current_styling:no': 'The client does not currently style their hair this way.',
  'styling_walkthrough:yes': 'The client would like a styling walkthrough.',
}

export function buildPossibleProfessionalInterpretation(
  details: readonly ConsultInspirationExactDetailDTO[],
): ConsultInspirationPossibleInterpretationDTO[] {
  return details.flatMap((detail) => {
    const possibleMeaning =
      POSSIBLE_MEANINGS[`${detail.questionKey}:${detail.value}`]
    return possibleMeaning
      ? [
          {
            clientDetailValue: detail.value,
            possibleMeaning,
            confidence: 'POSSIBLE' as const,
            evidence: 'CLIENT_SELECTION' as const,
          },
        ]
      : []
  })
}

export function evaluateConsultInspirationProgress(
  answers: readonly ConsultInspirationAnswerDTO[],
): InspirationProgress {
  const byKey = new Map(answers.map((answer) => [answer.questionKey, answer]))
  const details = buildExactClientDetails(answers)
  const specificDetailCount = details.filter(countsAsSpecific).length
  const unanswered = CONSULT_INSPIRATION_QUESTIONS.find(
    (question) => !byKey.has(question.key),
  )
  if (unanswered) {
    return {
      currentQuestion: unanswered,
      answeredQuestionCount: byKey.size,
      specificDetailCount,
      canComplete: false,
      blocker: 'QUESTIONS_REMAINING',
    }
  }
  if (specificDetailCount < CONSULT_INSPIRATION_REQUIRED_DETAIL_COUNT) {
    const revisit =
      CONSULT_INSPIRATION_QUESTIONS.find((question) => {
        if (question.key === 'other_detail') return false
        const answer = byKey.get(question.key)
        return !answer || buildExactClientDetails([answer]).filter(countsAsSpecific).length === 0
      }) ?? CONSULT_INSPIRATION_QUESTIONS[0]
    return {
      currentQuestion: revisit ?? null,
      answeredQuestionCount: byKey.size,
      specificDetailCount,
      canComplete: false,
      blocker: 'AT_LEAST_THREE_DETAILS_REQUIRED',
    }
  }
  return {
    currentQuestion: null,
    answeredQuestionCount: byKey.size,
    specificDetailCount,
    canComplete: true,
    blocker: null,
  }
}

export function toInspirationJsonPayload(
  payload: InspirationReviewPayload,
): Prisma.InputJsonValue {
  return {
    ...payload,
    answers: payload.answers.map((answer) => ({ ...answer })),
    exactClientDetails: payload.exactClientDetails.map((detail) => ({ ...detail })),
    possibleProfessionalInterpretation:
      payload.possibleProfessionalInterpretation.map((item) => ({ ...item })),
    catalogGuidance: payload.catalogGuidance.map((item) => ({ ...item })),
  }
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[]) {
  const actual = Object.keys(value).sort()
  const sortedExpected = [...expected].sort()
  return (
    actual.length === sortedExpected.length &&
    actual.every((key, index) => key === sortedExpected[index])
  )
}

export function normalizeStoredInspirationPayload(
  raw: Prisma.JsonValue,
): InspirationReviewPayload | null {
  if (
    !isRecord(raw) ||
    !exactKeys(raw, [
      'contractId',
      'contractVersion',
      'schemaVersion',
      'source',
      'inspirationId',
      'complete',
      'answers',
      'exactClientDetails',
      'possibleProfessionalInterpretation',
      'catalogGuidance',
    ]) ||
    raw.contractId !== 'hair-color-guided-inspiration' ||
    raw.contractVersion !== 1 ||
    raw.schemaVersion !== CONSULT_INSPIRATION_SCHEMA_VERSION ||
    typeof raw.complete !== 'boolean' ||
    !Array.isArray(raw.answers) ||
    !Array.isArray(raw.exactClientDetails) ||
    !Array.isArray(raw.possibleProfessionalInterpretation) ||
    !Array.isArray(raw.catalogGuidance)
  ) {
    return null
  }
  const source = ['NONE', 'PLATFORM_LOOK', 'BOOKED_PRO_LOOK', 'EXTERNAL_UPLOAD'].find(
    (candidate) => candidate === raw.source,
  ) as ConsultInspirationSourceDTO | undefined
  if (!source) return null
  const inspirationId =
    raw.inspirationId === null
      ? null
      : typeof raw.inspirationId === 'string' && raw.inspirationId
        ? raw.inspirationId
        : undefined
  if (inspirationId === undefined || (source === 'NONE') !== (inspirationId === null)) {
    return null
  }

  let answers: ConsultInspirationAnswerDTO[]
  try {
    answers = raw.answers.map((answer) => {
      if (!isRecord(answer)) throw new Error('invalid')
      return validateConsultInspirationAnswer({
        questionKey: answer.questionKey,
        selectedValues: answer.selectedValues,
        text: answer.text,
        sentiment: answer.sentiment,
      })
    })
  } catch {
    return null
  }
  if (new Set(answers.map((answer) => answer.questionKey)).size !== answers.length) {
    return null
  }
  const exactClientDetails = buildExactClientDetails(answers)
  const possibleProfessionalInterpretation =
    buildPossibleProfessionalInterpretation(exactClientDetails)
  if (
    !isDeepStrictEqual(raw.exactClientDetails, exactClientDetails) ||
    !isDeepStrictEqual(
      raw.possibleProfessionalInterpretation,
      possibleProfessionalInterpretation,
    )
  ) {
    return null
  }
  const catalogGuidance: ConsultInspirationCatalogGuidanceDTO[] = raw.catalogGuidance.flatMap((item) => {
    if (
      !isRecord(item) ||
      (item.detail !== 'LENGTH' &&
        item.detail !== 'FULLNESS' &&
        item.detail !== 'STYLING') ||
      typeof item.message !== 'string' ||
      !item.message ||
      item.contextOnly !== true ||
      item.automaticallyAdded !== false
    ) {
      return []
    }
    return [
      {
        detail: item.detail as 'LENGTH' | 'FULLNESS' | 'STYLING',
        message: item.message,
        contextOnly: true as const,
        automaticallyAdded: false as const,
      },
    ] as ConsultInspirationCatalogGuidanceDTO[]
  })
  if (catalogGuidance.length !== raw.catalogGuidance.length) return null
  const progress = evaluateConsultInspirationProgress(answers)
  if (raw.complete !== (source === 'NONE' || progress.canComplete)) return null

  return {
    contractId: 'hair-color-guided-inspiration',
    contractVersion: 1,
    schemaVersion: 1,
    source,
    inspirationId,
    complete: raw.complete,
    answers,
    exactClientDetails,
    possibleProfessionalInterpretation,
    catalogGuidance,
  }
}

export function mapStoredInspirationRevision(revision: {
  id: string
  revision: number
  payload: Prisma.JsonValue
  createdAt: Date
}): ConsultInspirationReviewDTO | null {
  const payload = normalizeStoredInspirationPayload(revision.payload)
  if (!payload) return null
  return {
    revisionId: revision.id,
    revision: revision.revision,
    ...payload,
    createdAt: revision.createdAt.toISOString(),
  }
}
