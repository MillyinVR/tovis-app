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
import { ConsultProviderCallKind } from '@prisma/client'

import { readOptionalEnv, requireEnv } from '@/lib/env'
import { isRecord } from '@/lib/guards'

import type { ConsultCaptureMediaType } from './captureVision'
import {
  CONSULT_HAIR_LEVELS,
  consultHairLevelPairIsOrdered,
  consultHairLevelScalePromptText,
  type ConsultHairLevel,
} from './hairLevel'
import {
  meterConsultProviderCall,
  type ConsultProviderMeterSink,
} from './providerMeter'
import { isAllowedConsultProviderModel } from './providerModel'
import { toProviderOutputSchema } from './providerSchema'

export const CONSULT_INSPIRATION_ANALYSIS_SCHEMA_VERSION = 4
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
// v3 (2026-09-05, P5b): the ENVELOPE changes, not the reading. The artefact
// dropped `inspirationRevisionId` and is identified by the inspiration ROW it
// read. See the identity note in lib/consult/inspirationAnalysisContract.ts:
// the read now happens before the client has answered anything, so there is no
// review revision to pin to, and pinning to one made the analysis pay to read
// the same photograph a second time.
//
// Prompt v3 locates the hair/head before reading attributes. Older cached
// readings must be refreshed because they did not validate crop localization.
// v4 (2026-09-11, C2-6b): the reading gains `credibilityFlags` — what the
// reader noticed about the PHOTOGRAPH (a filter, an AI-looking image, added
// hair, studio light, styling that hides the cut, one angle). Prompt v4 asks
// for them and says, in as many words, that a flag is a note and not a
// refusal: the eight attributes are still read. A v3 row is still READ by
// `normalizeStoredConsultInspirationAnalysis` with flags `[]` — a bare bump
// would have made every stored reading NULL for the pro, the cards and the
// top line in the migrate-before-deploy window. The request hash includes
// both versions, so the next read of a v3-read photograph pays once for v4.
//
// v5 (2026-09-13): the ten rungs of the salon depth scale are named
// (lib/consult/hairLevel.ts), instead of only "1 is black and 10 is the
// lightest blonde". PROSE ONLY — the stored shape, the schema version and what
// a reading MEANS are all unchanged, which is why v4 stays readable rather
// than being rolled off.
export const CONSULT_INSPIRATION_ANALYSIS_PROMPT_VERSION = 'inspiration-hair-color-v5'

/**
 * The versions a STORED artefact may carry and still be read back, newest
 * first. The current pair is what the write side produces; the previous pair
 * is what production has already stored and what the still-deployed code
 * writes for the length of a deploy build. The readers that select by
 * version (lib/consult/inspirationContract.ts) and the normalizer that
 * validates a row (lib/consult/inspirationAnalysisRead.ts) both take their
 * list from here, so they cannot disagree about what is readable.
 */
export const CONSULT_INSPIRATION_ANALYSIS_READABLE_VERSIONS: ReadonlyArray<{
  schemaVersion: number
  promptVersion: string
}> = [
  {
    schemaVersion: CONSULT_INSPIRATION_ANALYSIS_SCHEMA_VERSION,
    promptVersion: CONSULT_INSPIRATION_ANALYSIS_PROMPT_VERSION,
  },
  // v5 is a PROSE-ONLY bump (the depth scale), so a v4 reading means exactly
  // what a v5 one does and stays readable. v3 is kept for the same reason it
  // was kept at the v4 bump: rolling it off would blank the reference reading
  // of a real consult that is still in the database.
  { schemaVersion: 4, promptVersion: 'inspiration-hair-color-v4' },
  { schemaVersion: 3, promptVersion: 'inspiration-hair-color-v3' },
]

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

export {
  CONSULT_INSPIRATION_TONES,
  CONSULT_INSPIRATION_TECHNIQUES,
  CONSULT_INSPIRATION_PLACEMENTS,
  CONSULT_INSPIRATION_ROOT_BLENDS,
  CONSULT_INSPIRATION_FINISHES,
  CONSULT_INSPIRATION_DIMENSIONS,
  CONSULT_INSPIRATION_ANALYSIS_FIELDS,
  CONSULT_INSPIRATION_FIELD_VALUES,
  CONSULT_INSPIRATION_CREDIBILITY_FLAGS,
  type ConsultInspirationAnalysisField,
  type ConsultInspirationCredibilityFlag,
} from './inspirationAttributes'
import {
  CONSULT_INSPIRATION_ANALYSIS_FIELDS,
  CONSULT_INSPIRATION_CREDIBILITY_FLAGS,
  CONSULT_INSPIRATION_DIMENSIONS,
  CONSULT_INSPIRATION_FIELD_VALUES,
  CONSULT_INSPIRATION_FINISHES,
  CONSULT_INSPIRATION_PLACEMENTS,
  CONSULT_INSPIRATION_ROOT_BLENDS,
  CONSULT_INSPIRATION_TECHNIQUES,
  CONSULT_INSPIRATION_TONES,
  type ConsultInspirationAnalysisField,
  type ConsultInspirationCredibilityFlag,
} from './inspirationAttributes'

