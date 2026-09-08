import 'server-only'

import { Prisma } from '@prisma/client'
import { assertProCanViewClient, proClientVisibilityWhere } from '@/lib/clientVisibility'
import { chartPhotoWhere } from '@/lib/clients/chartPhotoQuery'
import { addElapsedDays } from '@/lib/time'
import { readEncryptedNoteOrFallback } from '@/lib/security/notesPrivacy'
import { prisma } from '@/lib/prisma'
import { normalizeStoredConsultAnalysisPayload } from './analysisRevision'
import { normalizeConsultIntakePayload } from './intake/registry'
import { canonicalConsultHistoryAnswers } from './lookHistory'
import { HAIR_COLOR_INTAKE_PACK } from './intake/packs/hairColor'
import { HAIR_GENERAL_INTAKE_PACK } from './intake/packs/hairGeneral'

export type ClientChartFact = {
  key: string
  value: string
  source: 'CLIENT_ANSWER' | 'PRE_VISIT_OBSERVATION' | 'COMPLETED_SERVICE' | 'PUBLISHED_PRODUCT' | 'RECORDED_ALLERGY'
  sourceId: string
  consultSessionId: string | null
  bookingId: string | null
  professionalId: string | null
  recordedAt: string
  validUntil: string | null
  /** A candidate is never an answer until this client confirms it. */
  state: 'CONFIRM' | 'REASK'
}

export type ClientChartFacts = {
  available: boolean
  completedVisits: number
  lastVisitAt: string | null
  facts: ClientChartFact[]
  photos: Array<{ mediaAssetId: string; bookingId: string; recordedAt: string; validUntil: string; phase: string }>
}

const DAY_MS = 86_400_000
export const CONSULT_CHART_PHOTO_DAYS = 70
const HISTORY_KEYS = new Set(['box_dye_history', 'henna_plant_dye_history', 'other_chemical_history',
  'chemical_history', 'prior_lightening', 'prior_reaction'])

/** No goal, budget, deadline or maintenance preference is silently carried to a new look. */
export function chartAnswerValidity(key: string, value: string, recordedAt: Date, now: Date): {
  validUntil: string | null; state: 'CONFIRM' | 'REASK'
} {
  const validUntil = key === 'prior_reaction' && value === 'yes' ? null : addElapsedDays(recordedAt, 365).toISOString()
  // Relative timing buckets cannot simply be copied forward: an old "within
  // six months" can now straddle two options. Keep its date, and ask again.
  const stableValue = value === 'never' || (key === 'prior_reaction' && value === 'yes')
  return { validUntil, state: stableValue && recordedAt <= now &&
    (validUntil === null || now.getTime() < new Date(validUntil).getTime()) ? 'CONFIRM' : 'REASK' }
}

const REVISION_SELECT = { id: true, consultSessionId: true, createdAt: true, payload: true, schemaVersion: true } satisfies Prisma.ConsultRevisionSelect
const SESSION_SELECT = {
  id: true, status: true,
  followUpRounds: { orderBy: { createdAt: 'desc' as const }, take: 20, select: { id: true, createdAt: true, answeredAt: true, answers: true } },
  revisions: { where: { kind: 'INTAKE' as const }, orderBy: { revision: 'desc' as const }, take: 1, select: REVISION_SELECT },
  lookBriefVersions: { orderBy: { version: 'desc' as const }, take: 1, select: {
    id: true, createdAt: true, additionalClientAnswers: true,
    sourceAnalysisRevision: { select: REVISION_SELECT },
  } },
} satisfies Prisma.ConsultSessionSelect
const VISIT_SELECT = {
  id: true, professionalId: true, scheduledFor: true, finishedAt: true,
  serviceItems: { select: { id: true, service: { select: { name: true } } } },
  service: { select: { name: true } },
  consultSession: { select: SESSION_SELECT }, sourceConsultSession: { select: SESSION_SELECT },
  aftercareSummary: { select: { id: true, sentToClientAt: true, recommendedProducts: {
    select: { id: true, externalName: true, product: { select: { name: true } } },
  } } },
} satisfies Prisma.BookingSelect

type ChartVisit = Prisma.BookingGetPayload<{ select: typeof VISIT_SELECT }>

