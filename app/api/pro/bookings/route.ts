// app/api/pro/bookings/route.ts
import { prisma } from '@/lib/prisma'
import {
  BookingStatus,
  BookingServiceItemType,
  Prisma,
  ProfessionalLocationType,
  ServiceLocationType,
} from '@prisma/client'
import { jsonFail, jsonOk, pickString, requirePro } from '@/app/api/_utils'
import { isValidIanaTimeZone, minutesSinceMidnightInTimeZone, sanitizeTimeZone, getZonedParts } from '@/lib/timeZone'
import { isRecord } from '@/lib/guards'
import { getWorkingWindowForDay } from '@/lib/scheduling/workingHours'

export const dynamic = 'force-dynamic'

const MAX_SLOT_DURATION_MINUTES = 12 * 60
const MAX_BUFFER_MINUTES = 180
const MAX_OTHER_OVERLAP_MINUTES = MAX_SLOT_DURATION_MINUTES + MAX_BUFFER_MINUTES

type Body = {
  clientId?: unknown
  scheduledFor?: unknown
  internalNotes?: unknown

  locationId?: unknown
  locationType?: unknown

  serviceIds?: unknown

  bufferMinutes?: unknown
  totalDurationMinutes?: unknown
  allowOutsideWorkingHours?: unknown
}

function normalizeToMinute(d: Date) {
  const x = new Date(d)
  x.setSeconds(0, 0)
  return x
}

function addMinutes(date: Date, minutes: number) {
  return new Date(date.getTime() + minutes * 60_000)
}

/** existingStart < requestedEnd AND existingEnd > requestedStart */
function overlaps(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date) {
  return aStart < bEnd && aEnd > bStart
}

function clampInt(n: number, min: number, max: number) {
  const x = Math.trunc(n)
  return Math.min(Math.max(x, min), max)
}

function normalizeStepMinutes(input: unknown, fallback: number) {
  const n = typeof input === 'number' ? input : Number(input)
  const raw = Number.isFinite(n) ? Math.trunc(n) : fallback

  const allowed = new Set([5, 10, 15, 20, 30, 60])
  if (allowed.has(raw)) return raw

  if (raw <= 5) return 5
  if (raw <= 10) return 10
  if (raw <= 15) return 15
  if (raw <= 20) return 20
  if (raw <= 30) return 30
  return 60
}

function snapToStep(n: number, stepMinutes: number) {
  const step = clampInt(stepMinutes || 15, 5, 60)
  return Math.round(n / step) * step
}

function normalizeLocationType(v: unknown): ServiceLocationType {
  const s = typeof v === 'string' ? v.trim().toUpperCase() : ''
  return s === 'MOBILE' ? ServiceLocationType.MOBILE : ServiceLocationType.SALON
}

function pickBool(v: unknown): boolean | null {
  return typeof v === 'boolean' ? v : null
}

function pickInt(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? Math.trunc(v) : null
  if (typeof v === 'string' && v.trim()) {
    const n = Number(v)
    return Number.isFinite(n) ? Math.trunc(n) : null
  }
  return null
}

function toStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return []
  return v
    .map((x) => (typeof x === 'string' ? x : x == null ? '' : String(x)))
    .map((s) => s.trim())
    .filter(Boolean)
}

function moneyStringToCents(raw: string): number {
  const cleaned = raw.replace(/\$/g, '').replace(/,/g, '').trim()
  if (!cleaned) return 0
  const m = /^(\d+)(?:\.(\d{0,}))?$/.exec(cleaned)
  if (!m) return 0
  const whole = m[1] || '0'
  let frac = (m[2] || '').slice(0, 2)
  while (frac.length < 2) frac += '0'
  const cents = Number(whole) * 100 + Number(frac || '0')
  return Number.isFinite(cents) ? Math.max(0, cents) : 0
}

