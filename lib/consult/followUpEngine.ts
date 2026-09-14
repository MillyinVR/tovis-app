import { CONSULT_CLIENT_LANGUAGE } from './clientLanguage'
// lib/consult/followUpEngine.ts
//
// P5g — the adaptive follow-up call: "what should I ask her next?"
//
// The fifth paid call in the consult, and the only text-only one. It reads what
// is already known — the reference as the vision model read it, the client's
// own photographs as the analysis read them, which regions she loved and which
// she'd change, what she asked to keep, and every answer so far — and returns
// the next one to three questions.
//
// It is the sibling of `inspirationVision.ts` and reuses that file's provider
// boundary wholesale: the same allowlisted model, the same lazy client, the
// same `json_schema` structured output, the same refusal handling, the same
// "sanitize on the server, never trust the provider's own verdict" shape.
//
// ## What the model may and may not decide
//
// 🔴 It picks a KEY from a vocabulary this consult actually has
// (./followUpVocabulary.ts) — a per-run enum, so the grammar itself refuses an
// invented question. It may choose WHICH options to offer and re-word them, and
// every value it offers is checked against that key's real options on the way
// back in; one that is not real refuses the whole round rather than storing a
// question whose answer could never be filed. That is Part 0 rule 11: a
// constraint the grammar cannot hold is stated in the description, re-checked
// on the server, and surfaced as a failure.
//
// 🔴 It writes the TEXT, and that text is the only prose in the consult that a
// model authored and a client reads. So it is fenced twice: the prompt forbids
// saying anything about the person, and `sanitizeConsultFollowUpQuestions`
// re-checks with the same word list the database CHECK carries. A question that
// trips it is REFUSED here, which becomes a fallback — never a 23514 at the
// insert, and never shown.
//
// ## What it is not
//
// Not a chat. It never sees the client's words, because there are none: the
// thread has no free-text input (P5a). Every input below is an enum, a level, a
// confidence range or a pack key.

import Anthropic from '@anthropic-ai/sdk'
import { ConsultProviderCallKind } from '@prisma/client'

import { readOptionalEnv, requireEnv } from '@/lib/env'
import { isRecord } from '@/lib/guards'

import { CONSULT_INSPIRATION_FORBIDDEN_WORDS } from './inspiration/types'
import {
  meterConsultProviderCall,
  type ConsultProviderMeterSink,
} from './providerMeter'
import { isAllowedConsultProviderModel } from './providerModel'
import { toProviderOutputSchema } from './providerSchema'
import type {
  ConsultFollowUpHome,
  ConsultFollowUpVocabulary,
  ConsultFollowUpVocabularyEntry,
} from './followUpVocabulary'

export const CONSULT_FOLLOW_UP_SCHEMA_VERSION = 1
// v1 (2026-09-06) — the first version, shipped in #1101 and never deployed.
// v2 (2026-09-06) — US spelling ("colorist", and a rule saying so: the model
// answered "colour" because the prompt asked in British English), plus the rule
// that the starting-point phrase is USED, not re-described. The text changed,
// so the version does — a stored round names the prompt that wrote it, and a
// version that lied about which words produced a question would make the round
// unreviewable.
export const CONSULT_FOLLOW_UP_PROMPT_VERSION = 'consult-follow-up-v3'

const DEFAULT_MODEL = 'claude-sonnet-5'

/**
 * 20 seconds, and it is short on purpose. This call happens while a client is
 * looking at her thread waiting for the next question; a round that takes
 * longer than that has already failed her, and the fallback — the pack's own
 * remaining safety questions — is a better answer than a spinner.
 */
export const CONSULT_FOLLOW_UP_REQUEST_TIMEOUT_MS = 20_000

/**
 * `max_tokens`. Three questions of at most 300 characters, each with up to six
 * short options and an evidence line, is roughly 450 output tokens; 1,500 is
 * over three times that. Exported so the live contract test sends THE number
 * production sends — a cap the real caller does not have is a test failing on
 * its own fixture.
 */
export const CONSULT_FOLLOW_UP_MAX_TOKENS = 1_500

/** Matches every other consult call — see CONSULT_ANALYSIS_EFFORT. */
export const CONSULT_FOLLOW_UP_EFFORT = 'low' as const

