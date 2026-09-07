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
  checkConsultCapture,
  consultCaptureQualityPromptVersion,
  ConsultCaptureVisionError,
  isAnalyzableConsultCapturePromptVersion,
  resetConsultCaptureVisionClientForTests,
} from './captureVision'

const IMAGE = { base64: 'aGVsbG8=', mediaType: 'image/jpeg' as const }

function message(payload: unknown, stopReason = 'end_turn') {
  return {
    stop_reason: stopReason,
    content: [{ type: 'text', text: JSON.stringify(payload) }],
  }
}

beforeEach(() => {
  process.env.ANTHROPIC_API_KEY = 'test-key'
  delete process.env.AI_CONSULT_CAPTURE_MODEL
  resetConsultCaptureVisionClientForTests()
  mocks.create.mockReset()
})

afterEach(() => {
  delete process.env.ANTHROPIC_API_KEY
  delete process.env.AI_CONSULT_CAPTURE_MODEL
})

describe('checkConsultCapture', () => {
  it('fails closed before sending the photo when the model override is not allowlisted', async () => {
    process.env.AI_CONSULT_CAPTURE_MODEL = 'claude-sonnet-5-typo'

    await expect(
      checkConsultCapture({ shotKey: 'hair_back', image: IMAGE }),
    ).rejects.toBeInstanceOf(ConsultCaptureVisionError)
    // The assertion that matters: the image never reached the provider.
    expect(mocks.create).not.toHaveBeenCalled()
  })

  it('uses structured Sonnet output and returns one bounded sanitized tip', async () => {
    mocks.create.mockResolvedValue(
      message({
        accepted: false,
        reasonCode: 'HAIR_NOT_VISIBLE',
        retakeTip: `  Move closer   and show the full crown. ${'x'.repeat(200)}`,
      }),
    )

    const result = await checkConsultCapture({
      shotKey: 'hair_crown',
      image: IMAGE,
    })
    expect(result.accepted).toBe(false)
    expect(result.reasonCode).toBe('HAIR_NOT_VISIBLE')
    expect(result.retakeTip?.length).toBeLessThanOrEqual(160)
    expect(result.retakeTip).not.toContain('  ')
    expect(result.model).toBe('claude-sonnet-5')

    const [params, options] = mocks.create.mock.calls[0] ?? []
    expect(params.model).toBe('claude-sonnet-5')
    expect(params.output_config.format.type).toBe('json_schema')
    expect(params.messages[0].content[1].text).toContain('hair_crown')
    expect(params.system).toContain(
      'You refuse a photo only when it cannot be READ',
    )
    expect(params.system).toContain('How the LIGHT reads is never a refusal')
    expect(options.timeout).toBeLessThanOrEqual(50_000)
  })

  it('accepts only PASS and strips a provider tip on acceptance', async () => {
    mocks.create.mockResolvedValue(
      message({ accepted: true, reasonCode: 'PASS', retakeTip: 'ignore me' }),
    )
    await expect(
      checkConsultCapture({ shotKey: 'hair_back', image: IMAGE }),
    ).resolves.toMatchObject({
      accepted: true,
      reasonCode: 'PASS',
      retakeTip: null,
    })
  })

  // v4 moved the two colour codes OUT of this list: a provider that accepts a
  // warm frame is now agreeing with the server, not contradicting it. What
  // still has to fail closed is an acceptance carrying an UNREADABLE finding —
  // "this is fine, and also the hair is not visible" is not a verdict.
  it.each([
    'VIEW_MISMATCH',
    'HAIR_NOT_VISIBLE',
    'SUBJECT_NOT_VISIBLE',
    'BLURRY',
    'TOO_DARK',
    'TOO_BRIGHT',
    'OTHER_QUALITY_FAILURE',
  ])(
    'fails closed when a provider inconsistently accepts %s on a full view',
    async (reasonCode) => {
      mocks.create.mockResolvedValue(
        message({ accepted: true, reasonCode, retakeTip: null }),
      )
      await expect(
        checkConsultCapture({ shotKey: 'hair_left', image: IMAGE }),
      ).rejects.toMatchObject({ kind: 'bad_output' } satisfies Partial<ConsultCaptureVisionError>)
    },
  )

  it('fails closed when a provider REFUSES while reporting PASS', async () => {
    mocks.create.mockResolvedValue(
      message({ accepted: false, reasonCode: 'PASS', retakeTip: null }),
    )
    await expect(
      checkConsultCapture({ shotKey: 'hair_left', image: IMAGE }),
    ).rejects.toMatchObject({ kind: 'bad_output' } satisfies Partial<ConsultCaptureVisionError>)
  })

  // B3: the eyes/brows shot was being refused by a rule written for a photo of
  // a whole head. Its own spec asks the eyes to FILL the frame, so there is
  // barely any room left to read the light off and the average colour is skin.
  describe('colour findings never refuse a guided shot (v4)', () => {
    it.each([
      ['eyes_closeup', 'WARM_INDOOR_LIGHT'],
      ['eyes_closeup', 'COLOR_CAST'],
      ['area_closeup', 'WARM_INDOOR_LIGHT'],
      ['area_closeup', 'COLOR_CAST'],
      // 🔴 The four that used to REJECT. `face_front` under a warm lamp is the
      // exact frame prod consult cmtoma65j0002l9040bpit3v6 was refused on four
      // times across two days.
      ['face_front', 'WARM_INDOOR_LIGHT'],
      ['face_front', 'COLOR_CAST'],
      ['hair_left', 'WARM_INDOOR_LIGHT'],
      ['area_wide', 'COLOR_CAST'],
    ])(
      'accepts %s with a %s warning instead of rejecting it',
      async (shotKey, reasonCode) => {
        // The honest provider answer to "is this light warm?" is a rejection;
        // the SERVER decides what that costs on this view.
        mocks.create.mockResolvedValue(
          message({
            accepted: false,
            reasonCode,
            retakeTip: 'Move near a window and face the daylight.',
          }),
        )
        await expect(
          checkConsultCapture({ shotKey, image: IMAGE }),
        ).resolves.toMatchObject({
          accepted: true,
          reasonCode: 'PASS',
          warningCode: reasonCode,
          retakeTip: null,
        })
      },
    )

    it('lands on the same result when the provider already accepted the cast', async () => {
      mocks.create.mockResolvedValue(
        message({ accepted: true, reasonCode: 'COLOR_CAST', retakeTip: null }),
      )
      await expect(
        checkConsultCapture({ shotKey: 'eyes_closeup', image: IMAGE }),
      ).resolves.toMatchObject({
        accepted: true,
        reasonCode: 'PASS',
        warningCode: 'COLOR_CAST',
      })
    })

    it.each(['VIEW_MISMATCH', 'BLURRY', 'TOO_DARK'])(
      'still rejects a tight crop for %s — the view outranks the light',
      async (reasonCode) => {
        mocks.create.mockResolvedValue(
          message({ accepted: false, reasonCode, retakeTip: 'Fill the frame with both eyes.' }),
        )
        await expect(
          checkConsultCapture({ shotKey: 'eyes_closeup', image: IMAGE }),
        ).resolves.toMatchObject({
          accepted: false,
          reasonCode,
          warningCode: null,
        })
      },
    )

    it.each([
      'VIEW_MISMATCH',
      'HAIR_NOT_VISIBLE',
      'SUBJECT_NOT_VISIBLE',
      'BLURRY',
      'TOO_DARK',
      'TOO_BRIGHT',
      'OTHER_QUALITY_FAILURE',
    ])('still rejects a full view for %s — the frame cannot be read', async (reasonCode) => {
      mocks.create.mockResolvedValue(
        message({ accepted: false, reasonCode, retakeTip: 'Move near a window.' }),
      )
      await expect(
        checkConsultCapture({ shotKey: 'face_front', image: IMAGE }),
      ).resolves.toMatchObject({
        accepted: false,
        reasonCode,
        warningCode: null,
        retakeTip: 'Move near a window.',
      })
    })

    it('carries no warning on an unremarkable full view under neutral light', async () => {
      mocks.create.mockResolvedValue(
        message({ accepted: true, reasonCode: 'PASS', retakeTip: null }),
      )
      await expect(
        checkConsultCapture({ shotKey: 'face_front', image: IMAGE }),
      ).resolves.toMatchObject({
        accepted: true,
        reasonCode: 'PASS',
        warningCode: null,
      })
    })

    it('gives every view the SAME lighting rule, and its own composition', async () => {
      mocks.create.mockResolvedValue(
        message({ accepted: true, reasonCode: 'PASS', retakeTip: null }),
      )

      await checkConsultCapture({ shotKey: 'eyes_closeup', image: IMAGE })
      const tight = mocks.create.mock.calls[0]?.[0].messages[0].content[1].text
      await checkConsultCapture({ shotKey: 'face_front', image: IMAGE })
      const full = mocks.create.mock.calls[1]?.[0].messages[0].content[1].text

      // One lighting rule, both views. This is the whole of v4.
      for (const prompt of [tight, full]) {
        expect(prompt).toContain('Lighting is never a refusal on this shot')
        expect(prompt).toContain('Refuse the photo ONLY when it cannot be read')
        expect(prompt).not.toContain('are rejected even when the requested view')
      }
      // Framing still speaks — as composition, which is what it describes.
      expect(tight).toContain('Composition: a tight crop')
      expect(full).toContain('Composition: a full view')
    })

    it('pins the stored prompt version to v4 for a guided shot', () => {
      expect(consultCaptureQualityPromptVersion('face_front')).toBe(
        'full-analysis-capture-v4',
      )
    })

    it('still treats every earlier version as analyzable', () => {
      for (const version of [
        'full-analysis-capture-v2',
        'full-analysis-capture-v3',
        'full-analysis-capture-v4',
        'early-photo-capture-v1',
      ]) {
        expect(isAnalyzableConsultCapturePromptVersion(version)).toBe(true)
      }
      expect(isAnalyzableConsultCapturePromptVersion('hair-color-capture-v1')).toBe(
        false,
      )
    })
  })

  it('maps provider errors and refusals to typed content-free failures', async () => {
    mocks.create.mockRejectedValueOnce(new Error('provider secret detail'))
    await expect(
      checkConsultCapture({ shotKey: 'hair_right', image: IMAGE }),
    ).rejects.toMatchObject({
      kind: 'unavailable',
      message: 'Capture quality checking is unavailable.',
    } satisfies Partial<ConsultCaptureVisionError>)

    mocks.create.mockResolvedValueOnce(message({}, 'refusal'))
    await expect(
      checkConsultCapture({ shotKey: 'hair_right', image: IMAGE }),
    ).rejects.toMatchObject({ kind: 'refused' } satisfies Partial<ConsultCaptureVisionError>)
  })
})
