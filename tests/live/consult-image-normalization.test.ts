// tests/live/consult-image-normalization.test.ts
//
// P2e — the live half of image normalization at ingest.
//
// What it exists to prove, and why a mock cannot: on 2026-09-06 a production
// consult analysis failed six times across two runs because the reference the
// client chose was a 5712×4284, 5,032,646-byte published Look — 32,646 bytes
// over the consult's own ceiling. Every consult test mocked the provider, so
// nothing in the suite could tell the difference between "an oversized image
// is handled" and "an oversized image has never been tried".
//
// So this file takes a deliberately oversized image for EACH entry path an
// image has into the consult, runs it through the real normalizer, and sends
// the result to the real Messages API — and asserts the analysis comes back
// and parses.
//
// 🔴 The control test is the load-bearing one. Without it, all this file shows
// is that small images work; it does not show the normalizer is doing
// anything. `the provider rejects what the normalizer prevents` sends the raw
// 12000px image and requires a refusal. If that test ever starts PASSING the
// provider has relaxed a limit, and this suite should be re-read before the
// envelope is loosened on the strength of it.
//
// Costs money and needs ANTHROPIC_API_KEY. Not a PR gate.
// `pnpm test:live:consult-normalization`.

import Anthropic from '@anthropic-ai/sdk'
import sharp from 'sharp'
import { beforeAll, describe, expect, it } from 'vitest'

import {
  CONSULT_ANALYSIS_DEFAULT_MODEL,
  CONSULT_ANALYSIS_EFFORT,
  CONSULT_ANALYSIS_PROFILE_MAX_TOKENS,
  CONSULT_ANALYSIS_PROFILE_SYSTEM_PROMPT,
  buildConsultProfileOutputSchema,
  sanitizeConsultProfileResponse,
} from '@/lib/consult/analysisEngine'
import {
  CONSULT_INSPIRATION_ANALYSIS_OUTPUT_SCHEMA,
  CONSULT_INSPIRATION_ANALYSIS_SYSTEM_PROMPT,
  CONSULT_INSPIRATION_MAX_TOKENS,
  ConsultInspirationVisionError,
  sanitizeConsultInspirationAnalysis,
} from '@/lib/consult/inspirationVision'
import { toProviderOutputSchema } from '@/lib/consult/providerSchema'
import type { NormalizedImage } from '@/lib/media/normalizeImage'
import {
  NORMALIZED_IMAGE_MAX_BYTES,
  NORMALIZED_IMAGE_MAX_DIMENSION,
  normalizeImageForVision,
} from '@/lib/media/normalizeImage'

/**
 * Something with hair in it, at an arbitrary size. Synthetic — the only images
 * safe to send anywhere from this repo (production media is clients' private
 * session photographs), and the model only has to be able to answer about it,
 * not admire it. Vertical strands over skin tone read as hair well enough for
 * the sanitizer to accept a reading.
 */
async function syntheticHair(width: number, height: number, quality: number) {
  const raw = Buffer.alloc(width * height * 3)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 3
      // Strand banding across x, with a slow warm-to-cool drift down y, plus
      // enough per-pixel variation that JPEG cannot compress it to nothing.
      const strand = Math.sin(x / (width / 240)) * 40
      const depth = (y / height) * 30
      const grain = ((x * 7919 + y * 104729) % 23) - 11
      raw[i] = Math.max(0, Math.min(255, 150 + strand - depth + grain))
      raw[i + 1] = Math.max(0, Math.min(255, 110 + strand * 0.8 - depth + grain))
      raw[i + 2] = Math.max(0, Math.min(255, 70 + strand * 0.5 - depth + grain))
    }
  }
  return sharp(raw, { raw: { width, height, channels: 3 } })
    .jpeg({ quality })
    .toBuffer()
}

/**
 * One deliberately oversized image per entry path, each shaped like what that
 * path actually delivers. Every one of them is outside at least one bound the
 * consult or the provider enforces.
 */
const ENTRY_PATHS = [
  {
    name: 'inspiration — Look source (Tori’s 2026-09-06 case)',
    // The exact geometry and byte weight of the published Look that failed.
    build: () => syntheticHair(5712, 4284, 100),
    breaches: 'the consult’s own 5,000,000-byte inspiration ceiling',
  },
  {
    name: 'inspiration — camera-roll upload, unprepared',
    // A 12000px panorama: inside 5 MB, but past the provider's 8000×8000.
    build: () => syntheticHair(12_000, 2_000, 60),
    breaches: 'the provider’s 8000×8000 dimension limit',
  },
  {
    name: 'guided capture — a phone original that skipped preparation',
    build: () => syntheticHair(4032, 3024, 100),
    breaches: 'the consult’s own capture byte ceiling',
  },
] as const

const SHOT_KEYS = [
  'hair_back',
  'hair_left',
  'hair_right',
  'hair_crown',
  'face_front',
  'face_side',
  'eyes_closeup',
] as const

let client: Anthropic

beforeAll(() => {
  const apiKey = process.env.ANTHROPIC_API_KEY
  // Fail, never skip — a skipped live test is the green-suite-broken-contract
  // state this whole directory exists to make impossible.
  if (!apiKey) {
    throw new Error(
      'tests/live needs ANTHROPIC_API_KEY. This suite makes real provider calls by design.',
    )
  }
  client = new Anthropic({ apiKey, maxRetries: 0 })
})

