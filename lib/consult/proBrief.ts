import { loadConsultSuitability, proSuitability } from './suitabilityRead'
import { normalizeStoredInspirationPayload } from './inspirationPack'
import { consultIntakeItems, findConsultIntakePack, normalizeConsultIntakePayload } from './intake/registry'
import { requireAuthorizedProLookScope } from './lookBrief'
import { loadConsultProFollowUps } from './proFollowUp'
import 'server-only'
import { readOptionalEnv } from '@/lib/env'
import { buildConsultMentor } from './mentor'

import { consultCalibrationAnswerItems } from './profileCalibration'

import {
  ConsultActorType,
  ConsultAuditAction,
  ConsultBriefFeedbackRating,
  ConsultRevisionKind,
  ConsultSessionStatus,
  Prisma,
} from '@prisma/client'

import { defaultClientConsultPlanDiffCopy } from '@/lib/brand/defaultClientConsultPlanDiffCopy'
import type { BrandClientConsultPlanDiffCopy } from '@/lib/brand/types'
import { assertProCanViewClient } from '@/lib/clientVisibility'
import type {
  ConsultBriefFeedbackRatingDTO,
  ConsultFaceColorProfileDTO,
  ConsultInspirationAnalysisDTO,
  ConsultPlanDiffEntryDTO,
  ConsultProBriefDTO,
  ConsultServiceEstimateDTO,
} from '@/lib/dto/consult'
import { prisma } from '@/lib/prisma'

import { isAiConsultC6ExposureEnabledForPro } from './access'
import {
  CONSULT_FACE_COLOR_PROMPT_VERSION,
  CONSULT_FACE_COLOR_SCHEMA_VERSION,
  sanitizeConsultFaceColorResponse,
  mergeConsultFeatureProfiles,
} from './analysisEngine'
import { loadConsultPlanVersions } from './analysisRerun'
import {
  ImmutableConsultResultError,
  loadLatestImmutableConsultResult,
} from './immutableResult'
import { normalizeStoredConsultInspirationAnalysis } from './inspirationAnalysisRead'
import { diffConsultPlans } from './planDiff'
import { loadConsultServiceEstimatesByConsultId } from './serviceEstimate'

export { selectLatestConsultRevision } from './immutableResult'

export type ProConsultBriefErrorCode =
  | 'HIDDEN'
  | 'NOT_FOUND'
  | 'UNAVAILABLE'
  | 'INVALID_RATING'
  | 'RATING_CONFLICT'

export class ProConsultBriefError extends Error {
  constructor(readonly code: ProConsultBriefErrorCode) {
    super('Consult brief unavailable.')
    this.name = 'ProConsultBriefError'
  }
}

type BriefSession = {
  id: string
  bookingId: string | null
  anchorLookPostId: string | null
  professionalId: string
  serviceCategoryId: string
  createdAt: Date
}

export function sortConsultBriefHistory<
  T extends Pick<ConsultProBriefDTO, 'createdAt' | 'consultId'>,
>(briefs: readonly T[]): T[] {
  return [...briefs].sort(
    (left, right) =>
      new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime() ||
      right.consultId.localeCompare(left.consultId),
  )
}

/**
 * P4: the inspiration-analysis artefact for this brief, or null.
 *
 * It is a SIBLING read, not part of the brief payload — the brief is
 * re-derived and byte-compared on every read
 * (`loadLatestImmutableConsultResult`), and folding a second artefact into
 * that projection would make an unrelated artefact able to invalidate a
 * finished brief. Same shape as B3's `serviceEstimate`, for the same reason.
 *
 * The pin is checked here: an artefact read against a different inspiration
 * ROW than the one the brief carries is stale, and stale means the wrong
 * photograph. Null, not "close enough".
 *
 * 🔴 It compares the inspiration ROW, not the guided-inspiration REVISION it
 * used to compare (P5b). Same intent — "is this a reading of the picture this
 * brief is about?" — but asked of the picture. The revision comparison also
 * went stale whenever the client answered another question about the SAME
 * photograph, which hid a perfectly good reading from the pro.
 */
async function loadBriefInspirationAnalysis(
  tx: Prisma.TransactionClient,
  consultSessionId: string,
  inspirationId: string | null,
): Promise<ConsultInspirationAnalysisDTO | null> {
  if (!inspirationId) return null
  const revision = await tx.consultRevision.findFirst({
    where: {
      consultSessionId,
      kind: ConsultRevisionKind.INSPIRATION_ANALYSIS,
    },
    select: {
      id: true,
      payload: true,
      schemaVersion: true,
      promptVersion: true,
      model: true,
      createdAt: true,
    },
    orderBy: [{ revision: 'desc' }, { id: 'desc' }],
  })
  if (!revision) return null
  const analysis = normalizeStoredConsultInspirationAnalysis(revision)
  return analysis?.inspirationId === inspirationId ? analysis : null
}

