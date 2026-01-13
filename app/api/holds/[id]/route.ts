// app/api/bookings/[id]/reschedule/route.ts
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getCurrentUser } from '@/lib/currentUser'

export const dynamic = 'force-dynamic'

type Ctx = { params: { id: string } | Promise<{ id: string }> }
type LocationType = 'SALON' | 'MOBILE'

function pickString(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null
}

function isLocationType(x: unknown): x is LocationType {
  return x === 'SALON' || x === 'MOBILE'
}

function toDateOrNull(v: unknown): Date | null {
  if (typeof v !== 'string' || !v.trim()) return null
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? null : d
}

function overlap(aStart: Date, aMin: number, bStart: Date, bMin: number) {
  const aEnd = aStart.getTime() + aMin * 60_000
  const bEnd = bStart.getTime() + bMin * 60_000
  return aStart.getTime() < bEnd && bStart.getTime() < aEnd
}

async function requireClient() {
  const user = await getCurrentUser().catch(() => null)
  if (!user || user.role !== 'CLIENT' || !user.clientProfile?.id) return null
  return { user, clientId: user.clientProfile.id }
}

async function computeDurationMinutes(args: {
  bookingDurationSnapshot: number
  offering: null | {
    salonDurationMinutes: number | null
    mobileDurationMinutes: number | null
  }
  locationType: LocationType
}) {
  const { offering, locationType, bookingDurationSnapshot } = args
  const fromOffering =
    locationType === 'MOBILE' ? offering?.mobileDurationMinutes : offering?.salonDurationMinutes

  const minutes = Number(fromOffering ?? bookingDurationSnapshot ?? 0)
  if (!Number.isFinite(minutes) || minutes <= 0) return null
  return Math.floor(minutes)
}

