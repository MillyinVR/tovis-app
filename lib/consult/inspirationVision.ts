// lib/consult/inspirationVision.ts
//
// Stage 1 of the consultation pipeline (docs/consult/tovis-ai-consult-handoff.md
// Part 2): read the client's INSPIRATION reference — the picture she brought —
// and return a typed, hair-colour attribute set instead of a static question
// list. This is the file that makes B5 fixable: a light-blonde reference can
// no longer produce a copper question, because the reference is finally read.
//
// It is the sibling of `captureVision.ts` and deliberately reuses that file's
// provider boundary wholesale: the same allowlisted model
// (lib/consult/providerModel.ts), the same lazy client, the same
// `json_schema` structured output, the same refusal handling, the same
// "sanitize on the server, never trust the provider's own verdict" shape.
// What differs is only the question asked and the schema answered.
//
// Two hard rules, both from Part 0:
//   * No empty-attribute success. A result whose every attribute is UNKNOWN is
//     not an answer, it is an unreadable photo — it raises `unreadable`, and
//     the caller surfaces "we couldn't read this one".
//   * No free text. Every field is an enum, a confidence range, an evidence
//     list, and a region box. Nothing the provider writes can carry a
//     description of the person in the photograph.
//
// v2 (P4a) splits `level` into `baseLevel` and `lightestLevel`; see
// lib/consult/hairLevel.ts for why one number per head was never enough, and
// the `$defs` note on the schema below for how the eighth attribute fits.

import Anthropic from '@anthropic-ai/sdk'

import { readOptionalEnv, requireEnv } from '@/lib/env'
import { isRecord } from '@/lib/guards'

import type { ConsultCaptureMediaType } from './captureVision'
import {
  CONSULT_HAIR_LEVELS,
  consultHairLevelPairIsOrdered,
  type ConsultHairLevel,
} from './hairLevel'
import { isAllowedConsultProviderModel } from './providerModel'
import { toProviderOutputSchema } from './providerSchema'

export const CONSULT_INSPIRATION_ANALYSIS_SCHEMA_VERSION = 2
// v1 (2026-09-04, P4): first read of the inspiration reference. Seven
// hair-colour attributes, each an observation plus a normalized region box.
// v2 (2026-09-04, P4a): the level is NAMED, and there are two of them.
// v1 asked for one `level`, prompted as "the depth of the lightest dominant
// colour" — a single answer for a photograph that is very often a shadow root
// at 5 melting into ends at 9, and the half it threw away (where the colour
// STARTS) is exactly the half a colourist needs to plan the service. It also
// could not be compared with the client's own hair, whose reading had a
// different shape again. Both artefacts now report `baseLevel` and
// `lightestLevel` on the one shared scale (lib/consult/hairLevel.ts).
export const CONSULT_INSPIRATION_ANALYSIS_PROMPT_VERSION = 'inspiration-hair-color-v2'

const DEFAULT_MODEL = 'claude-sonnet-5'
/**
 * Exported because the analysis route makes this call AND both analysis calls
 * in one request; the engine's own test does that arithmetic against the
 * route's `maxDuration` so the three cannot drift apart silently.
 */
export const CONSULT_INSPIRATION_REQUEST_TIMEOUT_MS = 50_000
const REQUEST_TIMEOUT_MS = CONSULT_INSPIRATION_REQUEST_TIMEOUT_MS

/**
 * `max_tokens` for the read. Exported so the live contract test sends THE
 * number production sends rather than one typed beside it — a cap the real
 * caller does not have is a test failing on its own fixture.
 *
 * Measured 2026-09-04 against `claude-sonnet-5` on two eval fixtures: 568 and
 * 572 output tokens, no thinking tokens. 2,000 is roughly 3.5x that. A capped
 * answer here is truncated JSON, which reaches the sanitizer as `bad_output`
 * after the call has been billed.
 */
export const CONSULT_INSPIRATION_MAX_TOKENS = 2_000

/** Matches the analysis calls — see CONSULT_ANALYSIS_EFFORT for the numbers. */
export const CONSULT_INSPIRATION_EFFORT = 'low' as const

/**
 * The only evidence label an inspiration run may cite. There is exactly one
 * image in the request, so the list is a list of one — the shape matches
 * `ConsultAnalysisFeatureProfile`'s observations so both artefacts read the
 * same way, and an UNKNOWN still has to cite nothing.
 */
