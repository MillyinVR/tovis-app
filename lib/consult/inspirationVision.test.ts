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
  CONSULT_INSPIRATION_ANALYSIS_READABLE_VERSIONS,
  CONSULT_INSPIRATION_ANALYSIS_SCHEMA_VERSION,
  CONSULT_INSPIRATION_ANALYSIS_SYSTEM_PROMPT,
  CONSULT_INSPIRATION_CREDIBILITY_FLAGS,
  ConsultInspirationVisionError,
  countKnownConsultInspirationAttributes,
  resetConsultInspirationVisionClientForTests,
  runConsultInspirationVision,
  sanitizeConsultInspirationAnalysis,
  sanitizeConsultInspirationCredibilityFlags,
  sanitizeConsultInspirationRead,
  sanitizeLocalizedInspirationAnalysis,
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
    mocks.create.mockResolvedValue(message({ hairRegion: '0,0,1,1', ...output() }))
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
    // 🔴 These two numbers are ALSO written into
    // `consult_inspiration_analysis_payload_guard`. Moving one without the
    // other raises 23514 on insert, after the paid call has been billed — so
    // this assertion is the reminder, and the integration test that actually
    // writes an artefact through the live guard is the proof.
    expect(CONSULT_INSPIRATION_ANALYSIS_SCHEMA_VERSION).toBe(4)
    expect(CONSULT_INSPIRATION_ANALYSIS_PROMPT_VERSION).toBe(
      'inspiration-hair-color-v4',
    )
    // C2-6b: the previous pair stays READABLE, so a v3 row is not blanked in
    // the migrate-before-deploy window. Newest first.
    expect(CONSULT_INSPIRATION_ANALYSIS_READABLE_VERSIONS).toEqual([
      { schemaVersion: 4, promptVersion: 'inspiration-hair-color-v4' },
      { schemaVersion: 3, promptVersion: 'inspiration-hair-color-v3' },
    ])
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

  it('trims a box that runs off the frame back to the edge, and names each refusal', () => {
    // The prod shape (2026-09-13): hair running to the bottom of the frame,
    // drawn as y 0.22 + h 0.85 = 1.07. Everything below y = 1 is off-canvas,
    // so trimming h to 0.78 keeps the box on exactly the pixels it read.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      expect(
        sanitizeConsultInspirationAnalysis(output({ finish: known('SATIN', '0.24,0.22,0.6,0.85') }))
          .finish.region,
      ).toEqual({ x: 0.24, y: 0.22, w: 0.6, h: 0.78 })
      expect(warn).toHaveBeenCalledTimes(1)
      expect(JSON.stringify(warn.mock.calls[0])).toContain('trimmed to the frame')
    } finally {
      warn.mockRestore()
    }
    // Losing more than half the side means the box was never aimed there.
    expect(() =>
      sanitizeConsultInspirationAnalysis(output({ finish: known('SATIN', '0.9,0.2,0.5,0.1') })),
    ).toThrowError(expect.objectContaining({ kind: 'bad_output', stage: 'region_bounds' }))
    expect(() =>
      sanitizeConsultInspirationAnalysis(output({ finish: known('SATIN', '0.1,0.2,0.003,0.1') })),
    ).toThrowError(expect.objectContaining({ kind: 'bad_output', stage: 'region_too_small' }))
    expect(() =>
      sanitizeConsultInspirationAnalysis(output({ finish: known('SATIN', '0.1,0.2,0.5') })),
    ).toThrowError(expect.objectContaining({ kind: 'bad_output', stage: 'region_format' }))
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

