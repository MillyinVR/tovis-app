import { validateInspirationClientText } from './clientText'
// lib/consult/inspiration/registry.ts
//
// Every guided-inspiration pack the consult can serve, and the ONE engine that
// validates, sequences and normalizes answers against any of them.
//
// Resolution is by SERVICE PROFILE (lib/consult/serviceProfile.ts), exactly as
// the intake registry resolves: the colour pack for the hair-colour category,
// the hair pack for every other HAIR-family category, the general pack for
// every other family — including a family nobody has modelled yet. A pack id
// stored on a ConsultRevision is looked up here on read, so a consult keeps
// the pack it started with even after resolution rules change.
//
// The derived halves — her words, the possible professional reading, which
// catalogue details she pointed at — are computed HERE, from the pack the
// payload names. Contract v1 stored all three in the row; v2 stores the keys
// and enums she picked and nothing else, so there is one definition of each
// and a stored row cannot disagree with it.

import type { ConsultServiceFamily } from '@prisma/client'

import { CONSULT_INSPIRATION_FIELD_VALUES } from '../inspirationAttributes'

import { defaultClientConsultInspirationCopy } from '@/lib/brand/defaultClientConsultInspirationCopy'
import type { BrandClientConsultInspirationCopy } from '@/lib/brand/types'
import type {
  ConsultInspirationAnswerDTO,
  ConsultInspirationCatalogGuidanceDTO,
  ConsultInspirationExactDetailDTO,
  ConsultInspirationQuestionDTO,
  ConsultInspirationSourceDTO,
} from '@/lib/dto/consult'
import { isRecord } from '@/lib/guards'
import type { ConsultInspirationAnalysisAttributesDTO } from '@/lib/dto/consult'
import { resolveVisualDialogueQuestion } from './visualDialogue'

import {
  GENERAL_SERVICE_INSPIRATION_CARD_PACK,
  GENERAL_SERVICE_INSPIRATION_PACK,
} from './packs/generalService'
import {
  HAIR_COLOR_INSPIRATION_CARD_PACK,
  HAIR_COLOR_INSPIRATION_CARD_PACK_V4,
  HAIR_COLOR_INSPIRATION_CARD_PACK_V2,
  HAIR_COLOR_INSPIRATION_CARD_PACK_V3,
  HAIR_COLOR_INSPIRATION_PACK,
} from './packs/hairColor'
import {
  HAIR_GENERAL_INSPIRATION_CARD_PACK,
  HAIR_GENERAL_INSPIRATION_CARD_PACK_V3,
  HAIR_GENERAL_INSPIRATION_CARD_PACK_V2,
  HAIR_GENERAL_INSPIRATION_PACK,
} from './packs/hairGeneral'
import {
  CONSULT_INSPIRATION_CONTRACT_V2,
  CONSULT_INSPIRATION_FORBIDDEN_WORDS,
  CONSULT_INSPIRATION_NEUTRAL_VALUES,
  CONSULT_INSPIRATION_OPTION_VALUE_PATTERN,
  CONSULT_INSPIRATION_QUESTION_KEY_PATTERN,
  type ConsultInspirationCatalogDetail,
  type ConsultInspirationPackDefinition,
  type ConsultInspirationPackQuestion,
  type ConsultInspirationPayloadV2,
  type ConsultInspirationPossibleInterpretation,
  type ConsultInspirationProgress,
  type ConsultInspirationReview,
} from './types'

export const CONSULT_INSPIRATION_PACKS: readonly ConsultInspirationPackDefinition[] =
  [
    HAIR_COLOR_INSPIRATION_CARD_PACK,
    HAIR_GENERAL_INSPIRATION_CARD_PACK,
    GENERAL_SERVICE_INSPIRATION_CARD_PACK,
  ]

/**
 * Superseded pack versions, kept registered because stored payloads name them.
 *
 * P5d put the three v1 question packs here, and this is the day the mechanism
 * was built for: a consult that answered v1's six questions is READ against
 * v1's six questions forever — its labels, its option values, its
 * `possibleMeanings` — while a consult starting today gets cards. Removing an
 * entry would make every payload naming it unreadable, so nothing leaves this
 * list until no row names it.
 */
