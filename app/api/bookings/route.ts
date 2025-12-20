// app/api/bookings/route.ts
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getCurrentUser } from '@/lib/currentUser'

export const dynamic = 'force-dynamic'

type BookingSourceNormalized = 'REQUESTED' | 'DISCOVERY' | 'AFTERCARE'

type CreateBookingBody = {
  offeringId?: unknown
  scheduledFor?: unknown
  holdId?: unknown
  source?: unknown

  // Optional if your Booking model has it
  mediaId?: unknown

  // Optional: booking is claiming a last-minute opening
  openingId?: unknown
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
  if (s === 'REQUESTED') return 'REQUESTED'
  return 'REQUESTED'
}

export async function POST(request: Request) {
  try {
    const user = await getCurrentUser().catch(() => null)
    if (!user || user.role !== 'CLIENT' || !user.clientProfile?.id) {
      return NextResponse.json({ error: 'Only clients can create bookings.' }, { status: 401 })
    }

    const clientId = user.clientProfile.id

    const body = (await request.json().catch(() => ({}))) as CreateBookingBody

    const offeringId = pickString(body.offeringId)
    const scheduledForRaw = body.scheduledFor
    const holdId = pickString(body.holdId)
    const source = normalizeSource(body.source)

    // optional only if your schema supports it
    const mediaId = pickString(body.mediaId)

    // opening claim
    const openingId = pickString(body.openingId)

    if (!offeringId || !scheduledForRaw) {
      return NextResponse.json({ error: 'Missing offering or date/time.' }, { status: 400 })
    }

    const scheduledFor = new Date(String(scheduledForRaw))
    if (!isValidDate(scheduledFor)) {
      return NextResponse.json({ error: 'Invalid date/time.' }, { status: 400 })
    }

    // Buffer: don’t allow immediate-now bookings
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
    if (holdId) {
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

      if (new Date(hold.scheduledFor).getTime() !== scheduledFor.getTime()) {
        return NextResponse.json({ error: 'Hold mismatch. Please pick a slot again.' }, { status: 409 })
      }

      if (hold.professionalId !== offering.professionalId) {
        return NextResponse.json({ error: 'Hold mismatch. Please pick a slot again.' }, { status: 409 })
      }

      holdToDeleteId = hold.id
    }

    // If claiming an opening, do a fast pre-check (real enforcement happens in the transaction)
    if (openingId) {
      const opening = await prisma.lastMinuteOpening.findUnique({
        where: { id: openingId },
        select: {
          id: true,
          status: true,
          startAt: true,
          professionalId: true,
          offeringId: true,
          serviceId: true,
        },
      })

      if (!opening) return NextResponse.json({ error: 'Opening not found.' }, { status: 404 })
      if (opening.status !== 'ACTIVE') {
        return NextResponse.json({ error: 'That opening is no longer available.' }, { status: 409 })
      }

      if (opening.professionalId !== offering.professionalId) {
        return NextResponse.json({ error: 'Opening mismatch.' }, { status: 409 })
      }

      if (opening.offeringId && opening.offeringId !== offering.id) {
        return NextResponse.json({ error: 'Opening mismatch.' }, { status: 409 })
      }
      if (opening.serviceId && opening.serviceId !== offering.serviceId) {
        return NextResponse.json({ error: 'Opening mismatch.' }, { status: 409 })
      }

      if (new Date(opening.startAt).getTime() !== scheduledFor.getTime()) {
        return NextResponse.json({ error: 'Opening time mismatch.' }, { status: 409 })
      }
    }

    const requestedStart = scheduledFor
    const requestedEnd = addMinutes(requestedStart, duration)

    // Conflict scan window (tight, cheap)
    const windowStart = addMinutes(requestedStart, -duration * 2)
    const windowEnd = addMinutes(requestedStart, duration * 2)

    const existing = (await prisma.booking.findMany({
      where: {
        professionalId: offering.professionalId,
        scheduledFor: { gte: windowStart, lte: windowEnd },
        NOT: { status: 'CANCELLED' },
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
    const initialStatus = autoAccept ? 'ACCEPTED' : 'PENDING'

    // Transaction: claim opening (if any) + create booking + delete hold (if any) + mark notification booked
    const booking = await prisma.$transaction(async (tx) => {
      if (openingId) {
        // Enforce opening is still ACTIVE and matches the booking we’re about to create.
        // This is what prevents “two clients booked the same opening.”
        const activeOpening = await tx.lastMinuteOpening.findFirst({
          where: { id: openingId, status: 'ACTIVE' },
          select: {
            id: true,
            startAt: true,
            professionalId: true,
            offeringId: true,
            serviceId: true,
          },
        })

        if (!activeOpening) throw new Error('OPENING_NOT_AVAILABLE')

        if (activeOpening.professionalId !== offering.professionalId) throw new Error('OPENING_NOT_AVAILABLE')
        if (activeOpening.offeringId && activeOpening.offeringId !== offering.id) throw new Error('OPENING_NOT_AVAILABLE')
        if (activeOpening.serviceId && activeOpening.serviceId !== offering.serviceId) throw new Error('OPENING_NOT_AVAILABLE')
        if (new Date(activeOpening.startAt).getTime() !== requestedStart.getTime()) throw new Error('OPENING_NOT_AVAILABLE')

        const updated = await tx.lastMinuteOpening.updateMany({
          where: { id: openingId, status: 'ACTIVE' },
          data: { status: 'BOOKED' },
        })
        if (updated.count !== 1) throw new Error('OPENING_NOT_AVAILABLE')
      }

      const created = await tx.booking.create({
        data: {
          clientId,
          professionalId: offering.professionalId,
          serviceId: offering.serviceId,
          offeringId: offering.id,

          scheduledFor: requestedStart,
          status: initialStatus,
          source,

          priceSnapshot: offering.price,
          durationMinutesSnapshot: offering.durationMinutes,

          // Only include if your Booking model has it
          // mediaId: mediaId ?? null,

          // If you later add booking.openingId in schema, this is where it goes:
          // openingId: openingId ?? null,
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

      // Mark the client’s notification as “booked” (if they came from a notification or the opening exists in their feed).
      if (openingId) {
        await tx.openingNotification.updateMany({
          where: {
            clientId,
            openingId,
            bookedAt: null,
          },
          data: {
            bookedAt: new Date(),
          },
        })
      }

      if (holdToDeleteId) {
        await tx.bookingHold.delete({ where: { id: holdToDeleteId } })
      }

      return created
    })

    return NextResponse.json({ ok: true, booking }, { status: 201 })
  } catch (e: any) {
    if (e?.message === 'OPENING_NOT_AVAILABLE') {
      return NextResponse.json({ error: 'That opening was just taken. Please pick another slot.' }, { status: 409 })
    }

    console.error('POST /api/bookings error:', e)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
