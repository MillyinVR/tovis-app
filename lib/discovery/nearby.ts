// lib/discovery/nearby.ts
import { Prisma, ProfessionType } from '@prisma/client'

import { getWorkingWindowForDay } from '@/lib/scheduling/workingHours'

export type DiscoveryLocationDto = {
  id: string
  formattedAddress: string | null
  city: string | null
  state: string | null
  timeZone: string | null
  placeId: string | null
  lat: number | null
  lng: number | null
  isPrimary: boolean
  workingHours: unknown
}

export type ClosestDiscoveryLocationMatch = {
  location: DiscoveryLocationDto
  distanceMiles: number
}

export type DiscoveryOfferingInput = {
  professionalId: string
  offersInSalon: boolean
  offersMobile: boolean
  salonPriceStartingAt: Prisma.Decimal | number | string | null
  mobilePriceStartingAt: Prisma.Decimal | number | string | null
  categoryId: string | null
}

export type DiscoveryOfferSummaryDto = {
  professionalId: string
  supportsSalon: boolean
  supportsMobile: boolean
  minSalon: number | null
  minMobile: number | null
  minAny: number | null
  categoryIds: string[]
}

function normalizeQuery(q: string): string {
  return q.trim().toLowerCase()
}

function normalizeOptionalId(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null

  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function clampFloat(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min
  return Math.min(Math.max(value, min), max)
}

function toFiniteNumber(value: unknown): number | null {
  if (value == null) return null

  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null
  }

  if (typeof value === 'string') {
    const n = Number(value)
    return Number.isFinite(n) ? n : null
  }

  if (value instanceof Prisma.Decimal) {
    return value.toNumber()
  }

  return null
}

function pushDistinctId(target: string[], value: string | null): void {
  if (!value) return
  if (target.includes(value)) return
  target.push(value)
}

function pickMin(current: number | null, candidate: number | null): number | null {
  if (candidate == null) return current
  if (current == null) return candidate
  return Math.min(current, candidate)
}

function localNowMinutes(timeZone: string, now: Date): number | null {
  const tz = timeZone.trim()
  if (!tz) return null

  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(now)

  const hour = parts.find((part) => part.type === 'hour')?.value
  const minute = parts.find((part) => part.type === 'minute')?.value

  const hh = hour ? Number(hour) : Number.NaN
  const mm = minute ? Number(minute) : Number.NaN

  if (!Number.isFinite(hh) || !Number.isFinite(mm)) return null

  return hh * 60 + mm
}

export function haversineMiles(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  const earthRadiusMiles = 3958.7613
  const toRad = (degrees: number) => (degrees * Math.PI) / 180

  const dLat = toRad(b.lat - a.lat)
  const dLng = toRad(b.lng - a.lng)
  const lat1 = toRad(a.lat)
  const lat2 = toRad(b.lat)

  const sin1 = Math.sin(dLat / 2)
  const sin2 = Math.sin(dLng / 2)

  const h =
    sin1 * sin1 +
    Math.cos(lat1) * Math.cos(lat2) * sin2 * sin2

  const c = 2 * Math.asin(Math.min(1, Math.sqrt(h)))
  return earthRadiusMiles * c
}

export function milesToLatDelta(miles: number): number {
  return miles / 69.0
}

export function milesToLngDelta(
  miles: number,
  lat: number,
): number {
  const denom = Math.cos((lat * Math.PI) / 180)

  if (!Number.isFinite(denom) || denom === 0) {
    return miles / 69.0
  }

  return miles / (69.0 * denom)
}

export function boundsForRadiusMiles(
  centerLat: number,
  centerLng: number,
  radiusMiles: number,
): {
  minLat: number
  maxLat: number
  minLng: number
  maxLng: number
} {
  const latDelta = milesToLatDelta(radiusMiles)
  const lngDelta = milesToLngDelta(radiusMiles, centerLat)

  return {
    minLat: clampFloat(centerLat - latDelta, -90, 90),
    maxLat: clampFloat(centerLat + latDelta, -90, 90),
    minLng: clampFloat(centerLng - lngDelta, -180, 180),
    maxLng: clampFloat(centerLng + lngDelta, -180, 180),
  }
}

