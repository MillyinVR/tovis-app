import Anthropic from '@anthropic-ai/sdk'
import type { ConsultServiceFamily } from '@prisma/client'

import type {
  ConsultAnalysisEvidenceDTO,
  ConsultCaptureQualityWarningCodeDTO,
  ConsultCaptureShotKeyDTO,
  ConsultInspirationSourceDTO,
} from '@/lib/dto/consult'
import { readOptionalEnv, requireEnv } from '@/lib/env'
import { isRecord } from '@/lib/guards'

import {
  CONSULT_ALL_CAPTURE_SHOT_KEYS,
  CONSULT_MAX_CAPTURE_SHOTS,
} from './capture/registry'
import {
  CONSULT_HAIR_LEVELS,
  consultHairLevelPairIsOrdered,
  type ConsultHairLevel,
} from './hairLevel'
import type { ConsultCaptureImage } from './captureStorage'
import { isAllowedConsultProviderModel } from './providerModel'
import {
  CONSULT_INSPIRATION_ANALYSIS_FIELDS,
  type ConsultInspirationAnalysis,
} from './inspirationVision'
import { toProviderOutputSchema } from './providerSchema'
import { CONSULT_SERVICE_FAMILY_LABELS } from './serviceScope'

export const CONSULT_ANALYSIS_SCHEMA_VERSION = 4
// v2 (2026-08-27): the capture pack may be partial — the prompt lists missing
// views and pins their observations to UNKNOWN.
// v3 (2026-09-03, service-aware consult): the analysis is told WHICH service
// it is for — family, category, the service the look or booking names, and
// the professional's menu in that category — and the intake as the labels the
// client actually saw. `hairColorLens` becomes `serviceLens` (same eight
// fields, service-neutral wording); recommendations name a service from the
// menu (or a consultation) instead of choosing from a colour-only intent enum;
// safety codes gain service-neutral members. Prompt and schema move together.
// v4 (2026-09-04, P4): the client's INSPIRATION reference is finally part of
// the reasoning. The prompt gains a block naming what the vision model read
// off that photograph (level, tone, technique, placement, root blend, finish,
// dimension, each with its confidence range) alongside the client's own
// answers about it, and each supplied capture is labelled with any colour
// WARNING its quality check recorded. The output schema is unchanged — this
// is new INPUT, so the prompt version moves and the schema version does not.
// v5 (2026-09-04, P4a): the analysis is TWO provider calls, and the levels are
// named. Schema v3/v4 never compiled — the structured-output grammar has a
// size budget and this schema was roughly 2.4x over it, so every analysis
// 400'd on its first request and no consult has ever completed against the
// live model (lib/consult/providerSchema.ts carries the measurements). The
// eleven-field feature profile alone exceeds the budget, and no single-call
// arrangement of these fields compiles: measured on 2026-09-04, the slimmest
// one-call design was still refused with "the compiled grammar is too large",
// and the maximally-shared variant with a single $ref'd observation was
// refused by a SECOND, independent ceiling ("Schema is too complex for
// compilation"). So the call is split where the consultation itself already
// splits: the feature profile (Stage 3b — what will flatter this person) is
// asked first, and its answer is handed to the direction call (Stage 3/4 —
// where she is starting from and what to book) as settled structure.
// The levels move with it: `core.currentLevel: {min, max}` — two integers that
// never said whether they meant dark-to-light or a confidence spread — becomes
// `core.baseLevel` and `core.lightestLevel`, two ordinary observations on the
// shared level scale (lib/consult/hairLevel.ts).
// v5 also means THESE PROMPTS AT THIS EFFORT: `CONSULT_ANALYSIS_EFFORT` changes
// what comes back as much as a reworded sentence does (at the default the
// direction call truncated), so moving it is a prompt-version change.
export const CONSULT_ANALYSIS_PROMPT_VERSION = 'service-analysis-v5'
export const CONSULT_ANALYSIS_DEFAULT_MODEL = 'claude-sonnet-5'
/**
 * Per-call ceilings, because the two calls are nothing like each other.
 *
 * Measured on 2026-09-04 against `claude-sonnet-5` at effort `low`, across a
 * dozen live runs:
 *   profile    5.0s – 8.6s   (528–895 output tokens)
 *   direction  29s – >90s    (1,507–3,208 output tokens)
 *
 * The direction call grew once it stopped returning empty style directions and
 * started returning two recommendations — both correctness fixes — and it then
 * hit the shared 90s ceiling twice in a row. A ceiling is for the tail, not
 * the median: the profile gets 5x its worst measurement, the direction gets
 * room for a run half again as slow as the slowest observed.
 *
 * 🔴 The sum is the analysis route's budget. 50 (inspiration) + 45 + 150 =
 * 245s, inside `maxDuration = 300` with room for the database work either
 * side. Raising either of these means raising that, and the engine test pins
 * the arithmetic so the two cannot drift apart.
 */
export const CONSULT_ANALYSIS_PROFILE_TIMEOUT_MS = 45_000
export const CONSULT_ANALYSIS_DIRECTION_TIMEOUT_MS = 150_000

/**
 * `max_tokens` per call, and both are load-bearing: a structured-output answer
 * that hits the cap comes back with `stop_reason: 'max_tokens'` and truncated
 * JSON, which reaches the sanitizer as `bad_output` and the client as a failed
 * consult — from a request that was billed in full.
 *
 * Measured natural lengths on the same run (they include THINKING tokens,
 * which were the larger half): profile 2,567 output tokens of which 2,081 were
 * thinking; direction 5,001 of which 2,395 were thinking. The first live run
 * of this code capped the direction call at 5,000 and truncated on exactly
 * that boundary. These are those numbers with headroom, not round guesses.
 */
export const CONSULT_ANALYSIS_PROFILE_MAX_TOKENS = 6_000
export const CONSULT_ANALYSIS_DIRECTION_MAX_TOKENS = 9_000

/**
 * How hard the model thinks. Not a cost tweak — the thing that made the
 * direction call fit inside the request at all.
 *
 * At the default (`high`), most of the answer is THINKING, and it is the
 * thinking that grows: measured on 2026-09-04 with a seven-image pack,
 * `claude-sonnet-5` spent 2,081 thinking tokens on the profile and 2,395+ on
 * the direction, took 29.1s and 74-85s respectively, and TRUNCATED the
 * direction call against a 9,000-token cap. At `low` the same two calls took
 * 5.4s and 34.0s, spent 0 and 622 thinking tokens, and both parsed.
 *
 * `low` is the right level for this shape of work rather than merely the
 * cheapest: the schema does the shaping, the rubric is in the prompt, and the
 * judgement asked for is bounded. `medium` was measured too (8.6s / 49.4s) and
 * bought nothing that showed up in the output.
 */
export const CONSULT_ANALYSIS_EFFORT = 'low' as const

/**
 * What a recommendation IS. The provider may only recommend a service from the
 * professional's menu in this consult's category, or a consultation with the
 * professional; the deterministic safety routing adds the two tests after the
 * provider boundary (lib/consult/safetyRouting.ts).
 */
export const CONSULT_ANALYSIS_PROVIDER_SERVICE_INTENTS = [
  'SERVICE',
  'CONSULTATION',
] as const

export const CONSULT_ANALYSIS_SERVICE_INTENTS = [
  ...CONSULT_ANALYSIS_PROVIDER_SERVICE_INTENTS,
  'STRAND_TEST',
  'PATCH_TEST',
] as const

export type ConsultAnalysisServiceIntent =
  (typeof CONSULT_ANALYSIS_SERVICE_INTENTS)[number]

/**
 * The one non-menu option the provider can name in a recommendation. It is
 * a fixed string in the per-run enum beside the menu names, so structured
 * output cannot invent a service the professional does not offer.
 */
export const CONSULT_ANALYSIS_CONSULTATION_OPTION =
  'A consultation with the professional'

/** Every safety code any pack's policy can raise (lib/consult/safetyFlags.ts). */
export const CONSULT_ANALYSIS_SAFETY_CODES = [
  'PRIOR_REACTION',
  'REACTION_HISTORY_UNKNOWN',
  'RECENT_BOX_DYE',
  'RECENT_LIGHTENING',
  'RECENT_CHEMICAL_SERVICE',
  'CHEMICAL_HISTORY_UNKNOWN',
  'ALLERGY_HISTORY_UNKNOWN',
  'KNOWN_ALLERGY',
  'SENSITIVITY_REPORTED',
  'VISIBLE_COMPROMISE',
] as const

export type ConsultAnalysisSafetyCode =
  (typeof CONSULT_ANALYSIS_SAFETY_CODES)[number]

/** Hair-view evidence keys, in fixed provider order. */
export const CONSULT_ANALYSIS_HAIR_EVIDENCE_KEYS = [
  'hair_back',
  'hair_left',
  'hair_right',
  'hair_crown',
] as const

/**
 * Every evidence label a result may cite: every shot key any capture pack
 * defines (lib/consult/capture/registry.ts) plus the intake. A run is told
 * which of these views were actually supplied and may cite only those.
 */
export const CONSULT_ANALYSIS_EVIDENCE_KEYS: readonly ConsultAnalysisEvidenceDTO[] = [
  ...CONSULT_ALL_CAPTURE_SHOT_KEYS,
  'intake',
]
type EvidenceKey = ConsultAnalysisEvidenceDTO

export const CONSULT_ANALYSIS_TONES = [
  'ASHY',
  'NEUTRAL',
  'GOLDEN',
  'COPPER',
  'RED',
  'MIXED',
  'UNKNOWN',
] as const
export const CONSULT_ANALYSIS_CONDITIONS = [
  'NO_VISIBLE_CONCERN',
  'POSSIBLE_COMPROMISE',
  'UNKNOWN',
] as const
export const CONSULT_ANALYSIS_DENSITIES = ['LOW', 'MEDIUM', 'HIGH', 'UNKNOWN'] as const
export const CONSULT_ANALYSIS_TEXTURES = [
  'STRAIGHT',
  'WAVY',
  'CURLY',
  'COILY',
  'MIXED',
  'UNKNOWN',
] as const
export const CONSULT_ANALYSIS_ACHIEVABILITY = [
  'LIKELY_SINGLE_APPOINTMENT',
  'LIKELY_MULTI_APPOINTMENT',
  'REQUIRES_PRO_ASSESSMENT',
  'UNKNOWN',
] as const

// ── Schema v2: feature-profile observation enums ────────────────────────────
// These are cosmetic styling descriptors only. None may carry identity,
// ethnicity, age, or medical meaning, and every one has an honest UNKNOWN.

