// lib/consult/followUpContext.ts
//
// P5g — everything the follow-up call is told, rendered once.
//
// The same idea as `consultProfileBlock` in the analysis engine: what is
// already known arrives as TEXT rather than as fields to fill in again, so the
// model cannot restate it, contradict it, or quietly re-derive it. Its only
// output is a question.
//
// 🔴 Every line below is built from an enum, a level, a confidence range or a
// pack key. There is no free text anywhere in a consult to leak into this
// prompt — the thread has no text input (P5a) and every stored payload is keys
// and enums — which is why a prompt-injection surface does not exist here.
//
// 🔴 UNKNOWN is stated, never omitted. A reading the model is not told about is
// one it can quietly invent; a reading it is told is UNKNOWN is one Part 0
// rule 8 forbids it to lean on, and the prompt says so.

import 'server-only'

import type { BrandClientConsultInspirationCopy } from '@/lib/brand/types'
import type {
  ConsultInspirationAnalysisAttributesDTO,
  ConsultInspirationAnalysisFieldDTO,
} from '@/lib/dto/consult'

import type { ConsultAnalysisCore } from './analysisEngine'
import { CONSULT_ANALYSIS_CORE_FIELDS } from './analysisEngine'
import type { ConsultInspirationClientPreferences } from './inspiration/cards'
import { CONSULT_INSPIRATION_ANALYSIS_FIELDS } from './inspirationAttributes'
import type { ConsultFollowUpVocabulary } from './followUpVocabulary'

/**
 * A capture shot key as a phrase a question may use out loud.
 *
 * 🔴 The keys themselves must never reach the client's screen, and two of them
 * must never reach it in ANY form: `face_front`, `face_side` and `eyes_closeup`
 * name parts of a person, and both the prompt and the database CHECK refuse a
 * question that says "face" or "eyes". So those three map to phrases about the
 * PHOTOGRAPH rather than about her — "the photo you took looking straight at
 * the camera" is the same picture, described the way the app is allowed to
 * describe it.
 *
 * This is what "the follow-up names the client's own photo" means in practice:
 * the evidence label on an observation becomes a phrase she recognizes.
 */
export const CONSULT_FOLLOW_UP_SHOT_PHRASES: Readonly<Record<string, string>> = {
  hair_back: 'the photo of the back of your hair',
  hair_left: 'the photo of your hair from the left',
  hair_right: 'the photo of your hair from the right',
  hair_crown: 'the photo looking down at the top of your hair',
  face_front: 'the photo you took looking straight at the camera',
  face_side: 'the photo you took from the side',
  eyes_closeup: 'the close-up you took',
  area_wide: 'the wider photo you took',
  area_closeup: 'the close-up you took',
  early_photo: 'the first photo you sent',
  intake: 'what you told us',
}

function shotPhrase(evidence: readonly string[]): string {
  const phrases = evidence
    .map((key) => CONSULT_FOLLOW_UP_SHOT_PHRASES[key])
    .filter((phrase): phrase is string => Boolean(phrase))
  if (phrases.length === 0) return 'your photos'
  return phrases[0]!
}

function inspirationBlock(
  attributes: ConsultInspirationAnalysisAttributesDTO | null,
): string {
  if (!attributes) {
    return 'The reference picture she chose has not been read (no analysis available). Do not describe it; you have not seen it.'
  }
  const lines = [
    'The reference picture she chose, as a colorist read it (settled — do not re-derive):',
  ]
  for (const field of CONSULT_INSPIRATION_ANALYSIS_FIELDS) {
    const observed = attributes[field as ConsultInspirationAnalysisFieldDTO]
    lines.push(
      observed.value === 'UNKNOWN'
        ? `- ${field}: UNKNOWN (the photograph did not show it — you do not know this and must not refer to it)`
        : `- ${field}: ${observed.value} (confidence ${observed.confidence.min}–${observed.confidence.max})`,
    )
  }
  return lines.join('\n')
}

