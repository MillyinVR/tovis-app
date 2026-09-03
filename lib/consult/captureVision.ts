import Anthropic from '@anthropic-ai/sdk'

import { readOptionalEnv, requireEnv } from '@/lib/env'
import { isRecord } from '@/lib/guards'
import type { ConsultCaptureQualityReasonCodeDTO } from '@/lib/dto/consult'

import { findConsultCaptureShot } from './capture/registry'
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
  'SUBJECT_NOT_VISIBLE',
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

/**
 * The acceptance sentence for a view comes from the shot's definition in the
 * capture registry (lib/consult/capture/), so a new pack brings its own rules
 * and this gate never has to know which family it is judging.
 */
function instructions(shotKey: string): string {
  const shot = findConsultCaptureShot(shotKey)
  if (!shot) throw new ConsultCaptureVisionError('bad_output')
  return [
    `Requested view: ${shotKey}.`,
    shot.acceptance,
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

export async function checkConsultCapture(input: {
  shotKey: string
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