export const CONSULT_INSPIRATION_EVIDENCE_KEYS = ['inspiration'] as const
export type ConsultInspirationEvidence =
  (typeof CONSULT_INSPIRATION_EVIDENCE_KEYS)[number]

// ── The attribute vocabulary ────────────────────────────────────────────────
// Hair colour only, per Part 3's first row: the two levels, tone, technique,
// placement, root blend, finish, dimension. Every enum carries an honest
// UNKNOWN; none carries identity, ethnicity, age or medical meaning.

export const CONSULT_INSPIRATION_TONES = ['WARM', 'COOL', 'NEUTRAL', 'UNKNOWN'] as const
export const CONSULT_INSPIRATION_TECHNIQUES = [
  'SINGLE_PROCESS',
  'BALAYAGE',
  'FOIL_HIGHLIGHTS',
  'BABYLIGHTS',
  'LOWLIGHTS',
  'COLOR_MELT',
  'GLOSS_ONLY',
  'DOUBLE_PROCESS',
  'NATURAL_UNCOLORED',
  'UNKNOWN',
] as const
export const CONSULT_INSPIRATION_PLACEMENTS = [
  'ALL_OVER',
  'FACE_FRAMING',
  'MIDS_TO_ENDS',
  'ENDS_ONLY',
  'SURFACE_ONLY',
  'UNDERNEATH',
  'PANELS',
  'UNKNOWN',
] as const
export const CONSULT_INSPIRATION_ROOT_BLENDS = [
  'SOLID_TO_ROOT',
  'SHADOW_ROOT',
  'SEAMLESS_MELT',
  'GROWN_OUT',
  'UNKNOWN',
] as const
export const CONSULT_INSPIRATION_FINISHES = [
  'HIGH_SHINE',
  'SATIN',
  'MATTE',
  'UNKNOWN',
] as const
export const CONSULT_INSPIRATION_DIMENSIONS = [
  'FLAT',
  'SUBTLE',
  'MEDIUM',
  'HIGH_CONTRAST',
  'UNKNOWN',
] as const

export const CONSULT_INSPIRATION_ANALYSIS_FIELDS = [
  'baseLevel',
  'lightestLevel',
  'tone',
  'technique',
  'placement',
  'rootBlend',
  'finish',
  'dimension',
] as const
export type ConsultInspirationAnalysisField =
  (typeof CONSULT_INSPIRATION_ANALYSIS_FIELDS)[number]

export const CONSULT_INSPIRATION_FIELD_VALUES: Readonly<
  Record<ConsultInspirationAnalysisField, readonly string[]>
> = {
  baseLevel: CONSULT_HAIR_LEVELS,
  lightestLevel: CONSULT_HAIR_LEVELS,
  tone: CONSULT_INSPIRATION_TONES,
  technique: CONSULT_INSPIRATION_TECHNIQUES,
  placement: CONSULT_INSPIRATION_PLACEMENTS,
  rootBlend: CONSULT_INSPIRATION_ROOT_BLENDS,
  finish: CONSULT_INSPIRATION_FINISHES,
  dimension: CONSULT_INSPIRATION_DIMENSIONS,
}

/**
 * Where on the reference the attribute is most visible, normalized to the
 * image: `x`/`y` are the top-left corner, `w`/`h` the size, all in 0..1.
 *
 * Nothing consumes it yet (Tori, 2026-09-04) — P5 will, to show the client
 * WHICH part of her reference an attribute came from. It is captured now
 * because it is free at read time and impossible to backfill: the raw
 * inspiration object is purge-fenced, so a later pass would have no image to
 * measure.
 */
export type ConsultInspirationRegion = {
  x: number
  y: number
  w: number
  h: number
}

export type ConsultInspirationObservation<T extends string> = {
  value: T
  confidence: { min: number; max: number }
  evidence: ConsultInspirationEvidence[]
  /** Null exactly when the value is UNKNOWN — there is no region for a non-reading. */
  region: ConsultInspirationRegion | null
}

