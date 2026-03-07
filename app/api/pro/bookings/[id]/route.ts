// app/api/pro/bookings/[id]/route.ts
import { prisma } from '@/lib/prisma'
import {
  jsonFail,
  jsonOk,
  pickBool,
  pickInt,
  pickIsoDate,
  pickString,
  requirePro,
} from '@/app/api/_utils'
import { Prisma } from '@prisma/client'
import type {
  BookingServiceItemType,
  BookingStatus,
  ClientNotificationType,
  ProfessionalLocationType,
  ServiceLocationType,
} from '@prisma/client'
import {
  getZonedParts,
  isValidIanaTimeZone,
  minutesSinceMidnightInTimeZone,
  sanitizeTimeZone,
} from '@/lib/timeZone'
import { resolveApptTimeZone } from '@/lib/booking/timeZoneTruth'
import { moneyToFixed2String } from '@/lib/money'
import { isRecord } from '@/lib/guards'
import { getWorkingWindowForDay } from '@/lib/scheduling/workingHours'

export const dynamic = 'force-dynamic'

type Ctx = { params: { id: string } | Promise<{ id: string }> }

const BOOKING_STATUS = {
  PENDING: 'PENDING',
  ACCEPTED: 'ACCEPTED',
  COMPLETED: 'COMPLETED',
  CANCELLED: 'CANCELLED',
  WAITLIST: 'WAITLIST',
} as const satisfies Record<'PENDING' | 'ACCEPTED' | 'COMPLETED' | 'CANCELLED' | 'WAITLIST', BookingStatus>

const BOOKING_ITEM_TYPE = {
  BASE: 'BASE',
  ADD_ON: 'ADD_ON',
} as const satisfies Record<'BASE' | 'ADD_ON', BookingServiceItemType>

const CLIENT_NOTIFICATION = {
  BOOKING_CANCELLED: 'BOOKING_CANCELLED',
  BOOKING_CONFIRMED: 'BOOKING_CONFIRMED',
  BOOKING_RESCHEDULED: 'BOOKING_RESCHEDULED',
} as const satisfies Record<'BOOKING_CANCELLED' | 'BOOKING_CONFIRMED' | 'BOOKING_RESCHEDULED', ClientNotificationType>

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
const MAX_BOOKING_BUFFER_MINUTES = 180
const MAX_OTHER_OVERLAP_MINUTES = MAX_SLOT_DURATION_MINUTES + MAX_BOOKING_BUFFER_MINUTES
const DEFAULT_DURATION_MINUTES = 60

type RequestedStatus = 'ACCEPTED' | 'CANCELLED'

type RequestedServiceItemInput = {
  serviceId: string
  offeringId: string
  sortOrder: number
}

type NormalizedServiceItemInput = {
  serviceId: string
  offeringId: string
  durationMinutesSnapshot: number
  priceSnapshot: Prisma.Decimal
  sortOrder: number
}

function throwCode(code: string): never {
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
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return min
  return Math.max(min, Math.min(max, Math.trunc(parsed)))
}

function snapToStep(value: number, stepMinutes: number): number {
  const step = clampInt(stepMinutes || 15, 5, 60)
  return Math.round(value / step) * step
}

function normalizeStepMinutes(value: unknown, fallback: number): number {
  const parsed = typeof value === 'number' ? value : Number(value)
  const raw = Number.isFinite(parsed) ? Math.trunc(parsed) : fallback

  const allowed = new Set([5, 10, 15, 20, 30, 60])
  if (allowed.has(raw)) return raw

  if (raw <= 5) return 5
  if (raw <= 10) return 10
  if (raw <= 15) return 15
  if (raw <= 20) return 20
  if (raw <= 30) return 30
  return 60
}

