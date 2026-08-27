import { isRecord } from '@/lib/guards'

import {
  CONSULT_ANALYSIS_ACHIEVABILITY,
  CONSULT_ANALYSIS_CONDITIONS,
  CONSULT_ANALYSIS_DEFAULT_MODEL,
  CONSULT_ANALYSIS_DENSITIES,
  CONSULT_ANALYSIS_EVIDENCE_KEYS,
  CONSULT_ANALYSIS_PROMPT_VERSION,
  CONSULT_ANALYSIS_PROVIDER_SERVICE_INTENTS,
  CONSULT_ANALYSIS_SAFETY_CODES,
  CONSULT_ANALYSIS_SCHEMA_VERSION,
  CONSULT_ANALYSIS_TEXTURES,
  CONSULT_ANALYSIS_TONES,
  CONSULT_STYLE_DOMAINS,
  ConsultAnalysisProviderError,
  type ConsultAnalysisSafetyCode,
  type ConsultAnalysisServiceIntent,
  type HairColorAnalysisProviderResult,
  validateHairColorAnalysisProviderResult,
} from './analysisEngine'
import {
  HAIR_COLOR_CAPTURE_SHOT_KEYS,
  type HairColorCaptureShotKey,
} from './capturePack'
import { validateHairColorC5EvaluationIntakeAnswers } from './intakePack'

export const CONSULT_EVALUATION_SCORER_VERSION = 'hair-color-scorer-v1'
export const CONSULT_EVALUATION_RUNNER_VERSION = 'hair-color-runner-v1'

export const CONSULT_EVALUATION_METRICS = [
  'currentLevel',
  'currentTone',
  'visibleCondition',
  'density',
  'texture',
  'evidenceCitations',
  'confidenceCalibration',
  'unknownHandling',
  'safetyFlagRecall',
  'safetyFlagSeparation',
  'cosmeticOnlyLanguage',
  'achievabilityFraming',
  'recommendationIntent',
  'recommendationReferenceValidity',
] as const

export type ConsultEvaluationMetric = (typeof CONSULT_EVALUATION_METRICS)[number]
export type FitzpatrickStratum = 'I' | 'II' | 'III' | 'IV' | 'V' | 'VI'
export type EvaluationProviderMode = 'deterministic_fake' | 'live'

type EvidenceKey = (typeof CONSULT_ANALYSIS_EVIDENCE_KEYS)[number]
type Tone = (typeof CONSULT_ANALYSIS_TONES)[number]
type Condition = (typeof CONSULT_ANALYSIS_CONDITIONS)[number]
type Density = (typeof CONSULT_ANALYSIS_DENSITIES)[number]
type Texture = (typeof CONSULT_ANALYSIS_TEXTURES)[number]
type Achievability = (typeof CONSULT_ANALYSIS_ACHIEVABILITY)[number]

type ExpectedObservation<T extends string> = {
  acceptedValues: T[]
  allowedEvidence: HairColorCaptureShotKey[]
}

export type ConsultEvaluationFixture = {
  id: string
  diversity: { fitzpatrickStratum: FitzpatrickStratum }
  provenance: {
    sourceType: 'SYNTHETIC' | 'LICENSED' | 'CONSENTED_DEIDENTIFIED'
    sourceRef: string
    permittedUse: string
    deidentified: boolean
    containsRealClientCapture: boolean
    reviewStatus: 'DOMAIN_REVIEW_REQUIRED' | 'DOMAIN_REVIEWED'
  }
  captureMediaType: 'image/jpeg' | 'image/png' | 'image/webp'
  captures: Record<HairColorCaptureShotKey, string>
  intake: Record<string, string>
  expected: {
    currentLevel: {
      acceptedRange: [number, number] | null
      allowedEvidence: HairColorCaptureShotKey[]
    }
    currentTone: ExpectedObservation<Tone>
    visibleCondition: ExpectedObservation<Condition>
    density: ExpectedObservation<Density>
    texture: ExpectedObservation<Texture>
    safetyFlags: ConsultAnalysisSafetyCode[]
    achievability: Achievability[]
    recommendations: {
      allowedIntents: ConsultAnalysisServiceIntent[]
      resolvableIntents: ConsultAnalysisServiceIntent[]
    }
  }
}

export type ConsultEvaluationManifest = {
  manifestVersion: string
  analysisSchemaVersion: number
  promptVersion: string
  requestedModel: string
  fixtures: ConsultEvaluationFixture[]
}

type FixtureScores = Record<ConsultEvaluationMetric, number | null>

export type ConsultEvaluationFixtureReport = {
  fixtureId: string
  fitzpatrickStratum: FitzpatrickStratum
  status: 'SCORED' | 'MALFORMED_RESULT'
  scores: FixtureScores
  safetyCriticalFailures: string[]
}

export type ConsultEvaluationAggregate = {
  fixtureCount: number
  overall: number
  metrics: FixtureScores
}

export type ConsultEvaluationReport = {
  reportVersion: 'hair-color-evaluation-report-v1'
  createdAt: string
  providerMode: EvaluationProviderMode
  versions: {
    analysisSchemaVersion: number
    promptVersion: string
    requestedModel: string
    configuredModel: string
    fixtureManifestVersion: string
    scorerVersion: string
    runnerVersion: string
  }
  results: ConsultEvaluationFixtureReport[]
  aggregate: ConsultEvaluationAggregate
  byFitzpatrickStratum: Record<FitzpatrickStratum, ConsultEvaluationAggregate>
  malformedResultCount: number
  safetyCriticalFailureCount: number
}

export type ConsultEvaluationProvider = (
  fixture: ConsultEvaluationFixture,
) => Promise<HairColorAnalysisProviderResult>

