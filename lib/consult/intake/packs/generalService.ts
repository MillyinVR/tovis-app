// lib/consult/intake/packs/generalService.ts
//
// The intake for every service outside the HAIR family — skin, nails, brows
// and lashes, makeup, body, and any family that does not exist yet. It is
// deliberately the questions ANY beauty professional asks before a first
// appointment: what the client wants, what has been done to the area recently,
// how the client's skin reacts, known allergies, and the closing deadline and
// budget pair. Family-specific packs can be added later without touching this
// one; a brand-new category is consultable with it on day one.
//
// `known_allergies` and `skin_sensitivity` are what let the safety policy
// route a patch test without a hair-specific chemical history.
//
// TWO versions. v1 is frozen (stored payloads and the
// `consult_intake_payload_guard` trigger name it). v2 is the P6 diet: the
// safety questions no photograph can answer — recent treatment, sensitivity,
// allergies, prior reaction — plus how big a change the client wants.
// `service_experience` moves to the post-booking follow-up phrased with the
// service's own name (handoff B6), and `last_service_timing`,
// `maintenance_tolerance`, `event_timing` and `budget` go with it
// (lib/consult/intake/followUp.ts).

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
  PRIOR_REACTION_OPTIONS,
  SERVICE_EXPERIENCE_OPTIONS,
  SERVICE_TIMING_OPTIONS,
  TREATMENT_TIMING_OPTIONS,
} from '../sharedOptions'
import {
  dietedIntakePack,
  intakeQuestion,
  type ConsultIntakeOptionValues,
  type ConsultIntakePackDefinition,
} from '../types'

export const GENERAL_SERVICE_INTAKE_PACK_ID = 'general-service' as const
export const GENERAL_SERVICE_INTAKE_PACK_VERSION = 2
export const GENERAL_SERVICE_INTAKE_PACK_V1_VERSION = 1
export const GENERAL_SERVICE_INTAKE_SCHEMA_VERSION = 2

export const GENERAL_SERVICE_INTAKE_QUESTION_KEYS = [
  'service_experience',
  'change_scale',
  'goal_direction',
  'recent_treatment_timing',
  'skin_sensitivity',
  'known_allergies',
  'prior_reaction',
  'last_service_timing',
  'maintenance_tolerance',
  'event_timing',
  'budget',
] as const

export type GeneralServiceIntakeQuestionKey =
  (typeof GENERAL_SERVICE_INTAKE_QUESTION_KEYS)[number]

function question(
  key: GeneralServiceIntakeQuestionKey,
  label: string,
  requirement: ConsultIntakeQuestionDTO['requirement'],
  values: ConsultIntakeOptionValues,
  helpText: string | null = null,
): ConsultIntakeQuestionDTO {
  return intakeQuestion(key, label, requirement, values, helpText)
}

function goalNeedsDirection(
  answers: Readonly<ConsultIntakeAnswerMapDTO>,
): boolean {
  return answers.change_scale === 'subtle'
}

/** v1 — FROZEN. */
export const GENERAL_SERVICE_INTAKE_PACK_V1: ConsultIntakePackDefinition = {
  id: GENERAL_SERVICE_INTAKE_PACK_ID,
  categorySlug: 'general',
  version: GENERAL_SERVICE_INTAKE_PACK_V1_VERSION,
  schemaVersion: GENERAL_SERVICE_INTAKE_SCHEMA_VERSION,
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
        ['shape', 'The shape'],
        ['color-tone', 'The color or tone'],
        ['fullness-definition', 'Fullness or definition'],
        ['smoothness-condition', 'Smoothness or condition'],
        ['longer-lasting', 'Make it last longer'],
        ['more-natural', 'A more natural look'],
        ['bolder', 'A bolder look'],
        [GOAL_DIRECTION_UNRESOLVED_VALUE, 'I am still not sure'],
      ],
      'This helps your professional understand what “subtle” means to you. It is okay to revise your answer.',
    ),
    question(
      'recent_treatment_timing',
      'When did you last have a treatment in this area?',
      'REQUIRED',
      TREATMENT_TIMING_OPTIONS,
      'Recent treatments can change how your skin or the area responds, and what can safely be done next.',
    ),
    question(
      'skin_sensitivity',
      'Does your skin react easily to products or treatments?',
      'REQUIRED',
      [
        ['no', 'No'],
        ['sometimes', 'Sometimes'],
        ['yes', 'Yes'],
        ['not-sure', 'Not sure'],
      ],
    ),
    question(
      'known_allergies',
      'Any known allergies to beauty products — adhesives, dyes, fragrances, latex?',
      'REQUIRED',
      [
        ['none-known', 'None that I know of'],
        ['yes', 'Yes'],
        ['not-sure', 'Not sure'],
      ],
    ),
    question(
      'prior_reaction',
      'Have you ever had a reaction during or after a beauty service?',
      'REQUIRED',
      PRIOR_REACTION_OPTIONS,
    ),
    question(
      'last_service_timing',
      'When was your last professional service like this?',
      'REQUIRED',
      SERVICE_TIMING_OPTIONS,
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

/** v2 keys — kept in v1's order. */
export const GENERAL_SERVICE_INTAKE_V2_QUESTION_KEYS = [
  'change_scale',
  'goal_direction',
  'recent_treatment_timing',
  'skin_sensitivity',
  'known_allergies',
  'prior_reaction',
] as const satisfies readonly GeneralServiceIntakeQuestionKey[]

/** v2 — CURRENT. */
export const GENERAL_SERVICE_INTAKE_PACK: ConsultIntakePackDefinition =
  dietedIntakePack({
    base: GENERAL_SERVICE_INTAKE_PACK_V1,
    version: GENERAL_SERVICE_INTAKE_PACK_VERSION,
    keep: GENERAL_SERVICE_INTAKE_V2_QUESTION_KEYS,
    goalDirection: {
      questionKey: 'goal_direction',
      unresolvedValue: GOAL_DIRECTION_UNRESOLVED_VALUE,
      requiredWhen: goalNeedsDirection,
    },
  })
