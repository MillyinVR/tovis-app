// app/api/pro/bookings/route.ts
import {
  BookingServiceItemType,
  BookingStatus,
  ClientAddressKind,
  Prisma,
  ServiceLocationType,
} from '@prisma/client'
import { jsonFail, jsonOk, pickString, requirePro } from '@/app/api/_utils'
import { isRecord } from '@/lib/guards'
import { moneyToString } from '@/lib/money'
import { clampInt, pickBool, pickInt } from '@/lib/pick'
import {
  MAX_BUFFER_MINUTES,
  MAX_SLOT_DURATION_MINUTES,
} from '@/lib/booking/constants'
import { normalizeToMinute } from '@/lib/booking/conflicts'
import { getTimeRangeConflict } from '@/lib/booking/conflictQueries'
import { logBookingConflict } from '@/lib/booking/conflictLogging'
import {
  normalizeLocationType,
  resolveValidatedBookingContext,
  type SchedulingReadinessError,
} from '@/lib/booking/locationContext'
import {
  buildAddressSnapshot,
  decimalFromUnknown,
  decimalToNumber,
} from '@/lib/booking/snapshots'
import { snapToStepMinutes } from '@/lib/booking/serviceItems'
import { getProCreatedBookingStatus } from '@/lib/booking/statusRules'
import {
  checkAdvanceNotice,
  checkMaxDaysAheadExact,
  checkSlotReadiness,
  computeRequestedEndUtc,
  isStartAlignedToWorkingWindowStep,
  type SlotReadinessCode,
} from '@/lib/booking/slotReadiness'
import { withLockedProfessionalTransaction } from '@/lib/booking/scheduleTransaction'
import {
  bookingError,
  getBookingFailPayload,
  isBookingError,
  type BookingErrorCode,
} from '@/lib/booking/errors'

export const dynamic = 'force-dynamic'

const OVERRIDE_MAX_DAYS_AHEAD = 100_000
const WORKING_HOURS_ERROR_PREFIX = 'BOOKING_WORKING_HOURS:'

function bookingJsonFail(
  code: BookingErrorCode,
  overrides?: {
    message?: string
    userMessage?: string
  },
) {
  const fail = getBookingFailPayload(code, overrides)
  return jsonFail(fail.httpStatus, fail.userMessage, fail.extra)
}

