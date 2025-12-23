// app/api/pro/openings/route.ts
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getCurrentUser } from '@/lib/currentUser'
import { OpeningStatus, type ServiceLocationType } from '@prisma/client'

export const dynamic = 'force-dynamic'

function pickString(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null
}

function isValidDate(d: Date) {
  return d instanceof Date && !Number.isNaN(d.getTime())
}

function normalizeLocationType(v: unknown): ServiceLocationType {
  const s = typeof v === 'string' ? v.trim().toUpperCase() : ''
  return s === 'MOBILE' ? 'MOBILE' : 'SALON'
}

function addMinutes(date: Date, minutes: number) {
  return new Date(date.getTime() + minutes * 60_000)
}

type CreateOpeningBody = {
  offeringId?: unknown
  startAt?: unknown
  locationType?: unknown
  discountPct?: unknown
  note?: unknown
}

function parseDiscountPct(v: unknown): number | null {
  const n = typeof v === 'number' ? v : Number(v ?? NaN)
  if (!Number.isFinite(n)) return null
  if (n < 0 || n > 90) return null
  return Math.round(n)
}

function parseOpeningStatus(v: unknown): OpeningStatus | null {
  const s = typeof v === 'string' ? v.trim().toUpperCase() : ''
  if (!s) return null
  const allowed: OpeningStatus[] = ['ACTIVE', 'BOOKED', 'EXPIRED', 'CANCELLED']
  return allowed.includes(s as OpeningStatus) ? (s as OpeningStatus) : null
}

export async function GET(req: Request) {
  try {
    const user = await getCurrentUser().catch(() => null)
    if (!user || user.role !== 'PRO' || !user.professionalProfile?.id) {
      return NextResponse.json({ error: 'Only professionals can access openings.' }, { status: 401 })
    }

    const professionalId = user.professionalProfile.id
    const { searchParams } = new URL(req.url)

    const status = parseOpeningStatus(searchParams.get('status'))

    const openings = await prisma.lastMinuteOpening.findMany({
      where: {
        professionalId,
        ...(status ? { status } : {}),
      },
      orderBy: { startAt: 'asc' },
      take: 200,
      select: {
        id: true,
        startAt: true,
        endAt: true,
        status: true,
        discountPct: true,
        note: true,
        createdAt: true,
        updatedAt: true,
        offering: {
          select: {
            id: true,
            title: true,

            offersInSalon: true,
            offersMobile: true,
            salonPriceStartingAt: true,
            salonDurationMinutes: true,
            mobilePriceStartingAt: true,
            mobileDurationMinutes: true,

            service: { select: { id: true, name: true } },
          },
        },
        service: { select: { id: true, name: true } },
      },
    })

    return NextResponse.json({ ok: true, openings })
  } catch (e) {
    console.error('GET /api/pro/openings error', e)
    return NextResponse.json({ error: 'Failed to load openings.' }, { status: 500 })
  }
}

