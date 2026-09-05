import Anthropic from '@anthropic-ai/sdk'
import { ConsultProviderCallKind } from '@prisma/client'

import { readOptionalEnv, requireEnv } from '@/lib/env'
import { isRecord } from '@/lib/guards'
import type {
  ConsultCaptureQualityReasonCodeDTO,
  ConsultCaptureQualityWarningCodeDTO,
} from '@/lib/dto/consult'

import { findConsultCaptureShot } from './capture/registry'
import { shotToleratesColorCast } from './capture/types'
import {
  meterConsultProviderCall,
  type ConsultProviderMeterSink,
} from './providerMeter'
import { isAllowedConsultProviderModel } from './providerModel'

export const CONSULT_CAPTURE_MEDIA_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
] as const

export type ConsultCaptureMediaType =
  (typeof CONSULT_CAPTURE_MEDIA_TYPES)[number]

export const CONSULT_CAPTURE_QUALITY_SCHEMA_VERSION = 1
// v3 (2026-09-03, B3): the colour-cast rejection became shot-aware. A warm or
// cast reading on a TIGHT_CROP view is a warning on the accepted result; on a
// FULL_VIEW it is still a rejection. Both the system prompt and `sanitize`
// changed, so stored rows must be distinguishable by version.
export const CONSULT_CAPTURE_QUALITY_PROMPT_VERSION = 'full-analysis-capture-v3'

/**
 * Which prompt versions an accepted capture may have been judged under and
 * still be a usable analysis input. The bump to v3 only LOOSENED a colour
 * rule, so a photo that passed the stricter v2 gate is still a good input —
 * pinning the analysis to the current version alone would strand a client
 * who accepted photos before the deploy and pressed Analyze after it, with no
 * way back (an accepted slot cannot be retaken, only replaced).
 *
 * Mirrored by the database prerequisite guard
 * (`consult_revision_requires_agreements`); the two must agree.
 */
export const CONSULT_ANALYZABLE_CAPTURE_PROMPT_VERSIONS = [
  'full-analysis-capture-v2',
  CONSULT_CAPTURE_QUALITY_PROMPT_VERSION,
] as const

export function isAnalyzableConsultCapturePromptVersion(
  value: string | null,
): boolean {
  return CONSULT_ANALYZABLE_CAPTURE_PROMPT_VERSIONS.some(
    (candidate) => candidate === value,
  )
}

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

export const CONSULT_CAPTURE_QUALITY_WARNING_CODES = [
  'WARM_INDOOR_LIGHT',
  'COLOR_CAST',
] as const satisfies readonly ConsultCaptureQualityWarningCodeDTO[]

function isColorFinding(
  reasonCode: ConsultCaptureQualityReasonCodeDTO,
): reasonCode is ConsultCaptureQualityWarningCodeDTO {
  return CONSULT_CAPTURE_QUALITY_WARNING_CODES.some(
    (candidate) => candidate === reasonCode,
  )
}

export type ConsultCaptureQualityResult = {
  accepted: boolean
  reasonCode: ConsultCaptureQualityReasonCodeDTO
  /**
   * A colour finding that did NOT block this shot — only ever set alongside
   * `accepted: true` and `reasonCode: 'PASS'`, and only on a tight-crop view.
   */
  warningCode: ConsultCaptureQualityWarningCodeDTO | null
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

/**
 * 🔴 This was 300, and 300 was not enough — the photo check has been failing
 * intermittently in production for as long as it has existed.
 *
 * THINKING TOKENS COUNT AGAINST `max_tokens`. Measured on 2026-09-04 against
 * `claude-sonnet-5`, two consecutive checks on the same capture pack:
 *
 *   accepted:  87 output tokens, of which  56 were thinking  → stop end_turn
 *   truncated: 300 output tokens, of which 277 were thinking → stop max_tokens
 *
 * The second call's JSON stopped mid-string (`{"accepted":false,"reasonCode":
 * "VIEW_M`), which reaches `sanitizeConsultCaptureQuality` as unparseable and
 * surfaces to the client as a 503 on a photo that the model had in fact
 * already judged. How long the model deliberates varies per image, so this was
 * a coin flip nothing in the mocked suite could see.
 *
 * The verdict itself needs about 90 tokens. This is deliberately generous
 * because the variable half is the thinking, not the answer.
 *
 * Only the CEILING moves: not the prompt, not the schema, not the effort
 * level. A truncated answer is not a different verdict, it is the same verdict
 * cut off — so `CONSULT_CAPTURE_QUALITY_PROMPT_VERSION` deliberately does NOT
 * move with it, and no capture already accepted under v3 is invalidated
 * (bumping it strands a client mid-consult; see the version constant below).
 */
const CONSULT_CAPTURE_QUALITY_MAX_TOKENS = 2_000
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
        'At most one short, concrete retake instruction; null when the reason code is PASS.',
    },
  },
}

const SYSTEM =
  'You are a strict capture-quality gate for a beauty consultation. ' +
  'Judge only whether this single photo is a usable input for later analysis. ' +
  'Do not analyze the client, infer traits, diagnose, recommend services, or ' +
  'describe sensitive content. Whether the requested view is visible always ' +
  'outranks how the light reads: if the view is missing, obstructed, or wrong, ' +
  'report that instead. How much a warm-light or color-cast finding costs the ' +
  'photo depends on the requested view, and each request states which rule ' +
  'applies to it. Return exactly one stable reason code and at most one short ' +
  'retake tip.'