function toDateOrNull(value: unknown): Date | null {
  const raw = pickString(value)
  if (!raw) return null

  const parsed = new Date(raw)
  return Number.isFinite(parsed.getTime()) ? parsed : null
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

function normalizeAddress(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function mapSchedulingReadinessError(
  error: SchedulingReadinessError,
): BookingErrorCode {
  switch (error) {
    case 'LOCATION_NOT_FOUND':
      return 'LOCATION_NOT_FOUND'
    case 'TIMEZONE_REQUIRED':
      return 'TIMEZONE_REQUIRED'
    case 'WORKING_HOURS_REQUIRED':
      return 'WORKING_HOURS_REQUIRED'
    case 'WORKING_HOURS_INVALID':
      return 'WORKING_HOURS_INVALID'
    case 'MODE_NOT_SUPPORTED':
      return 'MODE_NOT_SUPPORTED'
    case 'DURATION_REQUIRED':
      return 'DURATION_REQUIRED'
    case 'PRICE_REQUIRED':
      return 'PRICE_REQUIRED'
    case 'COORDINATES_REQUIRED':
      return 'COORDINATES_REQUIRED'
  }
}

function getReadableWorkingHoursMessage(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) {
    return 'That time is outside working hours.'
  }

  if (value.startsWith(WORKING_HOURS_ERROR_PREFIX)) {
    return 'That time is outside working hours.'
  }

  return value
}

function mapSlotReadinessCodeToBookingCode(
  code: SlotReadinessCode,
): BookingErrorCode {
  switch (code) {
    case 'STEP_MISMATCH':
      return 'STEP_MISMATCH'
    case 'ADVANCE_NOTICE_REQUIRED':
      return 'ADVANCE_NOTICE_REQUIRED'
    case 'MAX_DAYS_AHEAD_EXCEEDED':
      return 'MAX_DAYS_AHEAD_EXCEEDED'
    case 'WORKING_HOURS_REQUIRED':
      return 'WORKING_HOURS_REQUIRED'
    case 'WORKING_HOURS_INVALID':
      return 'WORKING_HOURS_INVALID'
    case 'OUTSIDE_WORKING_HOURS':
      return 'OUTSIDE_WORKING_HOURS'
    case 'INVALID_START':
      return 'INVALID_SCHEDULED_FOR'
    case 'INVALID_DURATION':
      return 'DURATION_REQUIRED'
    case 'INVALID_BUFFER':
      return 'INTERNAL_ERROR'
    case 'INVALID_RANGE':
      return 'INVALID_SCHEDULED_FOR'
  }
}

function logAndThrowSlotReadinessFailure(args: {
  code: SlotReadinessCode
  professionalId: string
  locationId: string
  locationType: ServiceLocationType
  requestedStart: Date
  requestedEnd: Date
  offeringId: string
  clientId: string
  stepMinutes: number
  meta?: Record<string, unknown>
}): never {
  const conflictType =
    args.code === 'STEP_MISMATCH'
      ? 'STEP_BOUNDARY'
      : args.code === 'WORKING_HOURS_REQUIRED' ||
          args.code === 'WORKING_HOURS_INVALID' ||
          args.code === 'OUTSIDE_WORKING_HOURS'
        ? 'WORKING_HOURS'
        : 'TIME_NOT_AVAILABLE'

  const logMeta: Record<string, unknown> = {
    route: 'app/api/pro/bookings/route.ts',
    offeringId: args.offeringId,
    clientId: args.clientId,
  }

  if (args.code === 'STEP_MISMATCH') {
    logMeta.stepMinutes = args.stepMinutes
  }

  if (
    args.code === 'WORKING_HOURS_REQUIRED' ||
    args.code === 'WORKING_HOURS_INVALID' ||
    args.code === 'OUTSIDE_WORKING_HOURS'
  ) {
    if (typeof args.meta?.workingHoursError === 'string') {
      logMeta.workingHoursError = args.meta.workingHoursError
    }
  }

  if (args.code === 'ADVANCE_NOTICE_REQUIRED') {
    logMeta.rule = 'ADVANCE_NOTICE'
    if (typeof args.meta?.advanceNoticeMinutes === 'number') {
      logMeta.advanceNoticeMinutes = args.meta.advanceNoticeMinutes
    }
    if (typeof args.meta?.allowShortNotice === 'boolean') {
      logMeta.allowShortNotice = args.meta.allowShortNotice
    }
  }

  if (args.code === 'MAX_DAYS_AHEAD_EXCEEDED') {
    logMeta.rule = 'MAX_DAYS_AHEAD'
    if (typeof args.meta?.maxDaysAhead === 'number') {
      logMeta.maxDaysAhead = args.meta.maxDaysAhead
    }
    if (typeof args.meta?.allowFarFuture === 'boolean') {
      logMeta.allowFarFuture = args.meta.allowFarFuture
    }
  }

  logBookingConflict({
    action: 'BOOKING_CREATE',
    professionalId: args.professionalId,
    locationId: args.locationId,
    locationType: args.locationType,
    requestedStart: args.requestedStart,
    requestedEnd: args.requestedEnd,
    conflictType,
    meta: logMeta,
  })

  if (args.code === 'STEP_MISMATCH') {
    throw bookingError('STEP_MISMATCH', {
      message: `Start time must be on a ${args.stepMinutes}-minute boundary.`,
      userMessage: `Start time must be on a ${args.stepMinutes}-minute boundary.`,
    })
  }

  if (args.code === 'ADVANCE_NOTICE_REQUIRED') {
    throw bookingError('ADVANCE_NOTICE_REQUIRED', {
      userMessage:
        'That booking is too soon unless you explicitly override advance notice.',
    })
  }

  if (args.code === 'MAX_DAYS_AHEAD_EXCEEDED') {
    throw bookingError('MAX_DAYS_AHEAD_EXCEEDED', {
      userMessage:
        'That booking is too far in the future unless you explicitly override the booking window.',
    })
  }

  if (args.code === 'OUTSIDE_WORKING_HOURS') {
    const message = getReadableWorkingHoursMessage(args.meta?.workingHoursError)

    throw bookingError('OUTSIDE_WORKING_HOURS', {
      message,
      userMessage: message,
    })
  }

  throw bookingError(mapSlotReadinessCodeToBookingCode(args.code))
}

function logAndThrowTimeRangeConflict(args: {
  conflict: 'BLOCKED' | 'BOOKING' | 'HOLD'
  professionalId: string
  locationId: string
  locationType: ServiceLocationType
  requestedStart: Date
  requestedEnd: Date
  offeringId: string
  clientId: string
}): never {
  logBookingConflict({
    action: 'BOOKING_CREATE',
    professionalId: args.professionalId,
    locationId: args.locationId,
    locationType: args.locationType,
    requestedStart: args.requestedStart,
    requestedEnd: args.requestedEnd,
    conflictType: args.conflict,
    meta: {
      route: 'app/api/pro/bookings/route.ts',
      offeringId: args.offeringId,
      clientId: args.clientId,
    },
  })

  switch (args.conflict) {
    case 'BLOCKED':
      throw bookingError('TIME_BLOCKED', {
        userMessage: 'That time is blocked on your calendar.',
      })
    case 'BOOKING':
      throw bookingError('TIME_BOOKED')
    case 'HOLD':
      throw bookingError('TIME_HELD')
  }
}

export async function POST(req: Request) {
  try {
    const auth = await requirePro()
    if (!auth.ok) return auth.res

    const professionalId = auth.professionalId
    const rawBody: unknown = await req.json().catch(() => ({}))
    const body = isRecord(rawBody) ? rawBody : {}

    const clientId = pickString(body.clientId)
    const clientAddressId = pickString(body.clientAddressId)
    const scheduledFor = toDateOrNull(body.scheduledFor)
    const internalNotes = pickString(body.internalNotes)

    const locationId = pickString(body.locationId)
    const locationType = normalizeLocationType(body.locationType)
    const offeringId = pickString(body.offeringId)

    const requestedBufferMinutes = pickInt(body.bufferMinutes)
    const requestedTotalDurationMinutes = pickInt(body.totalDurationMinutes)

    const allowOutsideWorkingHours =
      pickBool(body.allowOutsideWorkingHours) ?? false
    const allowShortNotice = pickBool(body.allowShortNotice) ?? false
    const allowFarFuture = pickBool(body.allowFarFuture) ?? false

    if (!clientId) {
      return bookingJsonFail('CLIENT_ID_REQUIRED')
    }

    if (!scheduledFor) {
      return bookingJsonFail('INVALID_SCHEDULED_FOR')
    }

    if (!locationId) {
      return bookingJsonFail('LOCATION_ID_REQUIRED')
    }

    if (!locationType) {
      return bookingJsonFail('LOCATION_TYPE_REQUIRED')
    }

    if (!offeringId) {
      return bookingJsonFail('OFFERING_ID_REQUIRED')
    }

    if (locationType === ServiceLocationType.MOBILE && !clientAddressId) {
      return bookingJsonFail('CLIENT_SERVICE_ADDRESS_REQUIRED', {
        userMessage: 'Mobile bookings require a saved client service address.',
      })
    }

    const requestedStart = normalizeToMinute(scheduledFor)

    const result = await withLockedProfessionalTransaction(
      professionalId,
      async ({ tx, now }) => {
        const [client, clientAddress, offering] = await Promise.all([
          tx.clientProfile.findUnique({
            where: { id: clientId },
            select: { id: true },
          }),
          locationType === ServiceLocationType.MOBILE && clientAddressId
            ? tx.clientAddress.findFirst({
                where: {
                  id: clientAddressId,
                  clientId,
                  kind: ClientAddressKind.SERVICE_ADDRESS,
                },
                select: {
                  id: true,
                  formattedAddress: true,
                  lat: true,
                  lng: true,
                },
              })
            : Promise.resolve(null),
          tx.professionalServiceOffering.findFirst({
            where: {
              id: offeringId,
              professionalId,
              isActive: true,
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
              professional: {
                select: {
                  timeZone: true,
                },
              },
              service: {
                select: {
                  id: true,
                  name: true,
                },
              },
            },
          }),
        ])

        if (!client) {
          throw bookingError('CLIENT_NOT_FOUND')
        }

        if (!offering) {
          throw bookingError('OFFERING_NOT_FOUND')
        }

        if (!offering.service) {
          throw bookingError('BOOKING_MISSING_OFFERING', {
            message: 'Offering is missing its service relation.',
            userMessage:
              'This booking is missing service information and cannot be processed.',
          })
        }

        const clientServiceAddress =
          locationType === ServiceLocationType.MOBILE
            ? normalizeAddress(clientAddress?.formattedAddress)
            : null

        if (locationType === ServiceLocationType.MOBILE) {
          if (!clientAddress) {
            throw bookingError('CLIENT_SERVICE_ADDRESS_REQUIRED', {
              userMessage: 'Mobile bookings require a saved client service address.',
            })
          }

          if (!clientServiceAddress) {
            throw bookingError('CLIENT_SERVICE_ADDRESS_INVALID', {
              userMessage:
                'The selected client service address is incomplete. Please update it before booking mobile.',
            })
          }
        }

        const validatedContextResult = await resolveValidatedBookingContext({
          tx,
          professionalId,
          requestedLocationId: locationId,
          locationType,
          professionalTimeZone: offering.professional?.timeZone ?? null,
          fallbackTimeZone: 'UTC',
          requireValidTimeZone: true,
          allowFallback: false,
          requireCoordinates: false,
          offering: {
            offersInSalon: offering.offersInSalon,
            offersMobile: offering.offersMobile,
            salonDurationMinutes: offering.salonDurationMinutes,
            mobileDurationMinutes: offering.mobileDurationMinutes,
            salonPriceStartingAt: offering.salonPriceStartingAt,
            mobilePriceStartingAt: offering.mobilePriceStartingAt,
          },
        })

        if (!validatedContextResult.ok) {
          throw bookingError(
            mapSchedulingReadinessError(validatedContextResult.error),
          )
        }

        const locationContext = validatedContextResult.context
        const baseDurationMinutes = validatedContextResult.durationMinutes
        const basePrice = decimalFromUnknown(
          validatedContextResult.priceStartingAt,
        )

        const salonLocationAddress =
          locationType === ServiceLocationType.SALON
            ? normalizeAddress(locationContext.formattedAddress)
            : null

        if (
          locationType === ServiceLocationType.SALON &&
          !salonLocationAddress
        ) {
          throw bookingError('SALON_LOCATION_ADDRESS_REQUIRED')
        }

        if (requestedStart.getTime() < now.getTime()) {
          throw bookingError('TIME_IN_PAST')
        }

        const stepMinutes = locationContext.stepMinutes

        const locationBufferMinutes = clampInt(
          Number(locationContext.bufferMinutes ?? 0),
          0,
          MAX_BUFFER_MINUTES,
        )

        const bufferMinutes =
          requestedBufferMinutes == null
            ? locationBufferMinutes
            : clampInt(
                snapToStepMinutes(
                  clampInt(requestedBufferMinutes, 0, MAX_BUFFER_MINUTES),
                  stepMinutes,
                ),
                0,
                MAX_BUFFER_MINUTES,
              )

        const computedDurationMinutes = clampInt(
          snapToStepMinutes(baseDurationMinutes, stepMinutes),
          stepMinutes,
          MAX_SLOT_DURATION_MINUTES,
        )

        const totalDurationMinutes =
          requestedTotalDurationMinutes != null &&
          requestedTotalDurationMinutes >= computedDurationMinutes &&
          requestedTotalDurationMinutes <= MAX_SLOT_DURATION_MINUTES
            ? clampInt(
                snapToStepMinutes(requestedTotalDurationMinutes, stepMinutes),
                computedDurationMinutes,
                MAX_SLOT_DURATION_MINUTES,
              )
            : computedDurationMinutes

        const requestedEnd = computeRequestedEndUtc({
          startUtc: requestedStart,
          durationMinutes: totalDurationMinutes,
          bufferMinutes,
        })

        const stepCheck = isStartAlignedToWorkingWindowStep({
          startUtc: requestedStart,
          workingHours: locationContext.workingHours,
          timeZone: locationContext.timeZone,
          stepMinutes,
          fallbackTimeZone: 'UTC',
        })

        if (!stepCheck.ok) {
          logAndThrowSlotReadinessFailure({
            code: stepCheck.code,
            professionalId,
            locationId: locationContext.locationId,
            locationType,
            requestedStart,
            requestedEnd,
            offeringId,
            clientId,
            stepMinutes,
            meta: stepCheck.meta,
          })
        }

        if (!allowShortNotice) {
          const advanceNoticeCheck = checkAdvanceNotice({
            startUtc: requestedStart,
            nowUtc: now,
            advanceNoticeMinutes: locationContext.advanceNoticeMinutes,
          })

          if (!advanceNoticeCheck.ok) {
            logAndThrowSlotReadinessFailure({
              code: advanceNoticeCheck.code,
              professionalId,
              locationId: locationContext.locationId,
              locationType,
              requestedStart,
              requestedEnd,
              offeringId,
              clientId,
              stepMinutes,
              meta: {
                advanceNoticeMinutes: locationContext.advanceNoticeMinutes,
                allowShortNotice,
              },
            })
          }
        }

        if (!allowFarFuture) {
          const maxDaysAheadCheck = checkMaxDaysAheadExact({
            startUtc: requestedStart,
            nowUtc: now,
            maxDaysAhead: locationContext.maxDaysAhead,
          })

          if (!maxDaysAheadCheck.ok) {
            logAndThrowSlotReadinessFailure({
              code: maxDaysAheadCheck.code,
              professionalId,
              locationId: locationContext.locationId,
              locationType,
              requestedStart,
              requestedEnd,
              offeringId,
              clientId,
              stepMinutes,
              meta: {
                maxDaysAhead: locationContext.maxDaysAhead,
                allowFarFuture,
              },
            })
          }
        }

        if (!allowOutsideWorkingHours) {
          const workingHoursReadiness = checkSlotReadiness({
            startUtc: requestedStart,
            nowUtc: now,
            durationMinutes: totalDurationMinutes,
            bufferMinutes,
            workingHours: locationContext.workingHours,
            timeZone: locationContext.timeZone,
            stepMinutes,
            advanceNoticeMinutes: allowShortNotice
              ? 0
              : locationContext.advanceNoticeMinutes,
            maxDaysAhead: allowFarFuture
              ? OVERRIDE_MAX_DAYS_AHEAD
              : locationContext.maxDaysAhead,
            fallbackTimeZone: 'UTC',
          })

          if (!workingHoursReadiness.ok) {
            logAndThrowSlotReadinessFailure({
              code: workingHoursReadiness.code,
              professionalId,
              locationId: locationContext.locationId,
              locationType,
              requestedStart,
              requestedEnd,
              offeringId,
              clientId,
              stepMinutes,
              meta: workingHoursReadiness.meta,
            })
          }
        }

        const timeRangeConflict = await getTimeRangeConflict({
          tx,
          professionalId,
          locationId: locationContext.locationId,
          requestedStart,
          requestedEnd,
          defaultBufferMinutes: bufferMinutes,
          fallbackDurationMinutes: totalDurationMinutes,
        })

        if (timeRangeConflict) {
          logAndThrowTimeRangeConflict({
            conflict: timeRangeConflict,
            professionalId,
            locationId: locationContext.locationId,
            locationType,
            requestedStart,
            requestedEnd,
            offeringId,
            clientId,
          })
        }

        const salonLocationAddressSnapshot:
          | Prisma.InputJsonValue
          | Prisma.NullableJsonNullValueInput =
          locationType === ServiceLocationType.SALON && salonLocationAddress
            ? buildAddressSnapshot(salonLocationAddress) ?? Prisma.JsonNull
            : Prisma.JsonNull

        const clientAddressSnapshot:
          | Prisma.InputJsonValue
          | Prisma.NullableJsonNullValueInput =
          locationType === ServiceLocationType.MOBILE && clientServiceAddress
            ? buildAddressSnapshot(clientServiceAddress) ?? Prisma.JsonNull
            : Prisma.JsonNull

        const locationLatSnapshot = locationContext.lat ?? null
        const locationLngSnapshot = locationContext.lng ?? null

        const clientAddressLatSnapshot =
          locationType === ServiceLocationType.MOBILE && clientAddress
            ? decimalToNumber(clientAddress.lat)
            : null

        const clientAddressLngSnapshot =
          locationType === ServiceLocationType.MOBILE && clientAddress
            ? decimalToNumber(clientAddress.lng)
            : null

        let booking: {
          id: string
          scheduledFor: Date
          totalDurationMinutes: number
          bufferMinutes: number
          status: BookingStatus
        }

        try {
          booking = await tx.booking.create({
            data: {
              professionalId,
              clientId,
              serviceId: offering.serviceId,
              offeringId: offering.id,
              scheduledFor: requestedStart,
              status: getProCreatedBookingStatus(),

              locationType,
              locationId: locationContext.locationId,
              locationTimeZone: locationContext.timeZone,

              locationAddressSnapshot: salonLocationAddressSnapshot,
              locationLatSnapshot,
              locationLngSnapshot,

              clientAddressId:
                locationType === ServiceLocationType.MOBILE && clientAddress
                  ? clientAddress.id
                  : null,
              clientAddressSnapshot,
              clientAddressLatSnapshot,
              clientAddressLngSnapshot,

              internalNotes: internalNotes ?? null,
              bufferMinutes,
              totalDurationMinutes,
              subtotalSnapshot: basePrice,
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
          if (
            error instanceof Prisma.PrismaClientKnownRequestError &&
            error.code === 'P2002'
          ) {
            throw bookingError('TIME_BOOKED')
          }
          throw error
        }

        await tx.bookingServiceItem.create({
          data: {
            bookingId: booking.id,
            serviceId: offering.serviceId,
            offeringId: offering.id,
            itemType: BookingServiceItemType.BASE,
            priceSnapshot: basePrice,
            durationMinutesSnapshot: computedDurationMinutes,
            sortOrder: 0,
          },
        })

        return {
          booking,
          subtotalSnapshot: basePrice,
          stepMinutes,
          appointmentTimeZone: locationContext.timeZone,
          locationId: locationContext.locationId,
          locationType,
          clientAddressId:
            locationType === ServiceLocationType.MOBILE && clientAddress
              ? clientAddress.id
              : null,
          serviceName: offering.service.name || 'Appointment',
        }
      },
    )

    const endsAt = computeRequestedEndUtc({
      startUtc: new Date(result.booking.scheduledFor),
      durationMinutes: Number(result.booking.totalDurationMinutes),
      bufferMinutes: Number(result.booking.bufferMinutes),
    })

    return jsonOk(
      {
        booking: {
          id: result.booking.id,
          scheduledFor: new Date(result.booking.scheduledFor).toISOString(),
          endsAt: endsAt.toISOString(),
          totalDurationMinutes: Number(result.booking.totalDurationMinutes),
          bufferMinutes: Number(result.booking.bufferMinutes),
          status: result.booking.status,
          serviceName: result.serviceName,
          subtotalSnapshot:
            moneyToString(result.subtotalSnapshot) ??
            result.subtotalSnapshot.toString(),
          subtotalCents: decimalToCents(result.subtotalSnapshot),
          locationId: result.locationId,
          locationType: result.locationType,
          clientAddressId: result.clientAddressId,
          stepMinutes: result.stepMinutes,
          timeZone: result.appointmentTimeZone,
        },
      },
      201,
    )
  } catch (error: unknown) {
    if (isBookingError(error)) {
      return bookingJsonFail(error.code, {
        message: error.message,
        userMessage: error.userMessage,
      })
    }

    console.error('POST /api/pro/bookings error', error)
    return bookingJsonFail('INTERNAL_ERROR', {
      message:
        error instanceof Error ? error.message : 'Failed to create booking.',
      userMessage: 'Failed to create booking.',
    })
  }
}