// lib/booking/holdCreateOffering.ts
//
// The offering row shape createHold() takes, and its loader select — extracted
// from app/api/v1/holds/route.ts (K12) so the public appointment-reschedule
// token route builds the hold from the SAME columns and mapping the authed
// holds route uses, instead of a hand-copied restatement.

import type { Prisma } from '@prisma/client'

export const HOLD_CREATE_OFFERING_SELECT = {
  id: true,
  isActive: true,
  professionalId: true,
  // Book the Look, B4: the consult scope check compares the consult's category
  // against the offering's, so a hold placed from a consult must carry it.
  service: { select: { categoryId: true } },
  offersInSalon: true,
  offersMobile: true,
  salonDurationMinutes: true,
  mobileDurationMinutes: true,
  salonPriceStartingAt: true,
  mobilePriceStartingAt: true,
  professional: {
    select: {
      timeZone: true,
    },
  },
} satisfies Prisma.ProfessionalServiceOfferingSelect

export type HoldCreateOfferingRecord =
  Prisma.ProfessionalServiceOfferingGetPayload<{
    select: typeof HOLD_CREATE_OFFERING_SELECT
  }>

export type CreateHoldOfferingInput = {
  id: string
  professionalId: string
  serviceCategoryId: string | null
  offersInSalon: boolean
  offersMobile: boolean
  salonDurationMinutes: number | null
  mobileDurationMinutes: number | null
  salonPriceStartingAt: Prisma.Decimal | null
  mobilePriceStartingAt: Prisma.Decimal | null
  professionalTimeZone: string | null
}

export function toCreateHoldOffering(
  offering: HoldCreateOfferingRecord,
): CreateHoldOfferingInput {
  return {
    id: offering.id,
    professionalId: offering.professionalId,
    serviceCategoryId: offering.service?.categoryId ?? null,
    offersInSalon: offering.offersInSalon,
    offersMobile: offering.offersMobile,
    salonDurationMinutes: offering.salonDurationMinutes,
    mobileDurationMinutes: offering.mobileDurationMinutes,
    salonPriceStartingAt: offering.salonPriceStartingAt,
    mobilePriceStartingAt: offering.mobilePriceStartingAt,
    professionalTimeZone: offering.professional?.timeZone ?? null,
  }
}