export const CONSULT_PROFILE_UNDERTONES = [
  'WARM',
  'COOL',
  'NEUTRAL',
  'OLIVE',
  'UNKNOWN',
] as const
export const CONSULT_PROFILE_CONTRASTS = ['LOW', 'MEDIUM', 'HIGH', 'UNKNOWN'] as const
export const CONSULT_PROFILE_COLOR_SEASONS = [
  'BRIGHT_SPRING',
  'TRUE_SPRING',
  'LIGHT_SPRING',
  'LIGHT_SUMMER',
  'TRUE_SUMMER',
  'SOFT_SUMMER',
  'SOFT_AUTUMN',
  'TRUE_AUTUMN',
  'DEEP_AUTUMN',
  'DEEP_WINTER',
  'TRUE_WINTER',
  'BRIGHT_WINTER',
  'UNKNOWN',
] as const
export const CONSULT_PROFILE_FACE_PROPORTIONS = [
  'WIDER',
  'BALANCED',
  'LONGER',
  'UNKNOWN',
] as const
export const CONSULT_PROFILE_JAWLINES = [
  'SOFTLY_ROUNDED',
  'BALANCED',
  'ANGULAR',
  'UNKNOWN',
] as const
export const CONSULT_PROFILE_FOREHEADS = [
  'SHORTER',
  'BALANCED',
  'TALLER',
  'UNKNOWN',
] as const
export const CONSULT_PROFILE_FEATURE_BALANCES = [
  'SOFT',
  'BLENDED',
  'STRUCTURED',
  'UNKNOWN',
] as const
export const CONSULT_PROFILE_EYE_SHAPES = [
  'ALMOND',
  'ROUND',
  'HOODED',
  'MONOLID',
  'DOWNTURNED',
  'UPTURNED',
  'DEEP_SET',
  'PROMINENT',
  'UNKNOWN',
] as const
export const CONSULT_PROFILE_EYE_SPACINGS = [
  'CLOSE_SET',
  'BALANCED',
  'WIDE_SET',
  'UNKNOWN',
] as const
export const CONSULT_PROFILE_BROW_DENSITIES = [
  'SPARSE',
  'MEDIUM',
  'FULL',
  'UNKNOWN',
] as const
export const CONSULT_PROFILE_BROW_SHAPES = [
  'STRAIGHT',
  'SOFT_ARCH',
  'HIGH_ARCH',
  'ROUNDED',
  'UNKNOWN',
] as const

export const CONSULT_PROFILE_FIELDS = [
  'skinUndertone',
  'contrastLevel',
  'colorSeason',
  'faceProportion',
  'jawline',
  'foreheadProportion',
  'featureBalance',
  'eyeShape',
  'eyeSpacing',
  'browDensity',
  'browShape',
] as const
export type ConsultProfileField = (typeof CONSULT_PROFILE_FIELDS)[number]

const PROFILE_FIELD_VALUES: Readonly<
  Record<ConsultProfileField, readonly string[]>
> = {
  skinUndertone: CONSULT_PROFILE_UNDERTONES,
  contrastLevel: CONSULT_PROFILE_CONTRASTS,
  colorSeason: CONSULT_PROFILE_COLOR_SEASONS,
  faceProportion: CONSULT_PROFILE_FACE_PROPORTIONS,
  jawline: CONSULT_PROFILE_JAWLINES,
  foreheadProportion: CONSULT_PROFILE_FOREHEADS,
  featureBalance: CONSULT_PROFILE_FEATURE_BALANCES,
  eyeShape: CONSULT_PROFILE_EYE_SHAPES,
  eyeSpacing: CONSULT_PROFILE_EYE_SPACINGS,
  browDensity: CONSULT_PROFILE_BROW_DENSITIES,
  browShape: CONSULT_PROFILE_BROW_SHAPES,
}

export const CONSULT_STYLE_DOMAINS = [
  'HAIR_COLOR_HARMONY',
  'CUT_AND_SHAPE',
  'BANGS',
  'BROWS',
  'LASHES',
  'MAKEUP',
  'COLOR_PALETTE',
] as const
export type ConsultStyleDomain = (typeof CONSULT_STYLE_DOMAINS)[number]

type ConfidenceRange = { min: number; max: number }
type Evidence = EvidenceKey[]

type ProfileObservation<T extends string> = {
  value: T
  confidence: ConfidenceRange
  evidence: Evidence
}

export type ConsultAnalysisFeatureProfile = {
  skinUndertone: ProfileObservation<(typeof CONSULT_PROFILE_UNDERTONES)[number]>
  contrastLevel: ProfileObservation<(typeof CONSULT_PROFILE_CONTRASTS)[number]>
  colorSeason: ProfileObservation<(typeof CONSULT_PROFILE_COLOR_SEASONS)[number]>
  faceProportion: ProfileObservation<
    (typeof CONSULT_PROFILE_FACE_PROPORTIONS)[number]
  >
  jawline: ProfileObservation<(typeof CONSULT_PROFILE_JAWLINES)[number]>
  foreheadProportion: ProfileObservation<
    (typeof CONSULT_PROFILE_FOREHEADS)[number]
  >
  featureBalance: ProfileObservation<
    (typeof CONSULT_PROFILE_FEATURE_BALANCES)[number]
  >
  eyeShape: ProfileObservation<(typeof CONSULT_PROFILE_EYE_SHAPES)[number]>
  eyeSpacing: ProfileObservation<(typeof CONSULT_PROFILE_EYE_SPACINGS)[number]>
  browDensity: ProfileObservation<(typeof CONSULT_PROFILE_BROW_DENSITIES)[number]>
  browShape: ProfileObservation<(typeof CONSULT_PROFILE_BROW_SHAPES)[number]>
}

export type ConsultStyleDirection = {
  domain: ConsultStyleDomain
  title: string
  direction: string
  whyItFlatters: string
  confidence: ConfidenceRange
  evidence: Evidence
  discussWithProfessional: true
}

/**
 * The hair core, as v5 reports it.
 *
 * `baseLevel` and `lightestLevel` replace v3's `currentLevel: {min, max}`.
 * They are the two named ends of the head — root/darkest and lightest — not a
 * spread, and a solid single-process honestly reports the same value in both.
 * How SURE the read is stays where it always was, in each observation's own
 * confidence range (lib/consult/hairLevel.ts explains why the old pair was
 * ambiguous and what it rendered as).
 */
export type ConsultAnalysisCore = {
  baseLevel: {
    value: ConsultHairLevel
    confidence: ConfidenceRange
    evidence: Evidence
  }
  lightestLevel: {
    value: ConsultHairLevel
    confidence: ConfidenceRange
    evidence: Evidence
  }
  currentTone: {
    value: (typeof CONSULT_ANALYSIS_TONES)[number]
    confidence: ConfidenceRange
    evidence: Evidence
  }
  visibleCondition: {
    value: (typeof CONSULT_ANALYSIS_CONDITIONS)[number]
    confidence: ConfidenceRange
    evidence: Evidence
  }
  density: {
    value: (typeof CONSULT_ANALYSIS_DENSITIES)[number]
    confidence: ConfidenceRange
    evidence: Evidence
  }
  texture: {
    value: (typeof CONSULT_ANALYSIS_TEXTURES)[number]
    confidence: ConfidenceRange
    evidence: Evidence
  }
}

export const CONSULT_ANALYSIS_CORE_FIELDS = [
  'baseLevel',
  'lightestLevel',
  'currentTone',
  'visibleCondition',
  'density',
  'texture',
] as const


export type ConsultAnalysisProviderOutput = {
  profile: ConsultAnalysisFeatureProfile
  styleDirections: ConsultStyleDirection[]
  core: ConsultAnalysisCore
  serviceLens: {
    goal: string
    history: string
    constraints: string
    maintenance: string
    appointmentContext: string
    achievability: (typeof CONSULT_ANALYSIS_ACHIEVABILITY)[number]
    achievabilityReason: string
    discussWithProfessional: true
  }
  safetyFlags: Array<{
    code: ConsultAnalysisSafetyCode
    summary: string
    discussWithProfessional: true
  }>
  recommendations: Array<{
    serviceIntent: ConsultAnalysisServiceIntent
    /** The menu service named, exactly as the menu names it; null unless SERVICE. */
    serviceName: string | null
    title: string
    rationale: string
    achievability: string
    discussWithProfessional: true
  }>
}

/**
 * What the consult is FOR — read off the session's service profile
 * (lib/consult/serviceProfile.ts) and the professional's menu. Sent to the
 * provider in words and used to build the per-run recommendation enum.
 */
export type ConsultAnalysisServiceContext = {
  family: ConsultServiceFamily
  categoryName: string
  /** The service the look or booking names, when it has one. */
  serviceName: string | null
  /** The professional's active menu in this category, by exact name. */
  menuServiceNames: readonly string[]
}

export type ConsultAnalysisIntakeItem = {
  questionKey: string
  question: string
  answerCode: string
  answer: string
}

export type ConsultAnalysisInput = {
  service: ConsultAnalysisServiceContext
  /** Answer codes by question key — the immutable stored form. */
  intake: Readonly<Record<string, string>>
  /** The same answers as the labels the client saw, in pack order. */
  intakeItems: readonly ConsultAnalysisIntakeItem[]
  /** The shot pack this session served: which views can exist at all. */
  capturePack: { id: string; shotKeys: readonly ConsultCaptureShotKeyDTO[] }
  captures: ReadonlyArray<{
    shotKey: ConsultCaptureShotKeyDTO
    image: ConsultCaptureImage
    /**
     * The colour finding the capture gate recorded on this frame without
     * blocking it (lib/consult/captureVision.ts). Present means the light on
     * this view is not fully trustworthy — the prompt says so, so a warm
     * reading from a warm room does not become a confident tone observation.
     */
    qualityWarningCode: ConsultCaptureQualityWarningCodeDTO | null
  }>
  /** P4: the client's inspiration reference, as READ, not as an image. */
  inspiration: ConsultAnalysisInspirationInput
  /**
   * The ONLY safety codes this consult's intake can support
   * (lib/consult/safetyFlags.ts), plus VISIBLE_COMPROMISE, which the model
   * alone can raise. Narrows the schema's `code` enum for this run, exactly as
   * `menuServiceNames` narrows the recommendation enum.
   */
  safetyCodes: readonly ConsultAnalysisSafetyCode[]
}

/**
 * What the analysis is told about the picture the client brought.
 *
 * `analysis` is the structured Stage 1 read (lib/consult/inspirationVision.ts)
 * — deliberately NOT the image itself. The reference photograph is a picture
 * of somebody else; sending it beside the client's own capture pack invites
 * the model to describe or compare two people, and every feature observation
 * in the output schema is about the CLIENT. The attribute set carries
 * everything the recommendation needs and none of that risk.
 *
 * `answers` are the client's existing v1 guided-inspiration answers — what she
 * said she liked about it — which ride alongside so the model sees the picture
 * and her words about it together.
 *
 * `analysis` is null only when the client chose to bring no reference at all
 * (source NONE). That is an absence, not a failure: a failed read never
 * reaches here, it surfaces (Part 0 rule 4).
 */
