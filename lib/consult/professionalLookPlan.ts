import 'server-only'
import { Prisma } from '@prisma/client'
import { isDeepStrictEqual } from 'node:util'
import { prisma } from '@/lib/prisma'
import { isRecord } from '@/lib/guards'
import type { ConsultLookPlanDTO } from '@/lib/dto/consult'
import { exactKeys } from './analysisValidation'
import { normalizeStoredConsultAnalysisPayload } from './analysisRevision'
import { normalizeStoredConsultLookPlan } from './lookPlan'
import { loadConsultProMenu } from './proMenu'
import { requireAuthorizedProLookScope, appendLockedConsultLookBriefVersion, loadConsultLookBriefVersion } from './lookBrief'
import { ConsultWriteError } from './errors'

export type ProfessionalLookPlanInput = {
  expectedVersion: number; idempotencyKey: string; tier: 'EXACT' | 'CLOSE' | 'TOWARD'
  title: string; summary: string; whyThisWorksForYou: string; reviewNote: string
  reviewedClientDetails: true; visits: string[][]
}
export function parseProfessionalLookPlanInput(raw: unknown): ProfessionalLookPlanInput {
  function fail(): never { throw new ConsultWriteError('INVALID_REQUEST', 'Review the client details and provide a complete look plan.') }
  if (!isRecord(raw) || !exactKeys(raw, ['expectedVersion','idempotencyKey','tier','title','summary','whyThisWorksForYou','reviewNote','reviewedClientDetails','visits']) ||
    !Number.isSafeInteger(raw.expectedVersion) || typeof raw.expectedVersion !== 'number' || raw.expectedVersion < 1 ||
    typeof raw.idempotencyKey !== 'string' || !raw.idempotencyKey.trim() || raw.idempotencyKey.length > 128 ||
    !['EXACT','CLOSE','TOWARD'].includes(String(raw.tier)) || raw.reviewedClientDetails !== true ||
    !Array.isArray(raw.visits) || raw.visits.length < 1 || raw.visits.length > 8) fail()
  const bounded = (value: unknown, max: number): string => {
    if (typeof value !== 'string' || !value.trim() || value.trim().length > max) fail()
    return value.trim()
  }
  const tier = raw.tier
  if (tier !== 'EXACT' && tier !== 'CLOSE' && tier !== 'TOWARD') fail()
  return { expectedVersion: raw.expectedVersion, idempotencyKey: raw.idempotencyKey, tier,
    title: bounded(raw.title, 100), summary: bounded(raw.summary, 400), whyThisWorksForYou: bounded(raw.whyThisWorksForYou, 320),
    reviewNote: bounded(raw.reviewNote, 400), reviewedClientDetails: true,
    visits: raw.visits.map(visit => {
      if (!Array.isArray(visit) || visit.length < 1 || visit.length > 6) fail()
      const ids = visit.map(id => bounded(id, 128))
      if (new Set(ids).size !== ids.length) fail()
      return ids
    }),
  }
}

export async function loadProfessionalLookPlanMenu(args: { consultSessionId: string; professionalId: string; actorUserId: string }) {
  return prisma.$transaction(async tx => {
    const session = await requireAuthorizedProLookScope(tx, args)
    const menu = await loadConsultProMenu(tx, { professionalId: args.professionalId, serviceCategoryId: session.serviceCategoryId, menuScope: 'HAIR_FAMILY' })
    return menu.offerings.map(offering => ({ offeringId: offering.id, name: offering.service.name }))
  })
}

