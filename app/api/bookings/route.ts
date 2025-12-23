// app/api/bookings/route.ts
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getCurrentUser } from '@/lib/currentUser'
import type { ServiceLocationType } from '@prisma/client'

export const dynamic = 'force-dynamic'

type BookingSourceNormalized = 'REQUESTED' | 'DISCOVERY' | 'AFTERCARE'

type CreateBookingBody = {
  offeringId?: unknown
  scheduledFor?: unknown
  holdId?: unknown
  source?: unknown
  locationType?: unknown
  mediaId?: unknown // NOTE: NOT stored on Booking model; used only for intent/waitlist patterns if needed
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

function normalizeLocationType(v: unknown): ServiceLocationType {
  const s = typeof v === 'string' ? v.trim().toUpperCase() : ''
  if (s === 'MOBILE') return 'MOBILE'
  return 'SALON'
}

export async function POST(request: Request) {
  try {
    const user = await getCurrentUser().catch(() => null)
    if (!user || user.role !== 'CLIENT' || !user.clientProfile?.id) {
      return NextResponse.json({ ok: false, error: 'Only clients can create bookings.' }, { status: 401 })
    }

    const clientId = user.clientProfile.id
    const body = (await request.json().catch(() => ({}))) as CreateBookingBody

    const offeringId = pickString(body.offeringId)
    const scheduledForRaw = body.scheduledFor
    const holdId = pickString(body.holdId)
    const source = normalizeSource(body.source)
    const locationType = normalizeLocationType(body.locationType)

    // Not stored on Booking in schema (fine)
    const mediaId = pickString(body.mediaId)

    const openingId = pickString(body.openingId)

    if (!offeringId || !scheduledForRaw) {
      return NextResponse.json({ ok: false, error: 'Missing offering or date/time.' }, { status: 400 })
    }

    const scheduledFor = new Date(String(scheduledForRaw))
    if (!isValidDate(scheduledFor)) {
      return NextResponse.json({ ok: false, error: 'Invalid date/time.' }, { status: 400 })
    }

    const BUFFER_MINUTES = 5
    if (scheduledFor.getTime() < addMinutes(new Date(), BUFFER_MINUTES).getTime()) {
      return NextResponse.json({ ok: false, error: 'Please select a future time.' }, { status: 400 })
    }

    const offering = await prisma.professionalServiceOffering.findUnique({
      where: { id: offeringId },
      select: {
        id: true,
        isActive: true,
        professionalId: true,
        serviceId: true,

        offersInSalon: true,
        offersMobile: true,
        salonPriceStartingAt: true,
        salonDurationMinutes: true,
        mobilePriceStartingAt: true,
        mobileDurationMinutes: true,

        professional: { select: { autoAcceptBookings: true } },
      },
    })

    if (!offering || !offering.isActive) {
      return NextResponse.json({ ok: false, error: 'Invalid or inactive offering.' }, { status: 400 })
    }

    // Mode enforcement
    if (locationType === 'SALON' && !offering.offersInSalon) {
      return NextResponse.json({ ok: false, error: 'This service is not offered in-salon.' }, { status: 400 })
    }
    if (locationType === 'MOBILE' && !offering.offersMobile) {
      return NextResponse.json({ ok: false, error: 'This service is not offered as mobile.' }, { status: 400 })
    }

    const priceStartingAt =
      locationType === 'MOBILE' ? offering.mobilePriceStartingAt : offering.salonPriceStartingAt

    const durationSnapshot =
      locationType === 'MOBILE' ? offering.mobileDurationMinutes : offering.salonDurationMinutes

    if (priceStartingAt == null) {
      return NextResponse.json(
        { ok: false, error: `Pricing is not set for ${locationType === 'MOBILE' ? 'mobile' : 'salon'} bookings.` },
        { status: 400 },
      )
    }

    const durationMinutes = Number(durationSnapshot ?? 0)
    if (!Number.isFinite(durationMinutes) || durationMinutes <= 0) {
      return NextResponse.json({ ok: false, error: 'Offering duration is invalid for this booking type.' }, { status: 400 })
    }

    const now = new Date()

    // Hold validation
    let holdToDeleteId: string | null = null
    if (holdId) {
      const hold = await prisma.bookingHold.findUnique({
        where: { id: holdId },
        select: {
          id: true,
          offeringId: true,
          professionalId: true,
          clientId: true, // nullable per schema
          scheduledFor: true,
          expiresAt: true,
        },
      })

      if (!hold || hold.offeringId !== offeringId) {
        return NextResponse.json({ ok: false, error: 'Hold not found. Please pick a slot again.' }, { status: 409 })
      }

      if (hold.expiresAt.getTime() <= now.getTime()) {
        return NextResponse.json({ ok: false, error: 'Hold expired. Please pick a slot again.' }, { status: 409 })
      }

      if (new Date(hold.scheduledFor).getTime() !== scheduledFor.getTime()) {
        return NextResponse.json({ ok: false, error: 'Hold mismatch. Please pick a slot again.' }, { status: 409 })
      }

      if (hold.professionalId !== offering.professionalId) {
        return NextResponse.json({ ok: false, error: 'Hold mismatch. Please pick a slot again.' }, { status: 409 })
      }

      if (hold.clientId && hold.clientId !== clientId) {
        return NextResponse.json({ ok: false, error: 'Hold not found. Please pick a slot again.' }, { status: 409 })
      }

      holdToDeleteId = hold.id
    }

    // Opening pre-check (real enforcement is inside transaction)
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

      if (!opening) return NextResponse.json({ ok: false, error: 'Opening not found.' }, { status: 404 })
      if (opening.status !== 'ACTIVE') {
        return NextResponse.json({ ok: false, error: 'That opening is no longer available.' }, { status: 409 })
      }

      if (opening.professionalId !== offering.professionalId) return NextResponse.json({ ok: false, error: 'Opening mismatch.' }, { status: 409 })
      if (opening.offeringId && opening.offeringId !== offering.id) return NextResponse.json({ ok: false, error: 'Opening mismatch.' }, { status: 409 })
      if (opening.serviceId && opening.serviceId !== offering.serviceId) return NextResponse.json({ ok: false, error: 'Opening mismatch.' }, { status: 409 })
      if (new Date(opening.startAt).getTime() !== scheduledFor.getTime()) return NextResponse.json({ ok: false, error: 'Opening time mismatch.' }, { status: 409 })
    }

    const requestedStart = scheduledFor
    const requestedEnd = addMinutes(requestedStart, durationMinutes)

    const windowStart = addMinutes(requestedStart, -durationMinutes * 2)
    const windowEnd = addMinutes(requestedStart, durationMinutes * 2)

    // UX prescan
    const existing = (await prisma.booking.findMany({
      where: {
        professionalId: offering.professionalId,
        scheduledFor: { gte: windowStart, lte: windowEnd },
        NOT: { status: 'CANCELLED' },
      },
      select: { id: true, scheduledFor: true, durationMinutesSnapshot: true },
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
      return NextResponse.json({ ok: false, error: 'That time is no longer available. Please select a different slot.' }, { status: 409 })
    }

    const autoAccept = Boolean(offering.professional?.autoAcceptBookings)
    const initialStatus = autoAccept ? 'ACCEPTED' : 'PENDING'

    const booking = await prisma.$transaction(async (tx) => {
      // Transaction conflict re-check
      const existing2 = (await tx.booking.findMany({
        where: {
          professionalId: offering.professionalId,
          scheduledFor: { gte: windowStart, lte: windowEnd },
          NOT: { status: 'CANCELLED' },
        },
        select: { id: true, scheduledFor: true, durationMinutesSnapshot: true },
        take: 50,
      })) as ExistingBookingForConflict[]

      const hasConflict2 = existing2.some((b) => {
        const bDur = Number(b.durationMinutesSnapshot || 0)
        if (!Number.isFinite(bDur) || bDur <= 0) return false
        const bStart = new Date(b.scheduledFor)
        const bEnd = addMinutes(bStart, bDur)
        return overlaps(bStart, bEnd, requestedStart, requestedEnd)
      })

      if (hasConflict2) throw new Error('TIME_NOT_AVAILABLE')

      // Claim opening (atomic) if present
      if (openingId) {
        const activeOpening = await tx.lastMinuteOpening.findFirst({
          where: { id: openingId, status: 'ACTIVE' },
          select: { id: true, startAt: true, professionalId: true, offeringId: true, serviceId: true },
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

          // ✅ Option B source attribution
          source,

          // ✅ mode
          locationType,

          // ✅ schema-accurate snapshots
          priceSnapshot: priceStartingAt,
          durationMinutesSnapshot: durationMinutes,

          // NOTE: Booking model does NOT have mediaId, so we do not store it here.
          // If you want attribution, use ClientIntentEvent or WaitlistEntry.
          // mediaId is still allowed to flow through UI for waitlist + discovery context.
        },
        select: {
          id: true,
          status: true,
          scheduledFor: true,
          professionalId: true,
          serviceId: true,
          offeringId: true,
          source: true,
          locationType: true,
        },
      })

      if (openingId) {
        await tx.openingNotification.updateMany({
          where: { clientId, openingId, bookedAt: null },
          data: { bookedAt: new Date() },
        })
      }

      if (holdToDeleteId) {
        await tx.bookingHold.delete({ where: { id: holdToDeleteId } })
      }

      // Optional: if you want to track booking attribution to media without adding a column:
      // you could write a ClientIntentEvent here. I’m not doing it unless you told me to.
      void mediaId

      return created
    })

    return NextResponse.json({ ok: true, booking }, { status: 201 })
  } catch (e: any) {
    if (e?.message === 'OPENING_NOT_AVAILABLE') {
      return NextResponse.json({ ok: false, error: 'That opening was just taken. Please pick another slot.' }, { status: 409 })
    }
    if (e?.message === 'TIME_NOT_AVAILABLE') {
      return NextResponse.json({ ok: false, error: 'That time is no longer available. Please select a different slot.' }, { status: 409 })
    }

    console.error('POST /api/bookings error:', e)
    return NextResponse.json({ ok: false, error: 'Internal server error' }, { status: 500 })
  }
}
