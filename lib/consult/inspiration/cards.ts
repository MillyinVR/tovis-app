// lib/consult/inspiration/cards.ts
//
// P5d — turning ONE reading of ONE photograph into the cards a client taps.
//
// Stage 2 of the handoff, in one function: "each attribute from the Stage 1
// analysis becomes a card — (1) the reference image zoomed to that attribute's
// region, (2) a plain-language name AFTER the picture, (3) is this part of what
// you like? Yes / Not this / Not sure."
//
// Three rules this file exists to keep:
//
//   * 🔴 A CARD ONLY EXISTS WHERE THE READING SAW SOMETHING. That is the fix
//     for B5 stated as code: a light-blonde reference produces no copper card
//     because no card is built from a fixed list — every card is built from an
//     attribute the model actually read, with a value it actually reported. An
//     UNKNOWN gets no card, and neither does a reading the model was not sure
//     enough about (CONSULT_INSPIRATION_PREP_CARD_MIN_CONFIDENCE).
//   * 🔴 NOTHING HERE IS STORED. The crop comes from the artefact, the words
//     come from brand copy, and the payload holds the question key and the
//     option enum she tapped. Edit a sentence and every consult changes,
//     including the ones already answered.
//   * 🔴 THE PICTURE COMES FIRST. `name` is what the card says UNDER the crop,
//     never above it. A client who has never heard the word "ash" is looking at
//     the silvery bit of a photograph before anyone calls it anything.

import type {
  ConsultInspirationAnalysisAttributesDTO,
  ConsultInspirationAnalysisFieldDTO,
  ConsultInspirationAnalysisRegionDTO,
  ConsultInspirationCardDTO,
  ConsultInspirationCardOptionDTO,
  ConsultInspirationCardTierDTO,
} from '@/lib/dto/consult'
import type { BrandClientConsultInspirationCopy } from '@/lib/brand/types'

import {
  attributeFromOptionValue,
  KEEP_AS_IS_KEY,
  SPARK_FOCUS_KEY,
  UNDERSTANDING_CHECK_KEY,
} from './cardQuestions'
import {
  consultInspirationOptionLabel,
  consultInspirationQuestionLabel,
  toConsultInspirationQuestionDTO,
} from './registry'
import {
  CONSULT_INSPIRATION_NEUTRAL_VALUES,
  type ConsultInspirationPackDefinition,
  type ConsultInspirationPackQuestion,
} from './types'

/**
 * How sure the reading has to be before a prep card is built from it.
 *
 * The reading answers with a RANGE (`{min, max}`), and this is a floor on the
 * LOW end: "I am at least this sure". A card is a sentence put in front of a
 * client as a description of her reference, so a reading the model itself
 * disclaimed has no business being said out loud. Such an attribute is not
 * silently dropped — it becomes the "we couldn't tell yet" clause in the
 * understanding check, which is the honest version of the same information.
 *
 * 🔴 0.35, and the number is CALIBRATED, not picked. The only inspiration
 * confidences this repo records are 0.4–0.65 for an observation the model made
 * and 0.05–0.3 for one it did not (the shape asserted in
 * tests/live/consult-provider-schema.test.ts and produced by the integration
 * fakes). A floor of 0.5 — the obvious guess, and the one this was first
 * written as — sits ABOVE the low end of a perfectly good reading, so every
 * prep card would have been suppressed and the feature would have looked
 * built and done nothing. The floor's job is only to exclude a KNOWN value the
 * model hedged into the unread band; `value === 'UNKNOWN'` already excludes
 * the rest.
 *
 * ⚠️ NOT calibrated against a real corpus of references — there is no such
 * corpus in this repo. It is one named constant so re-cutting it against real
 * readings is one edit and one test.
 */
export const CONSULT_INSPIRATION_PREP_CARD_MIN_CONFIDENCE = 0.35

/** The reading, in the shape both the DTO and the engine hold it. */
export type ConsultInspirationCardReading = ConsultInspirationAnalysisAttributesDTO