function coreBlock(core: ConsultAnalysisCore | null): string {
  if (!core) {
    return 'Her own hair has not been read yet (no analysis available). Do not describe it; you have not seen it.'
  }
  const lines = [
    'Her own hair right now, read from the photographs she sent (settled — do not re-derive). Where a reading names a photo, you may refer to that photo the way it is named here:',
  ]
  for (const field of CONSULT_ANALYSIS_CORE_FIELDS) {
    const observed = core[field]
    lines.push(
      observed.value === 'UNKNOWN'
        ? `- ${field}: UNKNOWN (not established — do not lean on it)`
        : `- ${field}: ${observed.value} (confidence ${observed.confidence.min}–${observed.confidence.max}, read from ${shotPhrase(observed.evidence)})`,
    )
  }
  return lines.join('\n')
}

/**
 * `lightestLevel:LEVEL_9` → `how light it gets: light blonde`.
 *
 * 🔴 The CODE never enters this prompt, and that is not tidiness — it is a
 * defect this file already shipped once. The first live run of the follow-up
 * call produced, for a real client to read:
 *
 *   "You loved that cool, pale lightestLevel:LEVEL_9 look…"
 *
 * The model was given the pair and had no reason not to quote it. The fix is
 * three-layered, and this is the first: it is never told a code. The prompt
 * forbids codes explicitly, and `sanitizeConsultFollowUpQuestions` refuses a
 * question that contains one — so a future context that leaks one still cannot
 * put it on her screen.
 */
function inPlainWords(
  pair: string,
  copy: BrandClientConsultInspirationCopy,
): string {
  const separator = pair.indexOf(':')
  if (separator < 0) return pair
  const attribute = pair.slice(0, separator)
  const subject = copy.cards.attributeFallbackNames[attribute]
  const value = copy.cards.attributeShortNames[pair]
  if (!subject && !value) return pair
  if (!value) return subject!
  return subject ? `${subject}: ${value}` : value
}

/**
 * P5g — ONE description of where she is starting from, per plan version.
 *
 * 🔴 Composed here, deterministically, and handed to the model as the phrase to
 * USE rather than as two codes to describe. Left to the model, round 1 said
 * "your current light brown base" and round 2 said "a golden base" about the
 * same head of hair — the same fact, described twice, in two questions she
 * reads minutes apart. It is derived from the plan, so every round of a plan
 * version gets a byte-identical phrase and a new plan version composes a new
 * one from its own reading.
 *
 * Null when the plan settled neither the level nor the tone: there is then
 * nothing honest to call her starting point, and the prompt says so rather than
 * handing the model a half-sentence to finish.
 */
export function consultStartingPointPhrase(
  core: ConsultAnalysisCore | null,
  copy: BrandClientConsultInspirationCopy,
): string | null {
  if (!core) return null
  const { startingPoint } = copy.cards
  const level =
    core.baseLevel.value === 'UNKNOWN'
      ? null
      : (copy.cards.attributeShortNames[`baseLevel:${core.baseLevel.value}`] ?? null)
  const tone =
    core.currentTone.value === 'UNKNOWN'
      ? null
      : (startingPoint.toneNames[core.currentTone.value] ?? null)

  if (level && tone) {
    return startingPoint.withLevelAndTone
      .split('{level}')
      .join(level)
      .split('{tone}')
      .join(tone)
  }
  if (level) return startingPoint.levelOnly.split('{level}').join(level)
  if (tone) return startingPoint.toneOnly.split('{tone}').join(tone)
  return null
}

function startingPointBlock(phrase: string | null): string {
  if (!phrase) {
    return 'Her own starting point could not be described from these photographs. Do not invent a description of it.'
  }
  return [
    `Where she is starting from, in the words to use: "${phrase}".`,
    'When you refer to where she is starting from, use that phrase EXACTLY as written. Do not re-describe it in your own words and do not shorten it — she is asked more than one question about the same head of hair, and two descriptions of it read as two different starting points.',
  ].join(' ')
}

