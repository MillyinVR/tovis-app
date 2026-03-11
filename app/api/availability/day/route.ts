// app/api/availability/day/route.ts
import { prisma } from '@/lib/prisma'
import {
  Prisma,
  ProfessionalLocationType,
  ServiceLocationType,
} from '@prisma/client'
import { pickString } from '@/app/api/_utils/pick'
import { jsonFail, jsonOk } from '@/app/api/_utils'
import { isRecord } from '@/lib/guards'
import { clampInt } from '@/lib/pick'
import { getRedis } from '@/lib/redis'
import { createHash } from 'crypto'
import {
  sanitizeTimeZone,
  getZonedParts,
  zonedTimeToUtc,
  isValidIanaTimeZone,
} from '@/lib/timeZone'
import { getWorkingWindowForDay } from '@/lib/scheduling/workingHours'
import {
  addMinutes,
  isSlotFree,
  normalizeToMinute,
  type BusyInterval,
} from '@/lib/booking/conflicts'
import { loadBusyIntervalsForWindow } from '@/lib/booking/conflictQueries'
import {
  normalizeLocationType,
  normalizeStepMinutes,
  pickEffectiveLocationType,
  resolveValidatedBookingContext,
  type SchedulingReadinessError,
  type OfferingSchedulingSnapshot,
} from '@/lib/booking/locationContext'
import { decimalToNumber } from '@/lib/booking/snapshots'
import {
  DEFAULT_DURATION_MINUTES,
  MAX_BUFFER_MINUTES,
  MAX_DAYS_AHEAD as MAX_BOOKING_DAYS_AHEAD,
  MAX_SLOT_DURATION_MINUTES,
} from '@/lib/booking/constants'

export const dynamic = 'force-dynamic'

const MAX_LEAD_MINUTES = 30 * 24 * 60

// Short-lived browsing cache.
// Final booking correctness is still enforced by holds/conflict checks.
const TTL_DAY_SECONDS = 90
const TTL_SUMMARY_SECONDS = 60
const TTL_BUSY_SECONDS = 60
const TTL_OTHER_PROS_SECONDS = 120

const LOCATION_SELECT = {
  id: true,
  type: true,
  isPrimary: true,
  isBookable: true,
  timeZone: true,
  workingHours: true,
  bufferMinutes: true,
  stepMinutes: true,
  advanceNoticeMinutes: true,
  maxDaysAhead: true,
  lat: true,
  lng: true,
  city: true,
  formattedAddress: true,
  createdAt: true,
} satisfies Prisma.ProfessionalLocationSelect

type AvailabilityLocation = Prisma.ProfessionalLocationGetPayload<{
  select: typeof LOCATION_SELECT
}>

type OtherProRow = {
  id: string
  businessName: string | null
  avatarUrl: string | null
  location: string | null
  offeringId: string
  timeZone: string
  locationId: string
  distanceMiles: number
}

type AvailabilityPlacementErrorCode =
  | SchedulingReadinessError
  | 'CLIENT_SERVICE_ADDRESS_REQUIRED'
  | 'SALON_LOCATION_ADDRESS_REQUIRED'
  | 'NO_SCHEDULING_READY_LOCATION'

type AvailabilityPlacementResult =
  | {
      ok: true
      location: AvailabilityLocation
      locationId: string
      locationType: ServiceLocationType
      timeZone: string
      workingHours: unknown
      stepMinutes: number
      leadTimeMinutes: number
      locationBufferMinutes: number
      maxAdvanceDays: number
      durationMinutes: number
      priceStartingAt: number
      formattedAddress: string | null
      lat: number | undefined
      lng: number | undefined
    }
  | {
      ok: false
      code: AvailabilityPlacementErrorCode
      error: string
    }

const redis = getRedis()

function toInt(value: string | null, fallback: number): number {
  const n = Number(value)
  return Number.isFinite(n) ? Math.trunc(n) : fallback
}

function clampFloat(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min
  return Math.min(Math.max(value, min), max)
}

function normalizeAddress(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function parseYYYYMMDD(value: unknown) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value ?? '').trim())
  if (!m) return null

  const year = Number(m[1])
  const month = Number(m[2])
  const day = Number(m[3])

  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) {
    return null
  }

  if (month < 1 || month > 12) return null
  if (day < 1 || day > 31) return null

  return { year, month, day }
}

function addDaysToYMD(
  year: number,
  month: number,
  day: number,
  daysToAdd: number,
) {
  const d = new Date(Date.UTC(year, month - 1, day + daysToAdd, 12, 0, 0, 0))
  return {
    year: d.getUTCFullYear(),
    month: d.getUTCMonth() + 1,
    day: d.getUTCDate(),
  }
}

function ymdSerial(ymd: { year: number; month: number; day: number }): number {
  return Math.floor(
    Date.UTC(ymd.year, ymd.month - 1, ymd.day, 12, 0, 0, 0) / 86_400_000,
  )
}

function ymdToString(ymd: { year: number; month: number; day: number }): string {
  const mm = String(ymd.month).padStart(2, '0')
  const dd = String(ymd.day).padStart(2, '0')
  return `${ymd.year}-${mm}-${dd}`
}