const model = () =>
  process.env.AI_CONSULT_ANALYSIS_MODEL ?? CONSULT_ANALYSIS_DEFAULT_MODEL

async function send(args: {
  system: string
  content: Anthropic.ContentBlockParam[]
  schema: Record<string, unknown>
  maxTokens: number
}): Promise<unknown> {
  const message = await client.messages.create({
    model: model(),
    max_tokens: args.maxTokens,
    system: args.system,
    messages: [{ role: 'user', content: args.content }],
    output_config: {
      effort: CONSULT_ANALYSIS_EFFORT,
      format: { type: 'json_schema', schema: toProviderOutputSchema(args.schema) },
    },
  })
  expect(message.stop_reason).not.toBe('refusal')
  expect(message.stop_reason).not.toBe('max_tokens')
  const text = message.content
    .filter((block): block is Anthropic.TextBlock => block.type === 'text')
    .map((block) => block.text)
    .join('')
  expect(text).not.toBe('')
  return JSON.parse(text) as unknown
}

function imageBlock(image: NormalizedImage): Anthropic.ContentBlockParam {
  return {
    type: 'image',
    source: {
      type: 'base64',
      media_type: image.contentType,
      data: image.bytes.toString('base64'),
    },
  }
}

describe('an oversized image through every consult entry path', () => {
  it('the provider rejects what the normalizer prevents', async () => {
    // The control. Sent RAW, exactly as the consult would have before P2e.
    const raw = await syntheticHair(12_000, 2_000, 60)
    expect(Math.max(12_000, 2_000)).toBeGreaterThan(8000)

    await expect(
      client.messages.create({
        model: model(),
        max_tokens: 64,
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'image',
                source: {
                  type: 'base64',
                  media_type: 'image/jpeg',
                  data: raw.toString('base64'),
                },
              },
              { type: 'text', text: 'Describe this image in one word.' },
            ],
          },
        ],
      }),
      // If this stops rejecting, the provider changed — read the vision docs
      // again before concluding the normalizer is unnecessary.
    ).rejects.toBeInstanceOf(Anthropic.BadRequestError)
  })

  for (const entry of ENTRY_PATHS) {
    it(`${entry.name}: normalizes, then analyses`, async () => {
      const oversized = await entry.build()

      const normalized = await normalizeImageForVision(oversized, 'image/jpeg')
      expect(normalized.rewritten).toBe(true)
      expect(Math.max(normalized.width, normalized.height)).toBeLessThanOrEqual(
        NORMALIZED_IMAGE_MAX_DIMENSION,
      )
      expect(normalized.bytes.byteLength).toBeLessThanOrEqual(
        NORMALIZED_IMAGE_MAX_BYTES,
      )

      const raw = await send({
        system: CONSULT_INSPIRATION_ANALYSIS_SYSTEM_PROMPT,
        content: [
          imageBlock(normalized),
          {
            type: 'text',
            text: 'This is the client’s inspiration reference. Read its hair colour into the eight fields. Use UNKNOWN wherever this photograph does not show you the answer.',
          },
        ],
        schema: CONSULT_INSPIRATION_ANALYSIS_OUTPUT_SCHEMA,
        maxTokens: CONSULT_INSPIRATION_MAX_TOKENS,
      })

      // A synthetic image may legitimately read as unreadable — that is the
      // sanitizer working. What is NOT tolerated is the call failing, which is
      // what `send` already asserts: the point of this test is that an image
      // that used to be refused before inference now reaches the model.
      try {
        const analysis = sanitizeConsultInspirationAnalysis(raw)
        expect(Object.keys(analysis)).toHaveLength(8)
      } catch (error) {
        expect(error).toBeInstanceOf(ConsultInspirationVisionError)
        expect((error as ConsultInspirationVisionError).kind).toBe('unreadable')
      }
    })
  }

  it('a full 7-shot analysis of oversized captures fits one request', async () => {
    // The multi-image case the per-image ceiling exists for: seven phone
    // originals, each past the capture ceiling, in ONE request that has to
    // stay inside the API's 32 MB.
    const content: Anthropic.ContentBlockParam[] = []
    let totalBase64 = 0
    for (const shotKey of SHOT_KEYS) {
      const normalized = await normalizeImageForVision(
        await syntheticHair(4032, 3024, 100),
        'image/jpeg',
      )
      expect(normalized.rewritten).toBe(true)
      totalBase64 += normalized.bytes.toString('base64').length
      content.push({ type: 'text', text: `Evidence label: ${shotKey}` })
      content.push(imageBlock(normalized))
    }
    expect(totalBase64).toBeLessThan(32_000_000)

    const raw = await send({
      system: CONSULT_ANALYSIS_PROFILE_SYSTEM_PROMPT,
      content: [
        ...content,
        {
          type: 'text',
          text: [
            'Consultation context:',
            `Capture pack: hair-color-daylight (views: ${SHOT_KEYS.join(', ')})`,
            'Service family: Hair',
            'Service category: Color',
            'Service the client is considering: Full balayage',
          ].join('\n'),
        },
        { type: 'text', text: 'Client intake: no answers.' },
      ],
      schema: buildConsultProfileOutputSchema({ suppliedShotKeys: [...SHOT_KEYS] }),
      maxTokens: CONSULT_ANALYSIS_PROFILE_MAX_TOKENS,
    })

    const profile = sanitizeConsultProfileResponse(raw)
    expect(Object.keys(profile)).toHaveLength(11)
  })
})