export type ConsultInspirationAnalysis = {
  baseLevel: ConsultInspirationObservation<ConsultHairLevel>
  lightestLevel: ConsultInspirationObservation<ConsultHairLevel>
  tone: ConsultInspirationObservation<(typeof CONSULT_INSPIRATION_TONES)[number]>
  technique: ConsultInspirationObservation<
    (typeof CONSULT_INSPIRATION_TECHNIQUES)[number]
  >
  placement: ConsultInspirationObservation<
    (typeof CONSULT_INSPIRATION_PLACEMENTS)[number]
  >
  rootBlend: ConsultInspirationObservation<
    (typeof CONSULT_INSPIRATION_ROOT_BLENDS)[number]
  >
  finish: ConsultInspirationObservation<(typeof CONSULT_INSPIRATION_FINISHES)[number]>
  dimension: ConsultInspirationObservation<
    (typeof CONSULT_INSPIRATION_DIMENSIONS)[number]
  >
}

export type ConsultInspirationAnalysisResult = {
  analysis: ConsultInspirationAnalysis
  model: string
}

export class ConsultInspirationVisionError extends Error {
  constructor(
    readonly kind: 'unavailable' | 'refused' | 'bad_output' | 'unreadable',
  ) {
    super('Inspiration analysis is unavailable.')
    this.name = 'ConsultInspirationVisionError'
  }
}

// ── Structured-output schema ────────────────────────────────────────────────

/**
 * 🔴 The `description` carries the SCALE, because `minimum`/`maximum` do not
 * survive the boundary — the API refuses them on a number, so a bare
 * `{type: 'number'}` tells the model nothing. Measured on the sibling analysis
 * schema on 2026-09-04, the model with no stated range answered on a 0-to-10
 * one and every observation was refused. See lib/consult/providerSchema.ts.
 */
const CONFIDENCE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['min', 'max'],
  description:
    'How sure you are, as a range on a 0-to-1 scale: 0 is no confidence and 1 is certainty. Both values are decimals between 0 and 1 — never a percentage, never a 0-to-10 or 0-to-100 scale. `min` must be strictly LESS than `max`; a single point value is not a range and will be rejected.',
  properties: {
    min: {
      type: 'number',
      minimum: 0,
      maximum: 1,
      description: 'The low end, a decimal from 0 to 1. Strictly less than max.',
    },
    max: {
      type: 'number',
      minimum: 0,
      maximum: 1,
      description: 'The high end, a decimal from 0 to 1. Strictly greater than min.',
    },
  },
}

/**
 * A normalized 0..1 decimal, at most four places: `0`, `0.5`, `0.1234`, `1`.
 * Written out rather than assembled from a fragment so the pattern the
 * provider is sent and the pattern this file parses are the same characters.
 */
const NORMALIZED = '(0(\\.[0-9]{1,4})?|1(\\.0{1,4})?)'
export const CONSULT_INSPIRATION_REGION_PATTERN = `^${NORMALIZED},${NORMALIZED},${NORMALIZED},${NORMALIZED}$`

/**
 * 🔴 The region is carried on the wire as the STRING "x,y,w,h", not as an
 * object, and this is not a style choice.
 *
 * The structured-output grammar has a compiled-size budget, and seven
 * repetitions of a nullable four-number object exceed it:
 *
 *   400 invalid_request_error
 *   The compiled grammar is too large, which would cause performance issues.
 *
 * Measured on 2026-09-04 against `claude-sonnet-5`: five repetitions compile,
 * seven do not, whether the object is nullable or not, and a four-number array
 * fails the same way. A nullable pattern-constrained string compiles fine at
 * seven and keeps the same two states (a box, or null for UNKNOWN).
 *
 * The STORED artefact still holds a real `{x, y, w, h}` object — `region()`
 * parses this string the moment it arrives, so the encoding never escapes
 * this file.
 */
const REGION_SCHEMA = {
  type: ['string', 'null'],
  pattern: CONSULT_INSPIRATION_REGION_PATTERN,
  description:
    'The region as "x,y,w,h" — four decimals between 0 and 1, comma-separated, no spaces. Null when the value is UNKNOWN.',
}