export type ConsultAnalysisInspirationInput = {
  source: ConsultInspirationSourceDTO
  analysis: ConsultInspirationAnalysis | null
  answers: readonly { question: string; answer: string }[]
}

export type ConsultAnalysisProviderResult = {
  analysis: ConsultAnalysisProviderOutput
  model: string
}

export type ConsultAnalysisProvider = (
  input: ConsultAnalysisInput,
) => Promise<ConsultAnalysisProviderResult>

export class ConsultAnalysisProviderError extends Error {
  constructor(readonly kind: 'unavailable' | 'refused' | 'bad_output') {
    super('Consult analysis is unavailable.')
    this.name = 'ConsultAnalysisProviderError'
  }
}

// ── Structured-output schemas ───────────────────────────────────────────────
//
// 🔴 Read lib/consult/providerSchema.ts before changing anything here. The
// compiled grammar has a size budget and this schema was over it in TWO
// independent ways, so no analysis has ever completed against the live model.
//
// The measurements that shaped what follows (claude-sonnet-5, 2026-09-04,
// expressed in a neutral unit — one required property holding an enum — of
// which a schema may carry about 72):
//
//   enum, whether 5 members or 40 ........................ 1
//   string, unbounded or maxLength 120 or 400 ............ 1
//   `const`, a number, an integer ........................ 1
//   nullable integer, pattern-constrained string ......... 2
//   array of enum, whatever the cap ...................... 3
//   `confidence: {min, max}` ............................. 3
//   a whole observation, INLINE .......................... 8
//   the same observation behind `$ref`, per extra site ... 1
//
// Two consequences, both counter-intuitive, both measured:
//   * VOCABULARY IS FREE. A forty-member enum costs exactly what a five-member
//     one does, and `maxLength` costs nothing at all. Nothing was ever bought
//     by shortening an enum, and the level scale is carried as an eleven-member
//     enum for precisely this reason.
//   * STRUCTURE IS THE WHOLE COST, and `$defs` + `$ref` DEDUPE it. Eleven
//     inline copies of the observation shape are refused; eleven `$ref`s to one
//     `$def` compile, and so do thirty. An UNREFERENCED `$def` still costs its
//     full price (7 units measured), so nothing dead is left in here.
//
// Even so, the eleven-field profile plus the six core observations plus seven
// style directions do not fit in ONE call under any arrangement — see the v5
// note at the top of this file. Hence two schemas.

const CONFIDENCE_REF = { $ref: '#/$defs/confidence' }
const EVIDENCE_REF = { $ref: '#/$defs/evidence' }
const CITED_EVIDENCE_REF = { $ref: '#/$defs/citedEvidence' }
const HAIR_EVIDENCE_REF = { $ref: '#/$defs/hairEvidence' }

/**
 * 🔴 The `description` is the ONLY thing that carries this field's scale to
 * the model, and it is load-bearing.
 *
 * `minimum` and `maximum` are stripped at the boundary — the API refuses them
 * on a number (lib/consult/providerSchema.ts) — so a bare `{type: 'number'}`
 * says nothing about what range is meant. Measured against the live model on
 * 2026-09-04, that is not theoretical: every observation came back
 * `{"min": 0, "max": 10}`, the model having reasonably assumed a ten-point
 * scale, and `sanitizeAnalysis` refused the lot as `bad_output`. A `description`
 * IS accepted by the validator and costs nothing in the grammar budget, so the
 * range travels with the field rather than living only in a prompt sentence
 * somebody can reword.
 */
const CONFIDENCE_DEF = {
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
 * The evidence labels this run may cite: the views ACTUALLY SUPPLIED, plus the
 * intake. Not the whole vocabulary.
 *
 * 🔴 Citing a view that was never sent is a fabricated observation, and
 * `assertEvidenceSupplied` throws the entire analysis away for one — correctly,
 * since a partial pack is a supported state and the alternative is a consult
 * that reasons about a photograph it never saw. But the schema used to offer
 * every label regardless, and the prompt alone said "cite only what was
 * supplied". Measured on 2026-09-04: a live run with four hair views cited
 * `eyes_closeup`, and a complete paid consult was discarded. Enum members cost
 * nothing, so the labels that do not exist this run simply are not offered.
 */
function evidenceLabelsFor(
  suppliedShotKeys: readonly ConsultCaptureShotKeyDTO[],
): ConsultAnalysisEvidenceDTO[] {
  const supplied = new Set<string>(suppliedShotKeys)
  const labels = CONSULT_ANALYSIS_EVIDENCE_KEYS.filter(
    (label) => label === 'intake' || supplied.has(label),
  )
  // A run always supplies at least one capture, so this is never bare
  // `intake` alone by accident — but if it somehow were, an empty enum is not
  // a valid schema, and the server check remains the real guarantee.
  return labels.length > 0 ? [...labels] : [...CONSULT_ANALYSIS_EVIDENCE_KEYS]
}

/** The hair views actually supplied — the only ones a LEVEL may be read from. */
function hairEvidenceLabelsFor(
  suppliedShotKeys: readonly ConsultCaptureShotKeyDTO[],
): string[] {
  const supplied = new Set<string>(suppliedShotKeys)
  const labels = CONSULT_ANALYSIS_HAIR_EVIDENCE_KEYS.filter((label) =>
    supplied.has(label),
  )
  // No hair view supplied: nothing can honestly be cited, so both levels must
  // come back UNKNOWN with empty evidence. The vocabulary stays whole only
  // because an empty enum is invalid; the sanitizer still refuses a citation.
  return labels.length > 0 ? [...labels] : [...CONSULT_ANALYSIS_HAIR_EVIDENCE_KEYS]
}

/** May be empty: that is how an UNKNOWN observation says it read nothing. */
function evidenceDef(suppliedShotKeys: readonly ConsultCaptureShotKeyDTO[]) {
  const labels = evidenceLabelsFor(suppliedShotKeys)
  return {
    type: 'array',
    maxItems: labels.length,
    uniqueItems: true,
    items: { type: 'string', enum: labels },
  }
}

const EVIDENCE_DEF = evidenceDef(CONSULT_ALL_CAPTURE_SHOT_KEYS)

/**
 * The same vocabulary, but at least one label — a style direction that cites
 * nothing is an unsupported claim and `sanitizeStyleDirections` refuses it.
 *
 * 🔴 A SECOND def rather than one shared with `EVIDENCE_DEF`, and the reason is
 * measured. Hoisting evidence into a single `$def` quietly dropped the
 * `minItems: 1` that v3 stated inline here, and the live model took the
 * permission: five of seven style directions came back citing nothing, so the
 * sanitizer refused the whole consult (claude-sonnet-5, 2026-09-04). `minItems`
 * survives the boundary at exactly 0 or 1 (lib/consult/providerSchema.ts), so
 * this is one of the few bounds the grammar itself can still enforce — and the
 * only one standing between "cite your evidence" and a paid call thrown away.
 */
const CITED_EVIDENCE_DEF = { ...EVIDENCE_DEF, minItems: 1 }

function citedEvidenceDef(suppliedShotKeys: readonly ConsultCaptureShotKeyDTO[]) {
  return { ...evidenceDef(suppliedShotKeys), minItems: 1 }
}

function hairEvidenceDef(suppliedShotKeys: readonly ConsultCaptureShotKeyDTO[]) {
  const labels = hairEvidenceLabelsFor(suppliedShotKeys)
  return {
    type: 'array',
    maxItems: labels.length,
    uniqueItems: true,
    items: { type: 'string', enum: labels },
  }
}

/**
 * One style direction, minus its domain — the key carries that (see the
 * `styleDirections` property below). Shared, so seven reference sites cost
 * seven units instead of seven copies.
 */
const STYLE_DIRECTION_DEF = {
  type: 'object',
  additionalProperties: false,
  required: [
    'title',
    'direction',
    'whyItFlatters',
    'confidence',
    'evidence',
    'discussWithProfessional',
  ],
  properties: {
    title: boundedText(120, 'A short name for the direction.'),
    direction: boundedText(400, 'The direction itself, to discuss with the professional.'),
    whyItFlatters: boundedText(400, 'The specific observed features it builds on.'),
    confidence: CONFIDENCE_REF,
    evidence: CITED_EVIDENCE_REF,
    discussWithProfessional: { const: true },
  },
}

const HAIR_EVIDENCE_DEF = {
  type: 'array',
  maxItems: CONSULT_ANALYSIS_HAIR_EVIDENCE_KEYS.length,
  uniqueItems: true,
  items: { type: 'string', enum: [...CONSULT_ANALYSIS_HAIR_EVIDENCE_KEYS] },
}

/**
 * A length-bounded free-text field.
 *
 * 🔴 `maxLength` is ACCEPTED by the structured-output validator — unlike
 * `minimum`/`maxItems`, it is not stripped at the boundary — and that is
 * exactly what makes it dangerous: it looks enforced and is not. Measured on
 * 2026-09-04, a live direction call returned `appointmentContext` at 255
 * characters against `maxLength: 240` and `achievabilityReason` at 329 against
 * 320, and `cleanText` threw the whole consult away after the call was billed.
 *
 * So the limit is stated where the model actually reads it. This is the same
 * repair the confidence range needed: a bound the grammar will not hold has to
 * travel in the `description`, which costs nothing in the size budget. The
 * server check stays as the backstop — it is what makes the bound true.
 */
function boundedText(maxLength: number, what: string) {
  return {
    type: 'string',
    // 🔴 `minLength: 1` because `required` only forces the key to EXIST.
    // Keying the style directions by domain made all seven present — and the
    // live model, with no face views to read, satisfied that by returning ""
    // for BROWS, LASHES, MAKEUP and COLOR_PALETTE (2026-09-04). Forcing
    // presence does not force substance. `cleanText` refuses an empty string,
    // correctly: an empty direction is not a direction.
    minLength: 1,
    maxLength,
    description: `${what} HARD LIMIT: at most ${maxLength} characters, counted as characters and not words. Going over is not truncated, it is rejected — say less rather than more. NEVER return an empty string: if you have nothing to say here, say THAT, in a sentence.`,
  }
}

/**
 * One observation: a value from `values`, how sure, and what it was read off.
 * `evidence` defaults to the full label set; the level fields pass the
 * hair-only one, because a level read off a face view is not a level.
 */
function observationSchema(
  values: readonly string[],
  evidence: Record<string, unknown> = EVIDENCE_REF,
) {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['value', 'confidence', 'evidence'],
    properties: {
      value: { type: 'string', enum: [...values] },
      confidence: CONFIDENCE_REF,
      evidence,
    },
  }
}

/**
 * The recommendation enum the provider chooses from on THIS run: the
 * professional's menu in the consult's category, by exact name, plus the one
 * fixed consultation option. Built per run because the menu is per pro; the
 * default export below (no menu) is the shape the tests and the schema check
 * pin. Menu size is free — a forty-name enum costs what a two-name one does.
 */
