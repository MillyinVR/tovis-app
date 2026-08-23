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
  runHairColorAnalysis,
  validateHairColorAnalysisProviderResult,
  validateHairColorAnalysisResult,
  type HairColorAnalysisProviderOutput,
} from './analysisEngine'

const captures = [
  'hair_back',
  'hair_left',
  'hair_right',
  'hair_crown',
].map((shotKey) => ({
  shotKey: shotKey as 'hair_back' | 'hair_left' | 'hair_right' | 'hair_crown',
  image: { base64: 'aGVsbG8=', mediaType: 'image/jpeg' as const },
}))

function validOutput(): HairColorAnalysisProviderOutput {
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
    hairColorLens: {
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
        serviceIntent: 'COLOR_CONSULTATION',
        title: 'Hair color consultation',
        rationale: 'Review history and a realistic red direction together.',
        achievability: 'The professional should confirm the appointment plan.',
        discussWithProfessional: true,
      },
    ],
  }
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
      runHairColorAnalysis({
        intake: { desired_color: 'red', prior_reaction: 'no' },
        captures,
      }),
    ).rejects.toBeInstanceOf(ConsultAnalysisProviderError)
    // The assertion that matters: no image ever reached the provider.
    expect(mocks.create).not.toHaveBeenCalled()
  })

  it('pins exact schema/prompt/model versions and sends four labeled images as structured output', async () => {
    mocks.create.mockResolvedValue(message(validOutput()))
    const result = await runHairColorAnalysis({
      intake: { desired_color: 'red', prior_reaction: 'no' },
      captures,
    })
    expect(CONSULT_ANALYSIS_SCHEMA_VERSION).toBe(1)
    expect(CONSULT_ANALYSIS_PROMPT_VERSION).toBe('hair-color-analysis-v1')
    expect(result.model).toBe(CONSULT_ANALYSIS_DEFAULT_MODEL)

    const [params, options] = mocks.create.mock.calls[0] ?? []
    expect(params.model).toBe('claude-sonnet-5')
    expect(params.system).toBe(CONSULT_ANALYSIS_SYSTEM_PROMPT)
    expect(params.output_config).toEqual({
      format: { type: 'json_schema', schema: CONSULT_ANALYSIS_OUTPUT_SCHEMA },
    })
    expect(options.timeout).toBe(CONSULT_ANALYSIS_REQUEST_TIMEOUT_MS)
    expect(options.timeout).toBeLessThan(60_000)
    expect(params.messages[0].content.filter((item: { type: string }) => item.type === 'image')).toHaveLength(4)
    expect(JSON.stringify(params.messages[0].content)).toContain('hair_crown')
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
      validateHairColorAnalysisProviderResult({
        analysis: unknown,
        model: 'fake-model',
      }),
    ).toMatchObject({
      analysis: { core: { currentLevel: { min: null, max: null, evidence: [] } } },
    })

    const forbidden = validOutput()
    forbidden.hairColorLens.goal = 'A diagnosis of a scalp disorder.'
    expect(() =>
      validateHairColorAnalysisProviderResult({
        analysis: forbidden,
        model: 'fake-model',
      }),
    ).toThrowError(ConsultAnalysisProviderError)
  })

  it('rejects malformed ranges, unsupported evidence, extra fields, and provider provenance drift', () => {
    const badRange = validOutput()
    badRange.core.currentTone.confidence = { min: 0.9, max: 0.2 }
    expect(() =>
      validateHairColorAnalysisProviderResult({ analysis: badRange, model: 'fake' }),
    ).toThrowError(ConsultAnalysisProviderError)

    const unsupported = validOutput()
    unsupported.core.density = {
      value: 'HIGH',
      confidence: { min: 0.3, max: 0.6 },
      evidence: [],
    }
    expect(() =>
      validateHairColorAnalysisProviderResult({ analysis: unsupported, model: 'fake' }),
    ).toThrowError(ConsultAnalysisProviderError)

    const withExtra = { ...validOutput(), hiddenReasoning: 'secret' }
    expect(() =>
      validateHairColorAnalysisProviderResult({
        analysis: withExtra,
        model: ' fake ',
      }),
    ).toThrowError(ConsultAnalysisProviderError)
  })

  it('rejects duplicate or incomplete capture packs before provider work', async () => {
    const duplicatePack = captures.map(() => captures[0]!)
    await expect(
      runHairColorAnalysis({ intake: {}, captures: duplicatePack }),
    ).rejects.toThrowError(ConsultAnalysisProviderError)
    expect(mocks.create).not.toHaveBeenCalled()
  })

  it('returns typed content-free failures for provider errors and refusals', async () => {
    mocks.create.mockRejectedValueOnce(new Error('provider request secret'))
    await expect(
      runHairColorAnalysis({ intake: {}, captures }),
    ).rejects.toMatchObject({
      kind: 'unavailable',
      message: 'Consult analysis is unavailable.',
    } satisfies Partial<ConsultAnalysisProviderError>)

    mocks.create.mockResolvedValueOnce(message({}, 'refusal'))
    await expect(
      runHairColorAnalysis({ intake: {}, captures }),
    ).rejects.toMatchObject({ kind: 'refused' } satisfies Partial<ConsultAnalysisProviderError>)
  })

  it('allows deterministic test intents only after the provider boundary', () => {
    const routed = validOutput()
    routed.recommendations = [
      {
        serviceIntent: 'STRAND_TEST',
        title: 'Strand Test',
        rationale: 'Test a small section before selecting a chemical service.',
        achievability: 'The professional will review the result.',
        discussWithProfessional: true,
      },
    ]
    expect(() =>
      validateHairColorAnalysisProviderResult({
        analysis: routed,
        model: 'fake-model',
      }),
    ).toThrowError(ConsultAnalysisProviderError)
    expect(
      validateHairColorAnalysisResult({
        analysis: routed,
        model: 'fake-model',
      }).analysis.recommendations[0]?.serviceIntent,
    ).toBe('STRAND_TEST')
  })
})
