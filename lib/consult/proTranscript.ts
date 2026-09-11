import 'server-only'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { isRecord } from '@/lib/guards'
import type { ConsultLookPlanDTO, ConsultProTranscriptDTO, ConsultProTranscriptEventDTO } from '@/lib/dto/consult'
import { consultTranscriptCopy as copy } from '@/lib/brand/consultTranscriptCopy'
import { requireAuthorizedProLookScope } from './lookBrief'
import { ConsultWriteError } from './errors'
import { PRO_TRANSCRIPT_REVISION_SELECT, projectProTranscriptRevisions } from './proTranscriptRevision'
import { projectTranscriptInspiration } from './proTranscriptInspiration'
import { readStoredQuestions, readStoredAnswers } from './followUpContract'
import { readStoredConsultProFollowUpOptions } from './proFollowUp'
import { defaultClientConsultInspirationCopy } from '@/lib/brand/defaultClientConsultInspirationCopy'
import { normalizeStoredConsultInspirationAnalysis } from './inspirationAnalysisRead'
import { CONSULT_INSPIRATION_ANALYSIS_FIELDS } from './inspirationAttributes'
import { consultInspirationAttributeIsCardworthy } from './inspiration/evidence'
import { effectiveConsultLookPlan } from './lookBriefPlan'
import { normalizeStoredConsultAnalysisPayload } from './analysisRevision'

const PAGE_SIZE = 40
const SOURCES = ['REVISION', 'REFERENCE', 'PHOTO', 'FOLLOW_UP', 'PLAN', 'PRO_FOLLOW_UP'] as const
type Source = typeof SOURCES[number]
type IndexRow = Pick<Prisma.ConsultRevisionGetPayload<{ select: typeof PRO_TRANSCRIPT_REVISION_SELECT }>, 'id' | 'createdAt'> & { source: Source }
type Cursor = { id: string; createdAt: string; source: Source }

export function transcriptCursor(value?: string | null): Cursor | null {
  if (!value) return null
  try {
    if (value.length > 512) throw new Error()
    const raw: unknown = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'))
    if (!isRecord(raw) || typeof raw.id !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(raw.id) ||
        typeof raw.createdAt !== 'string' || !Number.isFinite(Date.parse(raw.createdAt)) ||
        new Date(raw.createdAt).toISOString() !== raw.createdAt ||
        !SOURCES.some(source => source === raw.source)) throw new Error()
    const source = SOURCES.find(source => source === raw.source)
    if (!source) throw new Error()
    return { id: raw.id, createdAt: raw.createdAt, source }
  } catch { throw new ConsultWriteError('INVALID_REQUEST', 'Invalid history cursor.') }
}

const words = (value: string) => value.toLowerCase().replaceAll('_', ' ')
const planItems = (plan: ConsultLookPlanDTO) => [{ label: copy.summary, value: plan.summary }, { label: copy.nextStep, value: plan.nextStep },
  ...plan.paths.map(path => ({ label: path.title, value: path.whyThisWorksForYou }))]

