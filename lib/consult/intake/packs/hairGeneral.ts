// lib/consult/intake/packs/hairGeneral.ts
//
// The intake for every HAIR-family service that is not a colour service —
// extensions, cuts and barbering today, anything hair tomorrow. It asks what a
// stylist needs before touching hair that may have chemical history (the
// safety policy reads `chemical_history`, `prior_lightening` and
// `prior_reaction`), what the client has in mind, and the same closing
// deadline/budget pair every pack ends with.
//
// Option VALUES are shared with the colour pack wherever a downstream reader
// keys on them (lib/consult/intake/sharedOptions.ts); keys are the pack's own.

import type {
  ConsultIntakeAnswerMapDTO,
  ConsultIntakeQuestionDTO,
} from '@/lib/dto/consult'

import {
  BUDGET_OPTIONS,
  CHANGE_SCALE_OPTIONS,
  EVENT_TIMING_OPTIONS,
  GOAL_DIRECTION_UNRESOLVED_VALUE,
  MAINTENANCE_TOLERANCE_OPTIONS,
  PRIOR_LIGHTENING_OPTIONS,
  PRIOR_REACTION_OPTIONS,
  SERVICE_EXPERIENCE_OPTIONS,
  SERVICE_TIMING_OPTIONS,
  TREATMENT_TIMING_OPTIONS,
} from '../sharedOptions'
import {
  intakeQuestion,
  type ConsultIntakeOptionValues,
  type ConsultIntakePackDefinition,
} from '../types'

export const HAIR_GENERAL_INTAKE_PACK_ID = 'hair-general' as const
export const HAIR_GENERAL_INTAKE_PACK_VERSION = 1
export const HAIR_GENERAL_INTAKE_SCHEMA_VERSION = 2

export const HAIR_GENERAL_INTAKE_QUESTION_KEYS = [
  'service_experience',
  'change_scale',
  'goal_direction',
  'current_length',
  'hair_texture',
  'chemical_history',
  'prior_lightening',
  'last_service_timing',
  'prior_reaction',
  'maintenance_tolerance',
  'event_timing',
  'budget',
] as const

export type HairGeneralIntakeQuestionKey =
  (typeof HAIR_GENERAL_INTAKE_QUESTION_KEYS)[number]

const CHEMICAL_HISTORY_HELP =
  'Color, lightening, relaxers, keratin and perms all change how hair behaves — and what can safely be done to it next.'

function question(
  key: HairGeneralIntakeQuestionKey,
  label: string,
  requirement: ConsultIntakeQuestionDTO['requirement'],
  values: ConsultIntakeOptionValues,
  helpText: string | null = null,
): ConsultIntakeQuestionDTO {
  return intakeQuestion(key, label, requirement, values, helpText)
}

/** A subtle change needs the client to say WHAT should change. */
function goalNeedsDirection(
  answers: Readonly<ConsultIntakeAnswerMapDTO>,
): boolean {
  return answers.change_scale === 'subtle'
}

export const HAIR_GENERAL_INTAKE_PACK: ConsultIntakePackDefinition = {
  id: HAIR_GENERAL_INTAKE_PACK_ID,
  categorySlug: 'hair',
  version: HAIR_GENERAL_INTAKE_PACK_VERSION,
  schemaVersion: HAIR_GENERAL_INTAKE_SCHEMA_VERSION,
  goalDirection: {
    questionKey: 'goal_direction',
    unresolvedValue: GOAL_DIRECTION_UNRESOLVED_VALUE,
    requiredWhen: goalNeedsDirection,
  },
  questions: [
    question(
      'service_experience',
      'Have you had this kind of service before?',
      'REQUIRED',
      SERVICE_EXPERIENCE_OPTIONS,
    ),
    question(
      'change_scale',
      'How big a change are you after?',
      'REQUIRED',
      CHANGE_SCALE_OPTIONS,
    ),
    question(
      'goal_direction',
      'What would you most like to change?',
      'CONDITIONAL',
      [
        ['length', 'The length'],
        ['volume-fullness', 'Volume or fullness'],
        ['shape-style', 'The shape or style'],
        ['texture-movement', 'Texture or movement'],
        ['health-condition', 'How healthy it looks and feels'],
        ['easier-upkeep', 'Make it easier to look after'],
        [GOAL_DIRECTION_UNRESOLVED_VALUE, 'I am still not sure'],
      ],
      'This helps your professional understand what “subtle” means to you. It is okay to revise your answer.',
    ),
    question(
      'current_length',
      'How long is your hair right now?',
      'REQUIRED',
      [
        ['very-short', 'Very short'],
        ['above-shoulder', 'Above the shoulder'],
        ['shoulder', 'Around the shoulder'],
        ['mid-back', 'Mid-back'],
        ['waist-or-longer', 'Waist length or longer'],
      ],
    ),
    question(
      'hair_texture',
      'How would you describe your natural texture?',
      'REQUIRED',
      [
        ['straight', 'Straight'],
        ['wavy', 'Wavy'],
        ['curly', 'Curly'],
        ['coily', 'Coily'],
        ['not-sure', 'Not sure'],
      ],
    ),
    question(
      'chemical_history',
      'When did you last have a chemical service on your hair?',
      'REQUIRED',
      TREATMENT_TIMING_OPTIONS,
      CHEMICAL_HISTORY_HELP,
    ),
    question(
      'prior_lightening',
      'When was your hair last lightened?',
      'REQUIRED',
      PRIOR_LIGHTENING_OPTIONS,
      CHEMICAL_HISTORY_HELP,
    ),
    question(
      'last_service_timing',
      'When was your last professional hair service?',
      'REQUIRED',
      SERVICE_TIMING_OPTIONS,
    ),
    question(
      'prior_reaction',
      'Have you ever had a reaction during or after a hair service?',
      'REQUIRED',
      PRIOR_REACTION_OPTIONS,
    ),
    question(
      'maintenance_tolerance',
      'How much upkeep are you happy with?',
      'SKIPPABLE',
      MAINTENANCE_TOLERANCE_OPTIONS,
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