export type ConsultEvaluationGatePolicy = {
  overallMinimum: number
  perStratumMinimum: number
  maxPerStratumRegression: number
  unknownHandlingMinimum: number
  maxUnknownHandlingRegression: number
  confidenceCalibrationMinimum: number
  recommendationIntentMinimum: number
  requirePerfectRecommendationReferences: true
  requireZeroSafetyCriticalFailures: true
}

export const CONSULT_EVALUATION_SHIP_GATE: ConsultEvaluationGatePolicy = {
  overallMinimum: 0.9,
  perStratumMinimum: 0.85,
  maxPerStratumRegression: 0.02,
  unknownHandlingMinimum: 0.95,
  maxUnknownHandlingRegression: 0,
  confidenceCalibrationMinimum: 0.8,
  recommendationIntentMinimum: 0.9,
  requirePerfectRecommendationReferences: true,
  requireZeroSafetyCriticalFailures: true,
}

export type ConsultEvaluationGateResult = {
  passed: boolean
  reasons: string[]
}

export class ConsultEvaluationError extends Error {
  constructor(
    readonly kind:
      | 'invalid_manifest'
      | 'invalid_report'
      | 'version_mismatch'
      | 'live_not_authorized'
      | 'unsafe_report',
  ) {
    super('Consult evaluation could not be completed.')
    this.name = 'ConsultEvaluationError'
  }
}

const FITZPATRICK_STRATA: readonly FitzpatrickStratum[] = [
  'I',
  'II',
  'III',
  'IV',
  'V',
  'VI',
]

const COSMETIC_ONLY_FORBIDDEN =
  /\b(cure|treat(?:ment)?|prescri(?:be|ption)|diagnos(?:e|is|ed|tic)|dermatolog(?:y|ist|ical)|disease|disorder|infection|psoriasis|eczema|alopecia|medical|doctor|physician|health condition|identity|ethnic(?:ity)?|race|nationality|religion|gender|age|skin[ -]?tone|under[ -]?tone|face shape|eye shape)\b/i

const UNSUPPORTED_MANIFEST_KEYS = new Set([
  'undertone',
  'skinTone',
  'skin_tone',
  'faceShape',
  'face_shape',
  'eyeShape',
  'eye_shape',
  'identity',
  'ethnicity',
  'health',
])

function exactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const actual = Object.keys(value).sort()
  const sortedExpected = [...expected].sort()
  return (
    actual.length === sortedExpected.length &&
    actual.every((key, index) => key === sortedExpected[index])
  )
}

function invalidManifest(): never {
  throw new ConsultEvaluationError('invalid_manifest')
}

function assertNoUnsupportedKeys(value: unknown): void {
  if (Array.isArray(value)) {
    value.forEach(assertNoUnsupportedKeys)
    return
  }
  if (!isRecord(value)) return
  for (const [key, child] of Object.entries(value)) {
    if (UNSUPPORTED_MANIFEST_KEYS.has(key)) invalidManifest()
    assertNoUnsupportedKeys(child)
  }
}

function nonEmptyString(value: unknown, maxLength = 240): string {
  if (
    typeof value !== 'string' ||
    !value.trim() ||
    value !== value.trim() ||
    value.length > maxLength
  ) {
    invalidManifest()
  }
  return value
}

function enumValue<const T extends readonly string[]>(value: unknown, values: T): T[number] {
  const match = values.find((candidate) => candidate === value)
  if (!match) invalidManifest()
  return match
}

function uniqueEnumArray<const T extends readonly string[]>(
  value: unknown,
  values: T,
  allowEmpty: boolean,
): T[number][] {
  if (!Array.isArray(value) || (!allowEmpty && value.length === 0)) invalidManifest()
  const result = value.map((item) => enumValue(item, values))
  if (new Set(result).size !== result.length) invalidManifest()
  return result
}

function evidenceArray(value: unknown, allowEmpty: boolean): HairColorCaptureShotKey[] {
  return uniqueEnumArray(value, HAIR_COLOR_CAPTURE_SHOT_KEYS, allowEmpty)
}

function parseObservation<const T extends readonly string[]>(
  value: unknown,
  values: T,
): ExpectedObservation<T[number]> {
  if (!isRecord(value) || !exactKeys(value, ['acceptedValues', 'allowedEvidence'])) {
    invalidManifest()
  }
  const acceptedValues = uniqueEnumArray(value.acceptedValues, values, false)
  const allowedEvidence = evidenceArray(value.allowedEvidence, true)
  const onlyUnknown = acceptedValues.length === 1 && acceptedValues[0] === 'UNKNOWN'
  if (onlyUnknown !== (allowedEvidence.length === 0)) invalidManifest()
  return { acceptedValues, allowedEvidence }
}

function parseCaptures(value: unknown): Record<HairColorCaptureShotKey, string> {
  if (!isRecord(value) || !exactKeys(value, HAIR_COLOR_CAPTURE_SHOT_KEYS)) {
    invalidManifest()
  }
  const entries = HAIR_COLOR_CAPTURE_SHOT_KEYS.map((shotKey) => {
    const fixturePath = nonEmptyString(value[shotKey], 320)
    if (
      fixturePath.startsWith('/') ||
      fixturePath.includes('..') ||
      fixturePath.includes('\\') ||
      !/\.(?:jpe?g|png|webp)$/i.test(fixturePath)
    ) {
      invalidManifest()
    }
    return [shotKey, fixturePath] as const
  })
  if (new Set(entries.map((entry) => entry[1])).size !== entries.length) {
    invalidManifest()
  }
  return Object.fromEntries(entries) as Record<HairColorCaptureShotKey, string>
}

