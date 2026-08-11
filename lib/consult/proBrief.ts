import 'server-only'

import { isDeepStrictEqual } from 'node:util'
import {
  ConsultActorType,
  ConsultAuditAction,
  ConsultBriefFeedbackRating,
  ConsultRevisionKind,
  ConsultSessionStatus,
  Prisma,
} from '@prisma/client'

import { assertProCanViewClient } from '@/lib/clientVisibility'
import type {
  ConsultBriefFeedbackRatingDTO,
  ConsultProBriefDTO,
} from '@/lib/dto/consult'
import { isRecord } from '@/lib/guards'
import { prisma } from '@/lib/prisma'

import { isAiConsultC6ExposureEnabledForPro } from './access'
import { normalizeStoredHairColorAnalysisPayload } from './analysisRevision'
import {
  buildHairColorProBriefPayload,
  CONSULT_PRO_BRIEF_PROMPT_VERSION,
  CONSULT_PRO_BRIEF_SCHEMA_VERSION,
  toBriefJsonPayload,
} from './briefContract'
import { normalizeHairColorIntakePayload } from './intakePack'

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
  bookingId: string
  professionalId: string
  serviceCategoryId: string
  createdAt: Date
}

export function selectLatestConsultRevision<T extends { revision: number }>(
  revisions: readonly T[],
): T | null {
  let latest: T | null = null
  for (const revision of revisions) {
    if (!latest || revision.revision > latest.revision) latest = revision
  }
  return latest
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

function sourceAnalysisId(payload: Prisma.JsonValue): string | null {
  return isRecord(payload) && typeof payload.sourceAnalysisRevisionId === 'string'
    ? payload.sourceAnalysisRevisionId
    : null
}

async function loadSessionBrief(
  tx: Prisma.TransactionClient,
  session: BriefSession,
): Promise<ConsultProBriefDTO> {
  const revisions = await tx.consultRevision.findMany({
    where: {
      consultSessionId: session.id,
      kind: {
        in: [
          ConsultRevisionKind.INTAKE,
          ConsultRevisionKind.ANALYSIS,
          ConsultRevisionKind.BRIEF,
        ],
      },
    },
    select: {
      id: true,
      revision: true,
      kind: true,
      payload: true,
      schemaVersion: true,
      promptVersion: true,
      createdAt: true,
    },
    orderBy: [{ revision: 'desc' }, { id: 'desc' }],
  })
  const analysis = selectLatestConsultRevision(
    revisions.filter((revision) => revision.kind === ConsultRevisionKind.ANALYSIS),
  )
  const intake = selectLatestConsultRevision(
    revisions.filter((revision) => revision.kind === ConsultRevisionKind.INTAKE),
  )
  if (!analysis || !intake) throw new ProConsultBriefError('UNAVAILABLE')

  const normalizedIntake = normalizeHairColorIntakePayload(intake.payload)
  if (!normalizedIntake?.complete) {
    throw new ProConsultBriefError('UNAVAILABLE')
  }
  const payload = buildHairColorProBriefPayload({
    intakeRevisionId: intake.id,
    intakeAnswers: normalizedIntake.answers,
    analysisRevisionId: analysis.id,
    analysisRevision: analysis.revision,
    analysis: normalizeStoredHairColorAnalysisPayload(analysis.payload),
  })

  const brief = selectLatestConsultRevision(
    revisions.filter(
      (revision) =>
        revision.kind === ConsultRevisionKind.BRIEF &&
        revision.schemaVersion === CONSULT_PRO_BRIEF_SCHEMA_VERSION &&
        revision.promptVersion === CONSULT_PRO_BRIEF_PROMPT_VERSION &&
        sourceAnalysisId(revision.payload) === analysis.id,
    ),
  )
  if (!brief) {
    throw new ProConsultBriefError('UNAVAILABLE')
  }
  // The immutable revision is authoritative. The DTO is reconstructed only
  // through the pinned schema normalizer, then served iff it is structurally
  // identical to what was stored; code drift can never reinterpret history.
  if (!isDeepStrictEqual(brief.payload, toBriefJsonPayload(payload))) {
    throw new ProConsultBriefError('UNAVAILABLE')
  }

  const feedback = await tx.consultBriefFeedback.findUnique({
    where: { consultSessionId: session.id },
    select: { rating: true, createdAt: true },
  })

  return {
    consultId: session.id,
    bookingId: session.bookingId,
    professionalId: session.professionalId,
    serviceCategoryId: session.serviceCategoryId,
    briefRevisionId: brief.id,
    briefRevision: brief.revision,
    sourceAnalysisRevisionId: payload.sourceAnalysisRevisionId,
    sourceAnalysisRevision: payload.sourceAnalysisRevision,
    intakeRevisionId: payload.intakeRevisionId,
    clientIntake: payload.clientIntake,
    aiObservations: payload.aiObservations,
    safetyFlags: payload.safetyFlags,
    achievabilityDirection: payload.achievabilityDirection,
    recommendationDirections: payload.recommendationDirections,
    feedback: feedback
      ? { rating: feedback.rating, createdAt: feedback.createdAt.toISOString() }
      : null,
    createdAt: brief.createdAt.toISOString(),
  }
}

export type AuthorizedProConsultBriefRequest =
  | { professionalId: string; bookingId: string; clientId?: never }
  | { professionalId: string; clientId: string; bookingId?: never }

/** Shared authorization and render loader for both RSC surfaces and API twins. */
export async function loadAuthorizedProConsultBriefs(
  args: AuthorizedProConsultBriefRequest,
): Promise<ConsultProBriefDTO[]> {
  if (!isAiConsultC6ExposureEnabledForPro(args.professionalId)) {
    throw new ProConsultBriefError('HIDDEN')
  }

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
        professionalId: true,
        serviceCategoryId: true,
        createdAt: true,
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: bookingId ? 2 : 200,
    })
    const briefs: ConsultProBriefDTO[] = []
    for (const session of sessions) {
      briefs.push(await loadSessionBrief(tx, session))
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
