// lib/booking/aftercareRebookSlotOwnership.ts

import { ProfessionalLocationType, ServiceLocationType } from '@prisma/client'

export type AftercareRebookSlotOwnershipInput = {
  professionalId: string
  locationId: string
  locationType: ServiceLocationType
  offeringId: string | null
}

type ProfessionalLocationOwnershipRow = {
  id: string
  professionalId: string
  isBookable: boolean
  type: ProfessionalLocationType
}

type ProfessionalOfferingOwnershipRow = {
  id: string
  professionalId: string
  isActive: boolean
  offersInSalon: boolean
  offersMobile: boolean
}

export type AftercareRebookSlotOwnershipReader = {
  professionalLocation: {
    findFirst(args: {
      where: {
        id: string
        professionalId: string
      }
      select: {
        id: true
        professionalId: true
        isBookable: true
        type: true
      }
    }): Promise<ProfessionalLocationOwnershipRow | null>
  }
  professionalServiceOffering: {
    findFirst(args: {
      where: {
        id: string
        professionalId: string
      }
      select: {
        id: true
        professionalId: true
        isActive: true
        offersInSalon: true
        offersMobile: true
      }
    }): Promise<ProfessionalOfferingOwnershipRow | null>
  }
}

export type AftercareRebookSlotOwnershipFailureCode =
  | 'PROFESSIONAL_REQUIRED'
  | 'LOCATION_REQUIRED'
  | 'LOCATION_NOT_FOUND'
  | 'LOCATION_NOT_BOOKABLE'
  | 'LOCATION_TYPE_UNSUPPORTED'
  | 'OFFERING_NOT_FOUND'
  | 'OFFERING_INACTIVE'
  | 'OFFERING_LOCATION_TYPE_UNSUPPORTED'

export type AftercareRebookSlotOwnershipResult =
  | { ok: true }
  | {
      ok: false
      code: AftercareRebookSlotOwnershipFailureCode
      userMessage: string
    }

function supportsLocationTypeFromBooleans(args: {
  locationType: ServiceLocationType
  offersInSalon?: boolean | null
  offersMobile?: boolean | null
}): boolean {
  if (args.locationType === ServiceLocationType.SALON) {
    return args.offersInSalon === true
  }

  if (args.locationType === ServiceLocationType.MOBILE) {
    return args.offersMobile === true
  }

  return false
}

function locationSupportsType(args: {
  location: ProfessionalLocationOwnershipRow
  locationType: ServiceLocationType
}): boolean {
  if (args.locationType === ServiceLocationType.SALON) {
    return args.location.type !== ProfessionalLocationType.MOBILE_BASE
  }

  if (args.locationType === ServiceLocationType.MOBILE) {
    return args.location.type === ProfessionalLocationType.MOBILE_BASE
  }

  return false
}

function offeringSupportsType(args: {
  offering: ProfessionalOfferingOwnershipRow
  locationType: ServiceLocationType
}): boolean {
  return supportsLocationTypeFromBooleans({
    locationType: args.locationType,
    offersInSalon: args.offering.offersInSalon,
    offersMobile: args.offering.offersMobile,
  })
}

function failure(
  code: AftercareRebookSlotOwnershipFailureCode,
  userMessage: string,
): AftercareRebookSlotOwnershipResult {
  return {
    ok: false,
    code,
    userMessage,
  }
}

export async function validateAftercareRebookSlotOwnership(args: {
  db: AftercareRebookSlotOwnershipReader
  slot: AftercareRebookSlotOwnershipInput
}): Promise<AftercareRebookSlotOwnershipResult> {
  const professionalId = args.slot.professionalId.trim()
  const locationId = args.slot.locationId.trim()
  const offeringId = args.slot.offeringId?.trim() || null

  if (!professionalId) {
    return failure(
      'PROFESSIONAL_REQUIRED',
      'This aftercare rebook slot is missing professional ownership.',
    )
  }

  if (!locationId) {
    return failure(
      'LOCATION_REQUIRED',
      'Choose a valid location for the next appointment.',
    )
  }

  const location = await args.db.professionalLocation.findFirst({
    where: {
      id: locationId,
      professionalId,
    },
    select: {
      id: true,
      professionalId: true,
      isBookable: true,
      type: true,
    },
  })

  if (!location) {
    return failure(
      'LOCATION_NOT_FOUND',
      'That location is no longer available for this professional.',
    )
  }

  if (!location.isBookable) {
    return failure(
      'LOCATION_NOT_BOOKABLE',
      'That location is not currently bookable.',
    )
  }

  if (
    !locationSupportsType({
      location,
      locationType: args.slot.locationType,
    })
  ) {
    return failure(
      'LOCATION_TYPE_UNSUPPORTED',
      'That location does not support this appointment type.',
    )
  }

  if (!offeringId) {
    return { ok: true }
  }

  const offering = await args.db.professionalServiceOffering.findFirst({
    where: {
      id: offeringId,
      professionalId,
    },
    select: {
      id: true,
      professionalId: true,
      isActive: true,
      offersInSalon: true,
      offersMobile: true,
    },
  })

  if (!offering) {
    return failure(
      'OFFERING_NOT_FOUND',
      'That service is no longer available for this professional.',
    )
  }

  if (!offering.isActive) {
    return failure(
      'OFFERING_INACTIVE',
      'That service is not currently active.',
    )
  }

  if (
    !offeringSupportsType({
      offering,
      locationType: args.slot.locationType,
    })
  ) {
    return failure(
      'OFFERING_LOCATION_TYPE_UNSUPPORTED',
      'That service does not support this appointment type.',
    )
  }

  return { ok: true }
}