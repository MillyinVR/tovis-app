import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ConsultLookPlanProviderOutput } from '@/lib/consult/lookPlan'

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  constructorOptions: [] as unknown[],
}))

vi.mock('@anthropic-ai/sdk', () => ({
  default: class MockAnthropic {
    messages = { create: mocks.create }

    constructor(options: unknown) {
      mocks.constructorOptions.push(options)
    }
  },
}))

import {
  CONSULT_ANALYSIS_DEFAULT_MODEL,
  CONSULT_ANALYSIS_DIRECTION_OUTPUT_SCHEMA,
  CONSULT_ANALYSIS_DIRECTION_SYSTEM_PROMPT,
  CONSULT_ANALYSIS_EFFORT,
  CONSULT_ANALYSIS_PROFILE_OUTPUT_SCHEMA,
  CONSULT_ANALYSIS_PROFILE_SYSTEM_PROMPT,
  CONSULT_ANALYSIS_PROMPT_VERSION,
  CONSULT_ANALYSIS_DIRECTION_TIMEOUT_MS,
  CONSULT_ANALYSIS_PROFILE_TIMEOUT_MS,
  CONSULT_FACE_COLOR_TIMEOUT_MS,
  CONSULT_ANALYSIS_SCHEMA_VERSION,
  CONSULT_STYLE_DOMAINS,
  ConsultAnalysisProviderError,
  lookPlanRecommendations,
  repairUnsuppliedHairLevelEvidence,
  resetConsultAnalysisClientForTests,
  CONSULT_ANALYSIS_CONSULTATION_OPTION,
  buildConsultDirectionOutputSchema,
  buildConsultFaceColorOutputSchema,
  buildConsultProfileOutputSchema,
  consultAnalysisSafetyCodeOptions,
  consultAnalysisContextBlocks,
  consultInspirationBlock,
  consultProfileBlock,
  mergeConsultFeatureProfiles,
  runConsultAnalysis,
  runConsultFaceColorCompanion,
  unknownFaceColorProfile,
  sanitizeConsultFaceColorResponse,
  sanitizeConsultProfileResponse,
  validateConsultAnalysisProviderResult,
  validateConsultAnalysisResult,
  type ConsultAnalysisInput,
  type ConsultAnalysisProviderOutput,
} from './analysisEngine'
import {
  findUnsupportedProviderSchemaKeywords,
  toProviderOutputSchema,
} from './providerSchema'
import { CONSULT_INSPIRATION_REQUEST_TIMEOUT_MS } from './inspirationVision'
import { maxDuration as CONSULT_ANALYSIS_ROUTE_MAX_DURATION_SECONDS } from '@/app/api/v1/client/consult/[id]/analysis/route'

const MENU = ['Balayage', 'Toner Gloss'] as const

/**
 * What this consult's intake can support. The hair-colour pack always requires
 * ALLERGY_HISTORY_UNKNOWN, and on every pack the supported set IS the required
 * set — so this is the whole menu the provider may raise, plus the
 * VISIBLE_COMPROMISE the schema always allows.
 */
const SAFETY_CODES = ['ALLERGY_HISTORY_UNKNOWN'] as const

/** The views this suite's fixture supplies — the whole hair-colour pack. */
const SUPPLIED = [
  'hair_back', 'hair_left', 'hair_right', 'hair_crown',
  'face_front', 'face_side', 'eyes_closeup',
] as const

const service: ConsultAnalysisInput['service'] = {
  family: 'HAIR',
  categoryName: 'Color',
  serviceName: 'Balayage',
  menuServiceNames: [...MENU],
}

const capturePack: ConsultAnalysisInput['capturePack'] = {
  id: 'hair-color-daylight',
  shotKeys: [
    'hair_back',
    'hair_left',
    'hair_right',
    'hair_crown',
    'face_front',
    'face_side',
    'eyes_closeup',
  ],
}

const intakeItems: ConsultAnalysisInput['intakeItems'] = [
  {
    questionKey: 'desired_color',
    question: 'Your dream color?',
    answerCode: 'red',
    answer: 'Red',
  },
]

/** The provider's OUTPUT shape: a `service` chosen from the per-run enum. */
type ProviderOutput = Omit<ConsultAnalysisProviderOutput, 'recommendations'> & {
  recommendations: Array<{
    service: string
    title: string
    rationale: string
    achievability: string
    discussWithProfessional: true
  }>
}

/** The default for the existing cases: a client who brought no reference. */
const noInspiration: ConsultAnalysisInput['inspiration'] = {
  source: 'NONE',
  analysis: null,
  answers: [],
  wants: [],
  avoids: [],
  unsure: [],
  keep: [],
}

const captures = [
  'hair_back',
  'hair_left',
  'hair_right',
  'hair_crown',
  'face_front',
  'face_side',
  'eyes_closeup',
].map((shotKey) => ({
  qualityWarningCode: null,
  shotKey: shotKey as
    | 'hair_back'
    | 'hair_left'
    | 'hair_right'
    | 'hair_crown'
    | 'face_front'
    | 'face_side'
    | 'eyes_closeup',
  image: { base64: 'aGVsbG8=', mediaType: 'image/jpeg' as const },
}))

function validProfile(): ConsultAnalysisProviderOutput['profile'] {
  const face = <T extends string>(value: T) => ({
    value,
    confidence: { min: 0.45, max: 0.7 },
    evidence: ['face_front' as const],
  })
  const unknown = <T extends string>(value: T) => ({
    value,
    confidence: { min: 0, max: 0.25 },
    evidence: [],
  })
  return {
    skinUndertone: face('NEUTRAL' as const),
    contrastLevel: face('MEDIUM' as const),
    colorSeason: unknown('UNKNOWN' as const),
    faceProportion: face('BALANCED' as const),
    jawline: face('SOFTLY_ROUNDED' as const),
    foreheadProportion: face('BALANCED' as const),
    featureBalance: face('SOFT' as const),
    eyeColor: face('BROWN' as const),
    eyeShape: {
      value: 'HOODED' as const,
      confidence: { min: 0.5, max: 0.8 },
      evidence: ['eyes_closeup' as const],
    },
    eyeSpacing: {
      value: 'BALANCED' as const,
      confidence: { min: 0.5, max: 0.8 },
      evidence: ['eyes_closeup' as const],
    },
    browDensity: {
      value: 'FULL' as const,
      confidence: { min: 0.5, max: 0.8 },
      evidence: ['eyes_closeup' as const],
    },
    browShape: {
      value: 'SOFT_ARCH' as const,
      confidence: { min: 0.5, max: 0.8 },
      evidence: ['eyes_closeup' as const],
    },
  }
}

function validStyleDirections(): ConsultAnalysisProviderOutput['styleDirections'] {
  const domains = [
    'HAIR_COLOR_HARMONY',
    'CUT_AND_SHAPE',
    'BANGS',
    'BROWS',
    'LASHES',
    'MAKEUP',
    'COLOR_PALETTE',
  ] as const
  return domains.map((domain) => ({
    domain,
    title: 'A soft, harmonizing direction',
    direction: 'Discuss a soft, blended direction for this domain together.',
    whyItFlatters:
      'Low observed contrast and soft feature balance favor blended, diffused choices.',
    confidence: { min: 0.4, max: 0.7 },
    evidence: ['face_front' as const],
    discussWithProfessional: true as const,
  }))
}

