// tests/live/consult-provider-schema.test.ts
//
// 🔴 The one test in this repo that would have caught the bug it exists for.
//
// `runConsultAnalysis` shipped for two schema versions unable to make a single
// successful request. Its `output_config.format.schema` was refused by the
// Messages API — first for keywords the structured-output validator does not
// accept (`minimum`/`maximum`, `maxItems`/`uniqueItems`, `minItems: 7`), then,
// after those were stripped, for the size of the compiled grammar. Every
// consult test mocked the provider, so the suite was green the whole time and
// the only symptom in production was CONSULT_ANALYSIS_UNAVAILABLE.
//
// A mock cannot fail that way. So this suite sends THE schemas this repo would
// send — built by the same functions, sanitized by the same boundary — to the
// real endpoint, with real images, and asserts the call comes back 200 and the
// answer parses through the real sanitizers.
//
// It costs money and needs a third party to be up, so it is not a PR gate: it
// runs nightly and on demand (.github/workflows/live-model-contract.yml).
// `pnpm test:live:consult-schema`.

import { readFileSync } from 'node:fs'
import path from 'node:path'

import Anthropic from '@anthropic-ai/sdk'
import { beforeAll, describe, expect, it } from 'vitest'

import {
  buildConsultDirectionOutputSchema,
  buildConsultProfileOutputSchema,
  CONSULT_ANALYSIS_DEFAULT_MODEL,
  CONSULT_ANALYSIS_DIRECTION_MAX_TOKENS,
  CONSULT_ANALYSIS_DIRECTION_SYSTEM_PROMPT,
  CONSULT_ANALYSIS_EFFORT,
  CONSULT_ANALYSIS_PROFILE_MAX_TOKENS,
  CONSULT_ANALYSIS_PROFILE_SYSTEM_PROMPT,
  sanitizeConsultDirectionResponse,
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

/**
 * The eval fixtures: synthetic, committed, and the only images in this repo
 * that are safe to send anywhere (prod media is clients' private session
 * photos). Enough of a head of hair for the model to answer about.
 */
const FIXTURES = path.join(process.cwd(), 'eval/consult/hair-color/v1/fixtures')

function fixture(name: string): { base64: string; mediaType: 'image/jpeg' } {
  return {
    base64: readFileSync(path.join(FIXTURES, `${name}.jpg`)).toString('base64'),
    mediaType: 'image/jpeg',
  }
}

const MENU = ['Full balayage', 'Root touch-up', 'Toner gloss'] as const

/**
 * What the hair-colour intake below can support. The provider's `code` enum is
 * narrowed to this per run — a code outside it is a fabricated concern that
 * would cost the whole analysis (lib/consult/safetyFlags.ts).
 */
const SAFETY_CODES = ['ALLERGY_HISTORY_UNKNOWN'] as const

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
  // Fail, never skip. A silently skipped live test is exactly the "green suite,
  // broken schema" state this file exists to make impossible.
  if (!apiKey) {
    throw new Error(
      'tests/live needs ANTHROPIC_API_KEY. This suite makes real provider calls by design.',
    )
  }
  client = new Anthropic({ apiKey, maxRetries: 0 })
})

const model = () =>
  process.env.AI_CONSULT_ANALYSIS_MODEL ?? CONSULT_ANALYSIS_DEFAULT_MODEL

type Content = Anthropic.ContentBlockParam[]

function labeledImages(): Content {
  const content: Content = []
  for (const shotKey of SHOT_KEYS) {
    const image = fixture(`synthetic-i-${shotKey}`)
    content.push({ type: 'text', text: `Evidence label: ${shotKey}` })
    content.push({
      type: 'image',
      source: { type: 'base64', media_type: image.mediaType, data: image.base64 },
    })
  }
  return content
}

/**
 * One structured-output request, with the failure surfaced rather than
 * swallowed. `runConsultAnalysis` maps every provider error to `unavailable`
 * — correct in production, useless here, where the 400's own words ("the
 * compiled grammar is too large") are the finding.
 */
async function send(args: {
  system: string
  content: Content
  schema: Record<string, unknown>
  maxTokens: number
}): Promise<unknown> {
  let message: Anthropic.Message
  try {
    message = await client.messages.create({
      model: model(),
      max_tokens: args.maxTokens,
      system: args.system,
      messages: [{ role: 'user', content: args.content }],
      output_config: {
        // Production's effort level, not a level typed here — the two calls'
        // token and latency behaviour is entirely different at the default.
        effort: CONSULT_ANALYSIS_EFFORT,
        format: { type: 'json_schema', schema: toProviderOutputSchema(args.schema) },
      },
    })
  } catch (error) {
    throw new Error(
      `the provider refused this schema: ${
        error instanceof Error ? error.message : String(error)
      }`,
    )
  }
  expect(message.stop_reason).not.toBe('refusal')
  // A truncated answer is not a parse failure to debug later: it means
  // max_tokens is below what this schema needs, and the production call would
  // fail the same way.
  expect(message.stop_reason).not.toBe('max_tokens')
  const text = message.content
    .filter((block): block is Anthropic.TextBlock => block.type === 'text')
    .map((block) => block.text)
    .join('')
  expect(text).not.toBe('')
  return JSON.parse(text) as unknown
}

