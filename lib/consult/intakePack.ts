// Deterministic hair-color intake pack for the booking-attached founder pilot.
// Copy, option values, required/skippable semantics, and validation live here
// together so stored revisions can always be interpreted against an exact
// pack/schema version. Legal agreement wording does not belong in this module.

import {
  BOARD_CHANGE_SCALE_OPTIONS,
  BOARD_CURRENT_COLOR_OPTIONS,
  BOARD_DREAM_COLOR_OPTIONS,
} from '@/lib/boards/context'
import type {
  ConsultIntakeAnswerMapDTO,
  ConsultIntakeQuestionDTO,
  ConsultIntakeQuestionPackDTO,
} from '@/lib/dto/consult'

export const HAIR_COLOR_INTAKE_PACK_ID = 'hair-color' as const
export const HAIR_COLOR_INTAKE_PACK_VERSION = 1
export const HAIR_COLOR_INTAKE_SCHEMA_VERSION = 1

export const HAIR_COLOR_INTAKE_QUESTION_KEYS = [
  'current_color',
  'desired_color',
  'change_scale',
  'box_dye_history',
  'prior_lightening',
  'last_color_service_timing',
  'prior_reaction',
  'event_timing',
  'budget',
] as const

export type HairColorIntakeQuestionKey =
  (typeof HAIR_COLOR_INTAKE_QUESTION_KEYS)[number]

function options(
  values: ReadonlyArray<readonly [string, string]>,
): ConsultIntakeQuestionDTO['options'] {
  return values.map(([value, label]) => ({ value, label }))
}

function question(
  key: HairColorIntakeQuestionKey,
  label: string,
  requirement: ConsultIntakeQuestionDTO['requirement'],
  values: ReadonlyArray<readonly [string, string]>,
): ConsultIntakeQuestionDTO {
  return {
    key,
    label,
    kind: 'SINGLE_SELECT',
    requirement,
    options: options(values),
  }
}

/** New C2 wording is pinned by this pack version; board wording is reused. */
export const HAIR_COLOR_INTAKE_PACK: ConsultIntakeQuestionPackDTO = {
  id: HAIR_COLOR_INTAKE_PACK_ID,
  categorySlug: 'hair-color',
  version: HAIR_COLOR_INTAKE_PACK_VERSION,
  schemaVersion: HAIR_COLOR_INTAKE_SCHEMA_VERSION,
  questions: [
    question(
      'current_color',
      'Your current color?',
      'REQUIRED',
      BOARD_CURRENT_COLOR_OPTIONS,
    ),
    question(
      'desired_color',
      'Your dream color?',
      'REQUIRED',
      BOARD_DREAM_COLOR_OPTIONS,
    ),
    question(
      'change_scale',
      'How big a change are you after?',
      'REQUIRED',
      BOARD_CHANGE_SCALE_OPTIONS,
    ),
    question(
      'box_dye_history',
      'When did you last use box dye on your hair?',
      'REQUIRED',
      [
        ['never', 'Never'],
        ['within-6-months', 'Within 6 months'],
        ['6-12-months', '6–12 months ago'],
        ['over-12-months', 'More than a year ago'],
        ['not-sure', 'Not sure'],
      ],
    ),
    question(
      'prior_lightening',
      'When was your hair last lightened?',
      'REQUIRED',
      [
        ['never', 'Never'],
        ['within-3-months', 'Within 3 months'],
        ['3-6-months', '3–6 months ago'],
        ['6-12-months', '6–12 months ago'],
        ['over-12-months', 'More than a year ago'],
        ['not-sure', 'Not sure'],
      ],
    ),
    question(
      'last_color_service_timing',
      'When was your last color service?',
      'REQUIRED',
      [
        ['never', 'Never'],
        ['within-4-weeks', 'Within 4 weeks'],
        ['1-3-months', '1–3 months ago'],
        ['4-6-months', '4–6 months ago'],
        ['7-12-months', '7–12 months ago'],
        ['over-12-months', 'More than a year ago'],
        ['not-sure', 'Not sure'],
      ],
    ),
    question(
      'prior_reaction',
      'Have you ever had a reaction during or after a hair color service?',
      'REQUIRED',
      [
        ['no', 'No'],
        ['yes', 'Yes'],
        ['not-sure', 'Not sure'],
      ],
    ),
    question(
      'event_timing',
      'Do you have an event or deadline?',
      'SKIPPABLE',
      [
        ['no-deadline', 'No deadline'],
        ['within-2-weeks', 'Within 2 weeks'],
        ['2-4-weeks', '2–4 weeks'],
        ['1-3-months', '1–3 months'],
        ['over-3-months', 'More than 3 months'],
      ],
    ),
    question(
      'budget',
      'What budget would you like to stay within?',
      'SKIPPABLE',
      [
        ['under-150', 'Under $150'],
        ['150-250', '$150–$250'],
        ['251-400', '$251–$400'],
        ['over-400', 'Over $400'],
        ['discuss-with-pro', 'Discuss with my pro'],
      ],
    ),
  ],
}

