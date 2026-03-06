// app/api/availability/day/route.ts
import { prisma } from '@/lib/prisma'
import { Prisma, ProfessionalLocationType, ServiceLocationType } from '@prisma/client'
import { pickBookableLocation } from '@/lib/booking/pickLocation'
import type { BookableLocation } from '@/lib/booking/pickLocation'
import { sanitizeTimeZone, getZonedParts, zonedTimeToUtc, isValidIanaTimeZone } from '@/lib/timeZone'
import { pickString } from '@/app/api/_utils/pick'
import { jsonFail, jsonOk } from '@/app/api/_utils'
import { isRecord } from '@/lib/guards'
import { getRedis } from '@/lib/redis'
import { createHash } from 'crypto'
import { getWorkingWindowForDay } from '@/lib/scheduling/workingHours'

export const dynamic = 'force-dynamic'
// If you’re on Next “edge” runtime, you MUST remove crypto usage and I’ll adjust hashing.
// export const runtime = 'nodejs'

type WorkingHoursDay = { enabled?: boolean; start?: string; end?: string }
type WorkingHours = Record<string, WorkingHoursDay>
type BusyInterval = { start: Date; end: Date }

const MAX_SLOT_DURATION_MINUTES = 12 * 60
const MAX_LOCATION_BUFFER_MINUTES = 180
const MAX_LEAD_MINUTES = 30 * 24 * 60 // 30 days safety cap
const MAX_DAYS_AHEAD = 3650 // 10 years safety cap

// Cache TTLs (keep short to avoid “cached lies”)
const TTL_DAY_SECONDS = 60
const TTL_SUMMARY_SECONDS = 30
const TTL_BUSY_SECONDS = 45

function toInt(value: string | null, fallback: number) {
  const n = Number(value)
  return Number.isFinite(n) ? Math.trunc(n) : fallback
}

function clampInt(n: number, min: number, max: number) {
  const x = Math.trunc(n)
  return Math.min(Math.max(x, min), max)
}

function clampFloat(n: number, min: number, max: number) {
  if (!Number.isFinite(n)) return min
  return Math.min(Math.max(n, min), max)
}

function addMinutes(d: Date, minutes: number) {
  return new Date(d.getTime() + minutes * 60_000)
}

function normalizeToMinute(d: Date) {
  const x = new Date(d)
  x.setSeconds(0, 0)
  return x
}

/** existingStart < requestedEnd AND requestedStart < existingEnd */
function overlaps(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date) {
  return aStart < bEnd && bStart < aEnd
}

function normalizeLocationType(v: unknown): ServiceLocationType | null {
  const s = typeof v === 'string' ? v.trim().toUpperCase() : ''
  if (s === 'SALON') return ServiceLocationType.SALON
  if (s === 'MOBILE') return ServiceLocationType.MOBILE
  return null
}

function parseYYYYMMDD(s: unknown) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s ?? '').trim())
  if (!m) return null
  const year = Number(m[1])
  const month = Number(m[2])
  const day = Number(m[3])
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return null
  if (month < 1 || month > 12) return null
  if (day < 1 || day > 31) return null
  return { year, month, day }
}

function normalizeStepMinutes(input: unknown, fallback: number) {
  const n = typeof input === 'number' ? input : Number(input)
  const raw = Number.isFinite(n) ? Math.trunc(n) : fallback

  const allowed = new Set([5, 10, 15, 20, 30, 60])
  if (allowed.has(raw)) return raw

  if (raw <= 5) return 5
  if (raw <= 10) return 10
  if (raw <= 15) return 15
  if (raw <= 20) return 20
  if (raw <= 30) return 30
  return 60
}

function addDaysToYMD(year: number, month: number, day: number, daysToAdd: number) {
  const d = new Date(Date.UTC(year, month - 1, day + daysToAdd, 12, 0, 0, 0))
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() }
}

