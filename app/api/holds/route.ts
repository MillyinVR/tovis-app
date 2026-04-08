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

type ParsedHoldRequest = {
  offeringId: string
  requestedLocationId: string | null
  clientAddressId: string | null
  locationType: ServiceLocationType
  requestedStart: Date
}

type HeaderCarrier = {
  headers?: Headers | null
}

function isValidDate(value: Date): boolean {
  return value instanceof Date && Number.isFinite(value.getTime())
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

function getMutableHeaders(target: HeaderCarrier): Headers {
  if (target.headers instanceof Headers) {
    return target.headers
  }

  const headers = new Headers()

  Object.defineProperty(target, 'headers', {
    value: headers,
    configurable: true,
    enumerable: true,
    writable: true,
  })

  return headers
}

function withServerTiming<T extends Response | HeaderCarrier>(
  response: T,
  metrics: Array<{ name: string; durationMs: number }>,
): T {
  const headers = getMutableHeaders(response)

  headers.set(
    'Server-Timing',
    metrics
      .map((metric) =>
        formatServerTimingMetric(metric.name, metric.durationMs),
      )
      .join(', '),
  )
  headers.set('Cache-Control', 'no-store')

  return response
}

function parseHoldCreateBody(rawBody: unknown): ParsedHoldRequest | Response {
  if (!isRecord(rawBody)) {
    return jsonFail(400, 'Request body must be a JSON object.')
  }

  const offeringId = pickString(rawBody.offeringId)
  const requestedLocationId = pickString(rawBody.locationId)
  const clientAddressId = pickString(rawBody.clientAddressId)
  const locationType = normalizeLocationType(rawBody.locationType)
  const scheduledForRaw = pickString(rawBody.scheduledFor)

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

  if (locationType === ServiceLocationType.MOBILE && !clientAddressId) {
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

  return {
    offeringId,
    requestedLocationId,
    clientAddressId,
    locationType,
    requestedStart,
  }
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
    const auth = await requireClient()

    if (!auth.ok) {
      afterAuthAndBodyMs = nowMs()
      afterOfferingLookupMs = afterAuthAndBodyMs
      afterCreateHoldMs = afterAuthAndBodyMs
      return withServerTiming(auth.res, buildServerTimingMetrics())
    }

    let rawBody: unknown
    try {
      rawBody = await req.json()
    } catch {
      afterAuthAndBodyMs = nowMs()
      afterOfferingLookupMs = afterAuthAndBodyMs
      afterCreateHoldMs = afterAuthAndBodyMs

      return withServerTiming(
        jsonFail(400, 'Invalid JSON body.'),
        buildServerTimingMetrics(),
      )
    }

    const parsed = parseHoldCreateBody(rawBody)

    afterAuthAndBodyMs = nowMs()
    afterOfferingLookupMs = afterAuthAndBodyMs
    afterCreateHoldMs = afterAuthAndBodyMs

    if (parsed instanceof Response) {
      return withServerTiming(parsed, buildServerTimingMetrics())
    }

    const offering = await prisma.professionalServiceOffering.findUnique({
      where: { id: parsed.offeringId },
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
      clientId: auth.clientId,
      offering: toCreateHoldOffering(offering),
      requestedStart: parsed.requestedStart,
      requestedLocationId: parsed.requestedLocationId,
      locationType: parsed.locationType,
      clientAddressId: parsed.clientAddressId,
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