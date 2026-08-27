import Anthropic from '@anthropic-ai/sdk'

import { readOptionalEnv, requireEnv } from '@/lib/env'
import { isRecord } from '@/lib/guards'

import {
  HAIR_COLOR_CAPTURE_SHOT_KEYS,
  type HairColorCaptureShotKey,
} from './capturePack'
import type { ConsultCaptureImage } from './captureStorage'
import { isAllowedConsultProviderModel } from './providerModel'

export const CONSULT_ANALYSIS_SCHEMA_VERSION = 2
export const CONSULT_ANALYSIS_PROMPT_VERSION = 'full-analysis-v1'
export const CONSULT_ANALYSIS_DEFAULT_MODEL = 'claude-sonnet-5'
export const CONSULT_ANALYSIS_REQUEST_TIMEOUT_MS = 90_000

export const CONSULT_ANALYSIS_PROVIDER_SERVICE_INTENTS = [
  'COLOR_CONSULTATION',
  'ROOT_TOUCH_UP',
  'ALL_OVER_COLOR',
  'HIGHLIGHTS',
  'BALAYAGE',
  'COLOR_CORRECTION',
  'TONER_GLOSS',
  'VIVID_COLOR',
  'OTHER_HAIR_COLOR',
] as const

export const CONSULT_ANALYSIS_SERVICE_INTENTS = [
  ...CONSULT_ANALYSIS_PROVIDER_SERVICE_INTENTS,
  'STRAND_TEST',
  'PATCH_TEST',
] as const

export type ConsultAnalysisServiceIntent =
  (typeof CONSULT_ANALYSIS_SERVICE_INTENTS)[number]

