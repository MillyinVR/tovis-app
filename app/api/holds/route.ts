// app/api/holds/route.ts
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getCurrentUser } from '@/lib/currentUser'

export const dynamic = 'force-dynamic'

type CreateHoldBody = {
  offeringId?: unknown
  scheduledFor?: unknown
}

function pickString(v: unknown) {
  return typeof v === 'string' && v.trim() ? v.trim() : null
}

function isValidDate(d: Date) {
  return d instanceof Date && Number.isFinite(d.getTime())
}

function addMinutes(d: Date, minutes: number) {
  return new Date(d.getTime() + minutes * 60_000)
}

/** existingStart < requestedEnd AND existingEnd > requestedStart */
function overlaps(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date) {
  return aStart < bEnd && aEnd > bStart
}

/**
 * Normalize to minute precision.
 * UI uses minute resolution; avoids "10:00:00.123" vs "10:00:00.000".
 */
function normalizeToMinute(d: Date) {
  const x = new Date(d)
  x.setSeconds(0, 0)
  return x
}

export async function POST(req: Request) {
  try {
    const user = await getCurrentUser().catch(() => null)
    if (!user || user.role !== 'CLIENT' || !user.clientProfile?.id) {
      return NextResponse.json({ error: 'Only clients can hold slots.' }, { status: 401 })
    }
    const clientId = user.clientProfile.id

    const body = (await req.json().catch(() => ({}))) as CreateHoldBody
    const offeringId = pickString(body?.offeringId)
    const scheduledForRaw = body?.scheduledFor

    if (!offeringId || !scheduledForRaw) {
      return NextResponse.json({ error: 'Missing offeringId or scheduledFor.' }, { status: 400 })
    }

    const scheduledForParsed = new Date(String(scheduledForRaw))
    if (!isValidDate(scheduledForParsed)) {
      return NextResponse.json({ error: 'Invalid scheduledFor.' }, { status: 400 })
    }

    const requestedStart = normalizeToMinute(scheduledForParsed)

    const BUFFER_MINUTES = 5
    if (requestedStart.getTime() < addMinutes(new Date(), BUFFER_MINUTES).getTime()) {
      return NextResponse.json({ error: 'Please select a future time.' }, { status: 400 })
    }

    const result = await prisma.$transaction(async (tx) => {
      const offering = await tx.professionalServiceOffering.findUnique({
        where: { id: offeringId },
        select: {
          id: true,
          isActive: true,
          professionalId: true,

          // Option B durations (holds need duration to test overlap)
          salonDurationMinutes: true,
          mobileDurationMinutes: true,
        },
      })

      if (!offering || !offering.isActive) {
        return { ok: false as const, status: 400, error: 'Invalid or inactive offering.' }
      }

      // Conservative overlap window: use the MAX configured duration
      const d1 = Number(offering.salonDurationMinutes ?? 0)
      const d2 = Number(offering.mobileDurationMinutes ?? 0)
      const duration = Math.max(d1, d2)

      if (!Number.isFinite(duration) || duration <= 0) {
        return { ok: false as const, status: 400, error: 'Offering duration is invalid.' }
      }

      const requestedEnd = addMinutes(requestedStart, duration)
      const now = new Date()

      // Tidy: delete expired holds for this exact pro+time
      await tx.bookingHold.deleteMany({
        where: {
          professionalId: offering.professionalId,
          scheduledFor: requestedStart,
          expiresAt: { lte: now },
        },
      })

      // Optional UX nicety:
      // If THIS client already holds this slot (new holds store clientId), return it.
      const existingClientHold = await tx.bookingHold.findFirst({
        where: {
          professionalId: offering.professionalId,
          scheduledFor: requestedStart,
          expiresAt: { gt: now },
          clientId: clientId, // nullable field in DB, but we are matching our id
        },
        select: { id: true, expiresAt: true },
      })

      if (existingClientHold) {
        return {
          ok: true as const,
          status: 200,
          holdId: existingClientHold.id,
          holdUntil: existingClientHold.expiresAt.getTime(),
        }
      }

      // Booking conflict check (widened window so overlaps aren’t missed)
      const windowStart = addMinutes(requestedStart, -duration * 2)
      const windowEnd = addMinutes(requestedStart, duration * 2)

      const existingBookings = await tx.booking.findMany({
        where: {
          professionalId: offering.professionalId,
          scheduledFor: { gte: windowStart, lte: windowEnd },
          NOT: { status: 'CANCELLED' },
        },
        select: { scheduledFor: true, durationMinutesSnapshot: true },
        take: 50,
      })

      const bookingConflict = existingBookings.some((b) => {
        const bDur = Number(b.durationMinutesSnapshot ?? 0)
        if (!Number.isFinite(bDur) || bDur <= 0) return false
        const bStart = normalizeToMinute(new Date(b.scheduledFor))
        const bEnd = addMinutes(bStart, bDur)
        return overlaps(bStart, bEnd, requestedStart, requestedEnd)
      })

      if (bookingConflict) {
        return { ok: false as const, status: 409, error: 'That time was just taken.' }
      }

      // Active hold conflict check (after cleanup)
      // IMPORTANT: block if ANYONE has a hold for this pro+time.
      const activeHold = await tx.bookingHold.findFirst({
        where: {
          professionalId: offering.professionalId,
          scheduledFor: requestedStart,
          expiresAt: { gt: now },
        },
        select: { id: true, clientId: true },
      })

      if (activeHold) {
        return {
          ok: false as const,
          status: 409,
          error: 'Someone is already holding that time. Try another slot.',
        }
      }

      const expiresAt = addMinutes(now, 10)

      const hold = await tx.bookingHold.create({
        data: {
          offeringId: offering.id,
          professionalId: offering.professionalId,
          clientId, // ✅ NEW (nullable in schema, but we always write it now)
          scheduledFor: requestedStart,
          expiresAt,
        },
        select: { id: true, expiresAt: true },
      })

      return {
        ok: true as const,
        status: 201,
        holdId: hold.id,
        holdUntil: hold.expiresAt.getTime(),
      }
    })

    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status })
    }

    return NextResponse.json(
      { ok: true, holdId: result.holdId, holdUntil: result.holdUntil },
      { status: result.status },
    )
  } catch (e) {
    console.error('POST /api/holds error', e)
    return NextResponse.json({ error: 'Failed to create hold.' }, { status: 500 })
  }
}