// C2-6b — the credibility flags: a NOTE about the photograph, never a refusal.
describe('sanitizeConsultInspirationCredibilityFlags', () => {
  it('the schema asks for the flags as an enum array the grammar can hold, and requires the field', () => {
    const properties = CONSULT_INSPIRATION_ANALYSIS_OUTPUT_SCHEMA.properties as Record<string, unknown>
    expect(properties.credibilityFlags).toMatchObject({
      type: 'array',
      items: { type: 'string', enum: [...CONSULT_INSPIRATION_CREDIBILITY_FLAGS] },
    })
    expect(CONSULT_INSPIRATION_ANALYSIS_OUTPUT_SCHEMA.required).toContain('credibilityFlags')
    expect(CONSULT_INSPIRATION_CREDIBILITY_FLAGS).toEqual([
      'LIKELY_EDITED',
      'LIKELY_AI_GENERATED',
      'EXTENSIONS_LIKELY',
      'PRO_LIGHTING',
      'FINISH_HIDES_CUT',
      'SINGLE_ANGLE',
    ])
    // The prompt defines every value it asks for, and says a flag is a note.
    for (const flag of CONSULT_INSPIRATION_CREDIBILITY_FLAGS) {
      expect(CONSULT_INSPIRATION_ANALYSIS_SYSTEM_PROMPT).toContain(`${flag} —`)
    }
    expect(CONSULT_INSPIRATION_ANALYSIS_SYSTEM_PROMPT).toContain('A flag is a note, not a refusal.')
    expect(CONSULT_INSPIRATION_ANALYSIS_SYSTEM_PROMPT).toContain(
      'A credibility flag on its own is never a reason for UNKNOWN',
    )
  })

  it('drops an unknown value, so it is never stored', () => {
    expect(
      sanitizeConsultInspirationCredibilityFlags(['LIKELY_EDITED', 'WIND_MACHINE', 'SINGLE_ANGLE']),
    ).toEqual(['LIKELY_EDITED', 'SINGLE_ANGLE'])
    // A wrong type inside the array is an unknown value too, not a crash.
    expect(sanitizeConsultInspirationCredibilityFlags([42, null, 'PRO_LIGHTING'])).toEqual([
      'PRO_LIGHTING',
    ])
  })

  it('dedupes a repeated value and returns the vocabulary order whatever order arrived', () => {
    expect(
      sanitizeConsultInspirationCredibilityFlags([
        'SINGLE_ANGLE',
        'LIKELY_EDITED',
        'SINGLE_ANGLE',
        'LIKELY_EDITED',
      ]),
    ).toEqual(['LIKELY_EDITED', 'SINGLE_ANGLE'])
  })

  it('reads an absent or null field as no flags, and refuses a non-array', () => {
    expect(sanitizeConsultInspirationCredibilityFlags(undefined)).toEqual([])
    expect(sanitizeConsultInspirationCredibilityFlags(null)).toEqual([])
    expect(sanitizeConsultInspirationCredibilityFlags([])).toEqual([])
    expect(() => sanitizeConsultInspirationCredibilityFlags('LIKELY_EDITED')).toThrowError(
      ConsultInspirationVisionError,
    )
  })

  it('a flagged read still answers the eight attributes — flag, never reject', () => {
    const read = sanitizeConsultInspirationRead({
      hairRegion: '0,0,1,1',
      credibilityFlags: ['LIKELY_AI_GENERATED', 'PRO_LIGHTING'],
      ...output(),
    })
    expect(read.credibilityFlags).toEqual(['LIKELY_AI_GENERATED', 'PRO_LIGHTING'])
    expect(countKnownConsultInspirationAttributes(read.analysis)).toBe(8)
    // The attribute sanitizer does not see the envelope field as a ninth attribute.
    expect(Object.keys(read.analysis).sort()).toEqual([...CONSULT_INSPIRATION_ANALYSIS_FIELDS].sort())
    // And a v3-shaped answer with no field at all still reads, with no flags.
    expect(sanitizeConsultInspirationRead({ hairRegion: '0,0,1,1', ...output() }).credibilityFlags).toEqual([])
  })
})

