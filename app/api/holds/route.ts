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

function nowMs(): number {
  return typeof performance !== 'undefined' &&
    typeof performance.now === 'function'
    ? performance.now()
    : Date.now()
}

function formatServerTimingMetric(name: string, durationMs: number): string {
  return `${name};dur=${Math.max(0, durationMs).toFixed(1)}`
}

function withServerTiming<T extends Response>(
  response: T,
  metrics: Array<{ name: string; durationMs: number }>,
): T {
  response.headers.set(
    'Server-Timing',
    metrics
      .map((metric) =>
        formatServerTimingMetric(metric.name, metric.durationMs),
      )
      .join(', '),
  )
  return response
}

export async function POST(req: NextRequest) {
  const startedAtMs = nowMs()

  let afterAuthAndBodyMs = startedAtMs
  let afterOfferingLookupMs = startedAtMs
  let afterCreateHoldMs = startedAtMs

  const buildServerTimingMetrics = () => [
    {
      name: 'hold_total',
      durationMs: nowMs() - startedAtMs,
    },
    {
      name: 'hold_auth_body',
      durationMs: afterAuthAndBodyMs - startedAtMs,
    },
    {
      name: 'hold_offering_lookup',
      durationMs: afterOfferingLookupMs - afterAuthAndBodyMs,
    },
    {
      name: 'hold_create',
      durationMs: afterCreateHoldMs - afterOfferingLookupMs,
    },
  ]

  try {
    const [auth, rawBody] = await Promise.all([
      requireClient(),
      req.json().catch(() => ({})),
    ])

    afterAuthAndBodyMs = nowMs()
    afterOfferingLookupMs = afterAuthAndBodyMs
    afterCreateHoldMs = afterAuthAndBodyMs

    if (!auth.ok) {
      return withServerTiming(auth.res, buildServerTimingMetrics())
    }

    const clientId = auth.clientId
    const body = isRecord(rawBody) ? rawBody : {}

    const offeringId = pickString(body.offeringId)
    const requestedLocationId = pickString(body.locationId)
    const clientAddressId = pickString(body.clientAddressId)
    const locationType = normalizeLocationType(body.locationType)
    const scheduledForRaw = pickString(body.scheduledFor)

    if (!offeringId) {
      return withServerTiming(
        bookingJsonFail('OFFERING_ID_REQUIRED'),
        buildServerTimingMetrics(),
      )
    }

    if (!scheduledForRaw) {
      return withServerTiming(
        bookingJsonFail('INVALID_SCHEDULED_FOR', {
          message: 'Scheduled time is required.',
          userMessage: 'Missing scheduled time.',
        }),
        buildServerTimingMetrics(),
      )
    }

    if (!locationType) {
      return withServerTiming(
        bookingJsonFail('LOCATION_TYPE_REQUIRED'),
        buildServerTimingMetrics(),
      )
    }

    if (
      locationType === ServiceLocationType.MOBILE &&
      !clientAddressId
    ) {
      return withServerTiming(
        bookingJsonFail('CLIENT_SERVICE_ADDRESS_REQUIRED'),
        buildServerTimingMetrics(),
      )
    }

    const scheduledForParsed = new Date(scheduledForRaw)
    if (!isValidDate(scheduledForParsed)) {
      return withServerTiming(
        bookingJsonFail('INVALID_SCHEDULED_FOR'),
        buildServerTimingMetrics(),
      )
    }

    const requestedStart = normalizeToMinute(scheduledForParsed)

    if (requestedStart.getTime() < Date.now() + 60_000) {
      return withServerTiming(
        bookingJsonFail('TIME_IN_PAST'),
        buildServerTimingMetrics(),
      )
    }

    const offering = await prisma.professionalServiceOffering.findUnique({
      where: { id: offeringId },
      select: HOLD_CREATE_OFFERING_SELECT,
    })

    afterOfferingLookupMs = nowMs()
    afterCreateHoldMs = afterOfferingLookupMs

    if (!offering || !offering.isActive) {
      return withServerTiming(
        bookingJsonFail('OFFERING_NOT_FOUND'),
        buildServerTimingMetrics(),
      )
    }

    const result = await createHold({
      clientId,
      offering: toCreateHoldOffering(offering),
      requestedStart,
      requestedLocationId,
      locationType,
      clientAddressId,
    })

    afterCreateHoldMs = nowMs()

    return withServerTiming(
      jsonOk(
        {
          hold: result.hold,
          meta: result.meta,
        },
        201,
      ),
      buildServerTimingMetrics(),
    )
  } catch (error: unknown) {
    afterCreateHoldMs = nowMs()

    if (isBookingError(error)) {
      return withServerTiming(
        bookingJsonFail(error.code, {
          message: error.message,
          userMessage: error.userMessage,
        }),
        buildServerTimingMetrics(),
      )
    }

    console.error('POST /api/holds error', error)
    return withServerTiming(
      bookingJsonFail('INTERNAL_ERROR'),
      buildServerTimingMetrics(),
    )
  }
}