export function inferProfessionTypesFromQuery(
  q: string,
): ProfessionType[] {
  const s = normalizeQuery(q)
  const hits: ProfessionType[] = []

  if (s.includes('barber')) {
    hits.push(ProfessionType.BARBER)
  }

  if (
    s.includes('cosmo') ||
    s.includes('hair') ||
    s.includes('stylist')
  ) {
    hits.push(ProfessionType.COSMETOLOGIST)
  }

  if (
    s.includes('esthetic') ||
    s.includes('facial') ||
    s.includes('skin')
  ) {
    hits.push(ProfessionType.ESTHETICIAN)
  }

  if (
    s.includes('nail') ||
    s.includes('mani') ||
    s.includes('pedi')
  ) {
    hits.push(ProfessionType.MANICURIST)
  }

  if (s.includes('massage')) {
    hits.push(ProfessionType.MASSAGE_THERAPIST)
  }

  if (s.includes('makeup') || s.includes('mua')) {
    hits.push(ProfessionType.MAKEUP_ARTIST)
  }

  return Array.from(new Set(hits))
}

export function mapProfessionalLocation(input: {
  id: string
  formattedAddress: string | null
  city: string | null
  state: string | null
  timeZone: string | null
  placeId: string | null
  lat: Prisma.Decimal | number | string | null
  lng: Prisma.Decimal | number | string | null
  isPrimary: boolean
  workingHours: unknown
}): DiscoveryLocationDto {
  return {
    id: input.id,
    formattedAddress: input.formattedAddress ?? null,
    city: input.city ?? null,
    state: input.state ?? null,
    timeZone: input.timeZone ?? null,
    placeId: input.placeId ?? null,
    lat: toFiniteNumber(input.lat),
    lng: toFiniteNumber(input.lng),
    isPrimary: Boolean(input.isPrimary),
    workingHours: input.workingHours,
  }
}

export function summarizeDiscoveryOfferingsForProfessional(args: {
  professionalId: string
  offerings: readonly DiscoveryOfferingInput[]
}): DiscoveryOfferSummaryDto {
  const professionalId = normalizeOptionalId(args.professionalId)
  if (!professionalId) {
    throw new Error('professionalId is required.')
  }

  const summary: DiscoveryOfferSummaryDto = {
    professionalId,
    supportsSalon: false,
    supportsMobile: false,
    minSalon: null,
    minMobile: null,
    minAny: null,
    categoryIds: [],
  }

  for (const offering of args.offerings) {
    if (offering.professionalId !== professionalId) continue

    const salonPrice = toFiniteNumber(offering.salonPriceStartingAt)
    const mobilePrice = toFiniteNumber(offering.mobilePriceStartingAt)
    const categoryId = normalizeOptionalId(offering.categoryId)

    if (offering.offersInSalon) {
      summary.supportsSalon = true
      summary.minSalon = pickMin(summary.minSalon, salonPrice)
    }

    if (offering.offersMobile) {
      summary.supportsMobile = true
      summary.minMobile = pickMin(summary.minMobile, mobilePrice)
    }

    pushDistinctId(summary.categoryIds, categoryId)
  }

  const candidates = [summary.minSalon, summary.minMobile].filter(
    (value): value is number => value != null,
  )

  summary.minAny =
    candidates.length > 0 ? Math.min(...candidates) : null

  return summary
}

export function buildDiscoveryOfferSummaryMap(
  offerings: readonly DiscoveryOfferingInput[],
): Map<string, DiscoveryOfferSummaryDto> {
  const grouped = new Map<string, DiscoveryOfferingInput[]>()

  for (const offering of offerings) {
    const professionalId = normalizeOptionalId(offering.professionalId)
    if (!professionalId) continue

    const current = grouped.get(professionalId) ?? []
    current.push(offering)
    grouped.set(professionalId, current)
  }

  const result = new Map<string, DiscoveryOfferSummaryDto>()

  for (const [professionalId, professionalOfferings] of grouped) {
    result.set(
      professionalId,
      summarizeDiscoveryOfferingsForProfessional({
        professionalId,
        offerings: professionalOfferings,
      }),
    )
  }

  return result
}

