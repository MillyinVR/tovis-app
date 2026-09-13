import { loadConsultChartSources, loadConsultChartPhotoSources } from './chartReview'
import { describeLookRefinement } from './lookRefinementDiff'
import { consultLookConfirmationOpen } from './lookConfirmation'
import { loadConsultLookCompletedVisit } from './lookVisitOutcome'
import { describeLookEstimateChanges, describeLookExpectationChanges } from './lookBriefDiff'
import { effectiveConsultLookPlan } from './lookBriefPlan'
import { consultLookHistoryStoredItems, loadConsultLookHistory, parseConsultLookHistoryItems } from './lookHistory'
import { notifyConsultLookBriefVersion } from '@/lib/notifications/consultLookBrief'
import { isDeepStrictEqual } from 'node:util'
import { readStoredLookAdjustments, parseConsultLookAdjustments, assertLookAdjustmentTargets, lookAdjustmentKey, type ConsultLookAdjustment } from './lookAdjustments'
import 'server-only'

import { ConsultActorType, Prisma, ServiceLocationType } from '@prisma/client'
import type { ConsultLookBriefVersionDTO, ConsultLookPlanDTO } from '@/lib/dto/consult'
import { prisma } from '@/lib/prisma'
import { resolveBookingLocationContext } from '@/lib/booking/locationContext'
import { normalizeStoredConsultAnalysisPayload } from './analysisRevision'
import { ConsultWriteError } from './errors'
import { estimateConsultLookPaths, normalizeConsultLookPathEstimates } from './lookPathEstimate'
import { loadConsultProMenu } from './proMenu'
import { requireAuthorizedProposalScope } from './proposalEntry'
import { assertConsultInputOpen, resolveConsultInputWindow, CONSULT_OPEN_WINDOW_SELECT, consultLinkedBooking } from './openWindow'
import { CONSULT_ANCHOR_SELECT, evaluateConsultAnchorScope } from './anchor'
import { requireCurrentConsultAgreementAcceptances } from './agreementContract'
import { isAiConsultC6ExposureEnabledForPro } from './access'
import { writeLookServiceEstimate } from './writeBoundary'