function computeDayBoundsUtc(
  dateYMD: { year: number; month: number; day: number },
  timeZoneRaw: string,
) {
  const timeZone = sanitizeTimeZone(timeZoneRaw, 'UTC')

  const dayStartUtc = zonedTimeToUtc({
    year: dateYMD.year,
    month: dateYMD.month,
    day: dateYMD.day,
    hour: 0,
    minute: 0,
    second: 0,
    timeZone,
  })

  const next = addDaysToYMD(dateYMD.year, dateYMD.month, dateYMD.day, 1)

  const dayEndExclusiveUtc = zonedTimeToUtc({
    year: next.year,
    month: next.month,
    day: next.day,
    hour: 0,
    minute: 0,
    second: 0,
    timeZone,
  })

  return { timeZone, dayStartUtc, dayEndExclusiveUtc }
}

function stableHash(input: unknown): string {
  return createHash('sha256')
    .update(JSON.stringify(input))
    .digest('hex')
    .slice(0, 24)
}

async function cacheGetJson<T>(key: string): Promise<T | null> {
  if (!redis) return null

  try {
    const raw = await redis.get<string>(key)
    if (!raw) return null
    return JSON.parse(raw) as T
  } catch {
    return null
  }
}

async function cacheSetJson(
  key: string,
  value: unknown,
  ttlSeconds: number,
): Promise<void> {
  if (!redis) return

  try {
    await redis.set(key, JSON.stringify(value), { ex: ttlSeconds })
  } catch {
    // fail-open
  }
}

function allowedProfessionalTypes(
  locationType: ServiceLocationType,
): ProfessionalLocationType[] {
  return locationType === ServiceLocationType.MOBILE
    ? [ProfessionalLocationType.MOBILE_BASE]
    : [ProfessionalLocationType.SALON, ProfessionalLocationType.SUITE]
}

function locationTypeForLocation(
  location: Pick<AvailabilityLocation, 'type'>,
): ServiceLocationType {
  return location.type === ProfessionalLocationType.MOBILE_BASE
    ? ServiceLocationType.MOBILE
    : ServiceLocationType.SALON
}

function buildOfferingSnapshot(offering: {
  offersInSalon: boolean
  offersMobile: boolean
  salonDurationMinutes: number | null
  mobileDurationMinutes: number | null
  salonPriceStartingAt: Prisma.Decimal | null
  mobilePriceStartingAt: Prisma.Decimal | null
}): OfferingSchedulingSnapshot {
  return {
    offersInSalon: Boolean(offering.offersInSalon),
    offersMobile: Boolean(offering.offersMobile),
    salonDurationMinutes: offering.salonDurationMinutes ?? null,
    mobileDurationMinutes: offering.mobileDurationMinutes ?? null,
    salonPriceStartingAt: offering.salonPriceStartingAt ?? null,
    mobilePriceStartingAt: offering.mobilePriceStartingAt ?? null,
  }
}

function mapPlacementError(code: AvailabilityPlacementErrorCode): string {
  switch (code) {
    case 'CLIENT_SERVICE_ADDRESS_REQUIRED':
      return 'Select a saved service address before viewing mobile availability.'
    case 'SALON_LOCATION_ADDRESS_REQUIRED':
      return 'This salon location is missing an address and cannot take bookings.'
    case 'LOCATION_NOT_FOUND':
      return 'Location not found or not bookable.'
    case 'TIMEZONE_REQUIRED':
      return 'This location must set a valid timezone before taking bookings.'
    case 'WORKING_HOURS_REQUIRED':
      return 'Working hours are not set for this location.'
    case 'WORKING_HOURS_INVALID':
      return 'Working hours are misconfigured for this location.'
    case 'MODE_NOT_SUPPORTED':
      return 'This service is not bookable for the selected appointment type.'
    case 'DURATION_REQUIRED':
      return 'Duration is not set for the selected offering.'
    case 'PRICE_REQUIRED':
      return 'Pricing is not set for the selected offering.'
    case 'COORDINATES_REQUIRED':
      return 'This location is missing coordinates required for this booking flow.'
    case 'NO_SCHEDULING_READY_LOCATION':
      return 'No scheduling-ready location found for this service.'
  }
}

async function validateAvailabilityPlacement(args: {
  professionalId: string
  requestedLocationId: string | null
  locationType: ServiceLocationType
  offering: OfferingSchedulingSnapshot
  clientAddressId: string | null
  allowFallback: boolean
}): Promise<AvailabilityPlacementResult> {
  const validated = await resolveValidatedBookingContext({
    professionalId: args.professionalId,
    requestedLocationId: args.requestedLocationId,
    locationType: args.locationType,
    fallbackTimeZone: 'UTC',
    requireValidTimeZone: true,
    allowFallback: args.allowFallback,
    requireCoordinates: false,
    offering: args.offering,
  })

  if (!validated.ok) {
    return {
      ok: false,
      code: validated.error,
      error: mapPlacementError(validated.error),
    }
  }

  const context = validated.context
  const formattedAddress = normalizeAddress(context.formattedAddress)

  if (
    args.locationType === ServiceLocationType.MOBILE &&
    !args.clientAddressId
  ) {
    return {
      ok: false,
      code: 'CLIENT_SERVICE_ADDRESS_REQUIRED',
      error: mapPlacementError('CLIENT_SERVICE_ADDRESS_REQUIRED'),
    }
  }

  if (
    args.locationType === ServiceLocationType.SALON &&
    !formattedAddress
  ) {
    return {
      ok: false,
      code: 'SALON_LOCATION_ADDRESS_REQUIRED',
      error: mapPlacementError('SALON_LOCATION_ADDRESS_REQUIRED'),
    }
  }

  return {
    ok: true,
    location: context.location,
    locationId: context.locationId,
    locationType: args.locationType,
    timeZone: context.timeZone,
    workingHours: context.workingHours,
    stepMinutes: context.stepMinutes,
    leadTimeMinutes: context.advanceNoticeMinutes,
    locationBufferMinutes: context.bufferMinutes,
    maxAdvanceDays: context.maxDaysAhead,
    durationMinutes: validated.durationMinutes,
    priceStartingAt: validated.priceStartingAt,
    formattedAddress,
    lat: context.lat,
    lng: context.lng,
  }
}

