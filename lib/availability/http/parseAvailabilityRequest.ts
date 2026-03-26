// availability/http/parseAvailabilityRequest.ts

import { ServiceLocationType } from '@prisma/client'

import { pickString } from '@/app/api/_utils/pick'
import { normalizeLocationType } from '@/lib/booking/locationContext'

export type ParsedAvailabilityRequest = {
  professionalId: string | null
  serviceId: string | null
  mediaId: string | null
  clientAddressId: string | null

  requestedLocationType: ServiceLocationType | null
  requestedLocationId: string | null

  dateStr: string | null
  startDateStr: string | null
  requestedSummaryDaysRaw: string | null

  addOnIds: string[]
  debug: boolean
  includeOtherPros: boolean

  stepRaw: string | null
  leadRaw: string | null

  viewerLat: number | null
  viewerLng: number | null
  roundedViewerLat: number | null
  roundedViewerLng: number | null

  radiusMilesRaw: number | null
  radiusMiles: number
}

const DEFAULT_RADIUS_MILES = 15
const MIN_RADIUS_MILES = 5
const MAX_RADIUS_MILES = 50

function clampFloat(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min
  return Math.min(Math.max(value, min), max)
}

function parseFloatParam(value: string | null): number | null {
  if (!value) return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function roundCoordForCache(value: number | null): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null
  return Math.round(value * 1000) / 1000
}

function parseCommaIds(value: string | null): string[] {
  if (!value) return []

  return value
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
    .slice(0, 25)
}

export function parseAvailabilityRequest(
  req: Request,
): ParsedAvailabilityRequest {
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
  const startDateStr = pickString(searchParams.get('startDate'))
  const requestedSummaryDaysRaw = pickString(searchParams.get('days'))

  const addOnIds = parseCommaIds(searchParams.get('addOnIds')).sort()

  const debug = pickString(searchParams.get('debug')) === '1'
  const includeOtherPros =
    pickString(searchParams.get('includeOtherPros')) !== '0'

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
  const roundedViewerLat = roundCoordForCache(viewerLat)
  const roundedViewerLng = roundCoordForCache(viewerLng)

  const radiusMilesRaw = parseFloatParam(searchParams.get('radiusMiles'))
  const radiusMiles = clampFloat(
    radiusMilesRaw ?? DEFAULT_RADIUS_MILES,
    MIN_RADIUS_MILES,
    MAX_RADIUS_MILES,
  )

  return {
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
    roundedViewerLat,
    roundedViewerLng,

    radiusMilesRaw,
    radiusMiles,
  }
}