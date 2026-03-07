// app/api/pro/bookings/route.ts
import { prisma } from '@/lib/prisma'
import { Prisma } from '@prisma/client'
import type {
  BookingServiceItemType,
  BookingStatus,
  ProfessionalLocationType,
  ServiceLocationType,
} from '@prisma/client'
import { jsonFail, jsonOk, pickString, requirePro } from '@/app/api/_utils'
import { isRecord } from '@/lib/guards'
import { moneyToString } from '@/lib/money'
import {
  getZonedParts,
  isValidIanaTimeZone,
  minutesSinceMidnightInTimeZone,
  sanitizeTimeZone,
} from '@/lib/timeZone'
import { getWorkingWindowForDay } from '@/lib/scheduling/workingHours'

export const dynamic = 'force-dynamic'

const BOOKING_STATUS = {
  PENDING: 'PENDING',
  ACCEPTED: 'ACCEPTED',
  COMPLETED: 'COMPLETED',
  CANCELLED: 'CANCELLED',
  WAITLIST: 'WAITLIST',
} as const satisfies Record<'PENDING' | 'ACCEPTED' | 'COMPLETED' | 'CANCELLED' | 'WAITLIST', BookingStatus>

const BOOKING_SERVICE_ITEM_TYPE = {
  BASE: 'BASE',
  ADD_ON: 'ADD_ON',
} as const satisfies Record<'BASE' | 'ADD_ON', BookingServiceItemType>

const SERVICE_LOCATION = {
  SALON: 'SALON',
  MOBILE: 'MOBILE',
} as const satisfies Record<'SALON' | 'MOBILE', ServiceLocationType>

const PROFESSIONAL_LOCATION = {
  SALON: 'SALON',
  SUITE: 'SUITE',
  MOBILE_BASE: 'MOBILE_BASE',
} as const satisfies Record<'SALON' | 'SUITE' | 'MOBILE_BASE', ProfessionalLocationType>

const MAX_SLOT_DURATION_MINUTES = 12 * 60
const MAX_BUFFER_MINUTES = 180
const MAX_OTHER_OVERLAP_MINUTES = MAX_SLOT_DURATION_MINUTES + MAX_BUFFER_MINUTES
const DEFAULT_FALLBACK_DURATION_MINUTES = 60

type CreateBookingErrorCode =
  | 'BLOCKED'
  | 'CLIENT_NOT_FOUND'
  | 'LOCATION_MODE_MISMATCH'
  | 'LOCATION_NOT_FOUND'
  | 'MISSING_OFFERING'
  | 'MISSING_SERVICE'
  | 'PRICING_NOT_SET'
  | 'BAD_DURATION'
  | 'TIME_NOT_AVAILABLE'
  | 'TIME_ON_HOLD'

type BuiltItem = {
  serviceId: string
  offeringId: string
  serviceName: string
  durationMinutesSnapshot: number
  priceSnapshot: Prisma.Decimal
  sortOrder: number
}

function throwCode(code: CreateBookingErrorCode): never {
  throw new Error(code)
}

function normalizeToMinute(date: Date): Date {
  const normalized = new Date(date)
  normalized.setSeconds(0, 0)
  return normalized
}

function addMinutes(date: Date, minutes: number): Date {
  return new Date(date.getTime() + minutes * 60_000)
}

function overlaps(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date): boolean {
  return aStart < bEnd && aEnd > bStart
}

