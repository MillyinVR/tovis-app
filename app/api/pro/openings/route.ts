// app/api/pro/openings/route.ts
import { prisma } from '@/lib/prisma'
import { BookingStatus, OpeningStatus, ServiceLocationType } from '@prisma/client'
import { jsonFail, jsonOk, pickString, requirePro, upper } from '@/app/api/_utils'
import { pickBookableLocation } from '@/lib/booking/pickLocation'
import { isValidIanaTimeZone } from '@/lib/timeZone'

export const dynamic = 'force-dynamic'

type JsonObject = Record<string, unknown>

async function readJsonObject(req: Request): Promise<JsonObject> {
  const raw: unknown = await req.json().catch(() => ({}))
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) return raw as JsonObject
  return {}
}

function clampInt(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, Math.trunc(n)))
}

function parseIntParam(v: string | null): number | null {
  const s = pickString(v)
  if (!s) return null
  const n = Number(s)
  if (!Number.isFinite(n)) return null
  return Math.trunc(n)
}

function parseIsoDate(v: unknown): Date | null {
  const s = pickString(v)
  if (!s) return null
  const d = new Date(s)
  return Number.isFinite(d.getTime()) ? d : null
}

function addMinutes(d: Date, minutes: number) {
  return new Date(d.getTime() + minutes * 60_000)
}

function parseDiscountPct(v: unknown): number | null {
  if (v === null || v === undefined) return null
  // allow "" to mean null
  if (typeof v === 'string' && v.trim() === '') return null
  const n = typeof v === 'number' ? v : Number(v)
  if (!Number.isFinite(n)) return null
  const rounded = Math.round(n)
  if (rounded < 0 || rounded > 90) return null
  return rounded
}

function parseOpeningStatus(v: unknown): OpeningStatus | null {
  const s = upper(v)
  if (s === 'ACTIVE') return OpeningStatus.ACTIVE
  if (s === 'BOOKED') return OpeningStatus.BOOKED
  if (s === 'EXPIRED') return OpeningStatus.EXPIRED
  if (s === 'CANCELLED') return OpeningStatus.CANCELLED
  return null
}

function parseLocationType(v: unknown): ServiceLocationType | null {
  const s = upper(v)
  if (s === 'SALON') return ServiceLocationType.SALON
  if (s === 'MOBILE') return ServiceLocationType.MOBILE
  return null
}

function pickEffectiveLocationType(args: {
  requested: ServiceLocationType | null
  offersInSalon: boolean
  offersMobile: boolean
}): ServiceLocationType | null {
  const { requested, offersInSalon, offersMobile } = args

  if (requested === ServiceLocationType.SALON && offersInSalon) return ServiceLocationType.SALON
  if (requested === ServiceLocationType.MOBILE && offersMobile) return ServiceLocationType.MOBILE

  // default behavior when UI doesn't send locationType:
  if (offersInSalon) return ServiceLocationType.SALON
  if (offersMobile) return ServiceLocationType.MOBILE
  return null
}

function computeDurationMinutes(args: {
  locationType: ServiceLocationType
  offering: {
    salonDurationMinutes: number | null
    mobileDurationMinutes: number | null
    service: { defaultDurationMinutes: number }
  }
}) {
  const { locationType, offering } = args
  const mode =
    locationType === ServiceLocationType.MOBILE ? offering.mobileDurationMinutes : offering.salonDurationMinutes
  const fallback = offering.service.defaultDurationMinutes || 60
  const picked = typeof mode === 'number' && Number.isFinite(mode) && mode > 0 ? mode : fallback
  return clampInt(picked, 15, 12 * 60)
}

function moneylessNote(v: unknown): string | null {
  const s = pickString(v)
  if (!s) return null
  const trimmed = s.trim()
  return trimmed ? trimmed : null
}