/** Callers hold the session lock. A new version never inherits confirmations. */
export async function appendLockedConsultLookBriefVersion(tx: Prisma.TransactionClient, args: {
  consultSessionId: string
  analysisRevisionId: string
  actorType: ConsultActorType
  actorId: string | null
  idempotencyKey: string
  selectedPathIndex?: number
  selectedLocationType?: ServiceLocationType
  adjustments?: ConsultLookAdjustment[]
  professionalPlan?: ConsultLookPlanDTO
  professionalPlanReason?: string
}) {
  const existing = await tx.consultLookBriefVersion.findUnique({
    where: { consultSessionId_idempotencyKey: { consultSessionId: args.consultSessionId, idempotencyKey: args.idempotencyKey } },
  })
  if (existing) {
    if (existing.sourceAnalysisRevisionId !== args.analysisRevisionId || existing.createdByActorId !== args.actorId ||
      existing.selectedPathIndex !== (args.selectedPathIndex ?? null) || existing.selectedLocationType !== (args.selectedLocationType ?? null)) {
      throw new ConsultWriteError('IDEMPOTENCY_CONFLICT', 'This request was already used for a different look.')
    }
    return existing
  }
  const session = await tx.consultSession.findUniqueOrThrow({ where: { id: args.consultSessionId },
    select: { professionalId: true, serviceCategoryId: true } })
  const source = await tx.consultRevision.findFirst({
    where: { consultSessionId: args.consultSessionId, kind: 'ANALYSIS' }, orderBy: { revision: 'desc' },
    select: { id: true, payload: true, schemaVersion: true },
  })
  if (!source || source.id !== args.analysisRevisionId) throw new ConsultWriteError('ANALYSIS_SUPERSEDED', 'Your look has changed. Review the current plan.')
  const analysis = normalizeStoredConsultAnalysisPayload(source.payload, source.schemaVersion)
  const previous = await tx.consultLookBriefVersion.findFirst({ where: { consultSessionId: args.consultSessionId }, orderBy: { version: 'desc' } })
  const sameAnalysis = previous?.sourceAnalysisRevisionId === source.id
  const professionalPlan = args.professionalPlan ?? (sameAnalysis ? previous?.professionalPlan : null)
  const invalidatedProfessionalPlan = args.professionalPlan ? null :
    (!sameAnalysis && previous?.professionalPlan ? previous.professionalPlan : previous?.invalidatedProfessionalPlan)
  const professionalPlanReason = args.professionalPlanReason ?? (professionalPlan ? previous?.professionalPlanReason : null)
  const plan = effectiveConsultLookPlan(analysis, { professionalPlan, invalidatedProfessionalPlan })
  if (!plan) throw new ConsultWriteError('INVALID_STATE', 'This consultation has no look plan.')
  if (args.selectedPathIndex !== undefined && (!plan.choosable ||
    !Number.isInteger(args.selectedPathIndex) || args.selectedPathIndex < 0 || !plan.paths[args.selectedPathIndex] || !args.selectedLocationType)) {
    throw new ConsultWriteError('INVALID_STATE', 'Confirm the remaining details before choosing this look.')
  }
  let inherited = readStoredLookAdjustments(previous?.adjustments ?? {})
  let invalidated = parseConsultLookAdjustments(previous?.invalidatedAdjustments ?? [])
  if (previous && previous.sourceAnalysisRevisionId !== source.id) {
    const priorSource = await tx.consultRevision.findUniqueOrThrow({ where: { id: previous.sourceAnalysisRevisionId } })
    const prior = normalizeStoredConsultAnalysisPayload(priorSource.payload, priorSource.schemaVersion)
    const unchanged = isDeepStrictEqual(prior.core, analysis.core) && isDeepStrictEqual(prior.serviceLens, analysis.serviceLens) &&
      isDeepStrictEqual(prior.lookPlan?.paths, plan.paths)
    if (!unchanged) { invalidated = [...new Map([...invalidated, ...inherited].map(entry => [lookAdjustmentKey(entry), entry])).values()]; inherited = [] }
  }
  if (invalidatedProfessionalPlan && !professionalPlan) {
    invalidated = [...new Map([...invalidated, ...inherited].map(entry => [lookAdjustmentKey(entry), entry])).values()]
    inherited = []
  }
  if (args.professionalPlan) invalidated = []
  const adjustments = args.adjustments ?? inherited
  assertLookAdjustmentTargets(plan, adjustments)
  if (args.adjustments) invalidated = invalidated.filter(entry => !args.adjustments?.some(next => lookAdjustmentKey(next) === lookAdjustmentKey(entry)))
  const menu = await loadConsultProMenu(tx, { professionalId: session.professionalId, serviceCategoryId: session.serviceCategoryId, menuScope: 'HAIR_FAMILY' })
  const pathEstimates = []
  for (const locationType of [ServiceLocationType.SALON, ServiceLocationType.MOBILE]) {
    if (!menu.offerings.some(offering => locationType === 'SALON' ? offering.offersInSalon : offering.offersMobile)) continue
    const location = await resolveBookingLocationContext({ tx, professionalId: session.professionalId, locationType,
      requireValidTimeZone: false, fallbackTimeZone: 'UTC' })
    pathEstimates.push(...estimateConsultLookPaths({ plan, menu: menu.offerings, locationType,
      stepMinutes: location.ok ? location.context.stepMinutes : null, adjustments }))
  }
  if (args.selectedPathIndex !== undefined && !pathEstimates.some(estimate => estimate.pathIndex === args.selectedPathIndex &&
    estimate.locationType === args.selectedLocationType && estimate.visits.every(visit => visit.steps.every(step => step.available)))) {
    throw new ConsultWriteError('INVALID_STATE', 'This look is not available in that appointment location.')
  }
  const clientHistory = await loadConsultLookHistory(tx, args.consultSessionId)
  const created = await tx.consultLookBriefVersion.create({ data: {
    professionalPlan: professionalPlan ?? Prisma.DbNull,
    professionalPlanReason: professionalPlanReason ?? null,
    invalidatedProfessionalPlan: invalidatedProfessionalPlan ?? Prisma.DbNull,
    additionalClientAnswers: consultLookHistoryStoredItems(clientHistory.items),
    consultSessionId: args.consultSessionId, sourceAnalysisRevisionId: source.id, version: (previous?.version ?? 0) + 1,
    selectedPathIndex: args.selectedPathIndex ?? null, selectedLocationType: args.selectedLocationType ?? null,
    pathEstimates, adjustments: { entries: adjustments }, invalidatedAdjustments: invalidated, createdByActorType: args.actorType, createdByActorId: args.actorId,
    idempotencyKey: args.idempotencyKey,
    changeSummary: [args.professionalPlan ? 'Your pro reviewed your details and authored this plan. Review it before choosing and confirming.' : args.adjustments ? 'Your pro adjusted this version. Review the updated plan before confirming.' : args.selectedPathIndex === undefined ? 'Your look plan was updated.' : 'You chose a direction for your look.', ...describeLookExpectationChanges(readStoredLookAdjustments(previous?.adjustments ?? {}), adjustments), ...describeLookEstimateChanges(previous ? normalizeConsultLookPathEstimates(previous.pathEstimates) : [], pathEstimates), ...(invalidated.length ? ['Previous professional adjustments need a new review because the plan changed.'] : [])],
  } })
  await notifyConsultLookBriefVersion(tx, created)
  return created
}

