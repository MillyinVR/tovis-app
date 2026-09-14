import { ConsultProviderCallKind } from '@prisma/client'
import { readOptionalEnv } from '@/lib/env'
import { analysisModel, requestConsultAnalysisJson } from './analysisEngine'
import { ConsultAnalysisProviderError } from './analysisValidation'
import type { ConsultProviderMeterSink } from './providerMeter'
import { withOneConsultRetry } from './providerRetry'
import {
  buildConsultSuitabilityContext, buildConsultSuitabilityOutputSchema,
  consultSuitabilityProviderContext, sanitizeConsultSuitabilityResponse,
  CONSULT_SUITABILITY_SYSTEM_PROMPT, CONSULT_SUITABILITY_MAX_TOKENS,
  type ConsultSuitabilityContext, type ConsultSuitabilityInput, type ConsultSuitabilityTranslation,
} from './suitabilityTranslation'

export const CONSULT_SUITABILITY_TIMEOUT_MS = 20_000
// Optional work cannot consume the existing route's finalization reserve.
export const CONSULT_SUITABILITY_LATEST_START_MS = 230_000
export type ConsultSuitabilityProvider = (args: {
  context: ConsultSuitabilityContext; meter?: ConsultProviderMeterSink
}) => Promise<{ raw: unknown; model: string }>
export type ConsultSuitabilityResult = { translation: ConsultSuitabilityTranslation; model: string }

/**
 * Same approved model, transport, schema conversion and metering. No retry at
 * THIS layer — `optionalConsultSuitability` owns that, because only it knows
 * the deadline a second attempt has to fit inside.
 */
export const runConsultSuitability: ConsultSuitabilityProvider = async ({ context, meter }) => {
  const model = analysisModel()
  const raw = await requestConsultAnalysisJson({
    model, system: CONSULT_SUITABILITY_SYSTEM_PROMPT,
    content: [{ type: 'text', text: consultSuitabilityProviderContext(context) }],
    schema: buildConsultSuitabilityOutputSchema(context),
    maxTokens: CONSULT_SUITABILITY_MAX_TOKENS, timeoutMs: CONSULT_SUITABILITY_TIMEOUT_MS,
    kind: ConsultProviderCallKind.ANALYSIS_SUITABILITY, meter,
    validate: raw => { sanitizeConsultSuitabilityResponse(raw, context) },
  })
  return { raw, model }
}

export async function optionalConsultSuitability(args: {
  family: string; startedAt: number; input: ConsultSuitabilityInput
  meter?: ConsultProviderMeterSink; provider?: ConsultSuitabilityProvider
}): Promise<ConsultSuitabilityResult | undefined> {
  if (readOptionalEnv('AI_CONSULT_SUITABILITY_ENABLED') !== 'true' || args.family !== 'HAIR') return
  if (Date.now() - args.startedAt >= CONSULT_SUITABILITY_LATEST_START_MS) return
  // No inferred preference: historical/no-goal sessions keep their existing plan.
  if (!args.input.clientChoices.some(choice => choice.sentiment === 'LIKE' || choice.sentiment === 'GOAL')) return
  try {
    const context = buildConsultSuitabilityContext(args.input)
    const provider = args.provider ?? runConsultSuitability
    return await withOneConsultRetry({
      // 🔴 The deadline is re-checked BEFORE the second call, not once at the
      // top: the first attempt has already spent up to CONSULT_SUITABILITY_
      // TIMEOUT_MS by now, and this is optional work that must never eat the
      // route's finalization reserve. Out of room → the first failure stands.
      canStartRetry: () =>
        Date.now() - args.startedAt + CONSULT_SUITABILITY_TIMEOUT_MS <
        CONSULT_SUITABILITY_LATEST_START_MS,
      onRetry: (error) => {
        // Content-free, exactly as the failure log below is.
        console.warn('consult suitability retrying once', {
          kind: error instanceof ConsultAnalysisProviderError ? error.kind : 'unavailable',
          check: error instanceof ConsultAnalysisProviderError ? error.check : null,
        })
      },
      attempt: async () => {
        const { raw, model } = await provider({ context, meter: args.meter })
        if (!model.trim() || model !== model.trim() || model.length > 128) {
          throw new ConsultAnalysisProviderError('bad_output', 'model_name')
        }
        return { translation: sanitizeConsultSuitabilityResponse(raw, context), model }
      },
    })
  } catch (error) {
    // Never log client text, provider output, or arbitrary exception messages.
    console.warn('consult suitability unavailable', {
      kind: error instanceof ConsultAnalysisProviderError ? error.kind : 'unavailable',
      check: error instanceof ConsultAnalysisProviderError ? error.check : null,
    })
    return undefined
  }
}
