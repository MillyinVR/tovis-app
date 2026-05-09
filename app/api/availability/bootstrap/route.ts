// app/api/availability/bootstrap/route.ts

import { createHash } from 'node:crypto'

import { ServiceLocationType } from '@prisma/client'

import { jsonFail, jsonOk } from '@/app/api/_utils'
import { buildSummaryCacheKey } from '@/lib/availability/data/cache'
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
import { withVersionedCache } from '@/lib/cache/versionedCache'
import { prismaRead } from '@/lib/prisma'
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

function recordMeasuredSection(
  timers: TimerMap,
  name: string,
  durationMs: number,
): void {
  const now = performance.now()
  const safeDuration = Math.max(0, durationMs)
  timers[`${name}:start`] = now - safeDuration
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
    [
      'placement_cache_get',
      measureMs(
        timers,
        'offering:placement_cache_get:start',
        'offering:placement_cache_get:end',
      ),
    ],
    [
      'fresh_source',
      measureMs(
        timers,
        'offering:fresh_source:start',
        'offering:fresh_source:end',
      ),
    ],
    [
      'placement_resolve',
      measureMs(
        timers,
        'offering:placement_resolve:start',
        'offering:placement_resolve:end',
      ),
    ],
    [
      'placement_cache_set',
      measureMs(
        timers,
        'offering:placement_cache_set:start',
        'offering:placement_cache_set:end',
      ),
    ],
    [
      'placement_requested_location_load',
      measureMs(
        timers,
        'offering:placement_requested_location_load:start',
        'offering:placement_requested_location_load:end',
      ),
    ],
    [
      'placement_candidate_list_load',
      measureMs(
        timers,
        'offering:placement_candidate_list_load:start',
        'offering:placement_candidate_list_load:end',
      ),
    ],
    [
      'placement_candidate_validation',
      measureMs(
        timers,
        'offering:placement_candidate_validation:start',
        'offering:placement_candidate_validation:end',
      ),
    ],
    [
      'placement_location_context_pick_location',
      measureMs(
        timers,
        'offering:placement_location_context_pick_location:start',
        'offering:placement_location_context_pick_location:end',
      ),
    ],
    [
      'placement_location_context_timezone_resolve',
      measureMs(
        timers,
        'offering:placement_location_context_timezone_resolve:start',
        'offering:placement_location_context_timezone_resolve:end',
      ),
    ],
    [
      'placement_location_context_context_validation',
      measureMs(
        timers,
        'offering:placement_location_context_context_validation:start',
        'offering:placement_location_context_context_validation:end',
      ),
    ],
    [
      'placement_location_context_offering_validation',
      measureMs(
        timers,
        'offering:placement_location_context_offering_validation:start',
        'offering:placement_location_context_offering_validation:end',
      ),
    ],
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
    client: prismaRead,
  })
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
      client: prismaRead,
      onTiming: (label, durationMs) => {
        recordMeasuredSection(timers, `offering:${label}`, durationMs)
      },
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

    // Resolve add-on duration up-front so it participates in the cache key
    // (via `addOnIds` in `buildSummaryCacheKey`) and the cached payload always
    // carries the final durationMinutes. Cost is one extra Prisma round-trip
    // when addOns are non-empty; the empty path returns immediately.
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

    const summaryKeyExtra = debug
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

    const hasViewer =
      typeof viewerLat === 'number' && typeof viewerLng === 'number'
    const centerLat = hasViewer ? viewerLat : placementLat
    const centerLng = hasViewer ? viewerLng : placementLng

    const computeBootstrapPayload = async () => {
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
          client: prismaRead,
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
                client: prismaRead,
              })
            : ([] as OtherProRow[])

        markTimer(timers, 'otherpros:end')
        return result
      })()

      const [busy, otherPros] = await Promise.all([
        busyPromise,
        otherProsPromise,
      ])

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

      // mediaId stays null in the cached payload — it's per-request and gets
      // applied after the cache returns. Same for selectedDay refresh below
      // when today's date moves between cache write and read.
      return {
        ok: true,
        mode: 'BOOTSTRAP' as const,
        availabilityVersion,
        generatedAt,
        request,
        mediaId: null as string | null,
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
    }

    let cachedPayload
    if (summaryKeyExtra) {
      // Cache trade-off (replica lag + version bumps):
      //   primary write commits → bumpScheduleConfigVersion runs → next request
      //   reads new version → cache miss → loader uses prismaRead which can be
      //   1–5s behind primary → stale snapshot caches under the new v{N} key →
      //   served until TTL expires. The 120s TTL is the staleness backstop.
      //   Don't lower it without first ensuring replica lag stays well below.
      const result = await withVersionedCache(
        {
          scope: 'availability:bootstrap',
          scopeId: professionalId,
          version: scheduleConfigVersion,
          extra: summaryKeyExtra,
        },
        computeBootstrapPayload,
        TTL_BOOTSTRAP_SECONDS,
      )
      cachedPayload = result.value

      if (result.cacheHit) {
        markInstantSection(timers, 'busy')
        markInstantSection(timers, 'otherpros')
        markInstantSection(timers, 'slots')
      }
    } else {
      cachedPayload = await computeBootstrapPayload()
    }

    // Per-request refresh: mediaId reflects the current request, and selectedDay
    // is re-derived against today's date in case the cached entry crossed a
    // day boundary.
    const refreshedAvailableDays = pickAvailableDays(cachedPayload.availableDays)
    const refreshedSelectedDay = deriveSelectedDayFromCachedBootstrap({
      cached: cachedPayload as unknown as Record<string, unknown>,
      availableDays: refreshedAvailableDays,
      todayDate,
    })

    const finalPayload = {
      ...cachedPayload,
      mediaId: mediaId || null,
      availableDays: refreshedAvailableDays,
      selectedDay: refreshedSelectedDay,
    }

    markTimer(timers, 'total:end')
    return withServerTiming(jsonOk(finalPayload), timers)
  } catch (err: unknown) {
    console.error('GET /api/availability/bootstrap error', err)
    return bookingJsonFail('INTERNAL_ERROR', {
      message:
        err instanceof Error ? err.message : 'Failed to load availability.',
      userMessage: 'Failed to load availability.',
    })
  }
}