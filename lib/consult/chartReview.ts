import 'server-only'
import type { Prisma } from '@prisma/client'
import { normalizeConsultIntakePayload, findConsultIntakePack } from './intake/registry'
import { isRecord } from '@/lib/guards'
import { formatInTimeZone, DEFAULT_TIME_ZONE } from '@/lib/time'
import { defaultClientConsultThreadCopy } from '@/lib/brand/defaultClientConsultThreadCopy'
import { fillConsultThreadCopy } from './threadCopy'
import { createHash } from 'node:crypto'
import type { ConsultChartReviewOfferDTO } from '@/lib/dto/consult'
import type { ConsultIntakePackDefinition } from './intake/types'
import type { ClientChartFact, ClientChartFacts } from './chartFacts'

/** Only a sufficiently complete, current history earns the short review. */
export function buildConsultChartReview(args: {
  chart: ClientChartFacts; pack: ConsultIntakePackDefinition; answers: Readonly<Record<string, string>>
}): { offer: ConsultChartReviewOfferDTO; sources: ClientChartFact[] } | null {
  const { chart, pack, answers } = args
  if (!chart.available || chart.completedVisits < 2 || !chart.lastVisitAt) return null
  const keys = ['box_dye_history', 'henna_plant_dye_history', 'other_chemical_history', 'chemical_history', 'prior_lightening']
  const questions = pack.questions.filter(question => keys.includes(question.key) && !answers[question.key])
  if (questions.length < 2) return null
  const sources = questions.flatMap(question => {
    const fact = chart.facts.find(item => item.key === question.key && item.source === 'CLIENT_ANSWER' && item.state === 'CONFIRM' &&
      question.options.some(option => option.value === item.value))
    return fact ? [fact] : []
  })
  // A missing/expired fact is a question, never a guessed clean history.
  if (sources.length !== questions.length) return null
  const facts = sources.map(source => {
    const question = questions.find(question => question.key === source.key)!
    return { questionKey: source.key, label: question.label, value: source.value,
      answer: question.options.find(option => option.value === source.value)!.label, recordedAt: source.recordedAt }
  })
  const fingerprint = createHash('sha256').update(JSON.stringify({ lastVisitAt: chart.lastVisitAt, sources })).digest('hex')
  return { offer: { fingerprint, lastVisitAt: chart.lastVisitAt, facts }, sources }
}

/** Metadata follows the intake used by this analysis, never a later edit. */
export async function loadConsultChartSources(tx: Prisma.TransactionClient,
  consultSessionId: string, analysisRevision: number): Promise<import('@/lib/dto/consult').ConsultChartSourceDTO[]> {
  const intake = await tx.consultRevision.findFirst({ where: { consultSessionId, kind: 'INTAKE', revision: { lt: analysisRevision } },
    orderBy: { revision: 'desc' }, select: { revision: true, payload: true } })
  if (!intake) return []
  const payload = normalizeConsultIntakePayload(intake.payload)
  const pack = payload ? findConsultIntakePack(payload.packId, payload.packVersion) : null
  if (!payload || !pack) return []
  const reviews = await tx.consultChartReview.findMany({ where: { consultSessionId, decision: { in: ['CONFIRMED', 'BOX_DYE_ONLY', 'SINGLE_FACT'] },
    intakeRevision: { revision: { lte: intake.revision } } }, orderBy: { createdAt: 'desc' }, select: { facts: true, createdAt: true } })
  const seen = new Set<string>()
  return reviews.flatMap(review => (Array.isArray(review.facts) ? review.facts : []).flatMap(fact => {
    if (!isRecord(fact) || typeof fact.key !== 'string' || typeof fact.value !== 'string' ||
      typeof fact.recordedAt !== 'string' || !Number.isFinite(new Date(fact.recordedAt).getTime()) || payload.answers[fact.key] !== fact.value) return []
    if (seen.has(fact.key)) return []
    seen.add(fact.key)
    const question = pack.questions.find(question => question.key === fact.key)
    const option = question?.options.find(option => option.value === fact.value)
    if (!question || !option) return []
    return [{ questionKey: fact.key, recordedAt: fact.recordedAt, confirmedAt: review.createdAt.toISOString(),
      summary: fillConsultThreadCopy(defaultClientConsultThreadCopy.chartReviewUsed, {
        date: formatInTimeZone(fact.recordedAt, DEFAULT_TIME_ZONE, { month: 'long', day: 'numeric', year: 'numeric' }),
        answer: `${question.label} ${option.label}`,
      }) }]
  }))
}

export async function loadConsultChartPhotoSources(tx: Prisma.TransactionClient, revisionId: string) {
  const rows = await tx.consultAnalysisChartPhoto.findMany({ where: { revisionId }, select: {
    photoUse: { select: { captureId: true, sourceRecordedAt: true, createdAt: true } },
  } })
  return rows.map(({ photoUse }) => ({ questionKey: `chart_photo:${photoUse.captureId}`,
    recordedAt: photoUse.sourceRecordedAt.toISOString(), confirmedAt: photoUse.createdAt.toISOString(),
    summary: fillConsultThreadCopy(defaultClientConsultThreadCopy.chartPhotoUsed, {
      date: formatInTimeZone(photoUse.sourceRecordedAt, DEFAULT_TIME_ZONE, { month: 'long', day: 'numeric', year: 'numeric' }),
    }) }))
}