function preferencesBlock(
  preferences: ConsultInspirationClientPreferences | null,
  copy: BrandClientConsultInspirationCopy,
): string {
  if (!preferences) return 'She has not pointed at anything in the reference yet.'
  const plain = (pairs: readonly string[]) =>
    pairs.map((pair) => inPlainWords(pair, copy)).join('; ')
  const lines: string[] = []
  lines.push(
    preferences.wants.length > 0
      ? `Parts of the reference she LOVED: ${plain(preferences.wants)}`
      : 'She has not marked anything in the reference as loved.',
  )
  lines.push(
    preferences.avoids.length > 0
      ? `Parts of the reference she would CHANGE: ${plain(preferences.avoids)}`
      : 'She has not marked anything in the reference as something she would change.',
  )
  if (preferences.unsure.length > 0) {
    lines.push(`She was unsure about: ${plain(preferences.unsure)}`)
  }
  if (preferences.keep.length > 0) {
    lines.push(
      `She asked to LEAVE ALONE, on her own hair: ${preferences.keep.join(', ')}. Never suggest changing these.`,
    )
  }
  return lines.join('\n')
}

function answersBlock(
  intakeAnswers: Readonly<Record<string, string>>,
  followUpAnswers: Readonly<Record<string, readonly string[]>>,
): string {
  const entries = [
    ...Object.entries(intakeAnswers).map(([key, value]) => `- ${key}: ${value}`),
    ...Object.entries(followUpAnswers).map(
      ([key, values]) => `- ${key}: ${values.join(', ')}`,
    ),
  ]
  if (entries.length === 0) {
    return 'She has not answered any questions yet.'
  }
  return [
    'What she has already answered. NEVER ask any of these again:',
    ...entries,
  ].join('\n')
}

function vocabularyBlock(vocabulary: ConsultFollowUpVocabulary): string {
  const lines = [
    'The questions you may ask. Use the key exactly. For each one, the allowed option values are listed with the plain meaning of each — you choose which to offer and how to word them, and you copy the value character for character:',
  ]
  for (const entry of vocabulary.entries) {
    const options = entry.options
      .map((option) => `${option.value} (= ${option.label})`)
      .join('; ')
    lines.push(
      `- ${entry.key}${entry.safety ? ' [SAFETY — ask before anything else]' : ''}: means "${entry.packLabel}". Allowed values: ${options}`,
    )
  }
  return lines.join('\n')
}

export type ConsultFollowUpContextInput = {
  professionalDisplayName: string
  serviceName: string | null
  inspiration: ConsultInspirationAnalysisAttributesDTO | null
  core: ConsultAnalysisCore | null
  preferences: ConsultInspirationClientPreferences | null
  intakeAnswers: Readonly<Record<string, string>>
  followUpAnswers: Readonly<Record<string, readonly string[]>>
  vocabulary: ConsultFollowUpVocabulary
  /** Resolves the reading codes into words a question may actually say. */
  copy: BrandClientConsultInspirationCopy
  /** How many rounds she has already been through, for the closing rule. */
  roundNumber: number
  maxRounds: number
}

/** The whole situation, as one user message. */
export function renderConsultFollowUpContext(
  input: ConsultFollowUpContextInput,
): string {
  return [
    input.serviceName
      ? `She has booked ${input.serviceName} with ${input.professionalDisplayName} and is helping her get ready.`
      : `She has booked with ${input.professionalDisplayName} and is helping her get ready.`,
    '',
    inspirationBlock(input.inspiration),
    '',
    coreBlock(input.core),
    '',
    startingPointBlock(consultStartingPointPhrase(input.core, input.copy)),
    '',
    preferencesBlock(input.preferences, input.copy),
    '',
    answersBlock(input.intakeAnswers, input.followUpAnswers),
    '',
    vocabularyBlock(input.vocabulary),
    '',
    `This is round ${input.roundNumber} of at most ${input.maxRounds}. Ask the questions that would change what her professional does, most important first, and stop there — a question that would not change the plan is a question not worth her tap.`,
  ].join('\n')
}