export function recommendationServiceOptions(
  menuServiceNames: readonly string[],
): string[] {
  const names = new Set<string>()
  for (const name of menuServiceNames) {
    const trimmed = name.trim()
    if (trimmed && trimmed !== CONSULT_ANALYSIS_CONSULTATION_OPTION) names.add(trimmed)
  }
  return [...names, CONSULT_ANALYSIS_CONSULTATION_OPTION]
}

/**
 * Call 1 of 2 — the feature profile (Stage 3b): what will flatter this client.
 * Measured at 50 of the ~72-unit budget.
 */
export function buildConsultProfileOutputSchema(args: {
  suppliedShotKeys: readonly ConsultCaptureShotKeyDTO[]
}): Record<string, unknown> {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['profile'],
    properties: {
      profile: {
        type: 'object',
        additionalProperties: false,
        required: [...CONSULT_PROFILE_FIELDS],
        properties: Object.fromEntries(
          CONSULT_PROFILE_FIELDS.map((field) => [
            field,
            observationSchema(PROFILE_FIELD_VALUES[field]),
          ]),
        ),
      },
    },
    $defs: {
      confidence: CONFIDENCE_DEF,
      evidence: evidenceDef(args.suppliedShotKeys),
    },
  }
}

/**
 * Call 2 of 2 — the direction (Stages 3 and 4): where she is starting from,
 * what it means for this service, and what to book. The profile from call 1
 * rides in as text, not as a field to be filled again.
 * Measured at 63 of the ~72-unit budget.
 */
/**
 * The safety codes the provider may name on THIS run.
 *
 * 🔴 Not a filter applied afterwards — the enum itself. On every intake pack
 * the policy's supported set IS its required set: "the intake either demands
 * it or cannot support it" (lib/consult/safetyFlags.ts). So a code outside
 * that set is not a judgement call the model gets to make; it is a fabricated
 * concern, and `applyConsultSafetyFlagPolicy` throws the ENTIRE analysis away
 * for one. Measured on 2026-09-04: a live run raised CHEMICAL_HISTORY_UNKNOWN
 * on an intake that had answered its chemical questions, and a complete,
 * correct, fully-paid-for consult was discarded at the last step.
 *
 * VISIBLE_COMPROMISE is always available because it is the one code the
 * PHOTOS raise rather than the intake — the policy requires it exactly when
 * the model's own `visibleCondition` says POSSIBLE_COMPROMISE. Its presence
 * also keeps the enum non-empty, which an intake with no triggers would
 * otherwise leave it.
 */
export function consultAnalysisSafetyCodeOptions(
  supportedByIntake: readonly ConsultAnalysisSafetyCode[],
): ConsultAnalysisSafetyCode[] {
  const codes = new Set<ConsultAnalysisSafetyCode>(supportedByIntake)
  codes.add('VISIBLE_COMPROMISE')
  // Fixed order, so the schema is stable for a given intake.
  return CONSULT_ANALYSIS_SAFETY_CODES.filter((code) => codes.has(code))
}

export function buildConsultDirectionOutputSchema(args: {
  menuServiceNames: readonly string[]
  safetyCodes: readonly ConsultAnalysisSafetyCode[]
  suppliedShotKeys: readonly ConsultCaptureShotKeyDTO[]
}): Record<string, unknown> {
  return {
    type: 'object',
    additionalProperties: false,
    required: [
      'core',
      'styleDirections',
      'serviceLens',
      'safetyFlags',
      'recommendations',
    ],
    properties: {
      core: {
        type: 'object',
        additionalProperties: false,
        required: [...CONSULT_ANALYSIS_CORE_FIELDS],
        properties: {
          baseLevel: observationSchema(CONSULT_HAIR_LEVELS, HAIR_EVIDENCE_REF),
          lightestLevel: observationSchema(CONSULT_HAIR_LEVELS, HAIR_EVIDENCE_REF),
          currentTone: observationSchema(CONSULT_ANALYSIS_TONES),
          visibleCondition: observationSchema(CONSULT_ANALYSIS_CONDITIONS),
          density: observationSchema(CONSULT_ANALYSIS_DENSITIES),
          texture: observationSchema(CONSULT_ANALYSIS_TEXTURES),
        },
      },
      // 🔴 An OBJECT KEYED BY DOMAIN, not an array of seven — and this is the
      // only shape that can be enforced.
      //
      // v3 asked for an array with `minItems: 7, maxItems: 7`. BOTH are
      // stripped at the boundary: `maxItems` is rejected outright and
      // `minItems` survives only at 0 or 1 (lib/consult/providerSchema.ts), so
      // the grammar never constrained the count at all and "exactly one per
      // domain" lived only in a prompt sentence. Measured on 2026-09-04, the
      // live model duly returned fewer than seven and `sanitizeStyleDirections`
      // threw away the whole paid consult.
      //
      // `required` on an object is NOT stripped. Keying by domain makes seven
      // mean seven, makes a duplicate domain unrepresentable, and drops the
      // `domain` field from the payload since the key already carries it. The
      // stored artefact is still the ordered ARRAY every reader expects —
      // `sanitizeStyleDirections` turns the object into it, in domain order,
      // which is the ordering it used to have to impose by hand.
      styleDirections: {
        type: 'object',
        additionalProperties: false,
        required: [...CONSULT_STYLE_DOMAINS],
        properties: Object.fromEntries(
          CONSULT_STYLE_DOMAINS.map((domain) => [
            domain,
            { $ref: '#/$defs/styleDirection' },
          ]),
        ),
      },
      serviceLens: {
        type: 'object',
        additionalProperties: false,
        required: [
          'goal',
          'history',
          'constraints',
          'maintenance',
          'appointmentContext',
          'achievability',
          'achievabilityReason',
          'discussWithProfessional',
        ],
        properties: {
          goal: boundedText(240, 'What the client is after, for this service.'),
          history: boundedText(320, 'The history that bears on this service.'),
          // 🔴 These two are checked for a LITERAL WORD, not for meaning.
          // `applyConsultSafetyFlagPolicy` requires the phrase "unknown", "not
          // collected" or "not provided" whenever the intake did not ask —
          // and the database guard mirrors the same three. Measured on
          // 2026-09-04, the live model wrote "was not asked in the intake" and
          // "were not captured in the intake": honest, accurate, and refused,
          // discarding a complete paid analysis. It complied with the intent
          // and failed the letter, because only the intent had been stated. So
          // the letter is stated here, in the one place the model reads.
          constraints: boundedText(
            240,
            'A SENTENCE about the constraints that bear on this service. Where the intake did not ask, that sentence must contain the literal word "unknown" — a synonym like "not asked" or "not captured" is rejected — but still write the sentence: e.g. "Allergy history and budget were not collected, so they are unknown." Never answer with the bare word.',
          ),
          maintenance: boundedText(
            240,
            'A SENTENCE about the upkeep this service needs. Where the intake did not ask about maintenance tolerance, that sentence must contain the literal word "unknown" — a synonym like "not asked" or "not captured" is rejected — but still write the sentence, including what the professional should raise: e.g. "Maintenance tolerance is unknown; discuss toner upkeep at the appointment." Never answer with the bare word.',
          ),
          appointmentContext: boundedText(240, 'Timing and budget context from the intake.'),
          achievability: {
            type: 'string',
            enum: [...CONSULT_ANALYSIS_ACHIEVABILITY],
          },
          achievabilityReason: boundedText(320, 'Why that achievability, in one or two sentences.'),
          discussWithProfessional: { const: true },
        },
      },
      safetyFlags: {
        type: 'array',
        maxItems: CONSULT_ANALYSIS_SAFETY_CODES.length,
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['code', 'summary', 'discussWithProfessional'],
          properties: {
            code: {
              type: 'string',
              enum: consultAnalysisSafetyCodeOptions(args.safetyCodes),
            },
            summary: boundedText(240, 'What the concern is and why it is raised.'),
            discussWithProfessional: { const: true },
          },
        },
      },
      recommendations: {
        type: 'array',
        minItems: 1,
        maxItems: 3,
        // 🔴 TWO is the real minimum, and the grammar cannot say so: `minItems`
        // survives this boundary only at 0 or 1
        // (lib/consult/providerSchema.ts). The client results screen refuses
        // to serve fewer than two recommendation directions
        // (`requireClientResultFraming`), so a one-item answer produces a
        // consult that completes, stores, and then cannot be shown to the
        // client who paid for it. Measured on 2026-09-04: three consecutive
        // live runs each returned exactly one. Hence the description and the
        // prompt rule; the array bound is the most the schema can carry.
        description:
          'TWO or three recommendations — never one. Naming a service from the menu AND the consultation option is a valid, complete pair, and is the right answer whenever only one menu service fits.',
        items: {
          type: 'object',
          additionalProperties: false,
          required: [
            'service',
            'title',
            'rationale',
            'achievability',
            'discussWithProfessional',
          ],
          properties: {
            service: {
              type: 'string',
              enum: recommendationServiceOptions(args.menuServiceNames),
            },
            title: boundedText(120, 'A short name for the recommendation.'),
            rationale: boundedText(320, 'Why this service, grounded in the profile and the read.'),
            achievability: boundedText(240, 'What the professional still decides in person.'),
            discussWithProfessional: { const: true },
          },
        },
      },
    },
    $defs: {
      confidence: CONFIDENCE_DEF,
      evidence: evidenceDef(args.suppliedShotKeys),
      citedEvidence: citedEvidenceDef(args.suppliedShotKeys),
      hairEvidence: hairEvidenceDef(args.suppliedShotKeys),
      styleDirection: STYLE_DIRECTION_DEF,
    },
  }
}

/** The profile schema, which takes no per-run input. */
export const CONSULT_ANALYSIS_PROFILE_OUTPUT_SCHEMA: Record<string, unknown> =
  buildConsultProfileOutputSchema({ suppliedShotKeys: CONSULT_ALL_CAPTURE_SHOT_KEYS })

/**
 * The direction schema with no menu and no intake-supported codes: only the
 * consultation option is recommendable and only VISIBLE_COMPROMISE is
 * raisable. The shape the schema tests and the DB guards pin.
 */
export const CONSULT_ANALYSIS_DIRECTION_OUTPUT_SCHEMA: Record<string, unknown> =
  buildConsultDirectionOutputSchema({
    menuServiceNames: [],
    safetyCodes: [],
    suppliedShotKeys: CONSULT_ALL_CAPTURE_SHOT_KEYS,
  })

// ── The two system prompts ──────────────────────────────────────────────────
// Both calls see the same photographs and the same consultation context. What
// differs is the question. Everything either call is allowed to say about a
// person, and everything neither may ever say, is stated in both — a rule that
// lives in only one of two prompts is a rule that applies half the time.