export const CONSULT_INSPIRATION_PACK_ARCHIVE: readonly ConsultInspirationPackDefinition[] =
  [
    HAIR_COLOR_INSPIRATION_PACK,
    HAIR_GENERAL_INSPIRATION_PACK,
    GENERAL_SERVICE_INSPIRATION_PACK,
    // P5g: v2's eight per-attribute prep cards. A consult that answered one is
    // read against them forever — see HAIR_COLOR_INSPIRATION_CARD_PACK's note.
    HAIR_COLOR_INSPIRATION_CARD_PACK_V4,
    HAIR_COLOR_INSPIRATION_CARD_PACK_V2,
    HAIR_COLOR_INSPIRATION_CARD_PACK_V3,
    HAIR_GENERAL_INSPIRATION_CARD_PACK_V3,
    HAIR_GENERAL_INSPIRATION_CARD_PACK_V2,
  ]

const PACKS_BY_ID = new Map(CONSULT_INSPIRATION_PACKS.map((pack) => [pack.id, pack]))

const PACKS_BY_ID_AND_VERSION = new Map(
  [...CONSULT_INSPIRATION_PACKS, ...CONSULT_INSPIRATION_PACK_ARCHIVE].map((pack) => [
    `${pack.id}@${pack.version}`,
    pack,
  ]),
)

/** Category slugs that carry their OWN pack, ahead of the family rule. */
const PACKS_BY_CATEGORY_SLUG: ReadonlyMap<string, ConsultInspirationPackDefinition> =
  new Map(
    CONSULT_INSPIRATION_PACKS.flatMap((pack) =>
      pack.categorySlug ? [[pack.categorySlug, pack] as const] : [],
    ),
  )

export function findConsultInspirationPack(
  packId: string,
  packVersion?: number,
): ConsultInspirationPackDefinition | null {
  if (packVersion === undefined) return PACKS_BY_ID.get(packId) ?? null
  return PACKS_BY_ID_AND_VERSION.get(`${packId}@${packVersion}`) ?? null
}

/**
 * 🔴 The family fallbacks resolve through `PACKS_BY_ID`, NOT through an
 * imported pack const.
 *
 * They used to name the constants directly, and P5d is where that bit: the
 * registry listed the new card packs, the hair-colour path resolved by SLUG
 * and got cards, and these two lines quietly kept serving version 1 to every
 * other family. Every test that asked "does the registry list the card pack?"
 * said yes. Resolution has ONE source now — the registered set — so a pack
 * that is registered is a pack that is served.
 */
function currentPack(id: string): ConsultInspirationPackDefinition {
  const pack = PACKS_BY_ID.get(id)
  if (!pack) throw new Error(`Inspiration pack "${id}" is not registered.`)
  return pack
}

export function resolveConsultInspirationPack(args: {
  categorySlug: string
  family: ConsultServiceFamily
}): ConsultInspirationPackDefinition {
  const bySlug = PACKS_BY_CATEGORY_SLUG.get(args.categorySlug)
  if (bySlug) return bySlug
  return args.family === 'HAIR'
    ? currentPack(HAIR_GENERAL_INSPIRATION_PACK.id)
    : currentPack(GENERAL_SERVICE_INSPIRATION_PACK.id)
}

/**
 * The words for ONE pack question, resolved.
 *
 * A contract-v1 pack carries its labels inline; a card pack carries none and
 * reads them from brand copy, keyed `${questionKey}` (with a
 * `${packId}:${questionKey}` override so a family can word a shared question
 * its own way) and `${questionKey}:${optionValue}`.
 *
 * 🔴 The fallback is the KEY, not an empty string. A card whose copy went
 * missing shows `spark_focus` — ugly, obvious, and reported by
 * `assertConsultInspirationCardCopy` in CI — rather than a card with a blank
 * question and four blank buttons, which looks like a broken layout and gets
 * diagnosed as one.
 */
export function consultInspirationQuestionLabel(
  pack: ConsultInspirationPackDefinition,
  question: ConsultInspirationPackQuestion,
  copy: BrandClientConsultInspirationCopy,
): string {
  if (question.label !== null) return question.label
  return (
    copy.cards.prompts[`${pack.id}:${question.key}`] ??
    copy.cards.prompts[question.key] ??
    question.key
  )
}