/** Authorized result readers call this inside their existing transaction. */
export async function loadConsultLookBriefVersion(tx: Prisma.TransactionClient, consultSessionId: string): Promise<ConsultLookBriefVersionDTO | undefined> {
  const row = await tx.consultLookBriefVersion.findFirst({ where: { consultSessionId }, orderBy: { version: 'desc' } })
  if (!row) return undefined
  const session = await tx.consultSession.findUniqueOrThrow({ where: { id: consultSessionId }, select: CONSULT_OPEN_WINDOW_SELECT })
  const booking = consultLinkedBooking(session)
  const source = await tx.consultRevision.findUniqueOrThrow({ where: { id: row.sourceAnalysisRevisionId } })
  const analysis = normalizeStoredConsultAnalysisPayload(source.payload, source.schemaVersion)
  return {
    chartSources: [...await loadConsultChartSources(tx, consultSessionId, source.revision), ...await loadConsultChartPhotoSources(tx, source.id)],
    completedVisit: await loadConsultLookCompletedVisit(tx, consultSessionId),
    professionalPlan: row.professionalPlan ? effectiveConsultLookPlan(analysis, row) ?? null : null,
    professionalPlanReason: row.professionalPlanReason,
    invalidatedProfessionalPlan: row.invalidatedProfessionalPlan !== null,
    inputOpen: resolveConsultInputWindow(session).open,
    confirmationOpen: await consultLookConfirmationOpen(tx, session),
    bookingId: booking?.id ?? null,
    additionalClientAnswers: parseConsultLookHistoryItems(row.additionalClientAnswers),
    adjustments: readStoredLookAdjustments(row.adjustments), invalidatedAdjustments: parseConsultLookAdjustments(row.invalidatedAdjustments),
    awaitingAnalysis: row.awaitingAnalysis, changes: Array.isArray(row.changeSummary) ? row.changeSummary.filter((entry): entry is string => typeof entry === 'string') : [],
    id: row.id, version: row.version, sourceAnalysisRevisionId: row.sourceAnalysisRevisionId,
    selectedPathIndex: row.selectedPathIndex, selectedLocationType: row.selectedLocationType,
    clientConfirmed: row.clientAcknowledgedAt !== null, professionalConfirmed: row.professionalAcknowledgedAt !== null,
    pathEstimates: normalizeConsultLookPathEstimates(row.pathEstimates),
    reservedDurationMinutes: booking && booking.status !== 'CANCELLED' && booking.status !== 'NO_SHOW' ? booking.totalDurationMinutes : null,
  }
}

