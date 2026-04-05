// app/api/availability/alternates/route.ts

import { createHash } from 'node:crypto'

import { ServiceLocationType } from '@prisma/client'

import { jsonFail, jsonOk } from '@/app/api/_utils'
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
  localSlotToUtcOrNull,
} from '@/lib/availability/core/dayComputation'
import { parseYYYYMMDD, ymdSerial } from '@/lib/availability/core/summaryWindow'
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
import { clampInt } from '@/lib/pick'
import { getWorkingWindowForDay } from '@/lib/scheduling/workingHours'

export const dynamic = 'force-dynamic'

const MAX_LEAD_MINUTES = 30 * 24 * 60
const OCCUPANCY_WINDOW_PADDING_MINUTES =
  MAX_SLOT_DURATION_MINUTES + MAX_BUFFER_MINUTES
const MAX_ALTERNATES = 12
const DEFAULT_ALTERNATES_LIMIT = 6
const ALTERNATE_COMPUTE_CONCURRENCY = 4

type AlternatesRequestPayload = {
  serviceId: string
  offeringId: string | null
  locationType: ServiceLocationType
  locationId: string
  clientAddressId: string | null
  addOnIds: string[]
  durationMinutes: number
  date: string
}

type AlternateResult = {
  pro: OtherProRow
  slots: string[]
  scheduleVersion: string | number
  scheduleConfigVersion: string | number
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

function parseFloatParam(v: string | null): number | null {
  if (!v) return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

function resolveDebugClientAddressId(args: {
  locationType: ServiceLocationType
  clientAddressId: string | null
}): string | null {
  return args.locationType === ServiceLocationType.MOBILE
    ? args.clientAddressId
    : null
}

function buildAlternatesVersion(args: {
  professionalId: string
  serviceId: string
  offeringId: string | null
  locationType: ServiceLocationType
  locationId: string
  clientAddressId: string | null
  addOnIds: string[]
  durationMinutes: number
  date: string
  viewerLat: number | null
  viewerLng: number | null
  radiusMiles: number | null
  alternates: Array<{
    id: string
    offeringId: string
    locationId: string
    scheduleVersion: string | number
    scheduleConfigVersion: string | number
  }>
}) {
  const raw = JSON.stringify({
    v: 1,
    ...args,
  })

  const digest = createHash('sha256').update(raw).digest('hex')
  return `alternates:${digest.slice(0, 24)}`
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

async function mapWithConcurrencyLimit<TItem, TResult>(
  items: readonly TItem[],
  concurrency: number,
  worker: (item: TItem) => Promise<TResult>,
): Promise<TResult[]> {
  if (items.length === 0) return []

  const queue = items.map((item, index) => ({ item, index }))
  const results: TResult[] = []
  const workerCount = Math.max(1, Math.min(concurrency, queue.length))

  async function runWorker() {
    while (queue.length > 0) {
      const next = queue.shift()
      if (!next) return
      results[next.index] = await worker(next.item)
    }
  }

  await Promise.all(Array.from({ length: workerCount }, () => runWorker()))
  return results
}

async function computeAlternateForDay(args: {
  pro: OtherProRow
  serviceId: string
  requestedLocationType: ServiceLocationType
  clientAddressId: string | null
  addOnIds: string[]
  ymd: { year: number; month: number; day: number }
  dateStr: string
  stepRaw: string | null
  leadRaw: string | null
  debug: boolean
  nowUtc: Date
}): Promise<AlternateResult | null> {
  const [scheduleVersion, scheduleConfigVersion] = await Promise.all([
    getScheduleVersion(args.pro.id),
    getScheduleConfigVersion(args.pro.id),
  ])

  const baseContext = await loadAvailabilityOfferingContext({
    professionalId: args.pro.id,
    serviceId: args.serviceId,
    requestedLocationType: args.requestedLocationType,
    requestedLocationId: args.pro.locationId,
    clientAddressId: args.clientAddressId,
    scheduleConfigVersion,
    cacheEnabled: !args.debug,
  })

  if (!baseContext.ok) {
    return {
      pro: args.pro,
      slots: [],
      scheduleVersion,
      scheduleConfigVersion,
    }
  }

  let {
    locationId,
    effectiveLocationType,
    timeZone,
    workingHours,
    defaultStepMinutes,
    defaultLead,
    locationBufferMinutes,
    maxAdvanceDays,
    durationMinutes,
    offeringDbId,
  } = baseContext.value

  const addOnResult = await resolveRequestedDurationMinutes({
    professionalId: args.pro.id,
    offeringId: offeringDbId,
    addOnIds: args.addOnIds,
    locationType: effectiveLocationType,
    baseDurationMinutes: durationMinutes,
  })

  if (!addOnResult.ok) {
    return {
      pro: args.pro,
      slots: [],
      scheduleVersion,
      scheduleConfigVersion,
    }
  }

  durationMinutes = addOnResult.durationMinutes

  const stepMinutes =
    args.debug && args.stepRaw
      ? normalizeStepMinutes(args.stepRaw, defaultStepMinutes)
      : defaultStepMinutes

  const leadTimeMinutes =
    args.debug && args.leadRaw
      ? clampInt(toInt(args.leadRaw, defaultLead), 0, MAX_LEAD_MINUTES)
      : defaultLead

  const bounds = computeDayBoundsUtc(args.ymd, timeZone)

  const dayAnchorUtc =
    localSlotToUtcOrNull({
      year: args.ymd.year,
      month: args.ymd.month,
      day: args.ymd.day,
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
    professionalId: args.pro.id,
    locationId,
    windowStartUtc,
    windowEndUtc,
    nowUtc: args.nowUtc,
    fallbackDurationMinutes: durationMinutes,
    locationBufferMinutes,
    scheduleVersion,
    cache: { enabled: !args.debug },
  })

  const result = await computeDaySlotsFast({
    dateYMD: args.ymd,
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

  return {
    pro: {
      ...args.pro,
      locationId,
      timeZone,
    },
    slots: result.ok ? result.slots.slice() : [],
    scheduleVersion,
    scheduleConfigVersion,
  }
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
      viewerLat,
      viewerLng,
      radiusMiles,
    } = parseAvailabilityRequest(req)

    const { searchParams } = new URL(req.url)
    const limitRaw = parseFloatParam(searchParams.get('limit'))
    const limit = Math.min(
      Math.max(Math.trunc(limitRaw ?? DEFAULT_ALTERNATES_LIMIT), 1),
      MAX_ALTERNATES,
    )

    if (!professionalId || !serviceId) {
      return jsonFail(400, 'Missing professionalId or serviceId.')
    }

    if (!dateStr) {
      return jsonFail(400, 'Missing date. Use YYYY-MM-DD.')
    }

    const ymd = parseYYYYMMDD(dateStr)
    if (!ymd) {
      return jsonFail(400, 'Invalid date. Use YYYY-MM-DD.')
    }

    const [primaryScheduleVersion, primaryScheduleConfigVersion] =
      await Promise.all([
        getScheduleVersion(professionalId),
        getScheduleConfigVersion(professionalId),
      ])

    const primaryContext = await loadAvailabilityOfferingContext({
      professionalId,
      serviceId,
      requestedLocationType,
      requestedLocationId,
      clientAddressId,
      scheduleConfigVersion: primaryScheduleConfigVersion,
      cacheEnabled: !debug,
    })

    if (!primaryContext.ok) {
      if (primaryContext.kind === 'NOT_FOUND') {
        return jsonFail(
          404,
          primaryContext.entity === 'PROFESSIONAL'
            ? 'Professional not found'
            : 'Service not found',
        )
      }

      return bookingJsonFail(primaryContext.code)
    }

    let {
      locationId,
      effectiveLocationType,
      timeZone,
      defaultStepMinutes,
      defaultLead,
      locationBufferMinutes,
      maxAdvanceDays,
      durationMinutes,
      placementLat,
      placementLng,
      offeringDbId,
    } = primaryContext.value

    const resolvedClientAddressId = resolveDebugClientAddressId({
      locationType: effectiveLocationType,
      clientAddressId,
    })

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

    const hasViewer =
      typeof viewerLat === 'number' && typeof viewerLng === 'number'
    const centerLat = hasViewer ? viewerLat : placementLat
    const centerLng = hasViewer ? viewerLng : placementLng

    const request: AlternatesRequestPayload = {
      serviceId,
      offeringId: offeringDbId,
      locationType: effectiveLocationType,
      locationId,
      clientAddressId: resolvedClientAddressId,
      addOnIds,
      durationMinutes,
      date: dateStr,
    }

    const generatedAt = new Date().toISOString()

    if (centerLat == null || centerLng == null) {
      const availabilityVersion = buildAlternatesVersion({
        professionalId,
        serviceId,
        offeringId: offeringDbId,
        locationType: effectiveLocationType,
        locationId,
        clientAddressId: resolvedClientAddressId,
        addOnIds,
        durationMinutes,
        date: dateStr,
        viewerLat: hasViewer ? viewerLat : null,
        viewerLng: hasViewer ? viewerLng : null,
        radiusMiles: radiusMiles ?? null,
        alternates: [
          {
            id: professionalId,
            offeringId: offeringDbId,
            locationId,
            scheduleVersion: primaryScheduleVersion,
            scheduleConfigVersion: primaryScheduleConfigVersion,
          },
        ],
      })

      return jsonOk({
        ok: true,
        mode: 'ALTERNATES' as const,
        availabilityVersion,
        generatedAt,
        request,
        selectedDay: dateStr,
        alternates: [],
      })
    }

    const otherPros = await loadOtherProsNearbyCached({
      centerLat,
      centerLng,
      radiusMiles,
      serviceId,
      locationType: effectiveLocationType,
      excludeProfessionalId: professionalId,
      limit,
      cacheEnabled: !debug,
    })

    const computedAlternates = await mapWithConcurrencyLimit(
      otherPros,
      ALTERNATE_COMPUTE_CONCURRENCY,
      async (pro): Promise<AlternateResult | null> =>
        computeAlternateForDay({
          pro,
          serviceId,
          requestedLocationType: effectiveLocationType,
          clientAddressId: resolvedClientAddressId,
          addOnIds,
          ymd,
          dateStr,
          stepRaw,
          leadRaw,
          debug,
          nowUtc,
        }),
    )

    const alternates = computedAlternates
      .filter((row): row is AlternateResult => row !== null)
      .map((row) => ({
        pro: {
          id: row.pro.id,
          businessName: row.pro.businessName,
          avatarUrl: row.pro.avatarUrl,
          location: row.pro.location,
          offeringId: row.pro.offeringId,
          timeZone: row.pro.timeZone,
          locationId: row.pro.locationId,
          distanceMiles: row.pro.distanceMiles,
        },
        slots: row.slots,
      }))

    const availabilityVersion = buildAlternatesVersion({
      professionalId,
      serviceId,
      offeringId: offeringDbId,
      locationType: effectiveLocationType,
      locationId,
      clientAddressId: resolvedClientAddressId,
      addOnIds,
      durationMinutes,
      date: dateStr,
      viewerLat: hasViewer ? viewerLat : null,
      viewerLng: hasViewer ? viewerLng : null,
      radiusMiles: radiusMiles ?? null,
      alternates: [
        {
          id: professionalId,
          offeringId: offeringDbId,
          locationId,
          scheduleVersion: primaryScheduleVersion,
          scheduleConfigVersion: primaryScheduleConfigVersion,
        },
        ...computedAlternates
          .filter((row): row is AlternateResult => row !== null)
          .map((row) => ({
            id: row.pro.id,
            offeringId: row.pro.offeringId,
            locationId: row.pro.locationId,
            scheduleVersion: row.scheduleVersion,
            scheduleConfigVersion: row.scheduleConfigVersion,
          })),
      ],
    })

    return jsonOk({
      ok: true,
      mode: 'ALTERNATES' as const,
      availabilityVersion,
      generatedAt,
      request,
      selectedDay: dateStr,
      alternates,
      ...(debug
        ? {
            debug: {
              requestedLimit: limit,
              fetchedCandidates: otherPros.length,
              computedAlternates: alternates.length,
              center: {
                lat: centerLat,
                lng: centerLng,
                radiusMiles,
              },
              primary: {
                professionalId,
                offeringId: offeringDbId,
                locationId,
                stepMinutes,
                leadTimeMinutes,
                locationBufferMinutes,
                maxDaysAhead: maxAdvanceDays,
              },
            },
          }
        : {}),
    })
  } catch (err: unknown) {
    console.error('GET /api/availability/alternates error', err)
    return bookingJsonFail('INTERNAL_ERROR', {
      message:
        err instanceof Error ? err.message : 'Failed to load alternate availability.',
      userMessage: 'Failed to load alternate availability.',
    })
  }
}