function clampInt(value: number, min: number, max: number): number {
  const truncated = Math.trunc(Number(value))
  if (!Number.isFinite(truncated)) return min
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

function normalizeLocationType(value: unknown): ServiceLocationType | null {
  const normalized = typeof value === 'string' ? value.trim().toUpperCase() : ''
  if (normalized === SERVICE_LOCATION.SALON) return SERVICE_LOCATION.SALON
  if (normalized === SERVICE_LOCATION.MOBILE) return SERVICE_LOCATION.MOBILE
  return null
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

function toDateOrNull(value: unknown): Date | null {
  const raw = pickString(value)
  if (!raw) return null

  const parsed = new Date(raw)
  return Number.isFinite(parsed.getTime()) ? parsed : null
}

function decimalToNumber(value: unknown): number | null {
  if (value == null) return null

  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null
  }

  if (typeof value === 'object' && value !== null) {
    const maybeToNumber = (value as { toNumber?: unknown }).toNumber
    if (typeof maybeToNumber === 'function') {
      const n = maybeToNumber.call(value) as number
      return Number.isFinite(n) ? n : null
    }

    const maybeToString = (value as { toString?: unknown }).toString
    if (typeof maybeToString === 'function') {
      const parsed = Number(String(maybeToString.call(value)))
      return Number.isFinite(parsed) ? parsed : null
    }
  }

  return null
}

function decimalToCents(value: Prisma.Decimal): number {
  const asMoneyString = value.toString()
  const cleaned = asMoneyString.replace(/\$/g, '').replace(/,/g, '').trim()
  const match = /^(\d+)(?:\.(\d{0,}))?$/.exec(cleaned)
  if (!match) return 0

  const whole = match[1] || '0'
  let frac = (match[2] || '').slice(0, 2)
  while (frac.length < 2) frac += '0'

  return Math.max(0, Number(whole) * 100 + Number(frac || '0'))
}

function sumDecimal(values: Prisma.Decimal[]): Prisma.Decimal {
  return values.reduce((acc, value) => acc.add(value), new Prisma.Decimal(0))
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

function pickModeDuration(args: {
  locationType: ServiceLocationType
  salonDurationMinutes: number | null
  mobileDurationMinutes: number | null
  defaultDurationMinutes: number
}) {
  const raw =
    args.locationType === SERVICE_LOCATION.MOBILE
      ? args.mobileDurationMinutes
      : args.salonDurationMinutes

  const picked = Number(raw ?? args.defaultDurationMinutes ?? 0)
  if (!Number.isFinite(picked) || picked <= 0) return null

  return picked
}

function pickModePrice(args: {
  locationType: ServiceLocationType
  salonPriceStartingAt: Prisma.Decimal | null
  mobilePriceStartingAt: Prisma.Decimal | null
}) {
  return args.locationType === SERVICE_LOCATION.MOBILE
    ? args.mobilePriceStartingAt
    : args.salonPriceStartingAt
}

function pickHoldDuration(args: {
  locationType: ServiceLocationType
  salonDurationMinutes: number | null
  mobileDurationMinutes: number | null
}) {
  const raw =
    args.locationType === SERVICE_LOCATION.MOBILE
      ? args.mobileDurationMinutes
      : args.salonDurationMinutes

  const n = Number(raw ?? 0)
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_FALLBACK_DURATION_MINUTES
  return clampInt(n, 15, MAX_SLOT_DURATION_MINUTES)
}

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

function buildItems(args: {
  serviceIds: string[]
  locationType: ServiceLocationType
  stepMinutes: number
  offeringByServiceId: Map<
    string,
    {
      id: string
      serviceId: string
      salonPriceStartingAt: Prisma.Decimal | null
      mobilePriceStartingAt: Prisma.Decimal | null
      salonDurationMinutes: number | null
      mobileDurationMinutes: number | null
    }
  >
  serviceById: Map<
    string,
    {
      id: string
      name: string
      defaultDurationMinutes: number
    }
  >
}): BuiltItem[] {
  const { serviceIds, locationType, stepMinutes, offeringByServiceId, serviceById } = args

  return serviceIds.map((serviceId, index) => {
    const offering = offeringByServiceId.get(serviceId)
    const service = serviceById.get(serviceId)

    if (!offering) throwCode('MISSING_OFFERING')
    if (!service) throwCode('MISSING_SERVICE')

    const rawDuration = pickModeDuration({
      locationType,
      salonDurationMinutes: offering.salonDurationMinutes,
      mobileDurationMinutes: offering.mobileDurationMinutes,
      defaultDurationMinutes: service.defaultDurationMinutes,
    })

    if (rawDuration == null) throwCode('BAD_DURATION')

    const durationMinutesSnapshot = clampInt(
      snapToStep(clampInt(rawDuration, stepMinutes, MAX_SLOT_DURATION_MINUTES), stepMinutes),
      stepMinutes,
      MAX_SLOT_DURATION_MINUTES,
    )

    const rawPrice = pickModePrice({
      locationType,
      salonPriceStartingAt: offering.salonPriceStartingAt,
      mobilePriceStartingAt: offering.mobilePriceStartingAt,
    })

    if (rawPrice == null) throwCode('PRICING_NOT_SET')

    return {
      serviceId,
      offeringId: offering.id,
      serviceName: service.name ?? 'Service',
      durationMinutesSnapshot,
      priceSnapshot: rawPrice,
      sortOrder: index,
    }
  })
}

export async function POST(req: Request) {
  try {
    const auth = await requirePro()
    if (!auth.ok) return auth.res

    const professionalId = auth.professionalId
    const rawBody: unknown = await req.json().catch(() => ({}))
    const body = isRecord(rawBody) ? rawBody : {}

    const clientId = pickString(body.clientId)
    const scheduledFor = toDateOrNull(body.scheduledFor)
    const internalNotes = pickString(body.internalNotes)

    const locationId = pickString(body.locationId)
    const locationType = normalizeLocationType(body.locationType)
    const serviceIds = Array.from(new Set(toStringArray(body.serviceIds))).slice(0, 10)

    const requestedBufferMinutes = pickInt(body.bufferMinutes)
    const requestedTotalDurationMinutes = pickInt(body.totalDurationMinutes)
    const allowOutsideWorkingHours = pickBool(body.allowOutsideWorkingHours) ?? false

    if (!clientId) return jsonFail(400, 'Missing clientId.')
    if (!scheduledFor) return jsonFail(400, 'Missing or invalid scheduledFor.')
    if (!locationId) return jsonFail(400, 'Missing locationId.')
    if (!locationType) return jsonFail(400, 'Missing or invalid locationType.')
    if (!serviceIds.length) return jsonFail(400, 'Select at least one service.')

    const scheduledStart = normalizeToMinute(scheduledFor)

    const [client, location] = await Promise.all([
      prisma.clientProfile.findUnique({
        where: { id: clientId },
        select: { id: true },
      }),
      prisma.professionalLocation.findFirst({
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
      }),
    ])

    if (!client) return jsonFail(404, 'Client not found.')
    if (!location) return jsonFail(404, 'Location not found or not bookable.')

    if (
      locationType === SERVICE_LOCATION.MOBILE &&
      location.type !== PROFESSIONAL_LOCATION.MOBILE_BASE
    ) {
      return jsonFail(400, 'This location is not a mobile base.')
    }

    if (
      locationType === SERVICE_LOCATION.SALON &&
      location.type === PROFESSIONAL_LOCATION.MOBILE_BASE
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
    const bufferMinutes =
      requestedBufferMinutes == null
        ? locationBufferMinutes
        : clampInt(
            snapToStep(clampInt(requestedBufferMinutes, 0, MAX_BUFFER_MINUTES), stepMinutes),
            0,
            MAX_BUFFER_MINUTES,
          )

    const [offerings, services] = await Promise.all([
      prisma.professionalServiceOffering.findMany({
        where: {
          professionalId,
          isActive: true,
          serviceId: { in: serviceIds },
          ...(locationType === SERVICE_LOCATION.MOBILE
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
      }),
      prisma.service.findMany({
        where: { id: { in: serviceIds } },
        select: {
          id: true,
          name: true,
          defaultDurationMinutes: true,
        },
        take: 50,
      }),
    ])

    const offeringByServiceId = new Map(offerings.map((offering) => [offering.serviceId, offering]))
    const serviceById = new Map(services.map((service) => [service.id, service]))

    for (const serviceId of serviceIds) {
      if (!offeringByServiceId.has(serviceId)) {
        return jsonFail(
          400,
          'One or more selected services are not available for this professional/location type.',
        )
      }
      if (!serviceById.has(serviceId)) {
        return jsonFail(400, 'One or more selected services could not be found.')
      }
    }

    let items: BuiltItem[]
    try {
      items = buildItems({
        serviceIds,
        locationType,
        stepMinutes,
        offeringByServiceId,
        serviceById,
      })
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

      if (message === 'MISSING_SERVICE') {
        return jsonFail(400, 'One or more selected services could not be found.')
      }

      throw error
    }

    const computedDurationMinutes = items.reduce(
      (sum, item) => sum + item.durationMinutesSnapshot,
      0,
    )

    const subtotalSnapshot = sumDecimal(items.map((item) => item.priceSnapshot))

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

    const locationAddressSnapshot = buildLocationAddressSnapshot(location.formattedAddress)
    const locationLatSnapshot = decimalToNumber(location.lat) ?? undefined
    const locationLngSnapshot = decimalToNumber(location.lng) ?? undefined

    const baseItem = items[0]
    if (!baseItem) {
      return jsonFail(400, 'Select at least one service.')
    }

    const createdBooking = await prisma.$transaction(async (tx) => {
      const blockConflict = await tx.calendarBlock.findFirst({
        where: {
          professionalId,
          startsAt: { lt: scheduledEnd },
          endsAt: { gt: scheduledStart },
          OR: [{ locationId: location.id }, { locationId: null }],
        },
        select: { id: true },
      })

      if (blockConflict) throwCode('BLOCKED')

      const earliestStart = addMinutes(scheduledStart, -MAX_OTHER_OVERLAP_MINUTES)

      const existingBookings = await tx.booking.findMany({
        where: {
          professionalId,
          scheduledFor: { gte: earliestStart, lt: scheduledEnd },
          status: { not: BOOKING_STATUS.CANCELLED },
        },
        select: {
          scheduledFor: true,
          totalDurationMinutes: true,
          bufferMinutes: true,
        },
        take: 2000,
      })

      const hasBookingConflict = existingBookings.some((booking) => {
        const bookingStart = normalizeToMinute(new Date(booking.scheduledFor))
        const bookingDuration =
          Number(booking.totalDurationMinutes ?? 0) > 0
            ? clampInt(Number(booking.totalDurationMinutes), 15, MAX_SLOT_DURATION_MINUTES)
            : DEFAULT_FALLBACK_DURATION_MINUTES

        const bookingBuffer = clampInt(Number(booking.bufferMinutes ?? 0) || 0, 0, MAX_BUFFER_MINUTES)
        const bookingEnd = addMinutes(bookingStart, bookingDuration + bookingBuffer)

        return overlaps(bookingStart, bookingEnd, scheduledStart, scheduledEnd)
      })

      if (hasBookingConflict) throwCode('TIME_NOT_AVAILABLE')

      const now = new Date()

      const activeHolds = await tx.bookingHold.findMany({
        where: {
          professionalId,
          expiresAt: { gt: now },
          scheduledFor: { gte: earliestStart, lt: scheduledEnd },
        },
        select: {
          scheduledFor: true,
          offeringId: true,
          locationId: true,
          locationType: true,
        },
        take: 2000,
      })

      if (activeHolds.length > 0) {
        const heldOfferingIds = Array.from(new Set(activeHolds.map((hold) => hold.offeringId))).slice(0, 2000)

        const heldOfferings = heldOfferingIds.length
          ? await tx.professionalServiceOffering.findMany({
              where: { id: { in: heldOfferingIds } },
              select: {
                id: true,
                salonDurationMinutes: true,
                mobileDurationMinutes: true,
              },
              take: 2000,
            })
          : []

        const heldOfferingById = new Map(heldOfferings.map((offering) => [offering.id, offering]))

        const heldLocationIds = Array.from(
          new Set(
            activeHolds
              .map((hold) => hold.locationId)
              .filter((value): value is string => typeof value === 'string' && value.length > 0),
          ),
        )

        const heldLocations = heldLocationIds.length
          ? await tx.professionalLocation.findMany({
              where: { id: { in: heldLocationIds } },
              select: {
                id: true,
                bufferMinutes: true,
              },
              take: 2000,
            })
          : []

        const heldBufferByLocationId = new Map(
          heldLocations.map((loc) => [
            loc.id,
            clampInt(Number(loc.bufferMinutes ?? 0) || 0, 0, MAX_BUFFER_MINUTES),
          ]),
        )

        const hasHoldConflict = activeHolds.some((hold) => {
          const heldOffering = heldOfferingById.get(hold.offeringId)

          const heldDuration = pickHoldDuration({
            locationType: hold.locationType,
            salonDurationMinutes: heldOffering?.salonDurationMinutes ?? null,
            mobileDurationMinutes: heldOffering?.mobileDurationMinutes ?? null,
          })

          const holdStart = normalizeToMinute(new Date(hold.scheduledFor))
          const holdBuffer = heldBufferByLocationId.get(hold.locationId ?? '') ?? locationBufferMinutes
          const holdEnd = addMinutes(holdStart, heldDuration + holdBuffer)

          return overlaps(holdStart, holdEnd, scheduledStart, scheduledEnd)
        })

        if (hasHoldConflict) throwCode('TIME_ON_HOLD')
      }

      let booking
      try {
        booking = await tx.booking.create({
          data: {
            professionalId,
            clientId,
            serviceId: baseItem.serviceId,
            offeringId: baseItem.offeringId,
            scheduledFor: scheduledStart,
            status: BOOKING_STATUS.ACCEPTED,
            locationType,
            locationId: location.id,
            locationTimeZone: appointmentTimeZone,
            locationAddressSnapshot,
            locationLatSnapshot,
            locationLngSnapshot,
            internalNotes: internalNotes ?? null,
            bufferMinutes,
            totalDurationMinutes,
            subtotalSnapshot,
          },
          select: {
            id: true,
            scheduledFor: true,
            totalDurationMinutes: true,
            bufferMinutes: true,
            status: true,
          },
        })
      } catch (error: unknown) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
          throwCode('TIME_NOT_AVAILABLE')
        }
        throw error
      }

      const createdBaseItem = await tx.bookingServiceItem.create({
        data: {
          bookingId: booking.id,
          serviceId: baseItem.serviceId,
          offeringId: baseItem.offeringId,
          itemType: BOOKING_SERVICE_ITEM_TYPE.BASE,
          priceSnapshot: baseItem.priceSnapshot,
          durationMinutesSnapshot: baseItem.durationMinutesSnapshot,
          sortOrder: 0,
        },
        select: { id: true },
      })

      const addOnItems = items.slice(1)

      if (addOnItems.length) {
        await tx.bookingServiceItem.createMany({
          data: addOnItems.map((item, index) => ({
            bookingId: booking.id,
            serviceId: item.serviceId,
            offeringId: item.offeringId,
            itemType: BOOKING_SERVICE_ITEM_TYPE.ADD_ON,
            parentItemId: createdBaseItem.id,
            priceSnapshot: item.priceSnapshot,
            durationMinutesSnapshot: item.durationMinutesSnapshot,
            sortOrder: 100 + index,
            notes: 'MANUAL_ADDON',
          })),
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
          subtotalSnapshot: moneyToString(subtotalSnapshot) ?? subtotalSnapshot.toString(),
          subtotalCents: decimalToCents(subtotalSnapshot),
          locationId: location.id,
          locationType,
          stepMinutes,
          timeZone: appointmentTimeZone,
        },
      },
      201,
    )
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : ''

    if (message === 'TIME_NOT_AVAILABLE') {
      return jsonFail(409, 'That time is not available.')
    }

    if (message === 'TIME_ON_HOLD') {
      return jsonFail(409, 'That time is currently on hold.')
    }

    if (message === 'BLOCKED') {
      return jsonFail(409, 'That time is blocked on your calendar.')
    }

    console.error('POST /api/pro/bookings error', error)
    return jsonFail(500, 'Failed to create booking.')
  }
}