import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ create: vi.fn() }))
vi.mock('@anthropic-ai/sdk', () => ({
  default: class {
    messages = { create: mocks.create }
  },
}))

import {
  CONSULT_INSPIRATION_ANALYSIS_FIELDS,
  CONSULT_INSPIRATION_ANALYSIS_OUTPUT_SCHEMA,
  CONSULT_INSPIRATION_ANALYSIS_PROMPT_VERSION,
  CONSULT_INSPIRATION_ANALYSIS_SCHEMA_VERSION,
  ConsultInspirationVisionError,
  countKnownConsultInspirationAttributes,
  resetConsultInspirationVisionClientForTests,
  runConsultInspirationVision,
  sanitizeConsultInspirationAnalysis,
} from './inspirationVision'
import { findUnsupportedProviderSchemaKeywords } from './providerSchema'

const IMAGE = { base64: 'aGVsbG8=', mediaType: 'image/jpeg' } as const

function known(value: string, region = '0.1,0.2,0.5,0.6') {
  return {
    value,
    confidence: { min: 0.4, max: 0.6 },
    evidence: ['inspiration'],
    region,
  }
}

const UNKNOWN = {
  value: 'UNKNOWN',
  confidence: { min: 0.05, max: 0.3 },
  evidence: [],
  region: null,
}

function output(overrides: Record<string, unknown> = {}) {
  return {
    baseLevel: known('LEVEL_5'),
    lightestLevel: known('LEVEL_8'),
    tone: known('COOL'),
    technique: known('BALAYAGE'),
    placement: known('MIDS_TO_ENDS'),
    rootBlend: known('SHADOW_ROOT'),
    finish: known('HIGH_SHINE'),
    dimension: known('MEDIUM'),
    ...overrides,
  }
}

function message(payload: unknown, stopReason: string | null = 'end_turn') {
  return {
    stop_reason: stopReason,
    content: [{ type: 'text', text: JSON.stringify(payload) }],
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  resetConsultInspirationVisionClientForTests()
  process.env.ANTHROPIC_API_KEY = 'test-key'
  delete process.env.AI_CONSULT_INSPIRATION_MODEL
})

describe('inspiration vision schema', () => {
  it('sends the provider a schema with no keyword the API rejects', () => {
    // The schema constant keeps its bounds as a statement of intent; what
    // actually goes on the wire must be free of them, or the call 400s before
    // a single photo is read. See lib/consult/providerSchema.ts.
    mocks.create.mockResolvedValue(message(output()))
    return runConsultInspirationVision({ image: IMAGE }).then(() => {
      const [params] = mocks.create.mock.calls[0] ?? []
      const sent = params.output_config.format.schema
      expect(findUnsupportedProviderSchemaKeywords(sent)).toEqual([])
      expect(
        findUnsupportedProviderSchemaKeywords(
          CONSULT_INSPIRATION_ANALYSIS_OUTPUT_SCHEMA,
        ).length,
      ).toBeGreaterThan(0)
    })
  })

  it('pins the versions the stored artefact is written under', () => {
    expect(CONSULT_INSPIRATION_ANALYSIS_SCHEMA_VERSION).toBe(2)
    expect(CONSULT_INSPIRATION_ANALYSIS_PROMPT_VERSION).toBe(
      'inspiration-hair-color-v2',
    )
    expect([...CONSULT_INSPIRATION_ANALYSIS_FIELDS]).toEqual([
      'baseLevel',
      'lightestLevel',
      'tone',
      'technique',
      'placement',
      'rootBlend',
      'finish',
      'dimension',
    ])
  })
})