/**
 * 🔴 The three parts every attribute shares are hoisted into `$defs` and
 * referenced, not repeated inline.
 *
 * This is the same size budget the region string already works around, applied
 * where it buys the most: measured on 2026-09-04, an inline observation costs
 * about eight times what a `$ref` to the same shape costs at each extra site.
 * v1's seven inline copies fit with nothing to spare; v2 has EIGHT attributes,
 * and inline it would not have. See lib/consult/providerSchema.ts and the
 * schema notes in lib/consult/analysisEngine.ts for the full measurements.
 */
const CONFIDENCE_REF = { $ref: '#/$defs/confidence' }
const EVIDENCE_REF = { $ref: '#/$defs/evidence' }
const REGION_REF = { $ref: '#/$defs/region' }

const EVIDENCE_SCHEMA = {
  type: 'array',
  maxItems: CONSULT_INSPIRATION_EVIDENCE_KEYS.length,
  uniqueItems: true,
  items: { type: 'string', enum: [...CONSULT_INSPIRATION_EVIDENCE_KEYS] },
}

function observationSchema(values: readonly string[]) {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['value', 'confidence', 'evidence', 'region'],
    properties: {
      value: { type: 'string', enum: [...values] },
      confidence: CONFIDENCE_REF,
      evidence: EVIDENCE_REF,
      region: REGION_REF,
    },
  }
}

export const CONSULT_INSPIRATION_ANALYSIS_OUTPUT_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: [...CONSULT_INSPIRATION_ANALYSIS_FIELDS],
  properties: Object.fromEntries(
    CONSULT_INSPIRATION_ANALYSIS_FIELDS.map((field) => [
      field,
      observationSchema(CONSULT_INSPIRATION_FIELD_VALUES[field]),
    ]),
  ),
  $defs: {
    confidence: CONFIDENCE_SCHEMA,
    evidence: EVIDENCE_SCHEMA,
    region: REGION_SCHEMA,
  },
}

export const CONSULT_INSPIRATION_ANALYSIS_SYSTEM_PROMPT = [
  'You are a salon colourist reading ONE inspiration photograph for a beauty consultation.',
  'Your only job is to describe the HAIR COLOUR in the picture, as a colourist would write it on a service ticket.',
  'Never describe, infer, or mention anything about the person in the photograph: no identity, ethnicity, race, nationality, religion, gender, age, health, face, skin, or body. If the picture contains a person, read their hair and nothing else.',
  'Answer only with the structured fields you are given. There is no free-text field and you must not attempt to add one.',
  'Every field is an observation with four parts: value, a confidence range, an evidence list, and a region.',
  'Every confidence range is TWO DECIMALS BETWEEN 0 AND 1 — for example {"min": 0.4, "max": 0.65}. Not a percentage, not a score out of 10. The minimum must be strictly less than the maximum.',
  'Use UNKNOWN whenever the photograph does not actually show you the answer — a back-of-head shot cannot tell you the root blend, a black-and-white or heavily filtered image cannot tell you the tone. UNKNOWN must carry an empty evidence list, a confidence range whose max is at most 0.35, and a null region. Guessing is worse than UNKNOWN.',
  'A value that is NOT UNKNOWN must cite the evidence label "inspiration", carry a confidence range rather than a certainty, and carry a region.',
  'The region is a normalized bounding box on this image where the attribute is most visible, written as the string "x,y,w,h": x and y are the top-left corner, w and h the width and height, each a decimal between 0 and 1 with at most four places, comma-separated with no spaces, and with x + w and y + h no greater than 1. For example "0.28,0.05,0.44,0.2". Point it at the part of the hair you actually read the attribute from — the root area for root blend and for baseLevel, a mid-length section for dimension, the ends for finish, and the lightest visible pieces for lightestLevel.',
  'Field meanings:',
  'baseLevel — the depth the colour STARTS from: the darkest dominant colour on the head, which is normally what you see at the root. On the salon scale, 1 is black and 10 is the lightest blonde.',
  'lightestLevel — the LIGHTEST dominant colour anywhere on the head, on the same 1 to 10 scale. This is normally the ends, the brightest highlighted pieces, or the money piece.',
  'These two are separate readings, not a range. A solid single-process colour has the SAME value in both, and reporting them equal is the right answer, not a failure to decide. Balayage, highlights, a shadow root and a grown-out colour are where they differ. Never report a baseLevel LIGHTER than the lightestLevel. How sure you are goes in each field’s confidence range and nowhere else — do not widen the gap between the two levels to express doubt.',
  'tone — whether the colour reads WARM (gold, copper, red), COOL (ash, smoky, violet) or NEUTRAL.',
  'technique — how the colour looks like it was placed: SINGLE_PROCESS, BALAYAGE, FOIL_HIGHLIGHTS, BABYLIGHTS, LOWLIGHTS, COLOR_MELT, DOUBLE_PROCESS, GLOSS_ONLY, or NATURAL_UNCOLORED when it does not look coloured at all.',
  'placement — where the lightness or depth sits: ALL_OVER, FACE_FRAMING, MIDS_TO_ENDS, ENDS_ONLY, SURFACE_ONLY, UNDERNEATH or PANELS.',
  'rootBlend — how the colour meets the root: SOLID_TO_ROOT, SHADOW_ROOT, SEAMLESS_MELT or GROWN_OUT.',
  'finish — how the surface reflects: HIGH_SHINE, SATIN or MATTE.',
  'dimension — how much contrast there is between the lightest and darkest pieces: FLAT, SUBTLE, MEDIUM or HIGH_CONTRAST.',
  'Photographs lie about colour: studio light, filters and screens shift tone and level. Widen your confidence ranges accordingly and never report certainty.',
].join(' ')

