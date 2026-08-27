import Anthropic from '@anthropic-ai/sdk'

import { readOptionalEnv, requireEnv } from '@/lib/env'
import { isRecord } from '@/lib/guards'
import type { ConsultCaptureQualityReasonCodeDTO } from '@/lib/dto/consult'

import type { HairColorCaptureShotKey } from './capturePack'
import { isAllowedConsultProviderModel } from './providerModel'

export const CONSULT_CAPTURE_MEDIA_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
] as const

export type ConsultCaptureMediaType =
  (typeof CONSULT_CAPTURE_MEDIA_TYPES)[number]

export const CONSULT_CAPTURE_QUALITY_SCHEMA_VERSION = 1
export const CONSULT_CAPTURE_QUALITY_PROMPT_VERSION = 'full-analysis-capture-v2'
export const CONSULT_CAPTURE_QUALITY_REASON_CODES = [
  'PASS',
  'WARM_INDOOR_LIGHT',
  'COLOR_CAST',
  'VIEW_MISMATCH',
  'HAIR_NOT_VISIBLE',
  'BLURRY',
  'TOO_DARK',
  'TOO_BRIGHT',
  'OTHER_QUALITY_FAILURE',
] as const satisfies readonly ConsultCaptureQualityReasonCodeDTO[]

export type ConsultCaptureQualityResult = {
  accepted: boolean
  reasonCode: ConsultCaptureQualityReasonCodeDTO
  retakeTip: string | null
  model: string
}
export class ConsultCaptureVisionError extends Error {
  constructor(readonly kind: 'unavailable' | 'refused' | 'bad_output') {
    super('Capture quality checking is unavailable.')
    this.name = 'ConsultCaptureVisionError'
  }
}

const DEFAULT_MODEL = 'claude-sonnet-5'
const REQUEST_TIMEOUT_MS = 50_000
const RETAKE_TIP_MAX_CHARS = 160

let cachedClient: Anthropic | null = null

function modelName(): string {
  const model = readOptionalEnv('AI_CONSULT_CAPTURE_MODEL') ?? DEFAULT_MODEL
  if (!isAllowedConsultProviderModel(model)) {
    // Fail closed: client photos never go to a model the repo has not
    // explicitly allowlisted (lib/consult/providerModel.ts).
    throw new ConsultCaptureVisionError('unavailable')
  }
  return model
}

function getClient(): Anthropic {
  if (!cachedClient) {
    cachedClient = new Anthropic({
      apiKey: requireEnv('ANTHROPIC_API_KEY'),
      maxRetries: 1,
    })
  }
  return cachedClient
}

export function resetConsultCaptureVisionClientForTests(): void {
  cachedClient = null
}

const QUALITY_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: ['accepted', 'reasonCode', 'retakeTip'],
  properties: {
    accepted: { type: 'boolean' },
    reasonCode: {
      type: 'string',
      enum: [...CONSULT_CAPTURE_QUALITY_REASON_CODES],
    },
    retakeTip: {
      type: ['string', 'null'],
      description:
        'At most one short, concrete retake instruction; null when accepted.',
    },
  },
}

const SYSTEM =
  'You are a strict capture-quality gate for a beauty consultation. ' +
  'Judge only whether this single photo is a usable input for later analysis. ' +
  'Do not analyze the client, infer traits, diagnose, recommend services, or ' +
  'describe sensitive content. Reject any warm indoor lighting or color cast, ' +
  'even if the requested view is otherwise visible. Return exactly one ' +
  'stable reason code and at most one short retake tip.'

