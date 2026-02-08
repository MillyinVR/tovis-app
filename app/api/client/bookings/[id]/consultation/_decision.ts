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
import { buildClientBookingDTO } from '@/lib/dto/clientBooking'
import { BookingStatus, SessionStep } from '@prisma/client'

export type ConsultationDecisionAction = 'APPROVE' | 'REJECT'
export type ConsultationDecisionCtx = { params: { id: string } | Promise<{ id: string }> }

function isFinalBooking(b: { status: BookingStatus; finishedAt: Date | null }) {
  return b.status === BookingStatus.CANCELLED || b.status === BookingStatus.COMPLETED || Boolean(b.finishedAt)
}

/**
 * No legacy:
 * Client decision is only allowed while we are explicitly waiting on the client.
 */
function isAllowedDecisionStep(step: SessionStep | null) {
  return step === SessionStep.CONSULTATION_PENDING_CLIENT
}

async function loadBookingDTO(args: {
  bookingId: string
  unreadAftercare: boolean
  hasPendingConsultationApproval: boolean
}) {
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

  return await buildClientBookingDTO({
    booking: b as any,
    unreadAftercare: Boolean(args.unreadAftercare),
    hasPendingConsultationApproval: Boolean(args.hasPendingConsultationApproval),
  })
}

type ProposedServiceRef = {
  serviceId?: unknown
  offeringId?: unknown
}

/**
 * We don’t want to lock you into one JSON shape.
 * We just extract any {serviceId, offeringId} pairs we can find.
 */
function extractServiceRefsFromProposedJson(v: any): Array<{ serviceId: string | null; offeringId: string | null }> {
  const out: Array<{ serviceId: string | null; offeringId: string | null }> = []

  const visit = (node: any) => {
    if (!node) return
    if (Array.isArray(node)) {
      for (const x of node) visit(x)
      return
    }
    if (typeof node !== 'object') return

    const maybe = node as ProposedServiceRef
    const serviceId = typeof maybe.serviceId === 'string' && maybe.serviceId.trim() ? maybe.serviceId.trim() : null
    const offeringId = typeof maybe.offeringId === 'string' && maybe.offeringId.trim() ? maybe.offeringId.trim() : null

    if (serviceId || offeringId) out.push({ serviceId, offeringId })

    for (const k of Object.keys(node)) visit((node as any)[k])
  }

  visit(v)
  return out
}

async function validateProposedServicesAreFromProOfferings(args: {
  proId: string
  proposedServicesJson: any
}) {
  const refs = extractServiceRefsFromProposedJson(args.proposedServicesJson)

  // If your JSON doesn’t include any IDs, we can’t validate.
  // That’s a contract issue: fix the pro proposal payload to always include serviceId (and ideally offeringId).
  if (!refs.length) {
    return { ok: false as const, error: 'Consultation proposal is missing serviceId/offeringId for validation.' }
  }

  const offerings = await prisma.professionalServiceOffering.findMany({
    where: { professionalId: args.proId, isActive: true },
    select: { id: true, serviceId: true },
    take: 1000,
  })

  const allowedOfferingIds = new Set(offerings.map((o) => String(o.id)))
  const allowedServiceIds = new Set(offerings.map((o) => String(o.serviceId)))

  for (const r of refs) {
    if (r.offeringId && !allowedOfferingIds.has(r.offeringId)) {
      return { ok: false as const, error: 'Consultation includes a service your pro does not offer (offeringId mismatch).' }
    }
    if (r.serviceId && !allowedServiceIds.has(r.serviceId)) {
      return { ok: false as const, error: 'Consultation includes a service your pro does not offer (serviceId mismatch).' }
    }
  }

  return { ok: true as const }
}

