// app/api/client/bookings/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getCurrentUser } from '@/lib/currentUser'
import type { BookingSource, ServiceLocationType } from '@prisma/client'

export const dynamic = 'force-dynamic'

function addDays(date: Date, days: number) {
  const d = new Date(date)
  d.setDate(d.getDate() + days)
  return d
}

function upper(v: unknown) {
  return typeof v === 'string' ? v.trim().toUpperCase() : ''
}

function pickString(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null
}

function decimalToString(v: unknown): string | null {
  if (v == null) return null
  if (typeof v === 'string') return v
  if (typeof v === 'number' && Number.isFinite(v)) return String(v)
  if (typeof v === 'object' && v && typeof (v as any).toString === 'function') return (v as any).toString()
  return null
}

function moneyNumber(v: unknown): number | null {
  if (v == null) return null
  const s = typeof v === 'string' ? v : typeof v === 'number' ? String(v) : String((v as any)?.toString?.() ?? '')
  const n = Number(String(s).replace(/[^0-9.]/g, ''))
  if (!Number.isFinite(n) || n < 0) return null
  return Math.round(n * 100) / 100
}

function normalizeSource(v: unknown): BookingSource {
  const s = upper(v)
  if (s === 'REQUESTED') return 'REQUESTED'
  if (s === 'AFTERCARE') return 'AFTERCARE'
  return 'DISCOVERY'
}

function normalizeLocationType(v: unknown): ServiceLocationType | null {
  const s = upper(v)
  if (s === 'SALON') return 'SALON'
  if (s === 'MOBILE') return 'MOBILE'
  return null
}

function addMinutes(date: Date, minutes: number) {
  return new Date(date.getTime() + minutes * 60_000)
}

/** existingStart < requestedEnd AND existingEnd > requestedStart */
function overlaps(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date) {
  return aStart < bEnd && aEnd > bStart
}

type BookingRow = {
  id: string
  status: string | null
  source: string | null
  sessionStep: string | null
  scheduledFor: Date
  durationMinutesSnapshot: number | null
  priceSnapshot: unknown

  consultationNotes: string | null
  consultationPrice: unknown
  consultationConfirmedAt: Date | null

  service: { id: string; name: string } | null
  professional: {
    id: string
    businessName: string | null
    location: string | null
    city: string | null
    state: string | null
  } | null

  consultationApproval: {
    status: string
    proposedServicesJson: unknown
    proposedTotal: unknown
    notes: string | null
    approvedAt: Date | null
    rejectedAt: Date | null
  } | null
}

type BookingOut = {
  id: string
  status: string | null
  source: string | null
  sessionStep: string | null
  scheduledFor: string
  durationMinutesSnapshot: number | null
  priceSnapshot: unknown
  service: { id: string; name: string } | null
  professional: {
    id: string
    businessName: string | null
    location: string | null
    city: string | null
    state: string | null
  } | null

  hasUnreadAftercare: boolean
  hasPendingConsultationApproval: boolean

  consultation: null | {
    consultationNotes: string | null
    consultationPrice: string | null
    consultationConfirmedAt: string | null

    approvalStatus: string | null
    approvalNotes: string | null
    proposedTotal: string | null
    proposedServicesJson: unknown
    approvedAt: string | null
    rejectedAt: string | null
  }
}

function needsConsultationApproval(b: BookingRow) {
  const approval = upper(b.consultationApproval?.status)
  if (approval !== 'PENDING') return false

  const status = upper(b.status)
  if (status === 'CANCELLED' || status === 'COMPLETED') return false

  const step = upper(b.sessionStep)
  return step === 'CONSULTATION_PENDING_CLIENT' || step === 'CONSULTATION' || !step
}

/**
 * GET: list client bookings (your existing behavior)
 */
