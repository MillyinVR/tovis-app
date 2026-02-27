// app/api/pro/bookings/[id]/start/route.ts
import { prisma } from '@/lib/prisma'
import { jsonFail, jsonOk, pickString, requirePro } from '@/app/api/_utils'
import { BookingStatus, SessionStep } from '@prisma/client'

export const dynamic = 'force-dynamic'

type Ctx = { params: { id: string } | Promise<{ id: string }> }

/**
 * Start window: 15 min before -> 15 min after scheduledFor (UTC instants)
 * NOTE: We only enforce this for sessions that have NOT started yet.
 * Once started, the pro must be able to resume regardless of window.
 */
function isWithinStartWindow(scheduledFor: Date, now: Date) {
  const start = scheduledFor.getTime() - 15 * 60 * 1000
  const end = scheduledFor.getTime() + 15 * 60 * 1000
  const t = now.getTime()
  return t >= start && t <= end
}

function bookingBase(bookingId: string) {
  return `/pro/bookings/${encodeURIComponent(bookingId)}`
}

function sessionHubHref(bookingId: string) {
  return `${bookingBase(bookingId)}/session`
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

    // Terminal guards
    if (booking.status === BookingStatus.CANCELLED) return jsonFail(409, 'Cancelled bookings cannot be started.')
    if (booking.status === BookingStatus.COMPLETED || booking.finishedAt) return jsonFail(409, 'This session is already finished.')

    // Start is only valid for ACCEPTED bookings
    if (booking.status === BookingStatus.PENDING) return jsonFail(409, 'You must accept this appointment before you can start it.')
    if (booking.status === BookingStatus.WAITLIST) return jsonFail(409, 'Waitlist bookings cannot be started.')

    // scheduledFor should exist for a real booking, but guard anyway
    if (!booking.scheduledFor) return jsonFail(409, 'This booking has no scheduled time.')

    const nextHref = sessionHubHref(booking.id)

    // ✅ Idempotent resume: once started, do NOT re-enforce time window.
    // Heal missing step into CONSULTATION so the hub has a stable entry point.
    if (booking.startedAt) {
      const step = booking.sessionStep
      const needsHeal = step == null || step === SessionStep.NONE

      const healed = needsHeal
        ? await prisma.booking.update({
            where: { id: booking.id },
            data: { sessionStep: SessionStep.CONSULTATION },
            select: { id: true, status: true, startedAt: true, finishedAt: true, sessionStep: true },
          })
        : {
            id: booking.id,
            status: booking.status,
            startedAt: booking.startedAt,
            finishedAt: booking.finishedAt,
            sessionStep: booking.sessionStep,
          }

      return jsonOk({ ok: true, booking: healed, nextHref }, 200)
    }

    // ✅ Only enforce start window for first-time start
    const now = new Date()
    if (!isWithinStartWindow(booking.scheduledFor, now)) {
      return jsonFail(409, 'You can start this appointment 15 minutes before or after the scheduled time.')
    }

    const updated = await prisma.booking.update({
      where: { id: booking.id },
      data: { startedAt: now, sessionStep: SessionStep.CONSULTATION },
      select: { id: true, status: true, startedAt: true, finishedAt: true, sessionStep: true },
    })

    return jsonOk({ ok: true, booking: updated, nextHref }, 200)
  } catch (e) {
    console.error('POST /api/pro/bookings/[id]/start error', e)
    return jsonFail(500, 'Internal server error')
  }
}