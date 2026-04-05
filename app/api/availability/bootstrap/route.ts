// app/api/availability/bootstrap/route.ts

import { createHash } from 'node:crypto'

import { ServiceLocationType } from '@prisma/client'

import { jsonFail, jsonOk } from '@/app/api/_utils'
import {
  buildSummaryCacheKey,
  cacheGetJson,
  cacheSetJson,
} from '@/lib/availability/data/cache'
import { resolveDurationWithAddOns } from '@/lib/availability/data/addOnContext'
import { loadBusyIntervals } from '@/lib/availability/data/busyIntervals'
import { loadAvailabilityOfferingContext } from '@/lib/availability/data/offeringContext'
import {
  loadOtherProsNearbyCached,
  type OtherProRow,
} from '@/lib/availability/data/otherPros'
import {
  computeDayBoundsUtc,
  computeDaySlotsFast,
} from '@/lib/availability/core/dayComputation'
import {
  buildSummaryYMDs,
  parseSummaryWindowDays,
  resolveSummaryWindowStart,
  ymdToString,
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
import { normalizeStepMinutes } from '@/lib/booking/locationContext'
import { isRecord } from '@/lib/guards'
import { clampInt } from '@/lib/pick'

export const dynamic = 'force-dynamic'

const MAX_LEAD_MINUTES = 30 * 24 * 60
const OCCUPANCY_WINDOW_PADDING_MINUTES =
  MAX_SLOT_DURATION_MINUTES + MAX_BUFFER_MINUTES

const TTL_BOOTSTRAP_SECONDS = 120

type TimerMap = Record<string, number>

type SummarySeededDay = {
  date: string
  slots: string[]
}

type SummaryAvailableDay = {
  date: string
  slotCount: number
}

type AvailabilityBootstrapRequestPayload = {
  professionalId: string
  serviceId: string
  offeringId: string | null
  locationType: ServiceLocationType
  locationId: string
  clientAddressId: string | null
  addOnIds: string[]
  durationMinutes: number
}

function markTimer(timers: TimerMap, label: string): void {
  timers[label] = performance.now()
}

function markInstantSection(timers: TimerMap, name: string): void {
  const now = performance.now()
  timers[`${name}:start`] = now
  timers[`${name}:end`] = now
}

function measureMs(
  timers: TimerMap,
  startLabel: string,
  endLabel: string,
): number {
  const start = timers[startLabel]
  const end = timers[endLabel]

  if (!Number.isFinite(start) || !Number.isFinite(end)) return 0
  return Math.max(0, end - start)
}

function buildServerTimingHeader(timers: TimerMap): string {
  const parts: Array<[string, number]> = [
    ['versions', measureMs(timers, 'versions:start', 'versions:end')],
    ['context', measureMs(timers, 'context:start', 'context:end')],
    ['addons', measureMs(timers, 'addons:start', 'addons:end')],
    ['busy', measureMs(timers, 'busy:start', 'busy:end')],
    ['otherpros', measureMs(timers, 'otherpros:start', 'otherpros:end')],
    ['slots', measureMs(timers, 'slots:start', 'slots:end')],
    ['total', measureMs(timers, 'total:start', 'total:end')],
  ]

  return parts
    .map(([name, duration]) => `${name};dur=${duration.toFixed(1)}`)
    .join(', ')
}

function withServerTiming(response: Response, timers: TimerMap): Response {
  response.headers.set('Server-Timing', buildServerTimingHeader(timers))
  return response
}

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

function pickString(x: unknown): string | null {
  return typeof x === 'string' && x.trim() ? x.trim() : null
}

function pickNumber(x: unknown): number | null {
  return typeof x === 'number' && Number.isFinite(x) ? x : null
}

function pickStringArray(x: unknown): string[] | null {
  if (!Array.isArray(x)) return null
  if (!x.every((value) => typeof value === 'string')) return null
  return x.slice()
}

function resolveDebugClientAddressId(args: {
  locationType: ServiceLocationType
  clientAddressId: string | null
}): string | null {
  return args.locationType === ServiceLocationType.MOBILE
    ? args.clientAddressId
    : null
}

function isBootstrapCacheHit(value: unknown): value is Record<string, unknown> {
  return (
    isRecord(value) &&
    value.ok === true &&
    (value.mode === 'BOOTSTRAP' || value.mode === 'SUMMARY')
  )
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
  windowStartDate: string
  windowEndDate: string
  includeOtherPros: boolean
  viewerLat?: number | null
  viewerLng?: number | null
  radiusMiles?: number | null
}) {
  const raw = JSON.stringify({
    v: 1,
    scope: 'BOOTSTRAP',
    ...args,
  })

  const digest = createHash('sha256').update(raw).digest('hex')
  return `av:${digest.slice(0, 24)}`
}