function moneyToCents(v: unknown): number {
  if (v == null) return 0
  if (typeof v === 'number') return Number.isFinite(v) ? Math.max(0, Math.round(v * 100)) : 0
  if (typeof v === 'string') return moneyStringToCents(v)
  const maybe = v as { toString?: unknown }
  if (typeof maybe.toString === 'function') return moneyStringToCents(maybe.toString())
  return 0
}

function centsToMoneyString(cents: number): string {
  const c = Math.max(0, Math.trunc(cents))
  const dollars = Math.trunc(c / 100)
  const rem = c % 100
  return `${dollars}.${String(rem).padStart(2, '0')}`
}

function decimalToNumber(v: unknown): number | null {
  if (v == null) return null
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  const maybe = v as { toString?: unknown }
  if (typeof maybe.toString === 'function') {
    const n = Number(maybe.toString())
    return Number.isFinite(n) ? n : null
  }
  return null
}

/* ----------------------------
   Working-hours enforcement
---------------------------- */

function ensureWithinWorkingHours(args: {
  scheduledStartUtc: Date
  scheduledEndUtc: Date
  workingHours: unknown
  timeZone: string
}): { ok: true } | { ok: false; error: string } {
  const { scheduledStartUtc, scheduledEndUtc, workingHours, timeZone } = args

  if (!isRecord(workingHours)) {
    return { ok: false, error: 'Working hours are not set yet.' }
  }

  const tz = sanitizeTimeZone(timeZone, 'UTC')

  const sParts = getZonedParts(scheduledStartUtc, tz)
  const eParts = getZonedParts(scheduledEndUtc, tz)
  const sameLocalDay = sParts.year === eParts.year && sParts.month === eParts.month && sParts.day === eParts.day
  if (!sameLocalDay) {
    return { ok: false, error: 'That time is outside working hours.' }
  }

  const window = getWorkingWindowForDay(scheduledStartUtc, workingHours, tz)
  if (!window.ok) {
    if (window.reason === 'MISSING') {
      return { ok: false, error: 'Working hours are not set yet.' }
    }
    if (window.reason === 'DISABLED') {
      return { ok: false, error: 'That time is outside working hours.' }
    }
    return { ok: false, error: 'Working hours are misconfigured.' }
  }

  const startMin = minutesSinceMidnightInTimeZone(scheduledStartUtc, tz)
  const endMin = minutesSinceMidnightInTimeZone(scheduledEndUtc, tz)

  if (startMin < window.startMinutes || endMin > window.endMinutes) {
    return { ok: false, error: 'That time is outside working hours.' }
  }

  return { ok: true }
}