const USER_INSTRUCTION =
  'This is the client’s inspiration reference. Read its hair colour into the eight fields. Use UNKNOWN wherever this photograph does not show you the answer.'

// ── Sanitization ────────────────────────────────────────────────────────────
// The provider's JSON is a proposal. Everything below is the server deciding
// what it is allowed to have meant.

function round4(value: number): number {
  return Math.round(value * 10_000) / 10_000
}

/** The smallest box worth storing: below this it points at nothing usable. */
const MIN_REGION_SIDE = 0.01

/** One rounding step at four decimal places. */
const ROUNDING_TOLERANCE = 0.0002

/**
 * `side`, clamped to `available` when it exceeds it only by rounding; null
 * when it exceeds it by more than that (the caller refuses the whole result).
 */
function absorbRounding(side: number, available: number): number | null {
  if (side <= available) return side
  return side - available <= ROUNDING_TOLERANCE ? available : null
}

/** "x,y,w,h" → the stored object. Null and absent both mean "no region". */
function region(raw: unknown): ConsultInspirationRegion | null {
  if (raw === null || raw === undefined) return null
  if (typeof raw !== 'string' || !new RegExp(CONSULT_INSPIRATION_REGION_PATTERN).test(raw)) {
    throw new ConsultInspirationVisionError('bad_output')
  }
  const parts = raw.split(',').map(Number)
  if (parts.length !== 4 || parts.some((value) => !Number.isFinite(value))) {
    throw new ConsultInspirationVisionError('bad_output')
  }
  const [rawX, rawY, rawW, rawH] = parts as [number, number, number, number]
  const x = round4(rawX)
  const y = round4(rawY)
  // A box that already touched the edge can come back a ten-thousandth over
  // once each side is rounded. That is a rounding artefact and is absorbed.
  // A box that overflows by MORE than that is a wrong box, and silently
  // shrinking it would store a region that points somewhere the model did not
  // mean — so it is refused, like any other unusable output.
  const w = absorbRounding(round4(rawW), round4(1 - x))
  const h = absorbRounding(round4(rawH), round4(1 - y))
  if (w === null || h === null || w < MIN_REGION_SIDE || h < MIN_REGION_SIDE) {
    throw new ConsultInspirationVisionError('bad_output')
  }
  return { x, y, w, h }
}

function confidence(raw: unknown): { min: number; max: number } {
  if (!isRecord(raw) || Object.keys(raw).sort().join(',') !== 'max,min') {
    throw new ConsultInspirationVisionError('bad_output')
  }
  const { min, max } = raw
  if (
    typeof min !== 'number' ||
    typeof max !== 'number' ||
    !Number.isFinite(min) ||
    !Number.isFinite(max) ||
    min < 0 ||
    max > 1 ||
    min >= max
  ) {
    throw new ConsultInspirationVisionError('bad_output')
  }
  return { min: round4(min), max: round4(max) }
}

