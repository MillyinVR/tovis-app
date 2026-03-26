// lib/availability/data/offeringContext.ts

import { Prisma, ServiceLocationType } from '@prisma/client'

import {
  buildPlacementCacheKey,
  cacheGetJson,
  cacheSetJson,
} from '@/lib/availability/data/cache'
import {
  buildOfferingSnapshot,
  parseCachedPlacement,
  resolveAvailabilityPlacement,
  type AvailabilityPlacementResult,
  type AvailabilityTimeZoneSource,
  type CachedPlacement,
} from '@/lib/availability/core/placement'
import { type BookingErrorCode } from '@/lib/booking/errors'
import { prisma } from '@/lib/prisma'

const TTL_PLACEMENT_SECONDS = 300
const AVAILABILITY_PLACEMENT_CACHE_VERSION = 'phase2'

export type AvailabilityOfferingPayload = {
  id: string
  offersInSalon: boolean
  offersMobile: boolean
  salonDurationMinutes: number | null
  mobileDurationMinutes: number | null
  salonPriceStartingAt: unknown
  mobilePriceStartingAt: unknown
}

export type AvailabilityOfferingContext = {
  locationId: string
  effectiveLocationType: ServiceLocationType
  timeZone: string
  timeZoneSource: AvailabilityTimeZoneSource
  workingHours: unknown
  defaultStepMinutes: number
  defaultLead: number
  locationBufferMinutes: number
  maxAdvanceDays: number
  durationMinutes: number
  placementLat: number | undefined
  placementLng: number | undefined

  proBusinessName: string | null
  proAvatarUrl: string | null
  proLocation: string | null
  serviceName: string | null
  serviceCategoryName: string | null

  offeringDbId: string
  offeringPayload: AvailabilityOfferingPayload
}

export type LoadAvailabilityOfferingContextResult =
  | {
      ok: true
      value: AvailabilityOfferingContext
    }
  | {
      ok: false
      kind: 'NOT_FOUND'
      entity: 'PROFESSIONAL' | 'SERVICE'
    }
  | {
      ok: false
      kind: 'BOOKING'
      code: BookingErrorCode
    }

type FreshAvailabilitySource = {
  pro: {
    businessName: string | null
    avatarUrl: string | null
    location: string | null
    timeZone: string | null
  }
  service: {
    name: string
    category: {
      name: string
    } | null
  }
  offering: {
    id: string
    offersInSalon: boolean
    offersMobile: boolean
    salonDurationMinutes: number | null
    mobileDurationMinutes: number | null
    salonPriceStartingAt: Prisma.Decimal | null
    mobilePriceStartingAt: Prisma.Decimal | null
  }
}

type ResolvedAvailabilityPlacement = Extract<
  Awaited<ReturnType<typeof resolveAvailabilityPlacement>>,
  { ok: true }
>

function buildVersionedPlacementCacheKey(args: {
  professionalId: string
  serviceId: string
  requestedLocationType: ServiceLocationType | null
  requestedLocationId: string | null
  clientAddressId: string | null
  scheduleConfigVersion: number
}): string {
  const baseKey = buildPlacementCacheKey({
    professionalId: args.professionalId,
    serviceId: args.serviceId,
    locationType: args.requestedLocationType,
    locationId: args.requestedLocationId,
    clientAddressId: args.clientAddressId,
    scheduleConfigVersion: args.scheduleConfigVersion,
  })

  return `${baseKey}:placement:${AVAILABILITY_PLACEMENT_CACHE_VERSION}`
}

function buildOfferingPayloadFromCachedPlacement(
  cachedPlacement: CachedPlacement,
): AvailabilityOfferingPayload {
  return {
    id: cachedPlacement.offeringId,
    offersInSalon: cachedPlacement.offersInSalon,
    offersMobile: cachedPlacement.offersMobile,
    salonDurationMinutes: cachedPlacement.salonDurationMinutes,
    mobileDurationMinutes: cachedPlacement.mobileDurationMinutes,
    salonPriceStartingAt: cachedPlacement.salonPriceStartingAt,
    mobilePriceStartingAt: cachedPlacement.mobilePriceStartingAt,
  }
}