const SHARED_CONDUCT = [
  'Never infer or mention identity, ethnicity, race, nationality, religion, gender, age, health conditions, or diagnoses. Every observation you make is a cosmetic styling descriptor only.',
  'Unknown or unsupported observations must use UNKNOWN with empty evidence and a low confidence range. Every non-unknown observation must cite one or more supplied evidence labels and use a confidence range rather than certainty. If a view is occluded, filtered, or poorly lit, prefer UNKNOWN over a guess.',
  'Every confidence range is TWO DECIMALS BETWEEN 0 AND 1 — for example {"min": 0.45, "max": 0.7}. Not a percentage, not a score out of 10. `min` must be strictly less than `max`. An UNKNOWN needs a max of 0.35 or lower.',
  'Cite only evidence labels that were actually supplied in this request; never cite a missing view. Any observation that depends mainly on a missing view must be UNKNOWN with a low confidence range. With fewer views, widen confidence ranges and say less, never more.',
  'Never output database identifiers, paths, credentials, hidden reasoning, or provider metadata.',
]

/**
 * Call 1 — the feature profile (Stage 3b). Deliberately narrow: it is handed
 * the same photographs but asked only what would flatter this client, so the
 * eleven observations are made without the pull of a service to sell.
 */
export const CONSULT_ANALYSIS_PROFILE_SYSTEM_PROMPT = [
  'You are a cosmetic-only feature-analysis engine for a professional beauty platform.',
  'Inputs: a consultation context naming the service family, the service category and the capture pack this consult uses; the client’s intake as the questions and answers she saw; and one or more labeled daylight photos from that pack — hair views (hair_back, hair_left, hair_right, hair_crown), face views (face_front, face_side, eyes_closeup), or treatment-area views (area_wide, area_closeup). The client may submit a partial pack; when views are missing, a text line names them.',
  'You produce ONE thing: the feature profile — eleven cosmetic observations about THIS client, each with a confidence range and the views you read it from.',
  'The question you are answering is not "what does she want" and not "what should she book". It is "what will actually flatter this person": the observations another engine will use to ground every later recommendation.',
  ...SHARED_CONDUCT,
  'Skin undertone and colour season read from phone photos are approximate even in daylight: widen those confidence ranges, and never report either with high confidence from a single view.',
  'Contrast is the backbone of the profile: judge it between skin, hair and eyes together, not from one of them.',
  'Face proportion, jawline and forehead proportion describe the balance of the face as a whole; feature balance describes whether the features read soft, blended or structured.',
  'Eye shape, eye spacing, brow density and brow shape read from the eyes_closeup view where one is supplied, and from face_front otherwise; if neither is supplied they are UNKNOWN.',
  'A capture may be labelled with a colour warning. That view passed the quality gate but its light is not trustworthy for colour: widen the confidence range on any observation that leans on it — undertone, season and contrast especially — and prefer a view without a warning when one is supplied.',
  'Do not describe the client’s inspiration reference, her goal, or any service. You are not being asked what to do about her hair.',
].join(' ')

/**
 * Call 2 — the direction (Stages 3 and 4). The profile is already settled and
 * arrives as text; this call reads where she is starting from and says what it
 * means for the named service.
 */
export const CONSULT_ANALYSIS_DIRECTION_SYSTEM_PROMPT = [
  'You are a cosmetic-only styling consultation engine for a professional beauty platform.',
  'Inputs: a consultation context naming the service family, the service category, the specific service the client is considering when one is known, the professional’s menu in that category, and the capture pack this consult uses; the client’s intake as the questions and answers she saw (with their immutable option codes); one or more labeled daylight photos from that pack; a reading of the client’s INSPIRATION reference; and the client’s FEATURE PROFILE, already established from these same photographs by an earlier pass.',
  'The feature profile is given to you as settled fact. Do not re-derive it, do not contradict it, and do not restate it as though it were your own observation. Use it: every style direction and every recommendation must lean on the specific profile fields that support it, and a field the profile marked UNKNOWN is not available to lean on.',
  'You produce: the hair core observations, exactly one style direction per domain (HAIR_COLOR_HARMONY, CUT_AND_SHAPE, BANGS, BROWS, LASHES, MAKEUP, COLOR_PALETTE), a service lens, safety flags, and service recommendations.',
  'The hair core is two levels and four observations. baseLevel is the depth at the root — the darkest dominant colour on the head. lightestLevel is the lightest dominant colour, wherever it sits. They are two separate readings, not a range: a solid single-process has the SAME value in both, and reporting them equal is the correct answer, not a failure. Balayage, highlights and a grown-out root are where they differ. How sure you are goes in each observation’s confidence range, never into the gap between the two levels. Both read from the hair views only.',
  'Everything you write is FOR the named service. The service lens describes the client’s goal, history, constraints, maintenance and appointment context as they bear on THAT service; recommendations are services from the professional’s menu (named exactly as the menu names them) or a consultation with the professional; the hair core observations are filled from the hair views when hair is the subject and set to UNKNOWN when it is not.',
  ...SHARED_CONDUCT,
  'You are also given what the client brought as INSPIRATION: a structured reading of her reference photograph (its base and lightest level, tone, technique, placement, root blend, finish and dimension, each with a confidence range) and, in her own words, what she said she liked about it. You are NOT given the reference image; the reading is what you have of it.',
  'The inspiration reading describes SOMEONE ELSE’S hair — it is the destination, never an observation about this client. Never let it colour the hair core observations, which are about the client and come only from her own photos. Where an attribute of the reference was read as UNKNOWN, or with a low confidence range, treat it as not established and say so rather than filling the gap.',
  'The reference and the client’s words about it are the goal the service lens and the recommendations are FOR. Where her words and the reading disagree — she asked for the length but the reading is mostly about colour — her words win, and the gap is worth naming for the professional.',
  'Rubric — recommend what harmonizes with the observed features, never what is merely trending:',
  'Contrast is the backbone: low contrast between skin, hair, and eyes favors soft, blended color and diffused makeup; high contrast carries bold, saturated color and defined lines.',
  'Undertone and season guide hair-color tone, makeup color families, and the COLOR_PALETTE direction; name palette families in plain words, and frame every palette direction as a starting point the professional confirms in person with physical draping.',
  'Face proportions guide CUT_AND_SHAPE and BANGS: a longer face or taller forehead is balanced by bangs and width around the face; a wider face is elongated by length, crown height, and longer layers; an angular jawline is softened by soft perimeters and movement; softly rounded features gain definition from structure. When bangs would not serve the observed proportions, say so plainly — BETTER WITHOUT is a valid direction.',
  'Feature balance guides MAKEUP: soft features suit diffused, blended application; structured features carry defined lines; blended features can move either way.',
  'Eye shape and spacing guide LASHES: hooded or monolid eyes favor lifted curls that open the lid; downturned eyes favor lifted outer corners; round eyes favor lengthening through the center; deep-set eyes favor longer centers and lighter inner corners; close-set eyes favor outer emphasis; wide-set eyes favor inner-to-center emphasis.',
  'BROWS work with the natural density and existing shape, anchored to the face’s own proportions; never direct chemical brow or lash treatments.',
  'Hair texture, density, and the two levels bound which cuts and colors will actually behave well; honor them in CUT_AND_SHAPE and HAIR_COLOR_HARMONY.',
  'Every style direction’s whyItFlatters must name the specific observed feature or features it builds on. Style directions are directions to discuss with the professional, never promises and never treatment prescriptions.',
  'You owe a direction for all seven domains, including the ones this pack cannot show you. When the supplied views do not support a domain — brows, lashes and makeup are the usual ones when only hair was sent — the honest direction is to SAY SO: name what could not be assessed, say it is one to look at together in person, cite "intake", and use a low confidence range. That is a real, useful answer. What is never acceptable is an empty string, a placeholder, or a direction invented from views you were not given: an empty field discards the entire analysis.',
  'A capture may be labelled with a colour warning. That view passed the quality gate but its light is not trustworthy for colour: widen the confidence range on any tone or level observation that leans on it, and prefer a view without a warning when one is supplied.',
  'For the service lens: combine visible evidence with the client’s stated goal, treatment and chemical history, prior reactions, sensitivities, budget and event context. If maintenance tolerance, allergies, or other constraints were not asked in the intake, say they are unknown; never invent them. When the service is hair colour, the history covers box dye, prior lightening and the last colour service.',
  'That last rule is checked for a LITERAL WORD. Where the intake did not ask, the constraints and maintenance sentences must contain the exact word "unknown" (or the exact phrase "not collected" or "not provided"). "Not asked", "not captured" and "not recorded" mean the same thing to a reader and are REJECTED — they discard the entire analysis. Write a full, useful sentence that happens to contain the word "unknown"; never reduce the field to that word on its own, because the professional reads it.',
  'Visible condition is a cosmetic visual observation only. Never diagnose hair, scalp, skin, or medical conditions.',
  'All chemical, reaction, allergy, sensitivity, unknown-history, or visibly compromised-hair concerns must be structurally represented in safetyFlags and framed for discussion with the professional.',
  'The safetyFlags `code` list you are given is not a menu of everything that could ever matter — it is exactly the set THIS client’s intake can support, and a code missing from it means the intake already answered that question. Raise only what the intake or the photos actually evidence. A flag the intake cannot back is a concern invented about a real person, and it invalidates the whole analysis.',
  'Recommendations are bounded directions to discuss with the professional, never promises. Name each recommended service exactly as the menu lists it, or choose the consultation option.',
  'Give TWO or three recommendations. One is not enough: the client is shown a choice, and a single-item answer cannot be served to her at all. When only one menu service really fits, pair it with the consultation option — that is a complete and honest pair, not padding.',
  'Every free-text field states a HARD CHARACTER LIMIT in its description. Those limits are enforced after you answer: a field one character over is not trimmed, it discards the entire analysis. Write to comfortably inside the limit — a shorter, plainer sentence is always the safer answer than a full one.',
].join(' ')

// Schema v2 deliberately removed skin-tone/undertone/face-shape/eye-shape from
// this list (they are now first-class cosmetic observations, per the 2026-08-26
// decision record). Identity, ethnicity, age, and medical language remain
// forbidden in every free-text field.
const FORBIDDEN_LANGUAGE = /\b(diagnos(?:e|is|ed|tic)|dermatolog(?:y|ist|ical)|disease|disorder|infection|psoriasis|eczema|alopecia|medical|doctor|physician|health condition|identity|ethnic(?:ity)?|race|nationality|religion|gender|age|aging|youthful|anti[ -]?age)\b/i

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort()
  const expected = [...keys].sort()
  return actual.length === expected.length && actual.every((key, index) => key === expected[index])
}

function cleanText(value: unknown, max: number): string {
  if (typeof value !== 'string') throw new ConsultAnalysisProviderError('bad_output')
  const cleaned = value.replace(/\s+/g, ' ').trim()
  if (!cleaned || cleaned.length > max || FORBIDDEN_LANGUAGE.test(cleaned)) {
    throw new ConsultAnalysisProviderError('bad_output')
  }
  return cleaned
}

