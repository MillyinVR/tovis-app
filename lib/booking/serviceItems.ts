// lib/booking/serviceItems.ts
import { Prisma, BookingServiceItemType, ServiceLocationType } from '@prisma/client'
import { clampInt } from '@/lib/pick'
import {
  DEFAULT_DURATION_MINUTES,
  MAX_SLOT_DURATION_MINUTES,
} from '@/lib/booking/constants'
import { pickModeDurationMinutes } from '@/lib/booking/locationContext'

export type NormalizedBookingItem = {
  serviceId: string
  offeringId: string
  durationMinutesSnapshot: number
  priceSnapshot: Prisma.Decimal
  sortOrder: number
  serviceName: string
}

export type BookingItemTotals = {
  primaryItem: NormalizedBookingItem
  computedDurationMinutes: number
  computedSubtotal: Prisma.Decimal
}

export type CreateRouteOfferingRow = {
  id: string
  serviceId: string
  salonPriceStartingAt: Prisma.Decimal | null
  mobilePriceStartingAt: Prisma.Decimal | null
  salonDurationMinutes: number | null
  mobileDurationMinutes: number | null
}

export type CreateRouteServiceRow = {
  id: string
  name: string | null
  defaultDurationMinutes: number | null
}

export type RequestedServiceItemInput = {
  serviceId: string
  offeringId: string
  sortOrder: number
}

export type EditRouteOfferingRow = {
  id: string
  serviceId: string
  offersInSalon: boolean
  offersMobile: boolean
  salonDurationMinutes: number | null
  mobileDurationMinutes: number | null
  salonPriceStartingAt: Prisma.Decimal | null
  mobilePriceStartingAt: Prisma.Decimal | null
  service: {
    defaultDurationMinutes: number | null
  }
}

function throwCode(code: string): never {
  throw new Error(code)
}

export function snapToStepMinutes(value: number, stepMinutes: number): number {
  const step = clampInt(stepMinutes || 15, 5, 60)
  return Math.round(value / step) * step
}

export function sumDecimal(values: Prisma.Decimal[]): Prisma.Decimal {
  return values.reduce((acc, value) => acc.add(value), new Prisma.Decimal(0))
}

function pickModePrice(args: {
  locationType: ServiceLocationType
  salonPriceStartingAt: Prisma.Decimal | null
  mobilePriceStartingAt: Prisma.Decimal | null
}): Prisma.Decimal | null {
  return args.locationType === ServiceLocationType.MOBILE
    ? args.mobilePriceStartingAt
    : args.salonPriceStartingAt
}

function normalizeDurationSnapshot(args: {
  rawDurationMinutes: number
  stepMinutes: number
  minimumMinutes?: number
}): number {
  const { rawDurationMinutes, stepMinutes, minimumMinutes = 15 } = args

  return clampInt(
    snapToStepMinutes(rawDurationMinutes, stepMinutes),
    Math.max(minimumMinutes, stepMinutes),
    MAX_SLOT_DURATION_MINUTES,
  )
}

export function buildNormalizedBookingItemsFromServiceIds(args: {
  serviceIds: string[]
  locationType: ServiceLocationType
  stepMinutes: number
  offeringByServiceId: Map<string, CreateRouteOfferingRow>
  serviceById: Map<string, CreateRouteServiceRow>
  errors?: {
    missingOffering?: string
    missingService?: string
    pricingNotSet?: string
    badDuration?: string
  }
}): NormalizedBookingItem[] {
  const {
    serviceIds,
    locationType,
    stepMinutes,
    offeringByServiceId,
    serviceById,
    errors,
  } = args

  const missingOfferingCode = errors?.missingOffering ?? 'MISSING_OFFERING'
  const missingServiceCode = errors?.missingService ?? 'MISSING_SERVICE'
  const pricingNotSetCode = errors?.pricingNotSet ?? 'PRICING_NOT_SET'
  const badDurationCode = errors?.badDuration ?? 'BAD_DURATION'

  return serviceIds.map((serviceId, index) => {
    const offering = offeringByServiceId.get(serviceId)
    const service = serviceById.get(serviceId)

    if (!offering) throwCode(missingOfferingCode)
    if (!service) throwCode(missingServiceCode)

    const rawDuration = pickModeDurationMinutes({
      locationType,
      salonDurationMinutes: offering.salonDurationMinutes,
      mobileDurationMinutes: offering.mobileDurationMinutes,
      fallbackDurationMinutes:
        service.defaultDurationMinutes ?? DEFAULT_DURATION_MINUTES,
    })

    if (!Number.isFinite(rawDuration) || rawDuration <= 0) {
      throwCode(badDurationCode)
    }

    const priceSnapshot = pickModePrice({
      locationType,
      salonPriceStartingAt: offering.salonPriceStartingAt,
      mobilePriceStartingAt: offering.mobilePriceStartingAt,
    })

    if (priceSnapshot == null) {
      throwCode(pricingNotSetCode)
    }

    return {
      serviceId,
      offeringId: offering.id,
      durationMinutesSnapshot: normalizeDurationSnapshot({
        rawDurationMinutes: rawDuration,
        stepMinutes,
      }),
      priceSnapshot,
      sortOrder: index,
      serviceName: service.name?.trim() || 'Service',
    }
  })
}

