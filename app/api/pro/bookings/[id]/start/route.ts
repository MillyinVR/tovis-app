// app/api/pro/bookings/[id]/start/route.ts
import { prisma } from '@/lib/prisma'
import { jsonFail, jsonOk, pickString, requirePro } from '@/app/api/_utils'
import { BookingStatus, SessionStep } from '@prisma/client'

export const dynamic = 'force-dynamic'

type Ctx = { params: { id: string } | Promise<{ id: string }> }

/**
 * Start window: 15 min before -> 15 min after scheduledFor (UTC instants)
 */
function isWithinStartWindow(scheduledFor: Date, now: Date) {
  const start = scheduledFor.getTime() - 15 * 60 * 1000
  const end = scheduledFor.getTime() + 15 * 60 * 1000
  const t = now.getTime()
  return t >= start && t <= end
}

export async function POST(_request: Request, ctx: Ctx) {
  try {
    const auth = await requirePro()
    if (auth.res) return auth.res
    const proId = auth.professionalId

    const { id } = await Promise.resolve(ctx.params)
    const bookingId = pickString(id)
    if (!bookingId) return jsonFail(400, 'Missing booking id.')

    const booking = await prisma.booking.findUnique({
      where: { id: bookingId },
      select: {
        id: true,
        professionalId: true,
        status: true,
        scheduledFor: true,
        startedAt: true,
        finishedAt: true,
        sessionStep: true,
      },
    })

    if (!booking) return jsonFail(404, 'Booking not found.')
    if (booking.professionalId !== proId) return jsonFail(403, 'You can only start your own bookings.')

    if (booking.status === BookingStatus.CANCELLED) return jsonFail(409, 'Cancelled bookings cannot be started.')
    if (booking.status === BookingStatus.COMPLETED || booking.finishedAt) return jsonFail(409, 'This session is already finished.')
    if (booking.status === BookingStatus.PENDING) return jsonFail(409, 'You must accept this appointment before you can start it.')

    const now = new Date()
    if (!isWithinStartWindow(booking.scheduledFor, now)) {
      return jsonFail(409, 'You can start this appointment 15 minutes before or after the scheduled time.')
    }

    // Idempotent
    if (booking.startedAt) {
      return jsonOk(
        {
          ok: true,
          booking: {
            id: booking.id,
            status: booking.status,
            startedAt: booking.startedAt,
            finishedAt: booking.finishedAt,
            sessionStep: booking.sessionStep,
          },
          nextHref: `/pro/bookings/${encodeURIComponent(booking.id)}?step=consult`,
        },
        200,
      )
    }

    const updated = await prisma.booking.update({
      where: { id: booking.id },
      data: { startedAt: now, sessionStep: SessionStep.CONSULTATION },
      select: { id: true, status: true, startedAt: true, finishedAt: true, sessionStep: true },
    })

    return jsonOk(
      {
        ok: true,
        booking: updated,
        nextHref: `/pro/bookings/${encodeURIComponent(updated.id)}?step=consult`,
      },
      200,
    )
  } catch (e) {
    console.error('POST /api/pro/bookings/[id]/start error', e)
    return jsonFail(500, 'Internal server error')
  }
}