function buildBootstrapRequestPayload(args: {
  professionalId: string
  serviceId: string
  offeringId: string
  locationType: ServiceLocationType
  locationId: string
  clientAddressId: string | null
  addOnIds: string[]
  durationMinutes: number
}): AvailabilityBootstrapRequestPayload {
  return {
    professionalId: args.professionalId,
    serviceId: args.serviceId,
    offeringId: args.offeringId,
    locationType: args.locationType,
    locationId: args.locationId,
    clientAddressId: args.clientAddressId,
    addOnIds: args.addOnIds.slice(),
    durationMinutes: args.durationMinutes,
  }
}

function pickSeededDay(x: unknown): SummarySeededDay | null {
  if (!isRecord(x)) return null

  const date = pickString(x.date)
  const slots = pickStringArray(x.slots)

  if (!date || !slots) return null

  return {
    date,
    slots,
  }
}

function pickAvailableDays(x: unknown): SummaryAvailableDay[] {
  if (!Array.isArray(x)) return []

  const normalized: SummaryAvailableDay[] = []

  for (const row of x) {
    if (!isRecord(row)) continue

    const date = pickString(row.date)
    const slotCount = pickNumber(row.slotCount)

    if (!date) continue
    if (slotCount == null || slotCount <= 0) continue

    normalized.push({
      date,
      slotCount: Math.trunc(slotCount),
    })
  }

  return normalized
}

function resolveSelectedDay(args: {
  availableDays: SummaryAvailableDay[]
  todayDate: string
  todaySelectedDay: SummarySeededDay | null
  firstAvailableSelectedDay: SummarySeededDay | null
}): SummarySeededDay | null {
  const todayExists = args.availableDays.some(
    (day) => day.date === args.todayDate,
  )

  if (todayExists && args.todaySelectedDay) {
    return {
      date: args.todaySelectedDay.date,
      slots: args.todaySelectedDay.slots.slice(),
    }
  }

  if (args.firstAvailableSelectedDay) {
    return {
      date: args.firstAvailableSelectedDay.date,
      slots: args.firstAvailableSelectedDay.slots.slice(),
    }
  }

  return null
}

function deriveSelectedDayFromCachedBootstrap(args: {
  cached: Record<string, unknown>
  availableDays: SummaryAvailableDay[]
  todayDate: string
}): SummarySeededDay | null {
  const selectedDay = pickSeededDay(args.cached.selectedDay)
  if (
    selectedDay &&
    selectedDay.slots.length > 0 &&
    args.availableDays.some((day) => day.date === selectedDay.date)
  ) {
    return selectedDay
  }

  const legacyInitialSelectedDay = pickSeededDay(args.cached.initialSelectedDay)
  if (
    legacyInitialSelectedDay &&
    legacyInitialSelectedDay.slots.length > 0 &&
    args.availableDays.some(
      (day) => day.date === legacyInitialSelectedDay.date,
    )
  ) {
    return legacyInitialSelectedDay
  }

  const firstDaySlots = pickStringArray(args.cached.firstDaySlots)
  if (firstDaySlots && firstDaySlots.length > 0) {
    const todayDay = args.availableDays.find(
      (day) => day.date === args.todayDate,
    )
    const fallbackDay = todayDay ?? args.availableDays[0]

    if (fallbackDay) {
      return {
        date: fallbackDay.date,
        slots: firstDaySlots.slice(),
      }
    }
  }

  return null
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
  })
}

function normalizeBootstrapCacheHit(args: {
  cached: Record<string, unknown>
  mediaId: string | null
  request: AvailabilityBootstrapRequestPayload
  availabilityVersion: string
  generatedAt: string
  todayDate: string
}) {
  const availableDays = pickAvailableDays(args.cached.availableDays)

  const selectedDay =
    deriveSelectedDayFromCachedBootstrap({
      cached: args.cached,
      availableDays,
      todayDate: args.todayDate,
    }) ?? null

  return {
    ...args.cached,
    ok: true as const,
    mode: 'BOOTSTRAP' as const,
    mediaId: args.mediaId,
    request: isRecord(args.cached.request) ? args.cached.request : args.request,
    availabilityVersion:
      pickString(args.cached.availabilityVersion) ?? args.availabilityVersion,
    generatedAt: pickString(args.cached.generatedAt) ?? args.generatedAt,
    availableDays,
    selectedDay,
  }
}

