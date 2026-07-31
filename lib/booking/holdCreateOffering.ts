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
    offersInSalon: offering.offersInSalon,
    offersMobile: offering.offersMobile,
    salonDurationMinutes: offering.salonDurationMinutes,
    mobileDurationMinutes: offering.mobileDurationMinutes,
    salonPriceStartingAt: offering.salonPriceStartingAt,
    mobilePriceStartingAt: offering.mobilePriceStartingAt,
    professionalTimeZone: offering.professional?.timeZone ?? null,
  }
}
