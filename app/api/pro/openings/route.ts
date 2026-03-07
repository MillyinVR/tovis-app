// app/api/pro/openings/route.ts
import { prisma } from '@/lib/prisma'
import { BookingStatus, OpeningStatus, ServiceLocationType } from '@prisma/client'
import { jsonFail, jsonOk, pickString, requirePro } from '@/app/api/_utils'
import { isRecord } from '@/lib/guards'
import { pickBookableLocation } from '@/lib/booking/pickLocation'
import { isValidIanaTimeZone } from '@/lib/timeZone'

export const dynamic = 'force-dynamic'

type JsonObject = Record<string, unknown>

const DEFAULT_HOURS = 48
const MAX_LOOKAHEAD_HOURS = 24 * 14
const DEFAULT_TAKE = 100
const MAX_TAKE = 200
const OPENING_FUTURE_BUFFER_MINUTES = 5
const MAX_SLOT_DURATION_MINUTES = 12 * 60
const MAX_BUFFER_MINUTES = 180
const MAX_OTHER_OVERLAP_MINUTES = MAX_SLOT_DURATION_MINUTES + MAX_BUFFER_MINUTES
const MAX_NOTE_LENGTH = 500

async function readJsonObject(req: Request): Promise<JsonObject> {
  const raw: unknown = await req.json().catch(() => ({}))
  return isRecord(raw) ? raw : {}
}

function clampInt(n: number, min: number, max: number) {
  const value = Math.trunc(Number(n))
  if (!Number.isFinite(value)) return min
  return Math.max(min, Math.min(max, value))
}

function parseIntParam(v: string | null): number | null {
  const s = pickString(v)
  if (!s) return null

  const n = Number(s)
  if (!Number.isFinite(n)) return null

  return Math.trunc(n)
}

function parseIsoDate(v: unknown): Date | null {
  const s = pickString(typeof v === 'string' ? v : null)
  if (!s) return null

  const d = new Date(s)
  return Number.isFinite(d.getTime()) ? d : null
}

function addMinutes(d: Date, minutes: number) {
  return new Date(d.getTime() + minutes * 60_000)
}

function overlaps(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date) {
  return aStart < bEnd && bStart < aEnd
}

function normalizeLocationType(v: unknown): ServiceLocationType | null {
  const s = typeof v === 'string' ? v.trim().toUpperCase() : ''
  if (s === 'SALON') return ServiceLocationType.SALON
  if (s === 'MOBILE') return ServiceLocationType.MOBILE
  return null
}

function parseOpeningStatus(v: unknown): OpeningStatus | null {
  const s = typeof v === 'string' ? v.trim().toUpperCase() : ''
  if (s === OpeningStatus.ACTIVE) return OpeningStatus.ACTIVE
  if (s === OpeningStatus.BOOKED) return OpeningStatus.BOOKED
  if (s === OpeningStatus.EXPIRED) return OpeningStatus.EXPIRED
  if (s === OpeningStatus.CANCELLED) return OpeningStatus.CANCELLED
  return null
}

function parseDiscountPctInput(
  v: unknown,
  mode: 'post' | 'patch',
): { ok: true; isSet: boolean; value: number | null } | { ok: false } {
  if (v === undefined) {
    return mode === 'patch'
      ? { ok: true, isSet: false, value: null }
      : { ok: true, isSet: true, value: null }
  }

  if (v === null) {
    return { ok: true, isSet: true, value: null }
  }

  if (typeof v === 'string' && v.trim() === '') {
    return { ok: true, isSet: true, value: null }
  }

  const n = typeof v === 'number' ? v : Number(v)
  if (!Number.isFinite(n)) return { ok: false }

  const rounded = Math.round(n)
  if (rounded < 0 || rounded > 90) return { ok: false }

  return { ok: true, isSet: true, value: rounded }
}

function parseNoteInput(
  v: unknown,
  mode: 'post' | 'patch',
): { ok: true; isSet: boolean; value: string | null } | { ok: false } {
  if (v === undefined) {
    return mode === 'patch'
      ? { ok: true, isSet: false, value: null }
      : { ok: true, isSet: true, value: null }
  }

  if (v === null) {
    return { ok: true, isSet: true, value: null }
  }

  if (typeof v !== 'string') {
    return { ok: false }
  }

  const trimmed = v.trim()
  if (!trimmed) {
    return { ok: true, isSet: true, value: null }
  }

  return {
    ok: true,
    isSet: true,
    value: trimmed.slice(0, MAX_NOTE_LENGTH),
  }
}