export async function POST(req: Request) {
  try {
    const auth = await requirePro()
    if (!auth.ok) return auth.res
    const professionalId = auth.professionalId

    const body = (await req.json().catch(() => ({}))) as Body

    const clientId = pickString(body.clientId)
    const scheduledForRaw = pickString(body.scheduledFor)
    const internalNotes = pickString(body.internalNotes)

    const locationId = pickString(body.locationId)
    const locationType = normalizeLocationType(body.locationType)

    const serviceIds = Array.from(new Set(toStringArray(body.serviceIds))).slice(0, 10)

    const allowOutside = pickBool(body.allowOutsideWorkingHours) ?? false

    if (!clientId) return jsonFail(400, 'Missing clientId.')
    if (!scheduledForRaw) return jsonFail(400, 'Missing scheduledFor.')
    if (!locationId) return jsonFail(400, 'Missing locationId.')
    if (!serviceIds.length) return jsonFail(400, 'Select at least one service.')

    const scheduledStart = normalizeToMinute(new Date(scheduledForRaw))
    if (!Number.isFinite(scheduledStart.getTime())) return jsonFail(400, 'Invalid scheduledFor.')

    const loc = await prisma.professionalLocation.findFirst({
      where: { id: locationId, professionalId, isBookable: true },
      select: {
        id: true,
        type: true,
        stepMinutes: true,
        bufferMinutes: true,
        timeZone: true,
        workingHours: true,
        formattedAddress: true,
        lat: true,
        lng: true,
      },
    })
    if (!loc) return jsonFail(404, 'Location not found or not bookable.')

    if (locationType === ServiceLocationType.MOBILE && loc.type !== ProfessionalLocationType.MOBILE_BASE) {
      return jsonFail(400, 'This location is not a mobile base.')
    }
    if (locationType === ServiceLocationType.SALON && loc.type === ProfessionalLocationType.MOBILE_BASE) {
      return jsonFail(400, 'This location is mobile-only.')
    }

    const apptTz = sanitizeTimeZone(loc.timeZone, 'UTC')
    if (!isValidIanaTimeZone(apptTz)) {
      return jsonFail(400, 'This location must set a valid timezone before taking bookings.')
    }

    const stepMinutes = normalizeStepMinutes(loc.stepMinutes, 15)

    // Step alignment (in LOCATION TZ)
    const startMin = minutesSinceMidnightInTimeZone(scheduledStart, apptTz)
    if (startMin % stepMinutes !== 0) {
      return jsonFail(400, `Start time must be on a ${stepMinutes}-minute boundary.`)
    }

    // Booking buffer: default to location buffer; allow override.
    const locationBufferMinutes = clampInt(Number(loc.bufferMinutes ?? 0) || 0, 0, MAX_BUFFER_MINUTES)

    const requestedBuffer = pickInt(body.bufferMinutes)
    const bufferMinutes =
      requestedBuffer == null
        ? locationBufferMinutes
        : clampInt(snapToStep(clampInt(requestedBuffer, 0, MAX_BUFFER_MINUTES), stepMinutes), 0, MAX_BUFFER_MINUTES)

    // Offerings must exist and support mode
    const offerings = await prisma.professionalServiceOffering.findMany({
      where: {
        professionalId,
        isActive: true,
        serviceId: { in: serviceIds },
        ...(locationType === ServiceLocationType.MOBILE ? { offersMobile: true } : { offersInSalon: true }),
      },
      select: {
        id: true,
        serviceId: true,
        salonPriceStartingAt: true,
        mobilePriceStartingAt: true,
        salonDurationMinutes: true,
        mobileDurationMinutes: true,
      },
      take: 50,
    })

    const offeringByServiceId = new Map(offerings.map((o) => [o.serviceId, o]))
    for (const sid of serviceIds) {
      if (!offeringByServiceId.get(sid)) {
        return jsonFail(400, 'One or more selected services are not available for this professional/location type.')
      }
    }

    const serviceRows = await prisma.service.findMany({
      where: { id: { in: serviceIds } },
      select: { id: true, name: true, defaultDurationMinutes: true },
      take: 50,
    })
    const serviceById = new Map(serviceRows.map((s) => [s.id, s]))

    // Build items: first is BASE, rest are ADD_ON.
    const items = serviceIds.map((sid, idx) => {
      const off = offeringByServiceId.get(sid)!
      const svc = serviceById.get(sid)

      const durRaw =
        locationType === ServiceLocationType.MOBILE
          ? Number(off.mobileDurationMinutes ?? svc?.defaultDurationMinutes ?? 0)
          : Number(off.salonDurationMinutes ?? svc?.defaultDurationMinutes ?? 0)

      const dur = Number.isFinite(durRaw) && durRaw > 0 ? durRaw : 0
      if (!dur) throw new Error('BAD_DURATION')

      const durationMinutesSnapshot = clampInt(
        snapToStep(clampInt(dur, stepMinutes, MAX_SLOT_DURATION_MINUTES), stepMinutes),
        stepMinutes,
        MAX_SLOT_DURATION_MINUTES,
      )

      const priceRaw = locationType === ServiceLocationType.MOBILE ? off.mobilePriceStartingAt : off.salonPriceStartingAt
      if (priceRaw == null) throw new Error('PRICING_NOT_SET')

      const priceCents = moneyToCents(priceRaw)

      return {
        serviceId: sid,
        offeringId: off.id,
        serviceName: svc?.name ?? 'Service',
        durationMinutesSnapshot,
        priceCents,
        sortOrder: idx,
      }
    })

    const computedDuration = items.reduce((sum, i) => sum + i.durationMinutesSnapshot, 0)
    const computedSubtotalCents = items.reduce((sum, i) => sum + i.priceCents, 0)

    const uiDuration = pickInt(body.totalDurationMinutes)
    const totalDurationMinutes =
      uiDuration != null && uiDuration >= computedDuration && uiDuration <= MAX_SLOT_DURATION_MINUTES
        ? clampInt(snapToStep(uiDuration, stepMinutes), computedDuration, MAX_SLOT_DURATION_MINUTES)
        : clampInt(snapToStep(computedDuration || 60, stepMinutes), stepMinutes, MAX_SLOT_DURATION_MINUTES)

    const scheduledEnd = addMinutes(scheduledStart, totalDurationMinutes + bufferMinutes)

    if (!allowOutside) {
      const wh = ensureWithinWorkingHours({
        scheduledStartUtc: scheduledStart,
        scheduledEndUtc: scheduledEnd,
        workingHours: loc.workingHours,
        timeZone: apptTz,
      })
      if (!wh.ok) return jsonFail(400, wh.error)
    }

    // Blocks: location OR global
    const blockConflict = await prisma.calendarBlock.findFirst({
      where: {
        professionalId,
        startsAt: { lt: scheduledEnd },
        endsAt: { gt: scheduledStart },
        OR: [{ locationId: loc.id }, { locationId: null }],
      },
      select: { id: true },
    })
    if (blockConflict) return jsonFail(409, 'That time is blocked on your calendar.')

    // Tight overlap window so we don’t miss conflicts due to query limits
    const earliestStart = addMinutes(scheduledStart, -MAX_OTHER_OVERLAP_MINUTES)

    // Bookings: location-scoped
    const others = await prisma.booking.findMany({
      where: {
        professionalId,
        locationId: loc.id,
        scheduledFor: { gte: earliestStart, lt: scheduledEnd },
        NOT: { status: BookingStatus.CANCELLED },
      },
      select: { scheduledFor: true, totalDurationMinutes: true, bufferMinutes: true, status: true },
      take: 2000,
    })

    const hasBookingConflict = others.some((b) => {
      if (b.status === BookingStatus.CANCELLED) return false
      const bStart = normalizeToMinute(new Date(b.scheduledFor))
      const bDur = Number(b.totalDurationMinutes ?? 0) > 0 ? Number(b.totalDurationMinutes) : 60
      const bBuf = Math.max(0, Number(b.bufferMinutes ?? 0))
      const bEnd = addMinutes(bStart, bDur + bBuf)
      return overlaps(bStart, bEnd, scheduledStart, scheduledEnd)
    })
    if (hasBookingConflict) return jsonFail(409, 'That time is not available.')

    // Holds: overlap-aware (needs offering durations)
    const holds = await prisma.bookingHold.findMany({
      where: {
        professionalId,
        locationId: loc.id,
        expiresAt: { gt: new Date() },
        scheduledFor: { gte: earliestStart, lt: scheduledEnd },
      },
      select: { id: true, scheduledFor: true, offeringId: true, locationType: true },
      take: 2000,
    })

    if (holds.length) {
      const offeringIds = Array.from(new Set(holds.map((h) => h.offeringId))).slice(0, 2000)
      const offerRows = await prisma.professionalServiceOffering.findMany({
        where: { id: { in: offeringIds } },
        select: { id: true, salonDurationMinutes: true, mobileDurationMinutes: true },
        take: 2000,
      })
      const byId = new Map(offerRows.map((o) => [o.id, o]))

      const hasHoldConflict = holds.some((h) => {
        const o = byId.get(h.offeringId)
        const durRaw =
          h.locationType === ServiceLocationType.MOBILE ? o?.mobileDurationMinutes : o?.salonDurationMinutes
        const base = Number(durRaw ?? 0)
        const dur = Number.isFinite(base) && base > 0 ? clampInt(base, 15, MAX_SLOT_DURATION_MINUTES) : 60

        const hStart = normalizeToMinute(new Date(h.scheduledFor))
        const hEnd = addMinutes(hStart, dur + locationBufferMinutes)
        return overlaps(hStart, hEnd, scheduledStart, scheduledEnd)
      })

      if (hasHoldConflict) return jsonFail(409, 'That time is currently on hold.')
    }

    // Snapshots
    const locationAddressSnapshot: Prisma.InputJsonValue | undefined =
      loc.formattedAddress && loc.formattedAddress.trim()
        ? ({ formattedAddress: loc.formattedAddress.trim() } satisfies Prisma.InputJsonObject)
        : undefined

    const locationLatSnapshot = decimalToNumber(loc.lat) ?? undefined
    const locationLngSnapshot = decimalToNumber(loc.lng) ?? undefined

    const base = items[0]

    const created = await prisma.$transaction(async (tx) => {
      const booking = await tx.booking.create({
        data: {
          professionalId,
          clientId,

          serviceId: base.serviceId,
          offeringId: base.offeringId,

          scheduledFor: scheduledStart,
          status: BookingStatus.ACCEPTED,

          locationType,
          locationId: loc.id,
          locationTimeZone: apptTz,
          locationAddressSnapshot,
          locationLatSnapshot,
          locationLngSnapshot,

          internalNotes: internalNotes ?? null,

          bufferMinutes,
          totalDurationMinutes,
          subtotalSnapshot: new Prisma.Decimal(centsToMoneyString(computedSubtotalCents)),
        },
        select: { id: true, scheduledFor: true, totalDurationMinutes: true, bufferMinutes: true, status: true },
      })

      const baseItem = await tx.bookingServiceItem.create({
        data: {
          bookingId: booking.id,
          serviceId: base.serviceId,
          offeringId: base.offeringId,
          itemType: BookingServiceItemType.BASE,
          priceSnapshot: new Prisma.Decimal(centsToMoneyString(base.priceCents)),
          durationMinutesSnapshot: base.durationMinutesSnapshot,
          sortOrder: 0,
        },
        select: { id: true },
      })

      const addOns = items.slice(1)
      if (addOns.length) {
        await tx.bookingServiceItem.createMany({
          data: addOns.map((a, i) => ({
            bookingId: booking.id,
            serviceId: a.serviceId,
            offeringId: null,
            itemType: BookingServiceItemType.ADD_ON,
            parentItemId: baseItem.id,
            priceSnapshot: new Prisma.Decimal(centsToMoneyString(a.priceCents)),
            durationMinutesSnapshot: a.durationMinutesSnapshot,
            sortOrder: 100 + i,
            notes: 'MANUAL_ADDON',
          })),
        })
      }

      return booking
    })

    const endsAt = addMinutes(
      new Date(created.scheduledFor),
      Number(created.totalDurationMinutes) + Number(created.bufferMinutes),
    )

    const serviceName = items.map((i) => i.serviceName).filter(Boolean).join(' + ') || 'Appointment'

    return jsonOk(
      {
        booking: {
          id: created.id,
          scheduledFor: new Date(created.scheduledFor).toISOString(),
          endsAt: endsAt.toISOString(),
          totalDurationMinutes: Number(created.totalDurationMinutes),
          bufferMinutes: Number(created.bufferMinutes),
          status: created.status,
          serviceName,
          subtotalCents: computedSubtotalCents,
          locationId: loc.id,
          locationType,
          stepMinutes,
          timeZone: apptTz,
        },
      },
      200,
    )
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : ''

    if (msg === 'PRICING_NOT_SET') return jsonFail(409, 'Pricing is not set for one or more selected services.')
    if (msg === 'BAD_DURATION') return jsonFail(409, 'Duration is not set for one or more selected services.')

    console.error('POST /api/pro/bookings error', e)
    return jsonFail(500, 'Failed to create booking.')
  }
}