describe('the consult schemas compile and answer against the live model', () => {
  it('call 1 — the feature profile schema returns a payload the sanitizer accepts', async () => {
    const raw = await send({
      system: CONSULT_ANALYSIS_PROFILE_SYSTEM_PROMPT,
      content: [
        ...labeledImages(),
        {
          type: 'text',
          text: [
            'Consultation context:',
            'Capture pack: hair-color-daylight (views: ' + SHOT_KEYS.join(', ') + ')',
            'Service family: Hair',
            'Service category: Color',
            'Service the client is considering: Full balayage',
          ].join('\n'),
        },
        { type: 'text', text: 'Client intake: no answers.' },
      ],
      schema: buildConsultProfileOutputSchema({ suppliedShotKeys: [...SHOT_KEYS] }),
      // 🔴 THE constant production sends, never a number typed here. The first
      // live run of this file hardcoded 5,000 for the direction call and
      // truncated on exactly that boundary — a cap the real caller did not
      // have, which is a test failing on its own fixture rather than on the
      // contract it exists to check.
      maxTokens: CONSULT_ANALYSIS_PROFILE_MAX_TOKENS,
    })

    const profile = sanitizeConsultProfileResponse(raw)
    expect(Object.keys(profile)).toHaveLength(11)
    for (const observation of Object.values(profile)) {
      expect(Object.keys(observation).sort()).toEqual([
        'confidence',
        'evidence',
        'value',
      ])
      expect(observation.confidence.min).toBeLessThan(observation.confidence.max)
    }
  })

  it('call 2 — the direction schema returns a payload the sanitizer accepts', async () => {
    const raw = await send({
      system: CONSULT_ANALYSIS_DIRECTION_SYSTEM_PROMPT,
      content: [
        ...labeledImages(),
        {
          type: 'text',
          text: [
            'Consultation context:',
            'Capture pack: hair-color-daylight (views: ' + SHOT_KEYS.join(', ') + ')',
            'Service family: Hair',
            'Service category: Color',
            'Service the client is considering: Full balayage',
            `Professional's menu in this category (recommend only these, named exactly): ${MENU.join('; ')}`,
          ].join('\n'),
        },
        {
          type: 'text',
          text: 'Client intake (question → answer [code]):\nHave you ever reacted to a colour service? → No [prior_reaction=no]',
        },
        {
          type: 'text',
          text: 'Client inspiration: the client brought no reference photograph. Work from her intake answers alone and do not invent a reference.',
        },
        {
          type: 'text',
          text: [
            'Client feature profile (already established from these same photographs — treat as settled, do not re-derive):',
            '- skinUndertone: NEUTRAL (confidence 0.4–0.65, read from face_front)',
            '- contrastLevel: MEDIUM (confidence 0.4–0.65, read from face_front)',
            '- colorSeason: UNKNOWN (not established — do not lean on it)',
          ].join('\n'),
        },
      ],
      schema: buildConsultDirectionOutputSchema({
        menuServiceNames: [...MENU],
        safetyCodes: [...SAFETY_CODES],
        suppliedShotKeys: [...SHOT_KEYS],
      }),
      maxTokens: CONSULT_ANALYSIS_DIRECTION_MAX_TOKENS,
    })

    const direction = sanitizeConsultDirectionResponse(raw, {
      menuServiceNames: [...MENU],
    })
    expect(direction.styleDirections).toHaveLength(7)
    expect(direction.recommendations.length).toBeGreaterThan(0)
    // The levels are the point of schema v4: two named ends, ordered, each
    // citing hair views only.
    for (const field of ['baseLevel', 'lightestLevel'] as const) {
      const level = direction.core[field]
      expect(level.value).toMatch(/^(LEVEL_(10|[1-9])|UNKNOWN)$/)
      for (const cited of level.evidence) {
        expect(cited).toMatch(/^hair_/)
      }
    }
  })

  it('the inspiration schema returns a payload the sanitizer accepts', async () => {
    const image = fixture('synthetic-i-hair_back')
    const raw = await send({
      system: CONSULT_INSPIRATION_ANALYSIS_SYSTEM_PROMPT,
      content: [
        {
          type: 'image',
          source: { type: 'base64', media_type: image.mediaType, data: image.base64 },
        },
        {
          type: 'text',
          text: 'This is the client’s inspiration reference. Read its hair colour into the eight fields. Use UNKNOWN wherever this photograph does not show you the answer.',
        },
      ],
      schema: CONSULT_INSPIRATION_ANALYSIS_OUTPUT_SCHEMA,
      maxTokens: CONSULT_INSPIRATION_MAX_TOKENS,
    })

    // A synthetic fixture may legitimately be unreadable, and `unreadable` is
    // the sanitizer working, not failing — but it is the ONLY failure this
    // test tolerates, and it still proves the schema compiled and answered.
    try {
      const analysis = sanitizeConsultInspirationAnalysis(raw)
      expect(Object.keys(analysis)).toHaveLength(8)
      expect(analysis.baseLevel.value).toMatch(/^(LEVEL_(10|[1-9])|UNKNOWN)$/)
    } catch (error) {
      expect(error).toBeInstanceOf(ConsultInspirationVisionError)
      expect((error as ConsultInspirationVisionError).kind).toBe('unreadable')
    }
  })
})