function ymdSerial(ymd: { year: number; month: number; day: number }) {
  return Math.floor(Date.UTC(ymd.year, ymd.month - 1, ymd.day, 12, 0, 0, 0) / 86_400_000)
}

function ymdToString(ymd: { year: number; month: number; day: number }) {
  const mm = String(ymd.month).padStart(2, '0')
  const dd = String(ymd.day).padStart(2, '0')
  return `${ymd.year}-${mm}-${dd}`
}


function pickModeDurationMinutes(
  offering: { salonDurationMinutes: number | null; mobileDurationMinutes: number | null },
  locationType: ServiceLocationType,
) {
  const d = locationType === ServiceLocationType.MOBILE ? offering.mobileDurationMinutes : offering.salonDurationMinutes
  const n = Number(d ?? 0)
  const base = Number.isFinite(n) && n > 0 ? n : 60
  return clampInt(base, 15, MAX_SLOT_DURATION_MINUTES)
}

function pickEffectiveLocationType(args: {
  requested: ServiceLocationType | null
  offersInSalon: boolean
  offersMobile: boolean
}): ServiceLocationType | null {
  const { requested, offersInSalon, offersMobile } = args
  if (requested === ServiceLocationType.SALON && offersInSalon) return ServiceLocationType.SALON
  if (requested === ServiceLocationType.MOBILE && offersMobile) return ServiceLocationType.MOBILE
  if (offersInSalon) return ServiceLocationType.SALON
  if (offersMobile) return ServiceLocationType.MOBILE
  return null
}

