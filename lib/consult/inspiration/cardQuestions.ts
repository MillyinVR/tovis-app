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

import type {
  ConsultInspirationAnalysisFieldDTO,
  ConsultInspirationExactDetailDTO,
} from '@/lib/dto/consult'

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

// ── P5g — the two region cards ──────────────────────────────────────────────
//
// The prep tier stops being eight repetitions of "is this part of what you
// like?" and becomes two moves over ONE picture: tap what you love, then tap
// anything you'd change. Same reading, same regions, same vocabulary — a
// different number of taps to say the same thing.
//
// 🔴 The eight prep cards are NOT deleted. `prepCards()` still exists and the
// v2 card pack that uses it is archived rather than removed, because a consult
// that answered `attr_tone: ['yes']` is read against the pack that asked it
// forever (registry.ts, CONSULT_INSPIRATION_PACK_ARCHIVE). What changes is
// which pack a NEW consult gets.

/** Move 1 — "Tap what you love." */
export const LOVE_REGIONS_KEY = 'love_regions' as const
/** Move 2 — "Anything you'd change?" */
export const CHANGE_REGIONS_KEY = 'change_regions' as const

/** The honest "nothing here" answer on each move. Both are neutral values. */
export const LOVE_REGIONS_NEUTRAL_VALUE = 'not-sure' as const
export const CHANGE_REGIONS_NEUTRAL_VALUE = 'nothing-to-change' as const

/**
 * `baseLevel` → `base-level`. The option VALUE a region tap stores.
 *
 * Token-shaped (`^[a-z0-9][a-z0-9-]{0,63}$`) so the database guard accepts it,
 * and deliberately DIFFERENT from `prepCardKey`'s `attr_base_level`, which is
 * a question key and lives in a different namespace with a different pattern.
 *
 * 🔴 No attribute name is a forbidden word. The guard's content regex refuses
 * `face|eyes?|skin|undertone|identity|ethnic|ethnicity|race|health` as WHOLE
 * words and a hyphen is a POSIX word boundary, so a value like `face-framing`
 * would be refused after passing every TypeScript check. None of the eight
 * attribute names contains one — and `assertConsultInspirationPackWritable`
 * proves it for every registered pack rather than leaving it to this comment.
 * The reading's own VALUES (FACE_FRAMING and friends) never enter a payload:
 * what is stored is which attribute she tapped, not what it was read as.
 */
export function attributeOptionValue(
  attribute: ConsultInspirationAnalysisFieldDTO,
): string {
  return attribute.replace(/[A-Z]/g, (upper) => `-${upper.toLowerCase()}`)
}

/** `base-level` → `baseLevel`, or null for a value that is not an attribute. */
export function attributeFromOptionValue(
  value: string,
): ConsultInspirationAnalysisFieldDTO | null {
  return (
    PREP_CARD_ATTRIBUTES.find(
      (attribute) => attributeOptionValue(attribute) === value,
    ) ?? null
  )
}

/**
 * One region card: every attribute the reading settled, as a tappable area on
 * the whole reference, multi-select.
 *
 * `regionGroup` is what turns the option list into boxes — the same field the
 * coarse spark card already uses, one attribute per option instead of five.
 * `optionsFromReading` is what keeps B5 fixed: the pack carries all eight, and
 * a client is only ever OFFERED the ones her own photograph actually answered.
 *
 * The neutral value is always offered and never carries a region: "not sure"
 * and "nothing to change" are about the whole picture, and they are the answer
 * a client whose reference could not be read at all still gets to give.
 */
function regionCard(args: {
  key: string
  neutralValue: string
  sentiment: ConsultInspirationExactDetailDTO['sentiment']
  countsAsDetail: boolean
}): ConsultInspirationPackQuestion {
  const values = [
    ...PREP_CARD_ATTRIBUTES.map(attributeOptionValue),
    args.neutralValue,
  ]
  return inspirationCard({
    key: args.key,
    tier: 'PREP',
    kind: 'MULTI_SELECT',
    values,
    minSelections: 1,
    // Every attribute at once is a real answer ("I love all of it"), so the
    // ceiling is the attribute count — the neutral value can never join them.
    maxSelections: PREP_CARD_ATTRIBUTES.length,
    detailSentiment: args.sentiment,
    regionGroup: Object.fromEntries([
      ...PREP_CARD_ATTRIBUTES.map(
        (attribute) => [attributeOptionValue(attribute), [attribute]] as const,
      ),
      [args.neutralValue, []] as const,
    ]),
    optionsFromReading: true,
    countsAsDetail: args.countsAsDetail,
  })
}

