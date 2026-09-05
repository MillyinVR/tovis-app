// lib/consult/inspiration/packs/generalService.ts
//
// The guided-inspiration pack for every family outside HAIR — skin, nails,
// brows and lashes, makeup, body, and a family nobody has modelled yet. It
// asks the questions ANY professional would ask about a picture a client
// brings: what she likes in it, what she does not want from it, how strong a
// version of it she is after, and whether she already does it herself.
//
// It exists so that a brand-new category is consultable the day it is created:
// the family registry falls through to this pack rather than to nothing, which
// is what a hair-only question list used to mean for every other service.

import {
  CURRENT_UPKEEP_OPTIONS,
  INTENSITY_GOAL_OPTIONS,
  WALKTHROUGH_OPTIONS,
} from '../sharedOptions'
import { inspirationQuestion, type ConsultInspirationPackDefinition } from '../types'

export const GENERAL_SERVICE_INSPIRATION_PACK_ID = 'general-service-inspiration' as const

/**
 * Deliberately service-neutral: "the shape" is a nail, a brow and a lash line;
 * "the finish" is a polish, a gloss and a makeup finish.
 *
 * ⚠️ As in every pack, no value may contain `face`, `eyes`, `skin`,
 * `undertone`, `race` or `health` as a whole word — the database guard's
 * content regex refuses them, and a hyphen counts as a word boundary. That is
 * why the makeup-shaped option is `the-overall-look` rather than a value
 * naming the part of the body it is on.
 */
const DETAIL_VALUES = [
  ['the-color', 'The color'],
  ['the-shape', 'The shape'],
  ['the-length', 'The length'],
  ['the-finish', 'The finish'],
  ['the-overall-look', 'The overall look'],
] as const

export const GENERAL_SERVICE_INSPIRATION_PACK: ConsultInspirationPackDefinition = {
  id: GENERAL_SERVICE_INSPIRATION_PACK_ID,
  categorySlug: null,
  version: 1,
  schemaVersion: 2,
  reflectionPromptKey: 'reflectionPrompt',
  questions: [
    inspirationQuestion({
      key: 'favorite_details',
      label: 'What do you like most about this picture?',
      kind: 'MULTI_SELECT',
      options: [...DETAIL_VALUES, ['not-sure', 'Not sure']],
      minSelections: 1,
      maxSelections: 4,
      detailSentiment: 'LIKE',
    }),
    inspirationQuestion({
      key: 'avoid_details',
      label: 'Is there anything in it you would not want?',
      kind: 'MULTI_SELECT',
      options: [...DETAIL_VALUES, ['none', 'None'], ['not-sure', 'Not sure']],
      minSelections: 1,
      maxSelections: 4,
      detailSentiment: 'DISLIKE',
    }),
    inspirationQuestion({
      key: 'intensity_goal',
      label: 'How close to this picture would you like to land?',
      kind: 'SINGLE_SELECT',
      options: INTENSITY_GOAL_OPTIONS,
      minSelections: 1,
      maxSelections: 1,
      detailSentiment: 'GOAL',
    }),
    inspirationQuestion({
      key: 'current_upkeep',
      label: 'Do you already do this yourself?',
      kind: 'SINGLE_SELECT',
      options: CURRENT_UPKEEP_OPTIONS,
      minSelections: 1,
      maxSelections: 1,
      detailSentiment: 'CONTEXT',
      catalogDetail: 'STYLING',
    }),
    inspirationQuestion({
      key: 'upkeep_walkthrough',
      label: 'Would you like your professional to walk you through keeping it up?',
      kind: 'SINGLE_SELECT',
      options: WALKTHROUGH_OPTIONS,
      minSelections: 1,
      maxSelections: 1,
      detailSentiment: 'CONTEXT',
      // A walkthrough preference is not something she pointed at in the picture.
      countsAsDetail: false,
      catalogDetail: 'STYLING',
    }),
  ],
  possibleMeanings: {
    'favorite_details:the-color': 'May point to the color in the reference.',
    'favorite_details:the-shape': 'May point to the shape in the reference.',
    'favorite_details:the-length': 'May point to the length in the reference.',
    'favorite_details:the-finish': 'May point to the finish in the reference.',
    'favorite_details:the-overall-look': 'May point to the overall look rather than one part of it.',
    'avoid_details:the-color': 'The client may want to avoid this color.',
    'avoid_details:the-shape': 'The client may want to avoid this shape.',
    'avoid_details:the-length': 'The client may want to avoid this length.',
    'avoid_details:the-finish': 'The client may want to avoid this finish.',
    'avoid_details:the-overall-look': 'The client may want to avoid the overall look.',
    'intensity_goal:about-the-same': 'The client appears to want about what the reference shows.',
    'intensity_goal:more-subtle': 'The client may want a softer version of the reference.',
    'intensity_goal:more-dramatic': 'The client may want a stronger version of the reference.',
    'current_upkeep:yes-often': 'The client already does something similar often.',
    'current_upkeep:sometimes': 'The client sometimes does something similar.',
    'current_upkeep:no': 'The client does not currently do this.',
    'upkeep_walkthrough:yes': 'The client would like to be walked through the upkeep.',
  },
}
