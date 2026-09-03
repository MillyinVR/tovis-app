import Anthropic from '@anthropic-ai/sdk'
import type { ConsultServiceFamily } from '@prisma/client'

import { readOptionalEnv, requireEnv } from '@/lib/env'
import { isRecord } from '@/lib/guards'

import {
  HAIR_COLOR_CAPTURE_SHOT_KEYS,
  type HairColorCaptureShotKey,
} from './capturePack'
import type { ConsultCaptureImage } from './captureStorage'
import { isAllowedConsultProviderModel } from './providerModel'
import { CONSULT_SERVICE_FAMILY_LABELS } from './serviceScope'

export const CONSULT_ANALYSIS_SCHEMA_VERSION = 3
// v2 (2026-08-27): the capture pack may be partial — the prompt lists missing
// views and pins their observations to UNKNOWN.
// v3 (2026-09-03, service-aware consult): the analysis is told WHICH service
// it is for — family, category, the service the look or booking names, and
// the professional's menu in that category — and the intake as the labels the
// client actually saw. `hairColorLens` becomes `serviceLens` (same eight
// fields, service-neutral wording); recommendations name a service from the
// menu (or a consultation) instead of choosing from a colour-only intent enum;
// safety codes gain service-neutral members. Prompt and schema move together.
export const CONSULT_ANALYSIS_PROMPT_VERSION = 'service-analysis-v3'
export const CONSULT_ANALYSIS_DEFAULT_MODEL = 'claude-sonnet-5'
export const CONSULT_ANALYSIS_REQUEST_TIMEOUT_MS = 90_000

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

export const CONSULT_ANALYSIS_EVIDENCE_KEYS = [
  ...HAIR_COLOR_CAPTURE_SHOT_KEYS,
  'intake',
] as const
type EvidenceKey = (typeof CONSULT_ANALYSIS_EVIDENCE_KEYS)[number]

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