describe('runConsultInspirationVision', () => {
  it('returns the sanitized flags beside the reading', async () => {
    mocks.create.mockResolvedValue(
      message({
        hairRegion: '0,0,1,1',
        credibilityFlags: ['SINGLE_ANGLE', 'NOT_A_FLAG', 'SINGLE_ANGLE'],
        ...output(),
      }),
    )
    const result = await runConsultInspirationVision({ image: IMAGE })
    expect(result.credibilityFlags).toEqual(['SINGLE_ANGLE'])
    expect(result.analysis.tone.value).toBe('COOL')
  })

  it('fails closed before sending the photo when the model override is not allowlisted', async () => {
    process.env.AI_CONSULT_INSPIRATION_MODEL = 'claude-sonnet-5-typo'
    await expect(
      runConsultInspirationVision({ image: IMAGE }),
    ).rejects.toBeInstanceOf(ConsultInspirationVisionError)
    expect(mocks.create).not.toHaveBeenCalled()
  })

  it('sends exactly one image and returns the sanitized read', async () => {
    mocks.create.mockResolvedValue(message({ hairRegion: '0,0,1,1', ...output() }))
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
    mocks.create.mockResolvedValue(message({ hairRegion: '0,0,1,1', ...output() }))
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


describe('localized inspiration crops', () => {
  it('rejects a garment crop below the identified hair in a mirror shot', () => {
    expect(() => sanitizeLocalizedInspirationAnalysis({ hairRegion: '0.05,0.05,0.8,0.85',
      ...output({ tone: known('WARM', '0.2,0.92,0.3,0.07') }),
    })).toThrowError(ConsultInspirationVisionError)
  })
  it('requires a located head of hair and never invents an area', () => {
    expect(() => sanitizeLocalizedInspirationAnalysis({ hairRegion: null, ...output() })).toThrowError(ConsultInspirationVisionError)
    expect(() => sanitizeLocalizedInspirationAnalysis(output())).toThrowError(ConsultInspirationVisionError)
  })
  it('keeps valid image coordinates without mirroring them a second time', () => {
    const result = sanitizeLocalizedInspirationAnalysis({ hairRegion: '0.05,0.05,0.8,0.85', ...output() })
    expect(result.tone.region).toEqual({ x: 0.1, y: 0.2, w: 0.5, h: 0.6 })
  })
})

describe('the containment rule clamps a slightly loose crop', () => {
  // The real v4 answer that took "Build my plan" down on Deploy E (2026-09-11):
  // the hair box spans x 0.28–0.72 and the lightest-level crop x 0.50–0.75.
  // Every other crop is inside. Replayed from the prod call, 5 refusals of 5.
  const LIVE = {
    hairRegion: '0.28,0.06,0.44,0.94',
    ...output({
      baseLevel: known('LEVEL_6', '0.42,0.06,0.15,0.1'),
      lightestLevel: known('LEVEL_9', '0.5,0.4,0.25,0.3'),
      tone: known('WARM', '0.4,0.3,0.3,0.3'),
      technique: known('BALAYAGE', '0.3,0.2,0.4,0.5'),
      placement: known('ALL_OVER', '0.3,0.2,0.4,0.5'),
      rootBlend: known('SHADOW_ROOT', '0.42,0.06,0.15,0.08'),
      finish: known('HIGH_SHINE', '0.4,0.4,0.3,0.3'),
      dimension: known('MEDIUM', '0.3,0.2,0.4,0.5'),
    }),
    credibilityFlags: ['SINGLE_ANGLE'],
  }

  it('accepts the prod answer and clamps the one crop that overruns the hair box', () => {
    const read = sanitizeConsultInspirationRead(LIVE)
    expect(read.analysis.lightestLevel.value).toBe('LEVEL_9')
    expect(read.analysis.lightestLevel.region).toEqual({ x: 0.5, y: 0.4, w: 0.22, h: 0.3 })
    expect(read.regionRepairs).toEqual([
      {
        field: 'lightestLevel',
        received: { x: 0.5, y: 0.4, w: 0.25, h: 0.3 },
        stored: { x: 0.5, y: 0.4, w: 0.22, h: 0.3 },
        hairRegion: { x: 0.28, y: 0.06, w: 0.44, h: 0.94 },
      },
    ])
    expect(read.analysis.tone.region).toEqual({ x: 0.4, y: 0.3, w: 0.3, h: 0.3 })
    expect(read.credibilityFlags).toEqual(['SINGLE_ANGLE'])
  })

  it('records no repair on a clean read', () => {
    expect(sanitizeConsultInspirationRead({ hairRegion: '0,0,1,1', ...output() }).regionRepairs).toEqual([])
  })

  it('clamps a crop that overruns on two sides at once', () => {
    const repairs: Parameters<typeof sanitizeLocalizedInspirationAnalysis>[1] = []
    const analysis = sanitizeLocalizedInspirationAnalysis(
      { hairRegion: '0.1,0.1,0.8,0.8', ...output({ tone: known('WARM', '0.05,0.05,0.4,0.4') }) },
      repairs,
    )
    expect(analysis.tone.region).toEqual({ x: 0.1, y: 0.1, w: 0.35, h: 0.35 })
    expect(repairs?.map((repair) => repair.field)).toEqual(['tone'])
  })

  it('still refuses a crop that is mostly outside the hair, and names the check', () => {
    // x 0.60–0.90 against hair x 0.28–0.72: 0.12 of 0.30 survives, under half.
    expect(() =>
      sanitizeLocalizedInspirationAnalysis({
        hairRegion: '0.28,0.06,0.44,0.94',
        ...output({ tone: known('WARM', '0.6,0.3,0.3,0.3') }),
      }),
    ).toThrowError(expect.objectContaining({ kind: 'bad_output', stage: 'region_containment' }))
  })

  it('names the check on an ordinary refusal too', () => {
    expect(() =>
      sanitizeConsultInspirationAnalysis(
        output({ tone: { ...known('WARM'), confidence: { min: 0.6, max: 0.6 } } }),
      ),
    ).toThrowError(expect.objectContaining({ kind: 'bad_output', stage: 'confidence' }))
  })

  it('the provider says a clamped crop out loud, geometry only', async () => {
    mocks.create.mockResolvedValue(message(LIVE))
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const result = await runConsultInspirationVision({ image: IMAGE })
      expect(result.analysis.lightestLevel.region).toEqual({ x: 0.5, y: 0.4, w: 0.22, h: 0.3 })
      expect(result.credibilityFlags).toEqual(['SINGLE_ANGLE'])
      expect(warn).toHaveBeenCalledTimes(1)
      const [, payload] = warn.mock.calls[0] as [string, { field: string }]
      expect(payload.field).toBe('lightestLevel')
      expect(JSON.stringify(warn.mock.calls[0])).not.toContain('LEVEL_9')
    } finally {
      warn.mockRestore()
    }
  })
})