function computeDayBoundsUtc(dateYMD: { year: number; month: number; day: number }, timeZoneRaw: string) {
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

function mergeBusyIntervals(list: BusyInterval[]) {
  const sorted = list
    .filter((x) => x.start.getTime() < x.end.getTime())
    .sort((a, b) => a.start.getTime() - b.start.getTime())

  const out: BusyInterval[] = []
  for (const cur of sorted) {
    const prev = out[out.length - 1]
    if (!prev) {
      out.push({ start: new Date(cur.start), end: new Date(cur.end) })
      continue
    }
    if (cur.start.getTime() <= prev.end.getTime()) {
      if (cur.end.getTime() > prev.end.getTime()) prev.end = new Date(cur.end)
    } else {
      out.push({ start: new Date(cur.start), end: new Date(cur.end) })
    }
  }
  return out
}

function stableHash(input: unknown) {
  return createHash('sha256').update(JSON.stringify(input)).digest('hex').slice(0, 24)
}

// Redis helpers (fail-open)
const redis = getRedis()

async function cacheGetJson<T>(key: string): Promise<T | null> {
  if (!redis) return null
  try {
    const raw = await redis.get<string>(key)
    if (!raw) return null
    const parsed = JSON.parse(raw) as T
    return parsed
  } catch {
    return null
  }
}

async function cacheSetJson(key: string, value: unknown, ttlSeconds: number): Promise<void> {
  if (!redis) return
  try {
    await redis.set(key, JSON.stringify(value), { ex: ttlSeconds })
  } catch {
    // fail-open
  }
}

async function loadBusyIntervalsUncached(args: {
  professionalId: string
  locationId: string
  windowStartUtc: Date
  windowEndUtc: Date
  nowUtc: Date
  fallbackDurationMinutes: number
  locationBufferMinutes: number
}) {
  const { professionalId, locationId, windowStartUtc, windowEndUtc, nowUtc, fallbackDurationMinutes, locationBufferMinutes } = args

  const locBuf = clampInt(Number(locationBufferMinutes ?? 0) || 0, 0, MAX_LOCATION_BUFFER_MINUTES)

  const [bookings, holds, blocks] = await Promise.all([
    prisma.booking.findMany({
      where: {
        professionalId,
        locationId,
        scheduledFor: { gte: windowStartUtc, lt: windowEndUtc },
        NOT: { status: 'CANCELLED' },
      },
      select: { scheduledFor: true, totalDurationMinutes: true, bufferMinutes: true, status: true },
      take: 5000,
    }),

    prisma.bookingHold.findMany({
      where: {
        professionalId,
        locationId,
        scheduledFor: { gte: windowStartUtc, lt: windowEndUtc },
        expiresAt: { gt: nowUtc },
      },
      select: { id: true, scheduledFor: true, expiresAt: true, offeringId: true, locationType: true },
      take: 5000,
    }),

    prisma.calendarBlock.findMany({
      where: {
        professionalId,
        startsAt: { lt: windowEndUtc },
        endsAt: { gt: windowStartUtc },
        OR: [{ locationId: null }, { locationId }],
      },
      select: { startsAt: true, endsAt: true },
      take: 5000,
    }),
  ])

  const holdOfferingIds = Array.from(new Set(holds.map((h) => h.offeringId))).slice(0, 5000)
  const holdOfferings = holdOfferingIds.length
    ? await prisma.professionalServiceOffering.findMany({
        where: { id: { in: holdOfferingIds } },
        select: { id: true, salonDurationMinutes: true, mobileDurationMinutes: true },
        take: 5000,
      })
    : []

  const holdOfferingById = new Map(holdOfferings.map((o) => [o.id, o]))

  const busy: BusyInterval[] = [
    ...bookings
      .filter((b) => String(b.status ?? '').toUpperCase() !== 'CANCELLED')
      .map((b) => {
        const start = normalizeToMinute(new Date(b.scheduledFor))
        const baseDur = Number(b.totalDurationMinutes ?? fallbackDurationMinutes)
        const dur = Number.isFinite(baseDur) && baseDur > 0 ? clampInt(baseDur, 15, MAX_SLOT_DURATION_MINUTES) : fallbackDurationMinutes

        const bBufRaw = Number(b.bufferMinutes ?? locBuf)
        const bBuf = Number.isFinite(bBufRaw) ? clampInt(bBufRaw, 0, MAX_LOCATION_BUFFER_MINUTES) : locBuf

        return { start, end: addMinutes(start, dur + bBuf) }
      }),

    ...holds
      .filter((h) => new Date(h.expiresAt).getTime() > nowUtc.getTime())
      .map((h) => {
        const start = normalizeToMinute(new Date(h.scheduledFor))
        const off = holdOfferingById.get(h.offeringId) || null

        const durRaw = h.locationType === ServiceLocationType.MOBILE ? off?.mobileDurationMinutes : off?.salonDurationMinutes

        const baseDur = Number(durRaw ?? fallbackDurationMinutes)
        const dur = Number.isFinite(baseDur) && baseDur > 0 ? clampInt(baseDur, 15, MAX_SLOT_DURATION_MINUTES) : fallbackDurationMinutes

        return { start, end: addMinutes(start, dur + locBuf) }
      }),

    ...blocks.map((bl) => ({ start: new Date(bl.startsAt), end: new Date(bl.endsAt) })),
  ]

  return mergeBusyIntervals(busy)
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
}) {
  const cacheEnabled = Boolean(args.cache?.enabled)

  if (!cacheEnabled || !redis) {
    return loadBusyIntervalsUncached(args)
  }

  const key = [
    'avail:busy:v1',
    args.professionalId,
    args.locationId,
    args.windowStartUtc.toISOString(),
    args.windowEndUtc.toISOString(),
    // include buffer+fallback because it affects busy interval end times
    String(args.locationBufferMinutes ?? ''),
    String(args.fallbackDurationMinutes ?? ''),
  ].join(':')

  const hit = await cacheGetJson<{ busy: Array<{ start: string; end: string }> }>(key)
  if (hit?.busy?.length) {
    return mergeBusyIntervals(hit.busy.map((x) => ({ start: new Date(x.start), end: new Date(x.end) })))
  }

  const busy = await loadBusyIntervalsUncached(args)
  void cacheSetJson(
    key,
    { busy: busy.map((b) => ({ start: b.start.toISOString(), end: b.end.toISOString() })) },
    TTL_BUSY_SECONDS,
  )
  return busy
}