export async function POST(req: Request) {
  try {
    const user = await getCurrentUser().catch(() => null)
    if (!user || user.role !== 'PRO' || !user.professionalProfile?.id) {
      return NextResponse.json({ error: 'Only professionals can create openings.' }, { status: 401 })
    }

    const professionalId = user.professionalProfile.id
    const body = (await req.json().catch(() => ({}))) as CreateOpeningBody

    const offeringId = pickString(body.offeringId)
    const startAtRaw = body.startAt
    const locationType = normalizeLocationType(body.locationType)
    const note = pickString(body.note)
    const discountPct = parseDiscountPct(body.discountPct)

    if (!offeringId || !startAtRaw) {
      return NextResponse.json({ error: 'Missing offeringId or startAt.' }, { status: 400 })
    }

    const startAt = new Date(String(startAtRaw))
    if (!isValidDate(startAt)) {
      return NextResponse.json({ error: 'Invalid startAt.' }, { status: 400 })
    }

    // buffer: don't allow openings in the past / immediate-now
    const BUFFER_MINUTES = 5
    if (startAt.getTime() < addMinutes(new Date(), BUFFER_MINUTES).getTime()) {
      return NextResponse.json({ error: 'Please choose a future time.' }, { status: 400 })
    }

    const offering = await prisma.professionalServiceOffering.findFirst({
      where: { id: offeringId, professionalId, isActive: true },
      select: {
        id: true,
        professionalId: true,
        serviceId: true,
        title: true,

        offersInSalon: true,
        offersMobile: true,
        salonPriceStartingAt: true,
        salonDurationMinutes: true,
        mobilePriceStartingAt: true,
        mobileDurationMinutes: true,

        service: { select: { id: true, name: true, minPrice: true, defaultDurationMinutes: true } },
      },
    })

    if (!offering) {
      return NextResponse.json({ error: 'Offering not found or inactive.' }, { status: 404 })
    }

    // validate mode offered
    if (locationType === 'SALON' && !offering.offersInSalon) {
      return NextResponse.json({ error: 'This offering is not available in-salon.' }, { status: 400 })
    }
    if (locationType === 'MOBILE' && !offering.offersMobile) {
      return NextResponse.json({ error: 'This offering is not available as mobile.' }, { status: 400 })
    }

    const durationForMode =
      locationType === 'MOBILE'
        ? Number(offering.mobileDurationMinutes ?? 0)
        : Number(offering.salonDurationMinutes ?? 0)

    const fallbackDuration = Number(offering.service.defaultDurationMinutes ?? 60)
    const durationMinutes = Number.isFinite(durationForMode) && durationForMode > 0 ? durationForMode : fallbackDuration

    const endAt = addMinutes(startAt, durationMinutes)

    // reject overlaps with existing ACTIVE openings (same pro)
    const overlapOpening = await prisma.lastMinuteOpening.findFirst({
      where: {
        professionalId,
        status: OpeningStatus.ACTIVE,
        startAt: { lt: endAt },
        OR: [{ endAt: null }, { endAt: { gt: startAt } }],
      },
      select: { id: true },
    })

    if (overlapOpening) {
      return NextResponse.json({ error: 'You already have an active opening overlapping that time.' }, { status: 409 })
    }

    // reject overlaps with bookings (PENDING/ACCEPTED) using a window scan
    const windowStart = addMinutes(startAt, -durationMinutes * 2)
    const windowEnd = addMinutes(startAt, durationMinutes * 2)

    const nearbyBookings = await prisma.booking.findMany({
      where: {
        professionalId,
        status: { in: ['PENDING', 'ACCEPTED'] },
        scheduledFor: { gte: windowStart, lte: windowEnd },
      },
      select: { id: true, scheduledFor: true, durationMinutesSnapshot: true },
      take: 50,
      orderBy: { scheduledFor: 'asc' },
    })

    const overlapsBooking = nearbyBookings.some((b) => {
      const bStart = new Date(b.scheduledFor)
      const bDur = Number(b.durationMinutesSnapshot ?? 0)
      const bEnd = addMinutes(bStart, Number.isFinite(bDur) && bDur > 0 ? bDur : durationMinutes)
      return startAt < bEnd && bStart < endAt
    })

    if (overlapsBooking) {
      return NextResponse.json({ error: 'That time overlaps an existing booking.' }, { status: 409 })
    }

    const created = await prisma.lastMinuteOpening.create({
      data: {
        professionalId,
        serviceId: offering.serviceId,
        offeringId: offering.id,
        startAt,
        endAt,
        status: OpeningStatus.ACTIVE,
        discountPct, // null allowed by schema (Int?)
        note,
      },
      select: {
        id: true,
        status: true,
        startAt: true,
        endAt: true,
        discountPct: true,
        note: true,
        offeringId: true,
        serviceId: true,
      },
    })

    return NextResponse.json({ ok: true, opening: created }, { status: 201 })
  } catch (e) {
    console.error('POST /api/pro/openings error', e)
    return NextResponse.json({ error: 'Failed to create opening.' }, { status: 500 })
  }
}

export async function PATCH(req: Request) {
  try {
    const user = await getCurrentUser().catch(() => null)
    if (!user || user.role !== 'PRO' || !user.professionalProfile?.id) {
      return NextResponse.json({ error: 'Only professionals can update openings.' }, { status: 401 })
    }

    const professionalId = user.professionalProfile.id
    const body = (await req.json().catch(() => ({}))) as any

    const openingId = pickString(body?.openingId)
    const status = parseOpeningStatus(body?.status)
    const note = pickString(body?.note)
    const discountPct = (() => {
      const n = typeof body.discountPct === 'number' ? body.discountPct : Number(body.discountPct ?? NaN)
      return Number.isFinite(n) && n >= 0 && n <= 90 ? Math.round(n) : undefined
    })()

    if (!openingId) return NextResponse.json({ error: 'Missing openingId.' }, { status: 400 })

    // If they provided status but it was invalid, reject (instead of silently ignoring)
    if (body?.status != null && pickString(body?.status) && !status) {
      return NextResponse.json({ error: 'Invalid status.' }, { status: 400 })
    }

    const updated = await prisma.lastMinuteOpening.updateMany({
      where: { id: openingId, professionalId },
      data: {
        ...(status ? { status } : {}),
        ...(note !== null ? { note } : {}),
        ...(discountPct !== undefined ? { discountPct } : {}),
      },
    })

    if (updated.count !== 1) {
      return NextResponse.json({ error: 'Opening not found.' }, { status: 404 })
    }

    return NextResponse.json({ ok: true })
  } catch (e) {
    console.error('PATCH /api/pro/openings error', e)
    return NextResponse.json({ error: 'Failed to update opening.' }, { status: 500 })
  }
}