export function consultInspirationOptionLabel(
  question: ConsultInspirationPackQuestion,
  option: { value: string; label: string | null },
  copy: BrandClientConsultInspirationCopy,
): string {
  if (option.label !== null) return option.label
  return copy.cards.optionLabels[`${question.key}:${option.value}`] ?? option.value
}

/** The wire shape of a pack question — the pack's own rules stay server-side. */
export function toConsultInspirationQuestionDTO(
  pack: ConsultInspirationPackDefinition,
  question: ConsultInspirationPackQuestion,
  copy: BrandClientConsultInspirationCopy,
  /** The server-composed text for a `composedPrompt` question (the check). */
  composedLabel?: string | null,
): ConsultInspirationQuestionDTO {
  return {
    key: question.key,
    label:
      question.composedPrompt && composedLabel
        ? composedLabel
        : consultInspirationQuestionLabel(pack, question, copy),
    helpText: question.helpText,
    kind: question.kind,
    options: question.options.map((option) => ({
      value: option.value,
      label: consultInspirationOptionLabel(question, option, copy),
    })),
    minSelections: question.minSelections,
    maxSelections: question.maxSelections,
    allowText: true,
  }
}

function questionsByKey(pack: ConsultInspirationPackDefinition) {
  return new Map(pack.questions.map((question) => [question.key, question]))
}

export type ConsultInspirationAnswerValidation =
  | { ok: true; questionKey: string; selectedValues: string[]; text: string | null }
  | { ok: false }

/**
 * Strict write validation for ONE answer. Unknown keys, unknown values,
 * duplicate values, counts outside the question's own bounds, and a neutral
 * value mixed with a real one all fail — the same rules v1 applied to its
 * seven hard-coded questions, applied from the pack instead.
 */
export function validateConsultInspirationAnswer(
  pack: ConsultInspirationPackDefinition,
  raw: { questionKey: unknown; selectedValues: unknown; text?: unknown },
): ConsultInspirationAnswerValidation {
  const note = validateInspirationClientText(raw.text)
  if (!note.ok) return { ok: false }
  if (typeof raw.questionKey !== 'string') return { ok: false }
  const question = questionsByKey(pack).get(raw.questionKey)
  if (!question || !Array.isArray(raw.selectedValues)) return { ok: false }
  const selectedValues: string[] = []
  for (const value of raw.selectedValues) {
    if (typeof value !== 'string') return { ok: false }
    selectedValues.push(value.trim())
  }
  if (
    new Set(selectedValues).size !== selectedValues.length ||
    (selectedValues.length < question.minSelections && (!note.text || question.key === 'understanding_check')) ||
    selectedValues.length > question.maxSelections ||
    selectedValues.some(
      (value) => !question.options.some((option) => option.value === value),
    )
  ) {
    return { ok: false }
  }
  const neutral = selectedValues.filter((value) =>
    CONSULT_INSPIRATION_NEUTRAL_VALUES.has(value),
  )
  if (neutral.length > 0 && selectedValues.length > 1) return { ok: false }
  return { ok: true, questionKey: question.key, selectedValues, text: note.text }
}

/**
 * Server-owned sequence for one-question-at-a-time clients.
 *
 * 🔴 There is NO three-detail gate here, and its absence is the point of P5c.
 * v1 refused to complete until three non-neutral details had been picked, and
 * then sent the client back to a question she had already answered — a client
 * who genuinely did not mind could not finish at all. Completion is now
 * "she answered the pack", which is always reachable.
 */
