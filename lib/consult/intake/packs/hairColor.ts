// lib/consult/intake/packs/hairColor.ts
//
// The hair-colour intake pack.
//
// TWO versions live here. v2 is the founder pilot's pack, frozen: its keys,
// option values and conditional rule are pinned by stored ConsultRevision
// payloads in production (19 INTAKE v2 rows on 2026-09-03) and by the
// `consult_intake_payload_guard` trigger, so it is never edited — a change is
// a new version. v3 is the P6 diet: only the questions the analysis cannot
// answer for itself.
//
// What v3 drops and why (docs/consult/tovis-ai-consult-handoff.md, Stage 1/3):
//   * `current_color` — the starting-point photos are read into
//     `core.baseLevel` / `lightestLevel` / `currentTone`.
//   * `desired_color` — the inspiration reference is read into seven hair
//     colour attributes (P4, lib/consult/inspirationVision.ts).
//   * `perm_history`, `relaxer_texturizer_history`,
//     `keratin_smoothing_history` — folded into `other_chemical_history`,
//     which already carries the identical option values and is already what
//     `hasReportedNonColorTreatment` reads. One question, same routing.
//   * `last_color_service_timing`, `event_timing`, `budget` — the pro wants
//     them; nothing before the analysis does. They move to the post-booking
//     follow-up pack (lib/consult/intake/followUp.ts).
//
// Every KEPT question keeps its v2 key and option values exactly, which is
// what lets one safety policy and one database mirror serve both versions.

import {
  BOARD_CURRENT_COLOR_OPTIONS,
  BOARD_DREAM_COLOR_OPTIONS,
} from '@/lib/boards/context'
import type {
  ConsultIntakeAnswerMapDTO,
  ConsultIntakeQuestionDTO,
} from '@/lib/dto/consult'

import {
  BUDGET_OPTIONS,
  CHANGE_SCALE_OPTIONS,
  EVENT_TIMING_OPTIONS,
  GOAL_DIRECTION_UNRESOLVED_VALUE,
  PRIOR_LIGHTENING_OPTIONS,
  PRIOR_REACTION_OPTIONS,
  SERVICE_TIMING_OPTIONS,
  TREATMENT_TIMING_OPTIONS,
} from '../sharedOptions'
import {
  dietedIntakePack,
  intakeQuestion,
  type ConsultIntakeOptionValues,
  type ConsultIntakePackDefinition,
  type ConsultIntakeValidationResult,
} from '../types'

export const HAIR_COLOR_INTAKE_PACK_ID = 'hair-color' as const
export const HAIR_COLOR_INTAKE_PACK_VERSION = 3
export const HAIR_COLOR_INTAKE_PACK_V2_VERSION = 2
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

const TREATMENT_HISTORY_HELP =
  'Treatments besides hair color can change how your hair responds and what result is safely achievable.'

/** Keys are typed so a question outside the pinned list is a type error. */
function question(
  key: HairColorIntakeQuestionKey,
  label: string,
  requirement: ConsultIntakeQuestionDTO['requirement'],
  values: ConsultIntakeOptionValues,
  helpText: string | null = null,
): ConsultIntakeQuestionDTO {
  return intakeQuestion(key, label, requirement, values, helpText)
}

/**
 * A colour goal is ambiguous when the dream is unsure, the same as today, or
 * only a subtle change — then the direction question decides what "change"
 * means to this client.
 */
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

/** v2 — FROZEN. New C2 wording pinned by this version; board wording reused. */
export const HAIR_COLOR_INTAKE_PACK_V2: ConsultIntakePackDefinition = {
  id: HAIR_COLOR_INTAKE_PACK_ID,
  categorySlug: 'hair-color',
  version: HAIR_COLOR_INTAKE_PACK_V2_VERSION,
  schemaVersion: HAIR_COLOR_INTAKE_SCHEMA_VERSION,
  goalDirection: {
    questionKey: 'goal_direction',
    unresolvedValue: GOAL_DIRECTION_UNRESOLVED_VALUE,
    requiredWhen: goalNeedsDirection,
  },
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
      CHANGE_SCALE_OPTIONS,
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
        [GOAL_DIRECTION_UNRESOLVED_VALUE, 'I am still not sure'],
      ],
      'This helps your professional understand what “subtle” or “a change” means to you. It is okay to revise your answer.',
    ),
    question(
      'box_dye_history',
      'When did you last use box dye on your hair?',
      'REQUIRED',
      TREATMENT_TIMING_OPTIONS,
      TREATMENT_HISTORY_HELP,
    ),
    question(
      'prior_lightening',
      'When was your hair last lightened?',
      'REQUIRED',
      PRIOR_LIGHTENING_OPTIONS,
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
      SERVICE_TIMING_OPTIONS,
    ),
    question(
      'prior_reaction',
      'Have you ever had a reaction during or after a hair color service?',
      'REQUIRED',
      PRIOR_REACTION_OPTIONS,
    ),
    question(
      'event_timing',
      'Do you have an event or deadline?',
      'SKIPPABLE',
      EVENT_TIMING_OPTIONS,
    ),
    question(
      'budget',
      'What budget would you like to stay within?',
      'SKIPPABLE',
      BUDGET_OPTIONS,
    ),
  ],
}

/**
 * v3 keys — the questions a photograph cannot answer. Kept in v2's order so a
 * client who has seen both packs meets them in the same sequence.
 */
export const HAIR_COLOR_INTAKE_V3_QUESTION_KEYS = [
  'change_scale',
  'goal_direction',
  'box_dye_history',
  'prior_lightening',
  'henna_plant_dye_history',
  'other_chemical_history',
  'prior_reaction',
] as const satisfies readonly HairColorIntakeQuestionKey[]

/**
 * v3 — CURRENT. With the colour pair gone, the only thing that can leave a
 * colour goal ambiguous is the client asking for a subtle change, which is the
 * same rule every other pack uses.
 */
export const HAIR_COLOR_INTAKE_PACK: ConsultIntakePackDefinition = dietedIntakePack({
  base: HAIR_COLOR_INTAKE_PACK_V2,
  version: HAIR_COLOR_INTAKE_PACK_VERSION,
  keep: HAIR_COLOR_INTAKE_V3_QUESTION_KEYS,
  reword: {
    goal_direction: {
      label: 'What would you most like to change about your color?',
    },
    // Absorbs v2's perm, relaxer/texturizer and keratin/smoothing questions.
    // Same key, same option values, same safety routing — one question.
    other_chemical_history: {
      label:
        'When did you last have a perm, relaxer, keratin or other chemical treatment?',
      helpText: TREATMENT_HISTORY_HELP,
    },
  },
  goalDirection: {
    questionKey: 'goal_direction',
    unresolvedValue: GOAL_DIRECTION_UNRESOLVED_VALUE,
    requiredWhen: (answers) => answers.change_scale === 'subtle',
  },
})

// ── C5 evaluation fixture contract (frozen v1) ─────────────────────────────

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
 * v3; C5 remains v1 until a separately approved full evaluation is versioned.
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