function confidence(value: unknown): ConfidenceRange {
  if (!isRecord(value) || !exactKeys(value, ['min', 'max'])) {
    throw new ConsultAnalysisProviderError('bad_output')
  }
  if (
    typeof value.min !== 'number' ||
    typeof value.max !== 'number' ||
    !Number.isFinite(value.min) ||
    !Number.isFinite(value.max) ||
    value.min < 0 ||
    value.max > 1 ||
    value.min >= value.max
  ) {
    throw new ConsultAnalysisProviderError('bad_output')
  }
  return { min: value.min, max: value.max }
}

function evidence(
  value: unknown,
  options: { allowIntake: boolean; hairOnly?: boolean },
): EvidenceKey[] {
  if (!Array.isArray(value) || value.length > CONSULT_ANALYSIS_EVIDENCE_KEYS.length) {
    throw new ConsultAnalysisProviderError('bad_output')
  }
  const allowed: readonly EvidenceKey[] = options.hairOnly
    ? CONSULT_ANALYSIS_HAIR_EVIDENCE_KEYS
    : options.allowIntake
      ? CONSULT_ANALYSIS_EVIDENCE_KEYS
      : CONSULT_ALL_CAPTURE_SHOT_KEYS
  const result: EvidenceKey[] = []
  for (const item of value) {
    const key = allowed.find((candidate) => candidate === item)
    if (!key || result.includes(key)) throw new ConsultAnalysisProviderError('bad_output')
    result.push(key)
  }
  return result
}

function enumValue<const T extends readonly string[]>(value: unknown, values: T): T[number] {
  const matched = values.find((candidate) => candidate === value)
  if (!matched) throw new ConsultAnalysisProviderError('bad_output')
  return matched
}

function observed<const T extends readonly string[]>(
  raw: unknown,
  values: T,
  unknown: T[number],
  options: { hairOnly?: boolean } = {},
): { value: T[number]; confidence: ConfidenceRange; evidence: EvidenceKey[] } {
  if (!isRecord(raw) || !exactKeys(raw, ['value', 'confidence', 'evidence'])) {
    throw new ConsultAnalysisProviderError('bad_output')
  }
  const value = enumValue(raw.value, values)
  const range = confidence(raw.confidence)
  const cited = evidence(raw.evidence, {
    allowIntake: false,
    hairOnly: options.hairOnly,
  })
  if (
    (value === unknown && (cited.length > 0 || range.max > 0.35)) ||
    (value !== unknown && cited.length === 0)
  ) {
    throw new ConsultAnalysisProviderError('bad_output')
  }
  return { value, confidence: range, evidence: cited }
}

function sanitizeProfile(raw: unknown): ConsultAnalysisFeatureProfile {
  if (!isRecord(raw) || !exactKeys(raw, CONSULT_PROFILE_FIELDS)) {
    throw new ConsultAnalysisProviderError('bad_output')
  }
  const profile = Object.fromEntries(
    CONSULT_PROFILE_FIELDS.map((field) => [
      field,
      observed(raw[field], PROFILE_FIELD_VALUES[field], 'UNKNOWN'),
    ]),
  )
  return profile as ConsultAnalysisFeatureProfile
}

/**
 * The STORED style directions: one per domain, in domain order.
 *
 * Two input shapes, because the artefact is read back as well as written:
 *   * the PROVIDER's keyed object (v5 — the domain is the key), and
 *   * the stored ARRAY (every reader, and `validateConsultAnalysisResult`).
 * Both produce the same ordered array, so nothing downstream knows or cares
 * which side it came from.
 */
function sanitizeStyleDirections(raw: unknown): ConsultStyleDirection[] {
  const byDomain = new Map<ConsultStyleDomain, ConsultStyleDirection>()

  /** One direction's fields, with `domain` supplied by the caller. */
  const sanitizeOne = (
    domain: ConsultStyleDomain,
    item: unknown,
    keys: readonly string[],
  ): ConsultStyleDirection => {
    if (!isRecord(item) || !exactKeys(item, keys) || item.discussWithProfessional !== true) {
      throw new ConsultAnalysisProviderError('bad_output')
    }
    const cited = evidence(item.evidence, { allowIntake: true })
    if (cited.length === 0) throw new ConsultAnalysisProviderError('bad_output')
    return {
      domain,
      title: cleanText(item.title, 120),
      direction: cleanText(item.direction, 400),
      whyItFlatters: cleanText(item.whyItFlatters, 400),
      confidence: confidence(item.confidence),
      evidence: cited,
      discussWithProfessional: true,
    }
  }

  if (isRecord(raw) && !Array.isArray(raw)) {
    // Provider shape: exactly the seven domain keys, enforced by the grammar's
    // `required` — which, unlike `minItems`, survives the boundary.
    if (!exactKeys(raw, CONSULT_STYLE_DOMAINS)) {
      throw new ConsultAnalysisProviderError('bad_output')
    }
    for (const domain of CONSULT_STYLE_DOMAINS) {
      byDomain.set(
        domain,
        sanitizeOne(domain, raw[domain], [
          'title',
          'direction',
          'whyItFlatters',
          'confidence',
          'evidence',
          'discussWithProfessional',
        ]),
      )
    }
  } else if (Array.isArray(raw) && raw.length === CONSULT_STYLE_DOMAINS.length) {
    // Stored shape: the domain rides in the object, and must be unique.
    for (const item of raw) {
      if (!isRecord(item)) throw new ConsultAnalysisProviderError('bad_output')
      const domain = enumValue(item.domain, CONSULT_STYLE_DOMAINS)
      if (byDomain.has(domain)) throw new ConsultAnalysisProviderError('bad_output')
      byDomain.set(
        domain,
        sanitizeOne(domain, item, [
          'domain',
          'title',
          'direction',
          'whyItFlatters',
          'confidence',
          'evidence',
          'discussWithProfessional',
        ]),
      )
    }
  } else {
    throw new ConsultAnalysisProviderError('bad_output')
  }

  // Deterministic storage/render order, whichever shape arrived.
  return CONSULT_STYLE_DOMAINS.map((domain) => {
    const direction = byDomain.get(domain)
    if (!direction) throw new ConsultAnalysisProviderError('bad_output')
    return direction
  })
}

/**
 * A recommendation as the PROVIDER writes it (`service`, from the per-run
 * enum) or as it is STORED (`serviceIntent` + `serviceName`, after the
 * safety routing may have replaced the list). `sanitizeAnalysis` accepts the
 * form its caller names and always returns the stored form.
 */
type RecommendationShape = 'provider' | 'stored'

function sanitizeRecommendation(
  item: unknown,
  args: {
    shape: RecommendationShape
    serviceIntents: readonly ConsultAnalysisServiceIntent[]
    menuServiceNames: readonly string[]
  },
): ConsultAnalysisProviderOutput['recommendations'][number] {
  if (!isRecord(item) || item.discussWithProfessional !== true) {
    throw new ConsultAnalysisProviderError('bad_output')
  }
  let serviceIntent: ConsultAnalysisServiceIntent
  let serviceName: string | null
  if (args.shape === 'provider') {
    if (
      !exactKeys(item, ['service', 'title', 'rationale', 'achievability', 'discussWithProfessional'])
    ) {
      throw new ConsultAnalysisProviderError('bad_output')
    }
    const option = enumValue(
      item.service,
      recommendationServiceOptions(args.menuServiceNames),
    )
    serviceIntent = option === CONSULT_ANALYSIS_CONSULTATION_OPTION ? 'CONSULTATION' : 'SERVICE'
    serviceName = serviceIntent === 'SERVICE' ? option : null
  } else {
    if (
      !exactKeys(item, [
        'serviceIntent', 'serviceName', 'title', 'rationale', 'achievability',
        'discussWithProfessional',
      ])
    ) {
      throw new ConsultAnalysisProviderError('bad_output')
    }
    serviceIntent = enumValue(item.serviceIntent, args.serviceIntents)
    if (serviceIntent === 'SERVICE') {
      if (typeof item.serviceName !== 'string' || !item.serviceName.trim()) {
        throw new ConsultAnalysisProviderError('bad_output')
      }
      serviceName = cleanText(item.serviceName, 120)
    } else {
      if (item.serviceName !== null) throw new ConsultAnalysisProviderError('bad_output')
      serviceName = null
    }
  }
  return {
    serviceIntent,
    serviceName,
    title: cleanText(item.title, 120),
    rationale: cleanText(item.rationale, 320),
    achievability: cleanText(item.achievability, 240),
    discussWithProfessional: true as const,
  }
}

/**
 * The hair core, checked as a unit. The two levels are the only pair in the
 * payload with an ORDER between them, so the ordering rule lives here rather
 * than in either observation.
 */
function sanitizeCore(raw: unknown): ConsultAnalysisCore {
  if (!isRecord(raw) || !exactKeys(raw, CONSULT_ANALYSIS_CORE_FIELDS)) {
    throw new ConsultAnalysisProviderError('bad_output')
  }
  const baseLevel = observed(raw.baseLevel, CONSULT_HAIR_LEVELS, 'UNKNOWN', {
    hairOnly: true,
  })
  const lightestLevel = observed(raw.lightestLevel, CONSULT_HAIR_LEVELS, 'UNKNOWN', {
    hairOnly: true,
  })
  // A base darker than the lightest is the one combination the scale forbids.
  // Either being UNKNOWN is simply unobserved, and passes.
  if (!consultHairLevelPairIsOrdered(baseLevel.value, lightestLevel.value)) {
    throw new ConsultAnalysisProviderError('bad_output')
  }
  return {
    baseLevel,
    lightestLevel,
    currentTone: observed(raw.currentTone, CONSULT_ANALYSIS_TONES, 'UNKNOWN'),
    visibleCondition: observed(
      raw.visibleCondition,
      CONSULT_ANALYSIS_CONDITIONS,
      'UNKNOWN',
    ),
    density: observed(raw.density, CONSULT_ANALYSIS_DENSITIES, 'UNKNOWN'),
    texture: observed(raw.texture, CONSULT_ANALYSIS_TEXTURES, 'UNKNOWN'),
  }
}

function sanitizeServiceLens(raw: unknown): ConsultAnalysisProviderOutput['serviceLens'] {
  if (
    !isRecord(raw) ||
    !exactKeys(raw, [
      'goal', 'history', 'constraints', 'maintenance', 'appointmentContext',
      'achievability', 'achievabilityReason', 'discussWithProfessional',
    ]) ||
    raw.discussWithProfessional !== true
  ) {
    throw new ConsultAnalysisProviderError('bad_output')
  }
  return {
    goal: cleanText(raw.goal, 240),
    history: cleanText(raw.history, 320),
    constraints: cleanText(raw.constraints, 240),
    maintenance: cleanText(raw.maintenance, 240),
    appointmentContext: cleanText(raw.appointmentContext, 240),
    achievability: enumValue(raw.achievability, CONSULT_ANALYSIS_ACHIEVABILITY),
    achievabilityReason: cleanText(raw.achievabilityReason, 320),
    discussWithProfessional: true,
  }
}