function buildOfferingPayloadFromOffering(offering: {
  id: string
  offersInSalon: boolean
  offersMobile: boolean
  salonDurationMinutes: number | null
  mobileDurationMinutes: number | null
  salonPriceStartingAt: unknown
  mobilePriceStartingAt: unknown
}): AvailabilityOfferingPayload {
  return {
    id: offering.id,
    offersInSalon: Boolean(offering.offersInSalon),
    offersMobile: Boolean(offering.offersMobile),
    salonDurationMinutes: offering.salonDurationMinutes ?? null,
    mobileDurationMinutes: offering.mobileDurationMinutes ?? null,
    salonPriceStartingAt: offering.salonPriceStartingAt ?? null,
    mobilePriceStartingAt: offering.mobilePriceStartingAt ?? null,
  }
}

function buildContextFromCachedPlacement(
  cachedPlacement: CachedPlacement,
): AvailabilityOfferingContext {
  return {
    locationId: cachedPlacement.locationId,
    effectiveLocationType: cachedPlacement.locationType,
    timeZone: cachedPlacement.timeZone,
    timeZoneSource: cachedPlacement.timeZoneSource,
    workingHours: cachedPlacement.workingHours,
    defaultStepMinutes: cachedPlacement.stepMinutes,
    defaultLead: cachedPlacement.leadTimeMinutes,
    locationBufferMinutes: cachedPlacement.locationBufferMinutes,
    maxAdvanceDays: cachedPlacement.maxAdvanceDays,
    durationMinutes: cachedPlacement.durationMinutes,
    placementLat: cachedPlacement.lat,
    placementLng: cachedPlacement.lng,

    proBusinessName: cachedPlacement.proBusinessName,
    proAvatarUrl: cachedPlacement.proAvatarUrl,
    proLocation: cachedPlacement.proLocation,
    serviceName: cachedPlacement.serviceName,
    serviceCategoryName: cachedPlacement.serviceCategory,

    offeringDbId: cachedPlacement.offeringId,
    offeringPayload: buildOfferingPayloadFromCachedPlacement(cachedPlacement),
  }
}

function buildContextFromFreshAvailability(args: {
  source: FreshAvailabilitySource
  placement: ResolvedAvailabilityPlacement
}): AvailabilityOfferingContext {
  const { source, placement } = args

  return {
    locationId: placement.locationId,
    effectiveLocationType: placement.locationType,
    timeZone: placement.timeZone,
    timeZoneSource: placement.timeZoneSource,
    workingHours: placement.workingHours,
    defaultStepMinutes: placement.stepMinutes,
    defaultLead: placement.leadTimeMinutes,
    locationBufferMinutes: placement.locationBufferMinutes,
    maxAdvanceDays: placement.maxAdvanceDays,
    durationMinutes: placement.durationMinutes,
    placementLat: placement.lat,
    placementLng: placement.lng,

    proBusinessName: source.pro.businessName ?? null,
    proAvatarUrl: source.pro.avatarUrl ?? null,
    proLocation: source.pro.location ?? null,
    serviceName: source.service.name,
    serviceCategoryName: source.service.category?.name ?? null,

    offeringDbId: source.offering.id,
    offeringPayload: buildOfferingPayloadFromOffering(source.offering),
  }
}

function buildCachedPlacementValue(args: {
  context: AvailabilityOfferingContext
  priceStartingAt: number
  formattedAddress: string | null
  locationCity: string | null
}): CachedPlacement {
  const { context } = args

  return {
    locationId: context.locationId,
    locationType: context.effectiveLocationType,
    timeZone: context.timeZone,
    timeZoneSource: context.timeZoneSource,
    workingHours: context.workingHours,
    stepMinutes: context.defaultStepMinutes,
    leadTimeMinutes: context.defaultLead,
    locationBufferMinutes: context.locationBufferMinutes,
    maxAdvanceDays: context.maxAdvanceDays,
    durationMinutes: context.durationMinutes,
    priceStartingAt: args.priceStartingAt,
    formattedAddress: args.formattedAddress,
    lat: context.placementLat,
    lng: context.placementLng,
    proBusinessName: context.proBusinessName,
    proAvatarUrl: context.proAvatarUrl,
    proLocation: context.proLocation,
    serviceName: context.serviceName,
    serviceCategory: context.serviceCategoryName,
    offeringId: context.offeringDbId,
    offersInSalon: context.offeringPayload.offersInSalon,
    offersMobile: context.offeringPayload.offersMobile,
    salonDurationMinutes: context.offeringPayload.salonDurationMinutes,
    mobileDurationMinutes: context.offeringPayload.mobileDurationMinutes,
    salonPriceStartingAt:
      context.offeringPayload.salonPriceStartingAt != null
        ? String(context.offeringPayload.salonPriceStartingAt)
        : null,
    mobilePriceStartingAt:
      context.offeringPayload.mobilePriceStartingAt != null
        ? String(context.offeringPayload.mobilePriceStartingAt)
        : null,
    locationCity: args.locationCity,
  }
}