/**
 * The union of several regions.
 *
 * A coarse crop covers a GROUP of attributes ("the color" is five of them), and
 * the honest crop for a group is the box that contains all of their boxes —
 * never the first one, which would show the client one attribute and label it
 * with the group's name. Clamped to the image because the boxes are the
 * model's and nothing downstream should have to defend against a 1.2.
 */
export function unionConsultInspirationRegions(
  regions: readonly (ConsultInspirationAnalysisRegionDTO | null)[],
): ConsultInspirationAnalysisRegionDTO | null {
  const boxes = regions.filter(
    (region): region is ConsultInspirationAnalysisRegionDTO => region !== null,
  )
  if (boxes.length === 0) return null
  const left = Math.min(...boxes.map((box) => box.x))
  const top = Math.min(...boxes.map((box) => box.y))
  const right = Math.max(...boxes.map((box) => box.x + box.w))
  const bottom = Math.max(...boxes.map((box) => box.y + box.h))
  const x = round4(Math.max(0, Math.min(1, left)))
  const y = round4(Math.max(0, Math.min(1, top)))
  return {
    x,
    y,
    w: round4(Math.max(0, Math.min(1, right) - x)),
    h: round4(Math.max(0, Math.min(1, bottom) - y)),
  }
}

/**
 * Four decimal places — the SAME precision the stored regions carry.
 *
 * `right - x` is a floating-point subtraction, so the union of a single box
 * came back as `w: 0.29999999999999993` for a stored `0.3`. It rendered
 * identically and it was still wrong: the union of one box is that box, and a
 * helper that cannot say so makes every test of it approximate. The vision
 * sanitizer rounds its regions to four places on the way in
 * (lib/consult/inspirationVision.ts), so this is the same grid, not a new one.
 */
function round4(value: number): number {
  return Math.round(value * 10_000) / 10_000
}

/** Is this attribute worth showing the client as a card of its own? */
export function consultInspirationAttributeIsCardworthy(
  reading: ConsultInspirationCardReading | null,
  attribute: ConsultInspirationAnalysisFieldDTO,
): boolean {
  const observed = reading?.[attribute]
  if (!observed || observed.value === 'UNKNOWN') return false
  return observed.confidence.min >= CONSULT_INSPIRATION_PREP_CARD_MIN_CONFIDENCE
}

function attributeName(
  copy: BrandClientConsultInspirationCopy,
  attribute: ConsultInspirationAnalysisFieldDTO,
  value: string,
): string | null {
  return copy.cards.attributeNames[`${attribute}:${value}`] ?? null
}

function attributeShortName(
  copy: BrandClientConsultInspirationCopy,
  attribute: ConsultInspirationAnalysisFieldDTO,
  value: string,
): string | null {
  return copy.cards.attributeShortNames[`${attribute}:${value}`] ?? null
}

/**
 * P5g — what a tappable REGION is called.
 *
 * The reading's own short name where there is one ("cool, silvery cast"), so
 * the label describes THIS photograph rather than naming a category. The
 * per-attribute fallback covers a value the copy table has not been given a
 * phrase for yet — a label that says "the warmth in it" is worse than one that
 * says "cool, silvery cast" and far better than one that says `tone:COOL`.
 */
function regionOptionLabel(
  copy: BrandClientConsultInspirationCopy,
  attribute: ConsultInspirationAnalysisFieldDTO,
  value: string,
): string {
  return (
    attributeShortName(copy, attribute, value) ??
    copy.cards.attributeFallbackNames[attribute] ??
    attribute
  )
}

/**
 * The one thing the photograph could not settle, for the understanding check.
 *
 * Priority order, not "the first in the object": what a client most wants to
 * hear an honest "not yet" about is how bright she will end up, then how warm,
 * then how it gets done. Returns null when the reading settled everything —
 * the sentence then simply has one clause fewer.
 */
const UNSURE_PRIORITY: readonly ConsultInspirationAnalysisFieldDTO[] = [
  'lightestLevel',
  'tone',
  'baseLevel',
  'technique',
  'placement',
  'rootBlend',
  'dimension',
  'finish',
]

