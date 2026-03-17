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
import { minutesSinceMidnightInTimeZone } from '@/lib/timeZone'
import { clampInt, pickBool, pickInt } from '@/lib/pick'
import {
  MAX_BUFFER_MINUTES,
  MAX_SLOT_DURATION_MINUTES,
} from '@/lib/booking/constants'
import { addMinutes, normalizeToMinute } from '@/lib/booking/conflicts'
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
import { ensureWithinWorkingHours } from '@/lib/booking/workingHoursGuard'
import { snapToStepMinutes } from '@/lib/booking/serviceItems'
import { getProCreatedBookingStatus } from '@/lib/booking/statusRules'
import { withLockedProfessionalTransaction } from '@/lib/booking/scheduleTransaction'
import {
  bookingError,
  getBookingFailPayload,
  isBookingError,
  type BookingErrorCode,
} from '@/lib/booking/errors'

export const dynamic = 'force-dynamic'

type ProCreateBookingLocalErrorCode =
  | 'CLIENT_NOT_FOUND'
  | 'MISSING_SERVICE'
  | 'INTERNAL_ERROR'

const WORKING_HOURS_ERROR_PREFIX = 'BOOKING_WORKING_HOURS:'

type WorkingHoursGuardCode =
  | 'WORKING_HOURS_REQUIRED'
  | 'WORKING_HOURS_INVALID'
  | 'OUTSIDE_WORKING_HOURS'

function throwLocalCode(code: ProCreateBookingLocalErrorCode): never {
  throw new Error(code)
}

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

