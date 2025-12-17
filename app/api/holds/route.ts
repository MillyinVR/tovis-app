// app/api/holds/route.ts
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getCurrentUser } from '@/lib/currentUser'

export const dynamic = 'force-dynamic'

function pickString(v: unknown) {
  return typeof v === 'string' && v.trim() ? v.trim() : null
}

function isValidDate(d: Date) {
  return d instanceof Date && !Number.isNaN(d.getTime())
}

function addMinutes(d: Date, minutes: number) {
  return new Date(d.getTime() + minutes * 60_000)
}

/** existingStart < requestedEnd AND existingEnd > requestedStart */
function overlaps(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date) {
  return aStart < bEnd && aEnd > bStart
}

export async function POST(req: Request) {
  try {
    const user = await getCurrentUser().catch(() => null)
    if (!user || user.role !== 'CLIENT') {
      return NextResponse.json({ error: 'Only clients can hold slots.' }, { status: 401 })
    }

    const body = await req.json().catch(() => ({} as any))
    const offeringId = pickString(body?.offeringId)
    const scheduledForRaw = body?.scheduledFor

    if (!offeringId || !scheduledForRaw) {
      return NextResponse.json({ error: 'Missing offeringId or scheduledFor.' }, { status: 400 })
    }

    const scheduledFor = new Date(scheduledForRaw)
    if (!isValidDate(scheduledFor)) {
      return NextResponse.json({ error: 'Invalid scheduledFor.' }, { status: 400 })
    }

    const BUFFER_MINUTES = 5
    if (scheduledFor.getTime() < addMinutes(new Date(), BUFFER_MINUTES).getTime()) {
      return NextResponse.json({ error: 'Please select a future time.' }, { status: 400 })
    }

    const offering = await prisma.professionalServiceOffering.findUnique({
      where: { id: offeringId },
      select: {
        id: true,
        isActive: true,
        professionalId: true,
        durationMinutes: true,
      },
    })

    if (!offering || !offering.isActive) {
      return NextResponse.json({ error: 'Invalid or inactive offering.' }, { status: 400 })
    }

    const duration = Number(offering.durationMinutes || 0)
    if (!Number.isFinite(duration) || duration <= 0) {
      return NextResponse.json({ error: 'Offering duration is invalid.' }, { status: 400 })
    }

    const requestedStart = scheduledFor
    const requestedEnd = addMinutes(requestedStart, duration)

    // booking conflict check
    const windowStart = addMinutes(requestedStart, -duration * 2)
    const windowEnd = addMinutes(requestedStart, duration * 2)

    const existingBookings = await prisma.booking.findMany({
      where: {
        professionalId: offering.professionalId,
        scheduledFor: { gte: windowStart, lte: windowEnd },
        NOT: { status: 'CANCELLED' as any },
      },
      select: { scheduledFor: true, durationMinutesSnapshot: true },
      take: 50,
    })

    const bookingConflict = existingBookings.some((b) => {
      const bDur = Number(b.durationMinutesSnapshot || 0)
      if (!Number.isFinite(bDur) || bDur <= 0) return false
      const bStart = new Date(b.scheduledFor)
      const bEnd = addMinutes(bStart, bDur)
      return overlaps(bStart, bEnd, requestedStart, requestedEnd)
    })

    if (bookingConflict) {
      return NextResponse.json({ error: 'That time was just taken.' }, { status: 409 })
    }

    // active hold conflict check
    const now = new Date()
    const activeHold = await prisma.bookingHold.findFirst({
      where: {
        professionalId: offering.professionalId,
        scheduledFor: requestedStart,
        expiresAt: { gt: now },
      },
      select: { id: true },
    })

    if (activeHold) {
      return NextResponse.json({ error: 'Someone is already holding that time. Try another slot.' }, { status: 409 })
    }

    const expiresAt = addMinutes(now, 10)

    const hold = await prisma.bookingHold.create({
      data: {
        offeringId: offering.id,
        professionalId: offering.professionalId,
        scheduledFor: requestedStart,
        expiresAt,
      },
      select: { id: true, expiresAt: true },
    })

    return NextResponse.json({ ok: true, holdId: hold.id, holdUntil: hold.expiresAt.getTime() }, { status: 201 })
  } catch (e) {
    console.error('POST /api/holds error', e)
    return NextResponse.json({ error: 'Failed to create hold.' }, { status: 500 })
  }
}