async function loadBriefFaceColorProfile(
  tx: Prisma.TransactionClient,
  consultSessionId: string,
  analysisRevisionId: string,
): Promise<ConsultFaceColorProfileDTO | null> {
  const row = await tx.consultFaceColorProfile.findFirst({
    where: { consultSessionId, analysisRevisionId },
    select: { payload: true, schemaVersion: true, promptVersion: true, model: true },
  })
  if (!row || row.schemaVersion !== CONSULT_FACE_COLOR_SCHEMA_VERSION || row.promptVersion !== CONSULT_FACE_COLOR_PROMPT_VERSION) return null
  if (!row.model.trim() || row.model !== row.model.trim() || row.model.length > 128) return null
  try {
    return sanitizeConsultFaceColorResponse({ profile: row.payload })
  } catch {
    return null
  }
}

/**
 * P7a-3 — which plan version this brief is, and what the client changed.
 *
 * Read as a SIBLING, exactly like the inspiration analysis above and for the
 * same reason: the brief payload is re-derived and byte-compared on every read,
 * so a diff folded into it would let a later version invalidate a finished
 * brief.
 *
 * The comparison is v(n-1) → v(n), which is what "what changed since you last
 * looked?" means when the pro is looking at the newest. A pro who acknowledged
 * v1 and comes back to v3 sees the v2→v3 line only; per-version acknowledgment
 * is P10's, and inventing half of it here would be the wrong half.
 */
async function loadBriefPlanDiff(
  consultSessionId: string,
  copy: BrandClientConsultPlanDiffCopy,
): Promise<{ planVersion: number; planChanges: ConsultPlanDiffEntryDTO[] }> {
  const versions = await loadConsultPlanVersions(consultSessionId)
  const current = versions[versions.length - 1]
  const previous = versions[versions.length - 2]
  if (!current?.analysis || !previous?.analysis) {
    return { planVersion: Math.max(versions.length, 1), planChanges: [] }
  }
  return {
    planVersion: versions.length,
    planChanges: diffConsultPlans({
      previous: previous.analysis,
      next: current.analysis,
      copy,
    }),
  }
}

