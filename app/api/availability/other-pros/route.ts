// app/api/availability/other-pros/route.ts
import { createHash } from 'node:crypto'

import {
  Prisma,
  ProfessionalLocationType,
  ServiceLocationType,
} from '@prisma/client'

import { jsonFail, jsonOk } from '@/app/api/_utils'
import { pickString } from '@/app/api/_utils/pick'
import { loadOtherProsNearbyCached } from '@/lib/availability/data/otherPros'
import { getScheduleConfigVersion } from '@/lib/booking/cacheVersion'
import {
  normalizeLocationType,
  pickEffectiveLocationType,
  resolveValidatedBookingContext,
  type OfferingSchedulingSnapshot,
  type SchedulingReadinessError,
} from '@/lib/booking/locationContext'
import { withVersionedCache } from '@/lib/cache/versionedCache'
import { prisma, prismaRead } from '@/lib/prisma'
import { resolveTenantContextForRequest } from '@/lib/tenant'
import { sanitizeTimeZone } from '@/lib/timeZone'

export const dynamic = 'force-dynamic'

// Replaces the prior 600s TTL on the hand-rolled placement cache. Now that
// the cache key embeds `scheduleConfigVersion`, location/working-hours
// edits (which bump the version per P1.6) invalidate cache entries
// instantly; the TTL is just the staleness backstop. 120s mirrors the
// other availability routes.
const TTL_PLACEMENT_SECONDS = 120

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

type OtherProsRequestPayload = {
  professionalId: string
  serviceId: string
  requestedLocationType: ServiceLocationType | null
  requestedLocationId: string | null
  effectiveLocationType: ServiceLocationType
  locationId: string
  clientAddressId: string | null
  viewer: {
    lat: number
    lng: number
    radiusMiles: number
    placeId: string | null
  } | null
  limit: number
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
      lat: number | undefined
      lng: number | undefined
    }
  | {
      ok: false
      code: AvailabilityPlacementErrorCode
      error: string
    }

type PlacementCacheValue =
  | {
      kind: 'ok'
      locationId: string
      locationType: ServiceLocationType
      timeZone: string
      lat: number | null
      lng: number | null
    }
  | { kind: 'offering_not_found' }
  | {
      kind: 'placement_failed'
      code: AvailabilityPlacementErrorCode
      error: string
    }

function clampFloat(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min
  return Math.min(Math.max(value, min), max)
}

function normalizeAddress(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function parseFloatParam(v: string | null): number | null {
  if (!v) return null

  const n = Number(v)
  return Number.isFinite(n) ? n : null
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
    default:
      return 'Unable to validate scheduling for this service.'
  }
}