/** The most questions one round may ask. Mirrored by the database CHECK. */
export const CONSULT_FOLLOW_UP_MAX_QUESTIONS = 3
/** The most options one question may offer. Mirrored by the guard trigger. */
export const CONSULT_FOLLOW_UP_MAX_OPTIONS = 6
/** Hard caps on the model's prose, mirrored by the guard trigger. */
export const CONSULT_FOLLOW_UP_MAX_TEXT_LENGTH = 300
export const CONSULT_FOLLOW_UP_MAX_LABEL_LENGTH = 120

export type ConsultFollowUpQuestion = {
  key: string
  home: ConsultFollowUpHome
  text: string
  /**
   * What the model says it saw that made it ask this. Shown to nobody today
   * and stored on the round, because "every recommendation carries a reason
   * tied to evidence actually available" (Part 0 rule 8) has to be auditable
   * before it can be trusted, and a question with no reason is the generic
   * question P5g exists to delete.
   */
  evidence: string
  options: { value: string; label: string }[]
  /**
   * Whether she may answer this card in her OWN WORDS — beside the option she
   * picks, or instead of picking one. Comes from the question's own pack
   * entry, never from the model: the model re-words a question, it does not
   * decide what a client is allowed to say.
   */
  allowText: boolean
}

export type ConsultFollowUpResult = {
  questions: ConsultFollowUpQuestion[]
  model: string
}

export class ConsultFollowUpError extends Error {
  constructor(
    readonly kind: 'unavailable' | 'refused' | 'bad_output' | 'no_vocabulary',
    /**
     * Which check refused, as a content-free name (`options_not_allowed`,
     * `text_length`, …) — for the log line and the meter row, never for the
     * client. The same repair the analysis and inspiration engines already
     * carry: on 2026-09-13 this call was 0-for-1 in production and the only
     * thing recorded was that it had failed. Null for kinds that are not a
     * check.
     */
    readonly check: string | null = null,
  ) {
    super('Follow-up questions are unavailable.')
    this.name = 'ConsultFollowUpError'
  }
}

// ── Structured-output schema ────────────────────────────────────────────────

/**
 * The schema, built per run so the `key` enum is THIS consult's vocabulary.
 *
 * 🔴 Per-run enums are the remedy Part 0 rule 11 names first: reshape so the
 * grammar can hold the constraint. A `key` outside the vocabulary is not a
 * thing this call can return, rather than a thing the sanitizer has to catch.
 *
 * The option VALUE cannot get the same treatment — which values are legal
 * depends on which key the model picks, and a JSON-schema enum cannot depend on
 * a sibling property. So it is a plain string here, stated in the description,
 * and checked exactly against the chosen key's options on the way back in.
 *
 * `maxItems` does not survive the boundary (providerSchema.ts), so the count of
 * questions is stated in the description and enforced by the sanitizer and by
 * the database CHECK.
 */
export function buildConsultFollowUpOutputSchema(
  vocabulary: ConsultFollowUpVocabulary,
): Record<string, unknown> {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['questions'],
    properties: {
      questions: {
        type: 'array',
        maxItems: CONSULT_FOLLOW_UP_MAX_QUESTIONS,
        description: `Between 1 and ${CONSULT_FOLLOW_UP_MAX_QUESTIONS} questions, most important first. Never more than ${CONSULT_FOLLOW_UP_MAX_QUESTIONS}.`,
        items: { $ref: '#/$defs/question' },
      },
    },
    $defs: {
      question: {
        type: 'object',
        additionalProperties: false,
        required: ['key', 'text', 'evidence', 'options'],
        properties: {
          key: {
            type: 'string',
            enum: vocabulary.entries.map((item) => item.key),
            description:
              'Which question you are asking. Only these exist; you cannot invent one.',
          },
          text: {
            type: 'string',
            maxLength: CONSULT_FOLLOW_UP_MAX_TEXT_LENGTH,
            description: `The question in the client's own language, at most ${CONSULT_FOLLOW_UP_MAX_TEXT_LENGTH} characters. One or two short sentences. It must refer to something specific you were told about THIS client.`,
          },
          evidence: {
            type: 'string',
            maxLength: CONSULT_FOLLOW_UP_MAX_TEXT_LENGTH,
            description:
              'What you saw in the information above that made you ask this. Plain words, for a reviewer, not for the client.',
          },
          options: {
            type: 'array',
            maxItems: CONSULT_FOLLOW_UP_MAX_OPTIONS,
            description: `Between 2 and ${CONSULT_FOLLOW_UP_MAX_OPTIONS} answers she can tap.`,
            items: { $ref: '#/$defs/option' },
          },
        },
      },
      option: {
        type: 'object',
        additionalProperties: false,
        required: ['value', 'label'],
        properties: {
          value: {
            type: 'string',
            description:
              'EXACTLY one of the allowed values listed for that question. Copy it character for character. A value that is not on the list throws the whole round away.',
          },
          label: {
            type: 'string',
            maxLength: CONSULT_FOLLOW_UP_MAX_LABEL_LENGTH,
            description:
              'How that answer reads on a button, in her language. It must mean the same thing as the value it is on.',
          },
        },
      },
    },
  }
}

