// lib/consult/inspiration/sharedOptions.ts
//
// Option lists more than one inspiration pack asks with. Shared so the VALUES
// are byte-identical across packs: a value is what the payload stores and what
// the pro brief and the analysis prompt read, so two packs asking "is the
// length part of what you want?" must not answer it in two vocabularies.
//
// Labels travel with the values here because a label is what makes a value
// mean anything; a pack that needs different wording re-declares the question
// rather than re-pointing one option's label.

import type { ConsultInspirationOptionValues } from './types'

/** "Is this part of the look you want?" — the shared goal shape. */
export const GOAL_MATCH_OPTIONS: ConsultInspirationOptionValues = [
  ['yes-same-length', 'Yes, about this length'],
  ['longer', 'Yes, but I want it longer'],
  ['shorter', 'Yes, but I want it shorter'],
  ['not-part-of-goal', 'Not part of my goal'],
  ['not-sure', 'Not sure'],
]

export const FULLNESS_GOAL_OPTIONS: ConsultInspirationOptionValues = [
  ['yes-same-fullness', 'Yes, about this full'],
  ['more-full', 'Yes, I want it to look fuller'],
  ['less-full', 'Yes, I want less fullness'],
  ['not-part-of-goal', 'Not part of my goal'],
  ['not-sure', 'Not sure'],
]

/** "Do you already do this yourself?" */
export const CURRENT_UPKEEP_OPTIONS: ConsultInspirationOptionValues = [
  ['yes-often', 'Yes, often'],
  ['sometimes', 'Sometimes'],
  ['no', 'No'],
  ['not-sure', 'Not sure'],
]

/** "Would you like to be walked through it?" */
export const WALKTHROUGH_OPTIONS: ConsultInspirationOptionValues = [
  ['yes', 'Yes'],
  ['no', 'No'],
  ['not-sure', 'Not sure'],
]

/** How far from the reference she wants to land. */
export const INTENSITY_GOAL_OPTIONS: ConsultInspirationOptionValues = [
  ['about-the-same', 'About this much'],
  ['more-subtle', 'A softer version of it'],
  ['more-dramatic', 'A stronger version of it'],
  ['not-part-of-goal', 'Not part of my goal'],
  ['not-sure', 'Not sure'],
]