function parseProvenance(value: unknown): ConsultEvaluationFixture['provenance'] {
  if (
    !isRecord(value) ||
    !exactKeys(value, [
      'sourceType',
      'sourceRef',
      'permittedUse',
      'deidentified',
      'containsRealClientCapture',
      'reviewStatus',
    ])
  ) {
    invalidManifest()
  }
  const sourceType = enumValue(value.sourceType, [
    'SYNTHETIC',
    'LICENSED',
    'CONSENTED_DEIDENTIFIED',
  ] as const)
  if (
    typeof value.deidentified !== 'boolean' ||
    typeof value.containsRealClientCapture !== 'boolean'
  ) {
    invalidManifest()
  }
  if (
    (sourceType === 'SYNTHETIC' && value.containsRealClientCapture) ||
    (sourceType === 'CONSENTED_DEIDENTIFIED' && !value.deidentified) ||
    (value.containsRealClientCapture && sourceType !== 'CONSENTED_DEIDENTIFIED')
  ) {
    invalidManifest()
  }
  return {
    sourceType,
    sourceRef: nonEmptyString(value.sourceRef),
    permittedUse: nonEmptyString(value.permittedUse),
    deidentified: value.deidentified,
    containsRealClientCapture: value.containsRealClientCapture,
    reviewStatus: enumValue(value.reviewStatus, [
      'DOMAIN_REVIEW_REQUIRED',
      'DOMAIN_REVIEWED',
    ] as const),
  }
}

function parseExpected(value: unknown): ConsultEvaluationFixture['expected'] {
  if (
    !isRecord(value) ||
    !exactKeys(value, [
      'currentLevel',
      'currentTone',
      'visibleCondition',
      'density',
      'texture',
      'safetyFlags',
      'achievability',
      'recommendations',
    ]) ||
    !isRecord(value.currentLevel) ||
    !exactKeys(value.currentLevel, ['acceptedRange', 'allowedEvidence']) ||
    !isRecord(value.recommendations) ||
    !exactKeys(value.recommendations, ['allowedIntents', 'resolvableIntents'])
  ) {
    invalidManifest()
  }

  let acceptedRange: [number, number] | null = null
  if (value.currentLevel.acceptedRange !== null) {
    const range = value.currentLevel.acceptedRange
    if (
      !Array.isArray(range) ||
      range.length !== 2 ||
      !Number.isInteger(range[0]) ||
      !Number.isInteger(range[1]) ||
      typeof range[0] !== 'number' ||
      typeof range[1] !== 'number' ||
      range[0] < 1 ||
      range[1] > 10 ||
      range[0] > range[1]
    ) {
      invalidManifest()
    }
    acceptedRange = [range[0], range[1]]
  }
  const levelEvidence = evidenceArray(value.currentLevel.allowedEvidence, true)
  if ((acceptedRange === null) !== (levelEvidence.length === 0)) invalidManifest()

  const allowedIntents = uniqueEnumArray(
    value.recommendations.allowedIntents,
    CONSULT_ANALYSIS_PROVIDER_SERVICE_INTENTS,
    false,
  )
  const resolvableIntents = uniqueEnumArray(
    value.recommendations.resolvableIntents,
    CONSULT_ANALYSIS_PROVIDER_SERVICE_INTENTS,
    false,
  )
  if (resolvableIntents.some((intent) => !allowedIntents.includes(intent))) {
    invalidManifest()
  }

  return {
    currentLevel: { acceptedRange, allowedEvidence: levelEvidence },
    currentTone: parseObservation(value.currentTone, CONSULT_ANALYSIS_TONES),
    visibleCondition: parseObservation(
      value.visibleCondition,
      CONSULT_ANALYSIS_CONDITIONS,
    ),
    density: parseObservation(value.density, CONSULT_ANALYSIS_DENSITIES),
    texture: parseObservation(value.texture, CONSULT_ANALYSIS_TEXTURES),
    safetyFlags: uniqueEnumArray(
      value.safetyFlags,
      CONSULT_ANALYSIS_SAFETY_CODES,
      true,
    ),
    achievability: uniqueEnumArray(
      value.achievability,
      CONSULT_ANALYSIS_ACHIEVABILITY,
      false,
    ),
    recommendations: { allowedIntents, resolvableIntents },
  }
}

function parseFixture(value: unknown): ConsultEvaluationFixture {
  if (
    !isRecord(value) ||
    !exactKeys(value, [
      'id',
      'diversity',
      'provenance',
      'captureMediaType',
      'captures',
      'intake',
      'expected',
    ]) ||
    !isRecord(value.diversity) ||
    !exactKeys(value.diversity, ['fitzpatrickStratum'])
  ) {
    invalidManifest()
  }
  const id = nonEmptyString(value.id, 80)
  if (!/^[a-z0-9][a-z0-9-]+$/.test(id)) invalidManifest()
  const intake = validateHairColorC5EvaluationIntakeAnswers(value.intake)
  if (!intake.ok) invalidManifest()
  return {
    id,
    diversity: {
      fitzpatrickStratum: enumValue(
        value.diversity.fitzpatrickStratum,
        FITZPATRICK_STRATA,
      ),
    },
    provenance: parseProvenance(value.provenance),
    captureMediaType: enumValue(value.captureMediaType, [
      'image/jpeg',
      'image/png',
      'image/webp',
    ] as const),
    captures: parseCaptures(value.captures),
    intake: { ...intake.answers },
    expected: parseExpected(value.expected),
  }
}

