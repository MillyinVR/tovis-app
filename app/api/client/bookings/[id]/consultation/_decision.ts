// app/api/client/bookings/[id]/consultation/_decision.ts
import { prisma } from '@/lib/prisma'
import {
  jsonFail,
  jsonOk,
  pickString,
  upper,
  requireClient,
  enforceRateLimit,
  rateLimitIdentity,
} from '@/app/api/_utils'
import { buildClientBookingDTO } from '@/lib/dto/clientBooking'

export type ConsultationDecisionAction = 'APPROVE' | 'REJECT'
export type ConsultationDecisionCtx = { params: { id: string } | Promise<{ id: string }> }

function isFinalBooking(b: { status: unknown; finishedAt: Date | null }) {
  const s = upper(b.status)
  return s === 'CANCELLED' || s === 'COMPLETED' || Boolean(b.finishedAt)
}

function isAllowedDecisionStep(stepRaw: unknown) {
  const step = upper(stepRaw)
  return step === 'CONSULTATION_PENDING_CLIENT' || step === 'CONSULTATION' || step === 'NONE' || step === ''
}

async function loadBookingDTO(args: { bookingId: string; unreadAftercare: boolean; hasPendingConsultationApproval: boolean }) {
  const b = await prisma.booking.findUnique({
    where: { id: args.bookingId },
    select: {
      id: true,
      status: true,
      source: true,
      sessionStep: true,
      scheduledFor: true,
      finishedAt: true,

      subtotalSnapshot: true,
      totalDurationMinutes: true,
      bufferMinutes: true,

      locationType: true,
      locationId: true,
      locationTimeZone: true,
      locationAddressSnapshot: true,

      service: { select: { id: true, name: true } },

      professional: {
        select: {
          id: true,
          businessName: true,
          location: true,
          timeZone: true,
        },
      },

      location: {
        select: {
          id: true,
          name: true,
          formattedAddress: true,
          city: true,
          state: true,
          timeZone: true,
        },
      },

      serviceItems: {
        orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
        take: 80,
        select: {
          id: true,
          itemType: true,
          parentItemId: true,
          sortOrder: true,
          durationMinutesSnapshot: true,
          priceSnapshot: true,
          serviceId: true,
          service: { select: { name: true } },
        },
      },

      consultationNotes: true,
      consultationPrice: true,
      consultationConfirmedAt: true,

      consultationApproval: {
        select: {
          status: true,
          proposedServicesJson: true,
          proposedTotal: true,
          notes: true,
          approvedAt: true,
          rejectedAt: true,
        },
      },
    },
  })

  if (!b) return null

  return buildClientBookingDTO({
    booking: b as any,
    unreadAftercare: Boolean(args.unreadAftercare),
    hasPendingConsultationApproval: Boolean(args.hasPendingConsultationApproval),
  })
}

export async function handleConsultationDecision(action: ConsultationDecisionAction, ctx: ConsultationDecisionCtx) {
  try {
    const auth = await requireClient()
    if (auth.res) return auth.res
    const { clientId, user } = auth

    // 🔒 Rate limit per user
    const rl = await enforceRateLimit({
      bucket: 'consultation:decision',
      identity: await rateLimitIdentity(user.id),
      keySuffix: `booking:${String((await Promise.resolve(ctx.params as any))?.id ?? '')}`,
    })
    if (rl) return rl

    const { id } = await Promise.resolve(ctx.params as any)
    const bookingId = pickString(id)
    if (!bookingId) return jsonFail(400, 'Missing booking id.')

    const booking = await prisma.booking.findUnique({
      where: { id: bookingId },
      select: {
        id: true,
        status: true,
        clientId: true,
        sessionStep: true,
        finishedAt: true,
        startedAt: true,
        consultationConfirmedAt: true,
        consultationApproval: { select: { id: true, status: true } },
      },
    })

    if (!booking) return jsonFail(404, 'Booking not found.')
    if (booking.clientId !== clientId) return jsonFail(403, 'Forbidden.')

    if (isFinalBooking({ status: booking.status, finishedAt: booking.finishedAt })) {
      return jsonFail(409, 'This booking is finalized.')
    }

    if (booking.startedAt) return jsonFail(409, 'This booking has started and cannot be changed.')

    if (!booking.consultationApproval?.id) {
      return jsonFail(409, 'No consultation proposal found for this booking yet.')
    }

    const approvalStatus = upper(booking.consultationApproval.status)

    // Idempotent: still return DTO snapshot so UI can refresh safely.
    if (action === 'APPROVE' && approvalStatus === 'APPROVED') {
      const dto = await loadBookingDTO({ bookingId: booking.id, unreadAftercare: false, hasPendingConsultationApproval: false })
      return jsonOk({
        alreadyApproved: true,
        bookingId: booking.id,
        booking: dto,
      })
    }

    if (action === 'REJECT' && approvalStatus === 'REJECTED') {
      const dto = await loadBookingDTO({ bookingId: booking.id, unreadAftercare: false, hasPendingConsultationApproval: false })
      return jsonOk({
        alreadyRejected: true,
        bookingId: booking.id,
        booking: dto,
      })
    }

    if (action === 'REJECT' && approvalStatus === 'APPROVED') {
      return jsonFail(409, 'Consultation is already approved.')
    }

    if (approvalStatus !== 'PENDING') {
      return jsonFail(409, `Consultation is not pending (status=${approvalStatus}).`)
    }

    if (!isAllowedDecisionStep(booking.sessionStep)) {
      const step = upper(booking.sessionStep) || 'UNKNOWN'
      return jsonFail(409, `Booking is not waiting for client decision (step=${step}).`)
    }

    const now = new Date()

    if (action === 'APPROVE') {
      await prisma.$transaction(async (tx) => {
        await tx.consultationApproval.update({
          where: { bookingId },
          data: { status: 'APPROVED', approvedAt: now, rejectedAt: null, clientId },
        })

        await tx.booking.update({
          where: { id: bookingId },
          data: {
            consultationConfirmedAt: now,
            sessionStep: 'BEFORE_PHOTOS',
            status: upper(booking.status) === 'PENDING' ? 'ACCEPTED' : (booking.status as any),
          },
          select: { id: true },
        })
      })

      const dto = await loadBookingDTO({
        bookingId,
        unreadAftercare: false,
        hasPendingConsultationApproval: false,
      })

      return jsonOk({
        bookingId,
        action: 'APPROVE',
        booking: dto,
      })
    }

    // REJECT
    await prisma.$transaction(async (tx) => {
      await tx.consultationApproval.update({
        where: { bookingId },
        data: { status: 'REJECTED', rejectedAt: now, approvedAt: null, clientId },
      })

      await tx.booking.update({
        where: { id: bookingId },
        data: { sessionStep: 'CONSULTATION', consultationConfirmedAt: null },
        select: { id: true },
      })
    })

    const dto = await loadBookingDTO({
      bookingId,
      unreadAftercare: false,
      hasPendingConsultationApproval: false,
    })

    return jsonOk({
      bookingId,
      action: 'REJECT',
      booking: dto,
    })
  } catch (e) {
    console.error('handleConsultationDecision error', e)
    return jsonFail(500, 'Internal server error')
  }
}