function isSlotFree(busy: BusyInterval[], slotStart: Date, slotEnd: Date) {
  for (let i = 0; i < busy.length; i++) {
    const bi = busy[i]
    if (bi.start.getTime() >= slotEnd.getTime()) return true
    if (overlaps(slotStart, slotEnd, bi.start, bi.end)) return false
  }
  return true
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
  | { ok: true; slots: string[]; dayStartUtc: Date; dayEndExclusiveUtc: Date; debug?: unknown }
  | { ok: false; error: string; dayStartUtc: Date; dayEndExclusiveUtc: Date; debug?: unknown }
> {
  const { dateYMD, durationMinutes, stepMinutes, timeZone: tzIn, workingHours, leadTimeMinutes, locationBufferMinutes, busy, debug } = args

  const { timeZone, dayStartUtc, dayEndExclusiveUtc } = computeDayBoundsUtc(dateYMD, tzIn)
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

  const dayKey = window.key
  const windowStartMin = window.startMinutes
  const windowEndMin = window.endMinutes

  const step = normalizeStepMinutes(stepMinutes, 30)
  const dur = clampInt(Number(durationMinutes || 60), 15, MAX_SLOT_DURATION_MINUTES)
  const buf = clampInt(Number(locationBufferMinutes ?? 0) || 0, 0, MAX_LOCATION_BUFFER_MINUTES)

  const cutoffUtc = addMinutes(nowUtc, clampInt(Number(leadTimeMinutes ?? 0) || 0, 0, MAX_LEAD_MINUTES))

  const slots: string[] = []

  for (let minute = windowStartMin; minute + dur + buf <= windowEndMin; minute += step) {
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

  return { ok: true, slots, dayStartUtc, dayEndExclusiveUtc, debug: debug ? { timeZone, dayKey } : undefined }
}

function decimalToNumber(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v
  if (v && typeof v === 'object' && typeof (v as { toNumber?: unknown }).toNumber === 'function') {
    const n = (v as { toNumber: () => number }).toNumber()
    return Number.isFinite(n) ? n : null
  }
  if (v && typeof v === 'object' && typeof (v as { toString?: unknown }).toString === 'function') {
    const n = Number(String((v as { toString: () => string }).toString()))
    return Number.isFinite(n) ? n : null
  }
  return null
}

function toDecimal(n: number): Prisma.Decimal {
  return new Prisma.Decimal(String(n))
}

function haversineMiles(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
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

function boundsForRadiusMiles(centerLat: number, centerLng: number, radiusMiles: number) {
  const latDelta = radiusMiles / 69
  const cos = Math.max(0.2, Math.cos((centerLat * Math.PI) / 180))
  const lngDelta = radiusMiles / (69 * cos)

  const minLat = clampFloat(centerLat - latDelta, -90, 90)
  const maxLat = clampFloat(centerLat + latDelta, -90, 90)
  const minLng = clampFloat(centerLng - lngDelta, -180, 180)
  const maxLng = clampFloat(centerLng + lngDelta, -180, 180)

  return { minLat, maxLat, minLng, maxLng }
}

function allowedProfessionalTypes(locationType: ServiceLocationType): ProfessionalLocationType[] {
  return locationType === ServiceLocationType.MOBILE
    ? [ProfessionalLocationType.MOBILE_BASE]
    : [ProfessionalLocationType.SALON, ProfessionalLocationType.SUITE]
}

function parseFloatParam(v: string | null) {
  if (!v) return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

function parseCommaIds(v: string | null) {
  if (!v) return []
  return v
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 25)
}

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

async function loadOtherProsNearby(args: {
  centerLat: number
  centerLng: number
  radiusMiles: number
  serviceId: string
  locationType: ServiceLocationType
  excludeProfessionalId: string
  limit: number
}): Promise<OtherProRow[]> {
  const { centerLat, centerLng, radiusMiles, serviceId, locationType, excludeProfessionalId, limit } = args
  const bounds = boundsForRadiusMiles(centerLat, centerLng, radiusMiles)
  const allowedTypes = allowedProfessionalTypes(locationType)

  const candidateLocs = await prisma.professionalLocation.findMany({
    where: {
      isBookable: true,
      professionalId: { not: excludeProfessionalId },
      type: { in: allowedTypes },
      timeZone: { not: null },
      workingHours: { not: Prisma.JsonNull },
      lat: { not: null, gte: toDecimal(bounds.minLat), lte: toDecimal(bounds.maxLat) },
      lng: { not: null, gte: toDecimal(bounds.minLng), lte: toDecimal(bounds.maxLng) },
    },
    select: {
      id: true,
      professionalId: true,
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

  for (const l of candidateLocs) {
    const lat = decimalToNumber(l.lat)
    const lng = decimalToNumber(l.lng)
    if (lat == null || lng == null) continue

    const tz = typeof l.timeZone === 'string' ? l.timeZone.trim() : ''
    if (!tz || !isValidIanaTimeZone(tz)) continue

    if (!l.workingHours || !isRecord(l.workingHours)) continue

    const d = haversineMiles(center, { lat, lng })
    if (d > radiusMiles) continue

    const prev = bestByPro.get(l.professionalId)
    if (!prev) {
      bestByPro.set(l.professionalId, {
        locationId: l.id,
        timeZone: tz,
        distanceMiles: d,
        isPrimary: Boolean(l.isPrimary),
        createdAt: l.createdAt,
        city: l.city ?? null,
        formattedAddress: l.formattedAddress ?? null,
      })
      continue
    }

    const better =
      d < prev.distanceMiles ||
      (Math.abs(d - prev.distanceMiles) < 1e-9 && Boolean(l.isPrimary) && !prev.isPrimary) ||
      (Math.abs(d - prev.distanceMiles) < 1e-9 && Boolean(l.isPrimary) === prev.isPrimary && l.createdAt < prev.createdAt)

    if (better) {
      bestByPro.set(l.professionalId, {
        locationId: l.id,
        timeZone: tz,
        distanceMiles: d,
        isPrimary: Boolean(l.isPrimary),
        createdAt: l.createdAt,
        city: l.city ?? null,
        formattedAddress: l.formattedAddress ?? null,
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
      ...(locationType === ServiceLocationType.MOBILE ? { offersMobile: true } : { offersInSalon: true }),
    },
    select: {
      id: true,
      professionalId: true,
      professional: { select: { id: true, businessName: true, avatarUrl: true, location: true } },
    },
    take: 2000,
  })

  const offeringByPro = new Map<string, { offeringId: string; businessName: string | null; avatarUrl: string | null; proLocation: string | null }>()
  for (const o of offeringRows) {
    offeringByPro.set(o.professionalId, {
      offeringId: o.id,
      businessName: o.professional.businessName ?? null,
      avatarUrl: o.professional.avatarUrl ?? null,
      proLocation: o.professional.location ?? null,
    })
  }

  const out: OtherProRow[] = []
  for (const proId of proIds) {
    const best = bestByPro.get(proId)
    const off = offeringByPro.get(proId)
    if (!best || !off) continue

    const locationLabel =
      (off.proLocation && off.proLocation.trim()) ||
      (best.city && best.city.trim()) ||
      (best.formattedAddress && best.formattedAddress.trim()) ||
      null

    out.push({
      id: proId,
      businessName: off.businessName,
      avatarUrl: off.avatarUrl,
      location: locationLabel,
      offeringId: off.offeringId,
      timeZone: best.timeZone,
      locationId: best.locationId,
      distanceMiles: Math.round(best.distanceMiles * 10) / 10,
    })
  }

  out.sort((a, b) => a.distanceMiles - b.distanceMiles)
  return out.slice(0, Math.max(0, limit))
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url)

    const professionalId = pickString(searchParams.get('professionalId'))
    const serviceId = pickString(searchParams.get('serviceId'))
    const mediaId = pickString(searchParams.get('mediaId'))

    const requestedLocationType = normalizeLocationType(searchParams.get('locationType'))
    const requestedLocationId = pickString(searchParams.get('locationId'))
    const dateStr = pickString(searchParams.get('date'))

    const addOnIds = parseCommaIds(searchParams.get('addOnIds')).sort()

    const debug = pickString(searchParams.get('debug')) === '1'

    const stepRaw = pickString(searchParams.get('stepMinutes')) || pickString(searchParams.get('step'))
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

    // NOTE: For cache keys we need values that affect output.
    // We intentionally do NOT include mediaId; it is just echoed back.

    const [pro, service, offering] = await Promise.all([
      prisma.professionalProfile.findUnique({
        where: { id: professionalId },
        select: { id: true, businessName: true, avatarUrl: true, location: true },
      }),
      prisma.service.findUnique({
        where: { id: serviceId },
        select: { id: true, name: true, category: { select: { name: true } } },
      }),
      prisma.professionalServiceOffering.findFirst({
        where: { professionalId, serviceId, isActive: true },
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

    let effectiveLocationType =
      pickEffectiveLocationType({
        requested: requestedLocationType,
        offersInSalon: Boolean(offering.offersInSalon),
        offersMobile: Boolean(offering.offersMobile),
      }) ?? null

    if (!effectiveLocationType) {
      return jsonFail(400, 'This service is not bookable.')
    }

    let loc: BookableLocation | null = await pickBookableLocation({
      professionalId,
      requestedLocationId,
      locationType: effectiveLocationType,
    })

    if (!loc) {
      const canTryMobile = effectiveLocationType === ServiceLocationType.SALON && Boolean(offering.offersMobile)
      const canTrySalon = effectiveLocationType === ServiceLocationType.MOBILE && Boolean(offering.offersInSalon)

      if (canTryMobile) {
        const alt = await pickBookableLocation({ professionalId, requestedLocationId: null, locationType: ServiceLocationType.MOBILE })
        if (alt) {
          loc = alt
          effectiveLocationType = ServiceLocationType.MOBILE
        }
      } else if (canTrySalon) {
        const alt = await pickBookableLocation({ professionalId, requestedLocationId: null, locationType: ServiceLocationType.SALON })
        if (alt) {
          loc = alt
          effectiveLocationType = ServiceLocationType.SALON
        }
      }
    }

    if (!loc) return jsonFail(400, 'No bookable location found.')

    const locId = loc.id
    const timeZone = sanitizeTimeZone(loc.timeZone, 'UTC')
    if (!isValidIanaTimeZone(timeZone)) {
      return jsonFail(400, 'This location must set a valid timezone before taking bookings.')
    }

    const workingHours = loc.workingHours

    const defaultStepMinutes = normalizeStepMinutes(loc.stepMinutes, 30)
    const stepMinutes = debug && stepRaw ? normalizeStepMinutes(stepRaw, defaultStepMinutes) : defaultStepMinutes

    const defaultLead = clampInt(Number(loc.advanceNoticeMinutes ?? 15) || 15, 0, MAX_LEAD_MINUTES)
    const leadTimeMinutes = leadRaw ? clampInt(toInt(leadRaw, defaultLead), 0, MAX_LEAD_MINUTES) : defaultLead

    const locationBufferMinutes = clampInt(Number(loc.bufferMinutes ?? 15) || 15, 0, MAX_LOCATION_BUFFER_MINUTES)
    const maxAdvanceDays = clampInt(Number(loc.maxDaysAhead ?? 365) || 365, 1, MAX_DAYS_AHEAD)

    // Base duration
    let durationMinutes = pickModeDurationMinutes(
      { salonDurationMinutes: offering.salonDurationMinutes, mobileDurationMinutes: offering.mobileDurationMinutes },
      effectiveLocationType,
    )

    // Add-ons affect duration
    if (addOnIds.length) {
      const addOnLinks = await prisma.offeringAddOn.findMany({
        where: {
          id: { in: addOnIds },
          offeringId: offering.id,
          isActive: true,
          OR: [{ locationType: null }, { locationType: effectiveLocationType }],
          addOnService: { isActive: true, isAddOnEligible: true },
        },
        select: {
          id: true,
          addOnServiceId: true,
          durationOverrideMinutes: true,
          addOnService: { select: { defaultDurationMinutes: true } },
        },
        take: 50,
      })

      if (addOnLinks.length !== addOnIds.length) {
        return jsonFail(400, 'One or more add-ons are invalid for this offering.')
      }

      const addOnServiceIds = addOnLinks.map((x) => x.addOnServiceId)

      const proAddOnOfferings = await prisma.professionalServiceOffering.findMany({
        where: { professionalId, isActive: true, serviceId: { in: addOnServiceIds } },
        select: { serviceId: true, salonDurationMinutes: true, mobileDurationMinutes: true },
        take: 200,
      })

      const byServiceId = new Map(proAddOnOfferings.map((o) => [o.serviceId, o]))

      const addOnDurTotal = addOnLinks.reduce((sum, x) => {
        const proOff = byServiceId.get(x.addOnServiceId) || null
        const durRaw =
          x.durationOverrideMinutes ??
          (effectiveLocationType === ServiceLocationType.MOBILE ? proOff?.mobileDurationMinutes : proOff?.salonDurationMinutes) ??
          x.addOnService.defaultDurationMinutes ??
          0

        const d = Number(durRaw || 0)
        return sum + (Number.isFinite(d) && d > 0 ? d : 0)
      }, 0)

      durationMinutes = clampInt(durationMinutes + addOnDurTotal, 15, MAX_SLOT_DURATION_MINUTES)
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
    const todayYMD = { year: nowParts.year, month: nowParts.month, day: nowParts.day }

    // -----------------------
    // SUMMARY MODE (no date)
    // -----------------------
    if (!dateStr) {
      const cacheKey = debug
        ? null
        : [
            'avail:summary:v1',
            professionalId,
            serviceId,
            locId,
            effectiveLocationType,
            timeZone,
            String(stepMinutes),
            String(leadTimeMinutes),
            String(locationBufferMinutes),
            String(maxAdvanceDays),
            stableHash({ addOnIds, viewerLat, viewerLng, radiusMiles }),
          ].join(':')

      if (cacheKey) {
        const hit = await cacheGetJson<unknown>(cacheKey)
        if (hit && isRecord(hit) && hit.ok === true && hit.mode === 'SUMMARY') {
          // re-inject mediaId (purely echo)
          return jsonOk({ ...(hit as Record<string, unknown>), mediaId: mediaId || null })
        }
      }

      const daysAhead = Math.min(14, maxAdvanceDays)
      const ymds = Array.from({ length: daysAhead }, (_, i) => addDaysToYMD(todayYMD.year, todayYMD.month, todayYMD.day, i))

      const firstBounds = computeDayBoundsUtc(ymds[0], timeZone)
      const lastBounds = computeDayBoundsUtc(ymds[ymds.length - 1], timeZone)

      const windowStartUtc = addMinutes(firstBounds.dayStartUtc, -(MAX_SLOT_DURATION_MINUTES + MAX_LOCATION_BUFFER_MINUTES))
      const windowEndUtc = addMinutes(lastBounds.dayEndExclusiveUtc, MAX_SLOT_DURATION_MINUTES + MAX_LOCATION_BUFFER_MINUTES)

      const busy = await loadBusyIntervals({
        professionalId,
        locationId: locId,
        windowStartUtc,
        windowEndUtc,
        nowUtc,
        fallbackDurationMinutes: durationMinutes,
        locationBufferMinutes,
        cache: { enabled: !debug },
      })

      const availableDays: Array<{ date: string; slotCount: number }> = []
      let firstError: string | null = null

      for (const ymd of ymds) {
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

        if (!result.ok) {
          firstError = firstError ?? result.error
          continue
        }
        if (result.slots.length) availableDays.push({ date: ymdToString(ymd), slotCount: result.slots.length })
      }

      const fallbackLat = decimalToNumber(loc.lat)
      const fallbackLng = decimalToNumber(loc.lng)
      const hasViewer = typeof viewerLat === 'number' && typeof viewerLng === 'number'
      const centerLat = hasViewer ? viewerLat! : fallbackLat
      const centerLng = hasViewer ? viewerLng! : fallbackLng

      const otherPros =
        centerLat != null && centerLng != null
          ? await loadOtherProsNearby({
              centerLat,
              centerLng,
              radiusMiles,
              serviceId,
              locationType: effectiveLocationType,
              excludeProfessionalId: professionalId,
              limit: 6,
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
        locationId: locId,
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
          locationId: locId,
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
                center: centerLat != null && centerLng != null ? { lat: centerLat, lng: centerLng, radiusMiles } : null,
                usedViewerCenter: Boolean(hasViewer),
                addOnIds,
              },
            }
          : {}),
      }

      if (cacheKey) void cacheSetJson(cacheKey, { ...payload, mediaId: null }, TTL_SUMMARY_SECONDS)

      return jsonOk(payload)
    }

    // -----------------------
    // DAY MODE (date present)
    // -----------------------
    const ymd = parseYYYYMMDD(dateStr)
    if (!ymd) return jsonFail(400, 'Invalid date. Use YYYY-MM-DD.')

    const dayDiff = ymdSerial(ymd) - ymdSerial(todayYMD)
    if (dayDiff < 0) return jsonFail(400, 'Date is in the past.')
    if (dayDiff > maxAdvanceDays) return jsonFail(400, `You can book up to ${maxAdvanceDays} days in advance.`)

    const dayCacheKey = debug
      ? null
      : [
          'avail:day:v1',
          professionalId,
          serviceId,
          locId,
          effectiveLocationType,
          dateStr,
          timeZone,
          String(stepMinutes),
          String(leadTimeMinutes),
          String(locationBufferMinutes),
          stableHash({ addOnIds, durationMinutes }),
        ].join(':')

    if (dayCacheKey) {
      const hit = await cacheGetJson<unknown>(dayCacheKey)
      if (hit && isRecord(hit) && hit.ok === true && hit.mode === 'DAY') {
        return jsonOk(hit)
      }
    }

    const bounds = computeDayBoundsUtc(ymd, timeZone)
    const windowStartUtc = addMinutes(bounds.dayStartUtc, -(MAX_SLOT_DURATION_MINUTES + MAX_LOCATION_BUFFER_MINUTES))
    const windowEndUtc = addMinutes(bounds.dayEndExclusiveUtc, MAX_SLOT_DURATION_MINUTES + MAX_LOCATION_BUFFER_MINUTES)

    const busy = await loadBusyIntervals({
      professionalId,
      locationId: locId,
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
        locationId: locId,
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

      locationId: locId,
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
      ...(debug ? { debug: result.debug, addOnIds } : {}),
    }

    if (dayCacheKey) void cacheSetJson(dayCacheKey, payload, TTL_DAY_SECONDS)

    return jsonOk(payload)
  } catch (err: unknown) {
    console.error('GET /api/availability/day error', err)
    return jsonFail(500, 'Failed to load availability')
  }
}