export function evaluateConsultInspirationProgress(
  pack: ConsultInspirationPackDefinition,
  answers: Readonly<Record<string, readonly string[]>>,
  copy: BrandClientConsultInspirationCopy = defaultClientConsultInspirationCopy,
  /** The composed understanding-check text, when the caller has a reading. */
  composedLabel?: string | null,
  reading: ConsultInspirationAnalysisAttributesDTO | null = null,
): ConsultInspirationProgress {
  const applicable = pack.questions.flatMap((question) => {
    const resolved = resolveVisualDialogueQuestion(question, answers, reading)
    return resolved ? [resolved] : []
  })
  const answeredQuestionCount = pack.questions.filter(
    (question) => answers[question.key] !== undefined,
  ).length
  const countsAsDetail = new Map(
    pack.questions.map((question) => [question.key, question.countsAsDetail]),
  )
  const specificDetailCount = buildConsultInspirationExactDetails(
    pack,
    answers,
    copy,
  ).filter((detail) => countsAsDetail.get(detail.questionKey) !== false).length
  // Completion requires every applicable COARSE question. New visual dialogue
  // questions are coarse, but only exist where the reference and goal support them.
  // Archived PREP cards remain optional. A prep card exists only
  // where the reference was actually READ as something — a family with no
  // reading has none at all, and a photograph the model could not read has
  // none either. Gating on them would make those consults impossible to
  // finish, which is the same shape of bug as v1's three-detail gate.
  const unanswered = applicable.find(
    (question) =>
      question.tier === 'COARSE' && answers[question.key] === undefined,
  )
  const nextPrep = pack.questions.find(
    (question) => question.tier === 'PREP' && answers[question.key] === undefined,
  )
  const current = unanswered ?? null
  return {
    currentQuestion: current
      ? toConsultInspirationQuestionDTO(pack, current, copy, composedLabel)
      : null,
    /** The first unanswered PREP card, once the coarse tier is done. */
    nextPrepQuestionKey: unanswered ? null : (nextPrep?.key ?? null),
    answeredQuestionCount,
    specificDetailCount,
    canComplete: !unanswered,
    blocker: unanswered ? 'QUESTIONS_REMAINING' : null,
  }
}

/**
 * Apply a card's `reopens` rule to an answer set.
 *
 * Choosing "Change something" on the understanding check clears the two cards
 * it reopens AND itself, so `canComplete` goes back to false and the client is
 * returned to the first card. Leaving the check stored would make the pack read
 * as complete again the instant she re-answered card one, and she would never
 * be shown the corrected summary.
 */
export function applyConsultInspirationReopen(
  question: ConsultInspirationPackQuestion,
  selectedValues: readonly string[],
  answers: Readonly<Record<string, readonly string[]>>,
): Record<string, readonly string[]> {
  const next: Record<string, readonly string[]> = { ...answers }
  const cleared = new Set(
    (selectedValues.length ? selectedValues : Object.keys(question.reopens ?? {})).flatMap((value) => [...(question.reopens?.[value] ?? [])]),
  )
  for (const key of cleared) delete next[key]
  if (!cleared.has(question.key)) next[question.key] = [...selectedValues]
  return next
}

/** Her selections as the professional reads them, in pack order. */
export function buildConsultInspirationExactDetails(
  pack: ConsultInspirationPackDefinition,
  answers: Readonly<Record<string, readonly string[]>>,
  copy: BrandClientConsultInspirationCopy = defaultClientConsultInspirationCopy,
): ConsultInspirationExactDetailDTO[] {
  const details: ConsultInspirationExactDetailDTO[] = []
  for (const question of pack.questions) {
    for (const value of answers[question.key] ?? []) {
      if (CONSULT_INSPIRATION_NEUTRAL_VALUES.has(value)) continue
      const option = question.options.find((entry) => entry.value === value)
      if (!option) continue
      details.push({
        questionKey: question.key,
        value,
        clientWords: consultInspirationOptionLabel(question, option, copy),
        // A prep card asks one question with two opposite answers, so the
        // sentiment is the VALUE's where the pack declares one.
        sentiment: question.valueSentiments?.[value] ?? question.detailSentiment,
      })
    }
  }
  return details
}

/** What a professional MAY read into those selections. Never an observation. */
export function buildConsultInspirationPossibleInterpretation(
  pack: ConsultInspirationPackDefinition,
  details: readonly ConsultInspirationExactDetailDTO[],
): ConsultInspirationPossibleInterpretation[] {
  return details.flatMap((detail) => {
    const possibleMeaning = pack.possibleMeanings[`${detail.questionKey}:${detail.value}`]
    return possibleMeaning
      ? [
          {
            clientDetailValue: detail.value,
            possibleMeaning,
            confidence: 'POSSIBLE' as const,
            evidence: 'CLIENT_SELECTION' as const,
          },
        ]
      : []
  })
}

/**
 * Which catalogue details her answers could point at — the "this may be its
 * own service" note. ENUMS only: the sentence is brand copy, filled on read.
 *
 * Whether the professional actually offers such a service is a separate
 * question, asked at write time against her live menu; this function answers
 * only "did the client point at it".
 */