async function resolveAvailabilityPlacement(args: {
  professionalId: string
  offering: OfferingSchedulingSnapshot
  requestedLocationType: ServiceLocationType | null
  requestedLocationId: string | null
  clientAddressId: string | null
}): Promise<AvailabilityPlacementResult> {
  const professionalId = args.professionalId.trim()
  const requestedLocationId = args.requestedLocationId?.trim() || null

  if (!professionalId) {
    return {
      ok: false,
      code: 'NO_SCHEDULING_READY_LOCATION',
      error: mapPlacementError('NO_SCHEDULING_READY_LOCATION'),
    }
  }

  if (args.requestedLocationType) {
    const effectiveLocationType =
      pickEffectiveLocationType({
        requested: args.requestedLocationType,
        offersInSalon: args.offering.offersInSalon,
        offersMobile: args.offering.offersMobile,
      }) ?? null

    if (!effectiveLocationType) {
      return {
        ok: false,
        code: 'MODE_NOT_SUPPORTED',
        error: mapPlacementError('MODE_NOT_SUPPORTED'),
      }
    }

    return validateAvailabilityPlacement({
      professionalId,
      requestedLocationId,
      locationType: effectiveLocationType,
      offering: args.offering,
      clientAddressId: args.clientAddressId,
      allowFallback: !requestedLocationId,
    })
  }

  if (requestedLocationId) {
    const requested = await prisma.professionalLocation.findFirst({
      where: {
        id: requestedLocationId,
        professionalId,
        isBookable: true,
      },
      select: LOCATION_SELECT,
    })

    if (!requested?.id) {
      return {
        ok: false,
        code: 'LOCATION_NOT_FOUND',
        error: mapPlacementError('LOCATION_NOT_FOUND'),
      }
    }

    const locationType = locationTypeForLocation(requested)

    return validateAvailabilityPlacement({
      professionalId,
      requestedLocationId,
      locationType,
      offering: args.offering,
      clientAddressId: args.clientAddressId,
      allowFallback: false,
    })
  }

  const allowedTypes: ProfessionalLocationType[] = []

  if (args.offering.offersInSalon) {
    allowedTypes.push(
      ProfessionalLocationType.SALON,
      ProfessionalLocationType.SUITE,
    )
  }

  if (args.offering.offersMobile) {
    allowedTypes.push(ProfessionalLocationType.MOBILE_BASE)
  }

  if (!allowedTypes.length) {
    return {
      ok: false,
      code: 'MODE_NOT_SUPPORTED',
      error: mapPlacementError('MODE_NOT_SUPPORTED'),
    }
  }

  const candidates = await prisma.professionalLocation.findMany({
    where: {
      professionalId,
      isBookable: true,
      type: { in: allowedTypes },
    },
    orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
    select: LOCATION_SELECT,
    take: 50,
  })

  let firstMeaningfulError: AvailabilityPlacementResult | null = null

  for (const candidate of candidates) {
    const locationType = locationTypeForLocation(candidate)

    const attempt = await validateAvailabilityPlacement({
      professionalId,
      requestedLocationId: candidate.id,
      locationType,
      offering: args.offering,
      clientAddressId: args.clientAddressId,
      allowFallback: false,
    })

    if (attempt.ok) {
      return attempt
    }

    if (
      firstMeaningfulError == null &&
      attempt.code !== 'LOCATION_NOT_FOUND'
    ) {
      firstMeaningfulError = attempt
    }
  }

  return (
    firstMeaningfulError ?? {
      ok: false,
      code: 'NO_SCHEDULING_READY_LOCATION',
      error: mapPlacementError('NO_SCHEDULING_READY_LOCATION'),
    }
  )
}

function parseCachedBusyIntervals(
  value: unknown,
): BusyInterval[] | null {
  if (!isRecord(value) || !Array.isArray(value.busy)) return null

  const intervals: BusyInterval[] = []

  for (const row of value.busy) {
    if (!isRecord(row)) continue

    const startRaw = pickString(row.start)
    const endRaw = pickString(row.end)
    if (!startRaw || !endRaw) continue

    const start = new Date(startRaw)
    const end = new Date(endRaw)

    if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime())) {
      continue
    }

    if (end.getTime() <= start.getTime()) continue

    intervals.push({ start, end })
  }

  return intervals
}

