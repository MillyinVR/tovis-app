// app/api/pro/bookings/[id]/start/route.ts
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getCurrentUser } from '@/lib/currentUser'
import { BookingStatus } from '@prisma/client'

export const dynamic = 'force-dynamic'

type Ctx = { params: { id: string } | Promise<{ id: string }> }

function trimmed(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null
}

function jsonError(message: string, status: number) {
  return NextResponse.json({ ok: false, error: message }, { status })
}

/**
 * Start window: 15 min before -> 15 min after scheduledFor
 * scheduledFor is stored as a UTC instant. "Now" is also a UTC instant.
 * This is correct and timezone-safe.
 */
function isWithinStartWindow(scheduledFor: Date, now: Date) {
  const start = scheduledFor.getTime() - 15 * 60 * 1000
  const end = scheduledFor.getTime() + 15 * 60 * 1000
  const t = now.getTime()
  return t >= start && t <= end
}

export async function POST(_request: Request, ctx: Ctx) {
  try {
    const { id } = await Promise.resolve(ctx.params)
    const bookingId = trimmed(id)
    if (!bookingId) return jsonError('Missing booking id.', 400)

    const user = await getCurrentUser().catch(() => null)
    const proId = user?.role === 'PRO' ? user.professionalProfile?.id : null
    if (!proId) return jsonError('Not authorized.', 401)

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

    if (!booking) return jsonError('Booking not found.', 404)
    if (booking.professionalId !== proId) return jsonError('You can only start your own bookings.', 403)

    // ✅ Canonical status checks (no string guessing)
    if (booking.status === BookingStatus.CANCELLED) {
      return jsonError('Cancelled bookings cannot be started.', 409)
    }

    if (booking.status === BookingStatus.COMPLETED || booking.finishedAt) {
      return jsonError('This session is already finished.', 409)
    }

    // ✅ Hard rule: must accept before start
    if (booking.status === BookingStatus.PENDING) {
      return jsonError('You must accept this appointment before you can start it.', 409)
    }

    const now = new Date()

    // ✅ Enforce start window
    if (!isWithinStartWindow(booking.scheduledFor, now)) {
      return jsonError('You can start this appointment 15 minutes before or after the scheduled time.', 409)
    }

    // ✅ Idempotent start
    if (booking.startedAt) {
      return NextResponse.json(
        {
          ok: true,
          booking: {
            id: booking.id,
            status: booking.status,
            startedAt: booking.startedAt,
            finishedAt: booking.finishedAt,
            sessionStep: booking.sessionStep,
          },
          nextHref: null,
        },
        { status: 200 },
      )
    }

    // ✅ Start begins consultation
    const updated = await prisma.booking.update({
      where: { id: booking.id },
      data: {
        startedAt: now,
        sessionStep: 'CONSULTATION' as any,
      },
      select: {
        id: true,
        status: true,
        startedAt: true,
        finishedAt: true,
        sessionStep: true,
      },
    })

    return NextResponse.json(
      {
        ok: true,
        booking: updated,
        nextHref: null,
      },
      { status: 200 },
    )
  } catch (err) {
    console.error('POST /api/pro/bookings/[id]/start error', err)
    return NextResponse.json({ ok: false, error: 'Internal server error' }, { status: 500 })
  }
}