export function loveRegionsCard(): ConsultInspirationPackQuestion {
  return regionCard({
    key: LOVE_REGIONS_KEY,
    neutralValue: LOVE_REGIONS_NEUTRAL_VALUE,
    sentiment: 'LIKE',
    countsAsDetail: true,
  })
}

export function changeRegionsCard(): ConsultInspirationPackQuestion {
  return regionCard({
    key: CHANGE_REGIONS_KEY,
    neutralValue: CHANGE_REGIONS_NEUTRAL_VALUE,
    // What she would CHANGE about the reference is a dislike, and Stage 4's
    // tier 2 depends on the dislikes being dislikes.
    sentiment: 'DISLIKE',
    countsAsDetail: true,
  })
}

/** The two region cards, in thread order. P5g's whole prep tier. */
export function regionCards(): ConsultInspirationPackQuestion[] {
  return [loveRegionsCard(), changeRegionsCard()]
}

/** Outcome-first hair cards. A photo's service tag never defines these choices.
 * Keep the earlier constructors unchanged for sessions pinned to older packs.
 */
export function hairOutcomeCards(): ConsultInspirationPackQuestion[] {
  const goalKey = 'look_match'
  const check = understandingCheckCard()
  const reset = [SPARK_FOCUS_KEY, KEEP_AS_IS_KEY, goalKey, UNDERSTANDING_CHECK_KEY]
  const cards = [
    inspirationCard({
      key: SPARK_FOCUS_KEY,
      tier: 'COARSE',
      kind: 'MULTI_SELECT',
      values: ['the-color', 'the-cut', 'the-layers', 'the-movement', 'the-length', 'the-fullness', 'not-sure'],
      minSelections: 1,
      maxSelections: 6,
      detailSentiment: 'LIKE',
      // Cut, layers and movement have no established reading/crop yet.
      // Show the actual whole reference rather than a colour-placement box.
    }),
    keepAsIsCard(['my-length', 'my-color', 'my-natural-roots', 'my-natural-texture', 'nothing-in-particular']),
    inspirationCard({
      key: goalKey,
      countsAsDetail: false,
      tier: 'COARSE',
      kind: 'SINGLE_SELECT',
      values: ['match-selected-parts', 'adapt-selected-parts', 'not-sure'],
      detailSentiment: 'GOAL',
    }),
    { ...check, reopens: { 'change-something': reset } },
  ]
  // An edited preference withdraws confirmation of the old summary. The
  // generic write path applies this even after a consult was completed.
  return cards.map((card) => card.key === UNDERSTANDING_CHECK_KEY ? card : {
    ...card,
    ...(card.key === SPARK_FOCUS_KEY ? { valueCatalogDetails: { 'the-length': 'LENGTH' as const, 'the-fullness': 'FULLNESS' as const } } : {}),
    reopens: Object.fromEntries(card.options.map((option) => [
      option.value,
      card.key === SPARK_FOCUS_KEY || card.key === KEEP_AS_IS_KEY
        ? [goalKey, UNDERSTANDING_CHECK_KEY]
        : [UNDERSTANDING_CHECK_KEY],
    ])),
  })
}

export const HAIR_OUTCOME_MEANINGS: Readonly<Record<string, string>> = {
  'spark_focus:the-color': 'The client is drawn to the color. This does not establish an exact tone, brightness or amount of contrast; clarify those visually.',
  'spark_focus:the-cut': 'The client is drawn to the cut. Do not infer a request to copy the length.',
  'spark_focus:the-layers': 'The client is drawn to the layers. Length and styling preferences remain separate.',
  'spark_focus:the-movement': 'The client is drawn to the movement. Clarify whether this is the cut, styling, or both rather than assuming a technique.',
  'spark_focus:the-length': 'The reference length caught the client’s attention. Compare their starting length and what they want to keep before proposing any length change.',
  'spark_focus:the-fullness': 'The client likes the fullness. This is not consent to extensions; establish whether cut, styling, or added hair is appropriate.',
  'keep_as_is:my-length': 'The client asked for their current length to be preserved.',
  'keep_as_is:my-color': 'The client asked for their current color to be preserved.',
  'keep_as_is:my-natural-roots': 'The client asked for their natural roots to be preserved.',
  'keep_as_is:my-natural-texture': 'The client asked for their natural texture to be preserved.',
  'look_match:match-selected-parts': 'The client wants the selected parts to resemble the reference closely, while preserving what they asked to keep. Unselected features are not requested.',
  'look_match:adapt-selected-parts': 'The client wants an adaptation of the selected parts. Confirm the proposed differences rather than treating the reference as an exact target.',
  'understanding_check:thats-right': 'The client confirmed this summary of their preferences, not a service plan or a guaranteed result.',
}