export async function handleConsultationDecision(action: ConsultationDecisionAction, ctx: ConsultationDecisionCtx) {
  try {
    const auth = await requireClient()
    if (auth.res) return auth.res
    const { clientId, user } = auth

    const { id } = await Promise.resolve(ctx.params as any)
    const bookingId = pickString(id)
    if (!bookingId) return jsonFail(400, 'Missing booking id.')

    // 🔒 Rate limit per user
    const rl = await enforceRateLimit({
      bucket: 'consultation:decision',
      identity: await rateLimitIdentity(user.id),
      keySuffix: `booking:${bookingId}`,
    })
    if (rl) return rl

    const booking = await prisma.booking.findUnique({
      where: { id: bookingId },
      select: {
        id: true,
        status: true,
        clientId: true,
        professionalId: true,
        sessionStep: true,
        finishedAt: true,
        startedAt: true,

        consultationConfirmedAt: true,

        consultationApproval: {
          select: { id: true, status: true, proposedServicesJson: true },
        },
      },
    })

    if (!booking) return jsonFail(404, 'Booking not found.')
    if (booking.clientId !== clientId) return jsonFail(403, 'Forbidden.')

    if (isFinalBooking({ status: booking.status, finishedAt: booking.finishedAt })) {
      return jsonFail(409, 'This booking is finalized.')
    }

    if (!booking.consultationApproval?.id) {
      return jsonFail(409, 'No consultation proposal found for this booking yet.')
    }

    // ✅ No legacy: must be waiting on client
    if (!isAllowedDecisionStep(booking.sessionStep ?? null)) {
      return jsonFail(409, 'Booking is not waiting for client decision.')
    }

    const approvalStatus = String(booking.consultationApproval.status || '').toUpperCase()

    // Idempotent: return DTO snapshot so UI can refresh safely.
    if (action === 'APPROVE' && approvalStatus === 'APPROVED') {
      const dto = await loadBookingDTO({ bookingId: booking.id, unreadAftercare: false, hasPendingConsultationApproval: false })
      return jsonOk({ alreadyApproved: true, bookingId: booking.id, booking: dto })
    }
    if (action === 'REJECT' && approvalStatus === 'REJECTED') {
      const dto = await loadBookingDTO({ bookingId: booking.id, unreadAftercare: false, hasPendingConsultationApproval: false })
      return jsonOk({ alreadyRejected: true, bookingId: booking.id, booking: dto })
    }

    if (approvalStatus !== 'PENDING') {
      return jsonFail(409, `Consultation is not pending (status=${approvalStatus}).`)
    }

    // ✅ Validate: proposed services must be from pro’s actual offerings
    const proposed = booking.consultationApproval.proposedServicesJson as any
    const valid = await validateProposedServicesAreFromProOfferings({
      proId: booking.professionalId,
      proposedServicesJson: proposed,
    })
    if (!valid.ok) return jsonFail(400, valid.error)

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
            sessionStep: SessionStep.BEFORE_PHOTOS,

            // If you ever have “PENDING” at this stage, accept it.
            // If not, it’s harmless.
            status: booking.status === BookingStatus.PENDING ? BookingStatus.ACCEPTED : booking.status,
          },
          select: { id: true },
        })

        // ✅ notify pro (best effort)
        try {
          await tx.notification.create({
            data: {
              type: 'BOOKING_UPDATE',
              professionalId: booking.professionalId,
              actorUserId: user.id,               // the client user
              bookingId: bookingId,
              title: 'Consultation approved',
              body: 'Client approved the consultation. You can start the service.',
              href: `/pro/bookings/${bookingId}/session/before-photos`,
              dedupeKey: `CONSULT_APPROVED:${bookingId}:${now.toISOString()}`,
            },
          })

        } catch (e) {
          console.error('Pro notification failed (consultation approved):', e)
        }
      })

      const dto = await loadBookingDTO({
        bookingId,
        unreadAftercare: false,
        hasPendingConsultationApproval: false,
      })

      return jsonOk({ bookingId, action: 'APPROVE', booking: dto })
    }

    // REJECT
    await prisma.$transaction(async (tx) => {
      await tx.consultationApproval.update({
        where: { bookingId },
        data: { status: 'REJECTED', rejectedAt: now, approvedAt: null, clientId },
      })

      // back to consult
      await tx.booking.update({
        where: { id: bookingId },
        data: { sessionStep: SessionStep.CONSULTATION, consultationConfirmedAt: null },
        select: { id: true },
      })

      // ✅ notify pro (best effort)
      try {
        await tx.notification.create({
          data: {
            type: 'BOOKING_UPDATE',
            professionalId: booking.professionalId,
            actorUserId: user.id,
            bookingId,
            title: 'Consultation rejected',
            body: 'Client rejected the consultation proposal. Review and resend.',
            href: `/pro/bookings/${bookingId}?step=consult`,
            dedupeKey: `CONSULT_REJECTED:${bookingId}:${now.toISOString()}`,
          },
        })

      } catch (e) {
        console.error('Pro notification failed (consultation rejected):', e)
      }
    })

    const dto = await loadBookingDTO({
      bookingId,
      unreadAftercare: false,
      hasPendingConsultationApproval: false,
    })

    return jsonOk({ bookingId, action: 'REJECT', booking: dto })
  } catch (e) {
    console.error('handleConsultationDecision error', e)
    return jsonFail(500, 'Internal server error')
  }
}