function localJsonFail(
  status: number,
  code: ProCreateBookingLocalErrorCode,
  message: string,
) {
  return jsonFail(status, message, { code })
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

function makeWorkingHoursGuardMessage(code: WorkingHoursGuardCode): string {
  return `${WORKING_HOURS_ERROR_PREFIX}${code}`
}

function parseWorkingHoursGuardMessage(
  value: string,
): WorkingHoursGuardCode | null {
  if (!value.startsWith(WORKING_HOURS_ERROR_PREFIX)) return null

  const code = value.slice(WORKING_HOURS_ERROR_PREFIX.length)

  switch (code) {
    case 'WORKING_HOURS_REQUIRED':
      return 'WORKING_HOURS_REQUIRED'
    case 'WORKING_HOURS_INVALID':
      return 'WORKING_HOURS_INVALID'
    case 'OUTSIDE_WORKING_HOURS':
      return 'OUTSIDE_WORKING_HOURS'
    default:
      return null
  }
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
      throw bookingError('TIME_BOOKED', {
        userMessage: 'That time is not available.',
      })
    case 'HOLD':
      throw bookingError('TIME_HELD', {
        userMessage: 'That time is not available.',
      })
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
      return jsonFail(400, 'Missing clientId.', { code: 'CLIENT_ID_REQUIRED' })
    }

    if (!scheduledFor) {
      return bookingJsonFail('INVALID_SCHEDULED_FOR')
    }

    if (!locationId) {
      return jsonFail(400, 'Missing locationId.', { code: 'LOCATION_ID_REQUIRED' })
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
              service: {
                select: {
                  id: true,
                  name: true,
                },
              },
            },
          }),
        ])

        if (!client) throwLocalCode('CLIENT_NOT_FOUND')
        if (!offering) throw bookingError('OFFERING_NOT_FOUND')
        if (!offering.service) throwLocalCode('MISSING_SERVICE')

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
        const basePrice = decimalFromUnknown(validatedContextResult.priceStartingAt)

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

        const stepMinutes = locationContext.stepMinutes
        const startMinuteOfDay = minutesSinceMidnightInTimeZone(
          requestedStart,
          locationContext.timeZone,
        )

        if (startMinuteOfDay % stepMinutes !== 0) {
          logBookingConflict({
            action: 'BOOKING_CREATE',
            professionalId,
            locationId: locationContext.locationId,
            locationType,
            requestedStart,
            requestedEnd: addMinutes(requestedStart, 1),
            conflictType: 'STEP_BOUNDARY',
            meta: {
              route: 'app/api/pro/bookings/route.ts',
              stepMinutes,
              offeringId,
              clientId,
            },
          })

          throw bookingError('STEP_MISMATCH', {
            message: `Start time must be on a ${stepMinutes}-minute boundary.`,
            userMessage: `Start time must be on a ${stepMinutes}-minute boundary.`,
          })
        }

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

        const requestedEnd = addMinutes(
          requestedStart,
          totalDurationMinutes + bufferMinutes,
        )

        if (
          !allowShortNotice &&
          requestedStart.getTime() <
            now.getTime() + locationContext.advanceNoticeMinutes * 60_000
        ) {
          logBookingConflict({
            action: 'BOOKING_CREATE',
            professionalId,
            locationId: locationContext.locationId,
            locationType,
            requestedStart,
            requestedEnd,
            conflictType: 'TIME_NOT_AVAILABLE',
            meta: {
              route: 'app/api/pro/bookings/route.ts',
              offeringId,
              clientId,
              rule: 'ADVANCE_NOTICE',
              advanceNoticeMinutes: locationContext.advanceNoticeMinutes,
              allowShortNotice,
            },
          })

          throw bookingError('ADVANCE_NOTICE_REQUIRED', {
            userMessage:
              'That booking is too soon unless you explicitly override advance notice.',
          })
        }

        if (
          !allowFarFuture &&
          requestedStart.getTime() >
            now.getTime() + locationContext.maxDaysAhead * 24 * 60 * 60_000
        ) {
          logBookingConflict({
            action: 'BOOKING_CREATE',
            professionalId,
            locationId: locationContext.locationId,
            locationType,
            requestedStart,
            requestedEnd,
            conflictType: 'TIME_NOT_AVAILABLE',
            meta: {
              route: 'app/api/pro/bookings/route.ts',
              offeringId,
              clientId,
              rule: 'MAX_DAYS_AHEAD',
              maxDaysAhead: locationContext.maxDaysAhead,
              allowFarFuture,
            },
          })

          throw bookingError('MAX_DAYS_AHEAD_EXCEEDED', {
            userMessage:
              'That booking is too far in the future unless you explicitly override the booking window.',
          })
        }

        if (!allowOutsideWorkingHours) {
          const workingHoursResult = ensureWithinWorkingHours({
            scheduledStartUtc: requestedStart,
            scheduledEndUtc: requestedEnd,
            workingHours: locationContext.workingHours,
            timeZone: locationContext.timeZone,
            fallbackTimeZone: 'UTC',
            messages: {
              missing: makeWorkingHoursGuardMessage('WORKING_HOURS_REQUIRED'),
              outside: makeWorkingHoursGuardMessage('OUTSIDE_WORKING_HOURS'),
              misconfigured: makeWorkingHoursGuardMessage('WORKING_HOURS_INVALID'),
            },
          })

          if (!workingHoursResult.ok) {
            logBookingConflict({
              action: 'BOOKING_CREATE',
              professionalId,
              locationId: locationContext.locationId,
              locationType,
              requestedStart,
              requestedEnd,
              conflictType: 'WORKING_HOURS',
              meta: {
                route: 'app/api/pro/bookings/route.ts',
                offeringId,
                clientId,
                workingHoursError: workingHoursResult.error,
              },
            })

            const workingHoursCode = parseWorkingHoursGuardMessage(
              workingHoursResult.error,
            )

            if (workingHoursCode === 'WORKING_HOURS_REQUIRED') {
              throw bookingError('WORKING_HOURS_REQUIRED')
            }

            if (workingHoursCode === 'WORKING_HOURS_INVALID') {
              throw bookingError('WORKING_HOURS_INVALID')
            }

            if (workingHoursCode === 'OUTSIDE_WORKING_HOURS') {
              throw bookingError('OUTSIDE_WORKING_HOURS')
            }

            throw bookingError('OUTSIDE_WORKING_HOURS', {
              message: workingHoursResult.error,
              userMessage:
                workingHoursResult.error || 'That time is outside working hours.',
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
            throw bookingError('TIME_BOOKED', {
              userMessage: 'That time is not available.',
            })
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

    const endsAt = addMinutes(
      new Date(result.booking.scheduledFor),
      Number(result.booking.totalDurationMinutes) +
        Number(result.booking.bufferMinutes),
    )

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

    const message = error instanceof Error ? error.message : ''

    if (message === 'CLIENT_NOT_FOUND') {
      return localJsonFail(404, 'CLIENT_NOT_FOUND', 'Client not found.')
    }

    if (message === 'MISSING_SERVICE') {
      return localJsonFail(
        400,
        'MISSING_SERVICE',
        'The selected service could not be found.',
      )
    }

    console.error('POST /api/pro/bookings error', error)
    return localJsonFail(500, 'INTERNAL_ERROR', 'Failed to create booking.')
  }
}