describe('sanitizeConsultInspirationAnalysis', () => {
  it('parses the wire region string into a stored box', () => {
    const analysis = sanitizeConsultInspirationAnalysis(
      output({ lightestLevel: known('LEVEL_9', '0.25,0.05,0.5,0.2') }),
    )
    expect(analysis.lightestLevel.region).toEqual({
      x: 0.25,
      y: 0.05,
      w: 0.5,
      h: 0.2,
    })
    expect(analysis.tone.value).toBe('COOL')
  })

  it('refuses a base level lighter than the lightest, and accepts them equal', () => {
    // A grown-out balayage differs; a solid single-process does not. Only the
    // impossible ordering fails — see lib/consult/hairLevel.ts.
    expect(() =>
      sanitizeConsultInspirationAnalysis(
        output({ baseLevel: known('LEVEL_9'), lightestLevel: known('LEVEL_5') }),
      ),
    ).toThrowError(ConsultInspirationVisionError)
    expect(
      sanitizeConsultInspirationAnalysis(
        output({ baseLevel: known('LEVEL_6'), lightestLevel: known('LEVEL_6') }),
      ).baseLevel.value,
    ).toBe('LEVEL_6')
    // An UNKNOWN end is unobserved, not out of order.
    expect(
      sanitizeConsultInspirationAnalysis(
        output({ baseLevel: UNKNOWN }),
      ).baseLevel.value,
    ).toBe('UNKNOWN')
  })

  it('clamps a box that rounding pushed past the edge, and refuses one that is really out', () => {
    expect(
      sanitizeConsultInspirationAnalysis(output({ finish: known('SATIN', '0.9,0.9,0.1,0.1') }))
        .finish.region,
    ).toEqual({ x: 0.9, y: 0.9, w: 0.1, h: 0.1 })
    // 0.9 + 0.5 is not a rounding artefact; it is a box that does not fit.
    expect(() =>
      sanitizeConsultInspirationAnalysis(output({ finish: known('SATIN', '0.9,0.2,0.5,0.1') })),
    ).toThrowError(ConsultInspirationVisionError)
  })

  it('refuses an UNKNOWN that cites evidence, claims confidence, or points at a region', () => {
    for (const contradiction of [
      { ...UNKNOWN, evidence: ['inspiration'] },
      { ...UNKNOWN, confidence: { min: 0.4, max: 0.9 } },
      { ...UNKNOWN, region: '0.1,0.1,0.2,0.2' },
    ]) {
      expect(() =>
        sanitizeConsultInspirationAnalysis(output({ rootBlend: contradiction })),
      ).toThrowError(ConsultInspirationVisionError)
    }
  })

  it('refuses a reading that cites nothing or points nowhere', () => {
    expect(() =>
      sanitizeConsultInspirationAnalysis(
        output({ tone: { ...known('WARM'), evidence: [] } }),
      ),
    ).toThrowError(ConsultInspirationVisionError)
    expect(() =>
      sanitizeConsultInspirationAnalysis(
        output({ tone: { ...known('WARM'), region: null } }),
      ),
    ).toThrowError(ConsultInspirationVisionError)
  })

  it('treats an all-UNKNOWN read as an unreadable photo, not a low-confidence answer', () => {
    // Part 0 rule 4: no empty-attribute success. This is the assertion that
    // keeps a blank result from becoming a silent, useless "analysis".
    const allUnknown = Object.fromEntries(
      CONSULT_INSPIRATION_ANALYSIS_FIELDS.map((field) => [field, UNKNOWN]),
    )
    let thrown: unknown
    try {
      sanitizeConsultInspirationAnalysis(allUnknown)
    } catch (error) {
      thrown = error
    }
    expect(thrown).toBeInstanceOf(ConsultInspirationVisionError)
    expect((thrown as ConsultInspirationVisionError).kind).toBe('unreadable')
  })

  it('accepts a partial read and counts what the photograph answered', () => {
    const analysis = sanitizeConsultInspirationAnalysis(
      output({ rootBlend: UNKNOWN, finish: UNKNOWN, dimension: UNKNOWN }),
    )
    expect(countKnownConsultInspirationAttributes(analysis)).toBe(5)
    expect(analysis.rootBlend.region).toBeNull()
  })

  it('refuses an unknown attribute, a missing one, and a value outside its enum', () => {
    expect(() =>
      sanitizeConsultInspirationAnalysis({ ...output(), porosity: known('HIGH') }),
    ).toThrowError(ConsultInspirationVisionError)
    const missing = { ...output() }
    delete (missing as Partial<typeof missing>).dimension
    expect(() => sanitizeConsultInspirationAnalysis(missing)).toThrowError(
      ConsultInspirationVisionError,
    )
    expect(() =>
      sanitizeConsultInspirationAnalysis(output({ tone: known('MAUVE') })),
    ).toThrowError(ConsultInspirationVisionError)
  })
})

describe('runConsultInspirationVision', () => {
  it('fails closed before sending the photo when the model override is not allowlisted', async () => {
    process.env.AI_CONSULT_INSPIRATION_MODEL = 'claude-sonnet-5-typo'
    await expect(
      runConsultInspirationVision({ image: IMAGE }),
    ).rejects.toBeInstanceOf(ConsultInspirationVisionError)
    expect(mocks.create).not.toHaveBeenCalled()
  })

  it('sends exactly one image and returns the sanitized read', async () => {
    mocks.create.mockResolvedValue(message(output()))
    const result = await runConsultInspirationVision({ image: IMAGE })
    expect(result.model).toBe('claude-sonnet-5')
    expect(result.analysis.technique.value).toBe('BALAYAGE')
    const [params] = mocks.create.mock.calls[0] ?? []
    const images = params.messages[0].content.filter(
      (item: { type: string }) => item.type === 'image',
    )
    expect(images).toHaveLength(1)
    expect(images[0].source.data).toBe(IMAGE.base64)
  })

  it('never lets the prompt invite a description of the person', async () => {
    mocks.create.mockResolvedValue(message(output()))
    await runConsultInspirationVision({ image: IMAGE })
    const [params] = mocks.create.mock.calls[0] ?? []
    expect(params.system).toContain('Never describe, infer, or mention anything about the person')
    expect(params.system).toContain('read their hair and nothing else')
  })

  it('returns typed content-free failures for provider errors, refusals and junk', async () => {
    mocks.create.mockRejectedValueOnce(new Error('provider request secret'))
    await expect(runConsultInspirationVision({ image: IMAGE })).rejects.toMatchObject({
      kind: 'unavailable',
      message: 'Inspiration analysis is unavailable.',
    })

    mocks.create.mockResolvedValueOnce(message({}, 'refusal'))
    await expect(runConsultInspirationVision({ image: IMAGE })).rejects.toMatchObject({
      kind: 'refused',
    })

    mocks.create.mockResolvedValueOnce({
      stop_reason: 'end_turn',
      content: [{ type: 'text', text: 'not json' }],
    })
    await expect(runConsultInspirationVision({ image: IMAGE })).rejects.toMatchObject({
      kind: 'bad_output',
    })
  })
})