const QUESTIONS_BY_KEY = new Map(
  HAIR_COLOR_INTAKE_PACK.questions.map((definition) => [
    definition.key,
    definition,
  ]),
)

export type ConsultIntakeValidationErrorCode =
  | 'INVALID_ANSWERS'
  | 'REQUIRED_ANSWERS_MISSING'

export type ConsultIntakeValidationResult =
  | { ok: true; answers: ConsultIntakeAnswerMapDTO }
  | {
      ok: false
      code: ConsultIntakeValidationErrorCode
      message: string
    }

/** Strict write validation: unknown keys and invalid option values fail. */
export function validateHairColorIntakeAnswers(
  raw: unknown,
  complete: boolean,
): ConsultIntakeValidationResult {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, code: 'INVALID_ANSWERS', message: 'Invalid answers.' }
  }

  const record: Record<string, unknown> = { ...raw }
  const answers: ConsultIntakeAnswerMapDTO = {}
  for (const [key, value] of Object.entries(record)) {
    const definition = QUESTIONS_BY_KEY.get(key)
    if (!definition || typeof value !== 'string') {
      return { ok: false, code: 'INVALID_ANSWERS', message: 'Invalid answers.' }
    }
    const trimmed = value.trim()
    if (!definition.options.some((option) => option.value === trimmed)) {
      return { ok: false, code: 'INVALID_ANSWERS', message: 'Invalid answers.' }
    }
    answers[key] = trimmed
  }

  if (Object.keys(answers).length === 0) {
    return { ok: false, code: 'INVALID_ANSWERS', message: 'Invalid answers.' }
  }

  if (
    complete &&
    HAIR_COLOR_INTAKE_PACK.questions.some(
      (definition) =>
        definition.requirement === 'REQUIRED' && !answers[definition.key],
    )
  ) {
    return {
      ok: false,
      code: 'REQUIRED_ANSWERS_MISSING',
      message: 'Required answers are missing.',
    }
  }

  return { ok: true, answers }
}

/** Read normalization rejects stale or malformed persisted payloads. */
export function normalizeHairColorIntakePayload(
  raw: unknown,
): {
  packId: typeof HAIR_COLOR_INTAKE_PACK_ID
  packVersion: number
  schemaVersion: number
  complete: boolean
  answers: ConsultIntakeAnswerMapDTO
} | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const record: Record<string, unknown> = { ...raw }
  const payloadKeys = new Set([
    'packId',
    'packVersion',
    'schemaVersion',
    'complete',
    'answers',
  ])
  if (
    Object.keys(record).some((key) => !payloadKeys.has(key)) ||
    record.packId !== HAIR_COLOR_INTAKE_PACK_ID ||
    record.packVersion !== HAIR_COLOR_INTAKE_PACK_VERSION ||
    record.schemaVersion !== HAIR_COLOR_INTAKE_SCHEMA_VERSION ||
    typeof record.complete !== 'boolean'
  ) {
    return null
  }
  const validated = validateHairColorIntakeAnswers(
    record.answers,
    record.complete,
  )
  if (!validated.ok) return null
  return {
    packId: HAIR_COLOR_INTAKE_PACK_ID,
    packVersion: HAIR_COLOR_INTAKE_PACK_VERSION,
    schemaVersion: HAIR_COLOR_INTAKE_SCHEMA_VERSION,
    complete: record.complete,
    answers: validated.answers,
  }
}