function unsureClause(
  reading: ConsultInspirationCardReading | null,
  copy: BrandClientConsultInspirationCopy,
): string | null {
  if (!reading) return null
  for (const attribute of UNSURE_PRIORITY) {
    if (consultInspirationAttributeIsCardworthy(reading, attribute)) continue
    const clause = copy.cards.unsureClauses[attribute]
    if (clause) return clause
  }
  return null
}

/** "a, b, and c" — the Oxford comma, because two of these clauses read as one without it. */
function joinClauses(clauses: readonly string[], conjunction: string): string {
  const [first, second] = clauses
  if (first === undefined) return ''
  if (second === undefined) return first
  if (clauses.length === 2) return `${first} ${conjunction} ${second}`
  return `${clauses.slice(0, -1).join(', ')}, ${conjunction} ${clauses[clauses.length - 1]}`
}

/**
 * The understanding check's sentence, composed on the SERVER from her own
 * answers so far and what the photograph did or did not settle.
 *
 * "You like the color and want to keep your length. The photo does not clearly
 * show the contrast. We'll help Susie work out the details."
 *
 * It is composed rather than picked from a list because it is a summary of a
 * particular client's particular taps — the whole point of showing it is that
 * she can say "no, that's not it" to something specific. Every fragment is
 * brand copy; this function only decides which fragments and in what order.
 */
export function composeConsultInspirationUnderstanding(args: {
  pack: ConsultInspirationPackDefinition
  answers: Readonly<Record<string, readonly string[]>>
  reading: ConsultInspirationCardReading | null
  copy: BrandClientConsultInspirationCopy
  professionalDisplayName: string
}): string {
  const { cards } = args.copy
  const clauses: string[] = []

  // A broad attraction is not a request for every observed attribute. Saying
  // "the color" does not confirm the reference's lightest level or tone.
  // Keep the client's answer distinct from what the model saw in the photo.
  for (const value of args.answers[SPARK_FOCUS_KEY] ?? []) {
    const clause = cards.sparkClauses[value]
    if (clause) clauses.push(clause)
  }
  // Reuse the same interpretation the analysis receives, including archived
  // per-attribute cards. Only an explicit visual choice earns a specific
  // attribute in this summary; merely observing it in the photo does not.
  const preferences = deriveConsultInspirationPreferences(args)
  const conflicting = new Set(
    preferences.wants.filter((pair) => preferences.avoids.includes(pair)),
  )
  const groups = [
    [cards.detailClauses.wants, preferences.wants.filter((pair) => !conflicting.has(pair))],
    [cards.detailClauses.avoids, preferences.avoids.filter((pair) => !conflicting.has(pair))],
    [cards.detailClauses.unsure, preferences.unsure.filter((pair) => !conflicting.has(pair))],
    [cards.detailClauses.conflicting, [...conflicting]],
  ] as const
  for (const [template, pairs] of groups) {
    const names = [...new Set(
      pairs.map((pair) => cards.attributeShortNames[pair])
        .filter((name): name is string => typeof name === 'string' && name.length > 0),
    )]
    if (names.length > 0) {
      clauses.push(
        template.split('{details}').join(joinClauses(names, cards.understandingConjunction)),
      )
    }
  }
  for (const value of args.answers[KEEP_AS_IS_KEY] ?? []) {
    if (CONSULT_INSPIRATION_NEUTRAL_VALUES.has(value)) continue
    const clause = cards.keepClauses[value]
    if (clause) clauses.push(clause)
  }
  for (const value of args.answers.look_match ?? []) {
    const clause = cards.lookMatchClauses[value]
    if (clause) clauses.push(clause)
  }
  // Image uncertainty belongs to the image, not to the client's wishes.
  // With no meaningful answer yet, show the ordinary fallback instead.
  const observation = clauses.length > 0 ? unsureClause(args.reading, args.copy) : null

  const close = cards.understandingClose
    .split('{pro}')
    .join(args.professionalDisplayName)
  if (clauses.length === 0) {
    return cards.understandingFallback.split('{pro}').join(args.professionalDisplayName)
  }
  return [
    `${cards.understandingLead} ${joinClauses(clauses, cards.understandingConjunction)}.`,
    observation,
    close,
  ].filter(Boolean).join(' ')
}

