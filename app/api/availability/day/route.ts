// app/api/availability/day/route.ts

import { ServiceLocationType } from '@prisma/client'

import { jsonFail, jsonOk } from '@/app/api/_utils'
import {
  buildDayCacheKey,
  buildSummaryCacheKey,
  cacheGetJson,
  cacheSetJson,
} from '@/lib/availability/data/cache'
import { loadAvailabilityOfferingContext } from '@/lib/availability/data/offeringContext'
import { loadBusyIntervals } from '@/lib/availability/data/busyIntervals'
import { loadOtherProsNearbyCached, type OtherProRow } from '@/lib/availability/data/otherPros'
import {
  computeDayBoundsUtc,
  computeDaySlotsFast,
  localSlotToUtcOrNull,
} from '@/lib/availability/core/dayComputation'
import {
  buildSummaryYMDs,
  parseSummaryWindowDays,
  parseYYYYMMDD,
  resolveSummaryWindowStart,
  ymdSerial,
  ymdToString,
} from '@/lib/availability/core/summaryWindow'
import { resolveDurationWithAddOns } from '@/lib/availability/data/addOnContext'
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
import { normalizeStepMinutes } from '@/lib/booking/locationContext'
import { isRecord } from '@/lib/guards'
import { clampInt } from '@/lib/pick'
import { getWorkingWindowForDay } from '@/lib/scheduling/workingHours'

export const dynamic = 'force-dynamic'

const MAX_LEAD_MINUTES = 30 * 24 * 60
const OCCUPANCY_WINDOW_PADDING_MINUTES =
  MAX_SLOT_DURATION_MINUTES + MAX_BUFFER_MINUTES

const TTL_DAY_SECONDS = 120
const TTL_SUMMARY_SECONDS = 120

function bookingJsonFail(
  code: BookingErrorCode,
  overrides?: {
    message?: string
    userMessage?: string
  },
  extra?: Record<string, unknown>,
) {
  const fail = getBookingFailPayload(code, overrides)
  return jsonFail(fail.httpStatus, fail.userMessage, {
    ...fail.extra,
    ...(extra ?? {}),
  })
}

function toInt(value: string | null, fallback: number): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? Math.trunc(parsed) : fallback
}

function resolveDebugClientAddressId(args: {
  locationType: ServiceLocationType
  clientAddressId: string | null
}): string | null {
  return args.locationType === ServiceLocationType.MOBILE
    ? args.clientAddressId
    : null
}

function isSummaryCacheHit(value: unknown): value is Record<string, unknown> {
  return isRecord(value) && value.ok === true && value.mode === 'SUMMARY'
}

function isDayCacheHit(value: unknown): value is Record<string, unknown> {
  return isRecord(value) && value.ok === true && value.mode === 'DAY'
}