export async function chooseClientConsultLookPath(args: {
  consultSessionId: string; clientId: string; actorUserId: string
  expectedVersion: number; pathIndex: number; locationType: ServiceLocationType; idempotencyKey: string
}) {
  if (!Number.isInteger(args.expectedVersion) || args.expectedVersion < 1 || !Number.isInteger(args.pathIndex) || args.pathIndex < 0 ||
    args.pathIndex > 2 || !args.idempotencyKey.trim() || args.idempotencyKey.length > 128) {
    throw new ConsultWriteError('INVALID_REQUEST', 'Invalid look choice.')
  }
  return prisma.$transaction(async tx => {
    await requireAuthorizedProposalScope(tx, { ...args, readOnly: true })
    const session = await tx.consultSession.findUniqueOrThrow({ where: { id: args.consultSessionId }, select: CONSULT_OPEN_WINDOW_SELECT })
    if (!(await consultLookConfirmationOpen(tx, session))) assertConsultInputOpen(session)
    const previous = await tx.consultLookBriefVersion.findFirst({ where: { consultSessionId: args.consultSessionId }, orderBy: { version: 'desc' } })
    const replay = await tx.consultLookBriefVersion.findUnique({
      where: { consultSessionId_idempotencyKey: { consultSessionId: args.consultSessionId, idempotencyKey: args.idempotencyKey } },
    })
    if (replay) {
      if (replay.version !== args.expectedVersion + 1 || replay.createdByActorId !== args.actorUserId ||
        replay.selectedPathIndex !== args.pathIndex || replay.selectedLocationType !== args.locationType) {
        throw new ConsultWriteError('IDEMPOTENCY_CONFLICT', 'This request was already used for a different look.')
      }
      return loadConsultLookBriefVersion(tx, args.consultSessionId)
    }
    if (!previous || previous.awaitingAnalysis || previous.invalidatedProfessionalPlan !== null || parseConsultLookAdjustments(previous.invalidatedAdjustments).length > 0 || previous.version !== args.expectedVersion) throw new ConsultWriteError('ANALYSIS_SUPERSEDED', 'Your look has changed. Review the current version.')
    const version = await appendLockedConsultLookBriefVersion(tx, {
      consultSessionId: args.consultSessionId, analysisRevisionId: previous.sourceAnalysisRevisionId,
      actorType: ConsultActorType.CLIENT, actorId: args.actorUserId, idempotencyKey: args.idempotencyKey,
      selectedPathIndex: args.pathIndex, selectedLocationType: args.locationType,
    })
    const source = await tx.consultRevision.findUniqueOrThrow({ where: { id: version.sourceAnalysisRevisionId } })
    await writeLookServiceEstimate(tx, { consultSessionId: args.consultSessionId, analysisRevisionId: source.id,
      analysis: normalizeStoredConsultAnalysisPayload(source.payload, source.schemaVersion),
      sourceLookBriefVersionId: version.id, selectedPathIndex: args.pathIndex, selectedLocationType: args.locationType })
    return loadConsultLookBriefVersion(tx, args.consultSessionId)
  })
}


