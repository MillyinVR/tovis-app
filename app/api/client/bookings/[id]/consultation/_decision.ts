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
import { ConsultationApprovalStatus, NotificationType } from '@prisma/client'

export type ConsultationDecisionAction = 'APPROVE' | 'REJECT'
export type ConsultationDecisionCtx = { params: { id: string } | Promise<{ id: string }> }

function decisionToStatus(action: ConsultationDecisionAction): ConsultationApprovalStatus {
  return action === 'APPROVE' ? ConsultationApprovalStatus.APPROVED : ConsultationApprovalStatus.REJECTED
}

/**
 * Strictly:
 * - ensure client owns booking
 * - ensure consultationApproval exists + is PENDING
 * - write APPROVED/REJECTED timestamps + clientId (+ proId for convenience)
 * - notify pro (best effort)
 * - return the updated approval snapshot
 *
 * NO booking status/sessionStep mutation.
 * NO proposed services validation.
 */
export async function handleConsultationDecision(action: ConsultationDecisionAction, ctx: ConsultationDecisionCtx) {
  try {
    const auth = await requireClient()
    if (!auth.ok) return auth.res
    const { clientId, user } = auth

    const params = await Promise.resolve(ctx.params)
    const bookingId = pickString(params?.id)
    if (!bookingId) return jsonFail(400, 'Missing booking id.')

    // 🔒 Rate limit (best-effort): if Upstash goes down, do NOT break approvals.
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
    if (!approval?.id) return jsonFail(409, 'No consultation proposal found for this booking yet.')

    if (approval.status !== ConsultationApprovalStatus.PENDING) {
      // Idempotent behavior: if they click again, just return current state.
      return jsonOk({
        bookingId,
        action,
        alreadyDecided: true,
        approval,
      })
    }

    const now = new Date()
    const nextStatus = decisionToStatus(action)

    const updated = await prisma.$transaction(async (tx) => {
      const a = await tx.consultationApproval.update({
        where: { bookingId }, // bookingId is @unique in your schema
        data: {
          status: nextStatus,
          clientId,
          proId: booking.professionalId,

          approvedAt: action === 'APPROVE' ? now : null,
          rejectedAt: action === 'REJECT' ? now : null,
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

      // ✅ notify pro (best effort)
      try {
        await tx.notification.create({
          data: {
            type: NotificationType.BOOKING_UPDATE,
            professionalId: booking.professionalId,
            actorUserId: user.id,
            bookingId,
            title: action === 'APPROVE' ? 'Consultation approved' : 'Consultation rejected',
            body:
              action === 'APPROVE'
                ? 'Client approved your consultation proposal.'
                : 'Client rejected your consultation proposal.',
            href: `/pro/bookings/${bookingId}?step=consult`,
            dedupeKey: `CONSULT_DECISION:${bookingId}:${action}`,
          },
        })
      } catch (e) {
        console.error('Pro notification failed (consultation decision):', e)
      }

      return a
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