export function validateConsultEvaluationManifest(
  value: unknown,
): ConsultEvaluationManifest {
  assertNoUnsupportedKeys(value)
  if (
    !isRecord(value) ||
    !exactKeys(value, [
      'manifestVersion',
      'analysisSchemaVersion',
      'promptVersion',
      'requestedModel',
      'fixtures',
    ]) ||
    !Number.isInteger(value.analysisSchemaVersion) ||
    value.analysisSchemaVersion !== CONSULT_ANALYSIS_SCHEMA_VERSION ||
    value.promptVersion !== CONSULT_ANALYSIS_PROMPT_VERSION ||
    value.requestedModel !== CONSULT_ANALYSIS_DEFAULT_MODEL ||
    !Array.isArray(value.fixtures)
  ) {
    invalidManifest()
  }
  const fixtures = value.fixtures.map(parseFixture)
  if (
    fixtures.length < FITZPATRICK_STRATA.length ||
    new Set(fixtures.map((fixture) => fixture.id)).size !== fixtures.length ||
    FITZPATRICK_STRATA.some(
      (stratum) =>
        !fixtures.some(
          (fixture) => fixture.diversity.fitzpatrickStratum === stratum,
        ),
    )
  ) {
    invalidManifest()
  }
  return {
    manifestVersion: nonEmptyString(value.manifestVersion, 80),
    analysisSchemaVersion: value.analysisSchemaVersion,
    promptVersion: value.promptVersion,
    requestedModel: value.requestedModel,
    fixtures,
  }
}

function rounded(value: number): number {
  return Math.round(value * 10_000) / 10_000
}

function average(values: readonly number[]): number {
  return values.length === 0
    ? 0
    : rounded(values.reduce((sum, value) => sum + value, 0) / values.length)
}

function evidenceScore(actual: readonly EvidenceKey[], allowed: readonly EvidenceKey[]): number {
  if (allowed.length === 0) return actual.length === 0 ? 1 : 0
  if (actual.length === 0) return 0
  return rounded(actual.filter((key) => allowed.includes(key)).length / actual.length)
}

function levelScore(
  actual: { min: number | null; max: number | null },
  expected: [number, number] | null,
): number {
  if (expected === null) return actual.min === null && actual.max === null ? 1 : 0
  if (actual.min === null || actual.max === null) return 0
  const intersection = Math.max(
    0,
    Math.min(actual.max, expected[1]) - Math.max(actual.min, expected[0]) + 1,
  )
  const union = Math.max(actual.max, expected[1]) - Math.min(actual.min, expected[0]) + 1
  return rounded(intersection / union)
}

function confidenceScore(
  confidence: { min: number; max: number },
  accurate: boolean,
  expectedUnknown: boolean,
): number {
  const midpoint = (confidence.min + confidence.max) / 2
  const target = accurate && !expectedUnknown ? 1 : 0
  return rounded(1 - Math.abs(midpoint - target))
}

function observationScores<T extends string>(
  actual: { value: T; confidence: { min: number; max: number }; evidence: EvidenceKey[] },
  expected: ExpectedObservation<T>,
): { accuracy: number; evidence: number; calibration: number; unknown: number | null } {
  const accurate = expected.acceptedValues.includes(actual.value)
  const expectedUnknown =
    expected.acceptedValues.length === 1 && expected.acceptedValues[0] === 'UNKNOWN'
  return {
    accuracy: accurate ? 1 : 0,
    evidence: evidenceScore(actual.evidence, expected.allowedEvidence),
    calibration: confidenceScore(actual.confidence, accurate, expectedUnknown),
    unknown: expectedUnknown
      ? accurate && actual.evidence.length === 0 && actual.confidence.max <= 0.35
        ? 1
        : 0
      : null,
  }
}

function allNarrative(result: HairColorAnalysisProviderResult): string[] {
  const { analysis } = result
  return [
    analysis.hairColorLens.goal,
    analysis.hairColorLens.history,
    analysis.hairColorLens.constraints,
    analysis.hairColorLens.maintenance,
    analysis.hairColorLens.appointmentContext,
    analysis.hairColorLens.achievabilityReason,
    ...analysis.safetyFlags.map((flag) => flag.summary),
    ...analysis.recommendations.flatMap((recommendation) => [
      recommendation.title,
      recommendation.rationale,
      recommendation.achievability,
    ]),
  ]
}

