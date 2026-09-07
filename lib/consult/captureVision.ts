import Anthropic from '@anthropic-ai/sdk'
import { ConsultProviderCallKind } from '@prisma/client'

import { readOptionalEnv, requireEnv } from '@/lib/env'
import { isRecord } from '@/lib/guards'
import type {
  ConsultCaptureQualityReasonCodeDTO,
  ConsultCaptureQualityWarningCodeDTO,
} from '@/lib/dto/consult'

import { findConsultCaptureShot } from './capture/registry'
import {
  CONSULT_COLOR_FINDING_WARNING_CODES,
  CONSULT_WARN_ONLY_REJECTING_REASON_CODE,
  isConsultColorFindingCode,
} from './capture/types'
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
// v4 (2026-09-07): warm light and colour cast are warnings on EVERY guided
// shot, not just a tight crop (Tori). v3's shot-aware split is gone — the
// rejection list is now the unreadable frames only. Both the system prompt and
// `sanitize` changed, so stored rows must be distinguishable by version.
//
// 🔴 Bumping this constant ALONE is a bare 500 on every photo: the value is
// pinned in two database objects — `ConsultCapture_quality_contract` (the row
// would fail its CHECK) and `consult_revision_requires_agreements` (the
// analysis prerequisite would stop seeing accepted captures). Both pins are
// SETS and both must learn the new value in the same migration; read the live
// `pg_get_functiondef`, never just the migration files.
export const CONSULT_CAPTURE_QUALITY_PROMPT_VERSION = 'full-analysis-capture-v4'

/**
 * Which prompt versions an accepted capture may have been judged under and
 * still be a usable analysis input. Every bump so far has only LOOSENED a
 * colour rule (v3 for tight crops, v4 for every shot), so a photo that passed
 * a stricter earlier gate is still a good input — pinning the analysis to the
 * current version alone would strand a client who accepted photos before the
 * deploy and pressed Analyze after it, with no way back (an accepted slot
 * cannot be retaken, only replaced).
 *
 * 🔴 Append here, never replace: this list only ever grows.
 *
 * Mirrored by the database prerequisite guard
 * (`consult_revision_requires_agreements`); the two must agree.
 */
/**
 * P7a-1. The early photo is judged under a DIFFERENT rule set (accept anything
 * with a person in it), so it carries its own version rather than riding on the
 * guided one.
 *
 * Two reasons it is not a bump of `CONSULT_CAPTURE_QUALITY_PROMPT_VERSION`:
 * the guided prompt genuinely did not change — its branch of `instructions()`
 * is byte-identical — so bumping it would restate a policy nobody altered and
 * invalidate nothing truthfully; and a stored row must say which rule set
 * judged it, which is exactly what a shared version cannot express.
 */
export const CONSULT_EARLY_PHOTO_QUALITY_PROMPT_VERSION = 'early-photo-capture-v1'

export const CONSULT_ANALYZABLE_CAPTURE_PROMPT_VERSIONS = [
  'full-analysis-capture-v2',
  'full-analysis-capture-v3',
  CONSULT_CAPTURE_QUALITY_PROMPT_VERSION,
  CONSULT_EARLY_PHOTO_QUALITY_PROMPT_VERSION,
] as const

/**
 * The version a capture of THIS shot is judged and stored under. One function,
 * so the value written to the row and the value the analysis gate accepts can
 * never be derived two different ways.
 */
export function consultCaptureQualityPromptVersion(shotKey: string): string {
  const shot = findConsultCaptureShot(shotKey)
  if (!shot) throw new ConsultCaptureVisionError('bad_output')
  return shot.gate === 'WARN_ONLY'
    ? CONSULT_EARLY_PHOTO_QUALITY_PROMPT_VERSION
    : CONSULT_CAPTURE_QUALITY_PROMPT_VERSION
}

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

/**
 * The colour findings, re-exported under the name the analysis contract reads.
 * Defined once in `capture/types.ts` — the policy that says they never reject
 * lives with them, and a second literal here could drift out of agreement with
 * it silently.
 */
export const CONSULT_CAPTURE_QUALITY_WARNING_CODES =
  CONSULT_COLOR_FINDING_WARNING_CODES satisfies readonly ConsultCaptureQualityWarningCodeDTO[]

function isColorFinding(
  reasonCode: ConsultCaptureQualityReasonCodeDTO,
): reasonCode is ConsultCaptureQualityWarningCodeDTO {
  return isConsultColorFindingCode(reasonCode)
}

