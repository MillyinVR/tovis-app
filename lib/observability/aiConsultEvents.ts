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
