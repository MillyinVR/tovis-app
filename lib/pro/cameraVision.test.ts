// lib/pro/cameraVision.test.ts

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
  CRITIQUE_PHOTO_MAX_BASE64_CHARS,
  CameraVisionError,
  LOOK_IMAGE_MAX_BASE64_CHARS,
  critiqueSessionSet,
  enhanceReferenceLook,
  parseCameraVisionImage,
  resetCameraVisionClientForTests,
  type SetCritiquePhotoInput,
} from './cameraVision'

const IMAGE = { base64: 'aGVsbG8=', mediaType: 'image/jpeg' as const }

function textMessage(payload: unknown, stopReason = 'end_turn') {
  return {
    stop_reason: stopReason,
    content: [{ type: 'text', text: JSON.stringify(payload) }],
  }
}

function critiquePhotos(count: number): SetCritiquePhotoInput[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `asset-${i + 1}`,
    phase: i === 0 ? ('BEFORE' as const) : ('AFTER' as const),
    image: IMAGE,
  }))
}

beforeEach(() => {
  process.env.ANTHROPIC_API_KEY = 'test-key'
  delete process.env.CAMERA_VISION_MODEL
  resetCameraVisionClientForTests()
  mocks.create.mockReset()
})

afterEach(() => {
  delete process.env.ANTHROPIC_API_KEY
  delete process.env.CAMERA_VISION_MODEL
})

describe('parseCameraVisionImage', () => {
  it('accepts a valid jpeg payload', () => {
    const parsed = parseCameraVisionImage(
      { base64: 'aGVsbG8=', mediaType: 'image/jpeg' },
      LOOK_IMAGE_MAX_BASE64_CHARS,
    )
    expect(parsed).toEqual({ ok: true, image: IMAGE })
  })

  it.each([
    ['missing record', null, 'Missing image.'],
    [
      'bad media type',
      { base64: 'aGVsbG8=', mediaType: 'image/heic' },
      'Unsupported image mediaType.',
    ],
    [
      'empty data',
      { base64: '   ', mediaType: 'image/jpeg' },
      'Missing image data.',
    ],
    [
      'non-base64 data',
      { base64: 'not base64!!', mediaType: 'image/png' },
      'Image data is not valid base64.',
    ],
  ])('rejects %s', (_label, value, error) => {
    expect(parseCameraVisionImage(value, LOOK_IMAGE_MAX_BASE64_CHARS)).toEqual({
      ok: false,
      error,
    })
  })

  it('rejects oversize data', () => {
    const parsed = parseCameraVisionImage(
      { base64: 'aaaa'.repeat(10), mediaType: 'image/jpeg' },
      16,
    )
    expect(parsed).toEqual({ ok: false, error: 'Image is too large.' })
  })
})

describe('enhanceReferenceLook', () => {
  it('sends the image + vocabulary and sanitizes the brief', async () => {
    mocks.create.mockResolvedValue(
      textMessage({
        summary: '  Golden-hour glam,   soft and confident ',
        poseRules: [
          {
            kind: 'handNearFace',
            params: { maxFaceHeights: 1.2, minDegrees: Infinity },
            tip: ' Bring their hand up to graze the jaw ',
          },
          { kind: 'someFutureRuleKind', tip: 'Unknown kind is dropped' },
          { kind: 'shouldersTilted', tip: '   ' },
        ],
        directionLines: [
          ' Chin down a touch, eyes up to the lens ',
          '',
          'Turn their face toward the window light',
        ],
      }),
    )

    const brief = await enhanceReferenceLook({
      image: IMAGE,
      serviceName: 'Balayage',
      measuredSummary: 'shoulders tilted 8 degrees; fill 0.42',
    })

    expect(brief).toEqual({
      summary: 'Golden-hour glam, soft and confident',
      poseRules: [
        {
          kind: 'handNearFace',
          params: { maxFaceHeights: 1.2 },
          tip: 'Bring their hand up to graze the jaw',
        },
      ],
      directionLines: [
        'Chin down a touch, eyes up to the lens',
        'Turn their face toward the window light',
      ],
    })

    expect(mocks.create).toHaveBeenCalledTimes(1)
    const [params, options] = mocks.create.mock.calls[0] ?? []
    expect(params.model).toBe('claude-opus-4-8')
    expect(params.output_config.format.type).toBe('json_schema')
    expect(params.messages).toHaveLength(1)
    const content = params.messages[0].content
    expect(content[0]).toEqual({
      type: 'image',
      source: {
        type: 'base64',
        media_type: 'image/jpeg',
        data: IMAGE.base64,
      },
    })
    expect(content[1].text).toContain('Balayage')
    expect(content[1].text).toContain('shoulders tilted 8 degrees')
    expect(content[1].text).toContain('faceNearShoulder')
    expect(options).toMatchObject({ timeout: expect.any(Number) })
  })

  it('honors the CAMERA_VISION_MODEL override', async () => {
    process.env.CAMERA_VISION_MODEL = 'claude-sonnet-5'
    mocks.create.mockResolvedValue(
      textMessage({
        summary: 'x',
        poseRules: [],
        directionLines: ['Keep it soft'],
      }),
    )

    await enhanceReferenceLook({ image: IMAGE })

    const [params] = mocks.create.mock.calls[0] ?? []
    expect(params.model).toBe('claude-sonnet-5')
  })

  it('maps an API failure to an unavailable error', async () => {
    mocks.create.mockRejectedValue(new Error('overloaded'))

    await expect(enhanceReferenceLook({ image: IMAGE })).rejects.toMatchObject({
      name: 'CameraVisionError',
      kind: 'unavailable',
    })
  })

  it('maps a refusal stop reason to a refused error', async () => {
    mocks.create.mockResolvedValue(textMessage({}, 'refusal'))

    await expect(enhanceReferenceLook({ image: IMAGE })).rejects.toMatchObject({
      name: 'CameraVisionError',
      kind: 'refused',
    })
  })

  it('rejects non-JSON output', async () => {
    mocks.create.mockResolvedValue({
      stop_reason: 'end_turn',
      content: [{ type: 'text', text: 'not json' }],
    })

    await expect(enhanceReferenceLook({ image: IMAGE })).rejects.toMatchObject({
      kind: 'bad_output',
    })
  })

  it('rejects a brief with no usable direction lines', async () => {
    mocks.create.mockResolvedValue(
      textMessage({ summary: 'x', poseRules: [], directionLines: ['  ', ''] }),
    )

    await expect(enhanceReferenceLook({ image: IMAGE })).rejects.toMatchObject({
      kind: 'bad_output',
    })
  })

  it('throws when the API key is missing', async () => {
    delete process.env.ANTHROPIC_API_KEY

    await expect(enhanceReferenceLook({ image: IMAGE })).rejects.toThrow(
      /ANTHROPIC_API_KEY/,
    )
    expect(mocks.create).not.toHaveBeenCalled()
  })
})

