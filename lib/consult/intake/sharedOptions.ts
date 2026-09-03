// lib/consult/intake/sharedOptions.ts
//
// Option vocabularies more than one intake pack shares. A shared value list is
// what lets one downstream reader (the booking-history prefill, the safety
// policy, the brief) treat "when was your last service?" the same way whatever
// pack asked it — the KEY may differ per pack, the values do not.

import type { ConsultIntakeOptionValues } from './types'

/** "When did you last …" for a treatment or chemical service. */
export const TREATMENT_TIMING_OPTIONS: ConsultIntakeOptionValues = [
  ['never', 'Never'],
  ['within-6-months', 'Within 6 months'],
  ['6-12-months', '6–12 months ago'],
  ['over-12-months', 'More than a year ago'],
  ['not-sure', 'Not sure'],
]

/**
 * "When was your last professional service?" — the values the booking-history
 * prefill (lib/consult/intakeContract.ts `bookingTimingValue`) produces, so any
 * pack that asks this question with these values gets that suggestion.
 */
export const SERVICE_TIMING_OPTIONS: ConsultIntakeOptionValues = [
  ['never', 'Never'],
  ['within-4-weeks', 'Within 4 weeks'],
  ['1-3-months', '1–3 months ago'],
  ['4-6-months', '4–6 months ago'],
  ['7-12-months', '7–12 months ago'],
  ['over-12-months', 'More than a year ago'],
  ['not-sure', 'Not sure'],
]

/**
 * The keys a pack may use for that question, in preference order. The prefill
 * suggests the booking-history value on the FIRST of these the pack asks.
 */
export const SERVICE_TIMING_QUESTION_KEYS = [
  'last_color_service_timing',
  'last_service_timing',
] as const

export const PRIOR_LIGHTENING_OPTIONS: ConsultIntakeOptionValues = [
  ['never', 'Never'],
  ['within-3-months', 'Within 3 months'],
  ['3-6-months', '3–6 months ago'],
  ['6-12-months', '6–12 months ago'],
  ['over-12-months', 'More than a year ago'],
  ['not-sure', 'Not sure'],
]

export const PRIOR_REACTION_OPTIONS: ConsultIntakeOptionValues = [
  ['no', 'No'],
  ['yes', 'Yes'],
  ['not-sure', 'Not sure'],
]

export const EVENT_TIMING_OPTIONS: ConsultIntakeOptionValues = [
  ['no-deadline', 'No deadline'],
  ['within-2-weeks', 'Within 2 weeks'],
  ['2-4-weeks', '2–4 weeks'],
  ['1-3-months', '1–3 months'],
  ['over-3-months', 'More than 3 months'],
]

export const BUDGET_OPTIONS: ConsultIntakeOptionValues = [
  ['under-150', 'Under $150'],
  ['150-250', '$150–$250'],
  ['251-400', '$251–$400'],
  ['over-400', 'Over $400'],
  ['discuss-with-pro', 'Discuss with my pro'],
]

/**
 * "How big a change are you after?" reuses the approved board copy verbatim
 * (lib/boards/context.ts) — one vocabulary, whichever surface asks.
 */
export { BOARD_CHANGE_SCALE_OPTIONS as CHANGE_SCALE_OPTIONS } from '@/lib/boards/context'

export const SERVICE_EXPERIENCE_OPTIONS: ConsultIntakeOptionValues = [
  ['first-time', 'This is my first time'],
  ['had-before', 'I have had it before'],
  ['regular', 'I get it regularly'],
]

export const MAINTENANCE_TOLERANCE_OPTIONS: ConsultIntakeOptionValues = [
  ['low', 'As little as possible'],
  ['medium', 'Some upkeep is fine'],
  ['high', 'I do not mind regular upkeep'],
]

/** The pack-level "still not sure" answer to a goal-direction question. */
export const GOAL_DIRECTION_UNRESOLVED_VALUE = 'not-sure'