async function loadBusyIntervals(args: {
  professionalId: string
  locationId: string
  windowStartUtc: Date
  windowEndUtc: Date
  nowUtc: Date
  fallbackDurationMinutes: number
  locationBufferMinutes: number
  cache?: { enabled: boolean }
}): Promise<BusyInterval[]> {
  const cacheEnabled = Boolean(args.cache?.enabled)

  if (!cacheEnabled || !redis) {
    return loadBusyIntervalsForWindow({
      professionalId: args.professionalId,
      locationId: args.locationId,
      windowStartUtc: args.windowStartUtc,
      windowEndUtc: args.windowEndUtc,
      nowUtc: args.nowUtc,
      fallbackDurationMinutes: args.fallbackDurationMinutes,
      defaultBufferMinutes: args.locationBufferMinutes,
    })
  }

  const key = [
    'avail:busy:v5',
    args.professionalId,
    args.locationId,
    args.windowStartUtc.toISOString(),
    args.windowEndUtc.toISOString(),
    String(args.locationBufferMinutes ?? ''),
    String(args.fallbackDurationMinutes ?? ''),
  ].join(':')

  const hit = await cacheGetJson<unknown>(key)
  const parsedHit = parseCachedBusyIntervals(hit)
  if (parsedHit) {
    return parsedHit
  }

  const busy = await loadBusyIntervalsForWindow({
    professionalId: args.professionalId,
    locationId: args.locationId,
    windowStartUtc: args.windowStartUtc,
    windowEndUtc: args.windowEndUtc,
    nowUtc: args.nowUtc,
    fallbackDurationMinutes: args.fallbackDurationMinutes,
    defaultBufferMinutes: args.locationBufferMinutes,
  })

  void cacheSetJson(
    key,
    {
      busy: busy.map((b) => ({
        start: b.start.toISOString(),
        end: b.end.toISOString(),
      })),
    },
    TTL_BUSY_SECONDS,
  )

  return busy
}

async function computeDaySlotsFast(args: {
  dateYMD: { year: number; month: number; day: number }
  durationMinutes: number
  stepMinutes: number
  timeZone: string
  workingHours: unknown | null
  leadTimeMinutes: number
  locationBufferMinutes: number
  busy: BusyInterval[]
  debug?: boolean
}): Promise<
  | {
      ok: true
      slots: string[]
      dayStartUtc: Date
      dayEndExclusiveUtc: Date
      debug?: unknown
    }
  | {
      ok: false
      error: string
      dayStartUtc: Date
      dayEndExclusiveUtc: Date
      debug?: unknown
    }
> {
  const {
    dateYMD,
    durationMinutes,
    stepMinutes,
    timeZone: tzIn,
    workingHours,
    leadTimeMinutes,
    locationBufferMinutes,
    busy,
    debug,
  } = args

  const { timeZone, dayStartUtc, dayEndExclusiveUtc } = computeDayBoundsUtc(
    dateYMD,
    tzIn,
  )

  const nowUtc = new Date()

  const dayAnchorUtc = zonedTimeToUtc({
    year: dateYMD.year,
    month: dateYMD.month,
    day: dateYMD.day,
    hour: 12,
    minute: 0,
    second: 0,
    timeZone,
  })

  const window = getWorkingWindowForDay(dayAnchorUtc, workingHours, timeZone)

  if (!window.ok) {
    if (window.reason === 'MISSING') {
      return {
        ok: false,
        error: 'Working hours are not set for this location.',
        dayStartUtc,
        dayEndExclusiveUtc,
        debug: debug ? { timeZone, reason: 'no-workingHours' } : undefined,
      }
    }

    if (window.reason === 'DISABLED') {
      return {
        ok: true,
        slots: [],
        dayStartUtc,
        dayEndExclusiveUtc,
        debug: debug ? { timeZone, reason: 'disabled-day' } : undefined,
      }
    }

    return {
      ok: false,
      error: 'Working hours are misconfigured. Please re-save your schedule.',
      dayStartUtc,
      dayEndExclusiveUtc,
      debug: debug ? { timeZone, reason: 'misconfigured-workingHours' } : undefined,
    }
  }

  const step = normalizeStepMinutes(stepMinutes, 30)
  const dur = clampInt(
    Number(durationMinutes || DEFAULT_DURATION_MINUTES),
    15,
    MAX_SLOT_DURATION_MINUTES,
  )
  const buf = clampInt(
    Number(locationBufferMinutes ?? 0) || 0,
    0,
    MAX_BUFFER_MINUTES,
  )

  const cutoffUtc = addMinutes(
    nowUtc,
    clampInt(Number(leadTimeMinutes ?? 0) || 0, 0, MAX_LEAD_MINUTES),
  )

  const slots: string[] = []

  for (
    let minute = window.startMinutes;
    minute + dur + buf <= window.endMinutes;
    minute += step
  ) {
    const hh = Math.floor(minute / 60)
    const mm = minute % 60

    const slotStartUtc = normalizeToMinute(
      zonedTimeToUtc({
        year: dateYMD.year,
        month: dateYMD.month,
        day: dateYMD.day,
        hour: hh,
        minute: mm,
        second: 0,
        timeZone,
      }),
    )

    if (slotStartUtc < dayStartUtc) continue
    if (slotStartUtc >= dayEndExclusiveUtc) continue
    if (slotStartUtc.getTime() < cutoffUtc.getTime()) continue

    const slotEndWithBufferUtc = addMinutes(slotStartUtc, dur + buf)
    if (slotEndWithBufferUtc > dayEndExclusiveUtc) continue

    if (!isSlotFree(busy, slotStartUtc, slotEndWithBufferUtc)) continue

    slots.push(slotStartUtc.toISOString())
  }

  return {
    ok: true,
    slots,
    dayStartUtc,
    dayEndExclusiveUtc,
    debug: debug ? { timeZone, dayKey: window.key } : undefined,
  }
}

function toDecimal(n: number): Prisma.Decimal {
  return new Prisma.Decimal(String(n))
}

