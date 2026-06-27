// app/api/v1/availability/day/route.ts

import { createHash } from 'node:crypto'

import { ServiceLocationType } from '@prisma/client'

import { jsonFail, jsonOk } from '@/app/api/_utils'
import type { AvailabilityDayOk, AvailabilityOffering } from '@/app/(main)/booking/AvailabilityDrawer/types'
import { resolveDurationWithAddOns } from '@/lib/availability/data/addOnContext'
import { loadBusyIntervals } from '@/lib/availability/data/busyIntervals'
import { buildDayCacheKey } from '@/lib/availability/data/cache'
import {
  loadAvailabilityOfferingContext,
  toAvailabilityOfferingDto,
} from '@/lib/availability/data/offeringContext'
import {
  computeDayBoundsUtc,
  computeDaySlotsFast,
  localSlotToUtcOrNull,
} from '@/lib/availability/core/dayComputation'
import {
  parseYYYYMMDD,
  ymdSerial,
} from '@/lib/availability/core/summaryWindow'
import { parseAvailabilityRequest } from '@/lib/availability/http/parseAvailabilityRequest'
import {
  getScheduleConfigVersion,
  getScheduleVersion,
} from '@/lib/booking/cacheVersion'
import {
  MAX_BUFFER_MINUTES,
  MAX_SLOT_DURATION_MINUTES,
} from '@/lib/booking/constants'
import { addMinutes } from '@/lib/booking/conflicts'
import { utcDateToLocalParts } from '@/lib/booking/dateTime'
import {
  getBookingFailPayload,
  type BookingErrorCode,
} from '@/lib/booking/errors'
import { bookingJsonFail } from '@/app/api/_utils/bookingResponses'
import { normalizeStepMinutes } from '@/lib/booking/locationContext'
import { withVersionedCache } from '@/lib/cache/versionedCache'
import { prismaRead } from '@/lib/prisma'
import { clampInt } from '@/lib/pick'
import { toIntParam as toInt } from '@/lib/queryParams'
import { getWorkingWindowForDay } from '@/lib/scheduling/workingHours'

export const dynamic = 'force-dynamic'

const MAX_LEAD_MINUTES = 30 * 24 * 60
const OCCUPANCY_WINDOW_PADDING_MINUTES =
  MAX_SLOT_DURATION_MINUTES + MAX_BUFFER_MINUTES
const TTL_DAY_SECONDS = 120

type AvailabilityRequestBasePayload = {
  professionalId: string
  serviceId: string
  offeringId: string | null
  locationType: ServiceLocationType
  locationId: string
  clientAddressId: string | null
  addOnIds: string[]
  durationMinutes: number
}

type AvailabilityDayRequestPayload = AvailabilityRequestBasePayload & {
  date: string
}

function resolveDebugClientAddressId(args: {
  locationType: ServiceLocationType
  clientAddressId: string | null
}): string | null {
  return args.locationType === ServiceLocationType.MOBILE
    ? args.clientAddressId
    : null
}

function buildAvailabilityVersion(args: {
  professionalId: string
  serviceId: string
  offeringId: string | null
  locationType: ServiceLocationType
  locationId: string
  clientAddressId: string | null
  addOnIds: string[]
  durationMinutes: number
  scheduleVersion: string | number
  scheduleConfigVersion: string | number
  date: string
}): string {
  const raw = JSON.stringify({
    v: 1,
    scope: 'DAY',
    ...args,
  })

  const digest = createHash('sha256').update(raw).digest('hex')
  return `av:${digest.slice(0, 24)}`
}

function buildDayRequestPayload(args: {
  professionalId: string
  serviceId: string
  offeringId: string
  locationType: ServiceLocationType
  locationId: string
  clientAddressId: string | null
  addOnIds: string[]
  durationMinutes: number
  date: string
}): AvailabilityDayRequestPayload {
  return {
    professionalId: args.professionalId,
    serviceId: args.serviceId,
    offeringId: args.offeringId,
    locationType: args.locationType,
    locationId: args.locationId,
    clientAddressId: args.clientAddressId,
    addOnIds: args.addOnIds.slice(),
    durationMinutes: args.durationMinutes,
    date: args.date,
  }
}

async function resolveRequestedDurationMinutes(args: {
  professionalId: string
  offeringId: string
  addOnIds: string[]
  locationType: ServiceLocationType
  baseDurationMinutes: number
}) {
  if (args.addOnIds.length === 0) {
    return {
      ok: true as const,
      durationMinutes: args.baseDurationMinutes,
    }
  }

  return resolveDurationWithAddOns({
    professionalId: args.professionalId,
    offeringId: args.offeringId,
    addOnIds: args.addOnIds,
    locationType: args.locationType,
    baseDurationMinutes: args.baseDurationMinutes,
    client: prismaRead,
  })
}