function validOutput(): ProviderOutput {
  const observed = <T extends 'MIXED' | 'NO_VISIBLE_CONCERN' | 'UNKNOWN' | 'WAVY' | 'HIGH'>(
    value: T,
    evidence: Array<'hair_back' | 'hair_left' | 'hair_right' | 'hair_crown'> = ['hair_back'],
  ) => ({
    value,
    confidence:
      value === 'UNKNOWN' ? { min: 0, max: 0.25 } : { min: 0.45, max: 0.7 },
    evidence,
  })
  return {
    profile: validProfile(),
    styleDirections: validStyleDirections(),
    core: {
      baseLevel: {
        value: 'LEVEL_4',
        confidence: { min: 0.5, max: 0.75 },
        evidence: ['hair_back', 'hair_crown'],
      },
      lightestLevel: {
        value: 'LEVEL_5',
        confidence: { min: 0.5, max: 0.75 },
        evidence: ['hair_back', 'hair_crown'],
      },
      currentTone: observed('MIXED'),
      visibleCondition: observed('NO_VISIBLE_CONCERN'),
      density: observed('UNKNOWN', []),
      texture: observed('WAVY'),
    },
    serviceLens: {
      goal: 'A noticeable red direction based on the intake goal.',
      history: 'Prior lightening and box-dye timing should be reviewed.',
      constraints: 'Allergy history and other constraints are unknown.',
      maintenance: 'Maintenance tolerance was not collected and remains unknown.',
      appointmentContext: 'Budget and event timing come from the intake.',
      achievability: 'REQUIRES_PRO_ASSESSMENT',
      achievabilityReason: 'Strand condition and chemical history affect the range.',
      discussWithProfessional: true,
    },
    safetyFlags: [],
    recommendations: [
      {
        service: 'Balayage',
        title: 'Hand-painted dimension',
        rationale: 'Review history and a realistic red direction together.',
        achievability: 'The professional should confirm the appointment plan.',
        discussWithProfessional: true,
      },
    ],
  }
}

/**
 * `validOutput()` is written in the PROVIDER's recommendation shape (a
 * `service` chosen from the per-run enum). The engine converts that to the
 * stored form before anyone validates it, so this helper converts too —
 * otherwise the test would be checking a shape the engine never emits, which
 * is exactly the bug that let every real analysis die.
 */
function asEngineOutput(analysis: unknown): unknown {
  if (!analysis || typeof analysis !== 'object') return analysis
  const output = analysis as ProviderOutput
  if (!Array.isArray(output.recommendations)) return analysis
  return {
    ...output,
    recommendations: output.recommendations.map(({ service, ...fields }) => ({
      ...fields,
      serviceIntent:
        service === CONSULT_ANALYSIS_CONSULTATION_OPTION ? 'CONSULTATION' : 'SERVICE',
      serviceName: service === CONSULT_ANALYSIS_CONSULTATION_OPTION ? null : service,
    })),
  }
}

function validate(analysis: unknown, suppliedShotKeys?: readonly string[]) {
  return validateConsultAnalysisProviderResult(
    { analysis: asEngineOutput(analysis), model: 'fake-model' },
    {
      menuServiceNames: [...MENU],
      ...(suppliedShotKeys
        ? { suppliedShotKeys: suppliedShotKeys as typeof captures[number]['shotKey'][] }
        : {}),
    },
  )
}

function message(payload: unknown, stopReason = 'end_turn') {
  return {
    stop_reason: stopReason,
    content: [{ type: 'text', text: JSON.stringify(payload) }],
  }
}

/**
 * v5 makes TWO provider calls: the feature profile, then the direction that
 * reasons from it. Queue both, in order, or the second `create` resolves with
 * the first call's payload and every assertion downstream is meaningless.
 */
function mockBothCalls(output: ProviderOutput = validOutput()) {
  const { profile, styleDirections, ...rest } = output
  // The PROVIDER returns style directions keyed by domain — the only shape the
  // grammar can hold to exactly seven. The stored artefact is the array, and
  // the sanitizer is what turns one into the other, so the mock must send the
  // keyed shape or that conversion is never exercised.
  const direction = {
    ...rest,
    styleDirections: Object.fromEntries(
      styleDirections.map(({ domain, ...fields }) => [domain, fields]),
    ),
  }
  mocks.create
    .mockResolvedValueOnce(message({ profile }))
    .mockResolvedValueOnce(message(direction))
  return { profile, direction }
}

/** The params of call 1 (profile) and call 2 (direction). */
function callParams() {
  const [profileCall] = mocks.create.mock.calls[0] ?? []
  const [directionCall, directionOptions] = mocks.create.mock.calls[1] ?? []
  return { profileCall, directionCall, directionOptions }
}

beforeEach(() => {
  process.env.ANTHROPIC_API_KEY = 'test-key'
  delete process.env.AI_CONSULT_FACE_COLOR_ENABLED
  delete process.env.AI_CONSULT_ANALYSIS_MODEL
  resetConsultAnalysisClientForTests()
  mocks.create.mockReset()
})

afterEach(() => {
  delete process.env.ANTHROPIC_API_KEY
  delete process.env.AI_CONSULT_FACE_COLOR_ENABLED
  delete process.env.AI_CONSULT_ANALYSIS_MODEL
})

