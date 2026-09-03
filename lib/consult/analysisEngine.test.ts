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
  CONSULT_ANALYSIS_OUTPUT_SCHEMA,
  CONSULT_ANALYSIS_PROMPT_VERSION,
  CONSULT_ANALYSIS_REQUEST_TIMEOUT_MS,
  CONSULT_ANALYSIS_SCHEMA_VERSION,
  CONSULT_ANALYSIS_SYSTEM_PROMPT,
  ConsultAnalysisProviderError,
  resetConsultAnalysisClientForTests,
  CONSULT_ANALYSIS_CONSULTATION_OPTION,
  buildConsultAnalysisOutputSchema,
  consultAnalysisContextBlocks,
  runConsultAnalysis,
  validateConsultAnalysisProviderResult,
  validateConsultAnalysisResult,
  type ConsultAnalysisInput,
  type ConsultAnalysisProviderOutput,
} from './analysisEngine'

const MENU = ['Balayage', 'Toner Gloss'] as const

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

const captures = [
  'hair_back',
  'hair_left',
  'hair_right',
  'hair_crown',
  'face_front',
  'face_side',
  'eyes_closeup',
].map((shotKey) => ({
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
      currentLevel: {
        min: 4,
        max: 5,
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

function validate(analysis: unknown, suppliedShotKeys?: readonly string[]) {
  return validateConsultAnalysisProviderResult(
    { analysis, model: 'fake-model' },
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
      }),
    ).rejects.toBeInstanceOf(ConsultAnalysisProviderError)
    // The assertion that matters: no image ever reached the provider.
    expect(mocks.create).not.toHaveBeenCalled()
  })

  it('pins exact schema/prompt/model versions and sends seven labeled images as structured output', async () => {
    mocks.create.mockResolvedValue(message(validOutput()))
    const result = await runConsultAnalysis({
      service,
      capturePack,
      intake: { desired_color: 'red', prior_reaction: 'no' },
      intakeItems,
      captures,
    })
    expect(CONSULT_ANALYSIS_SCHEMA_VERSION).toBe(3)
    expect(CONSULT_ANALYSIS_PROMPT_VERSION).toBe('service-analysis-v3')
    expect(result.model).toBe(CONSULT_ANALYSIS_DEFAULT_MODEL)

    const [params, options] = mocks.create.mock.calls[0] ?? []
    expect(params.model).toBe('claude-sonnet-5')
    expect(params.system).toBe(CONSULT_ANALYSIS_SYSTEM_PROMPT)
    // The schema is built PER RUN: the recommendation enum is this pro's menu
    // plus the fixed consultation option, so the model cannot invent a service.
    expect(params.output_config).toEqual({
      format: {
        type: 'json_schema',
        schema: buildConsultAnalysisOutputSchema({ menuServiceNames: [...MENU] }),
      },
    })
    expect(JSON.stringify(params.output_config)).toContain(
      JSON.stringify(['Balayage', 'Toner Gloss', CONSULT_ANALYSIS_CONSULTATION_OPTION]),
    )
    // No-menu default: only the consultation option is recommendable.
    expect(JSON.stringify(CONSULT_ANALYSIS_OUTPUT_SCHEMA)).toContain(
      JSON.stringify([CONSULT_ANALYSIS_CONSULTATION_OPTION]),
    )
    expect(result.analysis.recommendations[0]).toMatchObject({
      serviceIntent: 'SERVICE',
      serviceName: 'Balayage',
    })
    expect(options.timeout).toBe(CONSULT_ANALYSIS_REQUEST_TIMEOUT_MS)
    // The provider timeout must finish inside the route's maxDuration (150s).
    expect(options.timeout).toBeLessThan(150_000)
    expect(params.messages[0].content.filter((item: { type: string }) => item.type === 'image')).toHaveLength(7)
    expect(JSON.stringify(params.messages[0].content)).toContain('hair_crown')
    expect(JSON.stringify(params.messages[0].content)).toContain('eyes_closeup')
  })

  it('tells the provider what the consult is FOR: family, category, service, menu, and the intake as labels', async () => {
    mocks.create.mockResolvedValue(message(validOutput()))
    await runConsultAnalysis({
      service,
      capturePack,
      intake: { desired_color: 'red' },
      intakeItems,
      captures,
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
    const [bare] = consultAnalysisContextBlocks({
      service: { family: 'NAILS', categoryName: 'Nails', serviceName: null, menuServiceNames: [] },
      capturePack: { id: 'area-daylight', shotKeys: ['area_wide', 'area_closeup', 'face_front'] },
      intake: {},
      intakeItems: [],
    })
    expect(bare).toContain('not named yet')
    expect(bare).toContain('none listed')
  })

  it('keeps unsupported traits unknown and rejects unsupported or medical language', () => {
    const unknown = validOutput()
    unknown.core.currentLevel = {
      min: null,
      max: null,
      confidence: { min: 0, max: 0.2 },
      evidence: [],
    }
    expect(
      validate(unknown),
    ).toMatchObject({
      analysis: { core: { currentLevel: { min: null, max: null, evidence: [] } } },
    })

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
      runConsultAnalysis({ service, capturePack, intake: {}, intakeItems: [], captures: duplicatePack }),
    ).rejects.toThrowError(ConsultAnalysisProviderError)
    await expect(
      runConsultAnalysis({ service, capturePack, intake: {}, intakeItems: [], captures: [] }),
    ).rejects.toThrowError(ConsultAnalysisProviderError)
    expect(mocks.create).not.toHaveBeenCalled()
  })

  it('accepts a partial pack and names the missing views to the provider', async () => {
    mocks.create.mockResolvedValue(message(validOutput()))
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
    mocks.create.mockResolvedValue(message(validOutput()))
    await runConsultAnalysis({ service, capturePack, intake: {}, intakeItems: [], captures })
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
      runConsultAnalysis({ service, capturePack, intake: {}, intakeItems: [], captures }),
    ).rejects.toMatchObject({
      kind: 'unavailable',
      message: 'Consult analysis is unavailable.',
    } satisfies Partial<ConsultAnalysisProviderError>)

    mocks.create.mockResolvedValueOnce(message({}, 'refusal'))
    await expect(
      runConsultAnalysis({ service, capturePack, intake: {}, intakeItems: [], captures }),
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