function evidence(raw: unknown): ConsultInspirationEvidence[] {
  if (!Array.isArray(raw) || raw.length > CONSULT_INSPIRATION_EVIDENCE_KEYS.length) {
    throw new ConsultInspirationVisionError('bad_output')
  }
  const cited: ConsultInspirationEvidence[] = []
  for (const item of raw) {
    const key = CONSULT_INSPIRATION_EVIDENCE_KEYS.find(
      (candidate) => candidate === item,
    )
    if (!key || cited.includes(key)) {
      throw new ConsultInspirationVisionError('bad_output')
    }
    cited.push(key)
  }
  return cited
}

function observation<const T extends readonly string[]>(
  raw: unknown,
  values: T,
): ConsultInspirationObservation<T[number]> {
  if (
    !isRecord(raw) ||
    Object.keys(raw).sort().join(',') !== 'confidence,evidence,region,value'
  ) {
    throw new ConsultInspirationVisionError('bad_output')
  }
  const value = values.find((candidate) => candidate === raw.value)
  if (!value) throw new ConsultInspirationVisionError('bad_output')
  const range = confidence(raw.confidence)
  const cited = evidence(raw.evidence)
  const box = region(raw.region)
  // An UNKNOWN that cites evidence, claims confidence, or points at a region is
  // a contradiction; a reading that cites nothing or points nowhere is an
  // unsupported claim. Both fail the whole result rather than shipping.
  if (value === 'UNKNOWN') {
    if (cited.length > 0 || range.max > 0.35 || box) {
      throw new ConsultInspirationVisionError('bad_output')
    }
  } else if (cited.length === 0 || !box) {
    throw new ConsultInspirationVisionError('bad_output')
  }
  return { value, confidence: range, evidence: cited, region: box }
}

/**
 * The provider's raw JSON → the stored artefact.
 *
 * Exported because the integration tests stand a fake provider in front of the
 * network and must run its payload through THE policy, not a second copy of
 * it — the same reason `sanitizeConsultCaptureQuality` is exported.
 */
export function sanitizeConsultInspirationAnalysis(
  raw: unknown,
): ConsultInspirationAnalysis {
  if (
    !isRecord(raw) ||
    Object.keys(raw).sort().join(',') !==
      [...CONSULT_INSPIRATION_ANALYSIS_FIELDS].sort().join(',')
  ) {
    throw new ConsultInspirationVisionError('bad_output')
  }
  const analysis = Object.fromEntries(
    CONSULT_INSPIRATION_ANALYSIS_FIELDS.map((field) => [
      field,
      observation(raw[field], CONSULT_INSPIRATION_FIELD_VALUES[field]),
    ]),
  ) as ConsultInspirationAnalysis
  // The one relationship the level scale forbids. Either being UNKNOWN is
  // simply unobserved and passes; a base LIGHTER than the lightest is a read
  // that cannot be true of any head of hair, so it fails the whole result
  // rather than being quietly swapped into order.
  if (
    !consultHairLevelPairIsOrdered(
      analysis.baseLevel.value,
      analysis.lightestLevel.value,
    )
  ) {
    throw new ConsultInspirationVisionError('bad_output')
  }
  // Part 0 rule 4, and Stage 1's failure state: a result whose every attribute
  // is UNKNOWN is not a low-confidence answer, it is an unreadable photograph.
  // Shipping it would be an empty-attribute success — the exact silent
  // fallback the pipeline is forbidden.
  if (countKnownConsultInspirationAttributes(analysis) === 0) {
    throw new ConsultInspirationVisionError('unreadable')
  }
  return analysis
}

/** How many of the seven attributes the reference actually answered. */
export function countKnownConsultInspirationAttributes(
  analysis: ConsultInspirationAnalysis,
): number {
  return CONSULT_INSPIRATION_ANALYSIS_FIELDS.filter(
    (field) => analysis[field].value !== 'UNKNOWN',
  ).length
}

// ── The provider call ───────────────────────────────────────────────────────

let cachedClient: Anthropic | null = null

function modelName(): string {
  const model = readOptionalEnv('AI_CONSULT_INSPIRATION_MODEL') ?? DEFAULT_MODEL
  if (!isAllowedConsultProviderModel(model)) {
    // Fail closed, exactly as the capture gate does: a client's inspiration
    // photo never goes to a model the repo has not explicitly allowlisted
    // (lib/consult/providerModel.ts).
    throw new ConsultInspirationVisionError('unavailable')
  }
  return model
}