export async function GET() {
  try {
    const user = await getCurrentUser().catch(() => null)
    const clientId = user?.role === 'CLIENT' ? user.clientProfile?.id : null
    if (!clientId) return NextResponse.json({ ok: false, error: 'Only clients can view bookings.' }, { status: 401 })

    const now = new Date()
    const next30 = addDays(now, 30)

    const bookings = (await prisma.booking.findMany({
      where: { clientId },
      orderBy: { scheduledFor: 'asc' },
      take: 300,
      select: {
        id: true,
        status: true,
        source: true,
        sessionStep: true,
        scheduledFor: true,
        durationMinutesSnapshot: true,
        priceSnapshot: true,

        consultationNotes: true,
        consultationPrice: true,
        consultationConfirmedAt: true,

        service: { select: { id: true, name: true } },
        professional: { select: { id: true, businessName: true, location: true, city: true, state: true } },

        consultationApproval: {
          select: {
            status: true,
            proposedServicesJson: true,
            proposedTotal: true,
            notes: true,
            approvedAt: true,
            rejectedAt: true,
          },
        },
      },
    })) as BookingRow[]

    const unread = await prisma.clientNotification.findMany({
      where: {
        clientId,
        type: 'AFTERCARE',
        readAt: null,
        bookingId: { not: null },
      } as any,
      select: { bookingId: true },
      take: 1000,
    })

    const unreadBookingIds = new Set(
      unread
        .map((n: { bookingId: string | null }) => (typeof n.bookingId === 'string' ? n.bookingId : null))
        .filter((x): x is string => Boolean(x)),
    )

    const out: BookingOut[] = bookings.map((b) => {
      const hasPending = needsConsultationApproval(b)

      const approvalStatus = upper(b.consultationApproval?.status)
      const approvedTotalNum = approvalStatus === 'APPROVED' ? moneyNumber(b.consultationApproval?.proposedTotal) : null

      // ✅ If consult approved, show that price everywhere
      const effectivePriceSnapshot = approvedTotalNum != null ? approvedTotalNum : b.priceSnapshot

      const shouldSendConsultationBlob =
        Boolean(b.consultationApproval) || Boolean(b.consultationNotes) || b.consultationPrice != null

      return {
        id: b.id,
        status: b.status,
        source: b.source,
        sessionStep: b.sessionStep,

        scheduledFor: b.scheduledFor.toISOString(),
        durationMinutesSnapshot: b.durationMinutesSnapshot,
        priceSnapshot: effectivePriceSnapshot,

        service: b.service,
        professional: b.professional,

        hasUnreadAftercare: unreadBookingIds.has(b.id),
        hasPendingConsultationApproval: hasPending,

        consultation: shouldSendConsultationBlob
          ? {
              consultationNotes: b.consultationNotes ?? null,
              consultationPrice: decimalToString(b.consultationPrice),
              consultationConfirmedAt: b.consultationConfirmedAt ? b.consultationConfirmedAt.toISOString() : null,

              approvalStatus: b.consultationApproval?.status ?? null,
              approvalNotes: b.consultationApproval?.notes ?? null,
              proposedTotal: decimalToString(b.consultationApproval?.proposedTotal),
              proposedServicesJson: b.consultationApproval?.proposedServicesJson ?? null,
              approvedAt: b.consultationApproval?.approvedAt ? b.consultationApproval.approvedAt.toISOString() : null,
              rejectedAt: b.consultationApproval?.rejectedAt ? b.consultationApproval.rejectedAt.toISOString() : null,
            }
          : null,
      }
    })

    // waitlist (leave as-is)
    let waitlist: any[] = []
    try {
      waitlist = await prisma.waitlistEntry.findMany({
        where: { clientId, status: 'ACTIVE' },
        orderBy: { createdAt: 'desc' },
        take: 200,
        select: {
          id: true,
          createdAt: true,
          serviceId: true,
          professionalId: true,
          notes: true,
          preferredStart: true,
          preferredEnd: true,
          preferredTimeBucket: true,
          status: true,
          mediaId: true,
          service: { select: { id: true, name: true } },
          professional: { select: { id: true, businessName: true, location: true, city: true, state: true } },
        },
      })
    } catch (e) {
      console.error('GET /api/client/bookings waitlist error:', e)
      waitlist = []
    }

    const upcoming: BookingOut[] = []
    const pending: BookingOut[] = []
    const prebooked: BookingOut[] = []
    const past: BookingOut[] = []

    for (const b of out) {
      const when = new Date(b.scheduledFor)
      const isFuture = when.getTime() >= now.getTime()
      const within30 = when.getTime() < next30.getTime()

      const status = upper(b.status)
      const source = upper(b.source)

      if (!isFuture || status === 'COMPLETED' || status === 'CANCELLED') {
        past.push(b)
        continue
      }

      if (b.hasPendingConsultationApproval) {
        pending.push(b)
        continue
      }

      if (status === 'PENDING') {
        pending.push(b)
        continue
      }

      if (source === 'AFTERCARE' && isFuture) {
        prebooked.push(b)
        continue
      }

      if (status === 'ACCEPTED' && within30) {
        upcoming.push(b)
        continue
      }

      upcoming.push(b)
    }

    return NextResponse.json(
      {
        ok: true,
        buckets: { upcoming, pending, waitlist, prebooked, past },
        meta: { now: now.toISOString(), next30: next30.toISOString() },
      },
      { status: 200 },
    )
  } catch (e) {
    console.error('GET /api/client/bookings error:', e)
    return NextResponse.json({ ok: false, error: 'Failed to load client bookings.' }, { status: 500 })
  }
}