/**
 * The acceptance sentence for a view comes from the shot's definition in the
 * capture registry (lib/consult/capture/), so a new pack brings its own rules
 * and this gate never has to know which family it is judging.
 */
function instructions(shotKey: string): string {
  const shot = findConsultCaptureShot(shotKey)
  if (!shot) throw new ConsultCaptureVisionError('bad_output')
  // The colour-fidelity line is the shot's own `framing`, not a list of keys
  // this file keeps: a new pack brings its answer with it.
  const colorRule = shotToleratesColorCast(shot)
    ? 'This view is a tight crop: the subject fills the frame, so its average color is mostly skin or surface and a warm reading is as likely to be the person as the room. Do NOT reject it for lighting alone. If the requested view is visible and everything else is usable but the light reads warm or cast, still report WARM_INDOOR_LIGHT or COLOR_CAST — it is recorded as a warning, not a refusal. If the requested view is NOT visible, report the view or subject failure instead; that outranks any color finding.'
    : 'This view is a full view with room around the subject, and color fidelity is the point of it: WARM_INDOOR_LIGHT and COLOR_CAST are rejected even when the requested view is otherwise visible.'
  return [
    `Requested view: ${shotKey}.`,
    shot.acceptance,
    colorRule,
    'Use PASS only when nothing at all is wrong. Every other reason code names the one thing that is.',
    'retakeTip: give zero or one concrete sentence, max 160 characters, whenever the reason code is not PASS.',
  ].join('\n')
}

function cleanTip(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const cleaned = value.replace(/\s+/g, ' ').trim().slice(0, RETAKE_TIP_MAX_CHARS)
  return cleaned || null
}

/**
 * The provider's raw JSON → the stored result, including the shot-aware
 * colour policy. Exported because the capture integration tests stand a fake
 * provider in front of the network and must still run its payload through THE
 * policy, not a second copy of it.
 */
export function sanitizeConsultCaptureQuality(
  raw: unknown,
  model: string,
  shotKey: string,
): ConsultCaptureQualityResult {
  if (!isRecord(raw) || typeof raw.accepted !== 'boolean') {
    throw new ConsultCaptureVisionError('bad_output')
  }
  const reasonCode = CONSULT_CAPTURE_QUALITY_REASON_CODES.find(
    (candidate) => candidate === raw.reasonCode,
  )
  if (!reasonCode) throw new ConsultCaptureVisionError('bad_output')
  const shot = findConsultCaptureShot(shotKey)
  if (!shot) throw new ConsultCaptureVisionError('bad_output')

  // The downgrade is decided HERE, not by the provider: the prompt asks for
  // the finding, the server decides what it costs. So a model that answers
  // `accepted: false` (the honest reading of "this light is warm") and one
  // that answers `accepted: true` land on the same stored result, and no
  // provider wobble can turn a full-view cast into an acceptance.
  if (isColorFinding(reasonCode) && shotToleratesColorCast(shot)) {
    return {
      accepted: true,
      reasonCode: 'PASS',
      warningCode: reasonCode,
      retakeTip: null,
      model,
    }
  }

  // Color fidelity is a non-negotiable gate on every full view. Treat
  // inconsistent provider output as a rejection, never as permission to
  // analyze.
  if (raw.accepted && reasonCode !== 'PASS') {
    throw new ConsultCaptureVisionError('bad_output')
  }
  if (!raw.accepted && reasonCode === 'PASS') {
    throw new ConsultCaptureVisionError('bad_output')
  }

  return {
    accepted: raw.accepted,
    reasonCode,
    warningCode: null,
    retakeTip: raw.accepted ? null : cleanTip(raw.retakeTip),
    model,
  }
}

export async function checkConsultCapture(input: {
  shotKey: string
  image: { base64: string; mediaType: ConsultCaptureMediaType }
  /**
   * P4b: where this call's cost is recorded. The gate runs in its own request,
   * one per photo, long before an analysis run exists — so its rows carry the
   * session and a null run. Omitted by unit tests and the eval script, which
   * simply go unmetered.
   */
  meter?: ConsultProviderMeterSink | null
}): Promise<ConsultCaptureQualityResult> {
  const model = modelName()
  return meterConsultProviderCall(
    input.meter,
    { kind: ConsultProviderCallKind.CAPTURE_GATE, model },
    async (reportUsage) => {
      let message: Anthropic.Message
      try {
        message = await getClient().messages.create(
          {
            model,
            max_tokens: CONSULT_CAPTURE_QUALITY_MAX_TOKENS,
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
      // Before the refusal check and before the parser: the answer arrived, so
      // it was billed, whatever this repo decides to do with it next.
      reportUsage(message.usage)

      if (message.stop_reason === 'refusal') {
        throw new ConsultCaptureVisionError('refused')
      }
      // Truncation is this repo's cap being too low, not a provider fault, and
      // it must not reach the parser as unexplained garbage — see
      // CONSULT_CAPTURE_QUALITY_MAX_TOKENS for the run that found it.
      if (message.stop_reason === 'max_tokens') {
        throw new ConsultCaptureVisionError('bad_output')
      }
      const text = message.content
        .filter((block): block is Anthropic.TextBlock => block.type === 'text')
        .map((block) => block.text)
        .join('')
      if (!text) throw new ConsultCaptureVisionError('bad_output')

      try {
        return sanitizeConsultCaptureQuality(
          JSON.parse(text),
          model,
          input.shotKey,
        )
      } catch (error) {
        if (error instanceof ConsultCaptureVisionError) throw error
        throw new ConsultCaptureVisionError('bad_output')
      }
    },
  )
}
