// lib/discovery/nearby.ts
import { Prisma, type ProfessionType } from '@prisma/client'
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

function normalizeQuery(q: string): string {
  return q.trim().toLowerCase()
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

function localNowMinutes(timeZone: string): number | null {
  const tz = timeZone.trim()
  if (!tz) return null

  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(new Date())

  const hour = parts.find((part) => part.type === 'hour')?.value
  const minute = parts.find((part) => part.type === 'minute')?.value

  const hh = hour ? Number(hour) : NaN
  const mm = minute ? Number(minute) : NaN

  if (!Number.isFinite(hh) || !Number.isFinite(mm)) return null

  return hh * 60 + mm
}

export function haversineMiles(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  const R = 3958.7613
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
  return R * c
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

export function inferProfessionTypesFromQuery(
  q: string,
): ProfessionType[] {
  const s = normalizeQuery(q)
  const hits: ProfessionType[] = []

  if (s.includes('barber')) hits.push('BARBER')
  if (
    s.includes('cosmo') ||
    s.includes('hair') ||
    s.includes('stylist')
  ) {
    hits.push('COSMETOLOGIST')
  }
  if (
    s.includes('esthetic') ||
    s.includes('facial') ||
    s.includes('skin')
  ) {
    hits.push('ESTHETICIAN')
  }
  if (
    s.includes('nail') ||
    s.includes('mani') ||
    s.includes('pedi')
  ) {
    hits.push('MANICURIST')
  }
  if (s.includes('massage')) hits.push('MASSAGE_THERAPIST')
  if (s.includes('makeup') || s.includes('mua')) {
    hits.push('MAKEUP_ARTIST')
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

export function pickPrimaryLocation(
  locations: readonly DiscoveryLocationDto[],
): DiscoveryLocationDto | null {
  return locations.find((location) => location.isPrimary) ?? locations[0] ?? null
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

  const nowMinutes = localNowMinutes(timeZone)
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

  const latDelta = milesToLatDelta(radiusMiles)
  const lngDelta = milesToLngDelta(radiusMiles, origin.lat)

  let best: ClosestDiscoveryLocationMatch | null = null

  for (const location of locations) {
    if (location.lat == null || location.lng == null) continue

    if (
      location.lat < origin.lat - latDelta ||
      location.lat > origin.lat + latDelta ||
      location.lng < origin.lng - lngDelta ||
      location.lng > origin.lng + lngDelta
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
  profileLocation: string | null
  location: Pick<DiscoveryLocationDto, 'city' | 'state'> | null
}): string | null {
  const profileLocation = args.profileLocation?.trim() ?? ''
  if (profileLocation) return profileLocation

  const city = args.location?.city?.trim() ?? ''
  const state = args.location?.state?.trim() ?? ''

  if (city && state) return `${city}, ${state}`
  if (city) return city
  if (state) return state

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