export function deriveConsultInspirationCatalogDetails(
  pack: ConsultInspirationPackDefinition,
  answers: Readonly<Record<string, readonly string[]>>,
): ConsultInspirationCatalogDetail[] {
  const requested: ConsultInspirationCatalogDetail[] = []
  for (const detail of buildConsultInspirationExactDetails(pack, answers)) {
    const question = questionsByKey(pack).get(detail.questionKey)
    const catalogDetail = question?.valueCatalogDetails?.[detail.value] ?? question?.catalogDetail
    if (catalogDetail && !requested.includes(catalogDetail)) {
      requested.push(catalogDetail)
    }
  }
  return requested
}

/** The stored catalogue enums, rendered with the brand's sentence. */
export function renderConsultInspirationCatalogGuidance(
  details: readonly ConsultInspirationCatalogDetail[],
  copy: BrandClientConsultInspirationCopy,
): ConsultInspirationCatalogGuidanceDTO[] {
  return details.map((detail) => ({
    detail,
    message: copy.catalogGuidanceNote,
    contextOnly: true as const,
    automaticallyAdded: false as const,
  }))
}

const V2_PAYLOAD_KEYS = new Set([
  'packId',
  'packVersion',
  'schemaVersion',
  'source',
  'inspirationId',
  'complete',
  'answers',
  'catalogGuidance',
])

const SOURCES: readonly ConsultInspirationSourceDTO[] = [
  'NONE',
  'PLATFORM_LOOK',
  'BOOKED_PRO_LOOK',
  'EXTERNAL_UPLOAD',
]

const CATALOG_DETAILS: readonly ConsultInspirationCatalogDetail[] = [
  'LENGTH',
  'FULLNESS',
  'STYLING',
]

/**
 * Read normalization for a stored contract-v2 payload, together with the pack
 * DEFINITION it was written under — the pack it NAMES, at the VERSION it
 * names, so an older registered version is read against its own question list
 * and not against today's.
 *
 * Anything else reads as `null`: an unregistered pack or version, a shape that
 * is not exactly this contract, an answer the pack does not know, or a
 * `complete` flag that disagrees with the answers. A malformed row is skipped
 * rather than partially trusted — the same rule v1 applied.
 */
export function resolveConsultInspirationPayloadV2(
  raw: unknown,
): {
  pack: ConsultInspirationPackDefinition
  payload: ConsultInspirationPayloadV2
} | null {
  if (!isRecord(raw)) return null
  if (Object.keys(raw).some((key) => key !== 'textAnswers' && !V2_PAYLOAD_KEYS.has(key))) return null
  if ([...V2_PAYLOAD_KEYS].some(key => !(key in raw))) return null
  if (typeof raw.packId !== 'string' || typeof raw.packVersion !== 'number') {
    return null
  }
  const pack = findConsultInspirationPack(raw.packId, raw.packVersion)
  if (!pack || raw.schemaVersion !== pack.schemaVersion) return null
  if (typeof raw.complete !== 'boolean') return null
  const source = SOURCES.find((candidate) => candidate === raw.source)
  if (!source) return null
  const inspirationId =
    raw.inspirationId === null
      ? null
      : typeof raw.inspirationId === 'string' && raw.inspirationId
        ? raw.inspirationId
        : undefined
  if (inspirationId === undefined || (source === 'NONE') !== (inspirationId === null)) {
    return null
  }
  if (!isRecord(raw.answers)) return null

  const textAnswers: Record<string, string> = {}
  if (raw.textAnswers !== undefined) {
    if (!isRecord(raw.textAnswers)) return null
    for (const [key, value] of Object.entries(raw.textAnswers)) {
      const note = validateInspirationClientText(value)
      if (!note.ok || !note.text || note.text !== value || !(key in raw.answers)) return null
      textAnswers[key] = note.text
    }
  }
  const answers: Record<string, readonly string[]> = {}
  for (const [questionKey, selectedValues] of Object.entries(raw.answers)) {
    const validated = validateConsultInspirationAnswer(pack, {
      questionKey,
      selectedValues,
      text: textAnswers[questionKey],
    })
    if (!validated.ok) return null
    answers[validated.questionKey] = validated.selectedValues
  }
  // A skipped reference records no answers at all; anything else is a row that
  // says two different things about whether she brought a picture.
  if (source === 'NONE' && Object.keys(answers).length > 0) return null

  if (!Array.isArray(raw.catalogGuidance)) return null
  const possibleDetails = deriveConsultInspirationCatalogDetails(pack, answers)
  const catalogGuidance: ConsultInspirationCatalogDetail[] = []
  for (const entry of raw.catalogGuidance) {
    const detail = CATALOG_DETAILS.find((candidate) => candidate === entry)
    // A stored detail her answers could not have pointed at, or a repeat, is a
    // row that disagrees with itself.
    if (!detail || !possibleDetails.includes(detail) || catalogGuidance.includes(detail)) {
      return null
    }
    catalogGuidance.push(detail)
  }

  const progress = evaluateConsultInspirationProgress(pack, answers)
  if (raw.complete !== (source === 'NONE' || progress.canComplete)) return null

  return {
    pack,
    payload: {
      packId: pack.id,
      packVersion: pack.version,
      schemaVersion: pack.schemaVersion,
      source,
      inspirationId,
      complete: raw.complete,
      answers,
      ...(Object.keys(textAnswers).length ? { textAnswers } : {}),
      catalogGuidance,
    },
  }
}

