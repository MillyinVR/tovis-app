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
  checkHairColorCapture,
  ConsultCaptureVisionError,
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

describe('checkHairColorCapture', () => {
  it('fails closed before sending the photo when the model override is not allowlisted', async () => {
    process.env.AI_CONSULT_CAPTURE_MODEL = 'claude-sonnet-5-typo'

    await expect(
      checkHairColorCapture({ shotKey: 'hair_back', image: IMAGE }),
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

    const result = await checkHairColorCapture({
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
    expect(params.system).toContain('Reject any warm indoor lighting or color cast')
    expect(options.timeout).toBeLessThanOrEqual(50_000)
  })

  it('accepts only PASS and strips a provider tip on acceptance', async () => {
    mocks.create.mockResolvedValue(
      message({ accepted: true, reasonCode: 'PASS', retakeTip: 'ignore me' }),
    )
    await expect(
      checkHairColorCapture({ shotKey: 'hair_back', image: IMAGE }),
    ).resolves.toMatchObject({
      accepted: true,
      reasonCode: 'PASS',
      retakeTip: null,
    })
  })

  it.each(['WARM_INDOOR_LIGHT', 'COLOR_CAST']) (
    'fails closed when a provider inconsistently accepts %s',
    async (reasonCode) => {
      mocks.create.mockResolvedValue(
        message({ accepted: true, reasonCode, retakeTip: null }),
      )
      await expect(
        checkHairColorCapture({ shotKey: 'hair_left', image: IMAGE }),
      ).rejects.toMatchObject({ kind: 'bad_output' } satisfies Partial<ConsultCaptureVisionError>)
    },
  )

  it('maps provider errors and refusals to typed content-free failures', async () => {
    mocks.create.mockRejectedValueOnce(new Error('provider secret detail'))
    await expect(
      checkHairColorCapture({ shotKey: 'hair_right', image: IMAGE }),
    ).rejects.toMatchObject({
      kind: 'unavailable',
      message: 'Capture quality checking is unavailable.',
    } satisfies Partial<ConsultCaptureVisionError>)

    mocks.create.mockResolvedValueOnce(message({}, 'refusal'))
    await expect(
      checkHairColorCapture({ shotKey: 'hair_right', image: IMAGE }),
    ).rejects.toMatchObject({ kind: 'refused' } satisfies Partial<ConsultCaptureVisionError>)
  })
})