describe('hair-color consult analysis provider', () => {
  it('requires visible eye color in new responses, and reads non-eye evidence as UNKNOWN', () => {
    const profile = validProfile()
    expect(sanitizeConsultProfileResponse({ profile }).eyeColor.value).toBe('BROWN')
    const { eyeColor: _eyeColor, ...missing } = profile
    void _eyeColor
    expect(() => sanitizeConsultProfileResponse({ profile: missing })).toThrowError(
      expect.objectContaining({ kind: 'bad_output', check: 'profile_keys' }),
    )
    // Prod, 2026-09-12: the early selfie was the only photo, the model read the
    // iris from it anyway and cited `early_photo`; until then that one citation
    // discarded the whole paid analysis. It is a repair, not a refusal — the
    // prompt's own answer for eye colour without a reliable face view.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      for (const view of ['early_photo', 'hair_back']) {
        const repaired = sanitizeConsultProfileResponse({ profile: { ...profile, eyeColor: {
          value: 'BROWN', confidence: { min: 0.4, max: 0.7 }, evidence: [view],
        } } })
        expect(repaired.eyeColor).toEqual({ value: 'UNKNOWN', confidence: { min: 0, max: 0.3 }, evidence: [] })
        expect(repaired.jawline).toEqual(profile.jawline)
      }
      expect(warn).toHaveBeenCalledTimes(2)
      expect(JSON.stringify(warn.mock.calls)).not.toContain('BROWN')
    } finally {
      warn.mockRestore()
    }
  })

  it('two look-plan paths that open with the same service become ONE recommendation', () => {
    // Prod-shaped (2026-09-12, replayed on a real selfie): a plan with two
    // paths that both start with the haircut. The stored recommendation list is
    // keyed by service, so before this the run loader's gate refused the whole
    // analysis after both paid calls.
    const path = (title: string, ...services: string[]): ConsultLookPlanProviderOutput['paths'][number] => ({
      title, whyThisWorksForYou: `${title} suits her.`, featureEvidence: [], visits: [{ services }],
    })
    const plan: ConsultLookPlanProviderOutput = {
      tier: 'TOWARD', blocker: 'MORE_INFORMATION', summary: 'Two ways in.', nextStep: 'Talk it through.',
      paths: [
        path('Start with a fresh shape', 'Haircut'),
        path('Shape, then lighten', 'Haircut', 'Full balayage'),
        path('Lighten first', 'Full balayage'),
      ],
    }
    const recommendations = lookPlanRecommendations(plan)
    expect(recommendations.map(r => `${r.serviceName}:${r.title}`)).toEqual([
      'Haircut:Start with a fresh shape',
      'Full balayage:Lighten first',
    ])
    // and the stored-shape gate accepts what the engine now emits
    expect(new Set(recommendations.map(r => `${r.serviceIntent}:${r.serviceName}`)).size).toBe(recommendations.length)
    expect(lookPlanRecommendations({ ...plan, paths: [] })[0]?.serviceIntent).toBe('CONSULTATION')
  })

  it('style-direction texts demand one non-whitespace character, at the boundary', () => {
    const schema = toProviderOutputSchema(buildConsultProfileOutputSchema({ suppliedShotKeys: ['early_photo'], includeStyleDirections: true }))
    const text = JSON.stringify(schema)
    expect(text).toContain('"pattern":"\\\\S"')
    expect(text).toContain('"minLength":1')
  })

  it('a refusal names the check that made it', () => {
    const profile = validProfile()
    expect(() => sanitizeConsultProfileResponse({ profile: { ...profile, jawline: {
      ...profile.jawline, confidence: { min: 0.9, max: 0.4 },
    } } })).not.toThrow() // a swapped pair is repaired, not refused
    expect(() => sanitizeConsultProfileResponse({ profile: { ...profile, jawline: {
      value: 'UNKNOWN', confidence: { min: 0.1, max: 0.3 }, evidence: ['face_front'],
    } } })).toThrowError(expect.objectContaining({ check: 'unknown_contradiction' }))
    expect(() => sanitizeConsultProfileResponse({ profile: { ...profile, jawline: {
      ...profile.jawline, confidence: { min: 0.1, max: 1.4 },
    } } })).toThrowError(expect.objectContaining({ check: 'confidence_range' }))
  })

  it('C2-1 sanitizes the companion face/color profile and merges it without replacing settled fields', () => {
    const observation = (value: string, evidence: string[] = ['face_front']) => ({
      value, confidence: { min: 0.45, max: 0.7 }, evidence,
    })
    const faceColor = sanitizeConsultFaceColorResponse({ profile: {
      skinDepth: observation('MEDIUM'),
      surfaceOvertone: observation('VISIBLE_REDNESS'),
      faceWidthBalance: observation('CHEEKBONE_DOMINANT'),
      chinContour: observation('TAPERED', ['face_side']),
      eyeTilt: observation('LEVEL', ['eyes_closeup']),
      lidVisibility: observation('PARTIAL', ['eyes_closeup']),
      browBoneRelationship: observation('BALANCED', ['eyes_closeup']),
      browArchPosition: observation('OUTER', ['eyes_closeup']),
      browTailDirection: observation('LIFTED', ['eyes_closeup']),
    } })
    const base = sanitizeConsultProfileResponse({ profile: validProfile() })
    const merged = mergeConsultFeatureProfiles(base, faceColor)
    expect(merged.skinUndertone).toEqual(base.skinUndertone)
    expect(merged.skinDepth.value).toBe('MEDIUM')
    expect(merged.surfaceOvertone.value).toBe('VISIBLE_REDNESS')
    expect(Object.keys(merged)).toHaveLength(21)
  })

  it('C2-1 never treats the any-light early selfie as color evidence', () => {
    const unknown = { value: 'UNKNOWN', confidence: { min: 0, max: 0.35 }, evidence: [] }
    const profile = Object.fromEntries([
      'skinDepth', 'surfaceOvertone', 'faceWidthBalance', 'chinContour', 'eyeTilt',
      'lidVisibility', 'browBoneRelationship', 'browArchPosition', 'browTailDirection',
    ].map((field) => [field, { ...unknown }])) as Record<string, unknown>
    profile.skinDepth = { value: 'MEDIUM', confidence: { min: 0.4, max: 0.6 }, evidence: ['early_photo'] }
    expect(() => sanitizeConsultFaceColorResponse({ profile })).toThrow(ConsultAnalysisProviderError)
  })

  it.each(['skinDepth', 'surfaceOvertone'])('C2-1 rejects eyes_closeup as %s color evidence', (field) => {
    expect(() => sanitizeConsultFaceColorResponse({ profile: { ...unknownFaceColorProfile(),
      [field]: { value: field === 'skinDepth' ? 'MEDIUM' : 'BALANCED', confidence: { min: 0.4, max: 0.7 }, evidence: ['eyes_closeup'] },
    } })).toThrow(ConsultAnalysisProviderError)
  })

  it('C2-1 companion schema is a separate provider-safe grammar', () => {
    const schema = toProviderOutputSchema(buildConsultFaceColorOutputSchema({ suppliedShotKeys: SUPPLIED }))
    expect(findUnsupportedProviderSchemaKeywords(schema)).toEqual([])
    expect(JSON.stringify(schema)).toContain('surfaceOvertone')
    expect(JSON.stringify(schema)).toContain('browTailDirection')
    expect(JSON.stringify(schema)).not.toContain('styleDirections')
  })

  it('C2-1 companion provider sends only face evidence and returns the strict profile', async () => {
    const observation = (value: string, evidence: string[] = ['face_front']) => ({
      value, confidence: { min: 0.45, max: 0.7 }, evidence,
    })
    mocks.create.mockResolvedValueOnce(message({ profile: {
      skinDepth: observation('MEDIUM'),
      surfaceOvertone: observation('BALANCED'),
      faceWidthBalance: observation('CHEEKBONE_DOMINANT'),
      chinContour: observation('TAPERED', ['face_side']),
      eyeTilt: observation('LEVEL', ['eyes_closeup']),
      lidVisibility: observation('PARTIAL', ['eyes_closeup']),
      browBoneRelationship: observation('BALANCED', ['eyes_closeup']),
      browArchPosition: observation('OUTER', ['eyes_closeup']),
      browTailDirection: observation('LIFTED', ['eyes_closeup']),
    } }))
    const result = await runConsultFaceColorCompanion({
      service,
      capturePack,
      intake: { desired_color: 'red', prior_reaction: 'no' },
      intakeItems,
      captures,
      inspiration: noInspiration,
      safetyCodes: [...SAFETY_CODES],
    })
    expect(result.faceWidthBalance.value).toBe('CHEEKBONE_DOMINANT')
    expect(mocks.create).toHaveBeenCalledTimes(1)
    const [params] = mocks.create.mock.calls[0] ?? []
    expect(params.system).toContain('face and color observation engine')
    const wire = JSON.stringify(params.messages[0].content)
    expect(wire).toContain('face_front')
    expect(wire).toContain('eyes_closeup')
    expect(wire).not.toContain('Evidence label: hair_back')
    expect(params.messages[0].content.filter((item: { type: string }) => item.type === 'image')).toHaveLength(3)
  })

  it.each(['true', 'false', undefined])('C2-1 activates only for the exact flag value %s', async (flag) => {
    if (flag !== undefined) process.env.AI_CONSULT_FACE_COLOR_ENABLED = flag
    const { profile, direction } = mockBothCalls()
    mocks.create.mockReset()
    mocks.create.mockResolvedValueOnce(message({ profile }))
    if (flag === 'true') mocks.create.mockResolvedValueOnce(message({ profile: unknownFaceColorProfile() }))
    mocks.create.mockResolvedValueOnce(message(direction))
    const result = await runConsultAnalysis({ service, capturePack, intake: {}, intakeItems, captures,
      inspiration: noInspiration, safetyCodes: [...SAFETY_CODES] })
    expect(result.analysis.profile).toEqual(profile)
    expect(result.faceColorProfile).toEqual(flag === 'true' ? unknownFaceColorProfile() : undefined)
    expect(mocks.create).toHaveBeenCalledTimes(flag === 'true' ? 3 : 2)
    if (flag === 'true') expect(mocks.create.mock.calls[1]?.[1].timeout).toBe(CONSULT_FACE_COLOR_TIMEOUT_MS)
  })

  it.each(['timeout', 'refusal', 'invalid', 'unsupplied'])('C2-1 preserves the consultation on companion %s', async (failure) => {
    process.env.AI_CONSULT_FACE_COLOR_ENABLED = 'true'
    const { profile, direction } = mockBothCalls()
    mocks.create.mockReset()
    mocks.create.mockResolvedValueOnce(message({ profile }))
    if (failure === 'timeout') mocks.create.mockRejectedValueOnce(new Error('timeout'))
    if (failure === 'refusal') mocks.create.mockResolvedValueOnce(message({}, 'refusal'))
    if (failure === 'invalid') mocks.create.mockResolvedValueOnce(message({ profile: {} }))
    if (failure === 'unsupplied') mocks.create.mockResolvedValueOnce(message({ profile: {
      ...unknownFaceColorProfile(), chinContour: { value: 'TAPERED', confidence: { min: 0.4, max: 0.7 }, evidence: ['early_photo'] },
    } }))
    mocks.create.mockResolvedValueOnce(message(direction))
    const result = await runConsultAnalysis({ service, capturePack, intake: {}, intakeItems, captures,
      inspiration: noInspiration, safetyCodes: [...SAFETY_CODES] })
    expect(result.analysis.profile).toEqual(profile)
    expect(result.faceColorProfile).toEqual(unknownFaceColorProfile())
    expect(validateConsultAnalysisProviderResult(result, { menuServiceNames: MENU, suppliedShotKeys: SUPPLIED })).toEqual(result)
    expect(result.analysis.recommendations).not.toHaveLength(0)
  })

  it('C2-1 skips paid companion work with no face views', async () => {
    const result = await runConsultFaceColorCompanion({ service, capturePack, intake: {}, intakeItems,
      captures: captures.filter(capture => capture.shotKey === 'hair_back'),
      inspiration: noInspiration, safetyCodes: [...SAFETY_CODES] })
    expect(result).toEqual(unknownFaceColorProfile())
    expect(mocks.create).not.toHaveBeenCalled()
  })

  it('C2-1 removes color claims from warned images while preserving geometry', async () => {
    const observation = { value: 'MEDIUM', confidence: { min: 0.4, max: 0.7 }, evidence: ['face_front'] }
    mocks.create.mockResolvedValueOnce(message({ profile: { ...unknownFaceColorProfile(),
      skinDepth: observation, chinContour: { ...observation, value: 'TAPERED' },
    } }))
    const result = await runConsultFaceColorCompanion({ service, capturePack, intake: {}, intakeItems,
      captures: captures.map(capture => ({ ...capture, qualityWarningCode: 'COLOR_CAST' })),
      inspiration: noInspiration, safetyCodes: [...SAFETY_CODES] })
    expect(result.skinDepth).toEqual(unknownFaceColorProfile().skinDepth)
    expect(result.chinContour.value).toBe('TAPERED')
  })

  it('C2-1 rejects non-face evidence even if it was supplied to the main analysis', () => {
    expect(() => sanitizeConsultFaceColorResponse({ profile: { ...unknownFaceColorProfile(),
      chinContour: { value: 'TAPERED', confidence: { min: 0.4, max: 0.7 }, evidence: ['hair_back'] },
    } })).toThrow(ConsultAnalysisProviderError)
  })

  it('fails closed before sending photos when the model override is not allowlisted', async () => {
    process.env.AI_CONSULT_ANALYSIS_MODEL = 'claude-sonnet-5-typo'

    await expect(
      runConsultAnalysis({
        service,
        capturePack,
        intake: { desired_color: 'red', prior_reaction: 'no' },
        intakeItems,
        captures,
        inspiration: noInspiration,
        safetyCodes: [...SAFETY_CODES],
      }),
    ).rejects.toBeInstanceOf(ConsultAnalysisProviderError)
    // The assertion that matters: no image ever reached the provider.
    expect(mocks.create).not.toHaveBeenCalled()
  })

  it('pins exact schema/prompt/model versions and sends seven labeled images to BOTH calls', async () => {
    mockBothCalls()
    const result = await runConsultAnalysis({
      service,
      capturePack,
      intake: { desired_color: 'red', prior_reaction: 'no' },
      intakeItems,
      captures,
      inspiration: noInspiration,
      safetyCodes: [...SAFETY_CODES],
    })
    expect(CONSULT_ANALYSIS_SCHEMA_VERSION).toBe(6)
    expect(CONSULT_ANALYSIS_PROMPT_VERSION).toBe('service-analysis-v8')
    expect(result.model).toBe(CONSULT_ANALYSIS_DEFAULT_MODEL)

    // v5 is TWO calls, in order, and the second is the one that can name a
    // service. If this ever reads 1 again, the schema went back over the
    // grammar budget and nothing but a live request would say so.
    expect(mocks.create).toHaveBeenCalledTimes(2)
    const { profileCall, directionCall, directionOptions } = callParams()

    expect(profileCall.model).toBe('claude-sonnet-5')
    expect(profileCall.system).toBe(CONSULT_ANALYSIS_PROFILE_SYSTEM_PROMPT)
    expect(profileCall.output_config).toEqual({
      // The effort level rides in output_config beside the schema, and it is
      // load-bearing: at the default, thinking is most of the answer and the
      // direction call truncated. See CONSULT_ANALYSIS_EFFORT.
      effort: CONSULT_ANALYSIS_EFFORT,
      format: {
        type: 'json_schema',
        schema: toProviderOutputSchema(
          buildConsultProfileOutputSchema({ suppliedShotKeys: SUPPLIED }),
        ),
      },
    })

    expect(directionCall.model).toBe('claude-sonnet-5')
    expect(directionCall.system).toBe(CONSULT_ANALYSIS_DIRECTION_SYSTEM_PROMPT)
    // The direction schema is built PER RUN: the recommendation enum is this
    // pro's menu plus the fixed consultation option, so the model cannot
    // invent a service.
    //
    // 🔴 It is the SANITIZED schema on the wire, not the constant. This
    // assertion used to pin the constant itself — which is the shape the API
    // rejects with a 400, so the test was asserting the bug. See
    // lib/consult/providerSchema.ts.
    expect(directionCall.output_config).toEqual({
      effort: CONSULT_ANALYSIS_EFFORT,
      format: {
        type: 'json_schema',
        schema: toProviderOutputSchema(
          buildConsultDirectionOutputSchema({
            menuServiceNames: [...MENU],
            safetyCodes: [...SAFETY_CODES],
            suppliedShotKeys: SUPPLIED,
          }),
        ),
      },
    })

    // 🔴 The two bounds the grammar CAN enforce, both of which v3 stated in a
    // form that was silently stripped at the boundary and therefore never
    // enforced at all. The live model took both permissions.
    const directionSchema = directionCall.output_config.format.schema as {
      properties: { styleDirections: { type: string; required: string[]; properties: Record<string, unknown> } }
      $defs: Record<string, { minItems?: number; properties?: Record<string, unknown> }>
    }
    // 1. Exactly seven style directions. `minItems: 7`/`maxItems: 7` on an
    //    array do not survive; `required` on an object does, so the domains
    //    are KEYS. A duplicate domain is unrepresentable by construction.
    expect(directionSchema.properties.styleDirections.type).toBe('object')
    expect(directionSchema.properties.styleDirections.required).toEqual([
      ...CONSULT_STYLE_DOMAINS,
    ])
    expect(Object.keys(directionSchema.properties.styleDirections.properties)).toEqual([
      ...CONSULT_STYLE_DOMAINS,
    ])
    // 2. A style direction cites at least one label. `minItems: 1` DOES
    //    survive, and it is the only thing standing between "cite your
    //    evidence" and a paid consult thrown away by the sanitizer.
    expect(directionSchema.$defs.styleDirection?.properties?.evidence).toEqual({
      $ref: '#/$defs/citedEvidence',
    })
    expect(directionSchema.$defs.citedEvidence?.minItems).toBe(1)
    // ...while an observation's evidence may legitimately be empty: that is
    // how an UNKNOWN says it read nothing.
    expect(directionSchema.$defs.evidence?.minItems).toBeUndefined()
    for (const params of [profileCall, directionCall]) {
      expect(
        findUnsupportedProviderSchemaKeywords(params.output_config.format.schema),
      ).toEqual([])
      expect(
        params.messages[0].content.filter(
          (item: { type: string }) => item.type === 'image',
        ),
      ).toHaveLength(7)
      expect(JSON.stringify(params.messages[0].content)).toContain('hair_crown')
      expect(JSON.stringify(params.messages[0].content)).toContain('eyes_closeup')
    }
    expect(JSON.stringify(directionCall.output_config)).toContain(
      JSON.stringify(['Balayage', 'Toner Gloss', CONSULT_ANALYSIS_CONSULTATION_OPTION]),
    )
    // No-menu default: only the consultation option is recommendable.
    expect(JSON.stringify(CONSULT_ANALYSIS_DIRECTION_OUTPUT_SCHEMA)).toContain(
      JSON.stringify([CONSULT_ANALYSIS_CONSULTATION_OPTION]),
    )
    // The profile schema takes no menu at all — it recommends nothing.
    expect(JSON.stringify(CONSULT_ANALYSIS_PROFILE_OUTPUT_SCHEMA)).not.toContain(
      CONSULT_ANALYSIS_CONSULTATION_OPTION,
    )
    expect(result.analysis.recommendations[0]).toMatchObject({
      serviceIntent: 'SERVICE',
      serviceName: 'Balayage',
    })
    expect(directionOptions.timeout).toBe(CONSULT_ANALYSIS_DIRECTION_TIMEOUT_MS)
    // 🔴 The arithmetic the analysis route's `maxDuration` has to satisfy.
    // With C2-1 enabled, one run may make inspiration + profile + face/color +
    // direction calls. If someone raises a ceiling, this must stay inside the
    // platform's 300s worker cap or the client can be billed before a timeout.
    expect(
      CONSULT_INSPIRATION_REQUEST_TIMEOUT_MS +
        CONSULT_ANALYSIS_PROFILE_TIMEOUT_MS +
        CONSULT_FACE_COLOR_TIMEOUT_MS +
        CONSULT_ANALYSIS_DIRECTION_TIMEOUT_MS,
    ).toBeLessThanOrEqual(CONSULT_ANALYSIS_ROUTE_MAX_DURATION_SECONDS * 1000)
  })

  it('offers only the safety codes THIS intake can support, plus the one the photos raise', () => {
    // 🔴 On every intake pack the policy's supported set IS its required set:
    // a code outside it is a fabricated concern, and
    // `applyConsultSafetyFlagPolicy` discards the ENTIRE analysis for one.
    // Measured live on 2026-09-04 — a complete, correct, fully-paid consult was
    // thrown away because the model raised CHEMICAL_HISTORY_UNKNOWN on an
    // intake that had answered its chemical questions. So the enum is narrowed
    // BEFORE the call, exactly as the recommendation enum is narrowed to this
    // pro's menu, and enum members cost nothing in the grammar.
    expect(consultAnalysisSafetyCodeOptions(['ALLERGY_HISTORY_UNKNOWN'])).toEqual([
      'ALLERGY_HISTORY_UNKNOWN',
      'VISIBLE_COMPROMISE',
    ])
    // VISIBLE_COMPROMISE is always available — it is the one code the PHOTOS
    // raise rather than the intake, and it keeps the enum non-empty for an
    // intake that triggers nothing (an empty enum is not a valid schema).
    expect(consultAnalysisSafetyCodeOptions([])).toEqual(['VISIBLE_COMPROMISE'])
    // Fixed order regardless of how the policy enumerated them.
    expect(
      consultAnalysisSafetyCodeOptions(['VISIBLE_COMPROMISE', 'PRIOR_REACTION']),
    ).toEqual(['PRIOR_REACTION', 'VISIBLE_COMPROMISE'])

    const schema = JSON.stringify(
      buildConsultDirectionOutputSchema({
        menuServiceNames: [],
        safetyCodes: ['ALLERGY_HISTORY_UNKNOWN'],
        suppliedShotKeys: SUPPLIED,
      }),
    )
    expect(schema).toContain(
      JSON.stringify(['ALLERGY_HISTORY_UNKNOWN', 'VISIBLE_COMPROMISE']),
    )
    expect(schema).not.toContain('CHEMICAL_HISTORY_UNKNOWN')
  })

  it('accepts the shape runConsultAnalysis ACTUALLY returns, not the one the mocks return', async () => {
    // 🔴 The regression this exists for: `validateConsultAnalysisProviderResult`
    // asked for the PROVIDER recommendation shape (`service`), which the engine
    // never emits — `sanitizeRecommendation` has already converted it to
    // `serviceIntent` + `serviceName`. So it threw on EVERY real analysis, and
    // no suite noticed, because the fakes return the un-converted shape that
    // the function under test does not. The only way to catch that is to feed
    // this validator the engine's own output.
    mockBothCalls()
    const result = await runConsultAnalysis({
      service,
      capturePack,
      intake: { desired_color: 'red' },
      intakeItems,
      captures,
      inspiration: noInspiration,
      safetyCodes: [...SAFETY_CODES],
    })
    expect(result.analysis.recommendations[0]).toMatchObject({
      serviceIntent: 'SERVICE',
      serviceName: 'Balayage',
    })
    expect(() =>
      validateConsultAnalysisProviderResult(result, {
        menuServiceNames: [...MENU],
        suppliedShotKeys: captures.map((capture) => capture.shotKey),
      }),
    ).not.toThrow()

    // ...and it still holds the two guarantees the `service` enum used to: a
    // named service must be on THIS pro's menu, and only the provider intents.
    const offMenu = {
      ...result,
      analysis: {
        ...result.analysis,
        recommendations: [
          {
            ...result.analysis.recommendations[0]!,
            serviceName: 'A service she does not offer',
          },
        ],
      },
    }
    expect(() =>
      validateConsultAnalysisProviderResult(offMenu, { menuServiceNames: [...MENU] }),
    ).toThrowError(ConsultAnalysisProviderError)
  })

  it('offers only the evidence labels this run actually supplied', async () => {
    // 🔴 Citing a view that was never sent is a fabricated observation, and
    // `assertEvidenceSupplied` discards the whole analysis for one. Measured
    // live on 2026-09-04: a four-hair-view run cited `eyes_closeup` and a
    // complete paid consult died. Labels cost nothing, so the ones that do not
    // exist this run are simply not on the menu.
    mockBothCalls()
    const partial = captures.filter((capture) => capture.shotKey.startsWith('hair_'))
    await runConsultAnalysis({
      service,
      capturePack,
      intake: {},
      intakeItems: [],
      captures: partial,
      inspiration: noInspiration,
      safetyCodes: [...SAFETY_CODES],
    })
    for (const params of Object.values(callParams()).filter(Boolean)) {
      const schema = JSON.stringify(
        (params as { output_config?: { format: { schema: unknown } } }).output_config
          ?.format.schema ?? {},
      )
      if (!schema || schema === '{}') continue
      expect(schema).toContain('hair_back')
      // The face views were not sent, so they are not offerable.
      expect(schema).not.toContain('face_front')
      expect(schema).not.toContain('eyes_closeup')
    }
  })

  it('refuses a truncated answer as its own failure, not the model’s', async () => {
    // A structured-output answer that hits max_tokens comes back as invalid
    // JSON. That is this repo's cap being too low, and it must fail loudly
    // rather than reaching the parser as unexplained garbage. The first live
    // run of v5 truncated the direction call on exactly this boundary.
    mocks.create.mockResolvedValueOnce({
      stop_reason: 'max_tokens',
      content: [{ type: 'text', text: '{"profile":{"skinUndertone":{"value":"NEU' }],
    })
    await expect(
      runConsultAnalysis({
        service,
        capturePack,
        intake: {},
        intakeItems: [],
        captures,
        inspiration: noInspiration,
        safetyCodes: [...SAFETY_CODES],
      }),
    ).rejects.toBeInstanceOf(ConsultAnalysisProviderError)
    expect(mocks.create).toHaveBeenCalledTimes(1)
  })

  it('hands the profile to the direction call as settled structure, and never the reverse', async () => {
    const { profile } = mockBothCalls()
    await runConsultAnalysis({
      service,
      capturePack,
      intake: {},
      intakeItems: [],
      captures,
      inspiration: noInspiration,
      safetyCodes: [...SAFETY_CODES],
    })
    const { profileCall, directionCall } = callParams()

    // Call 2 is told what call 1 found, field by field, as text — the schema
    // has no `profile` property, so it cannot restate or re-derive it.
    const directionText = JSON.stringify(directionCall.messages[0].content)
    expect(directionText).toContain('Client feature profile (already established')
    expect(directionText).toContain('skinUndertone: NEUTRAL')
    expect(directionText).toContain('colorSeason: UNKNOWN (not established')
    // Byte for byte what the first call actually answered — not a paraphrase
    // assembled a second time, which could drift from it silently.
    expect(directionCall.messages[0].content).toContainEqual({
      type: 'text',
      text: consultProfileBlock(profile),
    })
    expect(
      Object.keys(
        (directionCall.output_config.format.schema as { properties: object })
          .properties,
      ),
    ).not.toContain('profile')

    // And call 1 never sees the reference photograph's reading: what flatters
    // the client is not a question about the picture she brought.
    const profileText = JSON.stringify(profileCall.messages[0].content)
    expect(profileText).not.toContain('Client inspiration')
    expect(profileText).toContain('Service category: Color')
  })

  it('tells the provider what the consult is FOR: family, category, service, menu, and the intake as labels', async () => {
    mockBothCalls()
    await runConsultAnalysis({
      service,
      capturePack,
      intake: { desired_color: 'red' },
      intakeItems,
      captures,
      inspiration: noInspiration,
      safetyCodes: [...SAFETY_CODES],
    })
    const [params] = mocks.create.mock.calls[0] ?? []
    const serialized = JSON.stringify(params.messages[0].content)
    expect(serialized).toContain('Service family: Hair')
    expect(serialized).toContain('Service category: Color')
    expect(serialized).toContain('Service linked to the reference or booking (context, not a required choice): Balayage')
    expect(serialized).toContain('recommend only these, named exactly): Balayage; Toner Gloss')
    expect(serialized).toContain('Your dream color? → Red [desired_color=red]')
    expect(serialized).toContain('Immutable intake option codes')
    // A look with no linked service and a pro with no menu are said plainly.
    const bare = consultAnalysisContextBlocks({
      service: { family: 'NAILS', categoryName: 'Nails', serviceName: null, menuServiceNames: [] },
      capturePack: { id: 'area-daylight', shotKeys: ['area_wide', 'area_closeup', 'face_front'] },
      intake: {},
      intakeItems: [],
      inspiration: noInspiration,
    })
    expect(bare.consultation).toContain('not named yet')
    expect(bare.consultation).toContain('none listed')
  })

  it('keeps unsupported traits unknown and rejects unsupported or medical language', () => {
    const unknown = validOutput()
    unknown.core.baseLevel = {
      value: 'UNKNOWN',
      confidence: { min: 0, max: 0.2 },
      evidence: [],
    }
    unknown.core.lightestLevel = {
      value: 'UNKNOWN',
      confidence: { min: 0, max: 0.2 },
      evidence: [],
    }
    expect(validate(unknown)).toMatchObject({
      analysis: {
        core: {
          baseLevel: { value: 'UNKNOWN', evidence: [] },
          lightestLevel: { value: 'UNKNOWN', evidence: [] },
        },
      },
    })

    // The one relationship the scale forbids: a base LIGHTER than the
    // lightest. Nothing else about the pair is constrained — equal is the
    // right answer for a solid single-process, and must stay valid.
    const inverted = validOutput()
    inverted.core.baseLevel.value = 'LEVEL_9'
    inverted.core.lightestLevel.value = 'LEVEL_5'
    expect(() => validate(inverted)).toThrowError(ConsultAnalysisProviderError)

    const solid = validOutput()
    solid.core.baseLevel.value = 'LEVEL_6'
    solid.core.lightestLevel.value = 'LEVEL_6'
    expect(() => validate(solid)).not.toThrow()

    // A level read off a face view is not a level.
    const wrongEvidence = validOutput()
    wrongEvidence.core.lightestLevel.evidence = ['face_front']
    expect(() => validate(wrongEvidence)).toThrowError(ConsultAnalysisProviderError)

    const forbidden = validOutput()
    forbidden.serviceLens.goal = 'A diagnosis of a scalp disorder.'
    expect(() =>
      validate(forbidden),
    ).toThrowError(ConsultAnalysisProviderError)
  })

  it('rejects malformed ranges, unsupported evidence, extra fields, and provider provenance drift', () => {
    // 2026-09-11: a REVERSED range is repaired (same pair, right way round), so
    // the malformed case is one that is not a range at all — a bound outside
    // [0, 1]. The repair has its own tests below.
    const badRange = validOutput()
    badRange.core.currentTone.confidence = { min: 0.9, max: 1.2 }
    expect(() =>
      validate(badRange),
    ).toThrowError(ConsultAnalysisProviderError)

    const unsupported = validOutput()
    unsupported.core.density = {
      value: 'HIGH',
      confidence: { min: 0.3, max: 0.6 },
      evidence: [],
    }
    expect(() =>
      validate(unsupported),
    ).toThrowError(ConsultAnalysisProviderError)

    const withExtra = { ...validOutput(), hiddenReasoning: 'secret' }
    expect(() =>
      validate(withExtra),
    ).toThrowError(ConsultAnalysisProviderError)
  })

  it('rejects duplicate and empty capture packs before provider work', async () => {
    const duplicatePack = captures.map(() => captures[0]!)
    await expect(
      runConsultAnalysis({
        service,
        capturePack,
        intake: {},
        intakeItems: [],
        captures: duplicatePack,
        inspiration: noInspiration,
        safetyCodes: [...SAFETY_CODES],
      }),
    ).rejects.toThrowError(ConsultAnalysisProviderError)
    await expect(
      runConsultAnalysis({
        service,
        capturePack,
        intake: {},
        intakeItems: [],
        captures: [],
        inspiration: noInspiration,
        safetyCodes: [...SAFETY_CODES],
      }),
    ).rejects.toThrowError(ConsultAnalysisProviderError)
    expect(mocks.create).not.toHaveBeenCalled()
  })

  it('accepts a partial pack and names the missing views to the provider', async () => {
    mockBothCalls()
    const partial = captures.filter(
      (capture) =>
        capture.shotKey !== 'hair_back' && capture.shotKey !== 'face_side',
    )
    await runConsultAnalysis({
      service,
      capturePack,
      intake: { desired_color: 'red' },
      intakeItems,
      captures: partial,
      inspiration: noInspiration,
      safetyCodes: [...SAFETY_CODES],
    })
    const [params] = mocks.create.mock.calls[0] ?? []
    const images = params.messages[0].content.filter(
      (item: { type: string }) => item.type === 'image',
    )
    expect(images).toHaveLength(5)
    const serialized = JSON.stringify(params.messages[0].content)
    expect(serialized).toContain(
      'Missing views (not supplied): hair_back, face_side.',
    )
    expect(serialized).not.toContain('Evidence label: hair_back')
  })

  it('sends no missing-views line for a full pack', async () => {
    mockBothCalls()
    await runConsultAnalysis({
      service,
      capturePack,
      intake: {},
      intakeItems: [],
      captures,
      inspiration: noInspiration,
      safetyCodes: [...SAFETY_CODES],
    })
    const [params] = mocks.create.mock.calls[0] ?? []
    expect(JSON.stringify(params.messages[0].content)).not.toContain(
      'Missing views',
    )
  })

  it('refuses provider output citing a view that was not supplied', () => {
    // validOutput cites hair_back / face_front / eyes_closeup.
    const supplied = ['face_front', 'eyes_closeup'] as const
    expect(() => validate(validOutput(), [...supplied])).toThrowError(
      ConsultAnalysisProviderError,
    )

    const fullSupplied = captures.map((capture) => capture.shotKey)
    expect(() => validate(validOutput(), fullSupplied)).not.toThrow()
  })

  it('returns typed content-free failures for provider errors and refusals', async () => {
    mocks.create.mockRejectedValueOnce(new Error('provider request secret'))
    await expect(
      runConsultAnalysis({
      service,
      capturePack,
      intake: {},
      intakeItems: [],
      captures,
      inspiration: noInspiration,
      safetyCodes: [...SAFETY_CODES],
    }),
    ).rejects.toMatchObject({
      kind: 'unavailable',
      message: 'Consult analysis is unavailable.',
    } satisfies Partial<ConsultAnalysisProviderError>)

    mocks.create.mockResolvedValueOnce(message({}, 'refusal'))
    await expect(
      runConsultAnalysis({
      service,
      capturePack,
      intake: {},
      intakeItems: [],
      captures,
      inspiration: noInspiration,
      safetyCodes: [...SAFETY_CODES],
    }),
    ).rejects.toMatchObject({ kind: 'refused' } satisfies Partial<ConsultAnalysisProviderError>)
  })

  it('allows deterministic test intents only after the provider boundary', () => {
    const base: Record<string, unknown> = validOutput()
    const routed = {
      ...base,
      recommendations: [
        {
          serviceIntent: 'STRAND_TEST',
          serviceName: null,
          title: 'Strand Test',
          rationale: 'Test a small section before selecting a chemical service.',
          achievability: 'The professional will review the result.',
          discussWithProfessional: true,
        },
      ],
    }
    expect(() =>
      validate(routed),
    ).toThrowError(ConsultAnalysisProviderError)
    expect(
      validateConsultAnalysisResult({
        analysis: routed,
        model: 'fake-model',
      }).analysis.recommendations[0]?.serviceIntent,
    ).toBe('STRAND_TEST')
  })
})