export function matchesRequestedDiscoveryCategory(args: {
  requestedCategoryId: string | null | undefined
  offeringCategoryIds: readonly string[] | null | undefined
}): boolean {
  const requestedCategoryId = normalizeOptionalId(args.requestedCategoryId)
  if (!requestedCategoryId) return true

  const categoryIds = (args.offeringCategoryIds ?? [])
    .map((id) => normalizeOptionalId(id))
    .filter((id): id is string => id !== null)

  return categoryIds.includes(requestedCategoryId)
}

export function matchesDiscoveryOfferingFilters(args: {
  offerSummary: Pick<
    DiscoveryOfferSummaryDto,
    'supportsMobile' | 'categoryIds'
  >
  mobileOnly?: boolean | null
  requestedCategoryId?: string | null
}): boolean {
  if (args.mobileOnly && !args.offerSummary.supportsMobile) {
    return false
  }

  return matchesRequestedDiscoveryCategory({
    requestedCategoryId: args.requestedCategoryId,
    offeringCategoryIds: args.offerSummary.categoryIds,
  })
}

export function pickPrimaryLocation(
  locations: readonly DiscoveryLocationDto[],
): DiscoveryLocationDto | null {
  return (
    locations.find((location) => location.isPrimary) ??
    locations[0] ??
    null
  )
}

export function isOpenNowAtLocation(args: {
  timeZone: string | null
  workingHours: unknown
  now?: Date
}): boolean {
  const timeZone = args.timeZone?.trim() ?? ''
  if (!timeZone) return false

  const now = args.now ?? new Date()
  const window = getWorkingWindowForDay(now, args.workingHours, timeZone)
  if (!window.ok) return false

  const nowMinutes = localNowMinutes(timeZone, now)
  if (nowMinutes == null) return false

  return (
    nowMinutes >= window.startMinutes &&
    nowMinutes <= window.endMinutes
  )
}

export function pickClosestLocationWithinRadius(args: {
  origin: { lat: number; lng: number }
  locations: readonly DiscoveryLocationDto[]
  radiusMiles: number
}): ClosestDiscoveryLocationMatch | null {
  const { origin, locations, radiusMiles } = args
  const bounds = boundsForRadiusMiles(
    origin.lat,
    origin.lng,
    radiusMiles,
  )

  let best: ClosestDiscoveryLocationMatch | null = null

  for (const location of locations) {
    if (location.lat == null || location.lng == null) continue

    if (
      location.lat < bounds.minLat ||
      location.lat > bounds.maxLat ||
      location.lng < bounds.minLng ||
      location.lng > bounds.maxLng
    ) {
      continue
    }

    const distanceMiles = haversineMiles(origin, {
      lat: location.lat,
      lng: location.lng,
    })

    if (!Number.isFinite(distanceMiles)) continue
    if (distanceMiles > radiusMiles) continue

    if (best === null || distanceMiles < best.distanceMiles) {
      best = {
        location,
        distanceMiles,
      }
    }
  }

  return best
}

export function buildDiscoveryLocationLabel(args: {
  location: Pick<
    DiscoveryLocationDto,
    'formattedAddress' | 'city' | 'state'
  > | null
}): string | null {
  const city = args.location?.city?.trim() ?? ''
  const state = args.location?.state?.trim() ?? ''
  const formattedAddress =
    args.location?.formattedAddress?.trim() ?? ''

  if (city && state) return `${city}, ${state}`
  if (city) return city
  if (state) return state
  if (formattedAddress) return formattedAddress

  return null
}

export function shouldExcludeSelfProfessional(args: {
  professionalId: string
  viewerProfessionalId: string | null | undefined
}): boolean {
  const viewerProfessionalId = args.viewerProfessionalId?.trim() ?? ''
  if (!viewerProfessionalId) return false

  return args.professionalId === viewerProfessionalId
}