import 'server-only'
import { createHash } from 'node:crypto'
import { ConsultActorType } from '@prisma/client'
import { readOptionalEnv } from '@/lib/env'
import { appendConsultIntakeRevision } from './writeBoundary'
import { ConsultWriteError } from './errors'
import { loadClientChartFacts } from './chartFacts'
import { buildConsultChartReview } from './chartReview'
import { evaluateConsultIntakeProgress, normalizeConsultIntakePayload } from './intake/registry'

/** Every accepted value is re-derived under the canonical intake/session lock. */
export async function answerConsultChartReview(args: {
  consultSessionId: string; actorUserId: string; fingerprint: string
  decision: 'CONFIRMED' | 'BOX_DYE_ONLY' | 'CHANGED'; idempotencyKey: string
}) {
  if (readOptionalEnv('AI_CONSULT_CHART_PREFILL_ENABLED') !== 'true') throw new ConsultWriteError('NOT_FOUND', 'Consultation unavailable.')
  if (!/^[a-f0-9]{64}$/.test(args.fingerprint)) throw new ConsultWriteError('INVALID_REQUEST', 'Invalid chart review.')
  return appendConsultIntakeRevision({ consultSessionId: args.consultSessionId,
    actor: { type: ConsultActorType.CLIENT, id: args.actorUserId },
    loadInput: async ({ tx, pack, clientId, professionalId, answers: currentAnswers, textAnswers }) => {
      const replay = await tx.consultRevision.findFirst({ where: { consultSessionId: args.consultSessionId, idempotencyKey: args.idempotencyKey },
        include: { chartReview: true } })
      if (replay?.chartReview) {
        if (replay.chartReview.fingerprint !== args.fingerprint || replay.chartReview.decision !== args.decision) {
          throw new ConsultWriteError('IDEMPOTENCY_CONFLICT', 'This request was already used for another review.')
        }
        // Do not revive a source after its deletion/revocation to replay a tap.
        // Canonical replay below returns the already-written revision.
        const stored = normalizeConsultIntakePayload(replay.payload)
        if (!stored) throw new ConsultWriteError('INVALID_STATE', 'Saved chart review unavailable.')
        return { packVersion: stored.packVersion, schemaVersion: stored.schemaVersion, complete: stored.complete,
          answers: stored.answers, textAnswers: stored.textAnswers, idempotencyKey: args.idempotencyKey,
          chartReview: { fingerprint: args.fingerprint, decision: args.decision, sources: [] } }
      }
      const chart = await loadClientChartFacts({ clientId, professionalId, excludeConsultSessionId: args.consultSessionId, tx })
      const review = buildConsultChartReview({ chart, pack, answers: currentAnswers })
      if (!review || review.offer.fingerprint !== args.fingerprint) throw new ConsultWriteError('INVALID_STATE', 'Your chart has changed. Review the current details.')
      const answers = { ...currentAnswers }
      const sources = args.decision === 'CHANGED' ? [] : review.sources.filter(source => args.decision !== 'BOX_DYE_ONLY' || source.key !== 'box_dye_history')
      if (args.decision === 'BOX_DYE_ONLY' && !review.sources.some(source => source.key === 'box_dye_history')) throw new ConsultWriteError('INVALID_REQUEST', 'Box dye is not part of this review.')
      for (const source of sources) {
        if (!answers[source.key]) answers[source.key] = source.value
      }
      // 🔴 A REPLACE write. `textAnswers` is echoed back untouched: a chart
      // confirmation that sent only codes would wipe every note she has typed.
      return { packVersion: pack.version, schemaVersion: pack.schemaVersion,
        complete: evaluateConsultIntakeProgress(pack, answers).canComplete && pack.questions.every(question => question.requirement !== 'SKIPPABLE' || answers[question.key]),
        answers, textAnswers, idempotencyKey: args.idempotencyKey, chartReview: { fingerprint: args.fingerprint,
          decision: args.decision, sources } }
    },
  })
}

/** A dated one-question confirmation records exactly the source the client saw. */
export async function answerConsultChartFact(args: {
  consultSessionId: string; actorUserId: string; sourceId: string; questionKey: string; value: string; idempotencyKey: string
}) {
  if (readOptionalEnv('AI_CONSULT_CHART_PREFILL_ENABLED') !== 'true') throw new ConsultWriteError('NOT_FOUND', 'Consultation unavailable.')
  const fingerprint = createHash('sha256').update(JSON.stringify([args.sourceId, args.questionKey, args.value])).digest('hex')
  return appendConsultIntakeRevision({ consultSessionId: args.consultSessionId,
    actor: { type: ConsultActorType.CLIENT, id: args.actorUserId },
    loadInput: async ({ tx, pack, clientId, professionalId, answers: current, textAnswers }) => {
      const replay = await tx.consultRevision.findFirst({ where: { consultSessionId: args.consultSessionId, idempotencyKey: args.idempotencyKey }, include: { chartReview: true } })
      if (replay?.chartReview) {
        if (replay.chartReview.fingerprint !== fingerprint || replay.chartReview.decision !== 'SINGLE_FACT') throw new ConsultWriteError('IDEMPOTENCY_CONFLICT', 'This confirmation was already used.')
        const stored = normalizeConsultIntakePayload(replay.payload)
        if (!stored) throw new ConsultWriteError('INVALID_STATE', 'Saved confirmation unavailable.')
        return { ...stored, idempotencyKey: args.idempotencyKey, chartReview: { fingerprint, decision: 'SINGLE_FACT', sources: [] } }
      }
      const chart = await loadClientChartFacts({ clientId, professionalId, excludeConsultSessionId: args.consultSessionId, tx })
      const fact = chart.facts.find(item => item.sourceId === args.sourceId && item.key === args.questionKey && item.source === 'CLIENT_ANSWER' && item.state === 'CONFIRM')
      const question = pack.questions.find(item => item.key === args.questionKey)
      if (!fact || !question?.options.some(option => option.value === args.value)) throw new ConsultWriteError('INVALID_STATE', 'Your chart has changed. Review the current question.')
      const answers = { ...current, [args.questionKey]: args.value }
      // 🔴 A REPLACE write — her notes ride along or they are lost.
      return { packVersion: pack.version, schemaVersion: pack.schemaVersion, answers, textAnswers,
        complete: evaluateConsultIntakeProgress(pack, answers).canComplete && pack.questions.every(item => item.requirement !== 'SKIPPABLE' || answers[item.key]),
        idempotencyKey: args.idempotencyKey, chartReview: { fingerprint, decision: 'SINGLE_FACT', sources: args.value === fact.value ? [fact] : [] } }
    } })
}
