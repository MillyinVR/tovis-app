import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

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
  CONSULT_ANALYSIS_SCHEMA_VERSION,
  CONSULT_STYLE_DOMAINS,
  ConsultAnalysisProviderError,
  resetConsultAnalysisClientForTests,
  CONSULT_ANALYSIS_CONSULTATION_OPTION,
  buildConsultDirectionOutputSchema,
  buildConsultProfileOutputSchema,
  consultAnalysisSafetyCodeOptions,
  consultAnalysisContextBlocks,
  consultInspirationBlock,
  consultProfileBlock,
  runConsultAnalysis,
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
  delete process.env.AI_CONSULT_ANALYSIS_MODEL
  resetConsultAnalysisClientForTests()
  mocks.create.mockReset()
})

afterEach(() => {
  delete process.env.ANTHROPIC_API_KEY
  delete process.env.AI_CONSULT_ANALYSIS_MODEL
})

describe('hair-color consult analysis provider', () => {
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
    expect(CONSULT_ANALYSIS_SCHEMA_VERSION).toBe(4)
    expect(CONSULT_ANALYSIS_PROMPT_VERSION).toBe('service-analysis-v5')
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
    // ONE request makes the inspiration read and then BOTH of these calls, so
    // the worst case is 50s + 2 x this. If someone raises this constant, the
    // route's ceiling has to move with it — otherwise the failure is a gateway
    // timeout AFTER the client has been billed for every one of those calls.
    expect(
      CONSULT_INSPIRATION_REQUEST_TIMEOUT_MS +
        CONSULT_ANALYSIS_PROFILE_TIMEOUT_MS +
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
    expect(serialized).toContain('Service the client is considering: Balayage')
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
    const badRange = validOutput()
    badRange.core.currentTone.confidence = { min: 0.9, max: 0.2 }
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
  })

  it('says the client brought nothing rather than leaving the model to assume', () => {
    const block = consultInspirationBlock({ source: 'NONE', analysis: null, answers: [] })
    expect(block).toContain('brought no reference photograph')
    expect(block).toContain('do not invent a reference')
  })

  it('is one of the context blocks the provider is actually sent', () => {
    const blocks = consultAnalysisContextBlocks({
      service,
      capturePack,
      intake: {},
      intakeItems: [],
      inspiration: { source: 'PLATFORM_LOOK', analysis, answers: [] },
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
        'Evidence label: hair_back (colour warning: WARM_INDOOR_LIGHT',
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
