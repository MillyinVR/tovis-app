// app/api/client/bookings/[id]/consultation/route.ts
import { prisma } from '@/lib/prisma'
import { jsonFail, jsonOk, pickString, upper, requireClient } from '@/app/api/_utils'
import { buildClientBookingDTO } from '@/lib/dto/clientBooking'
import { handleConsultationDecision, type ConsultationDecisionAction, type ConsultationDecisionCtx } from './_decision'

export const dynamic = 'force-dynamic'

type Ctx = ConsultationDecisionCtx & {
  params: Promise<{ id: string }> | { id: string }
}

async function loadBookingDTO(bookingId: string) {
  const b = await prisma.booking.findUnique({
    where: { id: bookingId },
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

  // For this endpoint, we don’t compute unreadAftercare; dashboard/list does that.
  // hasPendingConsultationApproval can be derived but it’s okay to return false here.
  return buildClientBookingDTO({
    booking: b as any,
    unreadAftercare: false,
    hasPendingConsultationApproval: upper(b.consultationApproval?.status) === 'PENDING',
  })
}

export async function GET(_req: Request, ctx: Ctx) {
  try {
    const auth = await requireClient()
    if (auth.res) return auth.res
    const { clientId } = auth

    const { id: rawId } = await Promise.resolve(ctx.params as any)
    const id = pickString(rawId)
    if (!id) return jsonFail(400, 'Missing booking id.')

    // Minimal ownership check (no need to return raw booking)
    const ownership = await prisma.booking.findUnique({
      where: { id },
      select: { id: true, clientId: true },
    })

    if (!ownership) return jsonFail(404, 'Booking not found.')
    if (ownership.clientId !== clientId) return jsonFail(403, 'Forbidden.')

    const approval = await prisma.consultationApproval.findUnique({
      where: { bookingId: id },
      select: {
        id: true,
        status: true,
        proposedServicesJson: true,
        proposedTotal: true,
        notes: true,
        createdAt: true,
        approvedAt: true,
        rejectedAt: true,
      },
    })

    if (!approval) return jsonFail(404, 'No consultation proposal found.')

    const booking = await loadBookingDTO(id)
    if (!booking) return jsonFail(404, 'Booking not found.')

    return jsonOk({ booking, approval })
  } catch (e) {
    console.error('GET /api/client/bookings/[id]/consultation error', e)
    return jsonFail(500, 'Internal server error')
  }
}

export async function POST(req: Request, ctx: Ctx) {
  try {
    const body = (await req.json().catch(() => ({}))) as { action?: unknown }
    const actionRaw = upper(body?.action)

    if (actionRaw !== 'APPROVE' && actionRaw !== 'REJECT') {
      return jsonFail(400, 'Invalid action.')
    }

    const action: ConsultationDecisionAction = actionRaw === 'APPROVE' ? 'APPROVE' : 'REJECT'
    return handleConsultationDecision(action, ctx as ConsultationDecisionCtx)
  } catch (e) {
    console.error('POST /api/client/bookings/[id]/consultation error', e)
    return jsonFail(500, 'Internal server error')
  }
}