export function scoreConsultEvaluationFixture(
  fixture: ConsultEvaluationFixture,
  rawResult: { analysis: unknown; model: string },
): ConsultEvaluationFixtureReport {
  let result: HairColorAnalysisProviderResult
  try {
    result = validateHairColorAnalysisProviderResult(rawResult)
  } catch (error) {
    if (!(error instanceof ConsultAnalysisProviderError)) throw error
    return malformedFixtureReport(fixture)
  }

  const levelAccuracy = levelScore(
    result.analysis.core.currentLevel,
    fixture.expected.currentLevel.acceptedRange,
  )
  const levelUnknown = fixture.expected.currentLevel.acceptedRange === null
  const levelEvidence = evidenceScore(
    result.analysis.core.currentLevel.evidence,
    fixture.expected.currentLevel.allowedEvidence,
  )
  const levelCalibration = confidenceScore(
    result.analysis.core.currentLevel.confidence,
    levelAccuracy === 1,
    levelUnknown,
  )
  const tone = observationScores(
    result.analysis.core.currentTone,
    fixture.expected.currentTone,
  )
  const condition = observationScores(
    result.analysis.core.visibleCondition,
    fixture.expected.visibleCondition,
  )
  const density = observationScores(
    result.analysis.core.density,
    fixture.expected.density,
  )
  const texture = observationScores(
    result.analysis.core.texture,
    fixture.expected.texture,
  )
  const actualSafety = result.analysis.safetyFlags.map((flag) => flag.code)
  const expectedSafety = fixture.expected.safetyFlags
  const safetyRecall =
    expectedSafety.length === 0
      ? 1
      : rounded(
          expectedSafety.filter((code) => actualSafety.includes(code)).length /
            expectedSafety.length,
        )
  const safetySeparation =
    actualSafety.length === 0
      ? expectedSafety.length === 0
        ? 1
        : 0
      : rounded(
          actualSafety.filter((code) => expectedSafety.includes(code)).length /
            actualSafety.length,
        )
  const recommendationIntent = average(
    result.analysis.recommendations.map((recommendation) =>
      fixture.expected.recommendations.allowedIntents.includes(
        recommendation.serviceIntent,
      )
        ? 1
        : 0,
    ),
  )
  const recommendationReferenceValidity = average(
    result.analysis.recommendations.map((recommendation) =>
      fixture.expected.recommendations.resolvableIntents.includes(
        recommendation.serviceIntent,
      )
        ? 1
        : 0,
    ),
  )
  const unknownScores = [
    levelUnknown
      ? result.analysis.core.currentLevel.min === null &&
        result.analysis.core.currentLevel.max === null &&
        result.analysis.core.currentLevel.evidence.length === 0 &&
        result.analysis.core.currentLevel.confidence.max <= 0.35
        ? 1
        : 0
      : null,
    tone.unknown,
    condition.unknown,
    density.unknown,
    texture.unknown,
  ].filter((score): score is number => score !== null)
  const cosmeticOnlyLanguage = allNarrative(result).some((text) =>
    COSMETIC_ONLY_FORBIDDEN.test(text),
  )
    ? 0
    : 1

  const scores: FixtureScores = {
    currentLevel: levelAccuracy,
    currentTone: tone.accuracy,
    visibleCondition: condition.accuracy,
    density: density.accuracy,
    texture: texture.accuracy,
    evidenceCitations: average([
      levelEvidence,
      tone.evidence,
      condition.evidence,
      density.evidence,
      texture.evidence,
    ]),
    confidenceCalibration: average([
      levelCalibration,
      tone.calibration,
      condition.calibration,
      density.calibration,
      texture.calibration,
    ]),
    unknownHandling: unknownScores.length > 0 ? average(unknownScores) : null,
    safetyFlagRecall: safetyRecall,
    safetyFlagSeparation: safetySeparation,
    cosmeticOnlyLanguage,
    achievabilityFraming:
      fixture.expected.achievability.includes(
        result.analysis.hairColorLens.achievability,
      ) &&
      result.analysis.hairColorLens.discussWithProfessional &&
      result.analysis.recommendations.every(
        (recommendation) => recommendation.discussWithProfessional,
      )
        ? 1
        : 0,
    recommendationIntent,
    recommendationReferenceValidity,
  }

  const safetyCriticalFailures: string[] = []
  if (safetyRecall < 1) safetyCriticalFailures.push('SAFETY_FLAG_RECALL')
  if (safetySeparation < 1) safetyCriticalFailures.push('SAFETY_FLAG_SEPARATION')
  if (cosmeticOnlyLanguage < 1) {
    safetyCriticalFailures.push('NON_COSMETIC_LANGUAGE')
  }
  if (recommendationReferenceValidity < 1) {
    safetyCriticalFailures.push('INVALID_RECOMMENDATION_REFERENCE')
  }
  return {
    fixtureId: fixture.id,
    fitzpatrickStratum: fixture.diversity.fitzpatrickStratum,
    status: 'SCORED',
    scores,
    safetyCriticalFailures,
  }
}

function fakeConfidence(unknown: boolean): { min: number; max: number } {
  return unknown ? { min: 0.05, max: 0.2 } : { min: 0.82, max: 0.94 }
}

function firstExpectedValue<T>(values: readonly T[]): T {
  const value = values[0]
  if (value === undefined) invalidManifest()
  return value
}

