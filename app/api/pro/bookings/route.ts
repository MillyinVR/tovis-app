// app/api/pro/bookings/route.ts
import { prisma } from '@/lib/prisma'
import {
  BookingServiceItemType,
  BookingStatus,
  Prisma,
  ProfessionalLocationType,
  ServiceLocationType,
} from '@prisma/client'
import { jsonFail, jsonOk, pickString, requirePro } from '@/app/api/_utils'
import { isRecord } from '@/lib/guards'
import {
  getZonedParts,
  isValidIanaTimeZone,
  minutesSinceMidnightInTimeZone,
  sanitizeTimeZone,
} from '@/lib/timeZone'
import { getWorkingWindowForDay } from '@/lib/scheduling/workingHours'

export const dynamic = 'force-dynamic'

const MAX_SLOT_DURATION_MINUTES = 12 * 60
const MAX_BUFFER_MINUTES = 180
const MAX_OTHER_OVERLAP_MINUTES = MAX_SLOT_DURATION_MINUTES + MAX_BUFFER_MINUTES
const DEFAULT_FALLBACK_DURATION_MINUTES = 60

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

type BuiltItem = {
  serviceId: string
  offeringId: string
  serviceName: string
  durationMinutesSnapshot: number
  priceCents: number
  sortOrder: number
}

function normalizeToMinute(date: Date): Date {
  const normalized = new Date(date)
  normalized.setSeconds(0, 0)
  return normalized
}

function addMinutes(date: Date, minutes: number): Date {
  return new Date(date.getTime() + minutes * 60_000)
}

/** existingStart < requestedEnd AND existingEnd > requestedStart */
function overlaps(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date): boolean {
  return aStart < bEnd && aEnd > bStart
}

function clampInt(value: number, min: number, max: number): number {
  const truncated = Math.trunc(value)
  return Math.min(Math.max(truncated, min), max)
}

function normalizeStepMinutes(input: unknown, fallback: number): number {
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

function snapToStep(value: number, stepMinutes: number): number {
  const step = clampInt(stepMinutes || 15, 5, 60)
  return Math.round(value / step) * step
}

function normalizeLocationType(value: unknown): ServiceLocationType {
  const normalized = typeof value === 'string' ? value.trim().toUpperCase() : ''
  return normalized === 'MOBILE' ? ServiceLocationType.MOBILE : ServiceLocationType.SALON
}

function pickBool(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null
}

function pickInt(value: unknown): number | null {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? Math.trunc(value) : null
  }

  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? Math.trunc(parsed) : null
  }

  return null
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []

  return value
    .map((entry) => {
      if (typeof entry === 'string') return entry
      if (entry == null) return ''
      return String(entry)
    })
    .map((s) => s.trim())
    .filter(Boolean)
}

function moneyStringToCents(raw: string): number {
  const cleaned = raw.replace(/\$/g, '').replace(/,/g, '').trim()
  if (!cleaned) return 0

  const match = /^(\d+)(?:\.(\d{0,}))?$/.exec(cleaned)
  if (!match) return 0

  const whole = match[1] || '0'
  let frac = (match[2] || '').slice(0, 2)
  while (frac.length < 2) frac += '0'

  const cents = Number(whole) * 100 + Number(frac || '0')
  return Number.isFinite(cents) ? Math.max(0, cents) : 0
}

function moneyToCents(value: unknown): number {
  if (value == null) return 0

  if (typeof value === 'number') {
    return Number.isFinite(value) ? Math.max(0, Math.round(value * 100)) : 0
  }

  if (typeof value === 'string') {
    return moneyStringToCents(value)
  }

  if (typeof value === 'object' && value !== null && 'toString' in value && typeof value.toString === 'function') {
    return moneyStringToCents(value.toString())
  }

  return 0
}

function centsToMoneyString(cents: number): string {
  const safeCents = Math.max(0, Math.trunc(cents))
  const dollars = Math.trunc(safeCents / 100)
  const rem = safeCents % 100
  return `${dollars}.${String(rem).padStart(2, '0')}`
}

function decimalToNumber(value: unknown): number | null {
  if (value == null) return null

  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null
  }

  if (typeof value === 'object' && value !== null && 'toString' in value && typeof value.toString === 'function') {
    const parsed = Number(value.toString())
    return Number.isFinite(parsed) ? parsed : null
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

  const startParts = getZonedParts(scheduledStartUtc, tz)
  const endParts = getZonedParts(scheduledEndUtc, tz)
  const sameLocalDay =
    startParts.year === endParts.year &&
    startParts.month === endParts.month &&
    startParts.day === endParts.day

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

  const startMinutes = minutesSinceMidnightInTimeZone(scheduledStartUtc, tz)
  const endMinutes = minutesSinceMidnightInTimeZone(scheduledEndUtc, tz)

  if (startMinutes < window.startMinutes || endMinutes > window.endMinutes) {
    return { ok: false, error: 'That time is outside working hours.' }
  }

  return { ok: true }
}

