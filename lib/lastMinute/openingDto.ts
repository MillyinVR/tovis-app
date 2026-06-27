// lib/lastMinute/openingDto.ts
//
// Shared opening → DTO mapping units for the last-minute opening feeds. The
// public feed (app/api/openings) and the recipient feed (app/api/v1/client/
// openings) emit slightly different envelopes (the public feed always returns a
// location object and omits per-row timezones; the recipient feed makes
// location nullable and carries timezones), but the customer-facing PRICING
// pieces — the incentive label, the services list, and the publicIncentive
// block — are identical and must never drift between the two feeds. They live
// here so there is one source of truth for that copy.

import { LastMinuteOfferType } from '@prisma/client'
import type { LastMinuteTier, Prisma } from '@prisma/client'

import { moneyToString } from '@/lib/money'

// --- Incentive label ------------------------------------------------------

export type IncentiveLabelPlan = {
  offerType: LastMinuteOfferType
  percentOff: number | null
  amountOff: Prisma.Decimal | null
  freeAddOnService: { id: string; name: string } | null
}

/**
 * Human-readable incentive copy shown on an opening (e.g. "20% off", "$15 off",
 * "Free service"). Single source of truth shared by both opening feeds.
 */
export function incentiveLabel(plan: IncentiveLabelPlan): string {
  if (
    plan.offerType === LastMinuteOfferType.PERCENT_OFF &&
    plan.percentOff != null
  ) {
    return `${plan.percentOff}% off`
  }

  if (plan.offerType === LastMinuteOfferType.AMOUNT_OFF && plan.amountOff) {
    return `$${plan.amountOff.toString()} off`
  }

  if (plan.offerType === LastMinuteOfferType.FREE_SERVICE) {
    return 'Free service'
  }

  if (plan.offerType === LastMinuteOfferType.FREE_ADD_ON) {
    return plan.freeAddOnService?.name || 'Free add-on'
  }

  return 'No incentive'
}

// --- Public incentive block ----------------------------------------------

export type PublicIncentivePlan = IncentiveLabelPlan & {
  tier: LastMinuteTier
}

export type PublicIncentiveDto = {
  tier: LastMinuteTier
  offerType: LastMinuteOfferType
  label: string
  percentOff: number | null
  amountOff: string | null
  freeAddOnService: { id: string; name: string } | null
}

export function mapPublicIncentiveDto(
  plan: PublicIncentivePlan | null,
): PublicIncentiveDto | null {
  if (!plan) return null

  return {
    tier: plan.tier,
    offerType: plan.offerType,
    label: incentiveLabel(plan),
    percentOff: plan.percentOff ?? null,
    amountOff: moneyToString(plan.amountOff),
    freeAddOnService: plan.freeAddOnService
      ? {
          id: plan.freeAddOnService.id,
          name: plan.freeAddOnService.name,
        }
      : null,
  }
}

// --- Services list --------------------------------------------------------

export type OpeningServiceRow = {
  id: string
  openingId: string
  serviceId: string
  offeringId: string
  sortOrder: number
  service: {
    id: string
    name: string
    minPrice: Prisma.Decimal
    defaultDurationMinutes: number
  }
  offering: {
    id: string
    title: string | null
    salonPriceStartingAt: Prisma.Decimal | null
    mobilePriceStartingAt: Prisma.Decimal | null
    salonDurationMinutes: number | null
    mobileDurationMinutes: number | null
    offersInSalon: boolean
    offersMobile: boolean
  }
}

export type OpeningServiceDto = {
  id: string
  openingId: string
  serviceId: string
  offeringId: string
  sortOrder: number
  service: {
    id: string
    name: string
    minPrice: string
    defaultDurationMinutes: number
  }
  offering: {
    id: string
    title: string | null
    salonPriceStartingAt: string | null
    mobilePriceStartingAt: string | null
    salonDurationMinutes: number | null
    mobileDurationMinutes: number | null
    offersInSalon: boolean
    offersMobile: boolean
  }
}

export function mapOpeningServiceDtos(
  services: OpeningServiceRow[],
): OpeningServiceDto[] {
  return services.map((serviceRow) => ({
    id: serviceRow.id,
    openingId: serviceRow.openingId,
    serviceId: serviceRow.serviceId,
    offeringId: serviceRow.offeringId,
    sortOrder: serviceRow.sortOrder,
    service: {
      id: serviceRow.service.id,
      name: serviceRow.service.name,
      minPrice: serviceRow.service.minPrice.toString(),
      defaultDurationMinutes: serviceRow.service.defaultDurationMinutes,
    },
    offering: {
      id: serviceRow.offering.id,
      title: serviceRow.offering.title ?? null,
      salonPriceStartingAt: moneyToString(serviceRow.offering.salonPriceStartingAt),
      mobilePriceStartingAt: moneyToString(serviceRow.offering.mobilePriceStartingAt),
      salonDurationMinutes: serviceRow.offering.salonDurationMinutes,
      mobileDurationMinutes: serviceRow.offering.mobileDurationMinutes,
      offersInSalon: serviceRow.offering.offersInSalon,
      offersMobile: serviceRow.offering.offersMobile,
    },
  }))
}