export async function GET(req: Request) {
  try {
    const {
      professionalId,
      serviceId,
      clientAddressId,
      requestedLocationType,
      requestedLocationId,
      dateStr,
      addOnIds,
      debug,
      stepRaw,
      leadRaw,
    } = parseAvailabilityRequest(req)

    if (!professionalId || !serviceId) {
      return jsonFail(400, 'Missing professionalId or serviceId.')
    }

    if (!dateStr) {
      return jsonFail(
        400,
        'Missing date. Use /api/v1/availability/bootstrap for drawer bootstrap and /api/v1/availability/day for a specific day.',
      )
    }

    const ymd = parseYYYYMMDD(dateStr)
    if (!ymd) {
      return jsonFail(400, 'Invalid date. Use YYYY-MM-DD.')
    }

    const [scheduleVersion, scheduleConfigVersion] = await Promise.all([
      getScheduleVersion(professionalId),
      getScheduleConfigVersion(professionalId),
    ])

    const baseContext = await loadAvailabilityOfferingContext({
      professionalId,
      serviceId,
      requestedLocationType,
      requestedLocationId,
      clientAddressId,
      scheduleConfigVersion,
      cacheEnabled: !debug,
      client: prismaRead,
    })

    if (!baseContext.ok) {
      if (baseContext.kind === 'NOT_FOUND') {
        return jsonFail(
          404,
          baseContext.entity === 'PROFESSIONAL'
            ? 'Professional not found'
            : 'Service not found',
        )
      }

      return bookingJsonFail(baseContext.code)
    }

    const {
      locationId,
      effectiveLocationType,
      timeZone,
      timeZoneSource,
      workingHours,
      defaultStepMinutes,
      defaultLead,
      locationBufferMinutes,
      maxAdvanceDays,
      durationMinutes: baseDurationMinutes,
      offeringDbId,
      offeringPayload,
    } = baseContext.value

    const resolvedClientAddressId = resolveDebugClientAddressId({
      locationType: effectiveLocationType,
      clientAddressId,
    })

    const stepMinutes =
      debug && stepRaw
        ? normalizeStepMinutes(stepRaw, defaultStepMinutes)
        : defaultStepMinutes

    const leadTimeMinutes =
      debug && leadRaw
        ? clampInt(toInt(leadRaw, defaultLead), 0, MAX_LEAD_MINUTES)
        : defaultLead

    const nowUtc = new Date()
    const nowParts = utcDateToLocalParts(nowUtc, timeZone)
    const todayYMD = {
      year: nowParts.year,
      month: nowParts.month,
      day: nowParts.day,
    }

    const dayDiff = ymdSerial(ymd) - ymdSerial(todayYMD)
    if (dayDiff < 0) {
      return jsonFail(400, 'Date is in the past.')
    }

    if (dayDiff > maxAdvanceDays) {
      return jsonFail(
        400,
        `You can book up to ${maxAdvanceDays} days in advance.`,
      )
    }

    const addOnResult = await resolveRequestedDurationMinutes({
      professionalId,
      offeringId: offeringDbId,
      addOnIds,
      locationType: effectiveLocationType,
      baseDurationMinutes,
    })

    if (!addOnResult.ok) {
      return bookingJsonFail(addOnResult.code, {
        userMessage: 'One or more add-ons are invalid for this offering.',
      })
    }

    const durationMinutes = addOnResult.durationMinutes

    const request = buildDayRequestPayload({
      professionalId,
      serviceId,
      offeringId: offeringDbId,
      locationType: effectiveLocationType,
      locationId,
      clientAddressId: resolvedClientAddressId,
      addOnIds,
      durationMinutes,
      date: dateStr,
    })

    const generatedAt = new Date().toISOString()
    const availabilityVersion = buildAvailabilityVersion({
      professionalId,
      serviceId,
      offeringId: offeringDbId,
      locationType: effectiveLocationType,
      locationId,
      clientAddressId: resolvedClientAddressId,
      addOnIds,
      durationMinutes,
      scheduleVersion,
      scheduleConfigVersion,
      date: dateStr,
    })

    const dayKeyExtra = debug
      ? null
      : buildDayCacheKey({
          professionalId,
          serviceId,
          locationId,
          locationType: effectiveLocationType,
          dateStr,
          timeZone,
          stepMinutes,
          leadTimeMinutes,
          locationBufferMinutes,
          scheduleVersion,
          scheduleConfigVersion,
          addOnIds,
          durationMinutes,
          clientAddressId: resolvedClientAddressId,
        })

    type DaySuccessPayload = {
      ok: true
      mode: 'DAY'
      availabilityVersion: string
      generatedAt: string
      request: AvailabilityDayRequestPayload
      professionalId: string
      serviceId: string
      locationType: ServiceLocationType
      date: string
      locationId: string
      timeZone: string
      timeZoneSource: typeof timeZoneSource
      stepMinutes: number
      leadTimeMinutes: number
      locationBufferMinutes: number
      adjacencyBufferMinutes: number
      maxDaysAhead: number
      durationMinutes: number
      dayStartUtc: string
      dayEndExclusiveUtc: string
      slots: string[]
      offering: AvailabilityOffering
      debug?: unknown
    }

    type DayLoaderResult =
      | { kind: 'ok'; payload: DaySuccessPayload }
      | {
          kind: 'fail'
          code: BookingErrorCode
          debug?: unknown
        }

    const computeDayPayload = async (): Promise<DayLoaderResult> => {
      const bounds = computeDayBoundsUtc(ymd, timeZone)

      const dayAnchorUtc =
        localSlotToUtcOrNull({
          year: ymd.year,
          month: ymd.month,
          day: ymd.day,
          hour: 12,
          minute: 0,
          timeZone,
        }) ?? new Date(bounds.dayStartUtc.getTime() + 12 * 60 * 60 * 1000)

      const windowForLoad = getWorkingWindowForDay(
        dayAnchorUtc,
        workingHours,
        timeZone,
      )

      const windowStartUtc = addMinutes(
        bounds.dayStartUtc,
        -OCCUPANCY_WINDOW_PADDING_MINUTES,
      )

      const windowEndUtc = addMinutes(
        bounds.dayStartUtc,
        (windowForLoad.ok ? windowForLoad.endMinutes : 1440) +
          OCCUPANCY_WINDOW_PADDING_MINUTES,
      )

      const busy = await loadBusyIntervals({
        professionalId,
        locationId,
        windowStartUtc,
        windowEndUtc,
        nowUtc,
        fallbackDurationMinutes: durationMinutes,
        locationBufferMinutes,
        scheduleVersion,
        cache: { enabled: !debug },
        client: prismaRead,
      })

      const result = await computeDaySlotsFast({
        dateYMD: ymd,
        durationMinutes,
        stepMinutes,
        timeZone,
        workingHours,
        leadTimeMinutes,
        locationBufferMinutes,
        maxAdvanceDays,
        busy,
        debug,
      })

      if (!result.ok) {
        return {
          kind: 'fail',
          code: result.code,
          debug: result.debug,
        }
      }

      return {
        kind: 'ok',
        payload: {
          ok: true,
          mode: 'DAY',
          availabilityVersion,
          generatedAt,
          request,

          professionalId,
          serviceId,
          locationType: effectiveLocationType,
          date: dateStr,

          locationId,
          timeZone,
          timeZoneSource,
          stepMinutes,
          leadTimeMinutes,
          locationBufferMinutes,
          adjacencyBufferMinutes: locationBufferMinutes,
          maxDaysAhead: maxAdvanceDays,

          durationMinutes,
          dayStartUtc: result.dayStartUtc.toISOString(),
          dayEndExclusiveUtc: result.dayEndExclusiveUtc.toISOString(),
          slots: result.slots,

          offering: toAvailabilityOfferingDto(offeringPayload),
          ...(debug ? { debug: result.debug } : {}),
        },
      }
    }

    const loaderResult: DayLoaderResult = dayKeyExtra
      ? (
          await withVersionedCache(
            {
              scope: 'availability:day',
              scopeId: professionalId,
              version: scheduleConfigVersion,
              extra: dayKeyExtra,
            },
            computeDayPayload,
            TTL_DAY_SECONDS,
          )
        ).value
      : await computeDayPayload()

    if (loaderResult.kind === 'fail') {
      const fail = getBookingFailPayload(loaderResult.code)
      return jsonFail(fail.httpStatus, fail.userMessage, {
        ...fail.extra,
        locationId,
        timeZone,
        timeZoneSource,
        stepMinutes,
        leadTimeMinutes,
        locationBufferMinutes,
        maxDaysAhead: maxAdvanceDays,
        ...(debug ? { debug: loaderResult.debug } : {}),
      })
    }

    return jsonOk(loaderResult.payload satisfies AvailabilityDayOk)
  } catch (err: unknown) {
    console.error('GET /api/v1/availability/day error', err)

    return bookingJsonFail('INTERNAL_ERROR', {
      message:
        err instanceof Error ? err.message : 'Failed to load availability.',
      userMessage: 'Failed to load availability.',
    })
  }
}