/**
 * POST: create a booking from a holdId
 * Used by Looks flow (AvailabilityDrawer "Book now")
 */
export async function POST(req: NextRequest) {
  try {
    const user = await getCurrentUser().catch(() => null)
    if (!user || user.role !== 'CLIENT' || !user.clientProfile?.id) {
      return NextResponse.json({ ok: false, error: 'Only clients can book.' }, { status: 401 })
    }

    const clientId = user.clientProfile.id

    const body = (await req.json().catch(() => ({}))) as {
      holdId?: unknown
      source?: unknown
      mediaId?: unknown
      locationType?: unknown
    }

    const holdId = pickString(body.holdId)
    if (!holdId) return NextResponse.json({ ok: false, error: 'Missing holdId.' }, { status: 400 })

    const source = normalizeSource(body.source)
    const mediaId = pickString(body.mediaId) // optional
    const requestedLocationType = normalizeLocationType(body.locationType) // optional sanity check

    const now = new Date()

    const result = await prisma.$transaction(async (tx) => {
      // 1) Load hold and verify ownership + expiry
      const hold = await tx.bookingHold.findUnique({
        where: { id: holdId },
        select: {
          id: true,
          offeringId: true,
          professionalId: true,
          scheduledFor: true,
          expiresAt: true,
          locationType: true,
          clientId: true,
        },
      })

      if (!hold) return { ok: false as const, status: 404, error: 'Hold not found.' }
      if (!hold.clientId || hold.clientId !== clientId) {
        return { ok: false as const, status: 403, error: 'Forbidden.' }
      }
      if (hold.expiresAt.getTime() <= now.getTime()) {
        return { ok: false as const, status: 409, error: 'That hold expired. Please pick another time.' }
      }

      // Optional consistency check: if client UI sends locationType, it must match hold
      if (requestedLocationType && requestedLocationType !== hold.locationType) {
        return { ok: false as const, status: 400, error: 'Location type mismatch. Please try again.' }
      }

      // 2) Load offering for service + pricing/duration
      const offering = await tx.professionalServiceOffering.findUnique({
        where: { id: hold.offeringId },
        select: {
          id: true,
          isActive: true,
          professionalId: true,
          serviceId: true,
          offersInSalon: true,
          offersMobile: true,
          salonPriceStartingAt: true,
          mobilePriceStartingAt: true,
          salonDurationMinutes: true,
          mobileDurationMinutes: true,
        },
      })

      if (!offering || !offering.isActive) {
        return { ok: false as const, status: 400, error: 'That service is no longer available.' }
      }

      // 3) Validate the offering still supports this mode
      if (hold.locationType === 'SALON' && !offering.offersInSalon) {
        return { ok: false as const, status: 400, error: 'This service is no longer offered in-salon.' }
      }
      if (hold.locationType === 'MOBILE' && !offering.offersMobile) {
        return { ok: false as const, status: 400, error: 'This service is no longer offered as mobile.' }
      }

      const duration =
        hold.locationType === 'MOBILE'
          ? Number(offering.mobileDurationMinutes ?? 0)
          : Number(offering.salonDurationMinutes ?? 0)

      const safeDuration = Number.isFinite(duration) && duration > 0 ? duration : 60

      const priceDecimal =
        hold.locationType === 'MOBILE' ? offering.mobilePriceStartingAt : offering.salonPriceStartingAt

      const priceNum = moneyNumber(priceDecimal)
      if (priceNum == null) {
        // You have priceSnapshot + subtotalSnapshot required, so we cannot proceed without a price.
        return { ok: false as const, status: 400, error: 'This service is missing pricing. Pro must update the offering.' }
      }

      // 4) Conflict check right before create (paranoia is healthy)
      const start = new Date(hold.scheduledFor)
      const end = addMinutes(start, safeDuration)
      const windowStart = addMinutes(start, -safeDuration * 2)
      const windowEnd = addMinutes(start, safeDuration * 2)

      const existing = await tx.booking.findMany({
        where: {
          professionalId: hold.professionalId,
          scheduledFor: { gte: windowStart, lte: windowEnd },
          NOT: { status: 'CANCELLED' as any },
        },
        select: { id: true, scheduledFor: true, durationMinutesSnapshot: true },
        orderBy: { scheduledFor: 'asc' },
        take: 100,
      })

      const hasConflict = existing.some((b) => {
        const bDur = Number(b.durationMinutesSnapshot || 0)
        if (!Number.isFinite(bDur) || bDur <= 0) return false
        const bStart = new Date(b.scheduledFor)
        const bEnd = addMinutes(bStart, bDur)
        return overlaps(bStart, bEnd, start, end)
      })

      if (hasConflict) {
        // delete the hold because it's now invalid
        await tx.bookingHold.delete({ where: { id: hold.id } }).catch(() => {})
        return { ok: false as const, status: 409, error: 'That time was just taken. Please pick another slot.' }
      }

      // 5) Create booking + delete hold
      const booking = await tx.booking.create({
        data: {
          clientId,
          professionalId: hold.professionalId,
          serviceId: offering.serviceId,
          offeringId: offering.id,
          scheduledFor: start,
          status: 'PENDING' as any,
          locationType: hold.locationType,

          // legacy snapshots (required in schema)
          priceSnapshot: priceNum as any,
          durationMinutesSnapshot: safeDuration,

          // option B required fields
          subtotalSnapshot: priceNum as any,
          totalDurationMinutes: safeDuration,
          bufferMinutes: 0,

          source,

          // if you want to track look attribution later,
          // do it with an intent event or separate table.
          // mediaId is NOT a booking field in your schema.
        },
        select: { id: true },
      })

      await tx.bookingHold.delete({ where: { id: hold.id } })

      // Optional: create an intent event if mediaId exists
      if (mediaId) {
        try {
          await tx.clientIntentEvent.create({
            data: {
              clientId,
              type: 'VIEW_MEDIA' as any,
              professionalId: hold.professionalId,
              serviceId: offering.serviceId,
              offeringId: offering.id,
              mediaId,
              source,
            },
          })
        } catch {
          // do not fail booking if analytics write fails
        }
      }

      return { ok: true as const, status: 201, bookingId: booking.id }
    })

    if (!result.ok) {
      return NextResponse.json({ ok: false, error: result.error }, { status: result.status })
    }

    return NextResponse.json(
      {
        ok: true,
        bookingId: result.bookingId,
        redirectTo: `/bookings/${encodeURIComponent(result.bookingId)}`,
      },
      { status: 201 },
    )
  } catch (e) {
    console.error('POST /api/client/bookings error:', e)
    return NextResponse.json({ ok: false, error: 'Failed to create booking.' }, { status: 500 })
  }
}
