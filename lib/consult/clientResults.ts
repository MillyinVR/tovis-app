import 'server-only'

import {
  ConsultActorType,
  ConsultAuditAction,
  ConsultCaptureStatus,
  ConsultSessionStatus,
  Prisma,
} from '@prisma/client'

import type { ConsultClientResultsDTO } from '@/lib/dto/consult'
import { logAiConsultServe } from '@/lib/observability/aiConsultEvents'
import { prisma } from '@/lib/prisma'

import { isAiConsultC7ExposureEnabledForPro } from './access'
import { requireCurrentConsultAgreementAcceptances } from './agreementContract'
import { CONSULT_ANCHOR_SELECT, evaluateConsultAnchor } from './anchor'
import {
  ImmutableConsultResultError,
  loadLatestImmutableConsultResult,
} from './immutableResult'

export type ClientConsultResultsErrorCode =
  | 'HIDDEN'
  | 'NOT_FOUND'
  | 'UNAVAILABLE'

export class ClientConsultResultsError extends Error {
  constructor(readonly code: ClientConsultResultsErrorCode) {
    super('Consult results unavailable.')
    this.name = 'ClientConsultResultsError'
  }
}

type AuthorizedClientResultRequest = {
  consultSessionId: string
  clientId: string
  actorUserId: string
  now?: Date
}

const CLIENT_RESULT_SCOPE_SELECT = {
  id: true,
  status: true,
  client: { select: { userId: true } },
  ...CONSULT_ANCHOR_SELECT,
} satisfies Prisma.ConsultSessionSelect

type ClientResultScope = Prisma.ConsultSessionGetPayload<{
  select: typeof CLIENT_RESULT_SCOPE_SELECT
}>