/** Shared Brief authorization runs before the bounded event index or payload reads. */
export async function loadProConsultTranscript(args: {
  consultSessionId: string; professionalId: string; actorUserId: string; cursor?: string | null
}): Promise<ConsultProTranscriptDTO> {
  const cursor = transcriptCursor(args.cursor)
  return prisma.$transaction(async tx => {
    const session = await requireAuthorizedProLookScope(tx, args, { readOnly: true })
    const id = session.id
    // Keyset pagination across event tables: only this page's payloads are read.
    // No user-controlled identifiers or SQL fragments enter the statement.
    const index = await tx.$queryRaw<IndexRow[]>(Prisma.sql`
      WITH events AS (
        SELECT id, "createdAt", 'REVISION'::text AS source FROM "ConsultRevision"
          WHERE "consultSessionId" = ${id}
        UNION ALL SELECT id, "createdAt", 'REFERENCE'::text FROM "ConsultInspiration" WHERE "consultSessionId" = ${id}
        UNION ALL SELECT id, "createdAt", 'PHOTO'::text FROM "ConsultCapture" WHERE "consultSessionId" = ${id}
        UNION ALL SELECT id, "createdAt", 'FOLLOW_UP'::text FROM "ConsultFollowUpRound" WHERE "consultSessionId" = ${id}
        UNION ALL SELECT id, "createdAt", 'PLAN'::text FROM "ConsultLookBriefVersion" WHERE "consultSessionId" = ${id}
        UNION ALL SELECT id, "createdAt", 'PRO_FOLLOW_UP'::text FROM "ConsultProFollowUpQuestion" WHERE "consultSessionId" = ${id}
      ) SELECT id, "createdAt", source FROM events
      WHERE ${cursor ? Prisma.sql`("createdAt", source, id) > (${new Date(cursor.createdAt)}, ${cursor.source}, ${cursor.id})` : Prisma.sql`TRUE`}
      ORDER BY "createdAt" ASC, source ASC, id ASC LIMIT ${PAGE_SIZE + 1}
    `)
    const page = index.slice(0, PAGE_SIZE)
    const ids = (source: Source) => page.filter(row => row.source === source).map(row => row.id)
    const [revisions, references, photos, rounds, plans, proQuestions] = await Promise.all([
      tx.consultRevision.findMany({ where: { consultSessionId: id, id: { in: ids('REVISION') } }, select: { ...PRO_TRANSCRIPT_REVISION_SELECT, model: true, promptVersion: true } }),
      tx.consultInspiration.findMany({ where: { consultSessionId: id, id: { in: ids('REFERENCE') } }, select: { id: true, source: true, status: true } }),
      tx.consultCapture.findMany({ where: { consultSessionId: id, id: { in: ids('PHOTO') } }, select: { id: true, shotKey: true, status: true } }),
      tx.consultFollowUpRound.findMany({ where: { consultSessionId: id, id: { in: ids('FOLLOW_UP') } }, select: { id: true, questions: true, answers: true } }),
      tx.consultLookBriefVersion.findMany({ where: { consultSessionId: id, id: { in: ids('PLAN') } }, select: { id: true, version: true, changeSummary: true, professionalPlan: true, invalidatedProfessionalPlan: true,
        sourceAnalysisRevision: { select: { consultSessionId: true, payload: true, schemaVersion: true } } } }),
      tx.consultProFollowUpQuestion.findMany({ where: { consultSessionId: id, id: { in: ids('PRO_FOLLOW_UP') } },
        select: { id: true, priority: true, clientText: true, options: true, selectedValue: true, answeredAt: true } }),
    ])
    const projected = new Map(projectProTranscriptRevisions(id, revisions).map(row => [row.revisionId, row]))
    const events: ConsultProTranscriptEventDTO[] = page.map(row => {
      const event: ConsultProTranscriptEventDTO = { id: `${row.source}:${row.id}`, createdAt: row.createdAt.toISOString(), title: copy.unavailable, items: [], unavailable: false }
      switch (row.source) {
        case 'REVISION': {
          const original = revisions.find(item => item.id === row.id)
          if (original?.kind === 'INSPIRATION_ANALYSIS') {
            event.title = copy.reading
            const reading = normalizeStoredConsultInspirationAnalysis(original)
            if (!reading) { event.unavailable = true; break }
            event.items = CONSULT_INSPIRATION_ANALYSIS_FIELDS.flatMap(field => {
              if (!consultInspirationAttributeIsCardworthy(reading.attributes, field)) return []
              const name = defaultClientConsultInspirationCopy.cards.attributeNames[`${field}:${reading.attributes[field].value}`]
              return name ? [{ label: copy.observation, value: name }] : []
            })
            if (event.items.length === 0) event.unavailable = true
            break
          }
          const revision = projected.get(row.id)
          if (!revision) { event.unavailable = true; break }
          event.title = `${copy[revision.kind === 'INTAKE' ? 'intake' : revision.kind === 'INSPIRATION' ? 'inspiration' : revision.kind === 'ANALYSIS' ? 'analysis' : 'brief']} · ${revision.revision}`
          if (revision.availability === 'UNAVAILABLE') { event.unavailable = true; break }
          if (revision.kind === 'INTAKE') event.items = revision.items.map(item => ({ label: item.question, value: item.answer }))
          if (revision.kind === 'INSPIRATION') {
            if (original) event.items = projectTranscriptInspiration(original.payload)
          }
          if (revision.kind === 'ANALYSIS') {
            try {
              if (!original) throw new Error()
              const plan = normalizeStoredConsultAnalysisPayload(original.payload, original.schemaVersion).lookPlan
              if (plan) event.items = planItems(plan)
            } catch { event.unavailable = true }
          }
          break
        }
        case 'REFERENCE': {
          event.title = copy.reference
          const item = references.find(item => item.id === row.id)
          if (item) event.items = [{ label: copy.source, value: words(item.source) }, { label: copy.status, value: words(item.status) }]
          else event.unavailable = true
          break
        }
        case 'PHOTO': {
          event.title = copy.photo
          const item = photos.find(item => item.id === row.id)
          if (item) event.items = [{ label: words(item.shotKey), value: words(item.status) }]
          else event.unavailable = true
          break
        }
        case 'FOLLOW_UP': {
          event.title = copy.followUp
          const item = rounds.find(item => item.id === row.id)
          if (!item) { event.unavailable = true; break }
          const answers = readStoredAnswers(item.answers)
          const questions = readStoredQuestions(item.questions)
          event.unavailable = questions.length === 0
          event.items = questions.map(question => ({ label: question.text, value: question.home === 'INTAKE'
            ? copy.intakeAnswer : question.options.filter(option => answers[question.key]?.includes(option.value)).map(option => option.label).join(', ') || copy.unanswered }))
          break
        }
        case 'PRO_FOLLOW_UP': {
          // C2-4 — the question the pro asked, in her own client-facing words,
          // and the tapped answer. Time-ordered with everything else so the
          // pro can see what she asked AFTER which plan version.
          event.title = copy.proFollowUp
          const item = proQuestions.find(item => item.id === row.id)
          if (!item) { event.unavailable = true; break }
          const label = readStoredConsultProFollowUpOptions(item.options)
            .find(option => option.value === item.selectedValue)?.label
          event.items = [
            { label: item.clientText, value: label ?? copy.unanswered },
            { label: copy.proFollowUpPriority, value: item.priority === 'NEED_BEFORE_APPOINTMENT' ? copy.proFollowUpNeeded : copy.proFollowUpHelpful },
          ]
          break
        }
        case 'PLAN': {
          const item = plans.find(item => item.id === row.id)
          event.title = `${copy.plan}${item ? ` ${item.version}` : ''}`
          if (item && Array.isArray(item.changeSummary)) event.items = item.changeSummary.filter((value): value is string => typeof value === 'string').map(value => ({ label: copy.change, value }))
          else event.unavailable = true
          if (item) {
            try {
              if (item.sourceAnalysisRevision.consultSessionId !== id) throw new Error()
              const analysis = normalizeStoredConsultAnalysisPayload(item.sourceAnalysisRevision.payload, item.sourceAnalysisRevision.schemaVersion)
              const plan = effectiveConsultLookPlan(analysis, item)
              if (plan) event.items.push(...planItems(plan))
            } catch { event.unavailable = true }
          }
          break
        }
      }
      return event
    })
    const last = page[page.length - 1]
    return { consultId: id, events, historyNote: copy.note,
      nextCursor: index.length > PAGE_SIZE && last ? Buffer.from(JSON.stringify({ id: last.id, createdAt: last.createdAt.toISOString(), source: last.source })).toString('base64url') : null }
  })
}