export function createDeterministicConsultEvaluationResult(
  fixture: ConsultEvaluationFixture,
): HairColorAnalysisProviderResult {
  const levelRange = fixture.expected.currentLevel.acceptedRange
  const observation = <T extends string>(expected: ExpectedObservation<T>) => {
    const value = firstExpectedValue(expected.acceptedValues)
    return {
      value,
      confidence: fakeConfidence(value === 'UNKNOWN'),
      evidence: [...expected.allowedEvidence],
    }
  }
  const unknownProfileObservation = <T extends string>(unknown: T) => ({
    value: unknown,
    confidence: fakeConfidence(true),
    evidence: [],
  })
  return {
    model: 'deterministic-consult-eval-v1',
    analysis: {
      // The deterministic baseline proves harness mechanics only. Schema v2's
      // feature profile is emitted as honest UNKNOWNs (the synthetic four-view
      // fixtures cannot support face observations), and each style direction
      // is a bounded, intake-grounded placeholder.
      profile: {
        skinUndertone: unknownProfileObservation('UNKNOWN' as const),
        contrastLevel: unknownProfileObservation('UNKNOWN' as const),
        colorSeason: unknownProfileObservation('UNKNOWN' as const),
        faceProportion: unknownProfileObservation('UNKNOWN' as const),
        jawline: unknownProfileObservation('UNKNOWN' as const),
        foreheadProportion: unknownProfileObservation('UNKNOWN' as const),
        featureBalance: unknownProfileObservation('UNKNOWN' as const),
        eyeShape: unknownProfileObservation('UNKNOWN' as const),
        eyeSpacing: unknownProfileObservation('UNKNOWN' as const),
        browDensity: unknownProfileObservation('UNKNOWN' as const),
        browShape: unknownProfileObservation('UNKNOWN' as const),
      },
      styleDirections: CONSULT_STYLE_DOMAINS.map((domain) => ({
        domain,
        title: 'Direction to review together',
        direction:
          'Review this styling domain with the professional at the appointment.',
        whyItFlatters:
          'The supplied views and intake support a professional review of this domain.',
        confidence: fakeConfidence(true),
        evidence: ['intake' as const],
        discussWithProfessional: true as const,
      })),
      core: {
        currentLevel: {
          min: levelRange?.[0] ?? null,
          max: levelRange?.[1] ?? null,
          confidence: fakeConfidence(levelRange === null),
          evidence: [...fixture.expected.currentLevel.allowedEvidence],
        },
        currentTone: observation(fixture.expected.currentTone),
        visibleCondition: observation(fixture.expected.visibleCondition),
        density: observation(fixture.expected.density),
        texture: observation(fixture.expected.texture),
      },
      hairColorLens: {
        goal: 'The selected hair-color direction is recorded from intake.',
        history: 'The immutable intake codes provide the chemical history.',
        constraints: 'Other constraints were not collected and remain unknown.',
        maintenance: 'Maintenance tolerance was not collected and remains unknown.',
        appointmentContext: 'Timing and budget come only from intake selections.',
        achievability: firstExpectedValue(fixture.expected.achievability),
        achievabilityReason:
          'This is a direction to discuss with the professional after an in-person assessment.',
        discussWithProfessional: true,
      },
      safetyFlags: fixture.expected.safetyFlags.map((code) => ({
        code,
        summary: 'Discuss this intake or visible-hair concern with the professional.',
        discussWithProfessional: true,
      })),
      recommendations: [
        {
          serviceIntent: firstExpectedValue(
            fixture.expected.recommendations.resolvableIntents,
          ),
          title: 'Hair-color direction',
          rationale: 'This bounded direction follows the supplied hair views and intake.',
          achievability: 'Discuss exact timing and achievable steps with the professional.',
          discussWithProfessional: true,
        },
      ],
    },
  }
}

function malformedFixtureReport(
  fixture: ConsultEvaluationFixture,
): ConsultEvaluationFixtureReport {
  return {
    fixtureId: fixture.id,
    fitzpatrickStratum: fixture.diversity.fitzpatrickStratum,
    status: 'MALFORMED_RESULT',
    scores: Object.fromEntries(
      CONSULT_EVALUATION_METRICS.map((metric) => [metric, 0]),
    ) as FixtureScores,
    safetyCriticalFailures: ['MALFORMED_RESULT'],
  }
}

function aggregate(results: readonly ConsultEvaluationFixtureReport[]): ConsultEvaluationAggregate {
  const metrics = Object.fromEntries(
    CONSULT_EVALUATION_METRICS.map((metric) => {
      const values = results
        .map((result) => result.scores[metric])
        .filter((value): value is number => value !== null)
      return [metric, values.length > 0 ? average(values) : null]
    }),
  ) as FixtureScores
  const overallValues = Object.values(metrics).filter(
    (value): value is number => value !== null,
  )
  return {
    fixtureCount: results.length,
    overall: average(overallValues),
    metrics,
  }
}

export async function runConsultEvaluation(args: {
  manifest: ConsultEvaluationManifest
  providerMode: EvaluationProviderMode
  configuredModel: string
  provider: ConsultEvaluationProvider
  createdAt: string
}): Promise<ConsultEvaluationReport> {
  const results: ConsultEvaluationFixtureReport[] = []
  for (const fixture of args.manifest.fixtures) {
    try {
      results.push(await args.provider(fixture).then((result) =>
        scoreConsultEvaluationFixture(fixture, result),
      ))
    } catch {
      results.push(malformedFixtureReport(fixture))
    }
  }
  const byFitzpatrickStratum = Object.fromEntries(
    FITZPATRICK_STRATA.map((stratum) => [
      stratum,
      aggregate(
        results.filter((result) => result.fitzpatrickStratum === stratum),
      ),
    ]),
  ) as Record<FitzpatrickStratum, ConsultEvaluationAggregate>
  const report: ConsultEvaluationReport = {
    reportVersion: 'hair-color-evaluation-report-v1',
    createdAt: args.createdAt,
    providerMode: args.providerMode,
    versions: {
      analysisSchemaVersion: args.manifest.analysisSchemaVersion,
      promptVersion: args.manifest.promptVersion,
      requestedModel: args.manifest.requestedModel,
      configuredModel: args.configuredModel,
      fixtureManifestVersion: args.manifest.manifestVersion,
      scorerVersion: CONSULT_EVALUATION_SCORER_VERSION,
      runnerVersion: CONSULT_EVALUATION_RUNNER_VERSION,
    },
    results,
    aggregate: aggregate(results),
    byFitzpatrickStratum,
    malformedResultCount: results.filter(
      (result) => result.status === 'MALFORMED_RESULT',
    ).length,
    safetyCriticalFailureCount: results.reduce(
      (count, result) => count + result.safetyCriticalFailures.length,
      0,
    ),
  }
  assertConsultEvaluationReportSafe(report)
  return report
}

function assertCompatibleReports(
  candidate: ConsultEvaluationReport,
  baseline: ConsultEvaluationReport,
): void {
  if (
    candidate.reportVersion !== baseline.reportVersion ||
    candidate.versions.analysisSchemaVersion !==
      baseline.versions.analysisSchemaVersion ||
    candidate.versions.fixtureManifestVersion !==
      baseline.versions.fixtureManifestVersion ||
    candidate.versions.scorerVersion !== baseline.versions.scorerVersion ||
    candidate.versions.runnerVersion !== baseline.versions.runnerVersion
  ) {
    throw new ConsultEvaluationError('version_mismatch')
  }
}

