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
    rebookIntervalDays: off.rebookIntervalDays ?? null,
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

/**
 * Thrown when the pro already has this service on their menu AND it is live.
 *
 * Distinguishes a genuine duplicate from a *soft-deleted* row. Removing an
 * offering only sets `isActive: false` — the row keeps the
 * `@@unique([professionalId, serviceId])` slot — so before this existed, adding
 * a previously-removed service hit P2002 and the pro was told "you already
 * added this service" about something they could not see anywhere. Callers map
 * this error to whatever "already added" response they already had; the
 * soft-deleted case no longer reaches them.
 */
export class OfferingAlreadyActiveError extends Error {
  constructor() {
    super('This service is already active on the professional’s menu.')
    this.name = 'OfferingAlreadyActiveError'
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

  const fields = {
    title: null,
    description: input.description ?? null,
    customImageUrl: input.customImageUrl ?? null,
    offersInSalon: input.offersInSalon,
    offersMobile: input.offersMobile,
    salonPriceStartingAt: input.offersInSalon ? input.salonPrice : null,
    salonDurationMinutes: input.offersInSalon ? input.salonDurationMinutes : null,
    mobilePriceStartingAt: input.offersMobile ? input.mobilePrice : null,
    mobileDurationMinutes: input.offersMobile ? input.mobileDurationMinutes : null,
  }

  // `isActive: false` is the ONLY delete marker on this model (there is no
  // deletedAt), and removing an offering leaves everything else attached. So a
  // soft-deleted row is invisible to the pro but still owns the unique
  // [professionalId, serviceId] slot — adding the service back has to revive
  // that row, not fail on it.
  const existing = await input.tx.professionalServiceOffering.findUnique({
    where: {
      professionalId_serviceId: {
        professionalId: input.professionalId,
        serviceId: input.serviceId,
      },
    },
    select: { id: true, isActive: true },
  })

  if (existing?.isActive) {
    throw new OfferingAlreadyActiveError()
  }

  if (existing) {
    // Removing an offering leaves its OfferingPriceRamp rows attached, and a
    // ramp OUTRANKS the offering's own price: `effectiveUnitPrice` returns the
    // ramp's currentPrice/targetPrice and never looks at listPrice. Reviving
    // with a stale ramp would therefore charge the price from the import that
    // created it and silently discard the price the pro just typed. Re-adding a
    // service means this price is the price, so the ramp does not survive.
    await input.tx.offeringPriceRamp.deleteMany({
      where: { offeringId: existing.id },
    })

    return input.tx.professionalServiceOffering.update({
      where: { id: existing.id },
      data: { ...fields, isActive: true },
      include: { service: { include: { category: true } } },
    })
  }

  return input.tx.professionalServiceOffering.create({
    data: {
      professionalId: input.professionalId,
      serviceId: input.serviceId,
      ...fields,
    },
    include: { service: { include: { category: true } } },
  })
}
