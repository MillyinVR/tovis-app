// app/api/pro/openings/route.ts
import { prisma } from '@/lib/prisma'
import { OpeningStatus, type ServiceLocationType } from '@prisma/client'
import { jsonFail, jsonOk, pickString, requirePro, upper } from '@/app/api/_utils'

export const dynamic = 'force-dynamic'

type CreateOpeningBody = {
  offeringId?: unknown
  startAt?: unknown
  locationType?: unknown
  discountPct?: unknown
  note?: unknown
}

type PatchOpeningBody = {
  openingId?: unknown
  status?: unknown
  note?: unknown
  discountPct?: unknown
}

function parseIsoDate(v: unknown): Date | null {
  const s = pickString(v)
  if (!s) return null
  const d = new Date(s)
  return Number.isFinite(d.getTime()) ? d : null
}

function addMinutes(date: Date, minutes: number) {
  return new Date(date.getTime() + minutes * 60_000)
}

function normalizeLocationType(v: unknown): ServiceLocationType {
  const s = upper(v)
  return s === 'MOBILE' ? 'MOBILE' : 'SALON'
}

function clampInt(n: unknown, fallback: number, min: number, max: number) {
  const x = Number(n)
  if (!Number.isFinite(x)) return fallback
  return Math.min(Math.max(Math.trunc(x), min), max)
}

function parseDiscountPct(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null
  const n = typeof v === 'number' ? v : Number(v)
  if (!Number.isFinite(n)) return null
  const rounded = Math.round(n)
  if (rounded < 0 || rounded > 90) return null
  return rounded
}

function parseOpeningStatus(v: unknown): OpeningStatus | null {
  const s = upper(v)
  if (!s) return null
  const allowed: OpeningStatus[] = ['ACTIVE', 'BOOKED', 'EXPIRED', 'CANCELLED']
  return allowed.includes(s as OpeningStatus) ? (s as OpeningStatus) : null
}

export async function GET(req: Request) {
  try {
    const auth = await requirePro()
    if (auth.res) return auth.res
    const professionalId = auth.professionalId

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

    const dto = openings.map((o) => ({
      ...o,
      startAt: o.startAt.toISOString(),
      endAt: o.endAt ? o.endAt.toISOString() : null,
      createdAt: o.createdAt.toISOString(),
      updatedAt: o.updatedAt.toISOString(),
    }))

    return jsonOk({ ok: true, openings: dto }, 200)
  } catch (e) {
    console.error('GET /api/pro/openings error', e)
    return jsonFail(500, 'Failed to load openings.')
  }
}