describe('P4 — the inspiration reference in the analysis prompt', () => {
  const analysis: NonNullable<ConsultAnalysisInput['inspiration']['analysis']> = {
    baseLevel: obs('LEVEL_5'),
    lightestLevel: obs('LEVEL_9'),
    tone: obs('COOL'),
    technique: obs('BALAYAGE'),
    placement: obs('MIDS_TO_ENDS'),
    rootBlend: obs('SHADOW_ROOT'),
    finish: obs('HIGH_SHINE'),
    dimension: {
      value: 'UNKNOWN' as const,
      confidence: { min: 0.05, max: 0.3 },
      evidence: [],
      region: null,
    },
  }

  it('names every attribute it read, and says plainly which one it could not', () => {
    const block = consultInspirationBlock({
      source: 'EXTERNAL_UPLOAD',
      analysis,
      answers: [
        { question: 'Which color or colors in this picture are your favorite?', answer: 'The lightest pieces (LIKE)' },
      ],
      wants: ['lightestLevel:LEVEL_9'],
      avoids: ['tone:COOL'],
      unsure: ['finish:HIGH_SHINE'],
      keep: ['My length'],
    })
    expect(block).toContain('source: EXTERNAL_UPLOAD')
    expect(block).toContain('- baseLevel: LEVEL_5 (confidence 0.4–0.6)')
    expect(block).toContain('- lightestLevel: LEVEL_9 (confidence 0.4–0.6)')
    expect(block).toContain('- tone: COOL')
    expect(block).toContain('- rootBlend: SHADOW_ROOT')
    // An attribute the photograph did not show is stated as unread, not omitted
    // — an omission reads to the model as "not relevant", which is a different
    // claim from "not visible".
    expect(block).toContain('- dimension: UNKNOWN (the photograph does not show it)')
    // Her own words ride alongside the read.
    expect(block).toContain('The lightest pieces (LIKE)')
    // And the reference is never presented as an observation about the client.
    expect(block).toContain('this describes the DESIRED result, not the client')
    // P5d — her card taps, paired with the attribute VALUES they were about.
    // A bare "yes" is not an answer to anything; the pair is.
    expect(block).toContain('she confirmed she WANTS from the reference: lightestLevel:LEVEL_9')
    expect(block).toContain('never recommend these: tone:COOL')
    expect(block).toContain('do not decide it for her: finish:HIGH_SHINE')
    expect(block).toContain('keep unchanged about her own hair: My length')
  })

  it('says the client brought nothing rather than leaving the model to assume', () => {
    const block = consultInspirationBlock({
      source: 'NONE',
      analysis: null,
      answers: [],
      wants: [],
      avoids: [],
      unsure: [],
      keep: [],
    })
    expect(block).toContain('brought no reference photograph')
    expect(block).toContain('do not invent a reference')
  })

  it('is one of the context blocks the provider is actually sent', () => {
    const blocks = consultAnalysisContextBlocks({
      service,
      capturePack,
      intake: {},
      intakeItems: [],
      inspiration: {
        source: 'PLATFORM_LOOK',
        analysis,
        answers: [],
        wants: [],
        avoids: [],
        unsure: [],
        keep: [],
      },
    })
    expect(blocks.inspiration).toContain('Client inspiration reference')
  })

  it('labels a capture whose colour the quality gate warned about', async () => {
    mockBothCalls()
    await runConsultAnalysis({
      service,
      capturePack,
      intake: {},
      intakeItems: [],
      captures: captures.map((capture) =>
        capture.shotKey === 'hair_back'
          ? { ...capture, qualityWarningCode: 'WARM_INDOOR_LIGHT' as const }
          : capture,
      ),
      inspiration: noInspiration,
      safetyCodes: [...SAFETY_CODES],
    })
    // The label rides on the images, which BOTH calls are sent.
    const { profileCall, directionCall } = callParams()
    for (const params of [profileCall, directionCall]) {
      const serialized = JSON.stringify(params.messages[0].content)
      expect(serialized).toContain(
        'Evidence label: hair_back (color warning: WARM_INDOOR_LIGHT',
      )
      // Only the warned frame is labelled; the rest stay plain.
      expect(serialized).toContain('Evidence label: hair_left"')
    }
    // ...and both prompts say what to DO about a warned frame. A rule that
    // lives in only one of the two prompts applies half the time.
    expect(profileCall.system).toContain('widen the confidence range on any observation that leans on it')
    expect(directionCall.system).toContain('widen the confidence range on any tone or level observation')
  })
})