/** A contract-v2 payload as stored JSON. Keys and enums, and nothing else. */
export function toConsultInspirationJsonPayloadV2(
  payload: ConsultInspirationPayloadV2,
): Record<string, unknown> {
  return {
    packId: payload.packId,
    packVersion: payload.packVersion,
    schemaVersion: payload.schemaVersion,
    source: payload.source,
    inspirationId: payload.inspirationId,
    complete: payload.complete,
    answers: Object.fromEntries(
      Object.entries(payload.answers).map(([key, values]) => [key, [...values]]),
    ),
    ...(payload.textAnswers && Object.keys(payload.textAnswers).length ? { textAnswers: { ...payload.textAnswers } } : {}),
    catalogGuidance: [...payload.catalogGuidance],
  }
}

/**
 * A normalized v2 payload as the ONE read view every reader gets, with the
 * three derived arrays filled in from its pack. `answers` is rendered in the
 * v1 answer shape — `text` and `sentiment` null, because v2 stores neither —
 * so no reader has to branch on which contract wrote the row.
 */
export function toConsultInspirationReviewV2(
  pack: ConsultInspirationPackDefinition,
  payload: ConsultInspirationPayloadV2,
  copy: BrandClientConsultInspirationCopy,
): ConsultInspirationReview {
  const exactClientDetails = buildConsultInspirationExactDetails(
    pack,
    payload.answers,
    copy,
  )
  for (const question of pack.questions) {
    const text = payload.textAnswers?.[question.key]
    if (text) exactClientDetails.push({ questionKey: question.key, value: 'client-words', clientWords: text, sentiment: 'CONTEXT' })
  }
  const answers: ConsultInspirationAnswerDTO[] = pack.questions.flatMap((question) => {
    const selectedValues = payload.answers[question.key]
    return selectedValues
      ? [
          {
            questionKey: question.key,
            selectedValues: [...selectedValues],
            text: payload.textAnswers?.[question.key] ?? null,
            sentiment: null,
          },
        ]
      : []
  })
  return {
    contractVersion: CONSULT_INSPIRATION_CONTRACT_V2,
    schemaVersion: payload.schemaVersion,
    packId: payload.packId,
    packVersion: payload.packVersion,
    source: payload.source,
    inspirationId: payload.inspirationId,
    complete: payload.complete,
    answers,
    exactClientDetails,
    possibleProfessionalInterpretation: buildConsultInspirationPossibleInterpretation(
      pack,
      exactClientDetails,
    ),
    catalogGuidance: renderConsultInspirationCatalogGuidance(payload.catalogGuidance, copy),
  }
}

/**
 * WHICH PACK VERSION a consult serves.
 *
 * A session that has already written a v2 inspiration keeps the version it
 * wrote — re-serving the current one would refuse her stored answers as "no
 * inspiration", re-ask every question, and reject her next answer with a
 * version mismatch she has no way to resolve. `payloads` are the session's
 * INSPIRATION revision payloads, NEWEST FIRST; rows that do not normalize (a
 * v1 row included) are skipped, which is what keeps a consult that started on
 * v1 on v1.
 */