function haversineMiles(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  const R = 3958.7613
  const toRad = (d: number) => (d * Math.PI) / 180

  const dLat = toRad(b.lat - a.lat)
  const dLng = toRad(b.lng - a.lng)
  const lat1 = toRad(a.lat)
  const lat2 = toRad(b.lat)

  const sin1 = Math.sin(dLat / 2)
  const sin2 = Math.sin(dLng / 2)

  const h = sin1 * sin1 + Math.cos(lat1) * Math.cos(lat2) * sin2 * sin2
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)))
}

function boundsForRadiusMiles(
  centerLat: number,
  centerLng: number,
  radiusMiles: number,
) {
  const latDelta = radiusMiles / 69
  const cos = Math.max(0.2, Math.cos((centerLat * Math.PI) / 180))
  const lngDelta = radiusMiles / (69 * cos)

  return {
    minLat: clampFloat(centerLat - latDelta, -90, 90),
    maxLat: clampFloat(centerLat + latDelta, -90, 90),
    minLng: clampFloat(centerLng - lngDelta, -180, 180),
    maxLng: clampFloat(centerLng + lngDelta, -180, 180),
  }
}

function parseFloatParam(v: string | null): number | null {
  if (!v) return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

function parseCommaIds(v: string | null): string[] {
  if (!v) return []

  return v
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 25)
}

async function loadOtherProsNearby(args: {
  centerLat: number
  centerLng: number
  radiusMiles: number
  serviceId: string
  locationType: ServiceLocationType
  excludeProfessionalId: string
  limit: number
}): Promise<OtherProRow[]> {
  const {
    centerLat,
    centerLng,
    radiusMiles,
    serviceId,
    locationType,
    excludeProfessionalId,
    limit,
  } = args

  const bounds = boundsForRadiusMiles(centerLat, centerLng, radiusMiles)
  const allowedTypes = allowedProfessionalTypes(locationType)

  const candidateLocs = await prisma.professionalLocation.findMany({
    where: {
      isBookable: true,
      professionalId: { not: excludeProfessionalId },
      type: { in: allowedTypes },
      timeZone: { not: null },
      workingHours: { not: Prisma.JsonNull },
      lat: {
        not: null,
        gte: toDecimal(bounds.minLat),
        lte: toDecimal(bounds.maxLat),
      },
      lng: {
        not: null,
        gte: toDecimal(bounds.minLng),
        lte: toDecimal(bounds.maxLng),
      },
    },
    select: {
      id: true,
      professionalId: true,
      type: true,
      timeZone: true,
      workingHours: true,
      lat: true,
      lng: true,
      city: true,
      formattedAddress: true,
      isPrimary: true,
      createdAt: true,
    },
    take: 800,
  })

  const center = { lat: centerLat, lng: centerLng }

  const bestByPro = new Map<
    string,
    {
      locationId: string
      timeZone: string
      distanceMiles: number
      isPrimary: boolean
      createdAt: Date
      city: string | null
      formattedAddress: string | null
    }
  >()

  for (const location of candidateLocs) {
    const lat = decimalToNumber(location.lat)
    const lng = decimalToNumber(location.lng)
    if (lat == null || lng == null) continue

    const tz =
      typeof location.timeZone === 'string' ? location.timeZone.trim() : ''
    if (!tz || !isValidIanaTimeZone(tz)) continue

    if (!location.workingHours || !isRecord(location.workingHours)) continue

    if (
      locationType === ServiceLocationType.SALON &&
      !normalizeAddress(location.formattedAddress)
    ) {
      continue
    }

    const distanceMiles = haversineMiles(center, { lat, lng })
    if (distanceMiles > radiusMiles) continue

    const prev = bestByPro.get(location.professionalId)
    if (!prev) {
      bestByPro.set(location.professionalId, {
        locationId: location.id,
        timeZone: tz,
        distanceMiles,
        isPrimary: Boolean(location.isPrimary),
        createdAt: location.createdAt,
        city: location.city ?? null,
        formattedAddress: normalizeAddress(location.formattedAddress),
      })
      continue
    }

    const better =
      distanceMiles < prev.distanceMiles ||
      (Math.abs(distanceMiles - prev.distanceMiles) < 1e-9 &&
        Boolean(location.isPrimary) &&
        !prev.isPrimary) ||
      (Math.abs(distanceMiles - prev.distanceMiles) < 1e-9 &&
        Boolean(location.isPrimary) === prev.isPrimary &&
        location.createdAt < prev.createdAt)

    if (better) {
      bestByPro.set(location.professionalId, {
        locationId: location.id,
        timeZone: tz,
        distanceMiles,
        isPrimary: Boolean(location.isPrimary),
        createdAt: location.createdAt,
        city: location.city ?? null,
        formattedAddress: normalizeAddress(location.formattedAddress),
      })
    }
  }

  const proIds = Array.from(bestByPro.keys())
  if (!proIds.length) return []

  const offeringRows = await prisma.professionalServiceOffering.findMany({
    where: {
      professionalId: { in: proIds },
      serviceId,
      isActive: true,
      ...(locationType === ServiceLocationType.MOBILE
        ? {
            offersMobile: true,
            mobilePriceStartingAt: { not: null },
            mobileDurationMinutes: { not: null },
          }
        : {
            offersInSalon: true,
            salonPriceStartingAt: { not: null },
            salonDurationMinutes: { not: null },
          }),
    },
    select: {
      id: true,
      professionalId: true,
      professional: {
        select: {
          id: true,
          businessName: true,
          avatarUrl: true,
          location: true,
        },
      },
    },
    take: 2000,
  })

  const offeringByPro = new Map<
    string,
    {
      offeringId: string
      businessName: string | null
      avatarUrl: string | null
      proLocation: string | null
    }
  >()

  for (const offering of offeringRows) {
    offeringByPro.set(offering.professionalId, {
      offeringId: offering.id,
      businessName: offering.professional.businessName ?? null,
      avatarUrl: offering.professional.avatarUrl ?? null,
      proLocation: offering.professional.location ?? null,
    })
  }

  const out: OtherProRow[] = []

  for (const proId of proIds) {
    const best = bestByPro.get(proId)
    const offering = offeringByPro.get(proId)
    if (!best || !offering) continue

    const locationLabel =
      (offering.proLocation && offering.proLocation.trim()) ||
      (best.city && best.city.trim()) ||
      (best.formattedAddress && best.formattedAddress.trim()) ||
      null

    out.push({
      id: proId,
      businessName: offering.businessName,
      avatarUrl: offering.avatarUrl,
      location: locationLabel,
      offeringId: offering.offeringId,
      timeZone: best.timeZone,
      locationId: best.locationId,
      distanceMiles: Math.round(best.distanceMiles * 10) / 10,
    })
  }

  out.sort((a, b) => a.distanceMiles - b.distanceMiles)
  return out.slice(0, Math.max(0, limit))
}

