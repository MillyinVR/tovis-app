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
import {
  Prisma,
  BookingServiceItemType,
  BookingStatus,
  ClientNotificationType,
  ProfessionalLocationType,
  ServiceLocationType,
} from '@prisma/client'
import {
  isValidIanaTimeZone,
  minutesSinceMidnightInTimeZone,
  sanitizeTimeZone,
} from '@/lib/timeZone'
import {
  resolveAppointmentSchedulingContext,
  type AppointmentSchedulingContext,
  type TimeZoneTruthSource,
} from '@/lib/booking/timeZoneTruth'
import { moneyToFixed2String } from '@/lib/money'
import { isRecord } from '@/lib/guards'
import { clampInt } from '@/lib/pick'
import {
  DEFAULT_DURATION_MINUTES,
  MAX_BUFFER_MINUTES,
  MAX_SLOT_DURATION_MINUTES,
} from '@/lib/booking/constants'
import {
  addMinutes,
  durationOrFallback,
  normalizeToMinute,
} from '@/lib/booking/conflicts'
import { getTimeRangeConflict } from '@/lib/booking/conflictQueries'
import { logBookingConflict } from '@/lib/booking/conflictLogging'
import { normalizeStepMinutes } from '@/lib/booking/locationContext'
import {
  type RequestedServiceItemInput,
  buildNormalizedBookingItemsFromRequestedOfferings,
  computeBookingItemLikeTotals,
  snapToStepMinutes,
  sumDecimal,
} from '@/lib/booking/serviceItems'
import {
  decimalToNullableNumber,
  pickFormattedAddressFromSnapshot,
} from '@/lib/booking/snapshots'
import { ensureWithinWorkingHours } from '@/lib/booking/workingHoursGuard'
import { withLockedProfessionalTransaction } from '@/lib/booking/scheduleTransaction'

export const dynamic = 'force-dynamic'

type Ctx = { params: { id: string } | Promise<{ id: string }> }

type RequestedStatus =
  | typeof BookingStatus.ACCEPTED
  | typeof BookingStatus.CANCELLED

function throwCode(code: string): never {
  throw new Error(code)
}