const SHOT_ACCEPTANCE: Readonly<Record<HairColorCaptureShotKey, string>> = {
  hair_back:
    'Accept only when the full back of the hair is clearly represented, the relevant hair and roots are sufficiently visible, focus and exposure are usable, and indirect daylight preserves color.',
  hair_left:
    'Accept only when the left side of the hair is clearly represented, the relevant hair and roots are sufficiently visible, focus and exposure are usable, and indirect daylight preserves color.',
  hair_right:
    'Accept only when the right side of the hair is clearly represented, the relevant hair and roots are sufficiently visible, focus and exposure are usable, and indirect daylight preserves color.',
  hair_crown:
    'Accept only when the crown, part, and surrounding roots are clearly represented, focus and exposure are usable, and indirect daylight preserves color.',
  face_front:
    'Accept only when one full front-facing face is clearly represented with hairline, brows, both eyes, and jawline visible and unobstructed, focus and exposure are usable, no beauty filter is apparent, and indirect daylight preserves color. Use VIEW_MISMATCH when the face is missing, obstructed, or not front-facing.',
  face_side:
    'Accept only when a full side profile is clearly represented with forehead, nose, lips, chin, and jawline visible in silhouette, focus and exposure are usable, no beauty filter is apparent, and indirect daylight preserves color. Use VIEW_MISMATCH when the profile is missing or partial.',
  eyes_closeup:
    'Accept only when both open eyes and both full brows fill most of the frame in sharp focus, exposure is usable, no beauty filter is apparent, and indirect daylight preserves color. Use VIEW_MISMATCH when eyes or brows are cropped, closed, or obstructed.',
}

function instructions(shotKey: HairColorCaptureShotKey): string {
  return [
    `Requested view: ${shotKey}.`,
    SHOT_ACCEPTANCE[shotKey],
    'WARM_INDOOR_LIGHT and COLOR_CAST are always rejected.',
    'Use PASS only with accepted=true. Every other reason requires accepted=false.',
    'retakeTip must be null on acceptance; on rejection provide zero or one concrete sentence, max 160 characters.',
  ].join('\n')
}

function cleanTip(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const cleaned = value.replace(/\s+/g, ' ').trim().slice(0, RETAKE_TIP_MAX_CHARS)
  return cleaned || null
}

function sanitize(
  raw: unknown,
  model: string,
): ConsultCaptureQualityResult {
  if (!isRecord(raw) || typeof raw.accepted !== 'boolean') {
    throw new ConsultCaptureVisionError('bad_output')
  }
  const reasonCode = CONSULT_CAPTURE_QUALITY_REASON_CODES.find(
    (candidate) => candidate === raw.reasonCode,
  )
  if (!reasonCode) throw new ConsultCaptureVisionError('bad_output')

  // Color fidelity is a non-negotiable hair-color gate. Treat inconsistent
  // provider output as a rejection, never as permission to analyze.
  const hardColorFailure =
    reasonCode === 'WARM_INDOOR_LIGHT' || reasonCode === 'COLOR_CAST'
  if (raw.accepted && (reasonCode !== 'PASS' || hardColorFailure)) {
    throw new ConsultCaptureVisionError('bad_output')
  }
  if (!raw.accepted && reasonCode === 'PASS') {
    throw new ConsultCaptureVisionError('bad_output')
  }

  return {
    accepted: raw.accepted,
    reasonCode,
    retakeTip: raw.accepted ? null : cleanTip(raw.retakeTip),
    model,
  }
}

export async function checkHairColorCapture(input: {
  shotKey: HairColorCaptureShotKey
  image: { base64: string; mediaType: ConsultCaptureMediaType }
}): Promise<ConsultCaptureQualityResult> {
  const model = modelName()
  let message: Anthropic.Message
  try {
    message = await getClient().messages.create(
      {
        model,
        max_tokens: 300,
        system: SYSTEM,
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'image',
                source: {
                  type: 'base64',
                  media_type: input.image.mediaType,
                  data: input.image.base64,
                },
              },
              { type: 'text', text: instructions(input.shotKey) },
            ],
          },
        ],
        output_config: {
          format: { type: 'json_schema', schema: QUALITY_SCHEMA },
        },
      },
      { timeout: REQUEST_TIMEOUT_MS },
    )
  } catch {
    throw new ConsultCaptureVisionError('unavailable')
  }

  if (message.stop_reason === 'refusal') {
    throw new ConsultCaptureVisionError('refused')
  }
  const text = message.content
    .filter((block): block is Anthropic.TextBlock => block.type === 'text')
    .map((block) => block.text)
    .join('')
  if (!text) throw new ConsultCaptureVisionError('bad_output')

  try {
    return sanitize(JSON.parse(text), model)
  } catch (error) {
    if (error instanceof ConsultCaptureVisionError) throw error
    throw new ConsultCaptureVisionError('bad_output')
  }
}