export async function authorProfessionalLookPlan(args: {
  consultSessionId: string; professionalId: string; actorUserId: string; input: ProfessionalLookPlanInput
}) {
  const input = parseProfessionalLookPlanInput(args.input)
  return prisma.$transaction(async tx => {
    const session = await requireAuthorizedProLookScope(tx, args)
    const previous = await tx.consultLookBriefVersion.findFirst({ where: { consultSessionId: session.id }, orderBy: { version: 'desc' } })
    if (!previous) throw new ConsultWriteError('INVALID_STATE', 'There is no look brief to review.')
    const replay = await tx.consultLookBriefVersion.findUnique({ where: { consultSessionId_idempotencyKey: {
      consultSessionId: session.id, idempotencyKey: input.idempotencyKey,
    } } })
    if (replay) {
      const source = await tx.consultRevision.findUniqueOrThrow({ where: { id: replay.sourceAnalysisRevisionId } })
      const analysis = normalizeStoredConsultAnalysisPayload(source.payload, source.schemaVersion)
      const plan = replay.professionalPlan ? normalizeStoredConsultLookPlan(replay.professionalPlan, analysis) : null
      if (replay.version !== input.expectedVersion + 1 || replay.createdByActorType !== 'PROFESSIONAL' || replay.createdByActorId !== args.actorUserId ||
        replay.professionalPlanReason !== input.reviewNote || plan?.tier !== input.tier || plan.summary !== input.summary ||
        plan.paths[0]?.title !== input.title || plan.paths[0]?.whyThisWorksForYou !== input.whyThisWorksForYou ||
        !isDeepStrictEqual(plan.paths[0]?.visits.map(visit => visit.steps.map(step => step.offeringId)), input.visits)) {
        throw new ConsultWriteError('IDEMPOTENCY_CONFLICT', 'This request was already used for another look plan.')
      }
      return loadConsultLookBriefVersion(tx, session.id)
    }
    if (previous.version !== input.expectedVersion) throw new ConsultWriteError('ANALYSIS_SUPERSEDED', 'Review the current brief before authoring a plan.')
    const source = await tx.consultRevision.findUniqueOrThrow({ where: { id: previous.sourceAnalysisRevisionId } })
    const analysis = normalizeStoredConsultAnalysisPayload(source.payload, source.schemaVersion)
    const menu = await loadConsultProMenu(tx, { professionalId: args.professionalId, serviceCategoryId: session.serviceCategoryId, menuScope: 'HAIR_FAMILY' })
    const visits = input.visits.map(ids => ({ steps: ids.map(id => {
      const offering = menu.offerings.find(item => item.id === id)
      if (!offering) throw new ConsultWriteError('INVALID_REQUEST', 'Choose active services from your own menu.')
      return { offeringId: offering.id, serviceId: offering.serviceId, serviceCategoryId: offering.service.categoryId, serviceName: offering.service.name }
    }) }))
    // The pro authored this one by hand, so it is neither thin nor waiting on
    // anything she has to answer.
    const plan: ConsultLookPlanDTO = { schemaVersion: 1, tier: input.tier, status: 'READY_TO_CHOOSE', provisional: false, choosable: true,
      // Inherited, never re-decided: a pro redrawing the plan does not clear a
      // patch test the intake called for, and the client's booking still says so.
      safetyRouted: analysis.lookPlan?.safetyRouted ?? false,
      summary: input.summary, nextStep: 'Review your pro’s plan, choose this look, and confirm this version.',
      paths: [{ title: input.title, whyThisWorksForYou: input.whyThisWorksForYou, featureEvidence: [], sessionCount: visits.length, visits }] }
    try { normalizeStoredConsultLookPlan(plan, analysis) }
    catch { throw new ConsultWriteError('INVALID_REQUEST', 'Describe the outcome without prices, and choose a valid sequence of services.') }
    await appendLockedConsultLookBriefVersion(tx, { consultSessionId: session.id, analysisRevisionId: source.id,
      actorType: 'PROFESSIONAL', actorId: args.actorUserId, idempotencyKey: input.idempotencyKey,
      professionalPlan: plan, professionalPlanReason: input.reviewNote, adjustments: [],
    })
    return loadConsultLookBriefVersion(tx, session.id)
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead })
}