/** A minimal known inspiration observation for the prompt tests. */
function obs<const T extends string>(value: T) {
  return {
    value,
    confidence: { min: 0.4, max: 0.6 },
    evidence: ['inspiration' as const],
    region: { x: 0.1, y: 0.1, w: 0.5, h: 0.5 },
  }
}

describe('the early selfie as the only photo (prod, 2026-09-11)', () => {
  // Every "Build my plan" in production failed in ~1s with ANALYSIS_UNAVAILABLE
  // and nothing metered: the consult's only accepted capture was `early_photo`,
  // the run loader admits it by name, and this engine's first guard only knew
  // the daylight pack. The integration suites mock this function, so only a
  // unit test here can hold the line.
  const earlyOnly = [{
    qualityWarningCode: null,
    shotKey: 'early_photo' as const,
    image: { base64: 'ZWFybHk=', mediaType: 'image/jpeg' as const },
  }]

  beforeEach(() => {
    mocks.create.mockReset()
    resetConsultAnalysisClientForTests()
  })

  it('is admitted, sent first with its own evidence label, and every pack view is reported missing', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      mockBothCalls()
      await expect(runConsultAnalysis({
        service, capturePack, intake: {}, intakeItems: [], captures: earlyOnly,
        inspiration: noInspiration, safetyCodes: [...SAFETY_CODES],
      })).resolves.toBeTruthy()
      const [params] = mocks.create.mock.calls[0] ?? []
      const content = params.messages[0].content as Array<{ type: string; text?: string }>
      expect(content.filter((item) => item.type === 'image')).toHaveLength(1)
      expect(content[0]?.text).toBe('Evidence label: early_photo')
      expect(content[1]?.type).toBe('image')
      expect(JSON.stringify(content)).toContain(
        'Missing views (not supplied): hair_back, hair_left, hair_right, hair_crown, face_front, face_side, eyes_closeup.',
      )
      expect(errors).not.toHaveBeenCalled()
    } finally {
      errors.mockRestore()
    }
  })

  it('still refuses a capture that is neither a pack view nor the early photo, and says why', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      mockBothCalls()
      await expect(runConsultAnalysis({
        service, capturePack, intake: {}, intakeItems: [],
        captures: [{ ...earlyOnly[0]!, shotKey: 'area_wide' }],
        inspiration: noInspiration, safetyCodes: [...SAFETY_CODES],
      })).rejects.toThrowError(ConsultAnalysisProviderError)
      expect(mocks.create).not.toHaveBeenCalled()
      expect(errors).toHaveBeenCalledWith(
        'consult analysis refused before the model call',
        expect.objectContaining({ reason: 'capture_set', inadmissibleShotKeys: ['area_wide'] }),
      )
    } finally {
      errors.mockRestore()
    }
  })

  it('logs a provider rejection content-free instead of swallowing it', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      mocks.create.mockRejectedValueOnce(Object.assign(new Error('invalid_request_error: grammar too large'), { status: 400 }))
      await expect(runConsultAnalysis({
        service, capturePack, intake: {}, intakeItems: [], captures: earlyOnly,
        inspiration: noInspiration, safetyCodes: [...SAFETY_CODES],
      })).rejects.toThrowError(ConsultAnalysisProviderError)
      expect(errors).toHaveBeenCalledWith(
        'consult analysis provider request failed',
        expect.objectContaining({ status: 400 }),
      )
    } finally {
      errors.mockRestore()
    }
  })
})