/** Projection stays source-bound. A requested result is never a delivered result. */
export function projectClientChartVisitFacts(visits: readonly ChartVisit[], now: Date): ClientChartFact[] {
  const facts: ClientChartFact[] = []
  for (const visit of visits) {
    const completedAt = visit.finishedAt ?? visit.scheduledFor
    const candidate = visit.consultSession ?? visit.sourceConsultSession
    const session = candidate?.status === 'CANCELLED' ? null : candidate
    const source = { bookingId: visit.id, professionalId: visit.professionalId, consultSessionId: session?.id ?? null }
    const intake = session?.revisions[0]
    const payload = intake ? normalizeConsultIntakePayload(intake.payload) : null
    if (intake && payload && intake.createdAt <= completedAt) {
      for (const [key, value] of Object.entries(payload.answers)) {
        if (!HISTORY_KEYS.has(key)) continue
        facts.push({ ...source, key, value, source: 'CLIENT_ANSWER', sourceId: intake.id,
          recordedAt: intake.createdAt.toISOString(), ...chartAnswerValidity(key, value, intake.createdAt, now) })
      }
    }
    for (const round of session?.followUpRounds ?? []) {
      const definitions = [...HAIR_COLOR_INTAKE_PACK.questions, ...HAIR_GENERAL_INTAKE_PACK.questions]
      for (const [key, value] of Object.entries(canonicalConsultHistoryAnswers(round.answers, definitions))) {
        if (!HISTORY_KEYS.has(key)) continue
        const recordedAt = round.answeredAt ?? round.createdAt
        if (recordedAt > completedAt) continue
        facts.push({ ...source, key, value, source: 'CLIENT_ANSWER', sourceId: round.id,
          recordedAt: recordedAt.toISOString(), ...chartAnswerValidity(key, value, recordedAt, now) })
      }
    }
    const brief = session?.lookBriefVersions[0]
    if (brief && brief.sourceAnalysisRevision.createdAt <= completedAt) {
      const revision = brief.sourceAnalysisRevision
      const analysis = normalizeStoredConsultAnalysisPayload(revision.payload, revision.schemaVersion)
      for (const key of ['baseLevel', 'lightestLevel', 'currentTone'] as const) {
        const observation = analysis.core[key]
        // Retain UNKNOWN too: a newer uncertain reading cannot revive an older
        // confident one. These are pre-visit observations, always re-asked.
        const expiry = Math.min(addElapsedDays(revision.createdAt, 70).getTime(), completedAt.getTime())
        facts.push({ ...source, key, value: observation.value, source: 'PRE_VISIT_OBSERVATION', sourceId: revision.id,
          recordedAt: revision.createdAt.toISOString(), validUntil: new Date(expiry).toISOString(), state: 'REASK' })
      }
    }
    const services = visit.serviceItems.length ? visit.serviceItems.map(item => ({ id: item.id, name: item.service.name })) : [{ id: visit.id, name: visit.service.name }]
    for (const service of services) facts.push({ ...source, key: 'completed_service', value: service.name,
      source: 'COMPLETED_SERVICE', sourceId: service.id, recordedAt: completedAt.toISOString(), validUntil: null, state: 'REASK' })
    const care = visit.aftercareSummary
    if (care?.sentToClientAt) for (const item of care.recommendedProducts) {
      const name = item.product?.name ?? item.externalName
      if (name) facts.push({ ...source, key: 'recommended_product', value: name, source: 'PUBLISHED_PRODUCT',
        sourceId: item.id, recordedAt: care.sentToClientAt.toISOString(), validUntil: null, state: 'REASK' })
    }
  }
  // Latest client report wins even when uncertain. Never resurrect an old
  // "never" after a newer "not sure" or an expired positive history.
  const latest = new Map<string, ClientChartFact>()
  for (const fact of facts.sort((a, b) => b.recordedAt.localeCompare(a.recordedAt) || b.sourceId.localeCompare(a.sourceId))) {
    const key = ['CLIENT_ANSWER', 'PRE_VISIT_OBSERVATION'].includes(fact.source) ? fact.key : `${fact.key}:${fact.sourceId}`
    if (!latest.has(key)) latest.set(key, fact)
  }
  return [...latest.values()]
}

