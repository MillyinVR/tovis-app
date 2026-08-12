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
export const HAIR_COLOR_INTAKE_PACK_VERSION = 2
export const HAIR_COLOR_INTAKE_SCHEMA_VERSION = 2

export const HAIR_COLOR_INTAKE_QUESTION_KEYS = [
  'current_color',
  'desired_color',
  'change_scale',
  'goal_direction',
  'box_dye_history',
  'prior_lightening',
  'henna_plant_dye_history',
  'perm_history',
  'relaxer_texturizer_history',
  'keratin_smoothing_history',
  'other_chemical_history',
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
  helpText: string | null = null,
): ConsultIntakeQuestionDTO {
  return {
    key,
    label,
    helpText,
    kind: 'SINGLE_SELECT',
    requirement,
    options: options(values),
  }
}

const TREATMENT_TIMING_OPTIONS = [
  ['never', 'Never'],
  ['within-6-months', 'Within 6 months'],
  ['6-12-months', '6–12 months ago'],
  ['over-12-months', 'More than a year ago'],
  ['not-sure', 'Not sure'],
] as const

const TREATMENT_HISTORY_HELP =
  'Treatments besides hair color can change how your hair responds and what result is safely achievable.'

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
      'goal_direction',
      'What part of your color would you most like to change?',
      'CONDITIONAL',
      [
        ['lighter', 'Go lighter'],
        ['darker', 'Go darker'],
        ['warmer', 'Make the tone warmer'],
        ['less-warm', 'Make the tone less warm'],
        ['brighter-pieces', 'Add brighter pieces'],
        ['softer-root-contrast', 'Make the roots blend more softly'],
        ['gray-blending', 'Blend gray or silver'],
        ['richer-color', 'Make the color look richer'],
        ['more-shine', 'Add shine or refresh the tone'],
        ['not-sure', 'I am still not sure'],
      ],
      'This helps your professional understand what “subtle” or “a change” means to you. It is okay to revise your answer.',
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
      TREATMENT_HISTORY_HELP,
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
      TREATMENT_HISTORY_HELP,
    ),
    question(
      'henna_plant_dye_history',
      'When did you last use henna or another plant-based hair dye?',
      'REQUIRED',
      TREATMENT_TIMING_OPTIONS,
      TREATMENT_HISTORY_HELP,
    ),
    question(
      'perm_history',
      'When did you last have a perm?',
      'REQUIRED',
      TREATMENT_TIMING_OPTIONS,
      TREATMENT_HISTORY_HELP,
    ),
    question(
      'relaxer_texturizer_history',
      'When did you last have a relaxer or texturizer?',
      'REQUIRED',
      TREATMENT_TIMING_OPTIONS,
      TREATMENT_HISTORY_HELP,
    ),
    question(
      'keratin_smoothing_history',
      'When did you last have a keratin or smoothing treatment?',
      'REQUIRED',
      TREATMENT_TIMING_OPTIONS,
      TREATMENT_HISTORY_HELP,
    ),
    question(
      'other_chemical_history',
      'When did you last have another chemical service or treatment?',
      'REQUIRED',
      TREATMENT_TIMING_OPTIONS,
      TREATMENT_HISTORY_HELP,
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
  | 'GOAL_DIRECTION_REQUIRED'
  | 'GOAL_DIRECTION_UNRESOLVED'

export type ConsultIntakeValidationResult =
  | { ok: true; answers: ConsultIntakeAnswerMapDTO }
  | {
      ok: false
      code: ConsultIntakeValidationErrorCode
      message: string
    }

const C5_EVALUATION_INTAKE_OPTIONS = {
  current_color: ['blonde', 'brunette', 'black', 'red', 'gray', 'other'],
  desired_color: ['blonde', 'brunette', 'black', 'red', 'fantasy', 'not-sure'],
  change_scale: ['subtle', 'noticeable', 'total'],
  box_dye_history: [
    'never',
    'within-6-months',
    '6-12-months',
    'over-12-months',
    'not-sure',
  ],
  prior_lightening: [
    'never',
    'within-3-months',
    '3-6-months',
    '6-12-months',
    'over-12-months',
    'not-sure',
  ],
  last_color_service_timing: [
    'never',
    'within-4-weeks',
    '1-3-months',
    '4-6-months',
    '7-12-months',
    'over-12-months',
    'not-sure',
  ],
  prior_reaction: ['no', 'yes', 'not-sure'],
  event_timing: [
    'no-deadline',
    'within-2-weeks',
    '2-4-weeks',
    '1-3-months',
    'over-3-months',
  ],
  budget: [
    'under-150',
    '150-250',
    '251-400',
    'over-400',
    'discuss-with-pro',
  ],
} as const

const C5_EVALUATION_REQUIRED_INTAKE_KEYS = [
  'current_color',
  'desired_color',
  'change_scale',
  'box_dye_history',
  'prior_lightening',
  'last_color_service_timing',
  'prior_reaction',
] as const

/**
 * Preserves the immutable C5 fixture-input contract. Current product intake is
 * v2; C5 remains v1 until a separately approved full evaluation is versioned.
 */
export function validateHairColorC5EvaluationIntakeAnswers(
  raw: unknown,
): ConsultIntakeValidationResult {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, code: 'INVALID_ANSWERS', message: 'Invalid answers.' }
  }
  const answers: ConsultIntakeAnswerMapDTO = {}
  for (const [key, value] of Object.entries(raw)) {
    const allowed = C5_EVALUATION_INTAKE_OPTIONS[
      key as keyof typeof C5_EVALUATION_INTAKE_OPTIONS
    ] as readonly string[] | undefined
    if (typeof value !== 'string' || !allowed?.includes(value)) {
      return { ok: false, code: 'INVALID_ANSWERS', message: 'Invalid answers.' }
    }
    answers[key] = value
  }
  if (
    Object.keys(answers).length === 0 ||
    C5_EVALUATION_REQUIRED_INTAKE_KEYS.some((key) => !answers[key])
  ) {
    return {
      ok: false,
      code: 'REQUIRED_ANSWERS_MISSING',
      message: 'Required answers are missing.',
    }
  }
  return { ok: true, answers }
}

