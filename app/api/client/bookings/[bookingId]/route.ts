// app/api/client/bookings/[bookingId]/route.ts
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getCurrentUser } from '@/lib/currentUser'

export const dynamic = 'force-dynamic'

function isValidDate(d: Date) {
  return d instanceof Date && !Number.isNaN(d.getTime())
}

function addMinutes(date: Date, minutes: number) {
  return new Date(date.getTime() + minutes * 60_000)
}

/**
 * existingStart < requestedEnd AND existingEnd > requestedStart
 */
function overlaps(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date) {
  return aStart < bEnd && aEnd > bStart
}

export async function PATCH(req: Request, { params }: { params: { bookingId: string } }) {
  try {
    const user = await getCurrentUser().catch(() => null)
    if (!user || user.role !== 'CLIENT' || !user.clientProfile?.id) {
      return NextResponse.json({ error: 'Only clients can update bookings.' }, { status: 401 })
    }

    const bookingId = params.bookingId
    if (!bookingId) return NextResponse.json({ error: 'Missing bookingId.' }, { status: 400 })

    const body = await req.json().catch(() => ({} as any))
    const action = typeof body?.action === 'string' ? body.action.trim().toLowerCase() : ''

    const booking = await prisma.booking.findUnique({
      where: { id: bookingId },
      select: {
        id: true,
        clientId: true,
        professionalId: true,
        scheduledFor: true,
        durationMinutesSnapshot: true,
        status: true,
      },
    })

    if (!booking) return NextResponse.json({ error: 'Booking not found.' }, { status: 404 })
    if (booking.clientId !== user.clientProfile.id) {
      return NextResponse.json({ error: 'Forbidden.' }, { status: 403 })
    }

    const now = new Date()
    const start = new Date(booking.scheduledFor)
    const dur = Number(booking.durationMinutesSnapshot || 60)
    const statusUpper = String(booking.status || '').toUpperCase()

    // ---- CANCEL ----
    if (action === 'cancel') {
      if (statusUpper === 'CANCELLED') {
        return NextResponse.json({ ok: true, booking }, { status: 200 })
      }
      if (statusUpper === 'COMPLETED') {
        return NextResponse.json({ error: 'Completed bookings cannot be cancelled.' }, { status: 400 })
      }
      if (start.getTime() < now.getTime()) {
        return NextResponse.json({ error: 'Past bookings cannot be cancelled.' }, { status: 400 })
      }

      const updated = await prisma.booking.update({
        where: { id: booking.id },
        data: { status: 'CANCELLED' as any },
        select: { id: true, status: true, scheduledFor: true },
      })

      return NextResponse.json({ ok: true, booking: updated }, { status: 200 })
    }

    // ---- RESCHEDULE ----
    if (action === 'reschedule') {
      if (statusUpper === 'CANCELLED' || statusUpper === 'COMPLETED') {
        return NextResponse.json({ error: 'That booking can’t be rescheduled.' }, { status: 400 })
      }

      const scheduledForRaw = body?.scheduledFor
      const nextStart = new Date(scheduledForRaw)
      if (!isValidDate(nextStart)) return NextResponse.json({ error: 'Invalid scheduledFor.' }, { status: 400 })
      if (nextStart.getTime() < now.getTime()) return NextResponse.json({ error: 'Pick a future time.' }, { status: 400 })

      const nextEnd = addMinutes(nextStart, dur)

      const windowStart = addMinutes(nextStart, -dur * 2)
      const windowEnd = addMinutes(nextStart, dur * 2)

      const existing = await prisma.booking.findMany({
        where: {
          professionalId: booking.professionalId,
          scheduledFor: { gte: windowStart, lte: windowEnd },
          NOT: { status: 'CANCELLED' as any },
        },
        select: { id: true, scheduledFor: true, durationMinutesSnapshot: true },
        orderBy: { scheduledFor: 'asc' },
        take: 100,
      })

      const hasConflict = existing.some((b) => {
        if (b.id === booking.id) return false
        const bStart = new Date(b.scheduledFor)
        const bDur = Number(b.durationMinutesSnapshot || 0)
        if (!Number.isFinite(bDur) || bDur <= 0) return false
        const bEnd = addMinutes(bStart, bDur)
        return overlaps(bStart, bEnd, nextStart, nextEnd)
      })

      if (hasConflict) return NextResponse.json({ error: 'That time is no longer available.' }, { status: 409 })

      const updated = await prisma.booking.update({
        where: { id: booking.id },
        data: { scheduledFor: nextStart },
        select: { id: true, status: true, scheduledFor: true },
      })

      return NextResponse.json({ ok: true, booking: updated }, { status: 200 })
    }

    return NextResponse.json(
      { error: 'Invalid action. Use { action: "cancel" } or { action: "reschedule", scheduledFor }' },
      { status: 400 },
    )
  } catch (e) {
    console.error('PATCH /api/client/bookings/[bookingId] error:', e)
    return NextResponse.json({ error: 'Failed to update booking.' }, { status: 500 })
  }
}