function buildOtherProsVersion(args: {
  professionalId: string
  serviceId: string
  requestedLocationType: ServiceLocationType | null
  requestedLocationId: string | null
  effectiveLocationType: ServiceLocationType
  locationId: string
  clientAddressId: string | null
  viewerLat: number | null
  viewerLng: number | null
  radiusMiles: number
  limit: number
}): string {
  const raw = JSON.stringify({
    v: 1,
    ...args,
  })

  const digest = createHash('sha256').update(raw).digest('hex')
  return `other-pros:${digest.slice(0, 24)}`
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
    timeZone: sanitizeTimeZone(context.timeZone, 'UTC'),
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

  if (allowedTypes.length === 0) {
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

  const attempts = await Promise.all(
    candidates.map(async (candidate) => {
      const locationType = locationTypeForLocation(candidate)

      return validateAvailabilityPlacement({
        professionalId,
        requestedLocationId: candidate.id,
        locationType,
        offering: args.offering,
        clientAddressId: args.clientAddressId,
        allowFallback: false,
      })
    }),
  )

  for (const attempt of attempts) {
    if (attempt.ok) return attempt
  }

  const firstMeaningfulError = attempts.find(
    (attempt) => !attempt.ok && attempt.code !== 'LOCATION_NOT_FOUND',
  )

  return (
    firstMeaningfulError ?? {
      ok: false,
      code: 'NO_SCHEDULING_READY_LOCATION',
      error: mapPlacementError('NO_SCHEDULING_READY_LOCATION'),
    }
  )
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url)

    const professionalId = pickString(searchParams.get('professionalId'))
    const serviceId = pickString(searchParams.get('serviceId'))
    const clientAddressId = pickString(searchParams.get('clientAddressId'))
    const requestedLocationType = normalizeLocationType(
      searchParams.get('locationType'),
    )
    const requestedLocationId = pickString(searchParams.get('locationId'))
    const debug = pickString(searchParams.get('debug')) === '1'

    const viewerLat = parseFloatParam(searchParams.get('viewerLat'))
    const viewerLng = parseFloatParam(searchParams.get('viewerLng'))
    const radiusMilesRaw = parseFloatParam(searchParams.get('radiusMiles'))
    const radiusMiles = clampFloat(radiusMilesRaw ?? 15, 5, 50)
    const limitRaw = parseFloatParam(searchParams.get('limit'))
    const limit = Math.min(Math.max(Math.trunc(limitRaw ?? 6), 1), 12)

    if (!professionalId || !serviceId) {
      return jsonFail(400, 'Missing professionalId or serviceId.')
    }

    // Placement reads (offering findFirst + resolveAvailabilityPlacement's
    // location queries) intentionally stay on primary `prisma`, consistent
    // with the bootstrap/day routes. The placement cache below absorbs
    // cold-cache cost; threading `prismaRead` through the validation chain
    // (resolveValidatedBookingContext + nested helpers) would be a deeper
    // change for marginal benefit.
    const loadPlacement = async (): Promise<PlacementCacheValue> => {
      const offering = await prisma.professionalServiceOffering.findFirst({
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
      })

      if (!offering) {
        return { kind: 'offering_not_found' }
      }

      const placement = await resolveAvailabilityPlacement({
        professionalId,
        offering: buildOfferingSnapshot(offering),
        requestedLocationType,
        requestedLocationId,
        clientAddressId,
      })

      if (!placement.ok) {
        return {
          kind: 'placement_failed',
          code: placement.code,
          error: placement.error,
        }
      }

      return {
        kind: 'ok',
        locationId: placement.locationId,
        locationType: placement.locationType,
        timeZone: placement.timeZone,
        lat: placement.lat ?? null,
        lng: placement.lng ?? null,
      }
    }

    let placementResult: PlacementCacheValue
    if (debug) {
      placementResult = await loadPlacement()
    } else {
      // Replaces the prior hand-rolled placement cache (TTL 600s, no
      // version keying). Now that `version` = scheduleConfigVersion, P1.6
      // bumps on location/working-hours edits invalidate this cache
      // instantly; TTL is the staleness backstop only.
      const scheduleConfigVersion = await getScheduleConfigVersion(
        professionalId,
      )
      const cacheExtra = [
        serviceId,
        requestedLocationType ?? 'AUTO',
        requestedLocationId ?? 'AUTO',
        clientAddressId ?? 'none',
      ].join(':')

      const cached = await withVersionedCache<PlacementCacheValue>(
        {
          scope: 'availability:other-pros:placement',
          scopeId: professionalId,
          version: scheduleConfigVersion,
          extra: cacheExtra,
        },
        loadPlacement,
        TTL_PLACEMENT_SECONDS,
      )
      placementResult = cached.value
    }

    if (placementResult.kind === 'offering_not_found') {
      return jsonFail(404, 'Offering not found')
    }

    if (placementResult.kind === 'placement_failed') {
      return jsonFail(400, placementResult.error)
    }

    const effectiveLocationType: ServiceLocationType =
      placementResult.locationType
    const placementLat: number | undefined =
      placementResult.lat ?? undefined
    const placementLng: number | undefined =
      placementResult.lng ?? undefined
    const locationId: string = placementResult.locationId
    const timeZone: string = placementResult.timeZone

    const hasViewer =
      typeof viewerLat === 'number' && typeof viewerLng === 'number'

    const centerLat = hasViewer ? viewerLat : placementLat
    const centerLng = hasViewer ? viewerLng : placementLng

    const request: OtherProsRequestPayload = {
      professionalId,
      serviceId,
      requestedLocationType,
      requestedLocationId,
      effectiveLocationType,
      locationId,
      clientAddressId,
      viewer:
        hasViewer && viewerLat != null && viewerLng != null
          ? {
              lat: viewerLat,
              lng: viewerLng,
              radiusMiles,
              placeId: pickString(searchParams.get('viewerPlaceId')),
            }
          : null,
      limit,
    }

    const generatedAt = new Date().toISOString()
    const availabilityVersion = buildOtherProsVersion({
      professionalId,
      serviceId,
      requestedLocationType,
      requestedLocationId,
      effectiveLocationType,
      locationId,
      clientAddressId,
      viewerLat,
      viewerLng,
      radiusMiles,
      limit,
    })

    if (centerLat == null || centerLng == null) {
      return jsonOk({
        ok: true,
        mode: 'OTHER_PROS',
        availabilityVersion,
        generatedAt,
        request,
        professionalId,
        serviceId,
        locationType: effectiveLocationType,
        locationId,
        timeZone,
        radiusMiles,
        usedViewerCenter: false,
        center: null,
        otherPros: [],
      })
    }

    const otherPros = await loadOtherProsNearbyCached({
      tenantContext: await resolveTenantContextForRequest(req),
      centerLat,
      centerLng,
      radiusMiles,
      serviceId,
      locationType: effectiveLocationType,
      excludeProfessionalId: professionalId,
      limit,
      cacheEnabled: !debug,
      client: prismaRead,
    })

    return jsonOk({
      ok: true,
      mode: 'OTHER_PROS',
      availabilityVersion,
      generatedAt,
      request,
      professionalId,
      serviceId,
      locationType: effectiveLocationType,
      locationId,
      timeZone,
      radiusMiles,
      usedViewerCenter: hasViewer,
      center: {
        lat: centerLat,
        lng: centerLng,
      },
      otherPros,
    })
  } catch (err: unknown) {
    console.error('GET /api/availability/other-pros error', err)
    return jsonFail(500, 'Failed to load nearby professionals')
  }
}