/** Called for every material client refinement, including edits beyond the paid rerun cap. */
export async function appendLockedConsultLookRefinement(tx: Prisma.TransactionClient, args: {
  consultSessionId: string; actor: { type: ConsultActorType; id: string | null }; mutationId: string
}) {
  const previous = await tx.consultLookBriefVersion.findFirst({ where: { consultSessionId: args.consultSessionId }, orderBy: { version: 'desc' } })
  if (!previous) return
  const clientHistory = await loadConsultLookHistory(tx, args.consultSessionId)
  const created = await tx.consultLookBriefVersion.create({ data: {
    professionalPlan: previous.professionalPlan ?? Prisma.DbNull,
    professionalPlanReason: previous.professionalPlanReason,
    invalidatedProfessionalPlan: previous.invalidatedProfessionalPlan ?? Prisma.DbNull,
    additionalClientAnswers: consultLookHistoryStoredItems(clientHistory.items),
    consultSessionId: args.consultSessionId, sourceAnalysisRevisionId: previous.sourceAnalysisRevisionId,
    version: previous.version + 1, awaitingAnalysis: true,
    selectedPathIndex: previous.selectedPathIndex, selectedLocationType: previous.selectedLocationType,
    pathEstimates: previous.pathEstimates ?? Prisma.JsonNull, adjustments: previous.adjustments ?? Prisma.JsonNull,
    invalidatedAdjustments: previous.invalidatedAdjustments ?? Prisma.JsonNull,
    changeSummary: ['Your preferences or starting point changed. The previous plan needs a fresh review.',
      ...await describeLookRefinement(tx, { consultSessionId: args.consultSessionId, previousCreatedAt: previous.createdAt,
        previousAnswers: parseConsultLookHistoryItems(previous.additionalClientAnswers), answers: clientHistory.items })],
    createdByActorType: args.actor.type, createdByActorId: args.actor.id,
    idempotencyKey: `refinement:${args.mutationId}`,
  } })
  await notifyConsultLookBriefVersion(tx, created)
}

export async function requireAuthorizedProLookScope(tx: Prisma.TransactionClient, args: {
  consultSessionId: string; professionalId: string; actorUserId: string
}, options: { readOnly?: boolean } = {}) {
  await tx.$queryRaw(Prisma.sql`SELECT id FROM "ConsultSession" WHERE id = ${args.consultSessionId} FOR UPDATE`)
  const session = await tx.consultSession.findUnique({ where: { id: args.consultSessionId }, select: {
    ...CONSULT_ANCHOR_SELECT, id: true, professional: { select: { userId: true } },
  } })
  if (!session || session.professionalId !== args.professionalId || session.professional.userId !== args.actorUserId ||
    !isAiConsultC6ExposureEnabledForPro(args.professionalId) || !evaluateConsultAnchorScope(session).eligible) {
    throw new ConsultWriteError('NOT_FOUND', 'Consultation not found.')
  }
  await requireCurrentConsultAgreementAcceptances(tx, session.id)
  const open = await tx.consultSession.findUniqueOrThrow({ where: { id: session.id }, select: CONSULT_OPEN_WINDOW_SELECT })
  if (!options.readOnly && !(await consultLookConfirmationOpen(tx, open))) assertConsultInputOpen(open)
  return session
}

export async function acknowledgeConsultLookBrief(args: {
  consultSessionId: string; actorUserId: string; expectedVersion: number
} & ({ clientId: string; professionalId?: never } | { professionalId: string; clientId?: never })) {
  if (!Number.isSafeInteger(args.expectedVersion) || args.expectedVersion < 1) throw new ConsultWriteError('INVALID_REQUEST', 'Invalid look version.')
  return prisma.$transaction(async tx => {
    const professional = args.professionalId !== undefined
    if (args.professionalId !== undefined) await requireAuthorizedProLookScope(tx, { ...args, professionalId: args.professionalId }, { readOnly: true })
    else {
      await requireAuthorizedProposalScope(tx, { ...args, clientId: args.clientId, readOnly: true })
    }
    const confirmationSession = await tx.consultSession.findUniqueOrThrow({ where: { id: args.consultSessionId }, select: CONSULT_OPEN_WINDOW_SELECT })
    if (!(await consultLookConfirmationOpen(tx, confirmationSession))) throw new ConsultWriteError('INVALID_STATE', 'This appointment has already started service.')
    const version = await tx.consultLookBriefVersion.findFirst({ where: { consultSessionId: args.consultSessionId }, orderBy: { version: 'desc' } })
    if (!version || version.version !== args.expectedVersion || version.awaitingAnalysis || version.invalidatedProfessionalPlan !== null || version.selectedPathIndex === null || parseConsultLookAdjustments(version.invalidatedAdjustments).length > 0) {
      throw new ConsultWriteError('ANALYSIS_SUPERSEDED', 'Review and choose the current look before confirming.')
    }
    const alreadyAcknowledged = professional ? version.professionalAcknowledgedAt : version.clientAcknowledgedAt
    if (!alreadyAcknowledged) await tx.consultLookBriefVersion.update({ where: { id: version.id }, data:
      professional ? { professionalAcknowledgedAt: new Date() } : { clientAcknowledgedAt: new Date() } })
    return loadConsultLookBriefVersion(tx, args.consultSessionId)
  })
}