/**
 * Where on the reference the attribute is most visible, normalized to the
 * image: `x`/`y` are the top-left corner, `w`/`h` the size, all in 0..1.
 *
 * P5d consumes it: an inspiration CARD is a crop of this box, and the client
 * sees which part of her own reference an attribute came from before she is
 * told a word for it. It was captured a slice early because it is free at read
 * time and impossible to backfill — the raw inspiration object is purge-fenced,
 * so a later pass would have no image left to measure.
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
  /** C2-6b — empty when the reader noticed nothing about the photograph. */
  credibilityFlags: ConsultInspirationCredibilityFlag[]
  model: string
}

export class ConsultInspirationVisionError extends Error {
  constructor(
    readonly kind: 'unavailable' | 'refused' | 'bad_output' | 'unreadable',
    /**
     * Which check refused, as a content-free name (`region_containment`,
     * `confidence`, …) — for the log line, never for the client. Until
     * 2026-09-11 a `bad_output` said only that SOMETHING was refused, and the
     * one that took "Build my plan" down in prod needed a paid reproduction
     * to name. Null for kinds that are not a check.
     */
    readonly stage: string | null = null,
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

/**
 * C2-6b — the credibility flags, as the grammar can hold them: an array of an
 * enum, `required`, and nothing more. `uniqueItems` and `maxItems` are
 * stripped at the boundary (lib/consult/providerSchema.ts), so a duplicate or
 * an unknown value is the SANITIZER's problem, not the grammar's — see
 * `sanitizeConsultInspirationCredibilityFlags`. Costs 3 units, once.
 */
const CREDIBILITY_FLAGS_SCHEMA = {
  type: 'array',
  uniqueItems: true,
  maxItems: CONSULT_INSPIRATION_CREDIBILITY_FLAGS.length,
  description:
    'Anything about the PHOTOGRAPH itself (not the hair) that a colourist should know before trusting it. Empty when nothing applies. Each value at most once.',
  items: { type: 'string', enum: [...CONSULT_INSPIRATION_CREDIBILITY_FLAGS] },
}

export const CONSULT_INSPIRATION_ANALYSIS_OUTPUT_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: ['hairRegion', ...CONSULT_INSPIRATION_ANALYSIS_FIELDS, 'credibilityFlags'],
  properties: { hairRegion: REGION_REF, ...Object.fromEntries(
    CONSULT_INSPIRATION_ANALYSIS_FIELDS.map((field) => [
      field,
      observationSchema(CONSULT_INSPIRATION_FIELD_VALUES[field]),
    ]),
  ), credibilityFlags: CREDIBILITY_FLAGS_SCHEMA },
  $defs: {
    confidence: CONFIDENCE_SCHEMA,
    evidence: EVIDENCE_SCHEMA,
    region: REGION_SCHEMA,
  },
}

export const CONSULT_INSPIRATION_ANALYSIS_SYSTEM_PROMPT = [
  'You are a salon colourist reading ONE inspiration photograph for a beauty consultation.',
  'Your only job is to describe the HAIR COLOUR in the picture, as a colourist would write it on a service ticket.',
  'First localize the intended head and its visible hair. Use the face or head silhouette only as a spatial anchor, never as a source of personal traits. In a mirror selfie, use the reflected head and hair in the displayed image coordinates; do not flip or invert coordinates. A phone may cover the face.',
  'Return hairRegion as a tight normalized x,y,w,h box containing the visible hair of that one subject. Clothing, sweatpants, sleeves, skin, phone, mirror frame and background are NEVER hair color evidence, even if their color is similar. A tight hair-only reference is valid; a visible face is not required. If you cannot confidently locate the visible hair of one intended subject, hairRegion must be null and every attribute UNKNOWN.',
  'Every non-null attribute region must lie entirely inside hairRegion and visibly show HAIR for that attribute. Do not center a crop on clothing or copy colors from garments. Check every crop against the head/hair location before returning it.',
  'Never describe, infer, or mention anything about the person in the photograph: no identity, ethnicity, race, nationality, religion, gender, age, health, face, skin, or body. If the picture contains a person, read their hair and nothing else.',
  'Answer only with the structured fields you are given. There is no free-text field and you must not attempt to add one.',
  'Every field is an observation with four parts: value, a confidence range, an evidence list, and a region.',
  'Every confidence range is TWO DECIMALS BETWEEN 0 AND 1 — for example {"min": 0.4, "max": 0.65}. Not a percentage, not a score out of 10. The minimum must be strictly less than the maximum.',
  'Use UNKNOWN whenever the photograph does not actually show you the answer — a back-of-head shot cannot tell you the root blend, a black-and-white or heavily filtered image cannot tell you the tone. UNKNOWN must carry an empty evidence list, a confidence range whose max is at most 0.35, and a null region. Guessing is worse than UNKNOWN. A credibility flag on its own is never a reason for UNKNOWN: if the hair still shows you the answer, read it, and widen the confidence range instead.',
  'A value that is NOT UNKNOWN must cite the evidence label "inspiration", carry a confidence range rather than a certainty, and carry a region.',
  'The region is a normalized bounding box on this image where the attribute is most visible, written as the string "x,y,w,h": x and y are the top-left corner, w and h the width and height, each a decimal between 0 and 1 with at most four places, comma-separated with no spaces, and with x + w and y + h no greater than 1. For example "0.28,0.05,0.44,0.2". Point it at the part of the hair you actually read the attribute from — the root area for root blend and for baseLevel, a mid-length section for dimension, the ends for finish, and the lightest visible pieces for lightestLevel.',
  consultHairLevelScalePromptText(),
  'Field meanings:',
  'baseLevel — the depth the colour STARTS from: the darkest dominant colour on the head, which is normally what you see at the root. Place it on the depth scale above.',
  'lightestLevel — the LIGHTEST dominant colour anywhere on the head, on that same depth scale. This is normally the ends, the brightest highlighted pieces, or the money piece.',
  'These two are separate readings, not a range. A solid single-process colour has the SAME value in both, and reporting them equal is the right answer, not a failure to decide. Balayage, highlights, a shadow root and a grown-out colour are where they differ. Never report a baseLevel LIGHTER than the lightestLevel. How sure you are goes in each field’s confidence range and nowhere else — do not widen the gap between the two levels to express doubt.',
  'tone — whether the colour reads WARM (gold, copper, red), COOL (ash, smoky, violet) or NEUTRAL.',
  'technique — how the colour looks like it was placed: SINGLE_PROCESS, BALAYAGE, FOIL_HIGHLIGHTS, BABYLIGHTS, LOWLIGHTS, COLOR_MELT, DOUBLE_PROCESS, GLOSS_ONLY, or NATURAL_UNCOLORED when it does not look coloured at all.',
  'placement — where the lightness or depth sits: ALL_OVER, FACE_FRAMING, MIDS_TO_ENDS, ENDS_ONLY, SURFACE_ONLY, UNDERNEATH or PANELS.',
  'rootBlend — how the colour meets the root: SOLID_TO_ROOT, SHADOW_ROOT, SEAMLESS_MELT or GROWN_OUT.',
  'finish — how the surface reflects: HIGH_SHINE, SATIN or MATTE.',
  'dimension — how much contrast there is between the lightest and darkest pieces: FLAT, SUBTLE, MEDIUM or HIGH_CONTRAST.',
  'Photographs lie about colour: studio light, filters and screens shift tone and level. Widen your confidence ranges accordingly and never report certainty.',
  'credibilityFlags — anything about the PHOTOGRAPH itself, not the hair, that a colourist should know before trusting it. Include every value that applies and nothing else; an empty list means nothing applies. LIKELY_EDITED — a filter, colour grading, smoothing, sharpening or retouching has visibly changed how the hair looks. LIKELY_AI_GENERATED — the image looks generated or heavily synthetic rather than a photograph of real hair (impossible strand geometry, painted texture, a rendered look). EXTENSIONS_LIKELY — the length, fullness or evenness of the ends suggests added hair. PRO_LIGHTING — studio or professional lighting, a wind machine or a set is flattering the colour and shine in a way daylight will not. FINISH_HIDES_CUT — heat styling, a blowout or a set is doing so much work that the cut and the natural fall cannot be read. SINGLE_ANGLE — one view only, so how the colour and shape sit from other angles is not shown.',
  'A flag is a note, not a refusal. A flagged photograph is still read into all eight fields; the flag tells the salon to trust some details less, and your confidence ranges should say the same. Do not raise a flag you cannot see evidence for.',
].join(' ')

/**
 * Exported so the live contract test sends THE instruction production sends
 * rather than a copy typed beside it — the same rule as the max-tokens cap.
 */
export const CONSULT_INSPIRATION_USER_INSTRUCTION =
  'This is the client’s inspiration reference. Read its hair colour into the eight fields, and note anything about the photograph itself in credibilityFlags. Use UNKNOWN wherever this photograph does not show you the answer.'

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
 * `side`, fitted to the room the frame actually leaves it (`available` =
 * 1 − the box's own origin). Null when it cannot honestly be fitted.
 *
 * Three outcomes, and the middle one is the whole point:
 *  - it fits — kept as it is;
 *  - it runs off the edge of the IMAGE — trimmed back to the edge. The
 *    overflow is off-canvas, so it holds no pixels the reading could have come
 *    from, and trimming it leaves the box pointing at exactly the part of the
 *    photograph the model meant;
 *  - the overflow eats more than half the side — the box was never aimed at
 *    what it claims, and the caller refuses it.
 *
 * 🔴 Until 2026-09-13 anything past `ROUNDING_TOLERANCE` was refused, and that
 * refusal discarded the ENTIRE paid read. Measured on Tori's own reference
 * (prod session cmtymyxha…: three `bad_output`s at `stage: "region"` on 09-13,
 * then 3/3 on a local replay of the same image): the model draws `hairRegion`
 * with y + h = 1.07–1.09 — hair that runs to the bottom of the frame — every
 * single time. A box the image cannot hold is not a wrong box, and this is the
 * same lossless repair `clampIntoHair` already makes one step later against
 * the hair box.
 */
function fitIntoFrame(side: number, available: number): number | null {
  if (side <= available) return side
  // A box that already touched the edge can come back a ten-thousandth over
  // once each side is rounded. That is a rounding artefact, absorbed silently.
  if (side - available <= ROUNDING_TOLERANCE) return available
  if (available < side / 2 || available < MIN_REGION_SIDE) return null
  return available
}

/** "x,y,w,h" → the stored object. Null and absent both mean "no region". */
function region(raw: unknown): ConsultInspirationRegion | null {
  if (raw === null || raw === undefined) return null
  if (typeof raw !== 'string' || !new RegExp(CONSULT_INSPIRATION_REGION_PATTERN).test(raw)) {
    throw new ConsultInspirationVisionError('bad_output', 'region_format')
  }
  const parts = raw.split(',').map(Number)
  if (parts.length !== 4 || parts.some((value) => !Number.isFinite(value))) {
    throw new ConsultInspirationVisionError('bad_output', 'region_format')
  }
  const [rawX, rawY, rawW, rawH] = parts as [number, number, number, number]
  const x = round4(rawX)
  const y = round4(rawY)
  const requestedW = round4(rawW)
  const requestedH = round4(rawH)
  const w = fitIntoFrame(requestedW, round4(1 - x))
  const h = fitIntoFrame(requestedH, round4(1 - y))
  // The three ways a box can be unusable are named separately, so the next
  // refusal in prod says which rule it broke instead of only that a region was
  // bad — which is what made this one cost a paid reproduction to find.
  if (w === null || h === null) {
    throw new ConsultInspirationVisionError('bad_output', 'region_bounds')
  }
  if (w < MIN_REGION_SIDE || h < MIN_REGION_SIDE) {
    throw new ConsultInspirationVisionError('bad_output', 'region_too_small')
  }
  // Geometry only — how far off the frame the box ran, never what it showed.
  if (w !== requestedW || h !== requestedH) {
    console.warn('consult inspiration crop trimmed to the frame', {
      received: { x, y, w: requestedW, h: requestedH },
      stored: { x, y, w, h },
    })
  }
  return { x, y, w, h }
}

function confidence(raw: unknown): { min: number; max: number } {
  if (!isRecord(raw) || Object.keys(raw).sort().join(',') !== 'max,min') {
    throw new ConsultInspirationVisionError('bad_output', 'confidence')
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
    throw new ConsultInspirationVisionError('bad_output', 'confidence')
  }
  return { min: round4(min), max: round4(max) }
}

function evidence(raw: unknown): ConsultInspirationEvidence[] {
  if (!Array.isArray(raw) || raw.length > CONSULT_INSPIRATION_EVIDENCE_KEYS.length) {
    throw new ConsultInspirationVisionError('bad_output', 'evidence')
  }
  const cited: ConsultInspirationEvidence[] = []
  for (const item of raw) {
    const key = CONSULT_INSPIRATION_EVIDENCE_KEYS.find(
      (candidate) => candidate === item,
    )
    if (!key || cited.includes(key)) {
      throw new ConsultInspirationVisionError('bad_output', 'evidence')
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
    throw new ConsultInspirationVisionError('bad_output', 'observation_shape')
  }
  const value = values.find((candidate) => candidate === raw.value)
  if (!value) throw new ConsultInspirationVisionError('bad_output', 'observation_value')
  const range = confidence(raw.confidence)
  const cited = evidence(raw.evidence)
  const box = region(raw.region)
  // An UNKNOWN that cites evidence, claims confidence, or points at a region is
  // a contradiction; a reading that cites nothing or points nowhere is an
  // unsupported claim. Neither is storable, so the attribute is refused — but
  // only the attribute: `observationOrDegraded` catches this and turns it into
  // an UNKNOWN rather than binning the other seven.
  if (value === 'UNKNOWN') {
    if (cited.length > 0 || range.max > 0.35 || box) {
      throw new ConsultInspirationVisionError('bad_output', 'unknown_contradiction')
    }
  } else if (cited.length === 0 || !box) {
    throw new ConsultInspirationVisionError('bad_output', 'unsupported_claim')
  }
  return { value, confidence: range, evidence: cited, region: box }
}

/**
 * One attribute the sanitizer could not take at face value, recorded rather
 * than thrown. See `observationOrDegraded` for why it is not thrown.
 */
export type ConsultInspirationAttributeDegradation = {
  field: ConsultInspirationAnalysisField
  /** The check that refused, content-free — the names `stage` already carries. */
  check: string
  /**
   * The value the provider offered, but ONLY when it is a member of that
   * field's own vocabulary. Null otherwise — a value the enum does not know is
   * unconstrained text, and this file's logs never carry what a photo showed.
   */
  offered: string | null
}

/**
 * The confidence an UNKNOWN we synthesized ourselves may claim.
 *
 * It has to satisfy the same three rules the DB guard applies to every stored
 * UNKNOWN (`consult_inspiration_observation_valid`: no evidence, no region,
 * `confidence.max <= 0.35`) and `min < max`. Deliberately at the very bottom of
 * that band rather than at the 0.35 ceiling: this attribute was not read as
 * uncertain, it was read as something the server refused, and a downstream
 * reader should not be able to mistake it for a faint observation.
 */
const DEGRADED_CONFIDENCE = { min: 0, max: 0.05 } as const

/**
 * The honest stand-in for an attribute that could not be taken at face value.
 *
 * Typed at the literal `'UNKNOWN'` rather than at the field's vocabulary, so
 * there is no assertion here: every one of the eight vocabularies carries
 * UNKNOWN (lib/consult/inspirationAttributes.ts), which makes this assignable
 * to any of their observation types on its own terms.
 */
function degradedObservation(): ConsultInspirationObservation<'UNKNOWN'> {
  return {
    value: 'UNKNOWN',
    confidence: { ...DEGRADED_CONFIDENCE },
    evidence: [],
    region: null,
  }
}

/**
 * 🔴 One bad attribute degrades THAT attribute. It does not throw the reading away.
 *
 * Until 2026-09-14 every per-attribute check here failed the WHOLE eight-field
 * result. Measured on the six reference fixtures: sending a desaturated copy of
 * the photograph broke 4 of 6 reads, and the raw output of the first one was
 *
 *     tone   value=NEUTRAL   evidence=[]   region=null
 *
 * — the model had correctly worked out that a desaturated image cannot tell it
 * the tone, cleared the evidence and the region, and then wrote NEUTRAL where
 * UNKNOWN belonged. `unsupported_claim` fired and all eight attributes were
 * discarded, including the two levels that pass had just improved. Seven of the
 * eight fields were good. One word cost the entire paid call.
 *
 * This is the same trap `sanitizeConsultInspirationCredibilityFlags` names in
 * its own comment — Part 0 rule 11's trap #4, a complete analysis discarded
 * over an enum the policy then refused — and it is answered the same way: the
 * unusable part is dropped, the usable part is kept, and what was dropped is
 * recorded instead of vanishing.
 *
 * What is NOT relaxed: nothing invalid is ever stored (the attribute becomes a
 * real UNKNOWN, not the value the provider offered), and the all-UNKNOWN floor
 * still refuses a reading that degraded to nothing. A silently-degraded reading
 * would be the invisible failure this whole thread is about, so `degradations`
 * is filled for the caller to log.
 *
 * Only this file's own error is caught. A genuine bug still throws.
 */
function observationOrDegraded(
  raw: unknown,
  values: readonly string[],
  field: ConsultInspirationAnalysisField,
  degradations: ConsultInspirationAttributeDegradation[],
): ConsultInspirationObservation<string> {
  try {
    return observation(raw, values)
  } catch (error) {
    if (!(error instanceof ConsultInspirationVisionError)) throw error
    degradations.push({
      field,
      check: error.stage ?? 'observation',
      offered: offeredValue(raw, values),
    })
    return degradedObservation()
  }
}

/** The provider's value, but only if our own vocabulary knows the word. */
function offeredValue(raw: unknown, values: readonly string[]): string | null {
  if (!isRecord(raw)) return null
  return values.find((candidate) => candidate === raw.value) ?? null
}

/**
 * The provider's raw JSON → the stored artefact.
 *
 * Exported because the integration tests stand a fake provider in front of the
 * network and must run its payload through THE policy, not a second copy of
 * it — the same reason `sanitizeConsultCaptureQuality` is exported.
 */
/** Provider localization is checked before retaining any attribute crop.
 * The stored attribute schema stays unchanged; promptVersion marks this check.
 * Containment validates geometry, not the semantic accuracy of model localization.
 */
export function sanitizeLocalizedInspirationAnalysis(
  raw: unknown,
  /** Filled with every crop that was clamped; the provider logs them. */
  repairs: ConsultInspirationRegionRepair[] = [],
  /** Filled with every attribute that was degraded; the provider logs them. */
  degradations: ConsultInspirationAttributeDegradation[] = [],
): ConsultInspirationAnalysis {
  if (!isRecord(raw) || !Object.hasOwn(raw, 'hairRegion')) throw new ConsultInspirationVisionError('bad_output', 'envelope')
  // `credibilityFlags` is the envelope's, not an attribute; it is read by
  // `sanitizeConsultInspirationCredibilityFlags` and must not reach the
  // exact-keys check on the attribute set.
  const { hairRegion, ...envelope } = raw
  const attributes = Object.fromEntries(
    Object.entries(envelope).filter(([key]) => key !== 'credibilityFlags'),
  )
  // 🔴 `hairRegion` is NOT degradable, unlike the attribute crops below. It is
  // the envelope's own claim about where the hair is, and every attribute crop
  // is checked against it; without it there is nothing to check containment
  // AGAINST, so a malformed one is a broken payload rather than one weak
  // attribute. A null one already means "I could not find the hair", which the
  // prompt asks for explicitly and which is `unreadable`, not `bad_output`.
  const hair = region(hairRegion)
  if (!hair) throw new ConsultInspirationVisionError('unreadable')
  const analysis = sanitizeConsultInspirationAnalysis(attributes, degradations)
  for (const field of CONSULT_INSPIRATION_ANALYSIS_FIELDS) {
    const box = analysis[field].region
    if (!box) continue
    const contained = clampIntoHair(box, hair)
    // A crop mostly outside the hair is pointing at a garment or a background,
    // so the ATTRIBUTE is unreadable — but only that attribute. Before
    // 2026-09-14 one such crop discarded the whole reading, which is the
    // failure `clampIntoHair`'s own comment already describes costing a paid
    // reproduction to find.
    if (!contained) {
      degradations.push({
        field,
        check: 'region_containment',
        offered: analysis[field].value,
      })
      analysis[field] = degradedObservation()
      continue
    }
    if (contained !== box) {
      repairs.push({ field, received: box, stored: contained, hairRegion: hair })
      analysis[field].region = contained
    }
  }
  // 🔴 The floor is re-checked HERE as well as inside
  // `sanitizeConsultInspirationAnalysis`. The containment pass above runs after
  // that check and can itself degrade attributes, so it is able to empty a
  // reading that had just passed. An all-UNKNOWN artefact is refused by the DB
  // guard too; reaching it would be a 500 instead of an honest `unreadable`.
  if (countKnownConsultInspirationAttributes(analysis) === 0) {
    throw new ConsultInspirationVisionError('unreadable')
  }
  return analysis
}

/** One attribute crop the containment rule clamped rather than refused. */
export type ConsultInspirationRegionRepair = {
  field: ConsultInspirationAnalysisField
  received: ConsultInspirationRegion
  stored: ConsultInspirationRegion
  hairRegion: ConsultInspirationRegion
}

/**
 * The containment rule, with the give a model's localization actually needs.
 *
 * 🔴 Until 2026-09-11 any attribute crop that reached past the model's OWN
 * hair box by more than a rounding step (0.0002) threw the whole paid reading
 * away. On Deploy E every "Build my plan" with a reference died on exactly
 * that: the v4 read of a real Look photo answered all eight attributes, and
 * the lightest-level box ran 0.03 past the right edge of the hair box it had
 * drawn itself — proven by a local replay of the prod call, 5 refusals out of
 * 5. A box that is mostly inside the hair is a slightly loose box, not a wrong
 * one; the crop it points at is the one the model meant.
 *
 * So: the box is CLAMPED into the hair box when what survives is at least half
 * of each side (and still a usable crop), and refused when it is not — a crop
 * mostly outside the hair is pointing at a garment or a background, and that
 * is the case the rule exists for. A box that only overruns by rounding is
 * returned as-is (identity), so a clean read records no repair.
 */
function clampIntoHair(
  box: ConsultInspirationRegion,
  hair: ConsultInspirationRegion,
): ConsultInspirationRegion | null {
  const left = Math.max(box.x, hair.x)
  const top = Math.max(box.y, hair.y)
  const right = Math.min(box.x + box.w, hair.x + hair.w)
  const bottom = Math.min(box.y + box.h, hair.y + hair.h)
  const w = round4(right - left)
  const h = round4(bottom - top)
  const moved =
    Math.abs(left - box.x) > ROUNDING_TOLERANCE ||
    Math.abs(top - box.y) > ROUNDING_TOLERANCE ||
    Math.abs(w - box.w) > ROUNDING_TOLERANCE ||
    Math.abs(h - box.h) > ROUNDING_TOLERANCE
  if (!moved) return box
  if (w < box.w / 2 || h < box.h / 2 || w < MIN_REGION_SIDE || h < MIN_REGION_SIDE) {
    return null
  }
  return { x: round4(left), y: round4(top), w, h }
}

/**
 * C2-6b — the credibility flags off the wire: the vocabulary, each at most
 * once, in the vocabulary's order.
 *
 * 🔴 Deliberately LENIENT about the values, unlike every other sanitizer in
 * this file, because a flag is advisory. Refusing a whole paid reading over a
 * flag word the vocabulary does not know would be Part 0 rule 11's trap #4
 * (a complete analysis discarded over an enum the policy then refused) for a
 * field that changes a sentence, not a decision. So: an unknown value is
 * DROPPED and never stored, a duplicate is deduped, an absent field is `[]`.
 * A non-array is still `bad_output` — the grammar guarantees an array, so
 * anything else is a broken contract, not a vocabulary drift.
 */
export function sanitizeConsultInspirationCredibilityFlags(
  raw: unknown,
): ConsultInspirationCredibilityFlag[] {
  if (raw === undefined || raw === null) return []
  if (!Array.isArray(raw)) throw new ConsultInspirationVisionError('bad_output', 'credibility_flags')
  return CONSULT_INSPIRATION_CREDIBILITY_FLAGS.filter((flag) => raw.includes(flag))
}

/**
 * The whole v4 wire object → the two halves the artefact stores: the
 * localized attribute reading and the credibility flags. This is what the
 * provider call parses; the two halves are exported separately because the
 * live contract test and the integration fakes exercise each on its own.
 */
export function sanitizeConsultInspirationRead(raw: unknown): {
  analysis: ConsultInspirationAnalysis
  credibilityFlags: ConsultInspirationCredibilityFlag[]
  /** Crops the containment rule clamped — empty on a clean read. */
  regionRepairs: ConsultInspirationRegionRepair[]
  /** Attributes refused and turned into UNKNOWN — empty on a clean read. */
  attributeDegradations: ConsultInspirationAttributeDegradation[]
} {
  const regionRepairs: ConsultInspirationRegionRepair[] = []
  const attributeDegradations: ConsultInspirationAttributeDegradation[] = []
  const analysis = sanitizeLocalizedInspirationAnalysis(
    raw,
    regionRepairs,
    attributeDegradations,
  )
  // `sanitizeLocalizedInspirationAnalysis` has just proved `raw` is a record.
  const credibilityFlags = sanitizeConsultInspirationCredibilityFlags(
    isRecord(raw) ? raw.credibilityFlags : undefined,
  )
  return { analysis, credibilityFlags, regionRepairs, attributeDegradations }
}

export function sanitizeConsultInspirationAnalysis(
  raw: unknown,
  /** Filled with every attribute that was degraded; the provider logs them. */
  degradations: ConsultInspirationAttributeDegradation[] = [],
): ConsultInspirationAnalysis {
  // The key set stays strict. A missing or extra attribute is not one bad
  // reading among eight, it is a payload that is not this schema at all — and
  // the grammar makes all eight `required`, so a mismatch here means the
  // contract broke, not that the photograph was hard to read.
  if (
    !isRecord(raw) ||
    Object.keys(raw).sort().join(',') !==
      [...CONSULT_INSPIRATION_ANALYSIS_FIELDS].sort().join(',')
  ) {
    throw new ConsultInspirationVisionError('bad_output', 'attribute_keys')
  }
  const analysis = Object.fromEntries(
    CONSULT_INSPIRATION_ANALYSIS_FIELDS.map((field) => [
      field,
      observationOrDegraded(
        raw[field],
        CONSULT_INSPIRATION_FIELD_VALUES[field],
        field,
        degradations,
      ),
    ]),
  ) as ConsultInspirationAnalysis
  degradeUnorderedLevelPair(analysis, degradations)
  // Part 0 rule 4, and Stage 1's failure state: a result whose every attribute
  // is UNKNOWN is not a low-confidence answer, it is an unreadable photograph.
  // Shipping it would be an empty-attribute success — the exact silent
  // fallback the pipeline is forbidden. Degrading attributes above can REACH
  // this floor, which is the point: a reading that degraded to nothing is
  // still refused, it is just no longer refused for the other seven's sake.
  if (countKnownConsultInspirationAttributes(analysis) === 0) {
    throw new ConsultInspirationVisionError('unreadable')
  }
  return analysis
}

/**
 * The one relationship the level scale forbids: a base LIGHTER than the
 * lightest cannot be true of any head of hair. Either level being UNKNOWN is
 * simply unobserved and passes.
 *
 * 🔴 This one is NOT a blanket demote, and it is not a swap either.
 *
 * Not a swap, because the original rule was right about that: the pair is not
 * a range, and quietly reordering it invents a reading nobody made. Not a
 * blanket demote, because losing BOTH levels over their disagreement throws
 * away the most valuable pair in the reading — exactly the over-refusal this
 * change exists to stop.
 *
 * So the pair is split: the level the model was LESS sure of is the one that
 * becomes UNKNOWN, and the more confident one survives. Confidence is the
 * midpoint of the stated range, tie-broken on the narrower range — a tighter
 * claim at the same centre is the more committed one.
 *
 * On an exact tie, `baseLevel` is the one that goes. That is a judgement, not
 * a measurement: `lookPlan.ts` reasons "from where she is to where she wants
 * to be", taking where she IS from her own capture reading and the
 * DESTINATION from this artefact — so the reference's lightest level is the
 * half that carries the goal, while its base level describes the roots of
 * someone in a photograph, which the plan has a better source for. If only one
 * can survive, the one that sets the lift target is worth more.
 */
function degradeUnorderedLevelPair(
  analysis: ConsultInspirationAnalysis,
  degradations: ConsultInspirationAttributeDegradation[],
): void {
  if (
    consultHairLevelPairIsOrdered(
      analysis.baseLevel.value,
      analysis.lightestLevel.value,
    )
  ) {
    return
  }
  const base = analysis.baseLevel.confidence
  const lightest = analysis.lightestLevel.confidence
  const baseCentre = (base.min + base.max) / 2
  const lightestCentre = (lightest.min + lightest.max) / 2
  const keepLightest =
    lightestCentre > baseCentre ||
    (lightestCentre === baseCentre &&
      lightest.max - lightest.min <= base.max - base.min)
  const field = keepLightest ? 'baseLevel' : 'lightestLevel'
  degradations.push({
    field,
    check: 'level_order',
    offered: analysis[field].value,
  })
  analysis[field] = degradedObservation()
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
  /** P4b: where this call's cost is recorded. See lib/consult/providerMeter.ts. */
  meter?: ConsultProviderMeterSink | null
}) => Promise<ConsultInspirationAnalysisResult>

export const runConsultInspirationVision: ConsultInspirationVisionProvider =
  async (input) => {
    const model = modelName()
    return meterConsultProviderCall(
      input.meter,
      { kind: ConsultProviderCallKind.INSPIRATION_READ, model },
      async (reportUsage) => {
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
                { type: 'text', text: CONSULT_INSPIRATION_USER_INSTRUCTION },
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
    // Billed the moment it answered — before the refusal check and the parser.
    reportUsage(message.usage)

    if (message.stop_reason === 'refusal') {
      throw new ConsultInspirationVisionError('refused')
    }
    // Truncated JSON is this repo's cap being too low, not a provider fault.
    // Named here so it cannot arrive at the parser as unexplained garbage —
    // the same trap the analysis engine's direction call actually fell into.
    if (message.stop_reason === 'max_tokens') {
      throw new ConsultInspirationVisionError('bad_output', 'max_tokens')
    }
    const text = message.content
      .filter((block): block is Anthropic.TextBlock => block.type === 'text')
      .map((block) => block.text)
      .join('')
    if (!text) throw new ConsultInspirationVisionError('bad_output', 'empty_text')

    let read: ReturnType<typeof sanitizeConsultInspirationRead>
    try {
      read = sanitizeConsultInspirationRead(JSON.parse(text))
    } catch (error) {
      if (error instanceof ConsultInspirationVisionError) throw error
      throw new ConsultInspirationVisionError('bad_output', 'json_parse')
    }
    // Geometry only — which crop moved and by how much, never what it showed.
    for (const repair of read.regionRepairs) {
      console.warn('consult inspiration crop clamped into the hair region', repair)
    }
    // A degraded attribute is a paid read that answered less than it was asked.
    // It is logged rather than swallowed for the same reason #1174 put the
    // refusing check on the row: a failure nobody can see is one nobody fixes.
    // Content-free by construction — a field name, a check name, and a value
    // only when it is one of our own enum members.
    for (const degraded of read.attributeDegradations) {
      console.warn('consult inspiration attribute degraded to UNKNOWN', degraded)
    }
    return { analysis: read.analysis, credibilityFlags: read.credibilityFlags, model }
      },
    )
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