async function loadSessionBrief(
  tx: Prisma.TransactionClient,
  session: BriefSession,
  serviceEstimate: ConsultServiceEstimateDTO | null,
  planDiffCopy: BrandClientConsultPlanDiffCopy,
): Promise<ConsultProBriefDTO> {
  let result
  try {
    result = await loadLatestImmutableConsultResult(tx, session.id)
  } catch (error: unknown) {
    if (error instanceof ImmutableConsultResultError) {
      throw new ProConsultBriefError('UNAVAILABLE')
    }
    throw error
  }
  const { payload } = result
  const calibrationAnswers = consultCalibrationAnswerItems(await tx.consultFollowUpRound.findMany({
    where: { consultSessionId: session.id },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    select: { answers: true },
  }))

  let clientIntake = payload.clientIntake
  let inspiration = payload.inspiration
  if (result.lookBrief) {
    const latest = await tx.consultRevision.findFirst({ where: { consultSessionId: session.id, kind: 'INTAKE' }, orderBy: { revision: 'desc' } })
    const intake = latest ? normalizeConsultIntakePayload(latest.payload) : null
    const pack = intake ? findConsultIntakePack(intake.packId, intake.packVersion) : null
    if (intake && pack) clientIntake = consultIntakeItems(pack, intake.answers)
    const latestReference = await tx.consultRevision.findFirst({ where: { consultSessionId: session.id, kind: 'INSPIRATION' }, orderBy: { revision: 'desc' } })
    const reference = latestReference ? normalizeStoredInspirationPayload(latestReference.payload) : null
    if (reference && latestReference) {
      const source = reference.inspirationId ? await tx.consultInspiration.findFirst({
        where: { id: reference.inspirationId, consultSessionId: session.id, status: 'ATTACHED' },
        select: { sourceLookPostId: true },
      }) : null
      inspiration = { ...inspiration, revisionId: latestReference.id,
        source: reference.source, inspirationId: reference.inspirationId,
        lookPostId: source?.sourceLookPostId ?? null,
        mediaEndpoint: reference.source === 'EXTERNAL_UPLOAD'
          ? `/api/v1/pro/consults/${encodeURIComponent(session.id)}/inspiration/media` : null,
        exactClientDetails: reference.exactClientDetails,
        possibleProfessionalInterpretation: reference.possibleProfessionalInterpretation, catalogGuidance: reference.catalogGuidance }
    }
  }
  const feedback = await tx.consultBriefFeedback.findUnique({
    where: { consultSessionId: session.id },
    select: { rating: true, createdAt: true },
  })

  const suitability = await loadConsultSuitability(tx, session.id, payload.sourceAnalysisRevisionId)
  const brief: ConsultProBriefDTO = {
    ...(suitability ? { suitability: proSuitability(suitability) } : {}),
    consultId: session.id,
    bookingId: session.bookingId,
    lookPostId: session.anchorLookPostId,
    professionalId: session.professionalId,
    serviceCategoryId: session.serviceCategoryId,
    briefRevisionId: result.briefRevisionId,
    briefRevision: result.briefRevision,
    sourceAnalysisRevisionId: payload.sourceAnalysisRevisionId,
    sourceAnalysisRevision: payload.sourceAnalysisRevision,
    intakeRevisionId: payload.intakeRevisionId,
    inspiration,
    clientIntake: [...clientIntake, ...calibrationAnswers],
    aiObservations: payload.aiObservations,
    profile: mergeConsultFeatureProfiles(payload.profile,
      await loadBriefFaceColorProfile(tx, session.id, payload.sourceAnalysisRevisionId) ?? undefined),
    styleDirections: payload.styleDirections,
    safetyFlags: payload.safetyFlags,
    achievabilityDirection: payload.achievabilityDirection,
    recommendationDirections: payload.recommendationDirections,
    ...(result.lookPlan ? { lookPlan: result.lookPlan } : {}),
    ...(result.lookBrief ? { lookBrief: result.lookBrief } : {}),
    // Book the Look, B3. Omitted rather than nulled for a booking-anchored
    // consult, which has no estimate to carry.
    ...(session.anchorLookPostId ? { serviceEstimate } : {}),
    inspirationAnalysis: await loadBriefInspirationAnalysis(
      tx,
      session.id,
      inspiration.inspirationId,
    ),
    ...(await loadBriefPlanDiff(session.id, planDiffCopy)),
    feedback: feedback
      ? { rating: feedback.rating, createdAt: feedback.createdAt.toISOString() }
      : null,
    // C2-4 — always present on the server's own Brief; optional on the wire.
    proFollowUps: await loadConsultProFollowUps(tx, session.id),
    createdAt: result.createdAt.toISOString(),
  }
  if (readOptionalEnv('AI_CONSULT_MENTOR_ENABLED') === 'true') {
    const [pro, category] = await Promise.all([
      tx.professionalProfile.findUnique({ where: { id: session.professionalId }, select: { consultMentorEnabled: true } }),
      tx.serviceCategory.findUnique({ where: { id: session.serviceCategoryId }, select: { consultFamily: true } }),
    ])
    if (pro?.consultMentorEnabled && category?.consultFamily === 'HAIR') brief.mentor = buildConsultMentor(brief)
  }
  return brief

}

export type AuthorizedProConsultBriefRequest = (
  | { professionalId: string; bookingId: string; clientId?: never }
  | { professionalId: string; clientId: string; bookingId?: never }
) & {
  /**
   * P7a-3: the plan-diff labels. Optional so every shipped caller keeps
   * compiling, and defaulted to the brand DEFAULT rather than the tenant's —
   * the same reason `referenceNote` is (lib/consult/writeBoundary.ts): these
   * words are compared across surfaces, and two readers seeing two sentences
   * would be a diff that disagrees with itself.
   */
  planDiffCopy?: BrandClientConsultPlanDiffCopy
}