function getClient(): Anthropic {
  if (!cachedClient) {
    cachedClient = new Anthropic({
      apiKey: requireEnv('ANTHROPIC_API_KEY'),
      // 0 for the same reason as the analysis engine: this read happens inside
      // the analysis request, whose budget a retried timeout cannot fit.
      maxRetries: 0,
    })
  }
  return cachedClient
}

export function resetConsultInspirationVisionClientForTests(): void {
  cachedClient = null
}

export type ConsultInspirationVisionProvider = (input: {
  image: { base64: string; mediaType: ConsultCaptureMediaType }
}) => Promise<ConsultInspirationAnalysisResult>

export const runConsultInspirationVision: ConsultInspirationVisionProvider =
  async (input) => {
    const model = modelName()
    let message: Anthropic.Message
    try {
      message = await getClient().messages.create(
        {
          model,
          max_tokens: CONSULT_INSPIRATION_MAX_TOKENS,
          system: CONSULT_INSPIRATION_ANALYSIS_SYSTEM_PROMPT,
          messages: [
            {
              role: 'user',
              content: [
                {
                  type: 'image',
                  source: {
                    type: 'base64',
                    media_type: input.image.mediaType,
                    data: input.image.base64,
                  },
                },
                { type: 'text', text: USER_INSTRUCTION },
              ],
            },
          ],
          output_config: {
            // Measured on the sibling analysis calls (see
            // CONSULT_ANALYSIS_EFFORT): at the default the answer is mostly
            // thinking, and the thinking is what overruns the cap and the
            // request budget. This read is a bounded extraction — 568 output
            // tokens, no thinking, 5.9s at this level.
            effort: CONSULT_INSPIRATION_EFFORT,
            format: {
              type: 'json_schema',
              // The API rejects several of the bounds this schema states
              // (lib/consult/providerSchema.ts). Every one of them is
              // re-checked on the way back in by
              // `sanitizeConsultInspirationAnalysis`, so nothing is lost.
              schema: toProviderOutputSchema(
                CONSULT_INSPIRATION_ANALYSIS_OUTPUT_SCHEMA,
              ),
            },
          },
        },
        { timeout: REQUEST_TIMEOUT_MS },
      )
    } catch {
      throw new ConsultInspirationVisionError('unavailable')
    }

    if (message.stop_reason === 'refusal') {
      throw new ConsultInspirationVisionError('refused')
    }
    // Truncated JSON is this repo's cap being too low, not a provider fault.
    // Named here so it cannot arrive at the parser as unexplained garbage —
    // the same trap the analysis engine's direction call actually fell into.
    if (message.stop_reason === 'max_tokens') {
      throw new ConsultInspirationVisionError('bad_output')
    }
    const text = message.content
      .filter((block): block is Anthropic.TextBlock => block.type === 'text')
      .map((block) => block.text)
      .join('')
    if (!text) throw new ConsultInspirationVisionError('bad_output')

    try {
      return { analysis: sanitizeConsultInspirationAnalysis(JSON.parse(text)), model }
    } catch (error) {
      if (error instanceof ConsultInspirationVisionError) throw error
      throw new ConsultInspirationVisionError('bad_output')
    }
  }

/**
 * The artefact as it is STORED and as the analysis prompt reads it back.
 * Exported here (rather than in the contract) so the payload shape and the
 * sanitizer that produces it live in one file.
 */
/** The stored JSON shape of one observation — plain JSON, no class instances. */
export type ConsultInspirationObservationJson = {
  value: string
  confidence: { min: number; max: number }
  evidence: string[]
  region: { x: number; y: number; w: number; h: number } | null
}

export function toConsultInspirationAnalysisJson(
  analysis: ConsultInspirationAnalysis,
): Record<string, ConsultInspirationObservationJson> {
  return Object.fromEntries(
    CONSULT_INSPIRATION_ANALYSIS_FIELDS.map((field) => {
      const observed = analysis[field]
      return [
        field,
        {
          value: observed.value,
          confidence: { ...observed.confidence },
          evidence: [...observed.evidence],
          region: observed.region ? { ...observed.region } : null,
        },
      ]
    }),
  )
}