async function loadOtherProsNearbyCached(args: {
  centerLat: number
  centerLng: number
  radiusMiles: number
  serviceId: string
  locationType: ServiceLocationType
  excludeProfessionalId: string
  limit: number
  cacheEnabled: boolean
}): Promise<OtherProRow[]> {
  if (!args.cacheEnabled || !redis) {
    return loadOtherProsNearby({
      centerLat: args.centerLat,
      centerLng: args.centerLng,
      radiusMiles: args.radiusMiles,
      serviceId: args.serviceId,
      locationType: args.locationType,
      excludeProfessionalId: args.excludeProfessionalId,
      limit: args.limit,
    })
  }

  const key = [
    'avail:otherPros:v1',
    args.serviceId,
    args.locationType,
    args.excludeProfessionalId,
    String(Math.round(args.centerLat * 1000) / 1000),
    String(Math.round(args.centerLng * 1000) / 1000),
    String(Math.round(args.radiusMiles * 10) / 10),
    String(args.limit),
  ].join(':')

  const hit = await cacheGetJson<unknown>(key)
  if (Array.isArray(hit)) {
    const parsed: OtherProRow[] = []

    for (const row of hit) {
      if (!isRecord(row)) continue

      const id = pickString(row.id)
      const offeringId = pickString(row.offeringId)
      const timeZone = pickString(row.timeZone)
      const locationId = pickString(row.locationId)
      const distanceMilesRaw =
        typeof row.distanceMiles === 'number' ? row.distanceMiles : Number.NaN

      if (
        !id ||
        !offeringId ||
        !timeZone ||
        !locationId ||
        !Number.isFinite(distanceMilesRaw)
      ) {
        continue
      }

      parsed.push({
        id,
        businessName: pickString(row.businessName) ?? null,
        avatarUrl: pickString(row.avatarUrl) ?? null,
        location: pickString(row.location) ?? null,
        offeringId,
        timeZone,
        locationId,
        distanceMiles: distanceMilesRaw,
      })
    }

    if (parsed.length > 0) {
      return parsed
    }
  }

  const fresh = await loadOtherProsNearby({
    centerLat: args.centerLat,
    centerLng: args.centerLng,
    radiusMiles: args.radiusMiles,
    serviceId: args.serviceId,
    locationType: args.locationType,
    excludeProfessionalId: args.excludeProfessionalId,
    limit: args.limit,
  })

  void cacheSetJson(key, fresh, TTL_OTHER_PROS_SECONDS)

  return fresh
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url)

    const professionalId = pickString(searchParams.get('professionalId'))
    const serviceId = pickString(searchParams.get('serviceId'))
    const mediaId = pickString(searchParams.get('mediaId'))
    const clientAddressId = pickString(searchParams.get('clientAddressId'))

    const requestedLocationType = normalizeLocationType(
      searchParams.get('locationType'),
    )
    const requestedLocationId = pickString(searchParams.get('locationId'))
    const dateStr = pickString(searchParams.get('date'))

    const addOnIds = parseCommaIds(searchParams.get('addOnIds')).sort()
    const debug = pickString(searchParams.get('debug')) === '1'

    const stepRaw =
      pickString(searchParams.get('stepMinutes')) ||
      pickString(searchParams.get('step'))

    const leadRaw =
      pickString(searchParams.get('leadMinutes')) ||
      pickString(searchParams.get('leadTimeMinutes')) ||
      pickString(searchParams.get('lead')) ||
      null

    const viewerLat = parseFloatParam(searchParams.get('viewerLat'))
    const viewerLng = parseFloatParam(searchParams.get('viewerLng'))
    const radiusMilesRaw = parseFloatParam(searchParams.get('radiusMiles'))
    const radiusMiles = clampFloat(radiusMilesRaw ?? 15, 5, 50)

    if (!professionalId || !serviceId) {
      return jsonFail(400, 'Missing professionalId or serviceId.')
    }

    const [pro, service, offering] = await Promise.all([
      prisma.professionalProfile.findUnique({
        where: { id: professionalId },
        select: {
          id: true,
          businessName: true,
          avatarUrl: true,
          location: true,
        },
      }),
      prisma.service.findUnique({
        where: { id: serviceId },
        select: {
          id: true,
          name: true,
          category: { select: { name: true } },
        },
      }),
      prisma.professionalServiceOffering.findFirst({
        where: {
          professionalId,
          serviceId,
          isActive: true,
        },
        select: {
          id: true,
          offersInSalon: true,
          offersMobile: true,
          salonDurationMinutes: true,
          mobileDurationMinutes: true,
          salonPriceStartingAt: true,
          mobilePriceStartingAt: true,
        },
      }),
    ])

    if (!pro) return jsonFail(404, 'Professional not found')
    if (!service) return jsonFail(404, 'Service not found')
    if (!offering) return jsonFail(404, 'Offering not found')

    const offeringSnapshot = buildOfferingSnapshot(offering)

    const placement = await resolveAvailabilityPlacement({
      professionalId,
      offering: offeringSnapshot,
      requestedLocationType,
      requestedLocationId,
      clientAddressId,
    })

    if (!placement.ok) {
      return jsonFail(400, placement.error)
    }

    let {
      location,
      locationId,
      locationType: effectiveLocationType,
      timeZone,
      workingHours,
      stepMinutes: defaultStepMinutes,
      leadTimeMinutes: defaultLead,
      locationBufferMinutes,
      maxAdvanceDays,
      durationMinutes,
    } = placement

    const stepMinutes =
      debug && stepRaw
        ? normalizeStepMinutes(stepRaw, defaultStepMinutes)
        : defaultStepMinutes

    const leadTimeMinutes =
      debug && leadRaw
        ? clampInt(toInt(leadRaw, defaultLead), 0, MAX_LEAD_MINUTES)
        : defaultLead

    if (addOnIds.length) {
      const addOnLinks = await prisma.offeringAddOn.findMany({
        where: {
          id: { in: addOnIds },
          offeringId: offering.id,
          isActive: true,
          OR: [{ locationType: null }, { locationType: effectiveLocationType }],
          addOnService: {
            isActive: true,
            isAddOnEligible: true,
          },
        },
        select: {
          id: true,
          addOnServiceId: true,
          durationOverrideMinutes: true,
          addOnService: {
            select: { defaultDurationMinutes: true },
          },
        },
        take: 50,
      })

      if (addOnLinks.length !== addOnIds.length) {
        return jsonFail(400, 'One or more add-ons are invalid for this offering.')
      }

      const addOnServiceIds = addOnLinks.map((x) => x.addOnServiceId)

      const proAddOnOfferings = await prisma.professionalServiceOffering.findMany({
        where: {
          professionalId,
          isActive: true,
          serviceId: { in: addOnServiceIds },
        },
        select: {
          serviceId: true,
          salonDurationMinutes: true,
          mobileDurationMinutes: true,
        },
        take: 200,
      })

      const byServiceId = new Map(
        proAddOnOfferings.map((o) => [o.serviceId, o]),
      )

      const addOnDurationTotal = addOnLinks.reduce((sum, link) => {
        const proOffering = byServiceId.get(link.addOnServiceId) ?? null

        const raw =
          link.durationOverrideMinutes ??
          (effectiveLocationType === ServiceLocationType.MOBILE
            ? proOffering?.mobileDurationMinutes
            : proOffering?.salonDurationMinutes) ??
          link.addOnService.defaultDurationMinutes ??
          0

        const duration = Number(raw || 0)
        return sum + (Number.isFinite(duration) && duration > 0 ? duration : 0)
      }, 0)

      durationMinutes = clampInt(
        durationMinutes + addOnDurationTotal,
        15,
        MAX_SLOT_DURATION_MINUTES,
      )
    }

    const offeringPayload = {
      id: offering.id,
      offersInSalon: Boolean(offering.offersInSalon),
      offersMobile: Boolean(offering.offersMobile),
      salonDurationMinutes: offering.salonDurationMinutes ?? null,
      mobileDurationMinutes: offering.mobileDurationMinutes ?? null,
      salonPriceStartingAt: offering.salonPriceStartingAt ?? null,
      mobilePriceStartingAt: offering.mobilePriceStartingAt ?? null,
    }

    const nowUtc = new Date()
    const nowParts = getZonedParts(nowUtc, timeZone)
    const todayYMD = {
      year: nowParts.year,
      month: nowParts.month,
      day: nowParts.day,
    }

    if (!dateStr) {
      const cacheKey = debug
        ? null
        : [
            'avail:summary:v5',
            professionalId,
            serviceId,
            locationId,
            effectiveLocationType,
            timeZone,
            String(stepMinutes),
            String(leadTimeMinutes),
            String(locationBufferMinutes),
            String(maxAdvanceDays),
            stableHash({
              addOnIds,
              viewerLat,
              viewerLng,
              radiusMiles,
              clientAddressId: effectiveLocationType === ServiceLocationType.MOBILE
                ? clientAddressId
                : null,
            }),
          ].join(':')

      if (cacheKey) {
        const hit = await cacheGetJson<unknown>(cacheKey)
        if (hit && isRecord(hit) && hit.ok === true && hit.mode === 'SUMMARY') {
          return jsonOk({
            ...(hit as Record<string, unknown>),
            mediaId: mediaId || null,
          })
        }
      }

      const daysAhead = Math.min(14, maxAdvanceDays)
      const ymds = Array.from({ length: daysAhead }, (_, i) =>
        addDaysToYMD(todayYMD.year, todayYMD.month, todayYMD.day, i),
      )

      const firstBounds = computeDayBoundsUtc(ymds[0], timeZone)
      const lastBounds = computeDayBoundsUtc(ymds[ymds.length - 1], timeZone)

      const windowStartUtc = addMinutes(
        firstBounds.dayStartUtc,
        -(MAX_SLOT_DURATION_MINUTES + MAX_BUFFER_MINUTES),
      )
      const windowEndUtc = addMinutes(
        lastBounds.dayEndExclusiveUtc,
        MAX_SLOT_DURATION_MINUTES + MAX_BUFFER_MINUTES,
      )

      const busy = await loadBusyIntervals({
        professionalId,
        locationId,
        windowStartUtc,
        windowEndUtc,
        nowUtc,
        fallbackDurationMinutes: durationMinutes,
        locationBufferMinutes,
        cache: { enabled: !debug },
      })

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
            busy,
            debug: false,
          })

          return {
            ymd,
            result,
          }
        }),
      )

      const availableDays: Array<{ date: string; slotCount: number }> = []
      let firstError: string | null = null

      for (const row of dayResults) {
        if (!row.result.ok) {
          firstError = firstError ?? row.result.error
          continue
        }

        if (row.result.slots.length > 0) {
          availableDays.push({
            date: ymdToString(row.ymd),
            slotCount: row.result.slots.length,
          })
        }
      }

      const fallbackLat = decimalToNumber(location.lat)
      const fallbackLng = decimalToNumber(location.lng)
      const hasViewer =
        typeof viewerLat === 'number' && typeof viewerLng === 'number'

      const centerLat = hasViewer ? viewerLat : fallbackLat
      const centerLng = hasViewer ? viewerLng : fallbackLng

      const otherPros =
        centerLat != null && centerLng != null
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
          : []

      const payload = {
        ok: true,
        mode: 'SUMMARY' as const,
        mediaId: mediaId || null,
        serviceId,
        professionalId,

        serviceName: service.name,
        serviceCategoryName: service.category?.name ?? null,

        locationType: effectiveLocationType,
        locationId,
        timeZone,

        stepMinutes,
        leadTimeMinutes,
        locationBufferMinutes,
        adjacencyBufferMinutes: locationBufferMinutes,
        maxDaysAhead: maxAdvanceDays,
        durationMinutes,

        primaryPro: {
          id: pro.id,
          businessName: pro.businessName ?? null,
          avatarUrl: pro.avatarUrl ?? null,
          location: pro.location ?? null,
          offeringId: offering.id,
          isCreator: true as const,
          timeZone,
          locationId,
        },

        availableDays,
        otherPros,
        waitlistSupported: true,
        offering: offeringPayload,

        ...(debug
          ? {
              debug: {
                emptyReason: !availableDays.length ? firstError ?? 'none' : null,
                otherProsCount: otherPros.length,
                center:
                  centerLat != null && centerLng != null
                    ? { lat: centerLat, lng: centerLng, radiusMiles }
                    : null,
                usedViewerCenter: Boolean(hasViewer),
                addOnIds,
                clientAddressId:
                  effectiveLocationType === ServiceLocationType.MOBILE
                    ? clientAddressId || null
                    : null,
              },
            }
          : {}),
      }

      if (cacheKey) {
        void cacheSetJson(
          cacheKey,
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
      : [
          'avail:day:v5',
          professionalId,
          serviceId,
          locationId,
          effectiveLocationType,
          dateStr,
          timeZone,
          String(stepMinutes),
          String(leadTimeMinutes),
          String(locationBufferMinutes),
          stableHash({
            addOnIds,
            durationMinutes,
            clientAddressId:
              effectiveLocationType === ServiceLocationType.MOBILE
                ? clientAddressId
                : null,
          }),
        ].join(':')

    if (dayCacheKey) {
      const hit = await cacheGetJson<unknown>(dayCacheKey)
      if (hit && isRecord(hit) && hit.ok === true && hit.mode === 'DAY') {
        return jsonOk(hit)
      }
    }

    const bounds = computeDayBoundsUtc(ymd, timeZone)
    const windowStartUtc = addMinutes(
      bounds.dayStartUtc,
      -(MAX_SLOT_DURATION_MINUTES + MAX_BUFFER_MINUTES),
    )
    const windowEndUtc = addMinutes(
      bounds.dayEndExclusiveUtc,
      MAX_SLOT_DURATION_MINUTES + MAX_BUFFER_MINUTES,
    )

    const busy = await loadBusyIntervals({
      professionalId,
      locationId,
      windowStartUtc,
      windowEndUtc,
      nowUtc,
      fallbackDurationMinutes: durationMinutes,
      locationBufferMinutes,
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
      busy,
      debug,
    })

    if (!result.ok) {
      return jsonFail(400, result.error, {
        locationId,
        timeZone,
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
            clientAddressId:
              effectiveLocationType === ServiceLocationType.MOBILE
                ? clientAddressId || null
                : null,
          }
        : {}),
    }

    if (dayCacheKey) {
      void cacheSetJson(dayCacheKey, payload, TTL_DAY_SECONDS)
    }

    return jsonOk(payload)
  } catch (err: unknown) {
    console.error('GET /api/availability/day error', err)
    return jsonFail(500, 'Failed to load availability')
  }
}