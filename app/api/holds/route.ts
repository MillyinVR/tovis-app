// app/api/holds/route.ts
import { NextRequest } from 'next/server'
import { Prisma, ServiceLocationType } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { jsonFail, jsonOk, pickString, requireClient } from '@/app/api/_utils'
import { isRecord } from '@/lib/guards'
import { normalizeToMinute } from '@/lib/booking/conflicts'
import { normalizeLocationType } from '@/lib/booking/locationContext'
import {
  getBookingFailPayload,
  isBookingError,
  type BookingErrorCode,
} from '@/lib/booking/errors'
import { createHold } from '@/lib/booking/writeBoundary'

export const dynamic = 'force-dynamic'

const HOLD_CREATE_OFFERING_SELECT = {
  id: true,
  isActive: true,
  professionalId: true,
  offersInSalon: true,
  offersMobile: true,
  salonDurationMinutes: true,
  mobileDurationMinutes: true,
  salonPriceStartingAt: true,
  mobilePriceStartingAt: true,
  professional: {
    select: {
      timeZone: true,
    },
  },
} satisfies Prisma.ProfessionalServiceOfferingSelect

type HoldCreateOfferingRecord = Prisma.ProfessionalServiceOfferingGetPayload<{
  select: typeof HOLD_CREATE_OFFERING_SELECT
}>

function isValidDate(date: Date): boolean {
  return date instanceof Date && Number.isFinite(date.getTime())
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

function toCreateHoldOffering(
  offering: HoldCreateOfferingRecord,
): {
  id: string
  professionalId: string
  offersInSalon: boolean
  offersMobile: boolean
  salonDurationMinutes: number | null
  mobileDurationMinutes: number | null
  salonPriceStartingAt: Prisma.Decimal | null
  mobilePriceStartingAt: Prisma.Decimal | null
  professionalTimeZone: string | null
} {
  return {
    id: offering.id,
    professionalId: offering.professionalId,
    offersInSalon: offering.offersInSalon,
    offersMobile: offering.offersMobile,
    salonDurationMinutes: offering.salonDurationMinutes,
    mobileDurationMinutes: offering.mobileDurationMinutes,
    salonPriceStartingAt: offering.salonPriceStartingAt,
    mobilePriceStartingAt: offering.mobilePriceStartingAt,
    professionalTimeZone: offering.professional?.timeZone ?? null,
  }
}

export async function POST(req: NextRequest) {
  try {
    const auth = await requireClient()
    if (!auth.ok) return auth.res

    const clientId = auth.clientId

    const rawBody: unknown = await req.json().catch(() => ({}))
    const body = isRecord(rawBody) ? rawBody : {}

    const offeringId = pickString(body.offeringId)
    const requestedLocationId = pickString(body.locationId)
    const clientAddressId = pickString(body.clientAddressId)
    const locationType = normalizeLocationType(body.locationType)
    const scheduledForRaw = pickString(body.scheduledFor)

    if (!offeringId) {
      return bookingJsonFail('OFFERING_ID_REQUIRED')
    }

    if (!scheduledForRaw) {
      return bookingJsonFail('INVALID_SCHEDULED_FOR', {
        message: 'Scheduled time is required.',
        userMessage: 'Missing scheduled time.',
      })
    }

    if (!locationType) {
      return bookingJsonFail('LOCATION_TYPE_REQUIRED')
    }

    if (
      locationType === ServiceLocationType.MOBILE &&
      !clientAddressId
    ) {
      return bookingJsonFail('CLIENT_SERVICE_ADDRESS_REQUIRED')
    }

    const scheduledForParsed = new Date(scheduledForRaw)
    if (!isValidDate(scheduledForParsed)) {
      return bookingJsonFail('INVALID_SCHEDULED_FOR')
    }

    const requestedStart = normalizeToMinute(scheduledForParsed)

    if (requestedStart.getTime() < Date.now() + 60_000) {
      return bookingJsonFail('TIME_IN_PAST')
    }

    const offering = await prisma.professionalServiceOffering.findUnique({
      where: { id: offeringId },
      select: HOLD_CREATE_OFFERING_SELECT,
    })

    if (!offering || !offering.isActive) {
      return bookingJsonFail('OFFERING_NOT_FOUND')
    }

    const result = await createHold({
      clientId,
      offering: toCreateHoldOffering(offering),
      requestedStart,
      requestedLocationId,
      locationType,
      clientAddressId,
    })

    return jsonOk(
      {
        hold: result.hold,
        meta: result.meta,
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

    console.error('POST /api/holds error', error)
    return bookingJsonFail('INTERNAL_ERROR')
  }
}