/**
 * ONE card, or null when this question does not become one for this client.
 *
 * Null happens for exactly one reason and it is the important one: a PREP card
 * whose attribute the reading did not settle. A coarse card is always built —
 * with no reading at all, its crops are null and the client sees the whole
 * reference beside the same four options, which is the stated fallback.
 */
export function buildConsultInspirationCard(args: {
  pack: ConsultInspirationPackDefinition
  question: ConsultInspirationPackQuestion
  reading: ConsultInspirationCardReading | null
  copy: BrandClientConsultInspirationCopy
  professionalDisplayName: string
  answers: Readonly<Record<string, readonly string[]>>
}): ConsultInspirationCardDTO | null {
  const { question, reading, copy } = args
  const attribute = question.attribute

  if (attribute) {
    if (!consultInspirationAttributeIsCardworthy(reading, attribute)) return null
    const observed = reading![attribute]
    return {
      questionKey: question.key,
      tier: question.tier,
      attribute,
      // The reading's own value, so a client screen and the pro's brief are
      // describing the same observation rather than two paraphrases of it.
      attributeValue: observed.value,
      name: attributeName(copy, attribute, observed.value),
      region: observed.region,
      presentation: 'CROP',
      optionRegions: [],
      question: toConsultInspirationQuestionDTO(args.pack, question, copy),
      selectedValues: [...(args.answers[question.key] ?? [])],
    }
  }

  // ── P5g — a REGION PICKER ────────────────────────────────────────────────
  //
  // One picture, every attribute the reading settled drawn on it as a tappable
  // area, multi-select. The options are built from HER reading, not from the
  // pack's full list, which is what makes "a blonde reference offers no copper
  // region" structural rather than remembered.
  //
  // 🔴 A neutral option ("not sure", "nothing to change") rides alongside the
  // regions — but a move with NO regions is not built at all. A picker that
  // said "Tap what you love." over a photograph with nothing on it, and one
  // button reading "Not sure yet", is a question about an absence.
  //
  // That is the same rule the eight prep cards followed and it was nearly lost
  // here: this first shipped always-built, on the reasoning that the neutral
  // option is always answerable. `consult-look-anchor` caught it — a consult
  // whose reference has not been read yet had three coarse cards and then two
  // empty moves.
  if (question.optionsFromReading) {
    const options: ConsultInspirationCardOptionDTO[] = []
    for (const option of question.options) {
      const group = question.regionGroup?.[option.value] ?? []
      if (group.length === 0) {
        // The neutral value: no attribute behind it, so no reading to check
        // and no box to draw.
        options.push({
          value: option.value,
          label: consultInspirationOptionLabel(question, option, copy),
          region: null,
        })
        continue
      }
      const readable = group.filter((field) =>
        consultInspirationAttributeIsCardworthy(reading, field),
      )
      if (readable.length !== group.length) continue
      const [attribute] = readable
      // One attribute per option on this card, so the label is that
      // attribute's own reading rather than a group name.
      options.push({
        value: option.value,
        label:
          readable.length === 1 && attribute
            ? regionOptionLabel(copy, attribute, reading![attribute].value)
            : consultInspirationOptionLabel(question, option, copy),
        region: unionConsultInspirationRegions(
          readable.map((field) => reading![field].region),
        ),
      })
    }
    // No region, no move. See the note above.
    if (!options.some((option) => option.region !== null)) return null
    return {
      questionKey: question.key,
      tier: question.tier,
      attribute: null,
      attributeValue: null,
      name: null,
      // 🔴 Null on purpose: the picker shows the WHOLE reference and draws the
      // options on top of it. A `region` here would crop the picture the boxes
      // are measured against, and every box would then point somewhere else.
      region: null,
      presentation: 'REGION_PICKER',
      optionRegions: options,
      question: {
        ...toConsultInspirationQuestionDTO(args.pack, question, copy),
        // The wire question must offer exactly what the picker draws, so the
        // "you chose…" summary and the buttons a non-picker client falls back
        // to cannot name an option this photograph never produced.
        options: options.map((option) => ({
          value: option.value,
          label: option.label,
        })),
        maxSelections: Math.max(
          1,
          options.filter((option) => option.region !== null).length,
        ),
      },
      selectedValues: [...(args.answers[question.key] ?? [])],
    }
  }

  const composed =
    question.key === UNDERSTANDING_CHECK_KEY
      ? composeConsultInspirationUnderstanding({
          pack: args.pack,
          answers: args.answers,
          reading,
          copy,
          professionalDisplayName: args.professionalDisplayName,
        })
      : null

  return {
    questionKey: question.key,
    tier: question.tier,
    attribute: null,
    attributeValue: null,
    name: null,
    region: null,
    presentation: 'CROP',
    // Per-option crops: "the color" and "the shape of it" are two visibly
    // different parts of one photograph, and an option whose group the reading
    // did not settle falls back to the whole image rather than to a wrong box.
    optionRegions: question.regionGroup
      ? question.options.map((option) => ({
          value: option.value,
          label: consultInspirationOptionLabel(question, option, copy),
          region: unionConsultInspirationRegions(
            (question.regionGroup?.[option.value] ?? [])
              .filter((field) => consultInspirationAttributeIsCardworthy(reading, field))
              .map((field) => reading![field].region),
          ),
        }))
      : [],
    question: toConsultInspirationQuestionDTO(
      args.pack,
      question,
      copy,
      composed ?? undefined,
    ),
    selectedValues: [...(args.answers[question.key] ?? [])],
  }
}