export async function GET(req: Request) {
  try {
    const {
      professionalId,
      serviceId,
      mediaId,
      clientAddressId,
      requestedLocationType,
      requestedLocationId,
      dateStr,
      startDateStr,
      requestedSummaryDaysRaw,
      addOnIds,
      debug,
      includeOtherPros,
      stepRaw,
      leadRaw,
      viewerLat,
      viewerLng,
      radiusMiles,
    } = parseAvailabilityRequest(req)

    if (!professionalId || !serviceId) {
      return jsonFail(400, 'Missing professionalId or serviceId.')
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

    let {
      locationId,
      effectiveLocationType,
      timeZone,
      timeZoneSource,
      workingHours,
      defaultStepMinutes,
      defaultLead,
      locationBufferMinutes,
      maxAdvanceDays,
      durationMinutes,
      placementLat,
      placementLng,
      proBusinessName,
      proAvatarUrl,
      proLocation,
      serviceName,
      serviceCategoryName,
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

    const addOnResult = await resolveDurationWithAddOns({
      professionalId,
      offeringId: offeringDbId,
      addOnIds,
      locationType: effectiveLocationType,
      baseDurationMinutes: durationMinutes,
    })

    if (!addOnResult.ok) {
      return bookingJsonFail(addOnResult.code, {
        userMessage: 'One or more add-ons are invalid for this offering.',
      })
    }

    durationMinutes = addOnResult.durationMinutes

    const nowUtc = new Date()
    const nowParts = utcDateToLocalParts(nowUtc, timeZone)
    const todayYMD = {
      year: nowParts.year,
      month: nowParts.month,
      day: nowParts.day,
    }

    if (!dateStr) {
      const startResult = resolveSummaryWindowStart({
        startDateStr,
        todayYMD,
        maxAdvanceDays,
      })

      if (!startResult.ok) {
        return jsonFail(400, startResult.error)
      }

      const requestedSummaryDays = parseSummaryWindowDays(
        requestedSummaryDaysRaw,
        maxAdvanceDays,
      )

      const summaryWindow = buildSummaryYMDs({
        startYMD: startResult.startYMD,
        startDayOffset: startResult.startDayOffset,
        requestedDays: requestedSummaryDays,
        maxAdvanceDays,
      })

      const windowStartDate = startResult.startDateStr
      const windowEndDate = ymdToString(summaryWindow.endYMD)
      const nextStartDate = summaryWindow.nextStartYMD
        ? ymdToString(summaryWindow.nextStartYMD)
        : null

      const summaryCacheKey = debug
        ? null
        : buildSummaryCacheKey({
            professionalId,
            serviceId,
            locationId,
            locationType: effectiveLocationType,
            timeZone,
            windowStartDate,
            windowEndDate,
            windowDays: summaryWindow.windowDays,
            stepMinutes,
            leadTimeMinutes,
            locationBufferMinutes,
            maxAdvanceDays,
            includeOtherPros,
            scheduleVersion,
            scheduleConfigVersion,
            addOnIds,
            viewerLat,
            viewerLng,
            radiusMiles,
            clientAddressId: resolvedClientAddressId,
          })

      if (summaryCacheKey) {
        const hit = await cacheGetJson<unknown>(summaryCacheKey)
        if (isSummaryCacheHit(hit)) {
          return jsonOk({
            ...hit,
            mediaId: mediaId || null,
          })
        }
      }

      const ymds = summaryWindow.ymds
      const firstBounds = computeDayBoundsUtc(ymds[0] ?? todayYMD, timeZone)
      const lastBounds = computeDayBoundsUtc(
        ymds[ymds.length - 1] ?? todayYMD,
        timeZone,
      )

      const windowStartUtc = addMinutes(
        firstBounds.dayStartUtc,
        -OCCUPANCY_WINDOW_PADDING_MINUTES,
      )
      const windowEndUtc = addMinutes(
        lastBounds.dayEndExclusiveUtc,
        OCCUPANCY_WINDOW_PADDING_MINUTES,
      )

      const hasViewer =
        typeof viewerLat === 'number' && typeof viewerLng === 'number'
      const centerLat = hasViewer ? viewerLat : placementLat
      const centerLng = hasViewer ? viewerLng : placementLng

      const [busy, otherPros] = await Promise.all([
        loadBusyIntervals({
          professionalId,
          locationId,
          windowStartUtc,
          windowEndUtc,
          nowUtc,
          fallbackDurationMinutes: durationMinutes,
          locationBufferMinutes,
          scheduleVersion,
          cache: { enabled: !debug },
        }),
        includeOtherPros && centerLat != null && centerLng != null
          ? loadOtherProsNearbyCached({
              centerLat,
              centerLng,
              radiusMiles,
              serviceId,
              locationType: effectiveLocationType,
              excludeProfessionalId: professionalId,
              limit: 6,
              cacheEnabled: !debug,
            })
          : Promise.resolve([] as OtherProRow[]),
      ])

      const dayResults = await Promise.all(
        ymds.map(async (ymd) => {
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
            debug: false,
          })

          return { ymd, result }
        }),
      )

      const availableDays: Array<{ date: string; slotCount: number }> = []
      let firstErrorCode: BookingErrorCode | null = null
      let firstDaySlots: string[] = []

      for (const row of dayResults) {
        if (!row.result.ok) {
          firstErrorCode = firstErrorCode ?? row.result.code
          continue
        }

        if (row.result.slots.length > 0) {
          availableDays.push({
            date: ymdToString(row.ymd),
            slotCount: row.result.slots.length,
          })

          if (firstDaySlots.length === 0) {
            firstDaySlots = row.result.slots.slice()
          }
        }
      }

      const payload = {
        ok: true,
        mode: 'SUMMARY' as const,
        mediaId: mediaId || null,
        serviceId,
        professionalId,

        serviceName,
        serviceCategoryName,

        locationType: effectiveLocationType,
        locationId,
        timeZone,
        timeZoneSource,

        stepMinutes,
        leadTimeMinutes,
        locationBufferMinutes,
        adjacencyBufferMinutes: locationBufferMinutes,
        maxDaysAhead: maxAdvanceDays,
        durationMinutes,

        windowStartDate,
        windowEndDate,
        nextStartDate,
        hasMoreDays: summaryWindow.hasMoreDays,

        primaryPro: {
          id: professionalId,
          businessName: proBusinessName,
          avatarUrl: proAvatarUrl,
          location: proLocation,
          offeringId: offeringDbId,
          isCreator: true as const,
          timeZone,
          timeZoneSource,
          locationId,
        },

        availableDays,
        firstDaySlots,
        otherPros,
        waitlistSupported: true,
        offering: offeringPayload,

        ...(debug
          ? {
              debug: {
                emptyReasonCode: !availableDays.length ? firstErrorCode : null,
                otherProsCount: otherPros.length,
                includeOtherPros,
                center:
                  centerLat != null && centerLng != null
                    ? { lat: centerLat, lng: centerLng, radiusMiles }
                    : null,
                usedViewerCenter: Boolean(hasViewer),
                addOnIds,
                clientAddressId: resolvedClientAddressId,
                requestedSummaryDays,
              },
            }
          : {}),
      }

      if (summaryCacheKey) {
        void cacheSetJson(
          summaryCacheKey,
          { ...payload, mediaId: null },
          TTL_SUMMARY_SECONDS,
        )
      }

      return jsonOk(payload)
    }

    const ymd = parseYYYYMMDD(dateStr)
    if (!ymd) {
      return jsonFail(400, 'Invalid date. Use YYYY-MM-DD.')
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

    const dayCacheKey = debug
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

    if (dayCacheKey) {
      const hit = await cacheGetJson<unknown>(dayCacheKey)
      if (isDayCacheHit(hit)) {
        return jsonOk(hit)
      }
    }

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
      return bookingJsonFail(result.code, undefined, {
        locationId,
        timeZone,
        timeZoneSource,
        stepMinutes,
        leadTimeMinutes,
        locationBufferMinutes,
        maxDaysAhead: maxAdvanceDays,
        ...(debug ? { debug: result.debug } : {}),
      })
    }

    const payload = {
      ok: true,
      mode: 'DAY' as const,
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

      offering: offeringPayload,
      ...(debug
        ? {
            debug: result.debug,
            addOnIds,
            clientAddressId: resolvedClientAddressId,
          }
        : {}),
    }

    if (dayCacheKey) {
      void cacheSetJson(dayCacheKey, payload, TTL_DAY_SECONDS)
    }

    return jsonOk(payload)
  } catch (err: unknown) {
    console.error('GET /api/availability/day error', err)
    return bookingJsonFail('INTERNAL_ERROR', {
      message:
        err instanceof Error ? err.message : 'Failed to load availability.',
      userMessage: 'Failed to load availability.',
    })
  }
}