/** Called for the current consult's known client/pro pair, never unscoped IDs from a model. */
export async function loadClientChartFacts(args: {
  clientId: string; professionalId: string; excludeConsultSessionId: string; now?: Date; tx?: Prisma.TransactionClient
}): Promise<ClientChartFacts> {
  const empty: ClientChartFacts = { available: false, completedVisits: 0, lastVisitAt: null, facts: [], photos: [] }
  const gate = await assertProCanViewClient(args.professionalId, args.clientId)
  if (!gate.ok) return empty
  const now = args.now ?? new Date()
  const read = async (tx: Prisma.TransactionClient): Promise<ClientChartFacts> => {
    await tx.$queryRaw(Prisma.sql`SELECT "clientId" FROM "ClientChartShare"
      WHERE "clientId" = ${args.clientId} AND "professionalId" = ${args.professionalId} FOR SHARE`)
    const share = await tx.clientChartShare.findUnique({ where: { clientId_professionalId: {
      clientId: args.clientId, professionalId: args.professionalId,
    } }, select: { status: true } })
    if (share?.status !== 'GRANTED' && !(await tx.booking.findFirst({ where: {
      clientId: args.clientId, professionalId: args.professionalId, ...proClientVisibilityWhere(now),
    }, select: { id: true } }))) return empty
    const visits = await tx.booking.findMany({ where: {
      clientId: args.clientId, status: 'COMPLETED',
      ...(share?.status === 'GRANTED' ? {} : { professionalId: args.professionalId }),
      service: { category: { consultFamily: 'HAIR' } },
      AND: [{ OR: [{ finishedAt: { lte: now } }, { finishedAt: null, scheduledFor: { lte: now } }] },
        { OR: [{ sourceConsultSessionId: null }, { sourceConsultSessionId: { not: args.excludeConsultSessionId } }] },
        { OR: [{ consultSession: null }, { consultSession: { id: { not: args.excludeConsultSessionId } } }] }],
    }, select: VISIT_SELECT, orderBy: [{ scheduledFor: 'desc' }, { id: 'desc' }], take: 20 })
    const photos = visits.length ? await tx.mediaAsset.findMany({ where: {
      AND: [chartPhotoWhere({ clientId: args.clientId, proId: args.professionalId }),
        { bookingId: { in: visits.map(visit => visit.id) }, createdAt: { gt: new Date(now.getTime() - CONSULT_CHART_PHOTO_DAYS * DAY_MS), lte: now } }],
    }, select: { id: true, bookingId: true, createdAt: true, phase: true, storagePath: true }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 12 }) : []
    const allergies = await tx.clientAllergy.findMany({ where: { clientId: args.clientId, createdAt: { lte: now },
      ...(share?.status === 'GRANTED' ? {} : { recordedByProfessionalId: args.professionalId }),
    }, orderBy: { createdAt: 'desc' }, take: 50,
    select: { id: true, label: true, labelEncrypted: true, createdAt: true, recordedByProfessionalId: true } })
    const allergyFacts: ClientChartFact[] = allergies.flatMap(allergy => {
      const label = readEncryptedNoteOrFallback(allergy.labelEncrypted, allergy.label)
      return label ? [{ key: 'recorded_allergy', value: label, source: 'RECORDED_ALLERGY', sourceId: allergy.id,
        consultSessionId: null, bookingId: null, professionalId: allergy.recordedByProfessionalId,
        recordedAt: allergy.createdAt.toISOString(), validUntil: null, state: 'REASK' }] : []
    })
    // Durable copies retain the original capture's date. The time a booking
    // copied an image into the chart must never restart its freshness window.
    const captureIds = new Map(photos.flatMap(photo => {
      const match = /^consult-chart\/v1\/[^/]+\/[^/-]+-([^/.]+)\.(?:jpg|png|webp)$/.exec(photo.storagePath)
      return match?.[1] ? [[photo.id, match[1]] as const] : []
    }))
    const captures = captureIds.size ? await tx.consultCapture.findMany({ where: { id: { in: [...captureIds.values()] },
      consultSession: { clientId: args.clientId, professionalId: args.professionalId } }, select: { id: true, createdAt: true } }) : []
    const captureDates = new Map(captures.map(capture => [capture.id, capture.createdAt]))
    const visitDates = new Map(visits.map(visit => [visit.id, visit.finishedAt ?? visit.scheduledFor]))
    return { available: true, completedVisits: visits.length,
      lastVisitAt: visits.length ? new Date(Math.max(...visits.map(visit => (visit.finishedAt ?? visit.scheduledFor).getTime()))).toISOString() : null,
      facts: [...projectClientChartVisitFacts(visits, now), ...allergyFacts],
      photos: photos.flatMap(photo => {
        const visitDate = photo.bookingId ? visitDates.get(photo.bookingId) : null
        if (!photo.bookingId || !visitDate) return []
        // Upload time does not make an old visit photo fresh again.
        const captureId = captureIds.get(photo.id)
        const captureDate = captureId ? captureDates.get(captureId) : null
        if (captureId && !captureDate) return []
        const recordedAt = new Date(Math.min(photo.createdAt.getTime(), visitDate.getTime(), captureDate?.getTime() ?? Infinity))
        const validUntil = addElapsedDays(recordedAt, CONSULT_CHART_PHOTO_DAYS)
        return validUntil <= now ? [] : [{ mediaAssetId: photo.id, bookingId: photo.bookingId,
          recordedAt: recordedAt.toISOString(), validUntil: validUntil.toISOString(), phase: photo.phase }]
      }),
    }
  }
  return args.tx ? read(args.tx) : prisma.$transaction(read, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead })
}