function durationOrFallback(duration: unknown, fallback = DEFAULT_DURATION_MINUTES): number {
  const parsed = Number(duration ?? 0)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

function sumDecimal(values: Prisma.Decimal[]): Prisma.Decimal {
  return values.reduce((acc, value) => acc.add(value), new Prisma.Decimal(0))
}

function normalizeRequestedStatus(value: unknown): RequestedStatus | null {
  const normalized = typeof value === 'string' ? value.trim().toUpperCase() : ''
  if (normalized === BOOKING_STATUS.ACCEPTED) return BOOKING_STATUS.ACCEPTED
  if (normalized === BOOKING_STATUS.CANCELLED) return BOOKING_STATUS.CANCELLED
  return null
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

function normalizeLocationType(value: unknown): ServiceLocationType | null {
  const normalized = typeof value === 'string' ? value.trim().toUpperCase() : ''
  if (normalized === SERVICE_LOCATION.SALON) return SERVICE_LOCATION.SALON
  if (normalized === SERVICE_LOCATION.MOBILE) return SERVICE_LOCATION.MOBILE
  return null
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
    return { ok: false, error: 'That time is outside your working hours.' }
  }

  const window = getWorkingWindowForDay(scheduledStartUtc, workingHours, tz)
  if (!window.ok) {
    if (window.reason === 'MISSING') {
      return { ok: false, error: 'Working hours are not set yet.' }
    }
    if (window.reason === 'DISABLED') {
      return { ok: false, error: 'That time is outside your working hours.' }
    }
    return { ok: false, error: 'Your working hours are misconfigured.' }
  }

  const startMinutes = minutesSinceMidnightInTimeZone(scheduledStartUtc, tz)
  const endMinutes = minutesSinceMidnightInTimeZone(scheduledEndUtc, tz)

  if (startMinutes < window.startMinutes || endMinutes > window.endMinutes) {
    return { ok: false, error: 'That time is outside your working hours.' }
  }

  return { ok: true }
}

async function createClientNotification(args: {
  tx: Prisma.TransactionClient
  clientId: string
  bookingId: string
  type: ClientNotificationType
  title: string
  body: string
  dedupeKey: string
}) {
  const { tx, clientId, bookingId, type, title, body, dedupeKey } = args

  await tx.clientNotification.create({
    data: {
      clientId,
      bookingId,
      type,
      title,
      body,
      dedupeKey,
    },
  })
}

function parseRequestedServiceItems(raw: unknown): RequestedServiceItemInput[] | null {
  if (raw === undefined) return null
  if (!Array.isArray(raw)) throwCode('BAD_ITEMS')
  if (raw.length === 0) throwCode('BAD_ITEMS')

  const parsed = raw.map((entry, index) => {
    if (!isRecord(entry)) throwCode('BAD_ITEMS')

    const serviceId = pickString(entry.serviceId)
    const offeringId = pickString(entry.offeringId)
    const sortOrder = pickInt(entry.sortOrder)

    if (!serviceId || !offeringId) throwCode('BAD_ITEMS')

    return {
      serviceId,
      offeringId,
      sortOrder: sortOrder != null ? sortOrder : index,
    }
  })

  return [...parsed].sort((a, b) => a.sortOrder - b.sortOrder)
}

function buildBookingOutput(args: {
  id: string
  scheduledFor: Date
  totalDurationMinutes: number
  bufferMinutes: number
  status: BookingStatus
  subtotalSnapshot: Prisma.Decimal
  timeZone: string
}) {
  const { id, scheduledFor, totalDurationMinutes, bufferMinutes, status, subtotalSnapshot, timeZone } = args

  return {
    id,
    scheduledFor: scheduledFor.toISOString(),
    endsAt: addMinutes(scheduledFor, totalDurationMinutes + bufferMinutes).toISOString(),
    bufferMinutes,
    durationMinutes: totalDurationMinutes,
    totalDurationMinutes,
    status,
    subtotalSnapshot: moneyToFixed2String(subtotalSnapshot),
    timeZone,
  }
}

function pickHoldDuration(args: {
  locationType: ServiceLocationType
  salonDurationMinutes: number | null
  mobileDurationMinutes: number | null
}): number {
  const raw =
    args.locationType === SERVICE_LOCATION.MOBILE
      ? args.mobileDurationMinutes
      : args.salonDurationMinutes

  const n = Number(raw ?? 0)
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_DURATION_MINUTES
  return clampInt(n, 15, MAX_SLOT_DURATION_MINUTES)
}

/* ---------------------------------------------
   GET
--------------------------------------------- */

export async function GET(_req: Request, ctx: Ctx) {
  try {
    const auth = await requirePro()
    if (!auth.ok) return auth.res

    const professionalId = auth.professionalId
    const params = await Promise.resolve(ctx.params)
    const bookingId = pickString(params?.id)

    if (!bookingId) {
      return jsonFail(400, 'Missing booking id.')
    }

    const booking = await prisma.booking.findFirst({
      where: { id: bookingId, professionalId },
      select: {
        id: true,
        status: true,
        scheduledFor: true,
        locationType: true,
        bufferMinutes: true,
        totalDurationMinutes: true,
        subtotalSnapshot: true,
        clientId: true,
        locationId: true,
        locationTimeZone: true,
        serviceItems: {
          orderBy: { sortOrder: 'asc' },
          select: {
            id: true,
            serviceId: true,
            offeringId: true,
            priceSnapshot: true,
            durationMinutesSnapshot: true,
            sortOrder: true,
            itemType: true,
            service: {
              select: {
                id: true,
                name: true,
              },
            },
          },
        },
        client: {
          select: {
            firstName: true,
            lastName: true,
            phone: true,
            user: { select: { email: true } },
          },
        },
        professional: {
          select: { timeZone: true },
        },
      },
    })

    if (!booking) {
      return jsonFail(404, 'Booking not found.')
    }

    const start = normalizeToMinute(new Date(booking.scheduledFor))
    if (!Number.isFinite(start.getTime())) {
      return jsonFail(500, 'Booking has an invalid scheduled time.')
    }

    const items = booking.serviceItems ?? []
    const computedDuration = items.reduce(
      (sum, item) => sum + Number(item.durationMinutesSnapshot ?? 0),
      0,
    )
    const computedSubtotal = sumDecimal(items.map((item) => item.priceSnapshot))

    const totalDurationMinutes =
      Number(booking.totalDurationMinutes ?? 0) > 0
        ? Number(booking.totalDurationMinutes)
        : computedDuration > 0
          ? computedDuration
          : DEFAULT_DURATION_MINUTES

    const bufferMinutes = Math.max(0, Number(booking.bufferMinutes ?? 0))

    const firstName = booking.client?.firstName?.trim() || ''
    const lastName = booking.client?.lastName?.trim() || ''
    const fullName =
      firstName || lastName
        ? `${firstName} ${lastName}`.trim()
        : booking.client?.user?.email || 'Client'

    const tzResult = await resolveApptTimeZone({
      bookingLocationTimeZone: booking.locationTimeZone,
      locationId: booking.locationId ?? null,
      professionalId,
      professionalTimeZone: booking.professional?.timeZone,
      fallback: 'UTC',
    })

    const timeZone =
      tzResult.ok && isValidIanaTimeZone(tzResult.timeZone) ? tzResult.timeZone : 'UTC'

    return jsonOk(
      {
        booking: {
          id: booking.id,
          status: booking.status,
          scheduledFor: start.toISOString(),
          endsAt: addMinutes(start, totalDurationMinutes + bufferMinutes).toISOString(),
          locationType: booking.locationType,
          bufferMinutes,
          durationMinutes: totalDurationMinutes,
          totalDurationMinutes,
          subtotalSnapshot: moneyToFixed2String(booking.subtotalSnapshot ?? computedSubtotal),
          client: {
            fullName,
            email: booking.client?.user?.email ?? null,
            phone: booking.client?.phone ?? null,
          },
          timeZone,
          serviceItems: items.map((item) => ({
            id: item.id,
            serviceId: item.serviceId,
            offeringId: item.offeringId ?? null,
            itemType: item.itemType ?? BOOKING_ITEM_TYPE.ADD_ON,
            serviceName: item.service?.name ?? 'Service',
            priceSnapshot: moneyToFixed2String(item.priceSnapshot),
            durationMinutesSnapshot: Number(item.durationMinutesSnapshot ?? 0),
            sortOrder: item.sortOrder,
          })),
        },
      },
      200,
    )
  } catch (error) {
    console.error('GET /api/pro/bookings/[id] error:', error)
    return jsonFail(500, 'Failed to load booking.')
  }
}

/* ---------------------------------------------
   PATCH
--------------------------------------------- */

export async function PATCH(req: Request, ctx: Ctx) {
  try {
    const auth = await requirePro()
    if (!auth.ok) return auth.res

    const professionalId = auth.professionalId
    const params = await Promise.resolve(ctx.params)
    const bookingId = pickString(params?.id)

    if (!bookingId) {
      return jsonFail(400, 'Missing booking id.')
    }

    const rawBody: unknown = await req.json().catch(() => ({}))
    const rec = isRecord(rawBody) ? rawBody : {}

    const hasStatus = Object.prototype.hasOwnProperty.call(rec, 'status')
    const hasNotifyClient = Object.prototype.hasOwnProperty.call(rec, 'notifyClient')
    const hasAllowOutside = Object.prototype.hasOwnProperty.call(rec, 'allowOutsideWorkingHours')
    const hasScheduledFor = Object.prototype.hasOwnProperty.call(rec, 'scheduledFor')
    const hasBuffer = Object.prototype.hasOwnProperty.call(rec, 'bufferMinutes')
    const hasDuration =
      Object.prototype.hasOwnProperty.call(rec, 'durationMinutes') ||
      Object.prototype.hasOwnProperty.call(rec, 'totalDurationMinutes')
    const hasServiceItems = Object.prototype.hasOwnProperty.call(rec, 'serviceItems')

    const nextStatus = normalizeRequestedStatus(rec.status)
    if (hasStatus && nextStatus == null) {
      return jsonFail(400, 'Invalid status. Use ACCEPTED or CANCELLED.')
    }

    const notifyClient = pickBool(rec.notifyClient)
    if (hasNotifyClient && notifyClient == null) {
      return jsonFail(400, 'notifyClient must be boolean.')
    }

    const allowOutsideWorkingHours = pickBool(rec.allowOutsideWorkingHours)
    if (hasAllowOutside && allowOutsideWorkingHours == null) {
      return jsonFail(400, 'allowOutsideWorkingHours must be boolean.')
    }

    const nextStart = pickIsoDate(rec.scheduledFor)
    if (hasScheduledFor && !nextStart) {
      return jsonFail(400, 'Invalid scheduledFor.')
    }

    const nextBuffer = rec.bufferMinutes != null ? pickInt(rec.bufferMinutes) : null
    if (hasBuffer && nextBuffer == null) {
      return jsonFail(400, 'Invalid bufferMinutes.')
    }

    const rawDurationValue = rec.durationMinutes ?? rec.totalDurationMinutes
    const nextDuration = rawDurationValue != null ? pickInt(rawDurationValue) : null
    if (hasDuration && nextDuration == null) {
      return jsonFail(400, 'Invalid durationMinutes.')
    }

    let parsedRequestedItems: RequestedServiceItemInput[] | null
    try {
      parsedRequestedItems = parseRequestedServiceItems(rec.serviceItems)
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : ''
      if (message === 'BAD_ITEMS') {
        return jsonFail(400, 'Invalid service items.')
      }
      throw error
    }

    const wantsMutation =
      nextStatus != null ||
      nextStart != null ||
      hasBuffer ||
      hasDuration ||
      hasServiceItems

    if (!wantsMutation) {
      return jsonOk({ booking: null, noOp: true }, 200)
    }

    const result = await prisma.$transaction(async (tx) => {
      const existing = await tx.booking.findFirst({
        where: { id: bookingId, professionalId },
        select: {
          id: true,
          status: true,
          scheduledFor: true,
          locationType: true,
          bufferMinutes: true,
          totalDurationMinutes: true,
          subtotalSnapshot: true,
          clientId: true,
          locationId: true,
          locationTimeZone: true,
          professionalId: true,
          professional: {
            select: { timeZone: true },
          },
        },
      })

      if (!existing) {
        throwCode('NOT_FOUND')
      }

      if (existing.status === BOOKING_STATUS.CANCELLED) {
        throwCode('CANNOT_EDIT_CANCELLED')
      }

      if (existing.status === BOOKING_STATUS.COMPLETED) {
        throwCode('CANNOT_EDIT_COMPLETED')
      }

      const tzResult = await resolveApptTimeZone({
        bookingLocationTimeZone: existing.locationTimeZone,
        locationId: existing.locationId ?? null,
        professionalId: existing.professionalId,
        professionalTimeZone: existing.professional?.timeZone,
        fallback: 'UTC',
      })

      const outputTimeZone =
        tzResult.ok && isValidIanaTimeZone(tzResult.timeZone) ? tzResult.timeZone : 'UTC'

      if (nextStatus === BOOKING_STATUS.CANCELLED) {
        const updated = await tx.booking.update({
          where: { id: existing.id },
          data: { status: BOOKING_STATUS.CANCELLED },
          select: {
            id: true,
            status: true,
            scheduledFor: true,
            bufferMinutes: true,
            totalDurationMinutes: true,
            subtotalSnapshot: true,
          },
        })

        if (notifyClient === true) {
          await createClientNotification({
            tx,
            clientId: existing.clientId,
            bookingId: updated.id,
            type: CLIENT_NOTIFICATION.BOOKING_CANCELLED,
            title: 'Appointment cancelled',
            body: 'Your appointment was cancelled.',
            dedupeKey: `BOOKING_CANCELLED:${updated.id}:${new Date(updated.scheduledFor).toISOString()}`,
          })
        }

        return buildBookingOutput({
          id: updated.id,
          scheduledFor: new Date(updated.scheduledFor),
          totalDurationMinutes: durationOrFallback(updated.totalDurationMinutes),
          bufferMinutes: Math.max(0, Number(updated.bufferMinutes ?? 0)),
          status: updated.status,
          subtotalSnapshot: updated.subtotalSnapshot ?? new Prisma.Decimal(0),
          timeZone: outputTimeZone,
        })
      }

      if (!existing.locationId) {
        throwCode('BAD_LOCATION')
      }

      const location = await tx.professionalLocation.findFirst({
        where: {
          id: existing.locationId,
          professionalId: existing.professionalId,
          isBookable: true,
        },
        select: {
          id: true,
          type: true,
          timeZone: true,
          workingHours: true,
          stepMinutes: true,
          bufferMinutes: true,
          lat: true,
          lng: true,
        },
      })

      if (!location) {
        throwCode('BAD_LOCATION')
      }

      if (
        existing.locationType === SERVICE_LOCATION.MOBILE &&
        location.type !== PROFESSIONAL_LOCATION.MOBILE_BASE
      ) {
        throwCode('BAD_LOCATION_MODE')
      }

      if (
        existing.locationType === SERVICE_LOCATION.SALON &&
        location.type === PROFESSIONAL_LOCATION.MOBILE_BASE
      ) {
        throwCode('BAD_LOCATION_MODE')
      }

      if (!tzResult.ok || !isValidIanaTimeZone(tzResult.timeZone)) {
        throwCode('TIMEZONE_REQUIRED')
      }

      const appointmentTimeZone = tzResult.timeZone
      const stepMinutes = normalizeStepMinutes(location.stepMinutes, 15)
      const locationBufferMinutes = clampInt(
        Number(location.bufferMinutes ?? 0),
        0,
        MAX_BOOKING_BUFFER_MINUTES,
      )

      if (nextBuffer != null && (nextBuffer < 0 || nextBuffer > MAX_BOOKING_BUFFER_MINUTES)) {
        throwCode('BAD_BUFFER')
      }

      if (nextDuration != null && (nextDuration < 15 || nextDuration > MAX_SLOT_DURATION_MINUTES)) {
        throwCode('BAD_DURATION')
      }

      const finalStart = nextStart
        ? normalizeToMinute(nextStart)
        : normalizeToMinute(new Date(existing.scheduledFor))

      if (!Number.isFinite(finalStart.getTime())) {
        throwCode('BAD_START')
      }

      const startMinutes = minutesSinceMidnightInTimeZone(finalStart, appointmentTimeZone)
      if (startMinutes % stepMinutes !== 0) {
        throw new Error(`STEP:${stepMinutes}`)
      }

      const finalBuffer =
        nextBuffer != null
          ? clampInt(snapToStep(nextBuffer, stepMinutes), 0, MAX_BOOKING_BUFFER_MINUTES)
          : Math.max(0, Number(existing.bufferMinutes ?? 0))

      let normalizedServiceItems: NormalizedServiceItemInput[] | null = null

      if (parsedRequestedItems) {
        const offeringIds = Array.from(new Set(parsedRequestedItems.map((item) => item.offeringId))).slice(0, 50)

        const offerings = await tx.professionalServiceOffering.findMany({
          where: {
            id: { in: offeringIds },
            professionalId: existing.professionalId,
            isActive: true,
          },
          select: {
            id: true,
            serviceId: true,
            offersInSalon: true,
            offersMobile: true,
            salonDurationMinutes: true,
            mobileDurationMinutes: true,
            salonPriceStartingAt: true,
            mobilePriceStartingAt: true,
            service: {
              select: {
                defaultDurationMinutes: true,
              },
            },
          },
          take: 100,
        })

        const offeringById = new Map(offerings.map((offering) => [offering.id, offering]))

        normalizedServiceItems = parsedRequestedItems.map((item, index) => {
          const offering = offeringById.get(item.offeringId)
          if (!offering) {
            throwCode('BAD_ITEMS')
          }

          if (offering.serviceId !== item.serviceId) {
            throwCode('BAD_ITEMS')
          }

          const isMobile = existing.locationType === SERVICE_LOCATION.MOBILE
          const modeAllowed = isMobile ? offering.offersMobile : offering.offersInSalon

          const rawDuration = isMobile
            ? Number(offering.mobileDurationMinutes ?? offering.service.defaultDurationMinutes ?? 0)
            : Number(offering.salonDurationMinutes ?? offering.service.defaultDurationMinutes ?? 0)

          const rawPrice = isMobile
            ? offering.mobilePriceStartingAt
            : offering.salonPriceStartingAt

          if (!modeAllowed) {
            throwCode('BAD_ITEMS')
          }

          if (!Number.isFinite(rawDuration) || rawDuration <= 0) {
            throwCode('BAD_ITEMS')
          }

          if (rawPrice == null) {
            throwCode('BAD_ITEMS')
          }

          return {
            serviceId: item.serviceId,
            offeringId: item.offeringId,
            durationMinutesSnapshot: clampInt(
              snapToStep(rawDuration, stepMinutes),
              15,
              MAX_SLOT_DURATION_MINUTES,
            ),
            priceSnapshot: rawPrice,
            sortOrder: index,
          }
        })
      }

      const previewItems =
        normalizedServiceItems?.map((item, index) => ({
          id: `virtual-${index}`,
          priceSnapshot: item.priceSnapshot,
          durationMinutesSnapshot: item.durationMinutesSnapshot,
          serviceId: item.serviceId,
          offeringId: item.offeringId,
          itemType: index === 0 ? BOOKING_ITEM_TYPE.BASE : BOOKING_ITEM_TYPE.ADD_ON,
        })) ??
        (await tx.bookingServiceItem.findMany({
          where: { bookingId: existing.id },
          orderBy: { sortOrder: 'asc' },
          select: {
            id: true,
            priceSnapshot: true,
            durationMinutesSnapshot: true,
            serviceId: true,
            offeringId: true,
            itemType: true,
          },
        }))

      if (!previewItems.length) {
        throwCode('BAD_ITEMS')
      }

      const primaryItem =
        previewItems.find((item) => item.itemType === BOOKING_ITEM_TYPE.BASE) ?? previewItems[0]

      if (!primaryItem) {
        throwCode('BAD_ITEMS')
      }

      const computedSubtotal = sumDecimal(previewItems.map((item) => item.priceSnapshot))
      const computedDuration = previewItems.reduce(
        (sum, item) => sum + Number(item.durationMinutesSnapshot ?? 0),
        0,
      )

      const snappedNextDuration =
        nextDuration != null
          ? clampInt(snapToStep(nextDuration, stepMinutes), 15, MAX_SLOT_DURATION_MINUTES)
          : null

      if (normalizedServiceItems && snappedNextDuration != null && snappedNextDuration !== computedDuration) {
        throwCode('DURATION_MISMATCH')
      }

      const finalDuration = normalizedServiceItems
        ? computedDuration
        : snappedNextDuration != null
          ? snappedNextDuration
          : durationOrFallback(existing.totalDurationMinutes)

      const finalEnd = addMinutes(finalStart, finalDuration + finalBuffer)

      if (allowOutsideWorkingHours !== true) {
        const workingHoursCheck = ensureWithinWorkingHours({
          scheduledStartUtc: finalStart,
          scheduledEndUtc: finalEnd,
          workingHours: location.workingHours,
          timeZone: appointmentTimeZone,
        })

        if (!workingHoursCheck.ok) {
          throw new Error(`WH:${workingHoursCheck.error}`)
        }
      }

      const earliestStart = addMinutes(finalStart, -MAX_OTHER_OVERLAP_MINUTES)

      const otherBookings = await tx.booking.findMany({
        where: {
          professionalId: existing.professionalId,
          id: { not: existing.id },
          scheduledFor: { gte: earliestStart, lt: finalEnd },
          status: { not: BOOKING_STATUS.CANCELLED },
        },
        select: {
          scheduledFor: true,
          totalDurationMinutes: true,
          bufferMinutes: true,
        },
        take: 2000,
      })

      const hasBookingConflict = otherBookings.some((booking) => {
        const bookingStart = normalizeToMinute(new Date(booking.scheduledFor))
        const bookingDuration = durationOrFallback(booking.totalDurationMinutes)
        const bookingBuffer = Math.max(0, Number(booking.bufferMinutes ?? 0))
        const bookingEnd = addMinutes(bookingStart, bookingDuration + bookingBuffer)
        return overlaps(bookingStart, bookingEnd, finalStart, finalEnd)
      })

      if (hasBookingConflict) {
        throwCode('CONFLICT')
      }

      const blockConflict = await tx.calendarBlock.findFirst({
        where: {
          professionalId: existing.professionalId,
          startsAt: { lt: finalEnd },
          endsAt: { gt: finalStart },
          OR: [{ locationId: location.id }, { locationId: null }],
        },
        select: { id: true },
      })

      if (blockConflict) {
        throwCode('BLOCKED')
      }

      const now = new Date()

      const holds = await tx.bookingHold.findMany({
        where: {
          professionalId: existing.professionalId,
          expiresAt: { gt: now },
          scheduledFor: { gte: earliestStart, lt: finalEnd },
        },
        select: {
          scheduledFor: true,
          offeringId: true,
          locationId: true,
          locationType: true,
        },
        take: 2000,
      })

      if (holds.length > 0) {
        const heldOfferingIds = Array.from(new Set(holds.map((hold) => hold.offeringId))).slice(0, 2000)

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

        const heldOfferingById = new Map(
          heldOfferings.map((offering) => [offering.id, offering]),
        )

        const heldLocationIds = Array.from(
          new Set(
            holds
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
            clampInt(Number(loc.bufferMinutes ?? 0), 0, MAX_BOOKING_BUFFER_MINUTES),
          ]),
        )

        const hasHoldConflict = holds.some((hold) => {
          const heldOffering = heldOfferingById.get(hold.offeringId)

          const heldDuration = pickHoldDuration({
            locationType: hold.locationType,
            salonDurationMinutes: heldOffering?.salonDurationMinutes ?? null,
            mobileDurationMinutes: heldOffering?.mobileDurationMinutes ?? null,
          })

          const holdStart = normalizeToMinute(new Date(hold.scheduledFor))
          const holdBuffer = heldBufferByLocationId.get(hold.locationId ?? '') ?? locationBufferMinutes
          const holdEnd = addMinutes(holdStart, heldDuration + holdBuffer)

          return overlaps(holdStart, holdEnd, finalStart, finalEnd)
        })

        if (hasHoldConflict) {
          throwCode('HELD')
        }
      }

      if (normalizedServiceItems) {
        await tx.bookingServiceItem.deleteMany({
          where: { bookingId: existing.id },
        })

        const baseItem = normalizedServiceItems[0]
        if (!baseItem) {
          throwCode('BAD_ITEMS')
        }

        const createdBaseItem = await tx.bookingServiceItem.create({
          data: {
            bookingId: existing.id,
            serviceId: baseItem.serviceId,
            offeringId: baseItem.offeringId,
            itemType: BOOKING_ITEM_TYPE.BASE,
            parentItemId: null,
            priceSnapshot: baseItem.priceSnapshot,
            durationMinutesSnapshot: baseItem.durationMinutesSnapshot,
            sortOrder: 0,
          },
          select: { id: true },
        })

        const addOnItems = normalizedServiceItems.slice(1)
        if (addOnItems.length) {
          await tx.bookingServiceItem.createMany({
            data: addOnItems.map((item, index) => ({
              bookingId: existing.id,
              serviceId: item.serviceId,
              offeringId: item.offeringId,
              itemType: BOOKING_ITEM_TYPE.ADD_ON,
              parentItemId: createdBaseItem.id,
              priceSnapshot: item.priceSnapshot,
              durationMinutesSnapshot: item.durationMinutesSnapshot,
              sortOrder: 100 + index,
              notes: 'MANUAL_ADDON',
            })),
          })
        }
      }

      const updated = await tx.booking.update({
        where: { id: existing.id },
        data: {
          ...(nextStatus === BOOKING_STATUS.ACCEPTED ? { status: BOOKING_STATUS.ACCEPTED } : {}),
          scheduledFor: finalStart,
          bufferMinutes: finalBuffer,
          totalDurationMinutes: finalDuration,
          subtotalSnapshot: computedSubtotal,
          serviceId: primaryItem.serviceId,
          offeringId: primaryItem.offeringId ?? null,
        },
        select: {
          id: true,
          scheduledFor: true,
          bufferMinutes: true,
          totalDurationMinutes: true,
          status: true,
          subtotalSnapshot: true,
        },
      })

      if (notifyClient === true) {
        const isConfirm = nextStatus === BOOKING_STATUS.ACCEPTED
        const title = isConfirm ? 'Appointment confirmed' : 'Appointment updated'
        const bodyText = isConfirm
          ? 'Your appointment has been confirmed.'
          : 'Your appointment details were updated.'
        const type = isConfirm
          ? CLIENT_NOTIFICATION.BOOKING_CONFIRMED
          : CLIENT_NOTIFICATION.BOOKING_RESCHEDULED

        await createClientNotification({
          tx,
          clientId: existing.clientId,
          bookingId: updated.id,
          type,
          title,
          body: bodyText,
          dedupeKey: `BOOKING_UPDATED:${updated.id}:${finalStart.toISOString()}:${finalDuration}:${finalBuffer}:${String(updated.status)}`,
        })
      }

      return buildBookingOutput({
        id: updated.id,
        scheduledFor: new Date(updated.scheduledFor),
        totalDurationMinutes: Number(updated.totalDurationMinutes),
        bufferMinutes: Math.max(0, Number(updated.bufferMinutes)),
        status: updated.status,
        subtotalSnapshot: updated.subtotalSnapshot ?? computedSubtotal,
        timeZone: appointmentTimeZone,
      })
    })

    return jsonOk({ booking: result }, 200)
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : ''

    if (message === 'NOT_FOUND') return jsonFail(404, 'Booking not found.')
    if (message === 'CANNOT_EDIT_CANCELLED') {
      return jsonFail(409, 'Cancelled bookings cannot be edited.')
    }
    if (message === 'CANNOT_EDIT_COMPLETED') {
      return jsonFail(409, 'Completed bookings cannot be edited.')
    }
    if (message === 'CONFLICT') return jsonFail(409, 'That time is not available.')
    if (message === 'BLOCKED') return jsonFail(409, 'That time is blocked on your calendar.')
    if (message === 'HELD') return jsonFail(409, 'That time is currently on hold.')
    if (message === 'BAD_ITEMS') return jsonFail(400, 'Invalid service items.')
    if (message === 'BAD_BUFFER') return jsonFail(400, 'Invalid bufferMinutes.')
    if (message === 'BAD_DURATION') return jsonFail(400, 'Invalid durationMinutes.')
    if (message.startsWith('WH:')) {
      return jsonFail(400, message.slice(3) || 'That time is outside working hours.')
    }
    if (message === 'TIMEZONE_REQUIRED') {
      return jsonFail(400, 'Please set a valid timezone before editing bookings.')
    }
    if (message === 'BAD_LOCATION') return jsonFail(400, 'Booking location is invalid.')
    if (message === 'BAD_LOCATION_MODE') {
      return jsonFail(400, 'Booking mode does not match location type.')
    }
    if (message.startsWith('STEP:')) {
      return jsonFail(400, `Start time must be on a ${message.slice(5)}-minute boundary.`)
    }
    if (message === 'DURATION_MISMATCH') {
      return jsonFail(400, 'Duration does not match selected services.')
    }
    if (message === 'BAD_START') return jsonFail(400, 'Invalid scheduledFor.')

    console.error('PATCH /api/pro/bookings/[id] error:', error)
    return jsonFail(500, 'Failed to update booking.')
  }
}