function sanitizeSafetyFlags(raw: unknown): ConsultAnalysisProviderOutput['safetyFlags'] {
  if (!Array.isArray(raw) || raw.length > CONSULT_ANALYSIS_SAFETY_CODES.length) {
    throw new ConsultAnalysisProviderError('bad_output')
  }
  const flags = raw.map((item) => {
    if (
      !isRecord(item) ||
      !exactKeys(item, ['code', 'summary', 'discussWithProfessional']) ||
      item.discussWithProfessional !== true
    ) {
      throw new ConsultAnalysisProviderError('bad_output')
    }
    return {
      code: enumValue(item.code, CONSULT_ANALYSIS_SAFETY_CODES),
      summary: cleanText(item.summary, 240),
      discussWithProfessional: true as const,
    }
  })
  if (new Set(flags.map((flag) => flag.code)).size !== flags.length) {
    throw new ConsultAnalysisProviderError('bad_output')
  }
  return flags
}

function sanitizeRecommendations(
  raw: unknown,
  args: {
    shape: RecommendationShape
    serviceIntents: readonly ConsultAnalysisServiceIntent[]
    menuServiceNames: readonly string[]
  },
): ConsultAnalysisProviderOutput['recommendations'] {
  if (!Array.isArray(raw) || raw.length < 1 || raw.length > 3) {
    throw new ConsultAnalysisProviderError('bad_output')
  }
  const recommendations = raw.map((item) => sanitizeRecommendation(item, args))
  // One recommendation per service (or per test / consultation).
  if (
    new Set(
      recommendations.map(
        (recommendation) =>
          `${recommendation.serviceIntent}:${recommendation.serviceName ?? ''}`,
      ),
    ).size !== recommendations.length
  ) {
    throw new ConsultAnalysisProviderError('bad_output')
  }
  return recommendations
}

/**
 * What call 1 returned, on its own. Exported so a real-model contract test can
 * put the live response through THE policy rather than a second copy of it.
 */
export function sanitizeConsultProfileResponse(
  raw: unknown,
): ConsultAnalysisFeatureProfile {
  if (!isRecord(raw) || !exactKeys(raw, ['profile'])) {
    throw new ConsultAnalysisProviderError('bad_output')
  }
  return sanitizeProfile(raw.profile)
}

/** What call 2 returned, on its own — everything but the profile. */
export function sanitizeConsultDirectionResponse(
  raw: unknown,
  args: { menuServiceNames: readonly string[] },
): Omit<ConsultAnalysisProviderOutput, 'profile'> {
  if (
    !isRecord(raw) ||
    !exactKeys(raw, [
      'core',
      'styleDirections',
      'serviceLens',
      'safetyFlags',
      'recommendations',
    ])
  ) {
    throw new ConsultAnalysisProviderError('bad_output')
  }
  return {
    core: sanitizeCore(raw.core),
    styleDirections: sanitizeStyleDirections(raw.styleDirections),
    serviceLens: sanitizeServiceLens(raw.serviceLens),
    safetyFlags: sanitizeSafetyFlags(raw.safetyFlags),
    recommendations: sanitizeRecommendations(raw.recommendations, {
      shape: 'provider',
      serviceIntents: CONSULT_ANALYSIS_PROVIDER_SERVICE_INTENTS,
      menuServiceNames: args.menuServiceNames,
    }),
  }
}

/**
 * The MERGED artefact — what the two calls make together, and the only shape
 * that is ever stored, rendered or re-read. Unchanged in its top-level keys
 * from v3; `core` is where v5 differs.
 */
function sanitizeAnalysis(
  raw: unknown,
  args: {
    shape: RecommendationShape
    serviceIntents: readonly ConsultAnalysisServiceIntent[]
    menuServiceNames: readonly string[]
  },
): ConsultAnalysisProviderOutput {
  if (
    !isRecord(raw) ||
    !exactKeys(raw, [
      'profile',
      'styleDirections',
      'core',
      'serviceLens',
      'safetyFlags',
      'recommendations',
    ])
  ) {
    throw new ConsultAnalysisProviderError('bad_output')
  }
  return {
    profile: sanitizeProfile(raw.profile),
    styleDirections: sanitizeStyleDirections(raw.styleDirections),
    core: sanitizeCore(raw.core),
    serviceLens: sanitizeServiceLens(raw.serviceLens),
    safetyFlags: sanitizeSafetyFlags(raw.safetyFlags),
    recommendations: sanitizeRecommendations(raw.recommendations, args),
  }
}

let cachedClient: Anthropic | null = null

function analysisModel(): string {
  const model =
    readOptionalEnv('AI_CONSULT_ANALYSIS_MODEL') ?? CONSULT_ANALYSIS_DEFAULT_MODEL
  if (!isAllowedConsultProviderModel(model)) {
    // Fail closed: client photos never go to a model the repo has not
    // explicitly allowlisted (lib/consult/providerModel.ts).
    throw new ConsultAnalysisProviderError('unavailable')
  }
  return model
}

function getClient(): Anthropic {
  if (!cachedClient) {
    // 🔴 maxRetries: 0, deliberately — unlike the capture gate, which gets its
    // own HTTP request and can afford a second attempt.
    //
    // Both analysis calls happen INSIDE one request that has a hard ceiling
    // (the route's `maxDuration`), and the SDK retries a timeout. Measured on
    // 2026-09-04: a direction call that exceeded its 90s timeout was retried
    // and consumed 180,438ms before failing — so a single slow call spent more
    // than the entire budget and the client got a 503 anyway. A retry here
    // cannot make the deadline; it can only ensure it is missed.
    cachedClient = new Anthropic({ apiKey: requireEnv('ANTHROPIC_API_KEY'), maxRetries: 0 })
  }
  return cachedClient
}

export function resetConsultAnalysisClientForTests(): void {
  cachedClient = null
}

/**
 * The consultation context and the intake, as text blocks for the provider.
 * A record rather than an array because the two calls are given DIFFERENT
 * subsets of it, and picking those apart by string prefix would be one
 * reworded sentence away from silently feeding the profile call a reference
 * photograph it must not see.
 */
export type ConsultAnalysisContextBlocks = {
  consultation: string
  intake: string
  intakeCodes: string
  inspiration: string
}

/**
 * Exported so a test can pin exactly what the model is told about the service.
 */
export function consultAnalysisContextBlocks(
  input: Pick<
    ConsultAnalysisInput,
    'service' | 'intake' | 'intakeItems' | 'capturePack' | 'inspiration'
  >,
): ConsultAnalysisContextBlocks {
  const menu = input.service.menuServiceNames.map((name) => name.trim()).filter(Boolean)
  const context = [
    `Consultation context:`,
    `Capture pack: ${input.capturePack.id} (views: ${input.capturePack.shotKeys.join(', ')})`,
    `Service family: ${CONSULT_SERVICE_FAMILY_LABELS[input.service.family]}`,
    `Service category: ${input.service.categoryName}`,
    input.service.serviceName
      ? `Service the client is considering: ${input.service.serviceName}`
      : 'Service the client is considering: not named yet — recommend from the menu below.',
    menu.length > 0
      ? `Professional's menu in this category (recommend only these, named exactly): ${menu.join('; ')}`
      : "Professional's menu in this category: none listed — only the consultation option can be recommended.",
  ].join('\n')
  const intakeLines = input.intakeItems.map(
    (item) => `${item.question} → ${item.answer} [${item.questionKey}=${item.answerCode}]`,
  )
  const intake =
    intakeLines.length > 0
      ? `Client intake (question → answer [code]):\n${intakeLines.join('\n')}`
      : 'Client intake: no answers.'
  const codes = `Immutable intake option codes:\n${JSON.stringify(
    Object.fromEntries(
      Object.entries(input.intake).sort(([left], [right]) =>
        left < right ? -1 : left > right ? 1 : 0,
      ),
    ),
  )}`
  return {
    consultation: context,
    intake,
    intakeCodes: codes,
    inspiration: consultInspirationBlock(input.inspiration),
  }
}

/**
 * The blocks the PROFILE call is given: the consultation and the intake, and
 * deliberately NOT the inspiration. What would flatter this client is not a
 * question about the picture she brought, and handing the reference to the
 * call that describes HER is how a photograph of somebody else starts leaking
 * into observations about the client.
 */
export function consultProfileContextBlocks(
  blocks: ConsultAnalysisContextBlocks,
): string[] {
  return [blocks.consultation, blocks.intake, blocks.intakeCodes]
}

/** The blocks the DIRECTION call is given: all of them. */
export function consultDirectionContextBlocks(
  blocks: ConsultAnalysisContextBlocks,
): string[] {
  return [blocks.consultation, blocks.intake, blocks.intakeCodes, blocks.inspiration]
}

/**
 * The inspiration block — the picture, as read, plus the client's words about
 * it. Its own function so a test can pin exactly what the model is told about
 * the reference, the same reason `consultAnalysisContextBlocks` is exported.
 */
export function consultInspirationBlock(
  inspiration: ConsultAnalysisInspirationInput,
): string {
  if (inspiration.source === 'NONE') {
    return 'Client inspiration: the client brought no reference photograph. Work from her intake answers alone and do not invent a reference.'
  }
  const lines = [
    `Client inspiration reference (source: ${inspiration.source}).`,
    inspiration.analysis
      ? 'What the reference photograph was read as — this describes the DESIRED result, not the client:'
      : 'The reference photograph could not be read into attributes.',
  ]
  if (inspiration.analysis) {
    for (const field of CONSULT_INSPIRATION_ANALYSIS_FIELDS) {
      const observed = inspiration.analysis[field]
      lines.push(
        observed.value === 'UNKNOWN'
          ? `- ${field}: UNKNOWN (the photograph does not show it)`
          : `- ${field}: ${observed.value} (confidence ${observed.confidence.min}–${observed.confidence.max})`,
      )
    }
  }
  lines.push(
    inspiration.answers.length > 0
      ? 'What the client said she liked about it (her own words, from the guided inspiration step):'
      : 'The client did not record what she liked about it.',
  )
  for (const answer of inspiration.answers) {
    lines.push(`- ${answer.question} → ${answer.answer}`)
  }
  return lines.join('\n')
}

/**
 * The feature profile, rendered for the DIRECTION call. Exported so a test can
 * pin exactly what the second call is told about the first one's answer —
 * the same reason `consultAnalysisContextBlocks` is exported.
 *
 * It is text, not a field to fill in again: the direction schema has no
 * `profile` property, so the second call cannot restate, contradict or quietly
 * re-derive it. That is the whole point of passing it as structure.
 */