export async function POST(req: Request, { params }: Ctx) {
  try {
    const auth = await requireClient()
    if (!auth) return NextResponse.json({ error: 'Only clients can reschedule.' }, { status: 401 })

    const { id } = await Promise.resolve(params)
    const bookingId = pickString(id)
    if (!bookingId) return NextResponse.json({ error: 'Missing booking id.' }, { status: 400 })

    const body = await req.json().catch(() => ({}))

    const scheduledFor = toDateOrNull(body?.scheduledFor)
    const holdId = pickString(body?.holdId)
    const locationTypeRaw = body?.locationType

    if (!scheduledFor) return NextResponse.json({ error: 'Missing/invalid scheduledFor.' }, { status: 400 })
    if (!holdId) return NextResponse.json({ error: 'Missing holdId.' }, { status: 400 })
    if (!isLocationType(locationTypeRaw)) {
      return NextResponse.json({ error: 'Missing/invalid locationType.' }, { status: 400 })
    }
    const locationType = locationTypeRaw

    const now = new Date()
    if (scheduledFor.getTime() < now.getTime() - 60_000) {
      return NextResponse.json({ error: 'scheduledFor must be in the future.' }, { status: 400 })
    }

    const booking = await prisma.booking.findUnique({
      where: { id: bookingId },
      select: {
        id: true,
        status: true,
        clientId: true,
        professionalId: true,
        offeringId: true,
        durationMinutesSnapshot: true,
        startedAt: true,
        finishedAt: true,
      },
    })

    if (!booking) return NextResponse.json({ error: 'Booking not found.' }, { status: 404 })
    if (booking.clientId !== auth.clientId) return NextResponse.json({ error: 'Forbidden.' }, { status: 403 })

    if (booking.status === 'COMPLETED' || booking.status === 'CANCELLED') {
      return NextResponse.json({ error: 'This booking cannot be rescheduled.' }, { status: 409 })
    }
    if (booking.startedAt || booking.finishedAt) {
      return NextResponse.json({ error: 'This booking has started and cannot be rescheduled.' }, { status: 409 })
    }

    const result = await prisma.$transaction(async (tx) => {
      const hold = await tx.bookingHold.findUnique({
        where: { id: holdId },
        select: {
          id: true,
          clientId: true,
          professionalId: true,
          offeringId: true,
          scheduledFor: true,
          expiresAt: true,
          locationType: true,
        },
      })

      if (!hold) {
        return { error: 'Hold not found.', status: 404 as const }
      }

      if (hold.clientId !== auth.clientId) {
        return { error: 'Hold does not belong to you.', status: 403 as const }
      }

      if (hold.expiresAt <= now) {
        return { error: 'Hold expired. Please pick a new time.', status: 409 as const }
      }

      if (hold.professionalId !== booking.professionalId) {
        return { error: 'Hold is for a different professional.', status: 409 as const }
      }

      if (hold.locationType !== locationType) {
        return { error: 'Hold locationType does not match.', status: 409 as const }
      }

      if (new Date(hold.scheduledFor).getTime() !== scheduledFor.getTime()) {
        return { error: 'Hold time does not match scheduledFor.', status: 409 as const }
      }

      // Offering rules
      if (booking.offeringId) {
        if (hold.offeringId !== booking.offeringId) {
          return { error: 'Hold is for a different offering.', status: 409 as const }
        }
      } else {
        if (!hold.offeringId) {
          return { error: 'Hold is missing offeringId.', status: 409 as const }
        }
      }

      const offeringIdToUse = booking.offeringId ?? hold.offeringId
      const offering = offeringIdToUse
        ? await tx.professionalServiceOffering.findUnique({
            where: { id: offeringIdToUse },
            select: { id: true, salonDurationMinutes: true, mobileDurationMinutes: true },
          })
        : null

      const durationMinutes = await computeDurationMinutes({
        bookingDurationSnapshot: Number(booking.durationMinutesSnapshot || 0),
        offering: offering
          ? { salonDurationMinutes: offering.salonDurationMinutes, mobileDurationMinutes: offering.mobileDurationMinutes }
          : null,
        locationType,
      })

      if (!durationMinutes) {
        return { error: 'Could not determine duration for this reschedule.', status: 409 as const }
      }

      // Conflict check: other bookings for pro
      const windowStart = new Date(scheduledFor.getTime() - 24 * 60 * 60_000)
      const windowEnd = new Date(scheduledFor.getTime() + 24 * 60 * 60_000)

      const otherBookings = await tx.booking.findMany({
        where: {
          professionalId: booking.professionalId,
          id: { not: booking.id },
          status: { in: ['PENDING', 'ACCEPTED'] as any },
          scheduledFor: { gte: windowStart, lte: windowEnd },
        },
        select: { id: true, scheduledFor: true, durationMinutesSnapshot: true },
      })

      const conflicts = otherBookings.some((b) =>
        overlap(
          scheduledFor,
          durationMinutes,
          b.scheduledFor,
          Number(b.durationMinutesSnapshot || durationMinutes),
        ),
      )

      if (conflicts) {
        return { error: 'That time is no longer available. Please choose a new slot.', status: 409 as const }
      }

      // Update booking + delete hold (DB unique also protects the exact slot)
      const updated = await tx.booking.update({
        where: { id: booking.id },
        data: {
          scheduledFor,
          locationType,
          offeringId: booking.offeringId ?? offeringIdToUse ?? undefined,
          durationMinutesSnapshot: durationMinutes,
        } as any,
        select: {
          id: true,
          scheduledFor: true,
          status: true,
          locationType: true,
          durationMinutesSnapshot: true,
        },
      })

      await tx.bookingHold.delete({ where: { id: hold.id } })

      return { updated }
    })

    if ('error' in result) {
      return NextResponse.json({ error: result.error }, { status: result.status })
    }

    return NextResponse.json({ ok: true, booking: result.updated }, { status: 200 })
  } catch (e) {
    console.error('POST /api/bookings/[id]/reschedule error', e)
    return NextResponse.json({ error: 'Failed to reschedule booking.' }, { status: 500 })
  }
}
