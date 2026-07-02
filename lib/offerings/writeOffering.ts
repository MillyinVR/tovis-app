// lib/offerings/writeOffering.ts
//
// Single source for persisting a ProfessionalServiceOffering: ensures the pro
// has the location types the offering needs, then creates the offering row.
// Used by POST /api/v1/pro/offerings and by the migration service import (which
// additionally attaches price-grace ramps for below-minimum prices). Validation
// (price floor, durations) stays with each caller — this is the write itself.

import { Prisma, ProfessionalLocationType } from '@prisma/client'

import { moneyToString } from '@/lib/money'
import { buildAddressPrivacyWriteData } from '@/lib/security/addressEncryption'
import { toPrismaJson } from '@/lib/typed'

type WeekdayKey = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun'

type WorkingHoursDay = { enabled: boolean; start: string; end: string }

type WorkingHoursObj = Record<WeekdayKey, WorkingHoursDay>

export function defaultWorkingHours(): WorkingHoursObj {
  const weekday: WorkingHoursDay = { enabled: true, start: '09:00', end: '17:00' }
  const weekend: WorkingHoursDay = { enabled: false, start: '09:00', end: '17:00' }
  return {
    mon: { ...weekday },
    tue: { ...weekday },
    wed: { ...weekday },
    thu: { ...weekday },
    fri: { ...weekday },
    sat: { ...weekend },
    sun: { ...weekend },
  }
}

function salonCapableTypes(): readonly ProfessionalLocationType[] {
  return [ProfessionalLocationType.SALON, ProfessionalLocationType.SUITE]
}

function mobileCapableTypes(): readonly ProfessionalLocationType[] {
  return [ProfessionalLocationType.MOBILE_BASE]
}

function emptyAddressPrivacyWriteData() {
  return buildAddressPrivacyWriteData({
    formattedAddress: null,
    addressLine1: null,
    addressLine2: null,
    city: null,
    state: null,
    postalCode: null,
    countryCode: null,
    placeId: null,
    lat: null,
    lng: null,
  })
}

export async function ensureLocationsForOffering(args: {
  tx: Prisma.TransactionClient
  professionalId: string
  offersInSalon: boolean
  offersMobile: boolean
}) {
  const { tx, professionalId, offersInSalon, offersMobile } = args

  if (!offersInSalon && !offersMobile) return

  const relevantTypes: ProfessionalLocationType[] = [
    ...(offersInSalon ? salonCapableTypes() : []),
    ...(offersMobile ? mobileCapableTypes() : []),
  ]

  const existing = await tx.professionalLocation.findMany({
    where: { professionalId, type: { in: relevantTypes }, archivedAt: null },
    select: { type: true },
    take: 50,
  })

  const existingTypes = new Set(existing.map((location) => location.type))
  const hasSalonCapableLocation = salonCapableTypes().some((type) =>
    existingTypes.has(type),
  )
  const hasMobileCapableLocation = existingTypes.has(
    ProfessionalLocationType.MOBILE_BASE,
  )

  let totalLocationCount = await tx.professionalLocation.count({
    where: { professionalId, archivedAt: null },
  })

  if (offersInSalon && !hasSalonCapableLocation) {
    await tx.professionalLocation.create({
      data: {
        professionalId,
        type: ProfessionalLocationType.SALON,
        name: 'Set salon address',
        isPrimary: totalLocationCount === 0,
        isBookable: false,
        timeZone: null,
        workingHours: toPrismaJson(defaultWorkingHours()),
        ...emptyAddressPrivacyWriteData(),
      },
      select: { id: true },
    })
    totalLocationCount += 1
  }

  if (offersMobile && !hasMobileCapableLocation) {
    await tx.professionalLocation.create({
      data: {
        professionalId,
        type: ProfessionalLocationType.MOBILE_BASE,
        name: 'Set mobile base',
        isPrimary: totalLocationCount === 0,
        isBookable: false,
        timeZone: null,
        workingHours: toPrismaJson(defaultWorkingHours()),
        ...emptyAddressPrivacyWriteData(),
      },
      select: { id: true },
    })
  }
}

export type OfferingRow = Prisma.ProfessionalServiceOfferingGetPayload<{
  include: { service: { include: { category: true } } }
}>

export function offeringToDto(off: OfferingRow) {
  return {
    id: off.id,
    serviceId: off.serviceId,
    title: null,
    description: off.description ?? null,
    customImageUrl: off.customImageUrl ?? null,
    offersInSalon: Boolean(off.offersInSalon),
    offersMobile: Boolean(off.offersMobile),
    salonPriceStartingAt: off.salonPriceStartingAt
      ? moneyToString(off.salonPriceStartingAt)
      : null,
    salonDurationMinutes: off.salonDurationMinutes ?? null,
    mobilePriceStartingAt: off.mobilePriceStartingAt
      ? moneyToString(off.mobilePriceStartingAt)
      : null,
    mobileDurationMinutes: off.mobileDurationMinutes ?? null,
    isActive: Boolean(off.isActive),
    serviceName: off.service.name,
    categoryName: off.service.category?.name ?? null,
    serviceDefaultImageUrl: off.service.defaultImageUrl ?? null,
    minPrice: moneyToString(off.service.minPrice) ?? '0.00',
    isServiceActive: Boolean(off.service.isActive),
    isCategoryActive: Boolean(off.service.category?.isActive),
    serviceIsAddOnEligible: Boolean(off.service.isAddOnEligible),
    serviceAddOnGroup: off.service.addOnGroup ?? null,
  }
}

// Persist one offering. Validation (floor/durations) is the caller's job.
export async function writeOffering(input: {
  tx: Prisma.TransactionClient
  professionalId: string
  serviceId: string
  offersInSalon: boolean
  offersMobile: boolean
  description?: string | null
  customImageUrl?: string | null
  salonPrice: Prisma.Decimal | null
  salonDurationMinutes: number | null
  mobilePrice: Prisma.Decimal | null
  mobileDurationMinutes: number | null
}): Promise<OfferingRow> {
  await ensureLocationsForOffering({
    tx: input.tx,
    professionalId: input.professionalId,
    offersInSalon: input.offersInSalon,
    offersMobile: input.offersMobile,
  })

  return input.tx.professionalServiceOffering.create({
    data: {
      professionalId: input.professionalId,
      serviceId: input.serviceId,
      title: null,
      description: input.description ?? null,
      customImageUrl: input.customImageUrl ?? null,
      offersInSalon: input.offersInSalon,
      offersMobile: input.offersMobile,
      salonPriceStartingAt: input.offersInSalon ? input.salonPrice : null,
      salonDurationMinutes: input.offersInSalon ? input.salonDurationMinutes : null,
      mobilePriceStartingAt: input.offersMobile ? input.mobilePrice : null,
      mobileDurationMinutes: input.offersMobile ? input.mobileDurationMinutes : null,
    },
    include: { service: { include: { category: true } } },
  })
}