export function resolveConsultSessionInspirationPack(
  currentPack: ConsultInspirationPackDefinition,
  payloads: readonly unknown[],
): ConsultInspirationPackDefinition | null {
  for (const raw of payloads) {
    const resolved = resolveConsultInspirationPayloadV2(raw)
    if (resolved) {
      return resolved.pack.id === currentPack.id ? resolved.pack : currentPack
    }
    // A row that is not v2 at all is a contract-v1 row: this consult started
    // before P5c and finishes on v1. `null` says so; the caller keeps the v1
    // question list rather than switching vocabularies mid-consult.
    if (isRecord(raw) && raw.contractId !== undefined) return null
  }
  return currentPack
}

/**
 * 🔴 The pack-vs-database assertion. Every registered pack must be WRITABLE:
 * its keys and values have to survive `consult_inspiration_payload_guard`,
 * which cannot know a pack's vocabulary and so validates key and value SHAPE
 * plus a content regex.
 *
 * Without this, a pack whose option value happens to contain `face` or `skin`
 * as a whole word — `face-framing` is the obvious one, and a hyphen is a word
 * boundary in POSIX — would pass typecheck, pass every unit test, and fail at
 * the client's last tap with a 23514 nobody could read. Called from the
 * registry's own test over every registered pack, current and archived.
 */
export function assertConsultInspirationPackWritable(
  pack: ConsultInspirationPackDefinition,
): void {
  const fail = (message: string) => {
    throw new Error(`Inspiration pack ${pack.id} v${pack.version}: ${message}`)
  }
  if (!CONSULT_INSPIRATION_QUESTION_KEY_PATTERN.test(pack.id.replace(/-/g, '_'))) {
    fail('pack id is not slug-shaped.')
  }
  if (pack.questions.length === 0) fail('has no questions.')
  const seen = new Set<string>()
  for (const question of pack.questions) {
    if (seen.has(question.key)) fail(`asks "${question.key}" twice.`)
    seen.add(question.key)
    if (!CONSULT_INSPIRATION_QUESTION_KEY_PATTERN.test(question.key)) {
      fail(`question key "${question.key}" is not slug-shaped.`)
    }
    if (CONSULT_INSPIRATION_FORBIDDEN_WORDS.test(question.key)) {
      fail(`question key "${question.key}" carries a word the guard refuses.`)
    }
    if (question.allowText) fail(`question "${question.key}" allows free text.`)
    if (
      question.minSelections < 0 ||
      question.maxSelections < 1 ||
      question.minSelections > question.maxSelections
    ) {
      fail(`question "${question.key}" has impossible selection bounds.`)
    }
    if (question.kind === 'SINGLE_SELECT' && question.maxSelections !== 1) {
      fail(`single-select "${question.key}" allows more than one value.`)
    }
    const values = new Set<string>()
    for (const option of question.options) {
      if (values.has(option.value)) {
        fail(`question "${question.key}" repeats value "${option.value}".`)
      }
      values.add(option.value)
      if (!CONSULT_INSPIRATION_OPTION_VALUE_PATTERN.test(option.value)) {
        fail(`value "${option.value}" is not token-shaped.`)
      }
      if (CONSULT_INSPIRATION_FORBIDDEN_WORDS.test(option.value)) {
        fail(`value "${option.value}" carries a word the guard refuses.`)
      }
      // A card option carries no inline label — its words are brand copy, and
      // `assertConsultInspirationCardCopy` is what proves they exist.
      if (option.label !== null && !option.label.trim()) {
        fail(`value "${option.value}" has no label.`)
      }
    }
    if (question.options.length < question.maxSelections) {
      fail(`question "${question.key}" allows more picks than it offers.`)
    }
  }
  for (const key of Object.keys(pack.possibleMeanings)) {
    const [questionKey, value] = key.split(':')
    const question = pack.questions.find((candidate) => candidate.key === questionKey)
    if (!question || !question.options.some((option) => option.value === value)) {
      fail(`possibleMeanings names "${key}", which the pack does not ask.`)
    }
  }
}

