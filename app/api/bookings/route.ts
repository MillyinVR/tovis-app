// app/api/bookings/route.ts
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getCurrentUser } from '@/lib/currentUser'

export const dynamic = 'force-dynamic'

type BookingSourceNormalized = 'REQUESTED' | 'DISCOVERY' | 'AFTERCARE'

type CreateBookingBody = {
  offeringId?: unknown
  scheduledFor?: unknown
  holdId?: unknown // optional (Option A)
  source?: unknown
  mediaId?: unknown // optional (only if your schema has it)
}

type ExistingBookingForConflict = {
  id: string
  scheduledFor: Date
  durationMinutesSnapshot: number | null
}

function pickString(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null
}

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

function normalizeSource(v: unknown): BookingSourceNormalized {
  const s = typeof v === 'string' ? v.trim().toUpperCase() : ''
  if (s === 'AFTERCARE') return 'AFTERCARE'
  if (s === 'DISCOVERY') return 'DISCOVERY'
  return 'REQUESTED'
}

export async function POST(request: Request) {
  try {
    const user = await getCurrentUser().catch(() => null)
    if (!user || user.role !== 'CLIENT' || !user.clientProfile?.id) {
      return NextResponse.json({ error: 'Only clients can create bookings.' }, { status: 401 })
    }

    const body = (await request.json().catch(() => ({}))) as CreateBookingBody

    const offeringId = pickString(body.offeringId)
    const scheduledForRaw = body.scheduledFor
    const holdId = pickString(body.holdId) // Option A if present
    const useHolds = Boolean(holdId)
    const source = normalizeSource(body.source)
    const mediaId = pickString(body.mediaId) // only if your Booking model has it

    if (!offeringId || !scheduledForRaw) {
      return NextResponse.json({ error: 'Missing offering or date/time.' }, { status: 400 })
    }

    const scheduledFor = new Date(String(scheduledForRaw))
    if (!isValidDate(scheduledFor)) {
      return NextResponse.json({ error: 'Invalid date/time.' }, { status: 400 })
    }

    // buffer: don’t allow bookings in the immediate past / immediate now
    const BUFFER_MINUTES = 5
    if (scheduledFor.getTime() < addMinutes(new Date(), BUFFER_MINUTES).getTime()) {
      return NextResponse.json({ error: 'Please select a future time.' }, { status: 400 })
    }

    // Load offering
    const offering = await prisma.professionalServiceOffering.findUnique({
      where: { id: offeringId },
      select: {
        id: true,
        isActive: true,
        professionalId: true,
        serviceId: true,
        price: true,
        durationMinutes: true,
        professional: { select: { autoAcceptBookings: true } },
      },
    })

    if (!offering || !offering.isActive) {
      return NextResponse.json({ error: 'Invalid or inactive offering.' }, { status: 400 })
    }

    const duration = Number(offering.durationMinutes || 0)
    if (!Number.isFinite(duration) || duration <= 0) {
      return NextResponse.json({ error: 'Offering duration is invalid.' }, { status: 400 })
    }

    const now = new Date()

    // Option A: validate hold if provided
    let holdToDeleteId: string | null = null
    if (useHolds) {
      const hold = await prisma.bookingHold.findUnique({
        where: { id: holdId! },
        select: { id: true, offeringId: true, professionalId: true, scheduledFor: true, expiresAt: true },
      })

      if (!hold || hold.offeringId !== offeringId) {
        return NextResponse.json({ error: 'Hold not found. Please pick a slot again.' }, { status: 409 })
      }

      if (hold.expiresAt.getTime() <= now.getTime()) {
        return NextResponse.json({ error: 'Hold expired. Please pick a slot again.' }, { status: 409 })
      }

      if (new Date(hold.scheduledFor).getTime() !== scheduledFor.getTime()) {
        return NextResponse.json({ error: 'Hold mismatch. Please pick a slot again.' }, { status: 409 })
      }

      if (hold.professionalId !== offering.professionalId) {
        return NextResponse.json({ error: 'Hold mismatch. Please pick a slot again.' }, { status: 409 })
      }

      holdToDeleteId = hold.id
    }

    const requestedStart = scheduledFor
    const requestedEnd = addMinutes(requestedStart, duration)

    // Avoid scanning entire calendar
    const windowStart = addMinutes(requestedStart, -duration * 2)
    const windowEnd = addMinutes(requestedStart, duration * 2)

    const existing = (await prisma.booking.findMany({
      where: {
        professionalId: offering.professionalId,
        scheduledFor: { gte: windowStart, lte: windowEnd },
        NOT: { status: 'CANCELLED' as any },
      },
      select: {
        id: true,
        scheduledFor: true,
        durationMinutesSnapshot: true,
      },
      orderBy: { scheduledFor: 'asc' },
      take: 50,
    })) as ExistingBookingForConflict[]

    const hasConflict = existing.some((b) => {
      const bDur = Number(b.durationMinutesSnapshot || 0)
      if (!Number.isFinite(bDur) || bDur <= 0) return false
      const bStart = new Date(b.scheduledFor)
      const bEnd = addMinutes(bStart, bDur)
      return overlaps(bStart, bEnd, requestedStart, requestedEnd)
    })

    if (hasConflict) {
      return NextResponse.json(
        { error: 'That time is no longer available. Please select a different slot.' },
        { status: 409 },
      )
    }

    const autoAccept = Boolean(offering.professional?.autoAcceptBookings)
    const initialStatus = autoAccept ? ('ACCEPTED' as any) : ('PENDING' as any)

    // Build transaction ops (Option B = booking only, Option A = booking + delete hold)
    const createBookingOp = prisma.booking.create({
      data: {
        clientId: user.clientProfile.id,
        professionalId: offering.professionalId,
        serviceId: offering.serviceId,
        offeringId: offering.id,

        scheduledFor: requestedStart,
        status: initialStatus,
        source,

        priceSnapshot: offering.price,
        durationMinutesSnapshot: offering.durationMinutes,

        // Only add this if your Booking model actually has the column:
        // mediaId,
      },
      select: {
        id: true,
        status: true,
        scheduledFor: true,
        professionalId: true,
        serviceId: true,
        offeringId: true,
        source: true,
      },
    })

    const ops = holdToDeleteId
      ? [createBookingOp, prisma.bookingHold.delete({ where: { id: holdToDeleteId } })]
      : [createBookingOp]

    const [booking] = await prisma.$transaction(ops)

    return NextResponse.json({ ok: true, booking }, { status: 201 })
  } catch (e) {
    console.error('POST /api/bookings error:', e)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