function resolveOpeningLocationType(args: {
  requested: ServiceLocationType | null
  offersInSalon: boolean
  offersMobile: boolean
}): { ok: true; locationType: ServiceLocationType } | { ok: false; error: string } {
  const { requested, offersInSalon, offersMobile } = args

  if (requested === ServiceLocationType.SALON) {
    if (!offersInSalon) {
      return { ok: false, error: 'This offering does not support salon openings.' }
    }
    return { ok: true, locationType: ServiceLocationType.SALON }
  }

  if (requested === ServiceLocationType.MOBILE) {
    if (!offersMobile) {
      return { ok: false, error: 'This offering does not support mobile openings.' }
    }
    return { ok: true, locationType: ServiceLocationType.MOBILE }
  }

  if (offersInSalon && offersMobile) {
    return { ok: false, error: 'Pick a locationType for this opening.' }
  }

  if (offersInSalon) {
    return { ok: true, locationType: ServiceLocationType.SALON }
  }

  if (offersMobile) {
    return { ok: true, locationType: ServiceLocationType.MOBILE }
  }

  return { ok: false, error: 'This offering is not available for salon or mobile openings.' }
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

  const modeDuration =
    locationType === ServiceLocationType.MOBILE
      ? offering.mobileDurationMinutes
      : offering.salonDurationMinutes

  const fallbackDuration = offering.service.defaultDurationMinutes || 60
  const picked =
    typeof modeDuration === 'number' && Number.isFinite(modeDuration) && modeDuration > 0
      ? modeDuration
      : fallbackDuration

  return clampInt(picked, 15, MAX_SLOT_DURATION_MINUTES)
}

function pickHoldDurationMinutes(args: {
  locationType: ServiceLocationType
  salonDurationMinutes: number | null
  mobileDurationMinutes: number | null
}) {
  const raw =
    args.locationType === ServiceLocationType.MOBILE
      ? args.mobileDurationMinutes
      : args.salonDurationMinutes

  const n = Number(raw ?? 0)
  if (!Number.isFinite(n) || n <= 0) return 60
  return clampInt(n, 15, MAX_SLOT_DURATION_MINUTES)
}