/**
 * 🔴 The pack-vs-COPY assertion, the card twin of the pack-vs-database one
 * above.
 *
 * A card pack deliberately carries no words: its question text and every
 * option label live in `BrandClientConsultInspirationCardCopy`, resolved on
 * read. That is what lets a payload store keys and enums only — and it is also
 * how a pack can ship a card that renders as `spark_focus` with four buttons
 * labelled `the-color`, `the-shape`, `the-whole-thing`, `not-sure`, passing
 * typecheck and every unit test on the way.
 *
 * So the registry's own test runs this over every registered pack, current and
 * archived, against the brand's default table. A card with no words is a red
 * build.
 */
export function assertConsultInspirationCardCopy(
  pack: ConsultInspirationPackDefinition,
  copy: BrandClientConsultInspirationCopy,
): void {
  const fail = (message: string) => {
    throw new Error(`Inspiration pack ${pack.id} v${pack.version}: ${message}`)
  }
  for (const question of pack.questions) {
    if (question.visualDialogue) {
      if (!copy.cards.visualAreaNames[question.key]?.trim()) fail(`visual card "${question.key}" has no area name.`)
      for (const option of question.options) {
        if (option.value !== 'match-reference' && !copy.cards.visualSummaryClauses[`${question.key}:${option.value}`]?.trim()) {
          fail(`visual card "${question.key}" option "${option.value}" has no summary clause.`)
        }
      }
    }
    if (question.label === null && !question.composedPrompt) {
      const prompt =
        copy.cards.prompts[`${pack.id}:${question.key}`] ??
        copy.cards.prompts[question.key]
      if (!prompt?.trim()) {
        fail(`card "${question.key}" has no prompt in the brand copy table.`)
      }
    }
    for (const option of question.options) {
      if (option.label !== null) continue
      // P5g — a REGION card labels each attribute option from the READING
      // ("cool, silvery cast"), not from a fixed table, which is the whole
      // point: the label describes this photograph. Only the neutral value
      // (the one with no attribute behind it) has a fixed label to look up.
      if (
        question.optionsFromReading &&
        (question.regionGroup?.[option.value]?.length ?? 0) > 0
      ) {
        continue
      }
      const label = copy.cards.optionLabels[`${question.key}:${option.value}`]
      if (!label?.trim()) {
        fail(
          `card "${question.key}" option "${option.value}" has no label in the brand copy table.`,
        )
      }
    }

    // 🔴 P5g — every attribute a region card can OFFER needs a fallback name
    // and a short name for every value it can be read as. Without this the
    // assertion would pass a pack whose picker renders a box labelled
    // `tone:COOL`, which is exactly the failure the rest of this function
    // exists to make impossible for the crop cards.
    if (question.optionsFromReading) {
      for (const [value, attributes] of Object.entries(question.regionGroup ?? {})) {
        for (const attribute of attributes) {
          if (!copy.cards.attributeFallbackNames[attribute]?.trim()) {
            fail(
              `card "${question.key}" option "${value}" names attribute "${attribute}", which has no fallback name.`,
            )
          }
          for (const reading of CONSULT_INSPIRATION_FIELD_VALUES[attribute]) {
            if (reading === 'UNKNOWN') continue
            if (
              !copy.cards.attributeShortNames[`${attribute}:${reading}`]?.trim()
            ) {
              fail(`attribute "${attribute}" value "${reading}" has no short name.`)
            }
          }
        }
      }
    }
    // A prep card names an attribute, and its plain-language name is looked up
    // per VALUE the reading produced — so every value the reading can produce
    // for that attribute needs a name, not just the ones a test happened to
    // exercise. UNKNOWN never gets a card, so it never needs one.
    if (!question.attribute) continue
    for (const value of CONSULT_INSPIRATION_FIELD_VALUES[question.attribute]) {
      if (value === 'UNKNOWN') continue
      if (!copy.cards.attributeNames[`${question.attribute}:${value}`]?.trim()) {
        fail(`attribute "${question.attribute}" value "${value}" has no name.`)
      }
      if (!copy.cards.attributeShortNames[`${question.attribute}:${value}`]?.trim()) {
        fail(`attribute "${question.attribute}" value "${value}" has no short name.`)
      }
    }
    if (!copy.cards.unsureClauses[question.attribute]?.trim()) {
      fail(`attribute "${question.attribute}" has no "could not see it" clause.`)
    }
  }
}