export const CONSULT_FOLLOW_UP_SYSTEM_PROMPT = [
  CONSULT_CLIENT_LANGUAGE,
  'You write the next question in a warm, short beauty consultation. The client tapped a look she liked, booked it, and is now helping her professional get ready.',
  'You are given what a colorist read from her inspiration photograph, what was read from her own photographs, which parts of the reference she loved and which she would change, what she asked to leave alone, and everything she has already answered.',
  'Your job is to choose the next one to three questions from the list you are given, and to word each one so that she can tell you were listening.',
  '',
  'RULES, in order of importance.',
  '1. Never write anything about the PERSON. No identity, ethnicity, race, nationality, religion, gender, age, health, face, skin, eyes, or body. Write about hair, about the service, and about what she told you. A question that mentions any of those is thrown away and she gets a worse experience because of it.',
  '2. Every question must refer to something SPECIFIC you were actually given — a level, a tone, a technique, a region she tapped, an answer she gave. "You are at a light brown now and you loved the ash — that is usually two visits; would coming back in a few weeks work?" is right. "How much maintenance do you want?" is wrong, because it would be the same question for everybody.',
  '3. Never invent a fact. If you were told an attribute is UNKNOWN, you do not know it and must not refer to it. Say only what the information in front of you supports.',
  '4. SAFETY FIRST. If any question in your list is marked SAFETY, ask those before anything else, in the order given, and word them plainly. They are the ones that decide whether the service is safe to do at all.',
  '5. Never promise a result, a price, a duration or a number of visits as a fact. You may say what something USUALLY takes. The professional decides.',
  '6. Use only keys and option values from the list you are given, copied exactly. You choose WHICH options to offer and how to word them; you never invent a value.',
  '7. Write in US English. It is "color", never "colour"; "gray", never "grey".',
  '8. When you refer to where she is starting from, use the exact phrase you are given for it. Do not re-describe it in your own words — she is asked more than one question about the same head of hair.',
  '9. NEVER write a code, a key or a field name in the question or in an option label. Words like baseLevel, lightestLevel, LEVEL_9, currentTone, BABYLIGHTS, change_scale and prior_lightening are internal names; she has never seen them and a question containing one is thrown away. Say "a light blonde", not "LEVEL_9". The evidence field is the one place you may use them, because a reviewer reads it and she does not.',
  '',
  'VOICE. Short. Warm. Second person. No salon jargon unless you explain it in the same breath. Never sound like a form, never sound like a test, and never sound like you are protecting the app from her. One question at a time, the way a person would ask it.',
  'Never speak as the professional or use the professional’s name as if you were them; you are the app, helping her get ready.',
].join('\n')

// ── Sanitization ────────────────────────────────────────────────────────────
// The provider's JSON is a proposal. Everything below is the server deciding
// what it is allowed to have meant.

/**
 * An INTERNAL NAME leaking onto a client's screen.
 *
 * 🔴 Found by running the thing, not by reading it. The first live call
 * produced, for a client to read: "You loved that cool, pale
 * lightestLevel:LEVEL_9 look…" — the model had been handed the pair and had no
 * reason not to quote it. `followUpContext.ts` no longer passes a code and the
 * prompt forbids one; this is the layer that makes it structural, because a
 * future context that leaks one still must not reach her.
 *
 * Three shapes, all of which a model has actually produced or plausibly will:
 *   * a `camelCase:VALUE` pair (`lightestLevel:LEVEL_9`)
 *   * a SHOUTED enum, with or without an underscore — `LEVEL_9` and
 *     `SEAMLESS_MELT` have one, `BABYLIGHTS` and `COOL` do not, and the first
 *     draft of this rule required one and let `BABYLIGHTS` straight through
 *   * a snake_case pack key (`prior_lightening`, `change_scale`)
 *
 * The shouted arm is three characters or more, which covers `LOW` (a real
 * density value) without matching an ordinary capitalised word — "You" has
 * lowercase after its first letter and cannot match.
 *
 * ⚠️ Applied to what she READS — the question and its option labels — and NOT
 * to `evidence`, which is written for a reviewer and is the one place a code
 * belongs. Applying it there would refuse every honest evidence line.
 */