export type ConsultInspirationCardSet = {
  /** The three before the booking, always built. */
  coarse: ConsultInspirationCardDTO[]
  /** One per attribute the reading settled. Empty when there is no reading. */
  prep: ConsultInspirationCardDTO[]
}

/** Every card this client is shown, in pack order, split by tier. */
export function buildConsultInspirationCards(args: {
  pack: ConsultInspirationPackDefinition
  reading: ConsultInspirationCardReading | null
  copy: BrandClientConsultInspirationCopy
  professionalDisplayName: string
  answers: Readonly<Record<string, readonly string[]>>
}): ConsultInspirationCardSet {
  const cards: ConsultInspirationCardSet = { coarse: [], prep: [] }
  for (const question of args.pack.questions) {
    // A contract-v1 question is not a card and never becomes one: v1 consults
    // keep the wizard they started in (`resolveConsultSessionInspirationPack`).
    if (question.label !== null) continue
    const card = buildConsultInspirationCard({ ...args, question })
    if (!card) continue
    if (card.tier === 'PREP') cards.prep.push(card)
    else cards.coarse.push(card)
  }
  return cards
}

/**
 * What the ANALYSIS is told she said — the four lists the handoff asks P5d to
 * produce, derived from her taps and the reading they were about.
 *
 * 🔴 They are DERIVED, not stored. Her payload holds `attr_tone: ['yes']`; the
 * fact that "tone" was COOL on this photograph lives in the artefact, keyed to
 * the same inspiration row. Storing the pair would be two sources of truth for
 * one tap, and the day a reference is swapped the stored half would still name
 * the old picture's colour.
 *
 * An attribute whose card she was never shown contributes to nothing. A card
 * answered "Not sure" lands in `unsure` — which is a real answer and is what
 * the prompt is told, rather than an absence it might fill in for itself.
 */
export type ConsultInspirationClientPreferences = {
  /** `attribute:VALUE` pairs she said yes to, plus what the coarse card pointed at. */
  wants: string[]
  /** `attribute:VALUE` pairs she said "not this" to. Stage 4 tier 2 needs these. */
  avoids: string[]
  /** `attribute:VALUE` pairs she was not sure about, and the coarse "not sure". */
  unsure: string[]
  /** What she asked to be left alone, in her own words. */
  keep: string[]
}

