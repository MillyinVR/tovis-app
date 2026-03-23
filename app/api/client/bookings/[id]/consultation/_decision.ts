// app/api/client/bookings/[id]/consultation/_decision.ts
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
import { ConsultationApprovalStatus, NotificationType } from '@prisma/client'

export type ConsultationDecisionAction = 'APPROVE' | 'REJECT'
export type ConsultationDecisionCtx = {
  params: { id: string } | Promise<{ id: string }>
}

function decisionToStatus(
  action: ConsultationDecisionAction,
): ConsultationApprovalStatus {
  return action === 'APPROVE'
    ? ConsultationApprovalStatus.APPROVED
    : ConsultationApprovalStatus.REJECTED
}

async function createConsultationDecisionNotification(args: {
  bookingId: string
  professionalId: string
  actorUserId: string
  action: ConsultationDecisionAction
}): Promise<void> {
  try {
    await prisma.notification.create({
      data: {
        type: NotificationType.BOOKING_UPDATE,
        professionalId: args.professionalId,
        actorUserId: args.actorUserId,
        bookingId: args.bookingId,
        title:
          args.action === 'APPROVE'
            ? 'Consultation approved'
            : 'Consultation rejected',
        body:
          args.action === 'APPROVE'
            ? 'Client approved your consultation proposal.'
            : 'Client rejected your consultation proposal.',
        href: `/pro/bookings/${args.bookingId}?step=consult`,
        dedupeKey: `CONSULT_DECISION:${args.bookingId}:${args.action}`,
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
) {
  try {
    const auth = await requireClient()
    if (!auth.ok) return auth.res
    const { clientId, user } = auth

    const params = await Promise.resolve(ctx.params)
    const bookingId = pickString(params?.id)
    if (!bookingId) return jsonFail(400, 'Missing booking id.')

    // Best-effort rate limit. Do not block approvals if limiter fails.
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

    const booking = await prisma.booking.findUnique({
      where: { id: bookingId },
      select: {
        id: true,
        clientId: true,
        professionalId: true,
        consultationApproval: {
          select: {
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
          },
        },
      },
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

    const now = new Date()
    const nextStatus = decisionToStatus(action)

    const updated = await prisma.$transaction(async (tx) => {
      return tx.consultationApproval.update({
        where: { bookingId },
        data: {
          status: nextStatus,
          clientId,
          proId: booking.professionalId,
          approvedAt: null,
          rejectedAt: now,
        },
        select: {
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
        },
      })
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
      approval: updated,
    })
  } catch (e) {
    console.error('handleConsultationDecision error', e)
    return jsonFail(500, 'Internal server error')
  }
}