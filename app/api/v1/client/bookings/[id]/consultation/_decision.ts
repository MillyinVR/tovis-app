// app/api/v1/client/bookings/[id]/consultation/_decision.ts

import { prisma } from '@/lib/prisma'
import {
  enforceRateLimit,
  jsonFail,
  jsonOk,
  pickString,
  rateLimitIdentity,
  requireClient,
} from '@/app/api/_utils'
import {
  beginRouteIdempotency,
  completeRouteIdempotency,
  failStartedRouteIdempotency,
  isRouteIdempotencyHandled,
} from '@/app/api/_utils/idempotency'
import { approveConsultationAndMaterializeBooking } from '@/lib/booking/writeBoundary'
import { createBookingCloseoutAuditLog } from '@/lib/booking/closeoutAudit'
import { createProNotification } from '@/lib/notifications/proNotifications'
import { kickNotificationDrain } from '@/lib/notifications/delivery/kickNotificationDrain'
import { formatClientName } from '@/lib/profiles/publicProfileFormatting'
import {
  broadcastLive,
  liveChannelForPro,
  liveChannelForUser,
} from '@/lib/live/broadcast'
import {
  BookingCloseoutAuditAction,
  ConsultationApprovalStatus,
  NotificationEventKey,
  Prisma,
  Role,
} from '@prisma/client'
import {
  normalizeJsonObjectPayload,
  type JsonObjectPayload,
} from '@/app/api/_utils/jsonPayload'
import { IDEMPOTENCY_ROUTES } from '@/lib/idempotency'
import { captureBookingException } from '@/lib/observability/bookingEvents'

export type ConsultationDecisionAction = 'APPROVE' | 'REJECT'

export type ConsultationDecisionCtx = {
  params: { id: string } | Promise<{ id: string }>
}

export type ConsultationDecisionRequestMeta = {
  requestId?: string | null
  idempotencyKey?: string | null
}

const OPERATION = 'POST /api/v1/client/bookings/[id]/consultation'

