// app/api/client/bookings/[bookingId]/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getCurrentUser } from '@/lib/currentUser'
import type { Prisma } from '@prisma/client'
import { BookingStatus } from '@prisma/client'

export const dynamic = 'force-dynamic'

type Ctx = {
  params: Promise<{
    bookingId: string
  }>
}

type PatchAction = 'cancel' | 'reschedule'

type PatchBody =
  | { action: 'cancel' }
  | { action: 'reschedule'; scheduledFor: string }

type BookingForPatch = Prisma.BookingGetPayload<{
  select: {
    id: true
    clientId: true
    professionalId: true
    scheduledFor: true
    durationMinutesSnapshot: true
    status: true
  }
}>

type ExistingBookingForConflict = Prisma.BookingGetPayload<{
  select: {
    id: true
    scheduledFor: true
    durationMinutesSnapshot: true
  }
}>

function isValidDate(d: Date) {
  return d instanceof Date && !Number.isNaN(d.getTime())
}

function addMinutes(date: Date, minutes: number) {
  return new Date(date.getTime() + minutes * 60_000)
}

/** existingStart < requestedEnd AND existingEnd > requestedStart */
function overlaps(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date) {
  return aStart < bEnd && aEnd > bStart
}

function parseBody(raw: unknown): PatchBody | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>

  const action =
    typeof r.action === 'string' ? (r.action.trim().toLowerCase() as PatchAction) : null

  if (action === 'cancel') return { action: 'cancel' }

  if (action === 'reschedule') {
    const scheduledFor = typeof r.scheduledFor === 'string' ? r.scheduledFor : null
    if (!scheduledFor) return null
    return { action: 'reschedule', scheduledFor }
  }

  return null
}

export async function PATCH(req: NextRequest, ctx: Ctx) {
  try {
    const user = await getCurrentUser().catch(() => null)
    if (!user || user.role !== 'CLIENT' || !user.clientProfile?.id) {
      return NextResponse.json({ error: 'Only clients can update bookings.' }, { status: 401 })
    }

    const { bookingId } = await ctx.params
    if (!bookingId) {
      return NextResponse.json({ error: 'Missing bookingId.' }, { status: 400 })
    }

    const body = parseBody(await req.json().catch(() => null))
    if (!body) {
      return NextResponse.json(
        { error: 'Invalid action. Use { action: "cancel" } or { action: "reschedule", scheduledFor }' },
        { status: 400 },
      )
    }

    const booking = (await prisma.booking.findUnique({
      where: { id: bookingId },
      select: {
        id: true,
        clientId: true,
        professionalId: true,
        scheduledFor: true,
        durationMinutesSnapshot: true,
        status: true,
      },
    })) as BookingForPatch | null

    if (!booking) return NextResponse.json({ error: 'Booking not found.' }, { status: 404 })
    if (booking.clientId !== user.clientProfile.id) {
      return NextResponse.json({ error: 'Forbidden.' }, { status: 403 })
    }

    const now = new Date()
    const start = new Date(booking.scheduledFor)

    const dur = Number(booking.durationMinutesSnapshot ?? 60)
    if (!Number.isFinite(dur) || dur <= 0) {
      return NextResponse.json({ error: 'Booking duration is invalid.' }, { status: 400 })
    }

    // ---- CANCEL ----
    if (body.action === 'cancel') {
      if (booking.status === BookingStatus.CANCELLED) {
        return NextResponse.json({ ok: true, booking }, { status: 200 })
      }
      if (booking.status === BookingStatus.COMPLETED) {
        return NextResponse.json({ error: 'Completed bookings cannot be cancelled.' }, { status: 400 })
      }
      if (start.getTime() < now.getTime()) {
        return NextResponse.json({ error: 'Past bookings cannot be cancelled.' }, { status: 400 })
      }

      const updated = await prisma.booking.update({
        where: { id: booking.id },
        data: { status: BookingStatus.CANCELLED },
        select: { id: true, status: true, scheduledFor: true },
      })

      return NextResponse.json({ ok: true, booking: updated }, { status: 200 })
    }

    // ---- RESCHEDULE ----
    if (booking.status === BookingStatus.CANCELLED || booking.status === BookingStatus.COMPLETED) {
      return NextResponse.json({ error: 'That booking can’t be rescheduled.' }, { status: 400 })
    }

    const nextStart = new Date(body.scheduledFor)
    if (!isValidDate(nextStart)) {
      return NextResponse.json({ error: 'Invalid scheduledFor.' }, { status: 400 })
    }
    if (nextStart.getTime() < now.getTime()) {
      return NextResponse.json({ error: 'Pick a future time.' }, { status: 400 })
    }

    const nextEnd = addMinutes(nextStart, dur)

    // Small window so we don’t scan the universe
    const windowStart = addMinutes(nextStart, -dur * 2)
    const windowEnd = addMinutes(nextStart, dur * 2)

    const existing = (await prisma.booking.findMany({
      where: {
        professionalId: booking.professionalId,
        scheduledFor: { gte: windowStart, lte: windowEnd },
        NOT: { status: BookingStatus.CANCELLED },
      },
      select: { id: true, scheduledFor: true, durationMinutesSnapshot: true },
      orderBy: { scheduledFor: 'asc' },
      take: 100,
    })) as ExistingBookingForConflict[]

    const hasConflict = existing.some((b) => {
      if (b.id === booking.id) return false

      const bStart = new Date(b.scheduledFor)
      const bDur = Number(b.durationMinutesSnapshot ?? 0)
      if (!Number.isFinite(bDur) || bDur <= 0) return false

      const bEnd = addMinutes(bStart, bDur)
      return overlaps(bStart, bEnd, nextStart, nextEnd)
    })

    if (hasConflict) {
      return NextResponse.json({ error: 'That time is no longer available.' }, { status: 409 })
    }

    const updated = await prisma.booking.update({
      where: { id: booking.id },
      data: { scheduledFor: nextStart },
      select: { id: true, status: true, scheduledFor: true },
    })

    return NextResponse.json({ ok: true, booking: updated }, { status: 200 })
  } catch (e) {
    console.error('PATCH /api/client/bookings/[bookingId] error:', e)
    return NextResponse.json({ error: 'Failed to update booking.' }, { status: 500 })
  }
}