function normalizeRequestedStatus(value: unknown): RequestedStatus | null {
  const normalized = typeof value === 'string' ? value.trim().toUpperCase() : ''

  if (normalized === BookingStatus.ACCEPTED) return BookingStatus.ACCEPTED
  if (normalized === BookingStatus.CANCELLED) return BookingStatus.CANCELLED

  return null
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

function parseRequestedServiceItems(
  raw: unknown,
): RequestedServiceItemInput[] | null {
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

function normalizeOutputTimeZone(value: string): string {
  return isValidIanaTimeZone(value) ? sanitizeTimeZone(value, 'UTC') : 'UTC'
}

function buildBookingOutput(args: {
  id: string
  scheduledFor: Date
  totalDurationMinutes: number
  bufferMinutes: number
  status: BookingStatus
  subtotalSnapshot: Prisma.Decimal
  appointmentTimeZone: string
  timeZoneSource: TimeZoneTruthSource
  locationId?: string | null
  locationType?: ServiceLocationType
  locationAddressSnapshot?: string | null
  locationLatSnapshot?: number | null
  locationLngSnapshot?: number | null
}) {
  const {
    id,
    scheduledFor,
    totalDurationMinutes,
    bufferMinutes,
    status,
    subtotalSnapshot,
    appointmentTimeZone,
    timeZoneSource,
    locationId,
    locationType,
    locationAddressSnapshot,
    locationLatSnapshot,
    locationLngSnapshot,
  } = args

  return {
    id,
    scheduledFor: scheduledFor.toISOString(),
    endsAt: addMinutes(
      scheduledFor,
      totalDurationMinutes + bufferMinutes,
    ).toISOString(),
    bufferMinutes,
    durationMinutes: totalDurationMinutes,
    totalDurationMinutes,
    status,
    subtotalSnapshot: moneyToFixed2String(subtotalSnapshot),
    timeZone: appointmentTimeZone,
    timeZoneSource,
    locationId: locationId ?? null,
    locationType: locationType ?? null,
    locationAddressSnapshot: locationAddressSnapshot ?? null,
    locationLatSnapshot: locationLatSnapshot ?? null,
    locationLngSnapshot: locationLngSnapshot ?? null,
  }
}

function logAndThrowTimeRangeConflict(args: {
  conflict: 'BLOCKED' | 'BOOKING' | 'HOLD'
  professionalId: string
  locationId: string
  locationType: ServiceLocationType
  requestedStart: Date
  requestedEnd: Date
  bookingId: string
  appointmentTimeZone: string
  timeZoneSource: TimeZoneTruthSource
}): never {
  logBookingConflict({
    action: 'BOOKING_UPDATE',
    professionalId: args.professionalId,
    locationId: args.locationId,
    locationType: args.locationType,
    requestedStart: args.requestedStart,
    requestedEnd: args.requestedEnd,
    conflictType: args.conflict,
    bookingId: args.bookingId,
    meta: {
      route: 'app/api/pro/bookings/[id]/route.ts',
      timeZone: args.appointmentTimeZone,
      timeZoneSource: args.timeZoneSource,
    },
  })

if (args.conflict === 'BLOCKED') {
  throwCode('BLOCKED')
}

throwCode('TIME_NOT_AVAILABLE')
}

async function resolveBookingSchedulingContext(args: {
  bookingLocationTimeZone?: unknown
  locationId?: string | null
  professionalId: string
  professionalTimeZone?: unknown
  fallback?: string
  requireValid?: boolean
}): Promise<AppointmentSchedulingContext> {
  const result = await resolveAppointmentSchedulingContext({
    bookingLocationTimeZone: args.bookingLocationTimeZone,
    locationId: args.locationId ?? null,
    professionalId: args.professionalId,
    professionalTimeZone: args.professionalTimeZone,
    fallback: args.fallback ?? 'UTC',
    requireValid: args.requireValid,
  })

  if (!result.ok) {
    throwCode(args.requireValid ? 'TIMEZONE_REQUIRED' : 'TIMEZONE_FALLBACK')
  }

  return {
    ...result.context,
    appointmentTimeZone: normalizeOutputTimeZone(
      result.context.appointmentTimeZone,
    ),
  }
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
        locationAddressSnapshot: true,
        locationLatSnapshot: true,
        locationLngSnapshot: true,
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

    const schedulingContext = await resolveBookingSchedulingContext({
      bookingLocationTimeZone: booking.locationTimeZone,
      locationId: booking.locationId ?? null,
      professionalId,
      professionalTimeZone: booking.professional?.timeZone,
      fallback: 'UTC',
      requireValid: false,
    })

    return jsonOk(
      {
        booking: {
          id: booking.id,
          status: booking.status,
          scheduledFor: start.toISOString(),
          endsAt: addMinutes(
            start,
            totalDurationMinutes + bufferMinutes,
          ).toISOString(),
          locationId: booking.locationId ?? null,
          locationType: booking.locationType,
          locationAddressSnapshot: pickFormattedAddressFromSnapshot(
            booking.locationAddressSnapshot,
          ),
          locationLatSnapshot: decimalToNullableNumber(
            booking.locationLatSnapshot,
          ),
          locationLngSnapshot: decimalToNullableNumber(
            booking.locationLngSnapshot,
          ),
          bufferMinutes,
          durationMinutes: totalDurationMinutes,
          totalDurationMinutes,
          subtotalSnapshot: moneyToFixed2String(
            booking.subtotalSnapshot ?? computedSubtotal,
          ),
          client: {
            fullName,
            email: booking.client?.user?.email ?? null,
            phone: booking.client?.phone ?? null,
          },
          timeZone: schedulingContext.appointmentTimeZone,
          timeZoneSource: schedulingContext.timeZoneSource,
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

    const rawBody: unknown = await req.json().catch(() => ({}))
    const rec = isRecord(rawBody) ? rawBody : {}

    const hasStatus = Object.prototype.hasOwnProperty.call(rec, 'status')
    const hasNotifyClient = Object.prototype.hasOwnProperty.call(
      rec,
      'notifyClient',
    )
    const hasAllowOutside = Object.prototype.hasOwnProperty.call(
      rec,
      'allowOutsideWorkingHours',
    )
    const hasScheduledFor = Object.prototype.hasOwnProperty.call(
      rec,
      'scheduledFor',
    )
    const hasBuffer = Object.prototype.hasOwnProperty.call(rec, 'bufferMinutes')
    const hasDuration =
      Object.prototype.hasOwnProperty.call(rec, 'durationMinutes') ||
      Object.prototype.hasOwnProperty.call(rec, 'totalDurationMinutes')
    const hasServiceItems = Object.prototype.hasOwnProperty.call(
      rec,
      'serviceItems',
    )

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

    const nextBuffer =
      rec.bufferMinutes != null ? pickInt(rec.bufferMinutes) : null
    if (hasBuffer && nextBuffer == null) {
      return jsonFail(400, 'Invalid bufferMinutes.')
    }

    const rawDurationValue = rec.durationMinutes ?? rec.totalDurationMinutes
    const nextDuration =
      rawDurationValue != null ? pickInt(rawDurationValue) : null
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

    const result = await withLockedProfessionalTransaction(
      professionalId,
      async ({ tx }) => {
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
          locationAddressSnapshot: true,
          locationLatSnapshot: true,
          locationLngSnapshot: true,
          professionalId: true,
          professional: {
            select: { timeZone: true },
          },
        },
      })

      if (!existing) {
        throwCode('NOT_FOUND')
      }

      if (existing.status === BookingStatus.CANCELLED) {
        throwCode('CANNOT_EDIT_CANCELLED')
      }

      if (existing.status === BookingStatus.COMPLETED) {
        throwCode('CANNOT_EDIT_COMPLETED')
      }

      const outputSchedulingContext = await resolveBookingSchedulingContext({
        bookingLocationTimeZone: existing.locationTimeZone,
        locationId: existing.locationId ?? null,
        professionalId: existing.professionalId,
        professionalTimeZone: existing.professional?.timeZone,
        fallback: 'UTC',
        requireValid: false,
      })

      const existingLocationAddressSnapshot = pickFormattedAddressFromSnapshot(
        existing.locationAddressSnapshot,
      )
      const existingLocationLatSnapshot = decimalToNullableNumber(
        existing.locationLatSnapshot,
      )
      const existingLocationLngSnapshot = decimalToNullableNumber(
        existing.locationLngSnapshot,
      )

      if (nextStatus === BookingStatus.CANCELLED) {
        const updated = await tx.booking.update({
          where: { id: existing.id },
          data: { status: BookingStatus.CANCELLED },
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
            type: ClientNotificationType.BOOKING_CANCELLED,
            title: 'Appointment cancelled',
            body: 'Your appointment was cancelled.',
            dedupeKey: `BOOKING_CANCELLED:${updated.id}:${new Date(
              updated.scheduledFor,
            ).toISOString()}`,
          })
        }

        return buildBookingOutput({
          id: updated.id,
          scheduledFor: new Date(updated.scheduledFor),
          totalDurationMinutes: durationOrFallback(updated.totalDurationMinutes),
          bufferMinutes: Math.max(0, Number(updated.bufferMinutes ?? 0)),
          status: updated.status,
          subtotalSnapshot: updated.subtotalSnapshot ?? new Prisma.Decimal(0),
          appointmentTimeZone: outputSchedulingContext.appointmentTimeZone,
          timeZoneSource: outputSchedulingContext.timeZoneSource,
          locationId: existing.locationId ?? null,
          locationType: existing.locationType,
          locationAddressSnapshot: existingLocationAddressSnapshot,
          locationLatSnapshot: existingLocationLatSnapshot,
          locationLngSnapshot: existingLocationLngSnapshot,
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
        },
      })

      if (!location) {
        throwCode('BAD_LOCATION')
      }

      if (
        existing.locationType === ServiceLocationType.MOBILE &&
        location.type !== ProfessionalLocationType.MOBILE_BASE
      ) {
        throwCode('BAD_LOCATION_MODE')
      }

      if (
        existing.locationType === ServiceLocationType.SALON &&
        location.type === ProfessionalLocationType.MOBILE_BASE
      ) {
        throwCode('BAD_LOCATION_MODE')
      }

      const schedulingContextResult = await resolveAppointmentSchedulingContext({
        bookingLocationTimeZone: existing.locationTimeZone,
        location: { id: location.id, timeZone: location.timeZone },
        professionalId: existing.professionalId,
        professionalTimeZone: existing.professional?.timeZone,
        fallback: 'UTC',
        requireValid: true,
      })

      if (!schedulingContextResult.ok) {
        console.error(
          'PATCH /api/pro/bookings/[id] invalid appointment timezone',
          {
            route: 'app/api/pro/bookings/[id]/route.ts',
            bookingId: existing.id,
            professionalId: existing.professionalId,
            bookingLocationTimeZone: existing.locationTimeZone,
            locationId: location.id,
            locationTimeZone: location.timeZone,
            professionalTimeZone: existing.professional?.timeZone ?? null,
            resolveResult: schedulingContextResult,
          },
        )
        throwCode('TIMEZONE_REQUIRED')
      }

      const schedulingContext = {
        ...schedulingContextResult.context,
        appointmentTimeZone: normalizeOutputTimeZone(
          schedulingContextResult.context.appointmentTimeZone,
        ),
      }

      const appointmentTimeZone = schedulingContext.appointmentTimeZone
      const appointmentTimeZoneSource = schedulingContext.timeZoneSource

      const stepMinutes = normalizeStepMinutes(location.stepMinutes, 15)

      if (nextBuffer != null && (nextBuffer < 0 || nextBuffer > MAX_BUFFER_MINUTES)) {
        throwCode('BAD_BUFFER')
      }

      if (
        nextDuration != null &&
        (nextDuration < 15 || nextDuration > MAX_SLOT_DURATION_MINUTES)
      ) {
        throwCode('BAD_DURATION')
      }

      const finalStart = nextStart
        ? normalizeToMinute(nextStart)
        : normalizeToMinute(new Date(existing.scheduledFor))

      if (!Number.isFinite(finalStart.getTime())) {
        throwCode('BAD_START')
      }

      const startMinutes = minutesSinceMidnightInTimeZone(
        finalStart,
        appointmentTimeZone,
      )

      if (startMinutes % stepMinutes !== 0) {
        logBookingConflict({
          action: 'BOOKING_UPDATE',
          professionalId: existing.professionalId,
          locationId: location.id,
          locationType: existing.locationType,
          requestedStart: finalStart,
          requestedEnd: addMinutes(finalStart, 1),
          conflictType: 'STEP_BOUNDARY',
          bookingId: existing.id,
          meta: {
            route: 'app/api/pro/bookings/[id]/route.ts',
            stepMinutes,
            timeZone: appointmentTimeZone,
            timeZoneSource: appointmentTimeZoneSource,
          },
        })
        throw new Error(`STEP:${stepMinutes}`)
      }

      const finalBuffer =
        nextBuffer != null
          ? clampInt(
              snapToStepMinutes(nextBuffer, stepMinutes),
              0,
              MAX_BUFFER_MINUTES,
            )
          : Math.max(0, Number(existing.bufferMinutes ?? 0))

      let normalizedServiceItems:
        | ReturnType<typeof buildNormalizedBookingItemsFromRequestedOfferings>
        | null = null

      if (parsedRequestedItems) {
        const offeringIds = Array.from(
          new Set(parsedRequestedItems.map((item) => item.offeringId)),
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

        normalizedServiceItems = buildNormalizedBookingItemsFromRequestedOfferings({
          requestedItems: parsedRequestedItems,
          locationType: existing.locationType,
          stepMinutes,
          offeringById,
          badItemsCode: 'BAD_ITEMS',
        })
      }

      const previewItems =
        normalizedServiceItems?.map((item, index) => ({
          serviceId: item.serviceId,
          offeringId: item.offeringId,
          durationMinutesSnapshot: item.durationMinutesSnapshot,
          priceSnapshot: item.priceSnapshot,
          itemType:
            index === 0
              ? BookingServiceItemType.BASE
              : BookingServiceItemType.ADD_ON,
        })) ??
        (await tx.bookingServiceItem.findMany({
          where: { bookingId: existing.id },
          orderBy: { sortOrder: 'asc' },
          select: {
            serviceId: true,
            offeringId: true,
            priceSnapshot: true,
            durationMinutesSnapshot: true,
            itemType: true,
          },
        }))

      const {
        primaryServiceId,
        primaryOfferingId,
        computedDurationMinutes,
        computedSubtotal,
      } = computeBookingItemLikeTotals(previewItems, 'BAD_ITEMS')

      const snappedNextDuration =
        nextDuration != null
          ? clampInt(
              snapToStepMinutes(nextDuration, stepMinutes),
              15,
              MAX_SLOT_DURATION_MINUTES,
            )
          : null

      if (
        normalizedServiceItems &&
        snappedNextDuration != null &&
        snappedNextDuration !== computedDurationMinutes
      ) {
        throwCode('DURATION_MISMATCH')
      }

      const finalDuration = normalizedServiceItems
        ? computedDurationMinutes
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
          fallbackTimeZone: 'UTC',
          messages: {
            missing: 'Working hours are not set yet.',
            outside: 'That time is outside your working hours.',
            misconfigured: 'Your working hours are misconfigured.',
          },
        })

        if (!workingHoursCheck.ok) {
          logBookingConflict({
            action: 'BOOKING_UPDATE',
            professionalId: existing.professionalId,
            locationId: location.id,
            locationType: existing.locationType,
            requestedStart: finalStart,
            requestedEnd: finalEnd,
            conflictType: 'WORKING_HOURS',
            bookingId: existing.id,
            meta: {
              route: 'app/api/pro/bookings/[id]/route.ts',
              workingHoursError: workingHoursCheck.error,
              timeZone: appointmentTimeZone,
              timeZoneSource: appointmentTimeZoneSource,
            },
          })
          throw new Error(`WH:${workingHoursCheck.error}`)
        }
      }

      const timeRangeConflict = await getTimeRangeConflict({
        tx,
        professionalId: existing.professionalId,
        locationId: location.id,
        requestedStart: finalStart,
        requestedEnd: finalEnd,
        defaultBufferMinutes: finalBuffer,
        fallbackDurationMinutes: finalDuration,
        excludeBookingId: existing.id,
      })

      if (timeRangeConflict) {
        logAndThrowTimeRangeConflict({
          conflict: timeRangeConflict,
          professionalId: existing.professionalId,
          locationId: location.id,
          locationType: existing.locationType,
          requestedStart: finalStart,
          requestedEnd: finalEnd,
          bookingId: existing.id,
          appointmentTimeZone,
          timeZoneSource: appointmentTimeZoneSource,
        })
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
            itemType: BookingServiceItemType.BASE,
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
              itemType: BookingServiceItemType.ADD_ON,
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
          ...(nextStatus === BookingStatus.ACCEPTED
            ? { status: BookingStatus.ACCEPTED }
            : {}),
          scheduledFor: finalStart,
          bufferMinutes: finalBuffer,
          totalDurationMinutes: finalDuration,
          subtotalSnapshot: computedSubtotal,
          serviceId: primaryServiceId,
          offeringId: primaryOfferingId,
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
        const isConfirm = nextStatus === BookingStatus.ACCEPTED
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
        appointmentTimeZone,
        timeZoneSource: appointmentTimeZoneSource,
        locationId: existing.locationId ?? null,
        locationType: existing.locationType,
        locationAddressSnapshot: existingLocationAddressSnapshot,
        locationLatSnapshot: existingLocationLatSnapshot,
        locationLngSnapshot: existingLocationLngSnapshot,
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
    if (message === 'CONFLICT' || message === 'TIME_NOT_AVAILABLE') {
      return jsonFail(409, 'That time is not available.')
    }
    if (message === 'BLOCKED') {
      return jsonFail(409, 'That time is blocked on your calendar.')
    }
    if (message === 'BAD_ITEMS') return jsonFail(400, 'Invalid service items.')
    if (message === 'BAD_BUFFER') return jsonFail(400, 'Invalid bufferMinutes.')
    if (message === 'BAD_DURATION') return jsonFail(400, 'Invalid durationMinutes.')
    if (message.startsWith('WH:')) {
      return jsonFail(
        400,
        message.slice(3) || 'That time is outside working hours.',
      )
    }
    if (message === 'TIMEZONE_REQUIRED') {
      return jsonFail(400, 'Please set a valid timezone before editing bookings.')
    }
    if (message === 'BAD_LOCATION') {
      return jsonFail(400, 'Booking location is invalid.')
    }
    if (message === 'BAD_LOCATION_MODE') {
      return jsonFail(400, 'Booking mode does not match location type.')
    }
    if (message.startsWith('STEP:')) {
      return jsonFail(
        400,
        `Start time must be on a ${message.slice(5)}-minute boundary.`,
      )
    }
    if (message === 'DURATION_MISMATCH') {
      return jsonFail(400, 'Duration does not match selected services.')
    }
    if (message === 'BAD_START') return jsonFail(400, 'Invalid scheduledFor.')

    console.error('PATCH /api/pro/bookings/[id] error:', error)
    return jsonFail(500, 'Failed to update booking.')
  }
}