const CONSULT_FOLLOW_UP_INTERNAL_NAME =
  /[a-z][a-zA-Z]*:[A-Z0-9_]{2,}|\b[A-Z][A-Z0-9_]{2,}\b|\b[a-z][a-z0-9]*_[a-z0-9_]+\b/

function assertSafeProse(value: string, clientFacing: boolean): void {
  // 🔴 The same word list the database CHECK carries, applied HERE so a
  // violating round becomes a refusal (and therefore a fallback) rather than a
  // constraint violation at the insert. The database is the backstop; this is
  // the place that fails politely.
  if (CONSULT_INSPIRATION_FORBIDDEN_WORDS.test(value)) {
    throw new ConsultFollowUpError('refused', 'forbidden_words')
  }
  if (clientFacing && CONSULT_FOLLOW_UP_INTERNAL_NAME.test(value)) {
    throw new ConsultFollowUpError('refused', 'internal_name')
  }
}

function sanitizeText(
  raw: unknown,
  max: number,
  clientFacing: boolean,
): string {
  if (typeof raw !== 'string') throw new ConsultFollowUpError('bad_output', 'text_type')
  const text = raw.trim()
  if (text.length === 0 || text.length > max) {
    throw new ConsultFollowUpError('bad_output', text.length === 0 ? 'text_empty' : 'text_length')
  }
  assertSafeProse(text, clientFacing)
  return text
}

function sanitizeOptions(
  raw: unknown,
  vocabularyEntry: ConsultFollowUpVocabularyEntry,
): { value: string; label: string }[] {
  if (
    !Array.isArray(raw) ||
    raw.length < 2 ||
    raw.length > CONSULT_FOLLOW_UP_MAX_OPTIONS
  ) {
    throw new ConsultFollowUpError('bad_output', 'options_count')
  }
  const allowed = new Set(vocabularyEntry.options.map((option) => option.value))
  const options: { value: string; label: string }[] = []
  for (const item of raw) {
    if (!isRecord(item)) throw new ConsultFollowUpError('bad_output', 'option_shape')
    const { value } = item
    // 🔴 The constraint the grammar could not hold. A value that is not one of
    // THIS key's real options is a question whose answer could never be filed,
    // so it fails the round rather than being dropped — dropping it would leave
    // her a question with one button.
    if (typeof value !== 'string' || !allowed.has(value)) {
      throw new ConsultFollowUpError('bad_output', 'options_not_allowed')
    }
    if (options.some((existing) => existing.value === value)) {
      throw new ConsultFollowUpError('bad_output', 'options_duplicate')
    }
    options.push({
      value,
      label: sanitizeText(item.label, CONSULT_FOLLOW_UP_MAX_LABEL_LENGTH, true),
    })
  }
  return options
}

export function sanitizeConsultFollowUpQuestions(
  raw: unknown,
  vocabulary: ConsultFollowUpVocabulary,
): ConsultFollowUpQuestion[] {
  if (!isRecord(raw) || !Array.isArray(raw.questions)) {
    throw new ConsultFollowUpError('bad_output', 'envelope')
  }
  const list = raw.questions
  if (list.length === 0 || list.length > CONSULT_FOLLOW_UP_MAX_QUESTIONS) {
    throw new ConsultFollowUpError('bad_output', 'questions_count')
  }
  const questions: ConsultFollowUpQuestion[] = []
  for (const item of list) {
    if (!isRecord(item) || typeof item.key !== 'string') {
      throw new ConsultFollowUpError('bad_output', 'question_shape')
    }
    const entry = vocabulary.byKey.get(item.key)
    if (!entry) throw new ConsultFollowUpError('bad_output', 'key_not_in_vocabulary')
    if (questions.some((existing) => existing.key === entry.key)) {
      throw new ConsultFollowUpError('bad_output', 'key_duplicate')
    }
    questions.push({
      key: entry.key,
      home: entry.home,
      text: sanitizeText(item.text, CONSULT_FOLLOW_UP_MAX_TEXT_LENGTH, true),
      // Not client-facing: `evidence` is read by a reviewer grading whether
      // the question was earned, and a code is exactly what makes it gradeable.
      evidence: sanitizeText(item.evidence, CONSULT_FOLLOW_UP_MAX_TEXT_LENGTH, false),
      options: sanitizeOptions(item.options, entry),
      // From the VOCABULARY, not from `item`: whatever the model returned
      // about this is not its call.
      allowText: entry.allowText,
    })
  }
  return questions
}