export type HairColorIntakeProgress = {
  canComplete: boolean
  nextQuestionKey: HairColorIntakeQuestionKey | null
  blocker:
    | 'REQUIRED_ANSWERS_MISSING'
    | 'GOAL_DIRECTION_REQUIRED'
    | 'GOAL_DIRECTION_UNRESOLVED'
    | null
}

function goalNeedsDirection(
  answers: Readonly<ConsultIntakeAnswerMapDTO>,
): boolean {
  const current = answers.current_color
  const desired = answers.desired_color
  const scale = answers.change_scale
  return (
    desired === 'not-sure' ||
    (Boolean(current) && current === desired) ||
    scale === 'subtle'
  )
}

/** Server-owned sequence/progress contract for one-question-at-a-time clients. */
export function evaluateHairColorIntakeProgress(
  answers: Readonly<ConsultIntakeAnswerMapDTO>,
): HairColorIntakeProgress {
  for (const definition of HAIR_COLOR_INTAKE_PACK.questions) {
    if (
      definition.requirement === 'REQUIRED' &&
      !answers[definition.key]
    ) {
      return {
        canComplete: false,
        nextQuestionKey: definition.key as HairColorIntakeQuestionKey,
        blocker: 'REQUIRED_ANSWERS_MISSING',
      }
    }
    if (
      definition.key === 'goal_direction'
    ) {
      if (answers.goal_direction === 'not-sure') {
        return {
          canComplete: false,
          nextQuestionKey: 'goal_direction',
          blocker: 'GOAL_DIRECTION_UNRESOLVED',
        }
      }
      if (goalNeedsDirection(answers) && !answers.goal_direction) {
        return {
          canComplete: false,
          nextQuestionKey: 'goal_direction',
          blocker: 'GOAL_DIRECTION_REQUIRED',
        }
      }
    }
  }
  return { canComplete: true, nextQuestionKey: null, blocker: null }
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

  if (complete) {
    const progress = evaluateHairColorIntakeProgress(answers)
    if (!progress.canComplete && progress.blocker) {
      return {
        ok: false,
        code: progress.blocker,
        message:
          progress.blocker === 'GOAL_DIRECTION_UNRESOLVED'
            ? 'A color goal direction is still unresolved.'
            : 'Required answers are missing.',
      }
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
