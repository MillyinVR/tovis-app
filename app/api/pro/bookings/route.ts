// app/api/pro/bookings/route.ts
import { prisma } from '@/lib/prisma'
import { BookingStatus, Prisma, ServiceLocationType, ProfessionalLocationType } from '@prisma/client'
import { jsonFail, jsonOk, pickString, requirePro } from '@/app/api/_utils'
import { isValidIanaTimeZone, minutesSinceMidnightInTimeZone, sanitizeTimeZone } from '@/lib/timeZone'
export const dynamic = 'force-dynamic'

function normalizeToMinute(d: Date) {
  const x = new Date(d)
  x.setSeconds(0, 0)
  return x
}

function addMinutes(date: Date, minutes: number) {
  return new Date(date.getTime() + minutes * 60_000)
}

function clampInt(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, Math.trunc(n)))
}

function snapToStep(n: number, stepMinutes: number) {
  const step = clampInt(stepMinutes || 15, 5, 60)
  const x = Math.round(n / step) * step
  return x < 0 ? 0 : x
}

function normalizeLocationType(v: unknown): ServiceLocationType {
  const s = typeof v === 'string' ? v.trim().toUpperCase() : ''
  return s === 'MOBILE' ? ServiceLocationType.MOBILE : ServiceLocationType.SALON
}

function toStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return []
  return v
    .map((x) => (typeof x === 'string' ? x : x == null ? '' : String(x)))
    .map((s) => s.trim())
    .filter(Boolean)
}

/** existingStart < requestedEnd AND existingEnd > requestedStart */
function overlaps(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date) {
  return aStart < bEnd && aEnd > bStart
}

/**
 * Money helpers (route-local; cents-based)
 */
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

  // Prisma Decimal-like: try toString()
  const maybe = v as { toString?: () => string }
  const s = typeof maybe?.toString === 'function' ? maybe.toString() : ''
  return typeof s === 'string' ? moneyStringToCents(s) : 0
}

function centsToMoneyString(cents: number): string {
  const c = Math.max(0, Math.trunc(cents))
  const dollars = Math.trunc(c / 100)
  const rem = c % 100
  return `${dollars}.${String(rem).padStart(2, '0')}`
}

function durationOrDefault(totalDurationMinutes: unknown) {
  const n = Number(totalDurationMinutes ?? 0)
  return Number.isFinite(n) && n > 0 ? n : 60
}

function decimalToNumber(v: unknown): number | undefined {
  if (v == null) return undefined
  if (typeof v === 'number') return Number.isFinite(v) ? v : undefined
  const maybe = v as { toString?: () => string }
  const s = typeof maybe?.toString === 'function' ? maybe.toString() : ''
  const n = Number(s)
  return Number.isFinite(n) ? n : undefined
}

type Body = {
  clientId?: unknown
  scheduledFor?: unknown
  internalNotes?: unknown
  locationId?: unknown
  locationType?: unknown
  serviceIds?: unknown
  bufferMinutes?: unknown
  totalDurationMinutes?: unknown
  allowOutsideWorkingHours?: unknown // pro-only hint (optional)
}

