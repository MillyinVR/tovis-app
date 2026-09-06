// lib/consult/inspiration/cardQuestions.ts
//
// P5d — the CARDS every contract-v2 pack is built from, in one place.
//
// The three coarse cards are the same three questions for every family, and
// the eight prep cards are the same eight for every family that has a reading.
// What differs between families is only which values the KEEP card offers
// (hair has roots; nails do not) and, through brand copy, how the keep card is
// worded.
//
// 🔴 Every value here is byte-identical across packs by construction. A value
// is what a payload stores and what the brief and the analysis prompt read, so
// two packs asking "is this part of what you like?" must not answer it in two
// vocabularies. That was already the rule for the shared v1 option lists
// (./sharedOptions.ts); cards make it structural.

import type { ConsultInspirationAnalysisFieldDTO } from '@/lib/dto/consult'

import { inspirationCard, type ConsultInspirationPackQuestion } from './types'

/** Card 1 — "What made you stop scrolling?" */
export const SPARK_FOCUS_KEY = 'spark_focus' as const
/** Card 2 — "Anything you don't want to change?" */
export const KEEP_AS_IS_KEY = 'keep_as_is' as const
/** Card 3 — the understanding check, whose text the server composes. */
export const UNDERSTANDING_CHECK_KEY = 'understanding_check' as const

/**
 * Which attributes each coarse crop covers.
 *
 * "The color" is the colour itself — where it starts, how light it gets, how
 * warm, how shiny, how much light and dark. "The shape of it" is how that
 * colour is ARRANGED — the technique, where it sits, what the roots do — which
 * is what a client is pointing at when she says she likes the shape of a
 * colour rather than the colour. Neither label is ever shown as a list of
 * attributes; she sees a crop and four plain words.
 */
export const SPARK_FOCUS_REGION_GROUP: Readonly<
  Record<string, readonly ConsultInspirationAnalysisFieldDTO[]>
> = {
  'the-color': ['baseLevel', 'lightestLevel', 'tone', 'finish', 'dimension'],
  'the-shape': ['technique', 'placement', 'rootBlend'],
  // Both of these are answers about the WHOLE picture, so both show it whole.
  'the-whole-thing': [],
  'not-sure': [],
}

export const SPARK_FOCUS_VALUES = [
  'the-color',
  'the-shape',
  'the-whole-thing',
  'not-sure',
] as const

/** The keep card's values, per family. `nothing-in-particular` is neutral. */
export const HAIR_COLOR_KEEP_VALUES = [
  'my-length',
  'my-natural-roots',
  'nothing-in-particular',
] as const
export const HAIR_GENERAL_KEEP_VALUES = [
  'my-length',
  'my-natural-texture',
  'nothing-in-particular',
] as const
export const GENERAL_KEEP_VALUES = [
  'my-length',
  'my-natural-shape',
  'nothing-in-particular',
] as const

export const UNDERSTANDING_CHECK_VALUES = ['thats-right', 'change-something'] as const

/** The three answers every prep card offers. "Not sure" never blocks. */
export const PREP_CARD_VALUES = ['yes', 'not-this', 'not-sure'] as const

/**
 * The prep cards, one per attribute the reading reports, in the order a
 * colourist would look at them: how dark it starts, how light it gets, how
 * warm, how it was done, where it sits, what the roots do, how shiny, how much
 * contrast.
 *
 * The pack carries all eight; WHICH of them a client is shown is decided at
 * read time from her own reading (./cards.ts). A pack that listed only the
 * ones a particular photograph supported would be a different pack per
 * photograph, and her stored answers would stop validating the moment she
 * swapped the picture.
 */
export const PREP_CARD_ATTRIBUTES: readonly ConsultInspirationAnalysisFieldDTO[] = [
  'baseLevel',
  'lightestLevel',
  'tone',
  'technique',
  'placement',
  'rootBlend',
  'finish',
  'dimension',
]

/** `baseLevel` → `attr_base_level`. The key a payload stores. */
export function prepCardKey(attribute: ConsultInspirationAnalysisFieldDTO): string {
  return `attr_${attribute.replace(/[A-Z]/g, (upper) => `_${upper.toLowerCase()}`)}`
}

export function sparkFocusCard(): ConsultInspirationPackQuestion {
  return inspirationCard({
    key: SPARK_FOCUS_KEY,
    tier: 'COARSE',
    kind: 'SINGLE_SELECT',
    values: [...SPARK_FOCUS_VALUES],
    detailSentiment: 'LIKE',
    regionGroup: SPARK_FOCUS_REGION_GROUP,
    // Liking the shape of a look, or the whole of it, can point at a cut —
    // which may be a service of its own. Liking the COLOR points at the
    // service this consult is already about, so it points at nothing extra.
    catalogDetail: 'LENGTH',
  })
}

export function keepAsIsCard(
  values: readonly string[],
): ConsultInspirationPackQuestion {
  return inspirationCard({
    key: KEEP_AS_IS_KEY,
    tier: 'COARSE',
    kind: 'MULTI_SELECT',
    values,
    minSelections: 1,
    maxSelections: values.length - 1,
    // What she wants left alone is a goal about her OWN hair, not a detail she
    // liked in someone else's picture.
    detailSentiment: 'GOAL',
  })
}

export function understandingCheckCard(): ConsultInspirationPackQuestion {
  return inspirationCard({
    key: UNDERSTANDING_CHECK_KEY,
    tier: 'COARSE',
    kind: 'SINGLE_SELECT',
    values: [...UNDERSTANDING_CHECK_VALUES],
    detailSentiment: 'CONTEXT',
    // Confirming a summary is not a detail she pointed at in the picture.
    countsAsDetail: false,
    composedPrompt: true,
    reopens: {
      'change-something': [SPARK_FOCUS_KEY, KEEP_AS_IS_KEY, UNDERSTANDING_CHECK_KEY],
    },
  })
}

export function prepCard(
  attribute: ConsultInspirationAnalysisFieldDTO,
): ConsultInspirationPackQuestion {
  return inspirationCard({
    key: prepCardKey(attribute),
    tier: 'PREP',
    kind: 'SINGLE_SELECT',
    values: [...PREP_CARD_VALUES],
    attribute,
    // One question, two opposite answers. `detailSentiment` is the fallback
    // for a value with no entry; every value here has one.
    detailSentiment: 'LIKE',
    valueSentiments: { yes: 'LIKE', 'not-this': 'DISLIKE' },
  })
}

/** The three coarse cards, in thread order, for a pack with these keep values. */
export function coarseCards(
  keepValues: readonly string[],
): ConsultInspirationPackQuestion[] {
  return [sparkFocusCard(), keepAsIsCard(keepValues), understandingCheckCard()]
}

/** The eight prep cards, in colourist order. */
export function prepCards(): ConsultInspirationPackQuestion[] {
  return PREP_CARD_ATTRIBUTES.map(prepCard)
}