export type ConsultCaptureQualityResult = {
  accepted: boolean
  reasonCode: ConsultCaptureQualityReasonCodeDTO
  /**
   * A finding that did NOT block this shot — only ever set alongside
   * `accepted: true` and `reasonCode: 'PASS'`. On a guided shot that is one of
   * the two colour findings, on any framing (v4); on the early photo it is
   * anything short of "no person here".
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
 * move with it, and no capture already accepted is invalidated (bumping it
 * strands a client mid-consult; see the version constant above).
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
  'You are a capture-quality gate for a beauty consultation. ' +
  'Judge only whether this single photo is a usable input for later analysis. ' +
  'Do not analyze the client, infer traits, diagnose, recommend services, or ' +
  'describe sensitive content. You refuse a photo only when it cannot be READ: ' +
  'the requested view is missing, obstructed or wrong; the subject is not ' +
  'there; the frame is too blurred or too far past dark or bright to make out. ' +
  'How the LIGHT reads is never a refusal — a warm or cast reading is reported ' +
  'and recorded as a warning on an accepted photo, because it is real ' +
  'information for the later analysis and not a reason to send someone back ' +
  'out. Return exactly one stable reason code and at most one short retake tip.'

/**
 * The acceptance sentence for a view comes from the shot's definition in the
 * capture registry (lib/consult/capture/), so a new pack brings its own rules
 * and this gate never has to know which family it is judging.
 */
function instructions(shotKey: string): string {
  const shot = findConsultCaptureShot(shotKey)
  if (!shot) throw new ConsultCaptureVisionError('bad_output')

  // P7a-1. A WARN_ONLY shot gets its own rule instead of the colour rule,
  // because for it the colour question does not arise: nothing here is
  // rejected for how it looks. The instruction still asks for the finding —
  // the warnings are what tells the later analysis to discount this frame, so
  // a model that answers a bare PASS on a dim photo has cost us the signal.
  if (shot.gate === 'WARN_ONLY') {
    return [
      `Requested view: ${shotKey}.`,
      shot.acceptance,
      `Report the single most significant finding as the reason code even though the photo is being accepted: it is stored as a warning, not a refusal. Use PASS only when there is genuinely nothing to note. ${CONSULT_WARN_ONLY_REJECTING_REASON_CODE} is the ONLY code that refuses this photo.`,
      'retakeTip: give zero or one concrete sentence, max 160 characters, whenever the reason code is not PASS.',
    ].join('\n')
  }

  // v4: ONE colour rule for every guided shot. `framing` no longer decides what
  // a colour finding costs — it describes the composition, which is what helps
  // the model judge whether the requested VIEW is actually in the frame.
  const composition =
    shot.framing === 'TIGHT_CROP'
      ? 'Composition: a tight crop. The subject should FILL the frame, with almost no background around it.'
      : 'Composition: a full view, composed at arm’s length or further, with room around the subject.'
  return [
    `Requested view: ${shotKey}.`,
    shot.acceptance,
    composition,
    'Lighting is never a refusal on this shot. If the requested view is visible and the frame is readable but the light reads warm or cast, report WARM_INDOOR_LIGHT or COLOR_CAST — it is recorded as a warning on an ACCEPTED photo, not a rejection. Report it rather than answering PASS: the later analysis uses it to widen its confidence, so a bare PASS on a warm frame loses real information.',
    'Refuse the photo ONLY when it cannot be read: the requested view is missing, obstructed or wrong (VIEW_MISMATCH, HAIR_NOT_VISIBLE), there is no subject (SUBJECT_NOT_VISIBLE), or the frame is too blurred or too far past dark or bright to make the view out (BLURRY, TOO_DARK, TOO_BRIGHT). Judge dark and bright by LEGIBILITY, not by preference: if the requested view can still be made out, that is not a refusal.',
    'Use PASS only when there is genuinely nothing to note.',
    'retakeTip: give zero or one concrete sentence, max 160 characters, whenever the reason code is not PASS.',
  ].join('\n')
}

function cleanTip(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const cleaned = value.replace(/\s+/g, ' ').trim().slice(0, RETAKE_TIP_MAX_CHARS)
  return cleaned || null
}

/**
 * The provider's raw JSON → the stored result, including the downgrade policy
 * that decides what a finding COSTS. Exported because the capture integration
 * tests stand a fake provider in front of the network and must still run its
 * payload through THE policy, not a second copy of it.
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
  // provider wobble can turn an unreadable frame into an acceptance.
  //
  // P7a-1, the early photo: the same principle, one rung wider. Every finding
  // except "there is no person here" becomes a warning on an accepted capture,
  // whatever the provider answered — so a model that refuses a dim bedroom
  // selfie cannot cost the client her booking. `SUBJECT_NOT_VISIBLE` falls
  // through to the normal rejection path below and keeps its retake tip.
  if (
    shot.gate === 'WARN_ONLY' &&
    reasonCode !== 'PASS' &&
    reasonCode !== CONSULT_WARN_ONLY_REJECTING_REASON_CODE
  ) {
    return {
      accepted: true,
      reasonCode: 'PASS',
      warningCode: reasonCode,
      retakeTip: null,
      model,
    }
  }

  // v4: a colour finding never refuses a guided shot, on any framing. Decided
  // HERE and not by the provider, so a model that answers `accepted: false` on
  // a warm frame — the honest reading of the old rule, and of most training
  // data — still lands on an ACCEPTED row carrying the warning.
  if (isColorFinding(reasonCode)) {
    return {
      accepted: true,
      reasonCode: 'PASS',
      warningCode: reasonCode,
      retakeTip: null,
      model,
    }
  }

  // Everything past here is a frame that could not be READ. Treat inconsistent
  // provider output as a rejection, never as permission to analyze.
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