async function loadFreshAvailabilitySource(args: {
  professionalId: string
  serviceId: string
}): Promise<
  | {
      ok: true
      value: FreshAvailabilitySource
    }
  | {
      ok: false
      result: LoadAvailabilityOfferingContextResult
    }
> {
  const [pro, service, offering] = await Promise.all([
    prisma.professionalProfile.findUnique({
      where: { id: args.professionalId },
      select: {
        id: true,
        businessName: true,
        avatarUrl: true,
        location: true,
        timeZone: true,
      },
    }),
    prisma.service.findUnique({
      where: { id: args.serviceId },
      select: {
        id: true,
        name: true,
        category: { select: { name: true } },
      },
    }),
    prisma.professionalServiceOffering.findFirst({
      where: {
        professionalId: args.professionalId,
        serviceId: args.serviceId,
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

  if (!pro) {
    return {
      ok: false,
      result: {
        ok: false,
        kind: 'NOT_FOUND',
        entity: 'PROFESSIONAL',
      },
    }
  }

  if (!service) {
    return {
      ok: false,
      result: {
        ok: false,
        kind: 'NOT_FOUND',
        entity: 'SERVICE',
      },
    }
  }

  if (!offering) {
    return {
      ok: false,
      result: {
        ok: false,
        kind: 'BOOKING',
        code: 'OFFERING_NOT_FOUND',
      },
    }
  }

  return {
    ok: true,
    value: {
      pro,
      service,
      offering,
    },
  }
}

export async function loadAvailabilityOfferingContext(args: {
  professionalId: string
  serviceId: string
  requestedLocationType: ServiceLocationType | null
  requestedLocationId: string | null
  clientAddressId: string | null
  scheduleConfigVersion: number
  cacheEnabled: boolean
}): Promise<LoadAvailabilityOfferingContextResult> {
  const placementCacheKey = args.cacheEnabled
    ? buildVersionedPlacementCacheKey({
        professionalId: args.professionalId,
        serviceId: args.serviceId,
        requestedLocationType: args.requestedLocationType,
        requestedLocationId: args.requestedLocationId,
        clientAddressId: args.clientAddressId,
        scheduleConfigVersion: args.scheduleConfigVersion,
      })
    : null

  if (placementCacheKey) {
    const cachedPlacement = parseCachedPlacement(
      await cacheGetJson<unknown>(placementCacheKey),
    )

    if (cachedPlacement) {
      return {
        ok: true,
        value: buildContextFromCachedPlacement(cachedPlacement),
      }
    }
  }

  const sourceResult = await loadFreshAvailabilitySource({
    professionalId: args.professionalId,
    serviceId: args.serviceId,
  })

  if (!sourceResult.ok) {
    return sourceResult.result
  }

  const source = sourceResult.value

  const placement = await resolveAvailabilityPlacement({
    professionalId: args.professionalId,
    offering: buildOfferingSnapshot(source.offering),
    requestedLocationType: args.requestedLocationType,
    requestedLocationId: args.requestedLocationId,
    clientAddressId: args.clientAddressId,
    professionalTimeZone: source.pro.timeZone ?? null,
  })

  if (!placement.ok) {
    return {
      ok: false,
      kind: 'BOOKING',
      code: placement.code,
    }
  }

  const value = buildContextFromFreshAvailability({
    source,
    placement,
  })

  if (placementCacheKey) {
    const cachedPlacementValue = buildCachedPlacementValue({
      context: value,
      priceStartingAt: placement.priceStartingAt,
      formattedAddress: placement.formattedAddress,
      locationCity: placement.location.city ?? null,
    })

    void cacheSetJson(
      placementCacheKey,
      cachedPlacementValue,
      TTL_PLACEMENT_SECONDS,
    )
  }

  return {
    ok: true,
    value,
  }
}