async function lockClientResultSession(
  tx: Prisma.TransactionClient,
  consultSessionId: string,
): Promise<void> {
  const locked = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    SELECT "id" FROM "ConsultSession"
    WHERE "id" = ${consultSessionId}
    FOR UPDATE
  `)
  if (locked.length === 0) throw new ClientConsultResultsError('NOT_FOUND')
}

async function requireAuthorizedClientResultScope(
  tx: Prisma.TransactionClient,
  args: AuthorizedClientResultRequest,
): Promise<ClientResultScope> {
  await lockClientResultSession(tx, args.consultSessionId)
  const session = await tx.consultSession.findUnique({
    where: { id: args.consultSessionId },
    select: CLIENT_RESULT_SCOPE_SELECT,
  })
  if (
    !session ||
    session.clientId !== args.clientId ||
    session.client.userId !== args.actorUserId
  ) {
    throw new ClientConsultResultsError('NOT_FOUND')
  }
  if (!isAiConsultC7ExposureEnabledForPro(session.professionalId)) {
    throw new ClientConsultResultsError('HIDDEN')
  }
  if (session.status !== ConsultSessionStatus.COMPLETED) {
    throw new ClientConsultResultsError('UNAVAILABLE')
  }
  const anchor = evaluateConsultAnchor(session, args.now ?? new Date())
  if (!anchor.eligible) {
    throw new ClientConsultResultsError(anchor.hidden ? 'HIDDEN' : 'UNAVAILABLE')
  }
  try {
    await requireCurrentConsultAgreementAcceptances(tx, session.id)
  } catch {
    throw new ClientConsultResultsError('UNAVAILABLE')
  }
  return session
}

function clientResultsDto(args: {
  scope: ClientResultScope
  result: Awaited<ReturnType<typeof loadLatestImmutableConsultResult>>
  teaserTapped: boolean
}): ConsultClientResultsDTO {
  const directions = args.result.payload.recommendationDirections

  return {
    consultId: args.scope.id,
    bookingId: args.scope.bookingId,
    lookPostId: args.scope.anchorLookPostId,
    serviceCategoryId: args.scope.serviceCategoryId,
    briefRevisionId: args.result.briefRevisionId,
    briefRevision: args.result.briefRevision,
    analysisRevisionId: args.result.analysisRevisionId,
    analysisRevision: args.result.analysisRevision,
    intakeRevisionId: args.result.intakeRevisionId,
    clientIntake: args.result.payload.clientIntake,
    aiObservations: args.result.payload.aiObservations,
    profile: args.result.payload.profile,
    styleDirections: args.result.payload.styleDirections,
    safetyFlags: args.result.payload.safetyFlags,
    achievabilityDirection: args.result.payload.achievabilityDirection,
    recommendationDirections: directions,
    meCardTeaser: { locked: true, tapped: args.teaserTapped },
    createdAt: args.result.createdAt.toISOString(),
  }
}

function requireClientResultFraming(
  result: Awaited<ReturnType<typeof loadLatestImmutableConsultResult>>,
): void {
  const directions = result.payload.recommendationDirections
  if (
    directions.length < 2 ||
    directions.length > 3 ||
    !result.payload.achievabilityDirection.discussWithProfessional ||
    directions.some((direction) => !direction.discussWithProfessional)
  ) {
    throw new ClientConsultResultsError('UNAVAILABLE')
  }
}

/** Shared authorization, immutable projection, and serve boundary for RSC/API. */
export async function loadAuthorizedClientConsultResults(
  args: AuthorizedClientResultRequest,
): Promise<ConsultClientResultsDTO> {
  const loaded = await prisma.$transaction(
    async (tx) => {
      const scope = await requireAuthorizedClientResultScope(tx, args)
      let result
      try {
        result = await loadLatestImmutableConsultResult(tx, scope.id)
      } catch (error: unknown) {
        if (error instanceof ImmutableConsultResultError) {
          throw new ClientConsultResultsError('UNAVAILABLE')
        }
        throw error
      }

      requireClientResultFraming(result)

      const existingEvents = await tx.consultAuditEvent.findMany({
        where: {
          consultSessionId: scope.id,
          action: {
            in: [
              ConsultAuditAction.CLIENT_RESULTS_SERVED,
              ConsultAuditAction.ME_CARD_TEASER_TAPPED,
            ],
          },
        },
        select: { action: true },
      })
      const actions = new Set(existingEvents.map((event) => event.action))
      const firstServe = !actions.has(ConsultAuditAction.CLIENT_RESULTS_SERVED)
      if (firstServe) {
        await tx.consultAuditEvent.create({
          data: {
            consultSessionId: scope.id,
            action: ConsultAuditAction.CLIENT_RESULTS_SERVED,
            actorType: ConsultActorType.CLIENT,
            actorId: args.actorUserId,
          },
        })
      }

      const captures = await tx.consultCapture.findMany({
        where: {
          consultSessionId: scope.id,
          status: {
            in: [ConsultCaptureStatus.ACCEPTED, ConsultCaptureStatus.REJECTED],
          },
        },
        select: { status: true },
      })
      const attributedBookingCount = await tx.booking.count({
        where: { sourceConsultSessionId: scope.id },
      })

      return {
        dto: clientResultsDto({
          scope,
          result,
          teaserTapped: actions.has(ConsultAuditAction.ME_CARD_TEASER_TAPPED),
        }),
        firstServe,
        acceptedPhotoCount: captures.filter(
          (capture) => capture.status === ConsultCaptureStatus.ACCEPTED,
        ).length,
        retakeCount: captures.filter(
          (capture) => capture.status === ConsultCaptureStatus.REJECTED,
        ).length,
        bookingAttributed: attributedBookingCount > 0,
      }
    },
    // READ COMMITTED matters here: a concurrent request may begin before the
    // session lock is released, and its post-lock statements must see the
    // first request's singular audit insert rather than trip the unique
    // backstop while replaying the same serve.
    { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted },
  )

  logAiConsultServe({
    metric: 'CLIENT_RESULTS',
    consultId: loaded.dto.consultId,
    clientId: args.clientId,
    firstServe: loaded.firstServe,
    acceptedPhotoCount: loaded.acceptedPhotoCount,
    retakeCount: loaded.retakeCount,
    bookingAttributed: loaded.bookingAttributed,
  })
  return loaded.dto
}

export async function recordLockedMeCardTeaserTap(
  args: AuthorizedClientResultRequest,
): Promise<{ replayed: boolean }> {
  const result = await prisma.$transaction(
    async (tx) => {
      const scope = await requireAuthorizedClientResultScope(tx, args)
      try {
        const immutable = await loadLatestImmutableConsultResult(tx, scope.id)
        requireClientResultFraming(immutable)
      } catch (error: unknown) {
        if (error instanceof ClientConsultResultsError) throw error
        if (error instanceof ImmutableConsultResultError) {
          throw new ClientConsultResultsError('UNAVAILABLE')
        }
        throw error
      }

      const resultsServed = await tx.consultAuditEvent.findFirst({
        where: {
          consultSessionId: scope.id,
          action: ConsultAuditAction.CLIENT_RESULTS_SERVED,
        },
        select: { id: true },
      })
      if (!resultsServed) throw new ClientConsultResultsError('UNAVAILABLE')

      const existing = await tx.consultAuditEvent.findFirst({
        where: {
          consultSessionId: scope.id,
          action: ConsultAuditAction.ME_CARD_TEASER_TAPPED,
        },
        select: { id: true },
      })
      if (existing) return { replayed: true }

      await tx.consultAuditEvent.create({
        data: {
          consultSessionId: scope.id,
          action: ConsultAuditAction.ME_CARD_TEASER_TAPPED,
          actorType: ConsultActorType.CLIENT,
          actorId: args.actorUserId,
        },
      })
      return { replayed: false }
    },
    // As above, a waiter must see the first tap after acquiring the session
    // lock so simultaneous taps deterministically replay instead of failing a
    // stale serializable snapshot.
    { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted },
  )

  if (!result.replayed) {
    logAiConsultServe({
      metric: 'ME_CARD_TEASER_TAP',
      consultId: args.consultSessionId,
      clientId: args.clientId,
      firstTap: true,
    })
  }
  return result
}