export const CONSULT_ANALYSIS_SAFETY_CODES = [
  'PRIOR_REACTION',
  'REACTION_HISTORY_UNKNOWN',
  'RECENT_BOX_DYE',
  'RECENT_LIGHTENING',
  'CHEMICAL_HISTORY_UNKNOWN',
  'ALLERGY_HISTORY_UNKNOWN',
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

export type HairColorAnalysisProviderOutput = {
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
  hairColorLens: {
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
    title: string
    rationale: string
    achievability: string
    discussWithProfessional: true
  }>
}

export type HairColorAnalysisInput = {
  intake: Readonly<Record<string, string>>
  captures: ReadonlyArray<{
    shotKey: HairColorCaptureShotKey
    image: ConsultCaptureImage
  }>
}

export type HairColorAnalysisProviderResult = {
  analysis: HairColorAnalysisProviderOutput
  model: string
}

export type HairColorAnalysisProvider = (
  input: HairColorAnalysisInput,
) => Promise<HairColorAnalysisProviderResult>

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

export const CONSULT_ANALYSIS_OUTPUT_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: [
    'profile',
    'styleDirections',
    'core',
    'hairColorLens',
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
    hairColorLens: {
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
          'serviceIntent',
          'title',
          'rationale',
          'achievability',
          'discussWithProfessional',
        ],
        properties: {
          serviceIntent: {
            type: 'string',
            enum: [...CONSULT_ANALYSIS_PROVIDER_SERVICE_INTENTS],
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

export const CONSULT_ANALYSIS_SYSTEM_PROMPT = [
  'You are a cosmetic-only full styling consultation analysis engine for a professional beauty platform.',
  'Inputs: immutable intake option codes and seven labeled daylight photos — four hair views (hair_back, hair_left, hair_right, hair_crown) and three face views (face_front, face_side, eyes_closeup).',
  'You produce: hair core observations, a feature profile, a hair-color lens, safety flags, hair-color service recommendations, and exactly one style direction per domain (HAIR_COLOR_HARMONY, CUT_AND_SHAPE, BANGS, BROWS, LASHES, MAKEUP, COLOR_PALETTE).',
  'Never infer or mention identity, ethnicity, race, nationality, religion, gender, age, health conditions, or diagnoses. Profile observations are cosmetic styling descriptors only.',
  'Unknown or unsupported observations must use UNKNOWN or null with empty evidence and a low confidence range. Every non-unknown observation must cite one or more supplied evidence labels and use a confidence range rather than certainty. If a face view is occluded, filtered, or poorly lit, prefer UNKNOWN over a guess.',
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
  'For the hair-color lens: combine visible evidence with goal, box dye, prior lightening, last color service, prior reaction, budget, and event context. If maintenance tolerance, allergies, or other constraints were not asked in the intake, say they are unknown; never invent them.',
  'Visible condition is a cosmetic visual observation only. Never diagnose hair, scalp, skin, or medical conditions.',
  'All chemical, reaction, allergy, unknown-history, or visibly compromised-hair concerns must be structurally represented in safetyFlags and framed for discussion with the professional.',
  'Recommendations are bounded directions to discuss with the professional, never promises. Choose only a serviceIntent enum; never output database identifiers, paths, credentials, hidden reasoning, or provider metadata.',
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

function sanitizeAnalysis(
  raw: unknown,
  serviceIntents: readonly ConsultAnalysisServiceIntent[],
): HairColorAnalysisProviderOutput {
  if (
    !isRecord(raw) ||
    !exactKeys(raw, [
      'profile',
      'styleDirections',
      'core',
      'hairColorLens',
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

  const lens = raw.hairColorLens
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
  const recommendations = raw.recommendations.map((item) => {
    if (
      !isRecord(item) ||
      !exactKeys(item, ['serviceIntent', 'title', 'rationale', 'achievability', 'discussWithProfessional']) ||
      item.discussWithProfessional !== true
    ) {
      throw new ConsultAnalysisProviderError('bad_output')
    }
    return {
      serviceIntent: enumValue(item.serviceIntent, serviceIntents),
      title: cleanText(item.title, 120),
      rationale: cleanText(item.rationale, 320),
      achievability: cleanText(item.achievability, 240),
      discussWithProfessional: true as const,
    }
  })
  if (
    new Set(recommendations.map((recommendation) => recommendation.serviceIntent)).size !==
    recommendations.length
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
    hairColorLens: {
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

export const runHairColorAnalysis: HairColorAnalysisProvider = async (input) => {
  const capturesByShot = new Map(
    input.captures.map((capture) => [capture.shotKey, capture] as const),
  )
  if (
    input.captures.length !== HAIR_COLOR_CAPTURE_SHOT_KEYS.length ||
    capturesByShot.size !== HAIR_COLOR_CAPTURE_SHOT_KEYS.length
  ) {
    throw new ConsultAnalysisProviderError('bad_output')
  }
  const model = analysisModel()
  const content: Anthropic.ContentBlockParam[] = []
  for (const shotKey of HAIR_COLOR_CAPTURE_SHOT_KEYS) {
    const capture = capturesByShot.get(shotKey)
    if (!capture) throw new ConsultAnalysisProviderError('bad_output')
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
  content.push({
    type: 'text',
    text: `Immutable intake option codes:\n${JSON.stringify(
      Object.fromEntries(
        Object.entries(input.intake).sort(([left], [right]) =>
          left < right ? -1 : left > right ? 1 : 0,
        ),
      ),
    )}`,
  })

  let message: Anthropic.Message
  try {
    message = await getClient().messages.create(
      {
        model,
        max_tokens: 6_000,
        system: CONSULT_ANALYSIS_SYSTEM_PROMPT,
        messages: [{ role: 'user', content }],
        output_config: {
          format: { type: 'json_schema', schema: CONSULT_ANALYSIS_OUTPUT_SCHEMA },
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
      analysis: sanitizeAnalysis(
        JSON.parse(text),
        CONSULT_ANALYSIS_PROVIDER_SERVICE_INTENTS,
      ),
      model,
    }
  } catch (error) {
    if (error instanceof ConsultAnalysisProviderError) throw error
    throw new ConsultAnalysisProviderError('bad_output')
  }
}

export function validateHairColorAnalysisProviderResult(
  result: { analysis: unknown; model: string },
): HairColorAnalysisProviderResult {
  const model = result.model.trim()
  if (!model || model !== result.model || model.length > 128) {
    throw new ConsultAnalysisProviderError('bad_output')
  }
  return {
    analysis: sanitizeAnalysis(
      result.analysis,
      CONSULT_ANALYSIS_PROVIDER_SERVICE_INTENTS,
    ),
    model,
  }
}

/** Validates the post-routing stored shape, including deterministic test intents. */
export function validateHairColorAnalysisResult(
  result: { analysis: unknown; model: string },
): HairColorAnalysisProviderResult {
  const model = result.model.trim()
  if (!model || model !== result.model || model.length > 128) {
    throw new ConsultAnalysisProviderError('bad_output')
  }
  return {
    analysis: sanitizeAnalysis(result.analysis, CONSULT_ANALYSIS_SERVICE_INTENTS),
    model,
  }
}
