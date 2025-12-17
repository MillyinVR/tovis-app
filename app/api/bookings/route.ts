// app/api/bookings/route.ts
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

function addMinutes(date: Date, minutes: number) {
  return new Date(date.getTime() + minutes * 60_000)
}

/** existingStart < requestedEnd AND existingEnd > requestedStart */
function overlaps(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date) {
  return aStart < bEnd && aEnd > bStart
}

type BookingSourceNormalized = 'REQUESTED' | 'DISCOVERY' | 'AFTERCARE'
function normalizeSource(v: unknown): BookingSourceNormalized {
  const s = typeof v === 'string' ? v.trim().toUpperCase() : ''
  if (s === 'AFTERCARE') return 'AFTERCARE'
  if (s === 'DISCOVERY') return 'DISCOVERY'
  return 'REQUESTED'
}

type ExistingBookingForConflict = {
  id: string
  scheduledFor: Date
  durationMinutesSnapshot: number | null
  status: unknown
}

export async function POST(request: Request) {
  try {
    const user = await getCurrentUser().catch(() => null)
    if (!user || user.role !== 'CLIENT' || !user.clientProfile?.id) {
      return NextResponse.json({ error: 'Only clients can create bookings.' }, { status: 401 })
    }

    const body = (await request.json().catch(() => ({}))) as any

    const offeringId = pickString(body?.offeringId)
    const scheduledForRaw = body?.scheduledFor
    const holdId = pickString(body?.holdId)
    const source = normalizeSource(body?.source)
    const mediaId = pickString(body?.mediaId) // optional (only if schema supports it)

    if (!offeringId || !scheduledForRaw) {
      return NextResponse.json({ error: 'Missing offering or date/time.' }, { status: 400 })
    }

    // Option A requires holds.
    if (!holdId) {
      return NextResponse.json({ error: 'Hold expired. Please pick a slot again.' }, { status: 409 })
    }

    const scheduledFor = new Date(scheduledForRaw)
    if (!isValidDate(scheduledFor)) {
      return NextResponse.json({ error: 'Invalid date/time.' }, { status: 400 })
    }

    // buffer: don’t allow bookings for the immediate past / immediate now
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

    // Validate hold
    const hold = await prisma.bookingHold.findUnique({
      where: { id: holdId },
      select: { id: true, offeringId: true, professionalId: true, scheduledFor: true, expiresAt: true },
    })

    if (!hold || hold.offeringId !== offeringId) {
      return NextResponse.json({ error: 'Hold not found. Please pick a slot again.' }, { status: 409 })
    }

    if (hold.expiresAt.getTime() <= now.getTime()) {
      return NextResponse.json({ error: 'Hold expired. Please pick a slot again.' }, { status: 409 })
    }

    // Must match time
    if (new Date(hold.scheduledFor).getTime() !== scheduledFor.getTime()) {
      return NextResponse.json({ error: 'Hold mismatch. Please pick a slot again.' }, { status: 409 })
    }

    // Must match professional
    if (hold.professionalId !== offering.professionalId) {
      return NextResponse.json({ error: 'Hold mismatch. Please pick a slot again.' }, { status: 409 })
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
        status: true,
      },
      orderBy: { scheduledFor: 'asc' },
      take: 50,
    })) as ExistingBookingForConflict[]

    const hasConflict = existing.some((b: ExistingBookingForConflict) => {
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

    // Create booking + delete hold atomically
    const booking = await prisma.$transaction(async (tx) => {
      const created = await tx.booking.create({
        data: {
          clientId: user.clientProfile!.id,
          professionalId: offering.professionalId,
          serviceId: offering.serviceId,
          offeringId: offering.id,
          scheduledFor: requestedStart,
          status: initialStatus,
          source,
          priceSnapshot: offering.price,
          durationMinutesSnapshot: offering.durationMinutes,

          // Only include if your Booking model actually has this column:
          // mediaId: mediaId,
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

      await tx.bookingHold.delete({ where: { id: hold.id } })
      return created
    })

    return NextResponse.json({ ok: true, booking }, { status: 201 })
  } catch (e) {
    console.error('POST /api/bookings error:', e)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
