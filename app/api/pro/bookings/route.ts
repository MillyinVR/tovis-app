// app/api/pro/bookings/route.ts
import { prisma } from '@/lib/prisma'
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

export const dynamic = 'force-dynamic'

type CreateBookingErrorCode =
  | 'BLOCKED'
  | 'CLIENT_NOT_FOUND'
  | 'CLIENT_SERVICE_ADDRESS_REQUIRED'
  | 'CLIENT_SERVICE_ADDRESS_INVALID'
  | 'SALON_LOCATION_ADDRESS_REQUIRED'
  | 'LOCATION_NOT_FOUND'
  | 'MISSING_OFFERING'
  | 'MISSING_SERVICE'
  | 'MODE_NOT_SUPPORTED'
  | 'PRICE_REQUIRED'
  | 'DURATION_REQUIRED'
  | 'TIME_NOT_AVAILABLE'
  | 'TIMEZONE_REQUIRED'
  | 'WORKING_HOURS_REQUIRED'
  | 'WORKING_HOURS_INVALID'
  | 'COORDINATES_REQUIRED'

function throwCode(code: CreateBookingErrorCode): never {
  throw new Error(code)
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
): CreateBookingErrorCode {
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

    if (!clientId) return jsonFail(400, 'Missing clientId.')
    if (!scheduledFor) return jsonFail(400, 'Missing or invalid scheduledFor.')
    if (!locationId) return jsonFail(400, 'Missing locationId.')
    if (!locationType) return jsonFail(400, 'Missing or invalid locationType.')
    if (!offeringId) return jsonFail(400, 'Missing offeringId.')

    if (
      locationType === ServiceLocationType.MOBILE &&
      !clientAddressId
    ) {
      return jsonFail(
        400,
        'Mobile bookings require a saved client service address.',
      )
    }

    const requestedStart = normalizeToMinute(scheduledFor)

    const result = await prisma.$transaction(async (tx) => {
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

      if (!client) throwCode('CLIENT_NOT_FOUND')
      if (!offering) throwCode('MISSING_OFFERING')
      if (!offering.service) throwCode('MISSING_SERVICE')

      const clientServiceAddress =
        locationType === ServiceLocationType.MOBILE
          ? normalizeAddress(clientAddress?.formattedAddress)
          : null

      if (locationType === ServiceLocationType.MOBILE) {
        if (!clientAddress) {
          throwCode('CLIENT_SERVICE_ADDRESS_REQUIRED')
        }

        if (!clientServiceAddress) {
          throwCode('CLIENT_SERVICE_ADDRESS_INVALID')
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
        throwCode(mapSchedulingReadinessError(validatedContextResult.error))
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
        throwCode('SALON_LOCATION_ADDRESS_REQUIRED')
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
        throw new Error(`STEP:${stepMinutes}`)
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

      if (!allowOutsideWorkingHours) {
        const workingHoursResult = ensureWithinWorkingHours({
          scheduledStartUtc: requestedStart,
          scheduledEndUtc: requestedEnd,
          workingHours: locationContext.workingHours,
          timeZone: locationContext.timeZone,
          fallbackTimeZone: 'UTC',
          messages: {
            missing: 'Working hours are not set yet.',
            outside: 'That time is outside working hours.',
            misconfigured: 'Working hours are misconfigured.',
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
          throw new Error(`WH:${workingHoursResult.error}`)
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

            if (timeRangeConflict === 'BLOCKED') {
              logBookingConflict({
                action: 'BOOKING_CREATE',
                professionalId,
                locationId: locationContext.locationId,
                locationType,
                requestedStart,
                requestedEnd,
                conflictType: 'BLOCKED',
                meta: {
                  route: 'app/api/pro/bookings/route.ts',
                  offeringId,
                  clientId,
                },
              })
              throwCode('BLOCKED')
            }

            if (timeRangeConflict === 'BOOKING') {
              logBookingConflict({
                action: 'BOOKING_CREATE',
                professionalId,
                locationId: locationContext.locationId,
                locationType,
                requestedStart,
                requestedEnd,
                conflictType: 'BOOKING',
                meta: {
                  route: 'app/api/pro/bookings/route.ts',
                  offeringId,
                  clientId,
                },
              })
              throwCode('TIME_NOT_AVAILABLE')
            }

            if (timeRangeConflict === 'HOLD') {
              logBookingConflict({
                action: 'BOOKING_CREATE',
                professionalId,
                locationId: locationContext.locationId,
                locationType,
                requestedStart,
                requestedEnd,
                conflictType: 'HOLD',
                meta: {
                  route: 'app/api/pro/bookings/route.ts',
                  offeringId,
                  clientId,
                },
              })
              throwCode('TIME_NOT_AVAILABLE')
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
            status: BookingStatus.ACCEPTED,

            locationType,
            locationId: locationContext.locationId,
            locationTimeZone: locationContext.timeZone,

            // SALON destination = pro salon/suite address.
            // MOBILE destination = clientAddressSnapshot.
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
          throwCode('TIME_NOT_AVAILABLE')
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
    })

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
    const message = error instanceof Error ? error.message : ''

    if (message === 'CLIENT_NOT_FOUND') {
      return jsonFail(404, 'Client not found.')
    }

    if (message === 'CLIENT_SERVICE_ADDRESS_REQUIRED') {
      return jsonFail(
        400,
        'Mobile bookings require a saved client service address.',
      )
    }

    if (message === 'CLIENT_SERVICE_ADDRESS_INVALID') {
      return jsonFail(
        400,
        'The selected client service address is incomplete. Please update it before booking mobile.',
      )
    }

    if (message === 'SALON_LOCATION_ADDRESS_REQUIRED') {
      return jsonFail(
        400,
        'This salon location is missing an address. Please update the professional location before booking.',
      )
    }

    if (message === 'LOCATION_NOT_FOUND') {
      return jsonFail(404, 'Location not found or not bookable.')
    }

    if (message === 'MISSING_OFFERING') {
      return jsonFail(
        400,
        'The selected offering is not available for this professional.',
      )
    }

    if (message === 'MISSING_SERVICE') {
      return jsonFail(400, 'The selected service could not be found.')
    }

    if (message === 'MODE_NOT_SUPPORTED') {
      return jsonFail(400, 'This offering does not support that booking mode.')
    }

    if (message === 'PRICE_REQUIRED') {
      return jsonFail(409, 'Pricing is not set for the selected offering.')
    }

    if (message === 'DURATION_REQUIRED') {
      return jsonFail(409, 'Duration is not set for the selected offering.')
    }

    if (message === 'TIMEZONE_REQUIRED') {
      return jsonFail(
        400,
        'This location must set a valid timezone before taking bookings.',
      )
    }

    if (message === 'WORKING_HOURS_REQUIRED') {
      return jsonFail(400, 'Working hours are not set yet.')
    }

    if (message === 'WORKING_HOURS_INVALID') {
      return jsonFail(400, 'Working hours are misconfigured.')
    }

    if (message === 'COORDINATES_REQUIRED') {
      return jsonFail(
        400,
        'This location is missing coordinates required for this booking flow.',
      )
    }

    if (message === 'TIME_NOT_AVAILABLE') {
      return jsonFail(409, 'That time is not available.')
    }

    if (message === 'BLOCKED') {
      return jsonFail(409, 'That time is blocked on your calendar.')
    }

    if (message.startsWith('STEP:')) {
      return jsonFail(
        400,
        `Start time must be on a ${message.slice(5)}-minute boundary.`,
      )
    }

    if (message.startsWith('WH:')) {
      return jsonFail(
        400,
        message.slice(3) || 'That time is outside working hours.',
      )
    }

    console.error('POST /api/pro/bookings error', error)
    return jsonFail(500, 'Failed to create booking.')
  }
}