// lib/consult/inspiration/packs/hairGeneral.ts
//
// The guided-inspiration pack every HAIR-family category that is not colour
// serves: cuts, extensions, treatments, styling, and any hair category created
// tomorrow. Its questions are about the SHAPE of the reference rather than its
// colour, and colour is one thing among several she may point at rather than
// the whole subject.
//
// It shares `length_goal`, `fullness_goal`, `current_styling` and
// `styling_walkthrough` — key and option values — with the colour pack, so a
// pro brief reads the same answer the same way whichever hair service the
// consult is about.

import { coarseCards, HAIR_GENERAL_KEEP_VALUES } from '../cardQuestions'
import {
  CURRENT_UPKEEP_OPTIONS,
  FULLNESS_GOAL_OPTIONS,
  GOAL_MATCH_OPTIONS,
  WALKTHROUGH_OPTIONS,
} from '../sharedOptions'
import { inspirationQuestion, type ConsultInspirationPackDefinition } from '../types'

export const HAIR_GENERAL_INSPIRATION_PACK_ID = 'hair-general-inspiration' as const

/**
 * What a hair reference can be liked or disliked FOR.
 *
 * ⚠️ No value here may contain `face`, `eyes`, `skin`, `undertone`, `race` or
 * `health` as a whole word — the database guard's content regex treats a
 * hyphen as a word boundary, so `face-framing` would be refused at the write
 * after passing every check in this repo. "The pieces around the front" is the
 * same idea with a value the guard accepts.
 */
const DETAIL_VALUES = [
  ['the-shape', 'The shape'],
  ['the-length', 'The length'],
  ['the-fullness', 'How full it looks'],
  ['the-texture', 'The texture'],
  ['the-movement', 'The way it moves'],
  ['front-pieces', 'The pieces around the front'],
  ['the-color', 'The color'],
] as const

export const HAIR_GENERAL_INSPIRATION_PACK: ConsultInspirationPackDefinition = {
  id: HAIR_GENERAL_INSPIRATION_PACK_ID,
  categorySlug: null,
  version: 1,
  schemaVersion: 2,
  reflectionPromptKey: 'reflectionPromptHair',
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
      label: 'Do you already wear your hair this way?',
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
  possibleMeanings: {
    'favorite_details:the-shape': 'May point to the overall shape of the reference.',
    'favorite_details:the-length': 'May point to the length in the reference.',
    'favorite_details:the-fullness': 'May point to how full the reference looks.',
    'favorite_details:the-texture': 'May point to the texture in the reference.',
    'favorite_details:the-movement': 'May point to how the hair moves in the reference.',
    'favorite_details:front-pieces': 'May point to the pieces around the front of the reference.',
    'favorite_details:the-color': 'May point to the color in the reference.',
    'avoid_details:the-shape': 'The client may want to avoid this overall shape.',
    'avoid_details:the-length': 'The client may want to avoid this length.',
    'avoid_details:the-fullness': 'The client may want to avoid this amount of fullness.',
    'avoid_details:the-texture': 'The client may want to avoid this texture.',
    'avoid_details:the-movement': 'The client may want to avoid this kind of movement.',
    'avoid_details:front-pieces': 'The client may want to avoid these front pieces.',
    'avoid_details:the-color': 'The client may want to avoid this color.',
    'length_goal:yes-same-length': 'Length appears to be part of the client’s goal.',
    'length_goal:longer': 'The client may want more length than the reference shows.',
    'length_goal:shorter': 'The client may want less length than the reference shows.',
    'fullness_goal:yes-same-fullness': 'The amount or fullness of hair appears to be part of the goal.',
    'fullness_goal:more-full': 'The client may want the hair to look fuller.',
    'fullness_goal:less-full': 'The client may want less fullness.',
    'current_styling:yes-often': 'The client already wears their hair in a similar way often.',
    'current_styling:sometimes': 'The client sometimes wears their hair in a similar way.',
    'current_styling:no': 'The client does not currently wear their hair this way.',
    'styling_walkthrough:yes': 'The client would like a styling walkthrough.',
  },
}

/**
 * P5d — the CARD pack for every non-colour hair category.
 *
 * COARSE ONLY, and the absence of a prep tier is the honest part: the
 * inspiration reading (lib/consult/inspirationVision.ts) describes hair
 * COLOUR, so a cut or a treatment consult has no per-attribute reading to make
 * cards from. Its three coarse cards still work — the crops fall back to the
 * whole reference, which is exactly what the client sees when a colour
 * reference could not be read either.
 *
 * A shape-and-texture reading is the day this pack grows a prep tier; until
 * then, inventing eight cards out of nothing would be Part 0 rule 4 with extra
 * steps.
 */
export const HAIR_GENERAL_INSPIRATION_CARD_PACK: ConsultInspirationPackDefinition = {
  id: HAIR_GENERAL_INSPIRATION_PACK_ID,
  categorySlug: null,
  version: 2,
  schemaVersion: 2,
  reflectionPromptKey: 'reflectionPromptHair',
  questions: coarseCards(HAIR_GENERAL_KEEP_VALUES),
  possibleMeanings: {
    'spark_focus:the-color': 'The colour in the reference is what stopped her.',
    'spark_focus:the-shape': 'The shape of the reference is what stopped her.',
    'spark_focus:the-whole-thing': 'She pointed at the reference as a whole rather than at one part of it.',
    'keep_as_is:my-length': 'The client asked for her length to be left alone.',
    'keep_as_is:my-natural-texture': 'The client asked for her natural texture to be left alone.',
    'understanding_check:thats-right': 'The client confirmed the summary of what she is after.',
  },
}