export async function adjustProfessionalConsultLook(args: {
  consultSessionId: string; professionalId: string; actorUserId: string; expectedVersion: number
  adjustments: ConsultLookAdjustment[]; idempotencyKey: string
}) {
  const changes = parseConsultLookAdjustments(args.adjustments)
  if (!changes.length || changes.some(entry => entry.professionalId !== args.professionalId) || !args.idempotencyKey.trim() || args.idempotencyKey.length > 128) {
    throw new ConsultWriteError('INVALID_REQUEST', 'Invalid professional adjustment.')
  }
  return prisma.$transaction(async tx => {
    await requireAuthorizedProLookScope(tx, args)
    const previous = await tx.consultLookBriefVersion.findFirst({ where: { consultSessionId: args.consultSessionId }, orderBy: { version: 'desc' } })
    const replay = await tx.consultLookBriefVersion.findUnique({ where: { consultSessionId_idempotencyKey: {
      consultSessionId: args.consultSessionId, idempotencyKey: args.idempotencyKey,
    } } })
    if (replay) {
      const prior = await tx.consultLookBriefVersion.findUnique({ where: { consultSessionId_version: {
        consultSessionId: args.consultSessionId, version: args.expectedVersion,
      } } })
      const inherited = readStoredLookAdjustments(prior?.adjustments ?? {})
      const requested = [...inherited.filter(entry => !changes.some(change => lookAdjustmentKey(change) === lookAdjustmentKey(entry))), ...changes]
      const sorted = (entries: ConsultLookAdjustment[]) => entries.sort((a, b) => lookAdjustmentKey(a).localeCompare(lookAdjustmentKey(b)))
      if (!prior || replay.createdByActorType !== 'PROFESSIONAL' || replay.createdByActorId !== args.actorUserId || replay.version !== args.expectedVersion + 1 ||
        !isDeepStrictEqual(sorted(readStoredLookAdjustments(replay.adjustments)), sorted(requested))) throw new ConsultWriteError('IDEMPOTENCY_CONFLICT', 'This adjustment request was already used.')
      return loadConsultLookBriefVersion(tx, args.consultSessionId)
    }
    if (!previous || previous.version !== args.expectedVersion || previous.awaitingAnalysis) {
      throw new ConsultWriteError('ANALYSIS_SUPERSEDED', 'Review the current look before adjusting it.')
    }
    const inherited = readStoredLookAdjustments(previous.adjustments)
    const merged = [...inherited.filter(entry => !changes.some(change => lookAdjustmentKey(change) === lookAdjustmentKey(entry))), ...changes]
    const version = await appendLockedConsultLookBriefVersion(tx, { consultSessionId: args.consultSessionId,
      analysisRevisionId: previous.sourceAnalysisRevisionId, actorType: 'PROFESSIONAL', actorId: args.actorUserId,
      idempotencyKey: args.idempotencyKey, adjustments: merged,
      ...(previous.selectedPathIndex !== null && previous.selectedLocationType ? {
        selectedPathIndex: previous.selectedPathIndex, selectedLocationType: previous.selectedLocationType,
      } : {}),
    })
    if (version.selectedPathIndex !== null && version.selectedLocationType) {
      const source = await tx.consultRevision.findUniqueOrThrow({ where: { id: version.sourceAnalysisRevisionId } })
      await writeLookServiceEstimate(tx, { consultSessionId: args.consultSessionId, analysisRevisionId: source.id,
        analysis: normalizeStoredConsultAnalysisPayload(source.payload, source.schemaVersion), sourceLookBriefVersionId: version.id,
        selectedPathIndex: version.selectedPathIndex, selectedLocationType: version.selectedLocationType })
    }
    return loadConsultLookBriefVersion(tx, args.consultSessionId)
  })
}