// ── The provider call ───────────────────────────────────────────────────────

let cachedClient: Anthropic | null = null

function modelName(): string {
  const model = readOptionalEnv('AI_CONSULT_FOLLOW_UP_MODEL') ?? DEFAULT_MODEL
  if (!isAllowedConsultProviderModel(model)) {
    // Fail closed, exactly as every other consult call does.
    throw new ConsultFollowUpError('unavailable', 'model_not_allowed')
  }
  return model
}

function getClient(): Anthropic {
  if (!cachedClient) {
    cachedClient = new Anthropic({
      apiKey: requireEnv('ANTHROPIC_API_KEY'),
      // 0, as everywhere else: this call runs inside a request whose budget a
      // retried timeout cannot fit, and its failure has a designed answer.
      maxRetries: 0,
    })
  }
  return cachedClient
}

export function resetConsultFollowUpClientForTests(): void {
  cachedClient = null
}

export type ConsultFollowUpProvider = (input: {
  /** The rendered situation — see `renderConsultFollowUpContext`. */
  context: string
  vocabulary: ConsultFollowUpVocabulary
  meter?: ConsultProviderMeterSink | null
}) => Promise<ConsultFollowUpResult>

export const runConsultFollowUpQuestions: ConsultFollowUpProvider = async (
  input,
) => {
  if (input.vocabulary.entries.length === 0) {
    // Nothing left to ask. Distinct from a failure: there is no fallback for
    // this and no round to write, and the thread simply has no open question.
    throw new ConsultFollowUpError('no_vocabulary')
  }
  const model = modelName()
  return meterConsultProviderCall(
    input.meter,
    { kind: ConsultProviderCallKind.FOLLOW_UP_QUESTIONS, model },
    async (reportUsage) => {
      let message: Anthropic.Message
      try {
        message = await getClient().messages.create(
          {
            model,
            max_tokens: CONSULT_FOLLOW_UP_MAX_TOKENS,
            system: CONSULT_FOLLOW_UP_SYSTEM_PROMPT,
            messages: [{ role: 'user', content: input.context }],
            output_config: {
              effort: CONSULT_FOLLOW_UP_EFFORT,
              format: {
                type: 'json_schema',
                schema: toProviderOutputSchema(
                  buildConsultFollowUpOutputSchema(input.vocabulary),
                ),
              },
            },
          },
          { timeout: CONSULT_FOLLOW_UP_REQUEST_TIMEOUT_MS },
        )
      } catch {
        throw new ConsultFollowUpError('unavailable', 'provider_call')
      }
      // Billed the moment it answered — before the refusal check and the parser.
      reportUsage(message.usage)

      if (message.stop_reason === 'refusal') {
        throw new ConsultFollowUpError('refused', 'stop_refusal')
      }
      // Truncated JSON is this repo's cap being too low, not a provider fault.
      if (message.stop_reason === 'max_tokens') {
        throw new ConsultFollowUpError('bad_output', 'max_tokens')
      }
      const text = message.content
        .filter((block): block is Anthropic.TextBlock => block.type === 'text')
        .map((block) => block.text)
        .join('')
      if (!text) throw new ConsultFollowUpError('bad_output', 'empty_text')

      try {
        return {
          questions: sanitizeConsultFollowUpQuestions(
            JSON.parse(text),
            input.vocabulary,
          ),
          model,
        }
      } catch (error) {
        if (error instanceof ConsultFollowUpError) throw error
        throw new ConsultFollowUpError('bad_output', 'json_parse')
      }
    },
  )
}