/** Shared authorization and render loader for both RSC surfaces and API twins. */
export async function loadAuthorizedProConsultBriefs(
  args: AuthorizedProConsultBriefRequest,
): Promise<ConsultProBriefDTO[]> {
  if (!isAiConsultC6ExposureEnabledForPro(args.professionalId)) {
    throw new ProConsultBriefError('HIDDEN')
  }
  const planDiffCopy = args.planDiffCopy ?? defaultClientConsultPlanDiffCopy

  let clientId: string
  let bookingId: string | null = null
  if ('bookingId' in args) {
    const booking = await prisma.booking.findFirst({
      where: { id: args.bookingId, professionalId: args.professionalId },
      select: { id: true, clientId: true },
    })
    if (!booking) throw new ProConsultBriefError('NOT_FOUND')
    clientId = booking.clientId
    bookingId = booking.id
  } else {
    clientId = args.clientId
    const gate = await assertProCanViewClient(args.professionalId, clientId)
    if (!gate.ok) throw new ProConsultBriefError('NOT_FOUND')
  }

  return prisma.$transaction(async (tx) => {
    const sessions = await tx.consultSession.findMany({
      where: bookingId
        ? {
            status: ConsultSessionStatus.COMPLETED,
            professionalId: args.professionalId,
            OR: [
              { bookingId },
              { inspiredBookings: { some: { id: bookingId } } },
            ],
          }
        : { clientId, status: ConsultSessionStatus.COMPLETED },
      select: {
        id: true,
        bookingId: true,
        anchorLookPostId: true,
        professionalId: true,
        serviceCategoryId: true,
        createdAt: true,
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: bookingId ? 2 : 200,
    })
    const estimates = await loadConsultServiceEstimatesByConsultId(
      tx,
      sessions
        .filter((session) => session.anchorLookPostId)
        .map((session) => session.id),
    )
    const briefs: ConsultProBriefDTO[] = []
    for (const session of sessions) {
      briefs.push(
        await loadSessionBrief(
          tx,
          session,
          estimates.get(session.id) ?? null,
          planDiffCopy,
        ),
      )
    }
    return sortConsultBriefHistory(briefs)
  })
}

function feedbackRating(value: unknown): ConsultBriefFeedbackRating | null {
  if (value === ConsultBriefFeedbackRating.ACCURATE_USEFUL) {
    return ConsultBriefFeedbackRating.ACCURATE_USEFUL
  }
  if (value === ConsultBriefFeedbackRating.OFF) {
    return ConsultBriefFeedbackRating.OFF
  }
  return null
}

export async function recordConsultBriefFeedback(args: {
  consultSessionId: string
  professionalId: string
  rating: ConsultBriefFeedbackRatingDTO
}): Promise<{
  feedback: { rating: ConsultBriefFeedbackRatingDTO; createdAt: string }
  replayed: boolean
}> {
  if (!isAiConsultC6ExposureEnabledForPro(args.professionalId)) {
    throw new ProConsultBriefError('HIDDEN')
  }
  const rating = feedbackRating(args.rating)
  if (!rating) throw new ProConsultBriefError('INVALID_RATING')

  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT "id" FROM "ConsultSession"
      WHERE "id" = ${args.consultSessionId}
      FOR UPDATE
    `)
    const session = await tx.consultSession.findFirst({
      where: {
        id: args.consultSessionId,
        professionalId: args.professionalId,
        status: ConsultSessionStatus.COMPLETED,
      },
      select: { id: true },
    })
    if (!session) throw new ProConsultBriefError('NOT_FOUND')

    const existing = await tx.consultBriefFeedback.findUnique({
      where: { consultSessionId: session.id },
      select: { rating: true, createdAt: true },
    })
    if (existing) {
      if (existing.rating !== rating) {
        throw new ProConsultBriefError('RATING_CONFLICT')
      }
      return {
        feedback: {
          rating: existing.rating,
          createdAt: existing.createdAt.toISOString(),
        },
        replayed: true,
      }
    }

    const brief = await tx.consultRevision.findFirst({
      where: { consultSessionId: session.id, kind: ConsultRevisionKind.BRIEF },
      select: { id: true },
      orderBy: [{ revision: 'desc' }, { id: 'desc' }],
    })
    if (!brief) throw new ProConsultBriefError('UNAVAILABLE')

    const created = await tx.consultBriefFeedback.create({
      data: {
        consultSessionId: session.id,
        briefRevisionId: brief.id,
        professionalId: args.professionalId,
        rating,
      },
      select: { id: true, rating: true, createdAt: true },
    })
    await tx.consultAuditEvent.create({
      data: {
        consultSessionId: session.id,
        action: ConsultAuditAction.BRIEF_FEEDBACK_RECORDED,
        actorType: ConsultActorType.PROFESSIONAL,
        actorId: args.professionalId,
        briefFeedbackId: created.id,
      },
    })
    return {
      feedback: {
        rating: created.rating,
        createdAt: created.createdAt.toISOString(),
      },
      replayed: false,
    }
  })
}


/** The assigned pro can review this consented look before an appointment exists. */
export async function loadAuthorizedProLookBrief(args: { consultSessionId: string; professionalId: string; actorUserId: string }) {
  return prisma.$transaction(async tx => {
    await requireAuthorizedProLookScope(tx, args, { readOnly: true })
    const session = await tx.consultSession.findUniqueOrThrow({ where: { id: args.consultSessionId }, select: {
      id: true, bookingId: true, anchorLookPostId: true, professionalId: true, serviceCategoryId: true, createdAt: true,
    } })
    const estimates = await loadConsultServiceEstimatesByConsultId(tx, [session.id])
    return loadSessionBrief(tx, session, estimates.get(session.id) ?? null, defaultClientConsultPlanDiffCopy)
  })
}