function getLocationBufferMinutes(raw: unknown): number {
  return clampInt(Number(raw ?? 0) || 0, 0, MAX_BUFFER_MINUTES)
}

function buildLocationAddressSnapshot(formattedAddress: string | null): Prisma.InputJsonValue | undefined {
  if (!formattedAddress || !formattedAddress.trim()) return undefined

  return {
    formattedAddress: formattedAddress.trim(),
  } satisfies Prisma.InputJsonObject
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
    const allowOutsideWorkingHours = pickBool(body.allowOutsideWorkingHours) ?? false

    if (!clientId) return jsonFail(400, 'Missing clientId.')
    if (!scheduledForRaw) return jsonFail(400, 'Missing scheduledFor.')
    if (!locationId) return jsonFail(400, 'Missing locationId.')
    if (!serviceIds.length) return jsonFail(400, 'Select at least one service.')

    const scheduledStart = normalizeToMinute(new Date(scheduledForRaw))
    if (!Number.isFinite(scheduledStart.getTime())) {
      return jsonFail(400, 'Invalid scheduledFor.')
    }

    const location = await prisma.professionalLocation.findFirst({
      where: {
        id: locationId,
        professionalId,
        isBookable: true,
      },
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

    if (!location) {
      return jsonFail(404, 'Location not found or not bookable.')
    }

    if (
      locationType === ServiceLocationType.MOBILE &&
      location.type !== ProfessionalLocationType.MOBILE_BASE
    ) {
      return jsonFail(400, 'This location is not a mobile base.')
    }

    if (
      locationType === ServiceLocationType.SALON &&
      location.type === ProfessionalLocationType.MOBILE_BASE
    ) {
      return jsonFail(400, 'This location is mobile-only.')
    }

    const appointmentTimeZone = sanitizeTimeZone(location.timeZone, 'UTC')
    if (!isValidIanaTimeZone(appointmentTimeZone)) {
      return jsonFail(400, 'This location must set a valid timezone before taking bookings.')
    }

    const stepMinutes = normalizeStepMinutes(location.stepMinutes, 15)
    const startMinuteOfDay = minutesSinceMidnightInTimeZone(scheduledStart, appointmentTimeZone)
    if (startMinuteOfDay % stepMinutes !== 0) {
      return jsonFail(400, `Start time must be on a ${stepMinutes}-minute boundary.`)
    }

    const locationBufferMinutes = getLocationBufferMinutes(location.bufferMinutes)
    const requestedBufferMinutes = pickInt(body.bufferMinutes)

    const bufferMinutes =
      requestedBufferMinutes == null
        ? locationBufferMinutes
        : clampInt(
            snapToStep(clampInt(requestedBufferMinutes, 0, MAX_BUFFER_MINUTES), stepMinutes),
            0,
            MAX_BUFFER_MINUTES,
          )

    const offerings = await prisma.professionalServiceOffering.findMany({
      where: {
        professionalId,
        isActive: true,
        serviceId: { in: serviceIds },
        ...(locationType === ServiceLocationType.MOBILE
          ? { offersMobile: true }
          : { offersInSalon: true }),
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

    const offeringByServiceId = new Map(offerings.map((offering) => [offering.serviceId, offering]))

    for (const serviceId of serviceIds) {
      if (!offeringByServiceId.has(serviceId)) {
        return jsonFail(
          400,
          'One or more selected services are not available for this professional/location type.',
        )
      }
    }

    const services = await prisma.service.findMany({
      where: { id: { in: serviceIds } },
      select: {
        id: true,
        name: true,
        defaultDurationMinutes: true,
      },
      take: 50,
    })

    const serviceById = new Map(services.map((service) => [service.id, service]))

    const items: BuiltItem[] = serviceIds.map((serviceId, index) => {
      const offering = offeringByServiceId.get(serviceId)
      const service = serviceById.get(serviceId)

      if (!offering) {
        throw new Error('MISSING_OFFERING')
      }

      const rawDuration =
        locationType === ServiceLocationType.MOBILE
          ? Number(offering.mobileDurationMinutes ?? service?.defaultDurationMinutes ?? 0)
          : Number(offering.salonDurationMinutes ?? service?.defaultDurationMinutes ?? 0)

      if (!Number.isFinite(rawDuration) || rawDuration <= 0) {
        throw new Error('BAD_DURATION')
      }

      const durationMinutesSnapshot = clampInt(
        snapToStep(clampInt(rawDuration, stepMinutes, MAX_SLOT_DURATION_MINUTES), stepMinutes),
        stepMinutes,
        MAX_SLOT_DURATION_MINUTES,
      )

      const rawPrice =
        locationType === ServiceLocationType.MOBILE
          ? offering.mobilePriceStartingAt
          : offering.salonPriceStartingAt

      if (rawPrice == null) {
        throw new Error('PRICING_NOT_SET')
      }

      return {
        serviceId,
        offeringId: offering.id,
        serviceName: service?.name ?? 'Service',
        durationMinutesSnapshot,
        priceCents: moneyToCents(rawPrice),
        sortOrder: index,
      }
    })

    const computedDurationMinutes = items.reduce(
      (sum, item) => sum + item.durationMinutesSnapshot,
      0,
    )

    const computedSubtotalCents = items.reduce((sum, item) => sum + item.priceCents, 0)

    const requestedTotalDurationMinutes = pickInt(body.totalDurationMinutes)

    const totalDurationMinutes =
      requestedTotalDurationMinutes != null &&
      requestedTotalDurationMinutes >= computedDurationMinutes &&
      requestedTotalDurationMinutes <= MAX_SLOT_DURATION_MINUTES
        ? clampInt(
            snapToStep(requestedTotalDurationMinutes, stepMinutes),
            computedDurationMinutes,
            MAX_SLOT_DURATION_MINUTES,
          )
        : clampInt(
            snapToStep(
              computedDurationMinutes || DEFAULT_FALLBACK_DURATION_MINUTES,
              stepMinutes,
            ),
            stepMinutes,
            MAX_SLOT_DURATION_MINUTES,
          )

    const scheduledEnd = addMinutes(scheduledStart, totalDurationMinutes + bufferMinutes)

    if (!allowOutsideWorkingHours) {
      const workingHoursResult = ensureWithinWorkingHours({
        scheduledStartUtc: scheduledStart,
        scheduledEndUtc: scheduledEnd,
        workingHours: location.workingHours,
        timeZone: appointmentTimeZone,
      })

      if (!workingHoursResult.ok) {
        return jsonFail(400, workingHoursResult.error)
      }
    }

    const blockConflict = await prisma.calendarBlock.findFirst({
      where: {
        professionalId,
        startsAt: { lt: scheduledEnd },
        endsAt: { gt: scheduledStart },
        OR: [{ locationId: location.id }, { locationId: null }],
      },
      select: { id: true },
    })

    if (blockConflict) {
      return jsonFail(409, 'That time is blocked on your calendar.')
    }

    const earliestStart = addMinutes(scheduledStart, -MAX_OTHER_OVERLAP_MINUTES)

    const existingBookings = await prisma.booking.findMany({
      where: {
        professionalId,
        locationId: location.id,
        scheduledFor: { gte: earliestStart, lt: scheduledEnd },
        NOT: { status: BookingStatus.CANCELLED },
      },
      select: {
        scheduledFor: true,
        totalDurationMinutes: true,
        bufferMinutes: true,
        status: true,
      },
      take: 2000,
    })

    const hasBookingConflict = existingBookings.some((booking) => {
      if (booking.status === BookingStatus.CANCELLED) return false

      const bookingStart = normalizeToMinute(new Date(booking.scheduledFor))
      const bookingDuration =
        Number(booking.totalDurationMinutes ?? 0) > 0
          ? Number(booking.totalDurationMinutes)
          : DEFAULT_FALLBACK_DURATION_MINUTES
      const bookingBuffer = Math.max(0, Number(booking.bufferMinutes ?? 0))
      const bookingEnd = addMinutes(bookingStart, bookingDuration + bookingBuffer)

      return overlaps(bookingStart, bookingEnd, scheduledStart, scheduledEnd)
    })

    if (hasBookingConflict) {
      return jsonFail(409, 'That time is not available.')
    }

    const activeHolds = await prisma.bookingHold.findMany({
      where: {
        professionalId,
        locationId: location.id,
        expiresAt: { gt: new Date() },
        scheduledFor: { gte: earliestStart, lt: scheduledEnd },
      },
      select: {
        id: true,
        scheduledFor: true,
        offeringId: true,
        locationType: true,
      },
      take: 2000,
    })

    if (activeHolds.length > 0) {
      const heldOfferingIds = Array.from(new Set(activeHolds.map((hold) => hold.offeringId))).slice(0, 2000)

      const heldOfferings = await prisma.professionalServiceOffering.findMany({
        where: { id: { in: heldOfferingIds } },
        select: {
          id: true,
          salonDurationMinutes: true,
          mobileDurationMinutes: true,
        },
        take: 2000,
      })

      const heldOfferingById = new Map(heldOfferings.map((offering) => [offering.id, offering]))

      const hasHoldConflict = activeHolds.some((hold) => {
        const heldOffering = heldOfferingById.get(hold.offeringId)
        const rawHeldDuration =
          hold.locationType === ServiceLocationType.MOBILE
            ? heldOffering?.mobileDurationMinutes
            : heldOffering?.salonDurationMinutes

        const heldDurationBase = Number(rawHeldDuration ?? 0)
        const heldDuration =
          Number.isFinite(heldDurationBase) && heldDurationBase > 0
            ? clampInt(heldDurationBase, 15, MAX_SLOT_DURATION_MINUTES)
            : DEFAULT_FALLBACK_DURATION_MINUTES

        const holdStart = normalizeToMinute(new Date(hold.scheduledFor))
        const holdEnd = addMinutes(holdStart, heldDuration + locationBufferMinutes)

        return overlaps(holdStart, holdEnd, scheduledStart, scheduledEnd)
      })

      if (hasHoldConflict) {
        return jsonFail(409, 'That time is currently on hold.')
      }
    }

    const locationAddressSnapshot = buildLocationAddressSnapshot(location.formattedAddress)
    const locationLatSnapshot = decimalToNumber(location.lat) ?? undefined
    const locationLngSnapshot = decimalToNumber(location.lng) ?? undefined

    const baseItem = items[0]
    if (!baseItem) {
      return jsonFail(400, 'Select at least one service.')
    }

    const createdBooking = await prisma.$transaction(async (tx) => {
      const booking = await tx.booking.create({
        data: {
          professionalId,
          clientId,

          serviceId: baseItem.serviceId,
          offeringId: baseItem.offeringId,

          scheduledFor: scheduledStart,
          status: BookingStatus.ACCEPTED,

          locationType,
          locationId: location.id,
          locationTimeZone: appointmentTimeZone,
          locationAddressSnapshot,
          locationLatSnapshot,
          locationLngSnapshot,

          internalNotes: internalNotes ?? null,

          bufferMinutes,
          totalDurationMinutes,
          subtotalSnapshot: new Prisma.Decimal(centsToMoneyString(computedSubtotalCents)),
        },
        select: {
          id: true,
          scheduledFor: true,
          totalDurationMinutes: true,
          bufferMinutes: true,
          status: true,
        },
      })

      const createdBaseItem = await tx.bookingServiceItem.create({
        data: {
          bookingId: booking.id,
          serviceId: baseItem.serviceId,
          offeringId: baseItem.offeringId,
          itemType: BookingServiceItemType.BASE,
          priceSnapshot: new Prisma.Decimal(centsToMoneyString(baseItem.priceCents)),
          durationMinutesSnapshot: baseItem.durationMinutesSnapshot,
          sortOrder: 0,
        },
        select: { id: true },
      })

      const addOnItems = items.slice(1)

      for (const [index, item] of addOnItems.entries()) {
        await tx.bookingServiceItem.create({
          data: {
            bookingId: booking.id,
            serviceId: item.serviceId,
            offeringId: item.offeringId,
            itemType: BookingServiceItemType.ADD_ON,
            parentItemId: createdBaseItem.id,
            priceSnapshot: new Prisma.Decimal(centsToMoneyString(item.priceCents)),
            durationMinutesSnapshot: item.durationMinutesSnapshot,
            sortOrder: 100 + index,
            notes: 'MANUAL_ADDON',
          },
        })
      }

      return booking
    })
    const endsAt = addMinutes(
      new Date(createdBooking.scheduledFor),
      Number(createdBooking.totalDurationMinutes) + Number(createdBooking.bufferMinutes),
    )

    const serviceName =
      items.map((item) => item.serviceName).filter(Boolean).join(' + ') || 'Appointment'

    return jsonOk(
      {
        booking: {
          id: createdBooking.id,
          scheduledFor: new Date(createdBooking.scheduledFor).toISOString(),
          endsAt: endsAt.toISOString(),
          totalDurationMinutes: Number(createdBooking.totalDurationMinutes),
          bufferMinutes: Number(createdBooking.bufferMinutes),
          status: createdBooking.status,
          serviceName,
          subtotalCents: computedSubtotalCents,
          locationId: location.id,
          locationType,
          stepMinutes,
          timeZone: appointmentTimeZone,
        },
      },
      200,
    )
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : ''

    if (message === 'PRICING_NOT_SET') {
      return jsonFail(409, 'Pricing is not set for one or more selected services.')
    }

    if (message === 'BAD_DURATION') {
      return jsonFail(409, 'Duration is not set for one or more selected services.')
    }

    if (message === 'MISSING_OFFERING') {
      return jsonFail(
        400,
        'One or more selected services are not available for this professional/location type.',
      )
    }

    console.error('POST /api/pro/bookings error', error)
    return jsonFail(500, 'Failed to create booking.')
  }
}