export type ConsultAnalysisProviderOutput = {
  profile: ConsultAnalysisFeatureProfile
  styleDirections: ConsultStyleDirection[]
  core: {
    currentLevel: {
      min: number | null
      max: number | null
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
  captures: ReadonlyArray<{
    shotKey: HairColorCaptureShotKey
    image: ConsultCaptureImage
  }>
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

const CONFIDENCE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['min', 'max'],
  properties: {
    min: { type: 'number', minimum: 0, maximum: 1 },
    max: { type: 'number', minimum: 0, maximum: 1 },
  },
}

function observationSchema(values: readonly string[]) {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['value', 'confidence', 'evidence'],
    properties: {
      value: { type: 'string', enum: [...values] },
      confidence: CONFIDENCE_SCHEMA,
      evidence: {
        type: 'array',
        maxItems: 8,
        uniqueItems: true,
        items: { type: 'string', enum: [...CONSULT_ANALYSIS_EVIDENCE_KEYS] },
      },
    },
  }
}

/**
 * The recommendation enum the provider chooses from on THIS run: the
 * professional's menu in the consult's category, by exact name, plus the one
 * fixed consultation option. Built per run because the menu is per pro; the
 * default export below (no menu) is the shape the tests and the schema check
 * pin.
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

export function buildConsultAnalysisOutputSchema(args: {
  menuServiceNames: readonly string[]
}): Record<string, unknown> {
  return {
  type: 'object',
  additionalProperties: false,
  required: [
    'profile',
    'styleDirections',
    'core',
    'serviceLens',
    'safetyFlags',
    'recommendations',
  ],
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
    styleDirections: {
      type: 'array',
      minItems: CONSULT_STYLE_DOMAINS.length,
      maxItems: CONSULT_STYLE_DOMAINS.length,
      items: {
        type: 'object',
        additionalProperties: false,
        required: [
          'domain',
          'title',
          'direction',
          'whyItFlatters',
          'confidence',
          'evidence',
          'discussWithProfessional',
        ],
        properties: {
          domain: { type: 'string', enum: [...CONSULT_STYLE_DOMAINS] },
          title: { type: 'string', maxLength: 120 },
          direction: { type: 'string', maxLength: 400 },
          whyItFlatters: { type: 'string', maxLength: 400 },
          confidence: CONFIDENCE_SCHEMA,
          evidence: {
            type: 'array',
            minItems: 1,
            maxItems: 8,
            uniqueItems: true,
            items: { type: 'string', enum: [...CONSULT_ANALYSIS_EVIDENCE_KEYS] },
          },
          discussWithProfessional: { const: true },
        },
      },
    },
    core: {
      type: 'object',
      additionalProperties: false,
      required: ['currentLevel', 'currentTone', 'visibleCondition', 'density', 'texture'],
      properties: {
        currentLevel: {
          type: 'object',
          additionalProperties: false,
          required: ['min', 'max', 'confidence', 'evidence'],
          properties: {
            min: { type: ['integer', 'null'], minimum: 1, maximum: 10 },
            max: { type: ['integer', 'null'], minimum: 1, maximum: 10 },
            confidence: CONFIDENCE_SCHEMA,
            evidence: {
              type: 'array',
              maxItems: 4,
              uniqueItems: true,
              items: {
                type: 'string',
                enum: [...CONSULT_ANALYSIS_HAIR_EVIDENCE_KEYS],
              },
            },
          },
        },
        currentTone: observationSchema(CONSULT_ANALYSIS_TONES),
        visibleCondition: observationSchema(CONSULT_ANALYSIS_CONDITIONS),
        density: observationSchema(CONSULT_ANALYSIS_DENSITIES),
        texture: observationSchema(CONSULT_ANALYSIS_TEXTURES),
      },
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
        goal: { type: 'string', maxLength: 240 },
        history: { type: 'string', maxLength: 320 },
        constraints: { type: 'string', maxLength: 240 },
        maintenance: { type: 'string', maxLength: 240 },
        appointmentContext: { type: 'string', maxLength: 240 },
        achievability: {
          type: 'string',
          enum: [...CONSULT_ANALYSIS_ACHIEVABILITY],
        },
        achievabilityReason: { type: 'string', maxLength: 320 },
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
          code: { type: 'string', enum: [...CONSULT_ANALYSIS_SAFETY_CODES] },
          summary: { type: 'string', maxLength: 240 },
          discussWithProfessional: { const: true },
        },
      },
    },
    recommendations: {
      type: 'array',
      minItems: 1,
      maxItems: 3,
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
          title: { type: 'string', maxLength: 120 },
          rationale: { type: 'string', maxLength: 320 },
          achievability: { type: 'string', maxLength: 240 },
          discussWithProfessional: { const: true },
        },
      },
    },
  },
  }
}

/** The schema with no menu: only the consultation option is recommendable. */
export const CONSULT_ANALYSIS_OUTPUT_SCHEMA: Record<string, unknown> =
  buildConsultAnalysisOutputSchema({ menuServiceNames: [] })

export const CONSULT_ANALYSIS_SYSTEM_PROMPT = [
  'You are a cosmetic-only full styling consultation analysis engine for a professional beauty platform.',
  'Inputs: a consultation context naming the service family, the service category, the specific service the client is considering when one is known, and the professional’s menu in that category; the client’s intake as the questions and answers she saw (with their immutable option codes); and one to seven labeled daylight photos from the full pack — hair views (hair_back, hair_left, hair_right, hair_crown) and face views (face_front, face_side, eyes_closeup). The client may submit a partial pack; when views are missing, a text line names them.',
  'You produce: hair core observations, a feature profile, a service lens, safety flags, service recommendations, and exactly one style direction per domain (HAIR_COLOR_HARMONY, CUT_AND_SHAPE, BANGS, BROWS, LASHES, MAKEUP, COLOR_PALETTE).',
  'Everything you write is FOR the named service. The service lens describes the client’s goal, history, constraints, maintenance and appointment context as they bear on THAT service; recommendations are services from the professional’s menu (named exactly as the menu names them) or a consultation with the professional; the hair core observations are filled from the hair views when hair is the subject and set to UNKNOWN or null when it is not.',
  'Never infer or mention identity, ethnicity, race, nationality, religion, gender, age, health conditions, or diagnoses. Profile observations are cosmetic styling descriptors only.',
  'Unknown or unsupported observations must use UNKNOWN or null with empty evidence and a low confidence range. Every non-unknown observation must cite one or more supplied evidence labels and use a confidence range rather than certainty. If a face view is occluded, filtered, or poorly lit, prefer UNKNOWN over a guess.',
  'Cite only evidence labels that were actually supplied in this request; never cite a missing view. Any observation that depends mainly on a missing view must be UNKNOWN or null with a low confidence range, and every style direction must lean only on what the supplied views and the intake actually show — with fewer views, widen confidence ranges and say less, never more.',
  'Skin undertone and color season read from phone photos are approximate even in daylight: widen those confidence ranges and frame every palette direction as a starting point the professional confirms in person with physical draping.',
  'Rubric — recommend what harmonizes with the observed features, never what is merely trending:',
  'Contrast is the backbone: low contrast between skin, hair, and eyes favors soft, blended color and diffused makeup; high contrast carries bold, saturated color and defined lines.',
  'Undertone and season guide hair-color tone, makeup color families, and the COLOR_PALETTE direction; name palette families in plain words.',
  'Face proportions guide CUT_AND_SHAPE and BANGS: a longer face or taller forehead is balanced by bangs and width around the face; a wider face is elongated by length, crown height, and longer layers; an angular jawline is softened by soft perimeters and movement; softly rounded features gain definition from structure. When bangs would not serve the observed proportions, say so plainly — BETTER WITHOUT is a valid direction.',
  'Feature balance guides MAKEUP: soft features suit diffused, blended application; structured features carry defined lines; blended features can move either way.',
  'Eye shape and spacing guide LASHES: hooded or monolid eyes favor lifted curls that open the lid; downturned eyes favor lifted outer corners; round eyes favor lengthening through the center; deep-set eyes favor longer centers and lighter inner corners; close-set eyes favor outer emphasis; wide-set eyes favor inner-to-center emphasis.',
  'BROWS work with the natural density and existing shape, anchored to the face’s own proportions; never direct chemical brow or lash treatments.',
  'Hair texture, density, and current level bound which cuts and colors will actually behave well; honor them in CUT_AND_SHAPE and HAIR_COLOR_HARMONY.',
  'Every style direction’s whyItFlatters must name the specific observed feature or features it builds on. Style directions are directions to discuss with the professional, never promises and never treatment prescriptions.',
  'For the service lens: combine visible evidence with the client’s stated goal, treatment and chemical history, prior reactions, sensitivities, budget and event context. If maintenance tolerance, allergies, or other constraints were not asked in the intake, say they are unknown; never invent them. When the service is hair colour, the history covers box dye, prior lightening and the last colour service.',
  'Visible condition is a cosmetic visual observation only. Never diagnose hair, scalp, skin, or medical conditions.',
  'All chemical, reaction, allergy, sensitivity, unknown-history, or visibly compromised-hair concerns must be structurally represented in safetyFlags and framed for discussion with the professional.',
  'Recommendations are bounded directions to discuss with the professional, never promises. Name each recommended service exactly as the menu lists it, or choose the consultation option; never output database identifiers, paths, credentials, hidden reasoning, or provider metadata.',
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
      : HAIR_COLOR_CAPTURE_SHOT_KEYS
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
): { value: T[number]; confidence: ConfidenceRange; evidence: EvidenceKey[] } {
  if (!isRecord(raw) || !exactKeys(raw, ['value', 'confidence', 'evidence'])) {
    throw new ConsultAnalysisProviderError('bad_output')
  }
  const value = enumValue(raw.value, values)
  const range = confidence(raw.confidence)
  const cited = evidence(raw.evidence, { allowIntake: false })
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

function sanitizeStyleDirections(raw: unknown): ConsultStyleDirection[] {
  if (
    !Array.isArray(raw) ||
    raw.length !== CONSULT_STYLE_DOMAINS.length
  ) {
    throw new ConsultAnalysisProviderError('bad_output')
  }
  const directions = raw.map((item): ConsultStyleDirection => {
    if (
      !isRecord(item) ||
      !exactKeys(item, [
        'domain',
        'title',
        'direction',
        'whyItFlatters',
        'confidence',
        'evidence',
        'discussWithProfessional',
      ]) ||
      item.discussWithProfessional !== true
    ) {
      throw new ConsultAnalysisProviderError('bad_output')
    }
    const cited = evidence(item.evidence, { allowIntake: true })
    if (cited.length === 0) throw new ConsultAnalysisProviderError('bad_output')
    return {
      domain: enumValue(item.domain, CONSULT_STYLE_DOMAINS),
      title: cleanText(item.title, 120),
      direction: cleanText(item.direction, 400),
      whyItFlatters: cleanText(item.whyItFlatters, 400),
      confidence: confidence(item.confidence),
      evidence: cited,
      discussWithProfessional: true,
    }
  })
  const domains = new Set(directions.map((direction) => direction.domain))
  if (domains.size !== CONSULT_STYLE_DOMAINS.length) {
    throw new ConsultAnalysisProviderError('bad_output')
  }
  // Deterministic storage/render order regardless of provider ordering.
  return CONSULT_STYLE_DOMAINS.map((domain) => {
    const direction = directions.find((candidate) => candidate.domain === domain)
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
    ]) ||
    !isRecord(raw.core) ||
    !exactKeys(raw.core, ['currentLevel', 'currentTone', 'visibleCondition', 'density', 'texture']) ||
    !isRecord(raw.core.currentLevel)
  ) {
    throw new ConsultAnalysisProviderError('bad_output')
  }
  const level = raw.core.currentLevel
  if (!exactKeys(level, ['min', 'max', 'confidence', 'evidence'])) {
    throw new ConsultAnalysisProviderError('bad_output')
  }
  const levelMin = level.min
  const levelMax = level.max
  const levelEvidence = evidence(level.evidence, { allowIntake: false, hairOnly: true })
  const validLevel =
    (levelMin === null && levelMax === null && levelEvidence.length === 0) ||
    (Number.isInteger(levelMin) &&
      Number.isInteger(levelMax) &&
      typeof levelMin === 'number' &&
      typeof levelMax === 'number' &&
      levelMin >= 1 &&
      levelMax <= 10 &&
      levelMin <= levelMax &&
      levelEvidence.length > 0)
  if (!validLevel) throw new ConsultAnalysisProviderError('bad_output')
  const levelConfidence = confidence(level.confidence)
  if (levelMin === null && levelConfidence.max > 0.35) {
    throw new ConsultAnalysisProviderError('bad_output')
  }

  const lens = raw.serviceLens
  if (
    !isRecord(lens) ||
    !exactKeys(lens, [
      'goal', 'history', 'constraints', 'maintenance', 'appointmentContext',
      'achievability', 'achievabilityReason', 'discussWithProfessional',
    ]) ||
    lens.discussWithProfessional !== true
  ) {
    throw new ConsultAnalysisProviderError('bad_output')
  }

  if (
    !Array.isArray(raw.safetyFlags) ||
    raw.safetyFlags.length > CONSULT_ANALYSIS_SAFETY_CODES.length
  ) {
    throw new ConsultAnalysisProviderError('bad_output')
  }
  const safetyFlags = raw.safetyFlags.map((item) => {
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
  if (new Set(safetyFlags.map((flag) => flag.code)).size !== safetyFlags.length) {
    throw new ConsultAnalysisProviderError('bad_output')
  }

  if (
    !Array.isArray(raw.recommendations) ||
    raw.recommendations.length < 1 ||
    raw.recommendations.length > 3
  ) {
    throw new ConsultAnalysisProviderError('bad_output')
  }
  const recommendations = raw.recommendations.map((item) =>
    sanitizeRecommendation(item, args),
  )
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

  return {
    profile: sanitizeProfile(raw.profile),
    styleDirections: sanitizeStyleDirections(raw.styleDirections),
    core: {
      currentLevel: {
        min: typeof levelMin === 'number' ? levelMin : null,
        max: typeof levelMax === 'number' ? levelMax : null,
        confidence: levelConfidence,
        evidence: levelEvidence,
      },
      currentTone: observed(raw.core.currentTone, CONSULT_ANALYSIS_TONES, 'UNKNOWN'),
      visibleCondition: observed(
        raw.core.visibleCondition,
        CONSULT_ANALYSIS_CONDITIONS,
        'UNKNOWN',
      ),
      density: observed(raw.core.density, CONSULT_ANALYSIS_DENSITIES, 'UNKNOWN'),
      texture: observed(raw.core.texture, CONSULT_ANALYSIS_TEXTURES, 'UNKNOWN'),
    },
    serviceLens: {
      goal: cleanText(lens.goal, 240),
      history: cleanText(lens.history, 320),
      constraints: cleanText(lens.constraints, 240),
      maintenance: cleanText(lens.maintenance, 240),
      appointmentContext: cleanText(lens.appointmentContext, 240),
      achievability: enumValue(
        lens.achievability,
        CONSULT_ANALYSIS_ACHIEVABILITY,
      ),
      achievabilityReason: cleanText(lens.achievabilityReason, 320),
      discussWithProfessional: true,
    },
    safetyFlags,
    recommendations,
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
    cachedClient = new Anthropic({ apiKey: requireEnv('ANTHROPIC_API_KEY'), maxRetries: 1 })
  }
  return cachedClient
}

export function resetConsultAnalysisClientForTests(): void {
  cachedClient = null
}

/**
 * The consultation context and the intake, as text blocks for the provider.
 * Exported so a test can pin exactly what the model is told about the service.
 */
export function consultAnalysisContextBlocks(
  input: Pick<ConsultAnalysisInput, 'service' | 'intake' | 'intakeItems'>,
): string[] {
  const menu = input.service.menuServiceNames.map((name) => name.trim()).filter(Boolean)
  const context = [
    `Consultation context:`,
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
  return [context, intake, codes]
}

export const runConsultAnalysis: ConsultAnalysisProvider = async (input) => {
  const capturesByShot = new Map(
    input.captures.map((capture) => [capture.shotKey, capture] as const),
  )
  if (
    input.captures.length < 1 ||
    input.captures.length > HAIR_COLOR_CAPTURE_SHOT_KEYS.length ||
    capturesByShot.size !== input.captures.length ||
    input.captures.some(
      (capture) =>
        !HAIR_COLOR_CAPTURE_SHOT_KEYS.some((key) => key === capture.shotKey),
    )
  ) {
    throw new ConsultAnalysisProviderError('bad_output')
  }
  const model = analysisModel()
  const content: Anthropic.ContentBlockParam[] = []
  const missingShotKeys: HairColorCaptureShotKey[] = []
  for (const shotKey of HAIR_COLOR_CAPTURE_SHOT_KEYS) {
    const capture = capturesByShot.get(shotKey)
    if (!capture) {
      missingShotKeys.push(shotKey)
      continue
    }
    content.push({ type: 'text', text: `Evidence label: ${shotKey}` })
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
  for (const text of consultAnalysisContextBlocks(input)) {
    content.push({ type: 'text', text })
  }

  let message: Anthropic.Message
  try {
    message = await getClient().messages.create(
      {
        model,
        max_tokens: 6_000,
        system: CONSULT_ANALYSIS_SYSTEM_PROMPT,
        messages: [{ role: 'user', content }],
        output_config: {
          format: {
            type: 'json_schema',
            schema: buildConsultAnalysisOutputSchema({
              menuServiceNames: input.service.menuServiceNames,
            }),
          },
        },
      },
      { timeout: CONSULT_ANALYSIS_REQUEST_TIMEOUT_MS },
    )
  } catch {
    throw new ConsultAnalysisProviderError('unavailable')
  }
  if (message.stop_reason === 'refusal') throw new ConsultAnalysisProviderError('refused')
  const text = message.content
    .filter((block): block is Anthropic.TextBlock => block.type === 'text')
    .map((block) => block.text)
    .join('')
  if (!text) throw new ConsultAnalysisProviderError('bad_output')
  try {
    return {
      analysis: sanitizeAnalysis(JSON.parse(text), {
        shape: 'provider',
        serviceIntents: CONSULT_ANALYSIS_PROVIDER_SERVICE_INTENTS,
        menuServiceNames: input.service.menuServiceNames,
      }),
      model,
    }
  } catch (error) {
    if (error instanceof ConsultAnalysisProviderError) throw error
    throw new ConsultAnalysisProviderError('bad_output')
  }
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
  assertSupplied(analysis.core.currentLevel.evidence)
  assertSupplied(analysis.core.currentTone.evidence)
  assertSupplied(analysis.core.visibleCondition.evidence)
  assertSupplied(analysis.core.density.evidence)
  assertSupplied(analysis.core.texture.evidence)
}

/**
 * Validates what the PROVIDER returned: recommendations name a `service`
 * from this run's menu enum; only the two provider intents result.
 */
export function validateConsultAnalysisProviderResult(
  result: { analysis: unknown; model: string },
  args: {
    menuServiceNames: readonly string[]
    suppliedShotKeys?: readonly HairColorCaptureShotKey[]
  },
): ConsultAnalysisProviderResult {
  const model = result.model.trim()
  if (!model || model !== result.model || model.length > 128) {
    throw new ConsultAnalysisProviderError('bad_output')
  }
  const analysis = sanitizeAnalysis(result.analysis, {
    shape: 'provider',
    serviceIntents: CONSULT_ANALYSIS_PROVIDER_SERVICE_INTENTS,
    menuServiceNames: args.menuServiceNames,
  })
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