export async function POST(req: Request) {
  try {
    const auth = await requirePro()
    if (auth.res) return auth.res
    const professionalId = auth.professionalId

    const body = (await req.json().catch(() => ({}))) as CreateOpeningBody

    const offeringId = pickString(body.offeringId)
    const startAt = parseIsoDate(body.startAt)
    const locationType = normalizeLocationType(body.locationType)
    const note = pickString(body.note)
    const discountPct = parseDiscountPct(body.discountPct)

    if (!offeringId || !startAt) {
      return jsonFail(400, 'Missing offeringId or startAt.')
    }

    // buffer: don’t allow openings "right now" or in the past
    const BUFFER_MINUTES = 5
    if (startAt.getTime() < addMinutes(new Date(), BUFFER_MINUTES).getTime()) {
      return jsonFail(400, 'Please choose a future time.')
    }

    const offering = await prisma.professionalServiceOffering.findFirst({
      where: { id: offeringId, professionalId, isActive: true },
      select: {
        id: true,
        professionalId: true,
        serviceId: true,

        offersInSalon: true,
        offersMobile: true,
        salonDurationMinutes: true,
        mobileDurationMinutes: true,

        service: { select: { id: true, name: true, defaultDurationMinutes: true } },
      },
    })

    if (!offering) return jsonFail(404, 'Offering not found or inactive.')

    if (locationType === 'SALON' && !offering.offersInSalon) {
      return jsonFail(400, 'This offering is not available in-salon.')
    }
    if (locationType === 'MOBILE' && !offering.offersMobile) {
      return jsonFail(400, 'This offering is not available as mobile.')
    }

    const durationMinutes = (() => {
      const modeDur =
        locationType === 'MOBILE'
          ? offering.mobileDurationMinutes
          : offering.salonDurationMinutes

      const fallback = offering.service.defaultDurationMinutes ?? 60
      return clampInt(modeDur ?? fallback, 60, 15, 12 * 60)
    })()

    const endAt = addMinutes(startAt, durationMinutes)

    // reject overlaps with existing ACTIVE openings
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
      return jsonFail(409, 'You already have an active opening overlapping that time.')
    }

    // reject overlaps with bookings (PENDING/ACCEPTED) using a tighter window
    const windowStart = addMinutes(startAt, -durationMinutes * 2)
    const windowEnd = addMinutes(startAt, durationMinutes * 2)

    const nearbyBookings = await prisma.booking.findMany({
      where: {
        professionalId,
        status: { in: ['PENDING', 'ACCEPTED'] as any },
        scheduledFor: { gte: windowStart, lte: windowEnd },
      },
      select: {
        id: true,
        scheduledFor: true,
        totalDurationMinutes: true,
        bufferMinutes: true,
      },
      take: 50,
      orderBy: { scheduledFor: 'asc' },
    })

    const overlapsBooking = nearbyBookings.some((b) => {
      const bStart = new Date(b.scheduledFor)
      const bDur = clampInt(b.totalDurationMinutes, durationMinutes, 15, 12 * 60)
      const bBuf = clampInt(b.bufferMinutes, 0, 0, 180)
      const bEnd = addMinutes(bStart, bDur + bBuf)
      return startAt < bEnd && bStart < endAt
    })

    if (overlapsBooking) {
      return jsonFail(409, 'That time overlaps an existing booking.')
    }

    const created = await prisma.lastMinuteOpening.create({
      data: {
        professionalId,
        serviceId: offering.serviceId,
        offeringId: offering.id,
        startAt,
        endAt,
        status: OpeningStatus.ACTIVE,
        discountPct, // Int? ok to be null
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

    return jsonOk(
      {
        ok: true,
        opening: {
          ...created,
          startAt: created.startAt.toISOString(),
          endAt: created.endAt ? created.endAt.toISOString() : null,
        },
      },
      201,
    )
  } catch (e) {
    console.error('POST /api/pro/openings error', e)
    return jsonFail(500, 'Failed to create opening.')
  }
}

export async function PATCH(req: Request) {
  try {
    const auth = await requirePro()
    if (auth.res) return auth.res
    const professionalId = auth.professionalId

    const body = (await req.json().catch(() => ({}))) as PatchOpeningBody

    const openingId = pickString(body.openingId)
    if (!openingId) return jsonFail(400, 'Missing openingId.')

    const status = parseOpeningStatus(body.status)
    const note = body.note === undefined ? undefined : pickString(body.note) // allow clear to null by sending ""
    const discountPct = body.discountPct === undefined ? undefined : parseDiscountPct(body.discountPct)

    // If they provided a status but it's invalid -> reject.
    if (body.status != null && pickString(body.status) && !status) {
      return jsonFail(400, 'Invalid status.')
    }
    // If provided discountPct but invalid -> reject.
    if (body.discountPct !== undefined && body.discountPct !== null && discountPct === null) {
      return jsonFail(400, 'Invalid discountPct. Must be 0–90 (or null).')
    }

    const updated = await prisma.lastMinuteOpening.updateMany({
      where: { id: openingId, professionalId },
      data: {
        ...(status ? { status } : {}),
        ...(note !== undefined ? { note } : {}),
        ...(discountPct !== undefined ? { discountPct } : {}),
      },
    })

    if (updated.count !== 1) return jsonFail(404, 'Opening not found.')

    return jsonOk({ ok: true }, 200)
  } catch (e) {
    console.error('PATCH /api/pro/openings error', e)
    return jsonFail(500, 'Failed to update opening.')
  }
}