describe('critiqueSessionSet', () => {
  it('interleaves labeled photos and maps notes back to ids in input order', async () => {
    mocks.create.mockResolvedValue(
      textMessage({
        overall: 'Publish the glance; retake the macro.',
        strengths: ['Light is even', ''],
        photos: [
          // Out of order + a duplicate + out-of-range + bad verdict:
          { index: 2, verdict: 'portfolio', note: 'Hero shot', retakeTip: '' },
          { index: 2, verdict: 'retake', note: 'dupe ignored', retakeTip: '' },
          {
            index: 3,
            verdict: 'retake',
            note: 'Soft focus on the ends',
            retakeTip: ' Step closer and tap to focus on the ends ',
          },
          { index: 9, verdict: 'keep', note: 'out of range', retakeTip: '' },
          { index: 1, verdict: 'meh', note: 'bad verdict', retakeTip: '' },
        ],
      }),
    )

    const critique = await critiqueSessionSet({
      photos: critiquePhotos(3),
      serviceName: 'Balayage',
    })

    expect(critique).toEqual({
      overall: 'Publish the glance; retake the macro.',
      strengths: ['Light is even'],
      photos: [
        {
          id: 'asset-2',
          verdict: 'portfolio',
          note: 'Hero shot',
          retakeTip: null,
        },
        {
          id: 'asset-3',
          verdict: 'retake',
          note: 'Soft focus on the ends',
          retakeTip: 'Step closer and tap to focus on the ends',
        },
      ],
    })

    const [params] = mocks.create.mock.calls[0] ?? []
    const content = params.messages[0].content
    // Label, image, label, image, label, image, instructions.
    expect(content).toHaveLength(7)
    expect(content[0]).toEqual({ type: 'text', text: 'Photo 1 — BEFORE' })
    expect(content[2]).toEqual({ type: 'text', text: 'Photo 2 — AFTER' })
    expect(content[6].text).toContain('Balayage')
  })

  it('drops a retakeTip on non-retake verdicts', async () => {
    mocks.create.mockResolvedValue(
      textMessage({
        overall: 'Solid set.',
        strengths: [],
        photos: [
          {
            index: 1,
            verdict: 'keep',
            note: 'Fine',
            retakeTip: 'should be ignored',
          },
        ],
      }),
    )

    const critique = await critiqueSessionSet({ photos: critiquePhotos(1) })

    expect(critique.photos[0]?.retakeTip).toBeNull()
  })

  it('rejects a critique with no usable photo notes', async () => {
    mocks.create.mockResolvedValue(
      textMessage({ overall: 'x', strengths: [], photos: [] }),
    )

    await expect(
      critiqueSessionSet({ photos: critiquePhotos(2) }),
    ).rejects.toMatchObject({ kind: 'bad_output' })
  })
})

describe('CameraVisionError', () => {
  it('is an Error with a kind', () => {
    const error = new CameraVisionError('refused', 'nope')
    expect(error).toBeInstanceOf(Error)
    expect(error.kind).toBe('refused')
    expect(error.name).toBe('CameraVisionError')
  })
})

describe('limits', () => {
  it('stays under the 4.5 MB Vercel request-body cap', () => {
    expect(LOOK_IMAGE_MAX_BASE64_CHARS).toBeLessThan(4_500_000)
    expect(CRITIQUE_PHOTO_MAX_BASE64_CHARS).toBeLessThan(4_500_000)
  })
})
