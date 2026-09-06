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
  coarseCards,
  HAIR_COLOR_KEEP_VALUES,
  prepCards,
} from '../cardQuestions'
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

/**
 * P5d — the CARD pack. Version 2 of the same pack id, so a consult that
 * started on v1 finishes on v1 (`resolveConsultSessionInspirationPack` pins by
 * version) and a new one gets cards.
 *
 * Six questions become eleven, and that is not a diet gone backwards: only the
 * first THREE are asked before the booking, and they are three taps. The other
 * eight are the prep tier — one per attribute the reference was actually read
 * as, shown after the appointment is on the calendar, and skipped entirely
 * where the reading saw nothing.
 *
 * What v1's six questions asked and this pack does not:
 *   * `favorite_colors` / `avoid_colors` — a fixed list of five colour names
 *     asked of every photograph, which is B5 in miniature. The prep cards ask
 *     about the colours THIS photograph actually has.
 *   * `length_goal` / `fullness_goal` — folded into the keep card, which asks
 *     the same thing the way a client would say it.
 *   * `current_styling` / `styling_walkthrough` — these are prep questions
 *     about her, not about the picture, and they belong to the intake diet
 *     (P6) rather than to a step that is looking at a photograph.
 */
export const HAIR_COLOR_INSPIRATION_CARD_PACK: ConsultInspirationPackDefinition = {
  id: HAIR_COLOR_INSPIRATION_PACK_ID,
  categorySlug: HAIR_COLOR_INSPIRATION_CATEGORY_SLUG,
  version: 2,
  schemaVersion: 2,
  reflectionPromptKey: 'reflectionPromptHair',
  questions: [...coarseCards(HAIR_COLOR_KEEP_VALUES), ...prepCards()],
  possibleMeanings: {
    'spark_focus:the-color': 'The colour itself is what stopped her — read the reference’s colour attributes as the goal.',
    'spark_focus:the-shape': 'How the colour is arranged is what stopped her — the technique, placement and root blend matter more here than the exact shade.',
    'spark_focus:the-whole-thing': 'She pointed at the reference as a whole rather than at one part of it.',
    'keep_as_is:my-length': 'The client asked for her length to be left alone.',
    'keep_as_is:my-natural-roots': 'The client asked for her natural roots to be left alone.',
    'understanding_check:thats-right': 'The client confirmed the summary of what she is after.',
    'attr_base_level:yes': 'The client confirmed where the colour starts at the roots is part of what she likes.',
    'attr_base_level:not-this': 'The client said where the colour starts at the roots is NOT what she wants.',
    'attr_lightest_level:yes': 'The client confirmed how light the colour gets is part of what she likes.',
    'attr_lightest_level:not-this': 'The client said how light the colour gets is NOT what she wants.',
    'attr_tone:yes': 'The client confirmed the warmth or coolness of the colour is part of what she likes.',
    'attr_tone:not-this': 'The client said the warmth or coolness of the colour is NOT what she wants.',
    'attr_technique:yes': 'The client confirmed the technique the reference was done with is part of what she likes.',
    'attr_technique:not-this': 'The client said the technique the reference was done with is NOT what she wants.',
    'attr_placement:yes': 'The client confirmed where the colour sits is part of what she likes.',
    'attr_placement:not-this': 'The client said where the colour sits is NOT what she wants.',
    'attr_root_blend:yes': 'The client confirmed what the roots do is part of what she likes.',
    'attr_root_blend:not-this': 'The client said what the roots do is NOT what she wants.',
    'attr_finish:yes': 'The client confirmed how much the colour shines is part of what she likes.',
    'attr_finish:not-this': 'The client said how much the colour shines is NOT what she wants.',
    'attr_dimension:yes': 'The client confirmed how much light and dark the colour has is part of what she likes.',
    'attr_dimension:not-this': 'The client said how much light and dark the colour has is NOT what she wants.',
  },
}