describe('what the grammar cannot hold is repaired, not discarded (2026-09-11)', () => {
  // The nightly live contract had been red since 09-08 on a confidence range
  // the model returned as a point; the early-selfie run died on a hair level
  // citing a view that was never supplied. Both threw away a paid analysis.
  const supplied = ['early_photo'] as const

  function withConfidence(min: number, max: number) {
    const output = validOutput()
    output.profile.skinUndertone = { ...output.profile.skinUndertone, confidence: { min, max } }
    return output
  }

  it('widens a point value into the smallest range the database accepts', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const result = validate(withConfidence(0.7, 0.7), [...SUPPLIED])
      expect(result.analysis.profile.skinUndertone.confidence).toEqual({ min: 0.7, max: 0.75 })
      const atOne = validate(withConfidence(1, 1), [...SUPPLIED])
      expect(atOne.analysis.profile.skinUndertone.confidence).toEqual({ min: 0.95, max: 1 })
      expect(warn).toHaveBeenCalledWith('consult analysis confidence repaired', expect.objectContaining({ received: { min: 0.7, max: 0.7 } }))
    } finally {
      warn.mockRestore()
    }
  })

  it('swaps a reversed pair and still refuses anything outside [0, 1]', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const result = validate(withConfidence(0.8, 0.4), [...SUPPLIED])
      expect(result.analysis.profile.skinUndertone.confidence).toEqual({ min: 0.4, max: 0.8 })
      expect(() => validate(withConfidence(-0.1, 0.4), [...SUPPLIED])).toThrowError(ConsultAnalysisProviderError)
      expect(() => validate(withConfidence(0.4, 1.2), [...SUPPLIED])).toThrowError(ConsultAnalysisProviderError)
    } finally {
      warn.mockRestore()
    }
  })

  it('reads a hair level that cites an unsupplied view as UNKNOWN, and keeps refusing every other unsupplied citation', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const output = validOutput()
      // Everything else cites only what was supplied.
      for (const field of Object.keys(output.profile) as Array<keyof typeof output.profile>) {
        output.profile[field] = { ...output.profile[field], value: 'UNKNOWN', evidence: [], confidence: { min: 0, max: 0.3 } }
      }
      for (const field of Object.keys(output.core) as Array<keyof typeof output.core>) {
        output.core[field] = { ...output.core[field], value: 'UNKNOWN', evidence: [], confidence: { min: 0, max: 0.3 } }
      }
      output.styleDirections = output.styleDirections.map((direction) => ({ ...direction, evidence: ['intake'] }))
      output.core.baseLevel = { value: 'LEVEL_6', confidence: { min: 0.4, max: 0.7 }, evidence: ['hair_back'] }
      const result = validate(output, [...supplied])
      expect(result.analysis.core.baseLevel).toEqual({ value: 'UNKNOWN', confidence: { min: 0, max: 0.3 }, evidence: [] })
      expect(warn).toHaveBeenCalledWith(
        'consult analysis hair level cited an unsupplied view; read as UNKNOWN',
        expect.objectContaining({ fields: ['baseLevel'] }),
      )
      // A profile field citing an unsupplied view is a grammar the model was
      // never offered — that stays a refusal.
      const bad = validOutput()
      bad.profile.skinUndertone = { ...bad.profile.skinUndertone, evidence: ['face_front'] }
      expect(() => validate(bad, [...supplied])).toThrowError(ConsultAnalysisProviderError)
    } finally {
      warn.mockRestore()
    }
  })

  it('is exported for the run loader and returns what it changed', () => {
    const output = validate(validOutput(), [...SUPPLIED]).analysis
    expect(repairUnsuppliedHairLevelEvidence(output, new Set(SUPPLIED))).toEqual([])
  })
})