export async function GET(req: Request) {
  const timers: TimerMap = {}
  markTimer(timers, 'total:start')

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

    if (dateStr) {
      return jsonFail(
        400,
        'Bootstrap route does not accept date. Use /api/availability/day for a specific day.',
      )
    }

    markTimer(timers, 'versions:start')
    const [scheduleVersion, scheduleConfigVersion] = await Promise.all([
      getScheduleVersion(professionalId),
      getScheduleConfigVersion(professionalId),
    ])
    markTimer(timers, 'versions:end')

    markTimer(timers, 'context:start')
    const baseContext = await loadAvailabilityOfferingContext({
      professionalId,
      serviceId,
      requestedLocationType,
      requestedLocationId,
      clientAddressId,
      scheduleConfigVersion,
      cacheEnabled: !debug,
    })
    markTimer(timers, 'context:end')

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

    const nowUtc = new Date()
    const nowParts = utcDateToLocalParts(nowUtc, timeZone)
    const todayYMD = {
      year: nowParts.year,
      month: nowParts.month,
      day: nowParts.day,
    }
    const todayDate = ymdToString(todayYMD)

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

      if (isBootstrapCacheHit(hit)) {
        const cachedDurationMinutes = pickNumber(hit.durationMinutes)

        if (cachedDurationMinutes != null) {
          const request = buildBootstrapRequestPayload({
            professionalId,
            serviceId,
            offeringId: offeringDbId,
            locationType: effectiveLocationType,
            locationId,
            clientAddressId: resolvedClientAddressId,
            addOnIds,
            durationMinutes: cachedDurationMinutes,
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
            durationMinutes: cachedDurationMinutes,
            scheduleVersion,
            scheduleConfigVersion,
            windowStartDate,
            windowEndDate,
            includeOtherPros,
            viewerLat,
            viewerLng,
            radiusMiles,
          })

          markInstantSection(timers, 'addons')
          markInstantSection(timers, 'busy')
          markInstantSection(timers, 'otherpros')
          markInstantSection(timers, 'slots')
          markTimer(timers, 'total:end')

          return withServerTiming(
            jsonOk(
              normalizeBootstrapCacheHit({
                cached: hit,
                mediaId: mediaId || null,
                request,
                availabilityVersion,
                generatedAt,
                todayDate,
              }),
            ),
            timers,
          )
        }
      }
    }

    markTimer(timers, 'addons:start')
    const addOnResult = await resolveRequestedDurationMinutes({
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
    markTimer(timers, 'addons:end')

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

    const busyPromise = (async () => {
      markTimer(timers, 'busy:start')
      const result = await loadBusyIntervals({
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
      markTimer(timers, 'busy:end')
      return result
    })()

    const otherProsPromise = (async () => {
      markTimer(timers, 'otherpros:start')

      const result =
        includeOtherPros && centerLat != null && centerLng != null
          ? await loadOtherProsNearbyCached({
              centerLat,
              centerLng,
              radiusMiles,
              serviceId,
              locationType: effectiveLocationType,
              excludeProfessionalId: professionalId,
              limit: 6,
              cacheEnabled: !debug,
            })
          : ([] as OtherProRow[])

      markTimer(timers, 'otherpros:end')
      return result
    })()

    const [busy, otherPros] = await Promise.all([busyPromise, otherProsPromise])

    markTimer(timers, 'slots:start')
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
    markTimer(timers, 'slots:end')

    const availableDays: SummaryAvailableDay[] = []
    let todaySelectedDay: SummarySeededDay | null = null
    let firstAvailableSelectedDay: SummarySeededDay | null = null
    let firstErrorCode: BookingErrorCode | null = null

    for (const row of dayResults) {
      if (!row.result.ok) {
        firstErrorCode = firstErrorCode ?? row.result.code
        continue
      }

      const slotCount = row.result.slots.length
      if (slotCount <= 0) continue

      const date = ymdToString(row.ymd)
      const slots = row.result.slots.slice()

      availableDays.push({
        date,
        slotCount,
      })

      if (date === todayDate && !todaySelectedDay) {
        todaySelectedDay = {
          date,
          slots,
        }
      }

      if (!firstAvailableSelectedDay) {
        firstAvailableSelectedDay = {
          date,
          slots,
        }
      }
    }

    const selectedDay = resolveSelectedDay({
      availableDays,
      todayDate,
      todaySelectedDay,
      firstAvailableSelectedDay,
    })

    const request = buildBootstrapRequestPayload({
      professionalId,
      serviceId,
      offeringId: offeringDbId,
      locationType: effectiveLocationType,
      locationId,
      clientAddressId: resolvedClientAddressId,
      addOnIds,
      durationMinutes,
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
      windowStartDate,
      windowEndDate,
      includeOtherPros,
      viewerLat,
      viewerLng,
      radiusMiles,
    })

    const payload = {
      ok: true,
      mode: 'BOOTSTRAP' as const,
      availabilityVersion,
      generatedAt,
      request,
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
      selectedDay,
      otherPros,
      waitlistSupported: true,
      offering: offeringPayload,

      ...(debug
        ? {
            debug: {
              emptyReason: !availableDays.length ? firstErrorCode : null,
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
        TTL_BOOTSTRAP_SECONDS,
      )
    }

    markTimer(timers, 'total:end')
    return withServerTiming(jsonOk(payload), timers)
  } catch (err: unknown) {
    console.error('GET /api/availability/bootstrap error', err)
    return bookingJsonFail('INTERNAL_ERROR', {
      message:
        err instanceof Error ? err.message : 'Failed to load availability.',
      userMessage: 'Failed to load availability.',
    })
  }
}