export function deriveConsultInspirationPreferences(args: {
  pack: ConsultInspirationPackDefinition
  reading: ConsultInspirationCardReading | null
  copy: BrandClientConsultInspirationCopy
  answers: Readonly<Record<string, readonly string[]>>
}): ConsultInspirationClientPreferences {
  const preferences: ConsultInspirationClientPreferences = {
    wants: [],
    avoids: [],
    unsure: [],
    keep: [],
  }
  for (const question of args.pack.questions) {
    const selected = args.answers[question.key]
    if (!selected || question.label !== null) continue

    if (question.attribute) {
      // Read the artefact THIS answer was about. An answer with no readable
      // attribute behind it is dropped rather than guessed at — the same rule
      // the card itself follows, so what the analysis is told and what she was
      // shown cannot disagree.
      if (!consultInspirationAttributeIsCardworthy(args.reading, question.attribute)) {
        continue
      }
      const pair = `${question.attribute}:${args.reading![question.attribute].value}`
      for (const value of selected) {
        if (value === 'yes') preferences.wants.push(pair)
        else if (value === 'not-this') preferences.avoids.push(pair)
        else if (value === 'not-sure') preferences.unsure.push(pair)
      }
      continue
    }

    // ── P5g — a REGION card's taps ─────────────────────────────────────────
    //
    // Each tap names an ATTRIBUTE; what she said about it is the card's own
    // sentiment — love or change. The pair that lands in `wants`/`avoids` is
    // `attribute:VALUE`, byte-identical to what the eight prep cards produced,
    // so the analysis prompt, the brief and Stage 4's tier 2 read exactly what
    // they read before. Two moves replaced eight cards; nothing downstream can
    // tell the difference.
    //
    // 🔴 An answer about an attribute this reading did not settle is DROPPED,
    // not guessed at — the same rule the card follows, so what the analysis is
    // told and what she was shown cannot disagree. That is not hypothetical:
    // the write path validates against the PACK (all eight), while the picker
    // only ever offered her the readable ones, so the two lists differ by
    // construction and a swapped reference makes a stored answer stale.
    if (question.optionsFromReading) {
      for (const value of selected) {
        if (CONSULT_INSPIRATION_NEUTRAL_VALUES.has(value)) continue
        const attribute = attributeFromOptionValue(value)
        if (!attribute) continue
        if (!consultInspirationAttributeIsCardworthy(args.reading, attribute)) {
          continue
        }
        const pair = `${attribute}:${args.reading![attribute].value}`
        const sentiment =
          question.valueSentiments?.[value] ?? question.detailSentiment
        if (sentiment === 'DISLIKE') preferences.avoids.push(pair)
        else preferences.wants.push(pair)
      }
      continue
    }

    if (question.key === SPARK_FOCUS_KEY) {
      for (const value of selected) {
        const label = consultInspirationOptionLabel(
          question,
          { value, label: null },
          args.copy,
        )
        if (value === 'not-sure') preferences.unsure.push(label)
        else preferences.wants.push(label)
      }
      continue
    }

    // Neutral answers are excluded from exact details. Preserve this explicit
    // uncertainty in the preferences the analysis receives.
    if (question.key === 'look_match' && selected.includes('not-sure')) {
      preferences.unsure.push(
        `${consultInspirationQuestionLabel(args.pack, question, args.copy)} → ${consultInspirationOptionLabel(question, { value: 'not-sure', label: null }, args.copy)}`,
      )
      continue
    }

    if (question.key === KEEP_AS_IS_KEY) {
      for (const value of selected) {
        if (CONSULT_INSPIRATION_NEUTRAL_VALUES.has(value)) continue
        preferences.keep.push(
          consultInspirationOptionLabel(question, { value, label: null }, args.copy),
        )
      }
    }
  }
  return preferences
}

/** Named so a caller can say what it is asking for rather than passing a string. */
export const CONSULT_INSPIRATION_CARD_TIERS: readonly ConsultInspirationCardTierDTO[] =
  ['COARSE', 'PREP']

/** The question that owns a card, by key — for the write path's reopen rule. */
export function findConsultInspirationCardQuestion(
  pack: ConsultInspirationPackDefinition,
  questionKey: string,
): ConsultInspirationPackQuestion | null {
  return pack.questions.find((question) => question.key === questionKey) ?? null
}

export { consultInspirationQuestionLabel }
