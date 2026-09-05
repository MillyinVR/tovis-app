// lib/consult/inspiration/packs/hairColor.ts
//
// The guided-inspiration pack for the hair-COLOUR category — contract v2 of
// the questions that shipped hard-coded in lib/consult/inspirationPack.ts.
//
// 🔴 Every question KEY and every option VALUE here is byte-identical to the
// v1 question it comes from, and that is deliberate. They are what a stored
// payload holds, what the pro brief renders, and what the analysis prompt
// reads; re-spelling one would make a consult that started before this pack
// and one that started after it two different vocabularies for the same tap.
//
// Two v1 things do NOT survive:
//   * `other_detail`, the free-text question. v2 stores keys and enums only,
//     so there is nowhere to put her sentence. Consults that already recorded
//     one keep it — v1 payloads are still read, and still carry their text.
//   * the three-detail completion gate. It could not be satisfied by a client
//     who genuinely did not mind: every "not sure" answer left her at a
//     question she had already answered, with the same button. Completion is
//     now "she answered the pack", which is a thing she can always do.

import {
  CURRENT_UPKEEP_OPTIONS,
  FULLNESS_GOAL_OPTIONS,
  GOAL_MATCH_OPTIONS,
  WALKTHROUGH_OPTIONS,
} from '../sharedOptions'
import { inspirationQuestion, type ConsultInspirationPackDefinition } from '../types'

export const HAIR_COLOR_INSPIRATION_PACK_ID = 'hair-color-inspiration' as const
export const HAIR_COLOR_INSPIRATION_CATEGORY_SLUG = 'hair-color' as const

/** The colours a colour reference is described by, liked or avoided. */
const COLOR_VALUES = [
  ['lightest-pieces', 'The lightest pieces'],
  ['darkest-pieces', 'The darkest pieces'],
  ['warm-golden', 'The warm or golden colors'],
  ['cool-smoky', 'The cool or smoky colors'],
  ['copper-red', 'The copper or red colors'],
] as const

export const HAIR_COLOR_INSPIRATION_PACK: ConsultInspirationPackDefinition = {
  id: HAIR_COLOR_INSPIRATION_PACK_ID,
  categorySlug: HAIR_COLOR_INSPIRATION_CATEGORY_SLUG,
  version: 1,
  schemaVersion: 2,
  reflectionPromptKey: 'reflectionPromptHair',
  questions: [
    inspirationQuestion({
      key: 'favorite_colors',
      label: 'Which color or colors in this picture are your favorite?',
      kind: 'MULTI_SELECT',
      options: [
        ...COLOR_VALUES,
        ['whole-color-mix', 'The whole mix of colors'],
        ['not-sure', 'Not sure'],
      ],
      minSelections: 1,
      maxSelections: 4,
      detailSentiment: 'LIKE',
    }),
    inspirationQuestion({
      key: 'avoid_colors',
      label: 'Are there any colors in it that you are unsure about or do not want?',
      kind: 'MULTI_SELECT',
      options: [...COLOR_VALUES, ['none', 'None'], ['not-sure', 'Not sure']],
      minSelections: 1,
      maxSelections: 4,
      detailSentiment: 'DISLIKE',
    }),
    inspirationQuestion({
      key: 'length_goal',
      label: 'Is the length part of the look you want?',
      kind: 'SINGLE_SELECT',
      options: GOAL_MATCH_OPTIONS,
      minSelections: 1,
      maxSelections: 1,
      detailSentiment: 'GOAL',
      catalogDetail: 'LENGTH',
    }),
    inspirationQuestion({
      key: 'fullness_goal',
      label: 'Is the fullness or amount of hair part of the look you want?',
      helpText: 'Fullness means how thick or full the hair looks.',
      kind: 'SINGLE_SELECT',
      options: FULLNESS_GOAL_OPTIONS,
      minSelections: 1,
      maxSelections: 1,
      detailSentiment: 'GOAL',
      catalogDetail: 'FULLNESS',
    }),
    inspirationQuestion({
      key: 'current_styling',
      label: 'Do you already style your hair this way?',
      kind: 'SINGLE_SELECT',
      options: CURRENT_UPKEEP_OPTIONS,
      minSelections: 1,
      maxSelections: 1,
      detailSentiment: 'CONTEXT',
      catalogDetail: 'STYLING',
    }),
    inspirationQuestion({
      key: 'styling_walkthrough',
      label: 'Would you like your professional to walk you through this style?',
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
  // Byte-identical to v1's POSSIBLE_MEANINGS for the pairs that survive, so a
  // brief written before this pack and one written after it read the same.
  possibleMeanings: {
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
  },
}