const CONSULTATION_APPROVAL_SELECT = {
  id: true,
  status: true,
  approvedAt: true,
  rejectedAt: true,
  proposedServicesJson: true,
  proposedTotal: true,
  notes: true,
  bookingId: true,
  clientId: true,
  proId: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.ConsultationApprovalSelect

const CONSULTATION_DECISION_BOOKING_SELECT = {
  id: true,
  clientId: true,
  professionalId: true,
  consultationApproval: {
    select: CONSULTATION_APPROVAL_SELECT,
  },
} satisfies Prisma.BookingSelect

type ConsultationApprovalRecord = Prisma.ConsultationApprovalGetPayload<{
  select: typeof CONSULTATION_APPROVAL_SELECT
}>

type ConsultationDecisionBookingRecord = Prisma.BookingGetPayload<{
  select: typeof CONSULTATION_DECISION_BOOKING_SELECT
}>

function normalizeDateCmp(value: Date | null | undefined): string | null {
  return value ? new Date(value).toISOString() : null
}

function normalizeDecimalCmp(
  value: Prisma.Decimal | null | undefined,
): string | null {
  return value ? value.toFixed(2) : null
}

function buildConsultationApprovalAuditSnapshot(
  approval: ConsultationApprovalRecord,
) {
  return {
    status: approval.status,
    approvedAt: normalizeDateCmp(approval.approvedAt),
    rejectedAt: normalizeDateCmp(approval.rejectedAt),
    proposedTotal: normalizeDecimalCmp(approval.proposedTotal),
    notes: approval.notes ?? null,
    clientId: approval.clientId ?? null,
    proId: approval.proId ?? null,
  }
}

function getConsultationDecisionNotificationMeta(
  action: ConsultationDecisionAction,
  clientName: string,
): {
  title: string
  body: string
  eventKey: NotificationEventKey
} {
  if (action === 'APPROVE') {
    return {
      title: 'Consultation approved',
      body: `${clientName} approved your proposal — you're good to proceed.`,
      eventKey: NotificationEventKey.CONSULTATION_APPROVED,
    }
  }

  return {
    // §12 NC1 #12: "declined" reads softer than "rejected".
    title: 'Consultation declined',
    body: `${clientName} declined your proposal. Tap to revise or discuss.`,
    eventKey: NotificationEventKey.CONSULTATION_REJECTED,
  }
}

async function createConsultationDecisionNotification(args: {
  bookingId: string
  professionalId: string
  clientId: string
  actorUserId: string
  action: ConsultationDecisionAction
}): Promise<void> {
  // Name the client (§12 NC1 #11/#12). Best-effort read; a failure falls back to
  // formatClientName's generic label and never blocks the notification.
  const client = await prisma.clientProfile
    .findUnique({
      where: { id: args.clientId },
      select: {
        firstName: true, // pii-plaintext-read-ok: pro-facing client name in consultation-decision notif
        lastName: true, // pii-plaintext-read-ok: pro-facing client name in consultation-decision notif
      },
    })
    .catch(() => null)
  const meta = getConsultationDecisionNotificationMeta(
    args.action,
    formatClientName(client ?? {}),
  )

  try {
    await createProNotification({
      professionalId: args.professionalId,
      eventKey: meta.eventKey,
      title: meta.title,
      body: meta.body,
      href: `/pro/bookings/${args.bookingId}?step=consult`,
      actorUserId: args.actorUserId,
      bookingId: args.bookingId,
      dedupeKey: `PRO_NOTIF:${meta.eventKey}:${args.bookingId}`,
      data: {
        bookingId: args.bookingId,
        action: args.action,
        step: 'consult',
      },
    })
  } catch (e: unknown) {
    console.error('Pro notification failed (consultation decision):', e)
  }
}

function buildDecisionResponseBody(args: {
  bookingId: string
  action: ConsultationDecisionAction
  approval: unknown
  alreadyDecided?: boolean
}): JsonObjectPayload {
  return normalizeJsonObjectPayload({
    bookingId: args.bookingId,
    action: args.action,
    ...(args.alreadyDecided === true ? { alreadyDecided: true } : {}),
    approval: args.approval,
  })
}

async function failStartedIdempotency(
  idempotencyRecordId: string | null,
): Promise<void> {
  if (!idempotencyRecordId) return

  await failStartedRouteIdempotency({
    idempotencyRecordId,
    operation: OPERATION,
  }).catch((failError: unknown) => {
    console.error(
      'POST /api/v1/client/bookings/[id]/consultation idempotency failure update error:',
      failError,
    )
  })
}

/**
 * Client consultation decision boundary:
 * - ensure client owns booking
 * - ensure consultationApproval exists
 * - begin durable idempotency before approve/reject writes
 * - APPROVE: materialize approved proposal into canonical Booking state
 * - REJECT: preserve ConsultationApproval as rejected history only
 * - notify pro best-effort
 * - return updated approval snapshot
 */
export async function handleConsultationDecision(
  action: ConsultationDecisionAction,
  ctx: ConsultationDecisionCtx,
  requestMeta: ConsultationDecisionRequestMeta = {},
) {
  let idempotencyRecordId: string | null = null

  try {
    if (action !== 'APPROVE' && action !== 'REJECT') {
      return jsonFail(400, 'Invalid consultation decision action.')
    }

    const auth = await requireClient()
    if (!auth.ok) return auth.res

    const { clientId, user } = auth

    const params = await Promise.resolve(ctx.params)
    const bookingId = pickString(params?.id)
    if (!bookingId) return jsonFail(400, 'Missing booking id.')

    const requestId = pickString(requestMeta.requestId) ?? null
    const idempotencyKey = pickString(requestMeta.idempotencyKey) ?? null

    const booking: ConsultationDecisionBookingRecord | null =
      await prisma.booking.findUnique({
        where: { id: bookingId },
        select: CONSULTATION_DECISION_BOOKING_SELECT,
      })

    if (!booking) return jsonFail(404, 'Booking not found.')
    if (booking.clientId !== clientId) return jsonFail(403, 'Forbidden.')

    const approval = booking.consultationApproval
    if (!approval?.id) {
      return jsonFail(
        409,
        'No consultation proposal found for this booking yet.',
      )
    }

    const requestBody = {
      bookingId,
      clientId,
      actorUserId: user.id,
      professionalId: booking.professionalId,
      approvalId: approval.id,
      action,
    }

const idempotencyRequest = new Request(
  'http://localhost/api/v1/client/bookings/consultation/decision',
  {
    method: 'POST',
    headers: idempotencyKey
      ? {
          'idempotency-key': idempotencyKey,
        }
      : undefined,
  },
)

    const idempotency = await beginRouteIdempotency<JsonObjectPayload>({
      request: idempotencyRequest,
      actor: {
        actorUserId: user.id,
        actorRole: Role.CLIENT,
      },
      route: IDEMPOTENCY_ROUTES.CLIENT_CONSULTATION_DECISION,
      requestLabel: 'client consultation decision',
      requestBody,
      messages: {
        missingKey: 'Missing idempotency key.',
        inProgress:
          'A matching consultation decision request is already in progress.',
        conflict:
          'This idempotency key was already used with a different request body.',
      },
    })

    if (isRouteIdempotencyHandled(idempotency)) {
      return idempotency.response
    }

    const startedIdempotencyRecordId = idempotency.idempotencyRecordId
    idempotencyRecordId = startedIdempotencyRecordId

    try {
      const rl = await enforceRateLimit({
        bucket: 'consultation:decision',
        identity: await rateLimitIdentity(user.id),
        keySuffix: `booking:${bookingId}`,
      })

      if (rl) {
        await failStartedIdempotency(idempotencyRecordId)
        idempotencyRecordId = null

        return rl
      }
    } catch (e: unknown) {
      console.warn('Rate limit skipped (limiter error):', e)
    }

    if (approval.status !== ConsultationApprovalStatus.PENDING) {
      const responseBody = buildDecisionResponseBody({
        bookingId,
        action,
        alreadyDecided: true,
        approval,
      })

      await completeRouteIdempotency({
        idempotencyRecordId: startedIdempotencyRecordId,
        responseStatus: 200,
        responseBody,
      })

      return jsonOk(responseBody, 200)
    }

    if (action === 'APPROVE') {
      const result = await approveConsultationAndMaterializeBooking({
        bookingId,
        clientId,
        professionalId: booking.professionalId,
        requestId,
        idempotencyKey,
      })

      const responseBody = buildDecisionResponseBody({
        bookingId,
        action,
        approval: result.approval,
      })

      await completeRouteIdempotency({
        idempotencyRecordId: startedIdempotencyRecordId,
        responseStatus: 200,
        responseBody,
      })

      await createConsultationDecisionNotification({
        bookingId,
        professionalId: booking.professionalId,
        clientId,
        actorUserId: user.id,
        action,
      })

      // Client approved the consultation — notify the pro now.
      kickNotificationDrain()

      // Live-sync: pro's + client's open screens refetch immediately.
      await broadcastLive(
        [liveChannelForPro(booking.professionalId), liveChannelForUser(user.id)],
        'consultation',
      )

      return jsonOk(responseBody, 200)
    }

    const rejectResult = await prisma.$transaction(async (tx) => {
      const current = await tx.consultationApproval.findUnique({
        where: { bookingId },
        select: CONSULTATION_APPROVAL_SELECT,
      })

      if (!current) {
        throw new Error(
          'Consultation approval disappeared during rejection transaction.',
        )
      }

      if (current.status !== ConsultationApprovalStatus.PENDING) {
        return {
          mutated: false,
          approval: current,
        } as const
      }

      const now = new Date()

      const updatedCount = await tx.consultationApproval.updateMany({
        where: {
          bookingId,
          status: ConsultationApprovalStatus.PENDING,
        },
        data: {
          status: ConsultationApprovalStatus.REJECTED,
          clientId,
          proId: booking.professionalId,
          approvedAt: null,
          rejectedAt: now,
        },
      })

      if (updatedCount.count !== 1) {
        const latest = await tx.consultationApproval.findUnique({
          where: { bookingId },
          select: CONSULTATION_APPROVAL_SELECT,
        })

        if (!latest) {
          throw new Error(
            'Consultation approval missing after rejection race resolution.',
          )
        }

        return {
          mutated: false,
          approval: latest,
        } as const
      }

      const updated = await tx.consultationApproval.findUnique({
        where: { bookingId },
        select: CONSULTATION_APPROVAL_SELECT,
      })

      if (!updated) {
        throw new Error(
          'Consultation approval missing after successful rejection update.',
        )
      }

      await createBookingCloseoutAuditLog({
        tx,
        bookingId,
        professionalId: booking.professionalId,
        action: BookingCloseoutAuditAction.CONSULTATION_REJECTED,
        route:
          'app/api/v1/client/bookings/[id]/consultation/_decision.ts:handleConsultationDecision',
        requestId,
        idempotencyKey,
        oldValue: {
          consultationApproval: buildConsultationApprovalAuditSnapshot(current),
        },
        newValue: {
          consultationApproval: buildConsultationApprovalAuditSnapshot(updated),
        },
      })

      return {
        mutated: true,
        approval: updated,
      } as const
    })

    if (!rejectResult.mutated) {
      const responseBody = buildDecisionResponseBody({
        bookingId,
        action,
        alreadyDecided: true,
        approval: rejectResult.approval,
      })

      await completeRouteIdempotency({
        idempotencyRecordId: startedIdempotencyRecordId,
        responseStatus: 200,
        responseBody,
      })

      return jsonOk(responseBody, 200)
    }

    const responseBody = buildDecisionResponseBody({
      bookingId,
      action,
      approval: rejectResult.approval,
    })

    await completeRouteIdempotency({
      idempotencyRecordId: startedIdempotencyRecordId,
      responseStatus: 200,
      responseBody,
    })

    await createConsultationDecisionNotification({
      bookingId,
      professionalId: booking.professionalId,
      clientId,
      actorUserId: user.id,
      action,
    })

    // Client rejected the consultation — notify the pro now.
    kickNotificationDrain()

    // Live-sync: pro's + client's open screens refetch immediately.
    await broadcastLive(
      [liveChannelForPro(booking.professionalId), liveChannelForUser(user.id)],
      'consultation',
    )

    return jsonOk(responseBody, 200)
  } catch (e: unknown) {
    if (idempotencyRecordId) {
      await failStartedIdempotency(idempotencyRecordId)
    }

    console.error('handleConsultationDecision error', e)
    captureBookingException({
      error: e,
      route: OPERATION,
    })

    return jsonFail(500, 'Internal server error')
  }
}