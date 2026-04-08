import { prisma } from '@/lib/prisma'
import {
  jsonFail,
  jsonOk,
  pickString,
  requireClient,
  enforceRateLimit,
  rateLimitIdentity,
} from '@/app/api/_utils'
import { approveConsultationAndMaterializeBooking } from '@/lib/booking/writeBoundary'
import { createBookingCloseoutAuditLog } from '@/lib/booking/closeoutAudit'
import { createProNotification } from '@/lib/notifications/proNotifications'
import {
  BookingCloseoutAuditAction,
  ConsultationApprovalStatus,
  NotificationEventKey,
  Prisma,
} from '@prisma/client'

export type ConsultationDecisionAction = 'APPROVE' | 'REJECT'

export type ConsultationDecisionCtx = {
  params: { id: string } | Promise<{ id: string }>
}

export type ConsultationDecisionRequestMeta = {
  requestId?: string | null
  idempotencyKey?: string | null
}

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
): {
  title: string
  body: string
  eventKey: NotificationEventKey
} {
  if (action === 'APPROVE') {
    return {
      title: 'Consultation approved',
      body: 'Client approved your consultation proposal.',
      eventKey: NotificationEventKey.CONSULTATION_APPROVED,
    }
  }

  return {
    title: 'Consultation rejected',
    body: 'Client rejected your consultation proposal.',
    eventKey: NotificationEventKey.CONSULTATION_REJECTED,
  }
}

async function createConsultationDecisionNotification(args: {
  bookingId: string
  professionalId: string
  actorUserId: string
  action: ConsultationDecisionAction
}): Promise<void> {
  const meta = getConsultationDecisionNotificationMeta(args.action)

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
  } catch (e) {
    console.error('Pro notification failed (consultation decision):', e)
  }
}

/**
 * Client consultation decision boundary:
 * - ensure client owns booking
 * - ensure consultationApproval exists + is PENDING
 * - APPROVE: materialize approved proposal into canonical Booking state
 * - REJECT: preserve ConsultationApproval as rejected history only
 * - notify pro (best effort)
 * - return updated approval snapshot
 */
export async function handleConsultationDecision(
  action: ConsultationDecisionAction,
  ctx: ConsultationDecisionCtx,
  requestMeta: ConsultationDecisionRequestMeta = {},
) {
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

    try {
      const rl = await enforceRateLimit({
        bucket: 'consultation:decision',
        identity: await rateLimitIdentity(user.id),
        keySuffix: `booking:${bookingId}`,
      })
      if (rl) return rl
    } catch (e) {
      console.warn('Rate limit skipped (limiter error):', e)
    }

    const booking: ConsultationDecisionBookingRecord | null =
      await prisma.booking.findUnique({
        where: { id: bookingId },
        select: CONSULTATION_DECISION_BOOKING_SELECT,
      })

    if (!booking) return jsonFail(404, 'Booking not found.')
    if (booking.clientId !== clientId) return jsonFail(403, 'Forbidden.')

    const approval = booking.consultationApproval
    if (!approval?.id) {
      return jsonFail(409, 'No consultation proposal found for this booking yet.')
    }

    if (approval.status !== ConsultationApprovalStatus.PENDING) {
      return jsonOk({
        bookingId,
        action,
        alreadyDecided: true,
        approval,
      })
    }

    if (action === 'APPROVE') {
      const result = await approveConsultationAndMaterializeBooking({
        bookingId,
        clientId,
        professionalId: booking.professionalId,
        requestId,
        idempotencyKey,
      })

      await createConsultationDecisionNotification({
        bookingId,
        professionalId: booking.professionalId,
        actorUserId: user.id,
        action,
      })

      return jsonOk({
        bookingId,
        action,
        approval: result.approval,
      })
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
          'app/api/client/bookings/[id]/consultation/_decision.ts:handleConsultationDecision',
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
      return jsonOk({
        bookingId,
        action,
        alreadyDecided: true,
        approval: rejectResult.approval,
      })
    }

    await createConsultationDecisionNotification({
      bookingId,
      professionalId: booking.professionalId,
      actorUserId: user.id,
      action,
    })

    return jsonOk({
      bookingId,
      action,
      approval: rejectResult.approval,
    })
  } catch (e) {
    console.error('handleConsultationDecision error', e)
    return jsonFail(500, 'Internal server error')
  }
}