// app/api/pro/bookings/[id]/route.ts
import { prisma } from '@/lib/prisma'
import {
  jsonFail,
  jsonOk,
  pickBool,
  pickEnum,
  pickInt,
  pickIsoDate,
  pickString,
  requirePro,
} from '@/app/api/_utils'
import {
  BookingServiceItemType,
  BookingStatus,
  ClientNotificationType,
  Prisma,
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

const MAX_SLOT_DURATION_MINUTES = 12 * 60
const MAX_BOOKING_BUFFER_MINUTES = 180
const MAX_OTHER_OVERLAP_MINUTES = MAX_SLOT_DURATION_MINUTES + MAX_BOOKING_BUFFER_MINUTES
const DEFAULT_DURATION_MINUTES = 60

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

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.trunc(value)))
}

function snapToStep(value: number, stepMinutes: number): number {
  const step = clamp(stepMinutes || 15, 5, 60)
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

/**
 * Money helpers (cents-based)
 */
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

function centsToDecimal(cents: number): Prisma.Decimal {
  const safeCents = Math.max(0, Math.trunc(cents))
  const dollars = Math.trunc(safeCents / 100)
  const rem = safeCents % 100
  return new Prisma.Decimal(`${dollars}.${String(rem).padStart(2, '0')}`)
}

function durationOrFallback(duration: unknown, fallback = DEFAULT_DURATION_MINUTES): number {
  const parsed = Number(duration ?? 0)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

/* ---------------------------------------------
   Working-hours enforcement (LOCATION truth)
--------------------------------------------- */

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

/* ---------------------------------------------
   Client notification helper
--------------------------------------------- */

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

function parseServiceItemsInput(
  rawItems: unknown[] | null,
): RequestedServiceItemInput[] | null {
  if (rawItems == null) return null
  if (!rawItems.length) throw new Error('BAD_ITEMS')

  return rawItems.map((raw, index) => {
    if (!isRecord(raw)) throw new Error('BAD_ITEMS')

    const serviceId = pickString(raw.serviceId)
    const offeringId = pickString(raw.offeringId)
    const sortOrder = pickInt(raw.sortOrder)

    if (!serviceId || !offeringId) throw new Error('BAD_ITEMS')

    return {
      serviceId,
      offeringId,
      sortOrder: sortOrder != null ? sortOrder : index,
    }
  })
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

    const items = booking.serviceItems || []
    const computedDuration = items.reduce(
      (sum, item) => sum + Number(item.durationMinutesSnapshot ?? 0),
      0,
    )
    const computedSubtotalCents = items.reduce(
      (sum, item) => sum + moneyToCents(item.priceSnapshot),
      0,
    )

    const totalDurationMinutes =
      Number(booking.totalDurationMinutes ?? 0) > 0
        ? Number(booking.totalDurationMinutes)
        : computedDuration > 0
          ? computedDuration
          : DEFAULT_DURATION_MINUTES

    const bufferMinutes = Math.max(0, Number(booking.bufferMinutes ?? 0))
    const endsAt = addMinutes(start, totalDurationMinutes + bufferMinutes)

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
    const timeZone = tzResult.ok ? tzResult.timeZone : 'UTC'

    return jsonOk(
      {
        booking: {
          id: booking.id,
          status: booking.status,
          scheduledFor: start.toISOString(),
          endsAt: endsAt.toISOString(),
          locationType: booking.locationType,
          bufferMinutes,
          durationMinutes: totalDurationMinutes,
          totalDurationMinutes,
          subtotalSnapshot: moneyToFixed2String(
            booking.subtotalSnapshot ?? centsToDecimal(computedSubtotalCents),
          ),
          client: {
            fullName,
            email: booking.client?.user?.email ?? null,
            phone: booking.client?.phone ?? null,
          },
          timeZone: isValidIanaTimeZone(timeZone) ? timeZone : 'UTC',
          serviceItems: items.map((item) => ({
            id: item.id,
            serviceId: item.serviceId,
            offeringId: item.offeringId ?? null,
            itemType: item.itemType ?? BookingServiceItemType.ADD_ON,
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

    const body: unknown = await req.json().catch(() => ({}))
    const rec = isRecord(body) ? body : null

    const nextStatus = pickEnum(rec?.status, ['ACCEPTED', 'CANCELLED'] as const)
    const notifyClient = pickBool(rec?.notifyClient) ?? false
    const allowOutsideWorkingHours = pickBool(rec?.allowOutsideWorkingHours) ?? false

    const nextStart = pickIsoDate(rec?.scheduledFor)
    const bufferRaw = rec?.bufferMinutes
    const durationRaw = rec?.durationMinutes ?? rec?.totalDurationMinutes

    const rawItems = rec?.serviceItems
    const serviceItemsRaw: unknown[] | null = Array.isArray(rawItems) ? rawItems : null

    const wantsMutation =
      nextStatus != null ||
      nextStart != null ||
      bufferRaw != null ||
      durationRaw != null ||
      serviceItemsRaw != null

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
        throw new Error('NOT_FOUND')
      }

      if (existing.status === BookingStatus.CANCELLED) {
        if (nextStatus === 'CANCELLED') {
          const start = normalizeToMinute(new Date(existing.scheduledFor))
          const duration = durationOrFallback(existing.totalDurationMinutes)
          const buffer = Math.max(0, Number(existing.bufferMinutes ?? 0))

          return {
            id: existing.id,
            scheduledFor: start.toISOString(),
            endsAt: addMinutes(start, duration + buffer).toISOString(),
            bufferMinutes: buffer,
            durationMinutes: duration,
            totalDurationMinutes: duration,
            status: existing.status,
            subtotalSnapshot: '0.00',
            timeZone: 'UTC',
          }
        }

        throw new Error('CANNOT_EDIT_CANCELLED')
      }

      if (nextStatus === 'CANCELLED') {
        const updated = await tx.booking.update({
          where: { id: existing.id },
          data: { status: BookingStatus.CANCELLED },
          select: {
            id: true,
            status: true,
            scheduledFor: true,
            bufferMinutes: true,
            totalDurationMinutes: true,
          },
        })

        if (notifyClient) {
          await createClientNotification({
            tx,
            clientId: existing.clientId,
            bookingId: updated.id,
            type: ClientNotificationType.BOOKING_CANCELLED,
            title: 'Appointment cancelled',
            body: 'Your appointment was cancelled.',
            dedupeKey: `BOOKING_CANCELLED:${updated.id}:${new Date(updated.scheduledFor).toISOString()}`,
          })
        }

        const duration = durationOrFallback(updated.totalDurationMinutes)
        const buffer = Math.max(0, Number(updated.bufferMinutes ?? 0))

        return {
          id: updated.id,
          scheduledFor: new Date(updated.scheduledFor).toISOString(),
          endsAt: addMinutes(new Date(updated.scheduledFor), duration + buffer).toISOString(),
          bufferMinutes: buffer,
          durationMinutes: duration,
          totalDurationMinutes: duration,
          status: updated.status,
          subtotalSnapshot: '0.00',
          timeZone: 'UTC',
        }
      }

      if (!existing.locationId) {
        throw new Error('BAD_LOCATION')
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
        },
      })

      if (!location) {
        throw new Error('BAD_LOCATION')
      }

      if (
        existing.locationType === ServiceLocationType.MOBILE &&
        location.type !== ProfessionalLocationType.MOBILE_BASE
      ) {
        throw new Error('BAD_LOCATION_MODE')
      }

      if (
        existing.locationType === ServiceLocationType.SALON &&
        location.type === ProfessionalLocationType.MOBILE_BASE
      ) {
        throw new Error('BAD_LOCATION_MODE')
      }

      const stepMinutes = normalizeStepMinutes(location.stepMinutes, 15)
      const locationBufferMinutes = clamp(
        Number(location.bufferMinutes ?? 0),
        0,
        MAX_BOOKING_BUFFER_MINUTES,
      )

      const tzResult = await resolveApptTimeZone({
        bookingLocationTimeZone: existing.locationTimeZone,
        locationId: existing.locationId ?? null,
        professionalId: existing.professionalId,
        professionalTimeZone: existing.professional?.timeZone,
        fallback: 'UTC',
      })

      const appointmentTimeZone = tzResult.ok ? tzResult.timeZone : 'UTC'
      const timeZoneValid = isValidIanaTimeZone(appointmentTimeZone)

      const nextBuffer = bufferRaw != null ? pickInt(bufferRaw) : null
      if (nextBuffer != null && (nextBuffer < 0 || nextBuffer > MAX_BOOKING_BUFFER_MINUTES)) {
        throw new Error('BAD_BUFFER')
      }

      const nextDuration = durationRaw != null ? pickInt(durationRaw) : null
      if (nextDuration != null && (nextDuration < 15 || nextDuration > MAX_SLOT_DURATION_MINUTES)) {
        throw new Error('BAD_DURATION')
      }

      const finalStart = nextStart
        ? normalizeToMinute(nextStart)
        : normalizeToMinute(new Date(existing.scheduledFor))

      if (!Number.isFinite(finalStart.getTime())) {
        throw new Error('BAD_START')
      }

      if (timeZoneValid) {
        const startMinutes = minutesSinceMidnightInTimeZone(finalStart, appointmentTimeZone)
        if (startMinutes % stepMinutes !== 0) {
          throw new Error(`STEP:${stepMinutes}`)
        }
      } else if (finalStart.getUTCMinutes() % stepMinutes !== 0) {
        throw new Error(`STEP:${stepMinutes}`)
      }

      const finalBuffer =
        nextBuffer != null
          ? clamp(snapToStep(nextBuffer, stepMinutes), 0, MAX_BOOKING_BUFFER_MINUTES)
          : Math.max(0, Number(existing.bufferMinutes ?? 0))

      const parsedServiceItems = parseServiceItemsInput(serviceItemsRaw)

      let nextBookingServiceId: string | null = null
      let nextBookingOfferingId: string | null = null

      if (parsedServiceItems) {
      const offeringIds = Array.from(
        new Set(parsedServiceItems.map((item) => item.offeringId)),
      ).slice(0, 50)

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

      const offeringById = new Map(
        offerings.map((offering) => [offering.id, offering]),
      )

      const normalizedServiceItems: NormalizedServiceItemInput[] = parsedServiceItems.map((item, index) => {
        const offering = offeringById.get(item.offeringId)
        if (!offering) {
          throw new Error('BAD_ITEMS')
        }

        if (offering.serviceId !== item.serviceId) {
          throw new Error('BAD_ITEMS')
        }

        const isMobile = existing.locationType === ServiceLocationType.MOBILE
        const modeAllowed = isMobile ? offering.offersMobile : offering.offersInSalon

        const rawDuration = isMobile
          ? Number(offering.mobileDurationMinutes ?? offering.service.defaultDurationMinutes ?? 0)
          : Number(offering.salonDurationMinutes ?? offering.service.defaultDurationMinutes ?? 0)

        const rawPrice = isMobile
          ? offering.mobilePriceStartingAt
          : offering.salonPriceStartingAt

        if (!modeAllowed) {
          throw new Error('BAD_ITEMS')
        }

        if (!Number.isFinite(rawDuration) || rawDuration <= 0) {
          throw new Error('BAD_ITEMS')
        }

        if (rawPrice == null) {
          throw new Error('BAD_ITEMS')
        }

        return {
          serviceId: item.serviceId,
          offeringId: item.offeringId,
          durationMinutesSnapshot: clamp(
            snapToStep(rawDuration, stepMinutes),
            15,
            MAX_SLOT_DURATION_MINUTES,
          ),
          priceSnapshot: centsToDecimal(moneyToCents(rawPrice)),
          sortOrder: index,
        }
      })

      await tx.bookingServiceItem.deleteMany({
        where: { bookingId: existing.id },
      })

      const baseItem = normalizedServiceItems[0]
      if (!baseItem) {
        throw new Error('BAD_ITEMS')
      }

      for (const [index, item] of normalizedServiceItems.entries()) {
        await tx.bookingServiceItem.create({
          data: {
            bookingId: existing.id,
            serviceId: item.serviceId,
            offeringId: item.offeringId,
            itemType: index === 0 ? BookingServiceItemType.BASE : BookingServiceItemType.ADD_ON,
            parentItemId: null,
            priceSnapshot: item.priceSnapshot,
            durationMinutesSnapshot: item.durationMinutesSnapshot,
            sortOrder: item.sortOrder,
          },
        })
      }

      nextBookingServiceId = baseItem.serviceId
      nextBookingOfferingId = baseItem.offeringId
    }

      const itemsNow = await tx.bookingServiceItem.findMany({
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
      })

      if (!itemsNow.length) {
        throw new Error('BAD_ITEMS')
      }

      const primaryItem =
        itemsNow.find((item) => item.itemType === BookingServiceItemType.BASE) ?? itemsNow[0]

      if (!primaryItem) {
        throw new Error('BAD_ITEMS')
      }

      const computedSubtotalCents = itemsNow.reduce(
        (sum, item) => sum + moneyToCents(item.priceSnapshot),
        0,
      )
      const computedDuration = itemsNow.reduce(
        (sum, item) => sum + Number(item.durationMinutesSnapshot ?? 0),
        0,
      )
      // Duration contract:
      // - serviceItems update => computed service duration is authoritative
      // - explicit duration may be used only when serviceItems are not being edited
      // - conflicting explicit duration + serviceItems is rejected

      const existingDurationFallback = durationOrFallback(existing.totalDurationMinutes)

      const snappedNextDuration =
        nextDuration != null
          ? clamp(snapToStep(nextDuration, stepMinutes), 15, MAX_SLOT_DURATION_MINUTES)
          : null

      const hasServiceItemsUpdate = parsedServiceItems != null

      if (hasServiceItemsUpdate && computedDuration <= 0) {
        throw new Error('BAD_ITEMS')
      }

      if (
        hasServiceItemsUpdate &&
        snappedNextDuration != null &&
        snappedNextDuration !== computedDuration
      ) {
        throw new Error('DURATION_MISMATCH')
      }

      const finalDuration =
        hasServiceItemsUpdate
          ? computedDuration
          : snappedNextDuration != null
            ? snappedNextDuration
            : existingDurationFallback

      const finalEnd = addMinutes(finalStart, finalDuration + finalBuffer)

      if (!allowOutsideWorkingHours) {
        if (!timeZoneValid) {
          throw new Error('TIMEZONE_REQUIRED')
        }

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
          locationId: location.id,
          id: { not: existing.id },
          scheduledFor: { gte: earliestStart, lt: finalEnd },
          NOT: { status: BookingStatus.CANCELLED },
        },
        select: {
          scheduledFor: true,
          totalDurationMinutes: true,
          bufferMinutes: true,
        },
        take: 500,
      })

      const hasBookingConflict = otherBookings.some((booking) => {
        const bookingStart = normalizeToMinute(new Date(booking.scheduledFor))
        const bookingDuration = durationOrFallback(booking.totalDurationMinutes)
        const bookingBuffer = Math.max(0, Number(booking.bufferMinutes ?? 0))
        const bookingEnd = addMinutes(bookingStart, bookingDuration + bookingBuffer)
        return overlaps(bookingStart, bookingEnd, finalStart, finalEnd)
      })

      if (hasBookingConflict) {
        throw new Error('CONFLICT')
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
        throw new Error('BLOCKED')
      }

      const holds = await tx.bookingHold.findMany({
        where: {
          professionalId: existing.professionalId,
          locationId: location.id,
          expiresAt: { gt: new Date() },
          scheduledFor: { gte: earliestStart, lt: finalEnd },
        },
        select: {
          id: true,
          scheduledFor: true,
          offeringId: true,
          locationType: true,
        },
        take: 1000,
      })

      if (holds.length > 0) {
        const offeringIds = Array.from(new Set(holds.map((hold) => hold.offeringId))).slice(0, 2000)

        const heldOfferings = await tx.professionalServiceOffering.findMany({
          where: { id: { in: offeringIds } },
          select: {
            id: true,
            salonDurationMinutes: true,
            mobileDurationMinutes: true,
          },
          take: 2000,
        })

        const heldOfferingById = new Map(
          heldOfferings.map((offering) => [offering.id, offering]),
        )

        const hasHoldConflict = holds.some((hold) => {
          const heldOffering = heldOfferingById.get(hold.offeringId)
          const rawHeldDuration =
            hold.locationType === ServiceLocationType.MOBILE
              ? heldOffering?.mobileDurationMinutes
              : heldOffering?.salonDurationMinutes

          const heldDurationBase = Number(rawHeldDuration ?? 0)
          const heldDuration =
            Number.isFinite(heldDurationBase) && heldDurationBase > 0
              ? clamp(heldDurationBase, 15, MAX_SLOT_DURATION_MINUTES)
              : DEFAULT_DURATION_MINUTES

          const holdStart = normalizeToMinute(new Date(hold.scheduledFor))
          const holdEnd = addMinutes(holdStart, heldDuration + locationBufferMinutes)

          return overlaps(holdStart, holdEnd, finalStart, finalEnd)
        })

        if (hasHoldConflict) {
          throw new Error('HELD')
        }
      }

      const statusUpdate =
        nextStatus === 'ACCEPTED'
          ? { status: BookingStatus.ACCEPTED }
          : {}

      const finalServiceId = nextBookingServiceId ?? primaryItem.serviceId
      const finalOfferingId = nextBookingOfferingId ?? primaryItem.offeringId ?? null

      const updated = await tx.booking.update({
        where: { id: existing.id },
        data: {
          ...statusUpdate,
          scheduledFor: finalStart,
          bufferMinutes: finalBuffer,
          totalDurationMinutes: finalDuration,
          subtotalSnapshot: centsToDecimal(computedSubtotalCents),
          serviceId: finalServiceId,
          offeringId: finalOfferingId,
        },
        select: {
          id: true,
          scheduledFor: true,
          bufferMinutes: true,
          totalDurationMinutes: true,
          status: true,
        },
      })

      if (notifyClient) {
        const isConfirm = nextStatus === 'ACCEPTED'
        const title = isConfirm ? 'Appointment confirmed' : 'Appointment updated'
        const bodyText = isConfirm
          ? 'Your appointment has been confirmed.'
          : 'Your appointment details were updated.'
        const type = isConfirm
          ? ClientNotificationType.BOOKING_CONFIRMED
          : ClientNotificationType.BOOKING_RESCHEDULED

        await createClientNotification({
          tx,
          clientId: existing.clientId,
          bookingId: updated.id,
          type,
          title,
          body: bodyText,
          dedupeKey: `BOOKING_UPDATED:${updated.id}:${finalStart.toISOString()}:${finalDuration}:${finalBuffer}:${String(
            updated.status,
          )}`,
        })
      }

      return {
        id: updated.id,
        scheduledFor: new Date(updated.scheduledFor).toISOString(),
        endsAt: addMinutes(
          new Date(updated.scheduledFor),
          Number(updated.totalDurationMinutes) + Number(updated.bufferMinutes),
        ).toISOString(),
        bufferMinutes: Math.max(0, Number(updated.bufferMinutes)),
        durationMinutes: Number(updated.totalDurationMinutes),
        totalDurationMinutes: Number(updated.totalDurationMinutes),
        status: updated.status,
        subtotalSnapshot: moneyToFixed2String(centsToDecimal(computedSubtotalCents)),
        timeZone: timeZoneValid ? appointmentTimeZone : 'UTC',
      }
    })

    return jsonOk({ booking: result }, 200)
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : ''

    if (message === 'NOT_FOUND') return jsonFail(404, 'Booking not found.')
    if (message === 'CANNOT_EDIT_CANCELLED') {
      return jsonFail(409, 'Cancelled bookings cannot be edited.')
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
      return jsonFail(400, 'Please set your timezone before editing bookings.')
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