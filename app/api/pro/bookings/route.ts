// app/api/pro/bookings/route.ts
import { prisma } from '@/lib/prisma'
import {
  ClientAddressKind,
  Prisma,
  BookingServiceItemType,
  BookingStatus,
  ProfessionalLocationType,
  ServiceLocationType,
} from '@prisma/client'
import { jsonFail, jsonOk, pickString, requirePro } from '@/app/api/_utils'
import { isRecord } from '@/lib/guards'
import { moneyToString } from '@/lib/money'
import {
  isValidIanaTimeZone,
  minutesSinceMidnightInTimeZone,
  sanitizeTimeZone,
} from '@/lib/timeZone'
import { pickBool, pickInt, clampInt } from '@/lib/pick'
import {
  DEFAULT_DURATION_MINUTES,
  MAX_BUFFER_MINUTES,
  MAX_SLOT_DURATION_MINUTES,
} from '@/lib/booking/constants'
import { addMinutes, normalizeToMinute } from '@/lib/booking/conflicts'
import { assertTimeRangeAvailable } from '@/lib/booking/conflictQueries'
import {
  normalizeLocationType,
  normalizeStepMinutes,
} from '@/lib/booking/locationContext'
import {
  buildAddressSnapshot,
  decimalToNumber,
} from '@/lib/booking/snapshots'
import { ensureWithinWorkingHours } from '@/lib/booking/workingHoursGuard'
import { resolveApptTimeZone } from '@/lib/booking/timeZoneTruth'
import {
  buildNormalizedBookingItemsFromServiceIds,
  computeBookingItemTotals,
  snapToStepMinutes,
} from '@/lib/booking/serviceItems'

export const dynamic = 'force-dynamic'

type CreateBookingErrorCode =
  | 'BLOCKED'
  | 'CLIENT_NOT_FOUND'
  | 'CLIENT_SERVICE_ADDRESS_REQUIRED'
  | 'CLIENT_SERVICE_ADDRESS_INVALID'
  | 'LOCATION_MODE_MISMATCH'
  | 'LOCATION_NOT_FOUND'
  | 'MISSING_OFFERING'
  | 'MISSING_SERVICE'
  | 'PRICING_NOT_SET'
  | 'BAD_DURATION'
  | 'TIME_NOT_AVAILABLE'
  | 'TIMEZONE_REQUIRED'