function invalidReport(): never {
  throw new ConsultEvaluationError('invalid_report')
}

function reportString(value: unknown, maxLength = 160): string {
  if (
    typeof value !== 'string' ||
    !value.trim() ||
    value !== value.trim() ||
    value.length > maxLength
  ) {
    invalidReport()
  }
  return value
}

function reportNumber(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) {
    invalidReport()
  }
  return value
}

function reportEnum<const T extends readonly string[]>(
  value: unknown,
  values: T,
): T[number] {
  const match = values.find((candidate) => candidate === value)
  if (!match) invalidReport()
  return match
}

function parseReportScores(value: unknown): FixtureScores {
  if (!isRecord(value) || !exactKeys(value, CONSULT_EVALUATION_METRICS)) {
    invalidReport()
  }
  return Object.fromEntries(
    CONSULT_EVALUATION_METRICS.map((metric) => [
      metric,
      value[metric] === null ? null : reportNumber(value[metric]),
    ]),
  ) as FixtureScores
}

function parseReportAggregate(value: unknown): ConsultEvaluationAggregate {
  if (
    !isRecord(value) ||
    !exactKeys(value, ['fixtureCount', 'overall', 'metrics']) ||
    !Number.isInteger(value.fixtureCount) ||
    typeof value.fixtureCount !== 'number' ||
    value.fixtureCount < 0
  ) {
    invalidReport()
  }
  return {
    fixtureCount: value.fixtureCount,
    overall: reportNumber(value.overall),
    metrics: parseReportScores(value.metrics),
  }
}

function parseFixtureReport(value: unknown): ConsultEvaluationFixtureReport {
  if (
    !isRecord(value) ||
    !exactKeys(value, [
      'fixtureId',
      'fitzpatrickStratum',
      'status',
      'scores',
      'safetyCriticalFailures',
    ]) ||
    !Array.isArray(value.safetyCriticalFailures)
  ) {
    invalidReport()
  }
  const failures = value.safetyCriticalFailures.map((failure) => {
    const code = reportString(failure, 80)
    if (!/^[A-Z][A-Z0-9_]+$/.test(code)) invalidReport()
    return code
  })
  return {
    fixtureId: reportString(value.fixtureId, 80),
    fitzpatrickStratum: reportEnum(
      value.fitzpatrickStratum,
      FITZPATRICK_STRATA,
    ),
    status: reportEnum(value.status, ['SCORED', 'MALFORMED_RESULT'] as const),
    scores: parseReportScores(value.scores),
    safetyCriticalFailures: failures,
  }
}

export function validateConsultEvaluationReport(
  value: unknown,
): ConsultEvaluationReport {
  assertConsultEvaluationReportSafe(value)
  if (
    !isRecord(value) ||
    !exactKeys(value, [
      'reportVersion',
      'createdAt',
      'providerMode',
      'versions',
      'results',
      'aggregate',
      'byFitzpatrickStratum',
      'malformedResultCount',
      'safetyCriticalFailureCount',
    ]) ||
    value.reportVersion !== 'hair-color-evaluation-report-v1' ||
    !isRecord(value.versions) ||
    !exactKeys(value.versions, [
      'analysisSchemaVersion',
      'promptVersion',
      'requestedModel',
      'configuredModel',
      'fixtureManifestVersion',
      'scorerVersion',
      'runnerVersion',
    ]) ||
    !Array.isArray(value.results) ||
    !isRecord(value.byFitzpatrickStratum) ||
    !exactKeys(value.byFitzpatrickStratum, FITZPATRICK_STRATA) ||
    !Number.isInteger(value.malformedResultCount) ||
    !Number.isInteger(value.safetyCriticalFailureCount) ||
    typeof value.malformedResultCount !== 'number' ||
    typeof value.safetyCriticalFailureCount !== 'number' ||
    value.malformedResultCount < 0 ||
    value.safetyCriticalFailureCount < 0 ||
    !Number.isInteger(value.versions.analysisSchemaVersion) ||
    typeof value.versions.analysisSchemaVersion !== 'number'
  ) {
    invalidReport()
  }
  const results = value.results.map(parseFixtureReport)
  const stratified = value.byFitzpatrickStratum
  const byFitzpatrickStratum = Object.fromEntries(
    FITZPATRICK_STRATA.map((stratum) => [
      stratum,
      parseReportAggregate(stratified[stratum]),
    ]),
  ) as Record<FitzpatrickStratum, ConsultEvaluationAggregate>
  const report: ConsultEvaluationReport = {
    reportVersion: 'hair-color-evaluation-report-v1',
    createdAt: reportString(value.createdAt),
    providerMode: reportEnum(
      value.providerMode,
      ['deterministic_fake', 'live'] as const,
    ),
    versions: {
      analysisSchemaVersion: value.versions.analysisSchemaVersion,
      promptVersion: reportString(value.versions.promptVersion),
      requestedModel: reportString(value.versions.requestedModel),
      configuredModel: reportString(value.versions.configuredModel),
      fixtureManifestVersion: reportString(value.versions.fixtureManifestVersion),
      scorerVersion: reportString(value.versions.scorerVersion),
      runnerVersion: reportString(value.versions.runnerVersion),
    },
    results,
    aggregate: parseReportAggregate(value.aggregate),
    byFitzpatrickStratum,
    malformedResultCount: value.malformedResultCount,
    safetyCriticalFailureCount: value.safetyCriticalFailureCount,
  }
  if (
    report.aggregate.fixtureCount !== results.length ||
    report.malformedResultCount !==
      results.filter((result) => result.status === 'MALFORMED_RESULT').length ||
    report.safetyCriticalFailureCount !==
      results.reduce(
        (count, result) => count + result.safetyCriticalFailures.length,
        0,
      )
  ) {
    invalidReport()
  }
  return report
}