export function consultProfileBlock(profile: ConsultAnalysisFeatureProfile): string {
  const lines = [
    'Client feature profile (already established from these same photographs — treat as settled, do not re-derive):',
  ]
  for (const field of CONSULT_PROFILE_FIELDS) {
    const observation = profile[field]
    lines.push(
      observation.value === 'UNKNOWN'
        ? `- ${field}: UNKNOWN (not established — do not lean on it)`
        : `- ${field}: ${observation.value} (confidence ${observation.confidence.min}–${observation.confidence.max}, read from ${observation.evidence.join(', ')})`,
    )
  }
  return lines.join('\n')
}

/**
 * The labeled photographs, built once and sent to BOTH calls. The profile call
 * and the direction call look at the same client; splitting the images by
 * which call "needs" them would mean the second call reasoning about a face it
 * cannot see.
 */
function consultAnalysisImageContent(
  input: ConsultAnalysisInput,
): Anthropic.ContentBlockParam[] {
  const capturesByShot = new Map(
    input.captures.map((capture) => [capture.shotKey, capture] as const),
  )
  const content: Anthropic.ContentBlockParam[] = []
  const missingShotKeys: ConsultCaptureShotKeyDTO[] = []
  for (const shotKey of input.capturePack.shotKeys) {
    const capture = capturesByShot.get(shotKey)
    if (!capture) {
      missingShotKeys.push(shotKey)
      continue
    }
    content.push({
      type: 'text',
      text: capture.qualityWarningCode
        ? `Evidence label: ${shotKey} (colour warning: ${capture.qualityWarningCode} — this frame passed the quality gate but its light is not reliable for colour)`
        : `Evidence label: ${shotKey}`,
    })
    content.push({
      type: 'image',
      source: {
        type: 'base64',
        media_type: capture.image.mediaType,
        data: capture.image.base64,
      },
    })
  }
  if (missingShotKeys.length > 0) {
    content.push({
      type: 'text',
      text: `Missing views (not supplied): ${missingShotKeys.join(', ')}. Treat everything they would have shown as unobserved.`,
    })
  }
  return content
}

/** One structured-output request. Every provider failure is `unavailable`. */
async function requestConsultAnalysisJson(args: {
  model: string
  system: string
  content: Anthropic.ContentBlockParam[]
  schema: Record<string, unknown>
  maxTokens: number
  timeoutMs: number
}): Promise<unknown> {
  let message: Anthropic.Message
  try {
    message = await getClient().messages.create(
      {
        model: args.model,
        max_tokens: args.maxTokens,
        system: args.system,
        messages: [{ role: 'user', content: args.content }],
        output_config: {
          effort: CONSULT_ANALYSIS_EFFORT,
          format: {
            type: 'json_schema',
            // 🔴 Not the schema constant directly. The API refuses
            // `minimum`/`maximum` on a number and `maxItems`/`uniqueItems` on
            // an array, and these schemas state all four as documentation of
            // intent. See lib/consult/providerSchema.ts; every one of those
            // bounds is re-checked by the sanitizers on the way back in.
            schema: toProviderOutputSchema(args.schema),
          },
        },
      },
      { timeout: args.timeoutMs },
    )
  } catch {
    throw new ConsultAnalysisProviderError('unavailable')
  }
  if (message.stop_reason === 'refusal') {
    throw new ConsultAnalysisProviderError('refused')
  }
  // A capped answer is truncated JSON, and truncated JSON is not a provider
  // that misbehaved — it is a max_tokens this repo set too low. Naming it here
  // keeps it out of the `bad_output` pile, where it would look like the model's
  // fault. Measured: the first live run of v5 truncated the direction call on
  // exactly this boundary.
  if (message.stop_reason === 'max_tokens') {
    throw new ConsultAnalysisProviderError('bad_output')
  }
  const text = message.content
    .filter((block): block is Anthropic.TextBlock => block.type === 'text')
    .map((block) => block.text)
    .join('')
  if (!text) throw new ConsultAnalysisProviderError('bad_output')
  try {
    return JSON.parse(text) as unknown
  } catch {
    throw new ConsultAnalysisProviderError('bad_output')
  }
}

/**
 * TWO paid provider calls, in sequence, merged into the one stored artefact.
 *
 * Not an architectural preference — a measured constraint. No single-call
 * arrangement of these fields compiles (see the v5 note at the top of this
 * file), so the split is where the consultation itself already splits: the
 * feature profile first, then the direction that is grounded in it. The second
 * call cannot start until the first has answered, because its whole job is to
 * reason FROM that answer.
 */
export const runConsultAnalysis: ConsultAnalysisProvider = async (input) => {
  const capturesByShot = new Map(
    input.captures.map((capture) => [capture.shotKey, capture] as const),
  )
  const packKeys = input.capturePack.shotKeys
  if (
    input.captures.length < 1 ||
    input.captures.length > CONSULT_MAX_CAPTURE_SHOTS ||
    packKeys.length < 1 ||
    capturesByShot.size !== input.captures.length ||
    input.captures.some((capture) => !packKeys.includes(capture.shotKey))
  ) {
    throw new ConsultAnalysisProviderError('bad_output')
  }
  const model = analysisModel()
  // The views this run actually sends. Every evidence enum is built from them,
  // so a label for a missing view is not merely discouraged — it does not
  // exist in the grammar the model answers under.
  const suppliedShotKeys = input.captures.map((capture) => capture.shotKey)
  const images = consultAnalysisImageContent(input)
  const contextBlocks = consultAnalysisContextBlocks(input)

  // ── Call 1: the feature profile ──────────────────────────────────────────
  // Given the photographs and the consultation context, but NOT the
  // inspiration: what would flatter this client is not a question about the
  // picture she brought, and feeding it in here is how a reference photograph
  // starts colouring observations that are supposed to be about her.
  const profile = sanitizeConsultProfileResponse(
    await requestConsultAnalysisJson({
      model,
      system: CONSULT_ANALYSIS_PROFILE_SYSTEM_PROMPT,
      content: [
        ...images,
        ...consultProfileContextBlocks(contextBlocks).map(
          (text): Anthropic.ContentBlockParam => ({ type: 'text', text }),
        ),
      ],
      schema: buildConsultProfileOutputSchema({ suppliedShotKeys }),
      maxTokens: CONSULT_ANALYSIS_PROFILE_MAX_TOKENS,
      timeoutMs: CONSULT_ANALYSIS_PROFILE_TIMEOUT_MS,
    }),
  )

  // ── Call 2: the direction, grounded in that profile ──────────────────────
  const direction = sanitizeConsultDirectionResponse(
    await requestConsultAnalysisJson({
      model,
      system: CONSULT_ANALYSIS_DIRECTION_SYSTEM_PROMPT,
      content: [
        ...images,
        ...consultDirectionContextBlocks(contextBlocks).map(
          (text): Anthropic.ContentBlockParam => ({ type: 'text', text }),
        ),
        { type: 'text', text: consultProfileBlock(profile) },
      ],
      schema: buildConsultDirectionOutputSchema({
        menuServiceNames: input.service.menuServiceNames,
        safetyCodes: input.safetyCodes,
        suppliedShotKeys,
      }),
      maxTokens: CONSULT_ANALYSIS_DIRECTION_MAX_TOKENS,
      timeoutMs: CONSULT_ANALYSIS_DIRECTION_TIMEOUT_MS,
    }),
    { menuServiceNames: input.service.menuServiceNames },
  )

  return { analysis: { profile, ...direction }, model }
}

/**
 * A partial pack (Tori, 2026-08-27) makes citation honesty load-bearing: an
 * evidence label for a view that was never supplied is a fabricated
 * observation, so it fails the whole result rather than shipping.
 */
function assertEvidenceSupplied(
  analysis: ConsultAnalysisProviderOutput,
  suppliedShotKeys: ReadonlySet<string>,
): void {
  const assertSupplied = (cited: Evidence): void => {
    for (const key of cited) {
      if (key !== 'intake' && !suppliedShotKeys.has(key)) {
        throw new ConsultAnalysisProviderError('bad_output')
      }
    }
  }
  for (const field of CONSULT_PROFILE_FIELDS) {
    assertSupplied(analysis.profile[field].evidence)
  }
  for (const direction of analysis.styleDirections) {
    assertSupplied(direction.evidence)
  }
  for (const field of CONSULT_ANALYSIS_CORE_FIELDS) {
    assertSupplied(analysis.core[field].evidence)
  }
}

/**
 * The second gate over `runConsultAnalysis`'s output, before the safety
 * routing and the write: only the two PROVIDER intents may appear, and a named
 * service must still be on this pro's menu.
 *
 * 🔴 It validates the STORED recommendation shape, because that is what the
 * engine returns. `sanitizeRecommendation` converts the provider's `service`
 * enum into `serviceIntent` + `serviceName` on the way through, so by the time
 * a result reaches here the provider shape is gone.
 *
 * This used to ask for `shape: 'provider'` — a shape the engine cannot emit —
 * so it threw on EVERY real analysis. Nothing caught it because the suites
 * stub `runConsultAnalysis` with a fake that returns the un-converted provider
 * shape, which is not what the function under test returns. Found on
 * 2026-09-04 by running one consult end to end against the live model: all
 * seven provider calls succeeded and the consult still died here.
 */
export function validateConsultAnalysisProviderResult(
  result: { analysis: unknown; model: string },
  args: {
    menuServiceNames: readonly string[]
    suppliedShotKeys?: readonly ConsultCaptureShotKeyDTO[]
  },
): ConsultAnalysisProviderResult {
  const model = result.model.trim()
  if (!model || model !== result.model || model.length > 128) {
    throw new ConsultAnalysisProviderError('bad_output')
  }
  const analysis = sanitizeAnalysis(result.analysis, {
    shape: 'stored',
    serviceIntents: CONSULT_ANALYSIS_PROVIDER_SERVICE_INTENTS,
    menuServiceNames: args.menuServiceNames,
  })
  // The menu check the `service` enum used to make for us: a SERVICE
  // recommendation must still name something this professional offers.
  const offered = new Set(recommendationServiceOptions(args.menuServiceNames))
  for (const recommendation of analysis.recommendations) {
    if (
      recommendation.serviceIntent === 'SERVICE' &&
      (recommendation.serviceName === null || !offered.has(recommendation.serviceName))
    ) {
      throw new ConsultAnalysisProviderError('bad_output')
    }
  }
  if (args.suppliedShotKeys) {
    assertEvidenceSupplied(analysis, new Set<string>(args.suppliedShotKeys))
  }
  return { analysis, model }
}

/** Validates the post-routing STORED shape, including the deterministic tests. */
export function validateConsultAnalysisResult(
  result: { analysis: unknown; model: string },
): ConsultAnalysisProviderResult {
  const model = result.model.trim()
  if (!model || model !== result.model || model.length > 128) {
    throw new ConsultAnalysisProviderError('bad_output')
  }
  return {
    analysis: sanitizeAnalysis(result.analysis, {
      shape: 'stored',
      serviceIntents: CONSULT_ANALYSIS_SERVICE_INTENTS,
      menuServiceNames: [],
    }),
    model,
  }
}