export async function POST(req: Request) {
  try {
    const auth = await requirePro()
    if (!auth.ok) return auth.res
    const professionalId = auth.professionalId

    const body = (await req.json().catch(() => ({}))) as Body

    const clientId = pickString(body?.clientId)
    const scheduledForRaw = pickString(body?.scheduledFor)
    const internalNotes = pickString(body?.internalNotes)

    const locationId = pickString(body?.locationId)
    const locationType = normalizeLocationType(body?.locationType)

    const serviceIds = toStringArray(body?.serviceIds)
    const uniqueServiceIds = Array.from(new Set(serviceIds)).slice(0, 10)

    if (!clientId) return jsonFail(400, 'Missing clientId.')
    if (!scheduledForRaw) return jsonFail(400, 'Missing scheduledFor.')
    if (!locationId) return jsonFail(400, 'Missing locationId.')
    if (!uniqueServiceIds.length) return jsonFail(400, 'Select at least one service.')

    const scheduledStart = normalizeToMinute(new Date(scheduledForRaw))
    if (!Number.isFinite(scheduledStart.getTime())) return jsonFail(400, 'Invalid scheduledFor.')

    // Location is REQUIRED by schema; also gives timezone + snapshots + stepMinutes
    const loc = await prisma.professionalLocation.findFirst({
      where: { id: locationId, professionalId, isBookable: true },
      select: {
        id: true,
        type: true,
        stepMinutes: true,
        timeZone: true,
        formattedAddress: true,
        lat: true,
        lng: true,
      },
    })
    if (!loc) return jsonFail(404, 'Location not found or not bookable.')

    // Enforce booking mode matches location type (high-trust data)
    if (locationType === ServiceLocationType.MOBILE && loc.type !== ProfessionalLocationType.MOBILE_BASE) {
      return jsonFail(400, 'This location is not a mobile base.')
    }
    if (locationType === ServiceLocationType.SALON && loc.type === ProfessionalLocationType.MOBILE_BASE) {
      return jsonFail(400, 'This location is mobile-only.')
    }

    const stepMinutes = clampInt(Number(loc.stepMinutes ?? 15), 5, 60)

    // Ensure start time aligns with step (prevents odd times from clients/tools)
    const apptTz = sanitizeTimeZone(loc.timeZone, 'UTC')
if (!isValidIanaTimeZone(apptTz)) return jsonFail(400, 'This location must set a valid timezone before taking bookings.')

const startMin = minutesSinceMidnightInTimeZone(scheduledStart, apptTz)
if (startMin % stepMinutes !== 0) {
  return jsonFail(400, `Start time must be on a ${stepMinutes}-minute boundary.`)
}

    const bufferMinutes = (() => {
      const n = Number(body?.bufferMinutes ?? 0)
      if (!Number.isFinite(n) || n < 0 || n > 180) return 0
      return snapToStep(n, stepMinutes)
    })()

    // Offerings for selected services (must support the booking mode)
    const offerings = await prisma.professionalServiceOffering.findMany({
      where: {
        professionalId,
        isActive: true,
        serviceId: { in: uniqueServiceIds },
        ...(locationType === ServiceLocationType.MOBILE ? { offersMobile: true } : { offersInSalon: true }),
      },
      select: {
        id: true,
        serviceId: true,
        offersInSalon: true,
        offersMobile: true,
        salonPriceStartingAt: true,
        mobilePriceStartingAt: true,
        salonDurationMinutes: true,
        mobileDurationMinutes: true,
      },
      take: 50,
    })

    const offeringByServiceId = new Map<string, (typeof offerings)[number]>()
    for (const o of offerings) offeringByServiceId.set(o.serviceId, o)

    for (const sid of uniqueServiceIds) {
      if (!offeringByServiceId.get(sid)) {
        return jsonFail(400, 'One or more selected services are not available for this professional.')
      }
    }

    const serviceRows = await prisma.service.findMany({
      where: { id: { in: uniqueServiceIds } },
      select: { id: true, name: true, defaultDurationMinutes: true },
      take: 50,
    })
    const serviceById = new Map(serviceRows.map((s) => [s.id, s]))

    const items = uniqueServiceIds.map((sid, idx) => {
      const off = offeringByServiceId.get(sid)!
      const svc = serviceById.get(sid)

      const durRaw =
        locationType === ServiceLocationType.MOBILE
          ? Number(off.mobileDurationMinutes ?? svc?.defaultDurationMinutes ?? 0)
          : Number(off.salonDurationMinutes ?? svc?.defaultDurationMinutes ?? 0)

      const durationMinutesSnapshot = clampInt(snapToStep(Number(durRaw || 0), stepMinutes), stepMinutes, 12 * 60)

      const priceRaw = locationType === ServiceLocationType.MOBILE ? off.mobilePriceStartingAt : off.salonPriceStartingAt
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

    const computedDuration = items.reduce((sum, i) => sum + Number(i.durationMinutesSnapshot || 0), 0)
    const computedSubtotalCents = items.reduce((sum, i) => sum + Number(i.priceCents || 0), 0)

    const uiDuration = Number(body?.totalDurationMinutes)
    const totalDurationMinutes =
      Number.isFinite(uiDuration) && uiDuration >= stepMinutes && uiDuration <= 12 * 60
        ? clampInt(snapToStep(uiDuration, stepMinutes), stepMinutes, 12 * 60)
        : clampInt(snapToStep(computedDuration || 60, stepMinutes), stepMinutes, 12 * 60)

    const scheduledEnd = addMinutes(scheduledStart, totalDurationMinutes + bufferMinutes)

    // ✅ Conflict checks MUST be location-scoped + include blocks + holds
    const MAX_OTHER_OVERLAP_MINUTES = 12 * 60 + 180 // max duration + max buffer
    const earliestStart = addMinutes(scheduledStart, -MAX_OTHER_OVERLAP_MINUTES)

    const others = await prisma.booking.findMany({
      where: {
        professionalId,
        locationId: loc.id, // ✅ location-scoped
        scheduledFor: { gte: earliestStart, lt: scheduledEnd },
        NOT: { status: BookingStatus.CANCELLED },
      },
      select: { id: true, scheduledFor: true, totalDurationMinutes: true, bufferMinutes: true, status: true },
      take: 500,
    })

    const hasBookingConflict = others.some((b) => {
      if (b.status === BookingStatus.CANCELLED) return false
      const bDur = durationOrDefault(b.totalDurationMinutes)
      const bBuf = Math.max(0, Number(b.bufferMinutes ?? 0))
      const bStart = normalizeToMinute(new Date(b.scheduledFor))
      const bEnd = addMinutes(bStart, bDur + bBuf)
      return overlaps(bStart, bEnd, scheduledStart, scheduledEnd)
    })
    if (hasBookingConflict) return jsonFail(409, 'That time is not available.')

    const blockConflict = await prisma.calendarBlock.findFirst({
      where: {
        professionalId,
        startsAt: { lt: scheduledEnd },
        endsAt: { gt: scheduledStart },
        OR: [{ locationId: loc.id }, { locationId: null }], // ✅ location + global blocks
      },
      select: { id: true },
    })
    if (blockConflict) return jsonFail(409, 'That time is blocked on your calendar.')

    const holdConflict = await prisma.bookingHold.findFirst({
      where: {
        professionalId,
        locationId: loc.id,
        expiresAt: { gt: new Date() },
        scheduledFor: { gte: scheduledStart, lt: scheduledEnd },
      },
      select: { id: true },
    })
    if (holdConflict) return jsonFail(409, 'That time is currently on hold.')

    const primaryItem = items[0] // guaranteed

    // Snapshots
    const locationAddressSnapshot: Prisma.InputJsonValue | undefined =
      loc.formattedAddress && loc.formattedAddress.trim()
        ? ({ formattedAddress: loc.formattedAddress.trim() } satisfies Prisma.InputJsonObject)
        : undefined

    const locationLatSnapshot = decimalToNumber(loc.lat)
    const locationLngSnapshot = decimalToNumber(loc.lng)

    const created = await prisma.booking.create({
      data: {
        professionalId,
        clientId,

        // schema requires serviceId
        serviceId: primaryItem.serviceId,
        offeringId: primaryItem.offeringId,

        scheduledFor: scheduledStart,
        status: BookingStatus.ACCEPTED, // pro-created = accepted
        locationType,

        // schema requires locationId
        locationId: loc.id,
        locationTimeZone: loc.timeZone ?? null,
        locationAddressSnapshot,
        locationLatSnapshot,
        locationLngSnapshot,

        internalNotes: internalNotes ?? null,
        bufferMinutes,
        totalDurationMinutes,

        // Booking-level truth
        subtotalSnapshot: new Prisma.Decimal(centsToMoneyString(computedSubtotalCents)),

        serviceItems: {
          create: items.map((i) => ({
            serviceId: i.serviceId,
            offeringId: i.offeringId,
            priceSnapshot: new Prisma.Decimal(centsToMoneyString(i.priceCents)),
            durationMinutesSnapshot: i.durationMinutesSnapshot,
            sortOrder: i.sortOrder,
          })),
        },
      },
      select: {
        id: true,
        scheduledFor: true,
        totalDurationMinutes: true,
        bufferMinutes: true,
        status: true,
        client: { select: { firstName: true, lastName: true, phone: true, user: { select: { email: true } } } },
      },
    })

    const fn = created.client?.firstName?.trim() || ''
    const ln = created.client?.lastName?.trim() || ''
    const clientName = fn || ln ? `${fn} ${ln}`.trim() : created.client?.user?.email || 'Client'

    const serviceName = items.map((i) => i.serviceName).filter(Boolean).join(' + ') || 'Appointment'
    const endsAt = addMinutes(
      new Date(created.scheduledFor),
      Number(created.totalDurationMinutes ?? totalDurationMinutes) + Number(created.bufferMinutes ?? bufferMinutes),
    )

    return jsonOk(
      {
        booking: {
          id: created.id,
          scheduledFor: new Date(created.scheduledFor).toISOString(),
          endsAt: endsAt.toISOString(),
          totalDurationMinutes: Number(created.totalDurationMinutes ?? totalDurationMinutes),
          bufferMinutes: Number(created.bufferMinutes ?? bufferMinutes),
          status: created.status,
          serviceName,
          clientName,
          subtotalCents: computedSubtotalCents,

          // nice to have for debugging / UI confidence
          locationId: loc.id,
          locationType,
          stepMinutes,
        },
      },
      200,
    )
  } catch (e: unknown) {
    console.error('POST /api/pro/bookings error', e)
    const msg = e instanceof Error && e.message.trim() ? e.message : 'Failed to create booking.'
    return jsonFail(500, msg)
  }
}