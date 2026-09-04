import { createHash } from 'node:crypto'

const APP_NAME = 'tovis-app'
const NAMESPACE = 'ai_consult'

type AiConsultResultsServeEvent = {
  metric: 'CLIENT_RESULTS'
  consultId: string
  clientId: string
  firstServe: boolean
  acceptedPhotoCount: number
  retakeCount: number
  bookingAttributed: boolean
}

type AiConsultTeaserTapServeEvent = {
  metric: 'ME_CARD_TEASER_TAP'
  consultId: string
  clientId: string
  firstTap: true
}

export type AiConsultServeEvent =
  | AiConsultResultsServeEvent
  | AiConsultTeaserTapServeEvent

function hashMetricId(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 16)
}

/**
 * Privacy boundary for C7 measurement. Callers may pass opaque database ids;
 * the structured line exposes only hashes and bounded product facts. Intake,
 * model output, recommendations, safety content, raw-media references, paths,
 * and client traits have no fields in this contract.
 */
export function logAiConsultServe(input: AiConsultServeEvent): void {
  const common = {
    ts: new Date().toISOString(),
    app: APP_NAME,
    namespace: NAMESPACE,
    level: 'info',
    event: 'ai_consult_serve',
    metric: input.metric,
    consultHash: hashMetricId(input.consultId),
    clientHash: hashMetricId(input.clientId),
  }
  const line =
    input.metric === 'CLIENT_RESULTS'
      ? {
          ...common,
          firstServe: input.firstServe,
          completed: true,
          acceptedPhotoCount: input.acceptedPhotoCount,
          retakeCount: input.retakeCount,
          bookingAttributed: input.bookingAttributed,
        }
      : { ...common, firstTap: input.firstTap, teaserLocked: true }

  console.info(JSON.stringify(line))
}

/**
 * P4 telemetry: one line per attempt to read a client's inspiration
 * reference. Part 0 rule 4 requires a failure to be visible, and a surfaced
 * error the client sees is only half of that — this is the half the operator
 * sees.
 *
 * Same privacy boundary as the serve event above: hashed ids, bounded product
 * facts, and NOTHING the model observed. The attribute VALUES never appear
 * here — only how many of the seven the photograph answered, which is the
 * number that says whether the pipeline is working.
 */
export type AiConsultInspirationAnalysisEvent = {
  consultId: string
  clientId: string
  source: 'PLATFORM_LOOK' | 'BOOKED_PRO_LOOK' | 'EXTERNAL_UPLOAD'
  outcome: 'OK' | 'UNAVAILABLE' | 'REFUSED' | 'BAD_OUTPUT' | 'UNREADABLE'
  /** 0–7 on success; null when the call never produced a result. */
  knownAttributeCount: number | null
  model: string | null
  durationMs: number
}

export function logAiConsultInspirationAnalysis(
  input: AiConsultInspirationAnalysisEvent,
): void {
  console.info(
    JSON.stringify({
      ts: new Date().toISOString(),
      app: APP_NAME,
      namespace: NAMESPACE,
      level: input.outcome === 'OK' ? 'info' : 'warn',
      event: 'ai_consult_inspiration_analysis',
      consultHash: hashMetricId(input.consultId),
      clientHash: hashMetricId(input.clientId),
      source: input.source,
      outcome: input.outcome,
      knownAttributeCount: input.knownAttributeCount,
      model: input.model,
      durationMs: input.durationMs,
    }),
  )
}