function mapOpeningDto(opening: {
  id: string
  status: OpeningStatus
  startAt: Date
  endAt: Date | null
  discountPct: number | null
  note: string | null
  offeringId: string | null
  serviceId: string | null
  locationType: ServiceLocationType
  locationId: string
  timeZone: string
  _count?: { notifications: number }
  offering?: { id: string; title: string | null; service: { id: string; name: string } | null } | null
  service?: { id: string; name: string } | null
}) {
  return {
    id: opening.id,
    status: opening.status,
    startAt: opening.startAt.toISOString(),
    endAt: opening.endAt ? opening.endAt.toISOString() : null,
    discountPct: opening.discountPct ?? null,
    note: opening.note ?? null,
    offeringId: opening.offeringId ?? null,
    serviceId: opening.serviceId ?? null,

    locationType: opening.locationType,
    locationId: opening.locationId,
    timeZone: opening.timeZone,

    notificationsCount: opening._count?.notifications ?? 0,

    offering: opening.offering
      ? {
          id: opening.offering.id,
          title: opening.offering.title ?? null,
          service: opening.offering.service
            ? {
                id: opening.offering.service.id,
                name: opening.offering.service.name,
              }
            : null,
        }
      : null,

    service: opening.service
      ? {
          id: opening.service.id,
          name: opening.service.name,
        }
      : null,
  }
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

    let hours = DEFAULT_HOURS
    if (typeof hoursParam === 'number') {
      hours = clampInt(hoursParam, 1, MAX_LOOKAHEAD_HOURS)
    } else if (typeof daysParam === 'number') {
      hours = clampInt(daysParam * 24, 1, MAX_LOOKAHEAD_HOURS)
    }

    const take = typeof takeParam === 'number' ? clampInt(takeParam, 1, MAX_TAKE) : DEFAULT_TAKE

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

    return jsonOk(
      {
        openings: openings.map(mapOpeningDto),
      },
      200,
    )
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
    const requestedLocationType = normalizeLocationType(body.locationType)
    const requestedLocationId = pickString(body.locationId)

    const noteInput = parseNoteInput(body.note, 'post')
    if (!noteInput.ok) {
      return jsonFail(400, 'Invalid note.')
    }

    const discountInput = parseDiscountPctInput(body.discountPct, 'post')
    if (!discountInput.ok) {
      return jsonFail(400, 'Invalid discountPct. Must be 0–90 (or null).')
    }

    const note = noteInput.value
    const discountPct = discountInput.value

    if (!offeringId || !startAt) {
      return jsonFail(400, 'Missing offeringId or startAt.')
    }

    const now = new Date()
    if (startAt.getTime() < addMinutes(now, OPENING_FUTURE_BUFFER_MINUTES).getTime()) {
      return jsonFail(400, 'Please choose a future time.')
    }

    const offering = await prisma.professionalServiceOffering.findFirst({
      where: {
        id: offeringId,
        professionalId,
        isActive: true,
      },
      select: {
        id: true,
        professionalId: true,
        serviceId: true,
        offersInSalon: true,
        offersMobile: true,
        salonDurationMinutes: true,
        mobileDurationMinutes: true,
        service: {
          select: {
            id: true,
            name: true,
            defaultDurationMinutes: true,
          },
        },
      },
    })

    if (!offering) {
      return jsonFail(404, 'Offering not found or inactive.')
    }

    const locationTypeResult = resolveOpeningLocationType({
      requested: requestedLocationType,
      offersInSalon: Boolean(offering.offersInSalon),
      offersMobile: Boolean(offering.offersMobile),
    })

    if (!locationTypeResult.ok) {
      return jsonFail(400, locationTypeResult.error)
    }

    const locationType = locationTypeResult.locationType

    const loc = await pickBookableLocation({
      professionalId,
      requestedLocationId: requestedLocationId || null,
      locationType,
    })

    if (!loc) {
      return jsonFail(409, 'No bookable location found for this opening.')
    }

    const timeZone = typeof loc.timeZone === 'string' ? loc.timeZone.trim() : ''
    if (!timeZone || !isValidIanaTimeZone(timeZone)) {
      return jsonFail(
        409,
        'This location is missing a valid timezone. Set a timezone on your bookable location before creating openings.',
      )
    }

    const durationMinutes = computeDurationMinutes({ locationType, offering })
    const minimumEndAt = addMinutes(startAt, durationMinutes)

    let endAt = minimumEndAt
    if (endAtRaw) {
      if (endAtRaw.getTime() <= startAt.getTime()) {
        return jsonFail(400, 'End must be after start.')
      }
      if (endAtRaw.getTime() < minimumEndAt.getTime()) {
        return jsonFail(400, `End must allow at least ${durationMinutes} minutes for this service.`)
      }
      endAt = endAtRaw
    }

    const overlapOpening = await prisma.lastMinuteOpening.findFirst({
      where: {
        professionalId,
        status: OpeningStatus.ACTIVE,
        startAt: { lt: endAt },
        endAt: { gt: startAt },
      },
      select: { id: true },
    })

    if (overlapOpening) {
      return jsonFail(409, 'You already have an active opening overlapping that time.')
    }

    const blockConflict = await prisma.calendarBlock.findFirst({
      where: {
        professionalId,
        startsAt: { lt: endAt },
        endsAt: { gt: startAt },
        OR: [{ locationId: loc.id }, { locationId: null }],
      },
      select: { id: true },
    })

    if (blockConflict) {
      return jsonFail(409, 'That time is blocked.')
    }

    const earliestStart = addMinutes(startAt, -MAX_OTHER_OVERLAP_MINUTES)

    const nearbyBookings = await prisma.booking.findMany({
      where: {
        professionalId,
        status: { in: [BookingStatus.PENDING, BookingStatus.ACCEPTED] },
        scheduledFor: { gte: earliestStart, lt: endAt },
      },
      select: {
        scheduledFor: true,
        totalDurationMinutes: true,
        bufferMinutes: true,
      },
      take: 2000,
    })

    const overlapsBooking = nearbyBookings.some((booking) => {
      const bookingStart = booking.scheduledFor
      const bookingDuration = clampInt(Number(booking.totalDurationMinutes ?? 0) || 60, 15, MAX_SLOT_DURATION_MINUTES)
      const bookingBuffer = clampInt(Number(booking.bufferMinutes ?? 0) || 0, 0, MAX_BUFFER_MINUTES)
      const bookingEnd = addMinutes(bookingStart, bookingDuration + bookingBuffer)

      return overlaps(startAt, endAt, bookingStart, bookingEnd)
    })

    if (overlapsBooking) {
      return jsonFail(409, 'That time overlaps an existing booking.')
    }

    const activeHolds = await prisma.bookingHold.findMany({
      where: {
        professionalId,
        expiresAt: { gt: now },
        scheduledFor: { gte: earliestStart, lt: endAt },
      },
      select: {
        id: true,
        scheduledFor: true,
        offeringId: true,
        locationId: true,
        locationType: true,
      },
      take: 2000,
    })

    if (activeHolds.length) {
      const holdOfferingIds = Array.from(new Set(activeHolds.map((hold) => hold.offeringId)))

      const holdOfferings = holdOfferingIds.length
        ? await prisma.professionalServiceOffering.findMany({
            where: { id: { in: holdOfferingIds } },
            select: {
              id: true,
              salonDurationMinutes: true,
              mobileDurationMinutes: true,
            },
            take: 2000,
          })
        : []

      const holdOfferingById = new Map(holdOfferings.map((row) => [row.id, row]))

      const holdLocationIds = Array.from(
        new Set(
          activeHolds
            .map((hold) => hold.locationId)
            .filter((value): value is string => typeof value === 'string' && value.length > 0),
        ),
      )

      const holdLocations = holdLocationIds.length
        ? await prisma.professionalLocation.findMany({
            where: { id: { in: holdLocationIds } },
            select: {
              id: true,
              bufferMinutes: true,
            },
            take: 2000,
          })
        : []

      const holdBufferByLocationId = new Map(
        holdLocations.map((row) => [row.id, clampInt(Number(row.bufferMinutes ?? 0) || 0, 0, MAX_BUFFER_MINUTES)]),
      )

      const overlapsHold = activeHolds.some((hold) => {
        const holdOffering = holdOfferingById.get(hold.offeringId)
        const holdDuration = pickHoldDurationMinutes({
          locationType: hold.locationType,
          salonDurationMinutes: holdOffering?.salonDurationMinutes ?? null,
          mobileDurationMinutes: holdOffering?.mobileDurationMinutes ?? null,
        })

        const holdStart = hold.scheduledFor
        const holdBuffer = holdBufferByLocationId.get(hold.locationId) ?? 0
        const holdEnd = addMinutes(holdStart, holdDuration + holdBuffer)

        return overlaps(startAt, endAt, holdStart, holdEnd)
      })

      if (overlapsHold) {
        return jsonFail(409, 'That time is currently being held by a client.')
      }
    }

    const created = await prisma.lastMinuteOpening.create({
      data: {
        professionalId,
        serviceId: offering.serviceId,
        offeringId: offering.id,
        locationType,
        locationId: loc.id,
        timeZone,
        startAt,
        endAt,
        status: OpeningStatus.ACTIVE,
        discountPct,
        note,
      },
      select: {
        id: true,
        startAt: true,
        endAt: true,
        status: true,
        discountPct: true,
        note: true,
        offeringId: true,
        serviceId: true,
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

    return jsonOk({ opening: mapOpeningDto(created) }, 201)
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
    if (!id) {
      return jsonFail(400, 'Missing id.')
    }

    const deleted = await prisma.lastMinuteOpening.deleteMany({
      where: {
        id,
        professionalId,
      },
    })

    if (deleted.count !== 1) {
      return jsonFail(404, 'Opening not found.')
    }

    return jsonOk({ ok: true, id }, 200)
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
    if (!openingId) {
      return jsonFail(400, 'Missing openingId.')
    }

    let status: OpeningStatus | undefined
    if (body.status !== undefined) {
      const parsedStatus = parseOpeningStatus(body.status)
      if (!parsedStatus) {
        return jsonFail(400, 'Invalid status.')
      }
      status = parsedStatus
    }

    const noteInput = parseNoteInput(body.note, 'patch')
    if (!noteInput.ok) {
      return jsonFail(400, 'Invalid note.')
    }

    const discountInput = parseDiscountPctInput(body.discountPct, 'patch')
    if (!discountInput.ok) {
      return jsonFail(400, 'Invalid discountPct. Must be 0–90 (or null).')
    }

    const data: {
      status?: OpeningStatus
      note?: string | null
      discountPct?: number | null
    } = {}

    if (status !== undefined) {
      data.status = status
    }

    if (noteInput.isSet) {
      data.note = noteInput.value
    }

    if (discountInput.isSet) {
      data.discountPct = discountInput.value
    }

    if (Object.keys(data).length === 0) {
      return jsonFail(400, 'No valid fields to update.')
    }

    const updated = await prisma.lastMinuteOpening.updateMany({
      where: {
        id: openingId,
        professionalId,
      },
      data,
    })

    if (updated.count !== 1) {
      return jsonFail(404, 'Opening not found.')
    }

    const opening = await prisma.lastMinuteOpening.findUnique({
      where: { id: openingId },
      select: {
        id: true,
        startAt: true,
        endAt: true,
        status: true,
        discountPct: true,
        note: true,
        offeringId: true,
        serviceId: true,
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

    if (!opening) {
      return jsonFail(404, 'Opening not found.')
    }

    return jsonOk({ opening: mapOpeningDto(opening) }, 200)
  } catch (e) {
    console.error('PATCH /api/pro/openings error', e)
    return jsonFail(500, 'Failed to update opening.')
  }
}