export async function GET(req: Request) {
  try {
    const auth = await requirePro()
    if (!auth.ok) return auth.res
    const professionalId = auth.professionalId

    const url = new URL(req.url)

    const hoursParam = parseIntParam(url.searchParams.get('hours'))
    const daysParam = parseIntParam(url.searchParams.get('days'))
    const takeParam = parseIntParam(url.searchParams.get('take'))
    const statusParam = parseOpeningStatus(url.searchParams.get('status'))

    let hours = 48
    if (typeof hoursParam === 'number') hours = clampInt(hoursParam, 1, 24 * 14) // up to 14 days
    else if (typeof daysParam === 'number') hours = clampInt(daysParam * 24, 1, 24 * 14)

    const take = typeof takeParam === 'number' ? clampInt(takeParam, 1, 200) : 100

    const now = new Date()
    const horizon = addMinutes(now, hours * 60)

    const openings = await prisma.lastMinuteOpening.findMany({
      where: {
        professionalId,
        ...(statusParam ? { status: statusParam } : {}),
        startAt: { gte: now, lte: horizon },
      },
      orderBy: { startAt: 'asc' },
      take,
      select: {
        id: true,
        startAt: true,
        endAt: true,
        status: true,
        discountPct: true,
        note: true,
        offeringId: true,
        serviceId: true,

        // truth fields
        locationType: true,
        locationId: true,
        timeZone: true,

        _count: { select: { notifications: true } },

        offering: {
          select: {
            id: true,
            title: true,
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
    }))

    return jsonOk({ openings: dto }, 200)
  } catch (e) {
    console.error('GET /api/pro/openings error', e)
    return jsonFail(500, 'Failed to load openings.')
  }
}

export async function POST(req: Request) {
  try {
    const auth = await requirePro()
    if (!auth.ok) return auth.res
    const professionalId = auth.professionalId

    const body = await readJsonObject(req)

    const offeringId = pickString(body.offeringId)
    const startAt = parseIsoDate(body.startAt)
    const endAtRaw = parseIsoDate(body.endAt)
    const requestedLocationType = parseLocationType(body.locationType)
    const requestedLocationId = pickString(body.locationId)
    const note = moneylessNote(body.note)
    const discountPct = parseDiscountPct(body.discountPct)

    if (!offeringId || !startAt) return jsonFail(400, 'Missing offeringId or startAt.')

    // guard: don't allow openings "right now" or in the past
    const BUFFER_MINUTES = 5
    if (startAt.getTime() < addMinutes(new Date(), BUFFER_MINUTES).getTime()) {
      return jsonFail(400, 'Please choose a future time.')
    }

    if (discountPct === null && body.discountPct !== undefined && body.discountPct !== null && pickString(body.discountPct) !== null) {
      // if they tried to send something non-nullish but parse failed
      // (we don't accept junk)
      const maybe = body.discountPct
      if (!(typeof maybe === 'string' && maybe.trim() === '')) {
        return jsonFail(400, 'Invalid discountPct. Must be 0–90 (or null).')
      }
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

    const locationType = pickEffectiveLocationType({
      requested: requestedLocationType,
      offersInSalon: Boolean(offering.offersInSalon),
      offersMobile: Boolean(offering.offersMobile),
    })

    if (!locationType) {
      return jsonFail(400, 'This offering is not available for SALON or MOBILE.')
    }

    // truth: pick a bookable location and persist it
    const loc = await pickBookableLocation({
      professionalId,
      requestedLocationId: requestedLocationId || null,
      locationType,
    })
    if (!loc) return jsonFail(409, 'No bookable location found for this opening.')

    const tz = typeof loc.timeZone === 'string' ? loc.timeZone.trim() : ''
    if (!tz || !isValidIanaTimeZone(tz)) {
      return jsonFail(
        409,
        'This location is missing a valid timezone. Set a timezone on your bookable location before creating openings.',
      )
    }

    const durationMinutes = computeDurationMinutes({ locationType, offering })
    const computedEndAt = addMinutes(startAt, durationMinutes)

    const endAt = (() => {
      if (!endAtRaw) return computedEndAt
      // must be valid and after start
      if (endAtRaw.getTime() <= startAt.getTime()) return null
      return endAtRaw
    })()

    if (!endAt) return jsonFail(400, 'End must be after start.')

    // reject overlap with ACTIVE openings
    const overlapOpening = await prisma.lastMinuteOpening.findFirst({
      where: {
        professionalId,
        status: OpeningStatus.ACTIVE,
        startAt: { lt: endAt },
        endAt: { gt: startAt },
      },
      select: { id: true },
    })
    if (overlapOpening) return jsonFail(409, 'You already have an active opening overlapping that time.')

    // reject overlaps with bookings (PENDING/ACCEPTED) using booking truth durations
    const windowStart = addMinutes(startAt, -durationMinutes * 2)
    const windowEnd = addMinutes(startAt, durationMinutes * 2)

    const nearbyBookings = await prisma.booking.findMany({
      where: {
        professionalId,
        status: { in: [BookingStatus.PENDING, BookingStatus.ACCEPTED] },
        scheduledFor: { gte: windowStart, lte: windowEnd },
      },
      select: { scheduledFor: true, totalDurationMinutes: true, bufferMinutes: true, status: true },
      orderBy: { scheduledFor: 'asc' },
      take: 50,
    })

    const overlapsBooking = nearbyBookings.some((b) => {
      const bStart = b.scheduledFor
      const bDur = clampInt(b.totalDurationMinutes, 15, 12 * 60)
      const bBuf = clampInt(b.bufferMinutes, 0, 180)
      const bEnd = addMinutes(bStart, bDur + bBuf)
      return startAt < bEnd && bStart < endAt
    })
    if (overlapsBooking) return jsonFail(409, 'That time overlaps an existing booking.')

    const created = await prisma.lastMinuteOpening.create({
      data: {
        professionalId,
        serviceId: offering.serviceId,
        offeringId: offering.id,

        locationType,
        locationId: loc.id,
        timeZone: tz,

        startAt,
        endAt,
        status: OpeningStatus.ACTIVE,
        discountPct,
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

        locationType: true,
        locationId: true,
        timeZone: true,

        _count: { select: { notifications: true } },
      },
    })

    return jsonOk(
      {
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

export async function DELETE(req: Request) {
  try {
    const auth = await requirePro()
    if (!auth.ok) return auth.res
    const professionalId = auth.professionalId

    const { searchParams } = new URL(req.url)
    const id = pickString(searchParams.get('id'))
    if (!id) return jsonFail(400, 'Missing id.')

    const del = await prisma.lastMinuteOpening.deleteMany({
      where: { id, professionalId },
    })

    if (del.count !== 1) return jsonFail(404, 'Opening not found.')

    return jsonOk({ ok: true }, 200)
  } catch (e) {
    console.error('DELETE /api/pro/openings error', e)
    return jsonFail(500, 'Failed to delete opening.')
  }
}

export async function PATCH(req: Request) {
  try {
    const auth = await requirePro()
    if (!auth.ok) return auth.res
    const professionalId = auth.professionalId

    const body = await readJsonObject(req)

    const openingId = pickString(body.openingId)
    if (!openingId) return jsonFail(400, 'Missing openingId.')

    const status =
      body.status === undefined ? undefined : parseOpeningStatus(body.status)

    const note =
      body.note === undefined ? undefined : moneylessNote(body.note)

    const discountPct =
      body.discountPct === undefined ? undefined : parseDiscountPct(body.discountPct)

    if (body.status !== undefined && pickString(body.status) && status === null) {
      return jsonFail(400, 'Invalid status.')
    }

    if (body.discountPct !== undefined) {
      // allow null to clear; reject junk
      if (body.discountPct !== null && discountPct === null) {
        return jsonFail(400, 'Invalid discountPct. Must be 0–90 (or null).')
      }
    }

    const updated = await prisma.lastMinuteOpening.updateMany({
      where: { id: openingId, professionalId },
      data: {
        ...(status !== undefined ? { status: status ?? undefined } : {}),
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