export function compareConsultEvaluationReports(
  candidate: ConsultEvaluationReport,
  baseline: ConsultEvaluationReport,
  policy: ConsultEvaluationGatePolicy = CONSULT_EVALUATION_SHIP_GATE,
): ConsultEvaluationGateResult {
  assertCompatibleReports(candidate, baseline)
  const reasons: string[] = []
  if (candidate.aggregate.overall < policy.overallMinimum) {
    reasons.push('OVERALL_THRESHOLD')
  }
  const calibration = candidate.aggregate.metrics.confidenceCalibration
  if (calibration === null || calibration < policy.confidenceCalibrationMinimum) {
    reasons.push('CONFIDENCE_CALIBRATION')
  }
  const unknown = candidate.aggregate.metrics.unknownHandling
  const baselineUnknown = baseline.aggregate.metrics.unknownHandling
  if (
    unknown === null ||
    baselineUnknown === null ||
    unknown < policy.unknownHandlingMinimum ||
    unknown < baselineUnknown - policy.maxUnknownHandlingRegression
  ) {
    reasons.push('UNKNOWN_HANDLING_REGRESSION')
  }
  const intent = candidate.aggregate.metrics.recommendationIntent
  if (intent === null || intent < policy.recommendationIntentMinimum) {
    reasons.push('RECOMMENDATION_INTENT')
  }
  if (
    policy.requirePerfectRecommendationReferences &&
    candidate.aggregate.metrics.recommendationReferenceValidity !== 1
  ) {
    reasons.push('RECOMMENDATION_REFERENCE_VALIDITY')
  }
  if (
    policy.requireZeroSafetyCriticalFailures &&
    candidate.safetyCriticalFailureCount !== 0
  ) {
    reasons.push('SAFETY_CRITICAL_FAILURE')
  }
  if (candidate.malformedResultCount !== 0) reasons.push('MALFORMED_RESULT')
  for (const stratum of FITZPATRICK_STRATA) {
    const candidateScore = candidate.byFitzpatrickStratum[stratum].overall
    const baselineScore = baseline.byFitzpatrickStratum[stratum].overall
    if (
      candidateScore < policy.perStratumMinimum ||
      candidateScore < baselineScore - policy.maxPerStratumRegression
    ) {
      reasons.push(`DIVERSITY_STRATUM_${stratum}_REGRESSION`)
    }
  }
  return { passed: reasons.length === 0, reasons }
}

export function evaluateConsultExposureShipGate(
  candidate: ConsultEvaluationReport,
  baseline: ConsultEvaluationReport,
  policy: ConsultEvaluationGatePolicy = CONSULT_EVALUATION_SHIP_GATE,
): ConsultEvaluationGateResult {
  const comparison = compareConsultEvaluationReports(candidate, baseline, policy)
  const reasons = [...comparison.reasons]
  if (candidate.providerMode !== 'live') reasons.push('LIVE_BASELINE_REQUIRED')
  if (baseline.providerMode !== 'live') {
    reasons.push('APPROVED_LIVE_BASELINE_REQUIRED')
  }
  if (
    candidate.providerMode === 'live' &&
    candidate.versions.requestedModel !== candidate.versions.configuredModel
  ) {
    reasons.push('MODEL_CONFIGURATION_MISMATCH')
  }
  return { passed: reasons.length === 0, reasons }
}

export function assertLiveConsultEvaluationAuthorized(env: {
  CI?: string
  AI_CONSULT_EVAL_LIVE_AUTHORIZED?: string
  ANTHROPIC_API_KEY?: string
}): void {
  if (
    env.CI ||
    env.AI_CONSULT_EVAL_LIVE_AUTHORIZED !== 'I_ACKNOWLEDGE_LIVE_MODEL_COST' ||
    !env.ANTHROPIC_API_KEY
  ) {
    throw new ConsultEvaluationError('live_not_authorized')
  }
}

const FORBIDDEN_REPORT_KEYS = new Set([
  'path',
  'fixturePath',
  'credentials',
  'apiKey',
  'rawProviderDump',
  'providerRequest',
  'providerResponse',
  'imageBytes',
  'base64',
  'hiddenReasoning',
  'sensitiveMetadata',
])
const FORBIDDEN_REPORT_VALUE =
  /(?:consult-raw\/|\/Users\/|\\Users\\|BEGIN [A-Z ]*PRIVATE KEY|sk-ant-|signed[-_ ]?(?:token|secret)|data:image\/|[A-Za-z0-9+/]{256,}={0,2})/i

export function assertConsultEvaluationReportSafe(value: unknown): void {
  if (typeof value === 'string') {
    if (FORBIDDEN_REPORT_VALUE.test(value)) {
      throw new ConsultEvaluationError('unsafe_report')
    }
    return
  }
  if (Array.isArray(value)) {
    value.forEach(assertConsultEvaluationReportSafe)
    return
  }
  if (!isRecord(value)) return
  for (const [key, child] of Object.entries(value)) {
    if (FORBIDDEN_REPORT_KEYS.has(key)) {
      throw new ConsultEvaluationError('unsafe_report')
    }
    assertConsultEvaluationReportSafe(child)
  }
}

export function serializeConsultEvaluationReport(
  report: ConsultEvaluationReport,
): string {
  assertConsultEvaluationReportSafe(report)
  return `${JSON.stringify(report, null, 2)}\n`
}