function throwCode(code: CreateBookingErrorCode): never {
  throw new Error(code)
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

function hasNonEmptyAddress(snapshotSource: {
  formattedAddress: string | null
}): boolean {
  return Boolean(snapshotSource.formattedAddress?.trim())
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
    const serviceIds = Array.from(new Set(toStringArray(body.serviceIds))).slice(0, 10)

    const requestedBufferMinutes = pickInt(body.bufferMinutes)
    const requestedTotalDurationMinutes = pickInt(body.totalDurationMinutes)
    const allowOutsideWorkingHours = pickBool(body.allowOutsideWorkingHours) ?? false

    if (!clientId) return jsonFail(400, 'Missing clientId.')
    if (!scheduledFor) return jsonFail(400, 'Missing or invalid scheduledFor.')
    if (!locationId) return jsonFail(400, 'Missing locationId.')
    if (!locationType) return jsonFail(400, 'Missing or invalid locationType.')
    if (!serviceIds.length) return jsonFail(400, 'Select at least one service.')

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
      const [client, location, clientAddress] = await Promise.all([
        tx.clientProfile.findUnique({
          where: { id: clientId },
          select: { id: true },
        }),
        tx.professionalLocation.findFirst({
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
      ])

      if (!client) throwCode('CLIENT_NOT_FOUND')
      if (!location) throwCode('LOCATION_NOT_FOUND')

      if (
        locationType === ServiceLocationType.MOBILE &&
        location.type !== ProfessionalLocationType.MOBILE_BASE
      ) {
        throwCode('LOCATION_MODE_MISMATCH')
      }

      if (
        locationType === ServiceLocationType.SALON &&
        location.type === ProfessionalLocationType.MOBILE_BASE
      ) {
        throwCode('LOCATION_MODE_MISMATCH')
      }

      if (locationType === ServiceLocationType.MOBILE) {
        if (!clientAddress) {
          throwCode('CLIENT_SERVICE_ADDRESS_REQUIRED')
        }

        if (!hasNonEmptyAddress(clientAddress)) {
          throwCode('CLIENT_SERVICE_ADDRESS_INVALID')
        }
      }

      const tzResult = await resolveApptTimeZone({
        location: { id: location.id, timeZone: location.timeZone },
        professionalId,
        fallback: 'UTC',
        requireValid: true,
      })

      if (!tzResult.ok) {
        throwCode('TIMEZONE_REQUIRED')
      }

      const rawResolvedTimeZone =
        typeof tzResult.timeZone === 'string' ? tzResult.timeZone.trim() : ''

      if (!isValidIanaTimeZone(rawResolvedTimeZone)) {
        throwCode('TIMEZONE_REQUIRED')
      }

      const appointmentTimeZone = sanitizeTimeZone(rawResolvedTimeZone, 'UTC')

      const stepMinutes = normalizeStepMinutes(location.stepMinutes, 15)
      const startMinuteOfDay = minutesSinceMidnightInTimeZone(
        requestedStart,
        appointmentTimeZone,
      )

      if (startMinuteOfDay % stepMinutes !== 0) {
        throw new Error(`STEP:${stepMinutes}`)
      }

      const locationBufferMinutes = clampInt(
        Number(location.bufferMinutes ?? 0),
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

      const [offerings, services] = await Promise.all([
        tx.professionalServiceOffering.findMany({
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
        }),
        tx.service.findMany({
          where: { id: { in: serviceIds } },
          select: {
            id: true,
            name: true,
            defaultDurationMinutes: true,
          },
          take: 50,
        }),
      ])

      const offeringByServiceId = new Map(
        offerings.map((offering) => [offering.serviceId, offering]),
      )

      const serviceById = new Map(
        services.map((service) => [service.id, service]),
      )

      for (const serviceId of serviceIds) {
        if (!offeringByServiceId.has(serviceId)) {
          throwCode('MISSING_OFFERING')
        }
        if (!serviceById.has(serviceId)) {
          throwCode('MISSING_SERVICE')
        }
      }

      const items = buildNormalizedBookingItemsFromServiceIds({
        serviceIds,
        locationType,
        stepMinutes,
        offeringByServiceId,
        serviceById,
        errors: {
          missingOffering: 'MISSING_OFFERING',
          missingService: 'MISSING_SERVICE',
          pricingNotSet: 'PRICING_NOT_SET',
          badDuration: 'BAD_DURATION',
        },
      })

      const {
        primaryItem,
        computedDurationMinutes,
        computedSubtotal,
      } = computeBookingItemTotals(items, 'MISSING_SERVICE')

      const totalDurationMinutes =
        requestedTotalDurationMinutes != null &&
        requestedTotalDurationMinutes >= computedDurationMinutes &&
        requestedTotalDurationMinutes <= MAX_SLOT_DURATION_MINUTES
          ? clampInt(
              snapToStepMinutes(requestedTotalDurationMinutes, stepMinutes),
              computedDurationMinutes,
              MAX_SLOT_DURATION_MINUTES,
            )
          : clampInt(
              snapToStepMinutes(
                computedDurationMinutes || DEFAULT_DURATION_MINUTES,
                stepMinutes,
              ),
              stepMinutes,
              MAX_SLOT_DURATION_MINUTES,
            )

      const requestedEnd = addMinutes(
        requestedStart,
        totalDurationMinutes + bufferMinutes,
      )

      if (!allowOutsideWorkingHours) {
        const workingHoursResult = ensureWithinWorkingHours({
          scheduledStartUtc: requestedStart,
          scheduledEndUtc: requestedEnd,
          workingHours: location.workingHours,
          timeZone: appointmentTimeZone,
          fallbackTimeZone: 'UTC',
          messages: {
            missing: 'Working hours are not set yet.',
            outside: 'That time is outside working hours.',
            misconfigured: 'Working hours are misconfigured.',
          },
        })

        if (!workingHoursResult.ok) {
          throw new Error(`WH:${workingHoursResult.error}`)
        }
      }

      await assertTimeRangeAvailable({
        tx,
        professionalId,
        locationId: location.id,
        requestedStart,
        requestedEnd,
        defaultBufferMinutes: bufferMinutes,
        fallbackDurationMinutes: DEFAULT_DURATION_MINUTES,
      })

      const locationAddressSnapshot = buildAddressSnapshot(location.formattedAddress)
      const locationLatSnapshot = decimalToNumber(location.lat)
      const locationLngSnapshot = decimalToNumber(location.lng)

      const clientAddressSnapshot =
        locationType === ServiceLocationType.MOBILE && clientAddress
          ? buildAddressSnapshot(clientAddress.formattedAddress) ?? Prisma.JsonNull
          : Prisma.JsonNull

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
            serviceId: primaryItem.serviceId,
            offeringId: primaryItem.offeringId,
            scheduledFor: requestedStart,
            status: BookingStatus.ACCEPTED,

            locationType,
            locationId: location.id,
            locationTimeZone: appointmentTimeZone,
            locationAddressSnapshot,
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
            subtotalSnapshot: computedSubtotal,
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

      const createdBaseItem = await tx.bookingServiceItem.create({
        data: {
          bookingId: booking.id,
          serviceId: primaryItem.serviceId,
          offeringId: primaryItem.offeringId,
          itemType: BookingServiceItemType.BASE,
          priceSnapshot: primaryItem.priceSnapshot,
          durationMinutesSnapshot: primaryItem.durationMinutesSnapshot,
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
            itemType: BookingServiceItemType.ADD_ON,
            parentItemId: createdBaseItem.id,
            priceSnapshot: item.priceSnapshot,
            durationMinutesSnapshot: item.durationMinutesSnapshot,
            sortOrder: 100 + index,
            notes: 'MANUAL_ADDON',
          })),
        })
      }

      return {
        booking,
        items,
        subtotalSnapshot: computedSubtotal,
        stepMinutes,
        appointmentTimeZone,
        locationId: location.id,
        locationType,
        clientAddressId:
          locationType === ServiceLocationType.MOBILE && clientAddress
            ? clientAddress.id
            : null,
      }
    })

    const endsAt = addMinutes(
      new Date(result.booking.scheduledFor),
      Number(result.booking.totalDurationMinutes) +
        Number(result.booking.bufferMinutes),
    )

    const serviceName =
      result.items.map((item) => item.serviceName).filter(Boolean).join(' + ') ||
      'Appointment'

    return jsonOk(
      {
        booking: {
          id: result.booking.id,
          scheduledFor: new Date(result.booking.scheduledFor).toISOString(),
          endsAt: endsAt.toISOString(),
          totalDurationMinutes: Number(result.booking.totalDurationMinutes),
          bufferMinutes: Number(result.booking.bufferMinutes),
          status: result.booking.status,
          serviceName,
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

    if (message === 'LOCATION_NOT_FOUND') {
      return jsonFail(404, 'Location not found or not bookable.')
    }

    if (message === 'LOCATION_MODE_MISMATCH') {
      return jsonFail(400, 'This location does not support that booking mode.')
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

    if (message === 'PRICING_NOT_SET') {
      return jsonFail(
        409,
        'Pricing is not set for one or more selected services.',
      )
    }

    if (message === 'BAD_DURATION') {
      return jsonFail(
        409,
        'Duration is not set for one or more selected services.',
      )
    }

    if (message === 'TIMEZONE_REQUIRED') {
      return jsonFail(
        400,
        'This location must set a valid timezone before taking bookings.',
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