export function buildNormalizedBookingItemsFromRequestedOfferings(args: {
  requestedItems: RequestedServiceItemInput[]
  locationType: ServiceLocationType
  stepMinutes: number
  offeringById: Map<string, EditRouteOfferingRow>
  badItemsCode?: string
}): NormalizedBookingItem[] {
  const {
    requestedItems,
    locationType,
    stepMinutes,
    offeringById,
    badItemsCode = 'BAD_ITEMS',
  } = args

  return requestedItems.map((item, index) => {
    const offering = offeringById.get(item.offeringId)
    if (!offering) {
      throwCode(badItemsCode)
    }

    if (offering.serviceId !== item.serviceId) {
      throwCode(badItemsCode)
    }

    const isMobile = locationType === ServiceLocationType.MOBILE
    const modeAllowed = isMobile ? offering.offersMobile : offering.offersInSalon
    if (!modeAllowed) {
      throwCode(badItemsCode)
    }

    const rawDuration = pickModeDurationMinutes({
      locationType,
      salonDurationMinutes: offering.salonDurationMinutes,
      mobileDurationMinutes: offering.mobileDurationMinutes,
      fallbackDurationMinutes:
        offering.service.defaultDurationMinutes ?? DEFAULT_DURATION_MINUTES,
    })

    if (!Number.isFinite(rawDuration) || rawDuration <= 0) {
      throwCode(badItemsCode)
    }

    const priceSnapshot = pickModePrice({
      locationType,
      salonPriceStartingAt: offering.salonPriceStartingAt,
      mobilePriceStartingAt: offering.mobilePriceStartingAt,
    })

    if (priceSnapshot == null) {
      throwCode(badItemsCode)
    }

    return {
      serviceId: item.serviceId,
      offeringId: item.offeringId,
      durationMinutesSnapshot: normalizeDurationSnapshot({
        rawDurationMinutes: rawDuration,
        stepMinutes,
      }),
      priceSnapshot,
      sortOrder: index,
      serviceName: 'Service',
    }
  })
}

export function computeBookingItemTotals(
  items: NormalizedBookingItem[],
  badItemsCode = 'BAD_ITEMS',
): BookingItemTotals {
  if (!items.length) {
    throwCode(badItemsCode)
  }

  const primaryItem = items[0]
  if (!primaryItem) {
    throwCode(badItemsCode)
  }

  return {
    primaryItem,
    computedDurationMinutes: items.reduce(
      (sum, item) => sum + Number(item.durationMinutesSnapshot ?? 0),
      0,
    ),
    computedSubtotal: sumDecimal(items.map((item) => item.priceSnapshot)),
  }
}

export type BookingItemLikeForTotals = {
  serviceId: string
  offeringId: string | null
  durationMinutesSnapshot: number
  priceSnapshot: Prisma.Decimal
  itemType?: BookingServiceItemType | null
}

export type BookingItemLikeTotals = {
  primaryServiceId: string
  primaryOfferingId: string | null
  computedDurationMinutes: number
  computedSubtotal: Prisma.Decimal
}

export function computeBookingItemLikeTotals(
  items: BookingItemLikeForTotals[],
  badItemsCode = 'BAD_ITEMS',
): BookingItemLikeTotals {
  if (!items.length) {
    throwCode(badItemsCode)
  }

  const primaryItem =
    items.find((item) => item.itemType === BookingServiceItemType.BASE) ?? items[0]

  if (!primaryItem) {
    throwCode(badItemsCode)
  }

  return {
    primaryServiceId: primaryItem.serviceId,
    primaryOfferingId: primaryItem.offeringId ?? null,
    computedDurationMinutes: items.reduce(
      (sum, item) => sum + Number(item.durationMinutesSnapshot ?? 0),
      0,
    ),
    computedSubtotal: sumDecimal(items.map((item) => item.priceSnapshot)),
  }
}