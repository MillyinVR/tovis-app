// lib/booking/addOnResolution.ts
//
// Shared resolution of a booking's selected add-ons into persistable line-item
// snapshots (price + duration), used at booking-creation time by BOTH the
// client finalize path and the pro new-booking path in `writeBoundary.ts`.
//
// An add-on is an `OfferingAddOn` link (id) hanging off a base offering. Its
// price/duration resolve, in order, from the link override → the pro's own
// active offering for that add-on service (mode-specific) → the service's
// catalog defaults. The availability endpoint folds the same durations into a
// slot's length (see `resolveDurationWithAddOns`), so the reserved slot already
// accounts for these — this resolver produces the matching persisted rows.
//
// House rule: Prisma is the single source of truth for data shapes; this derives
// straight from the `OfferingAddOn` link + its `addOnService`.
import { Prisma, ServiceLocationType } from '@prisma/client'

import { bookingError } from '@/lib/booking/errors'
import { normalizePositiveDurationMinutes } from '@/lib/booking/serviceItems'
import { decimalFromUnknown } from '@/lib/booking/snapshots'
import { prisma } from '@/lib/prisma'

type AddOnDbClient = Prisma.TransactionClient | typeof prisma

export type ResolvedBookingAddOn = {
  /** OfferingAddOn link id — stamped onto the persisted item's `notes`. */
  offeringAddOnId: string
  /** The underlying add-on service id (the ADD_ON item's `serviceId`). */
  serviceId: string
  durationMinutesSnapshot: number
  priceSnapshot: Prisma.Decimal
  sortOrder: number
}

export type ResolveBookingAddOnsArgs = {
  professionalId: string
  offeringId: string
  addOnIds: string[]
  locationType: ServiceLocationType
  client?: AddOnDbClient
}

/**
 * Resolve `addOnIds` (OfferingAddOn link ids) for a base offering into price +
 * duration snapshots, in the pro's `locationType` mode. Throws
 * `bookingError('ADDONS_INVALID')` if any id doesn't map to an active,
 * add-on-eligible link on this offering, or resolves to a non-positive
 * duration. Returns `[]` for an empty selection.
 */
export async function resolveBookingAddOns(
  args: ResolveBookingAddOnsArgs,
): Promise<ResolvedBookingAddOn[]> {
  if (!args.addOnIds.length) return []

  const client = args.client ?? prisma

  const addOnLinks = await client.offeringAddOn.findMany({
    where: {
      id: { in: args.addOnIds },
      offeringId: args.offeringId,
      isActive: true,
      OR: [{ locationType: null }, { locationType: args.locationType }],
      addOnService: {
        isActive: true,
        isAddOnEligible: true,
      },
    },
    select: {
      id: true,
      addOnServiceId: true,
      sortOrder: true,
      priceOverride: true,
      durationOverrideMinutes: true,
      addOnService: {
        select: {
          id: true,
          defaultDurationMinutes: true,
          minPrice: true,
        },
      },
    },
    take: 50,
  })

  if (addOnLinks.length !== args.addOnIds.length) {
    throw bookingError('ADDONS_INVALID')
  }

  const addOnServiceIds = addOnLinks.map((row) => row.addOnServiceId)

  const proAddOnOfferings = addOnServiceIds.length
    ? await client.professionalServiceOffering.findMany({
        where: {
          professionalId: args.professionalId,
          isActive: true,
          serviceId: { in: addOnServiceIds },
        },
        select: {
          serviceId: true,
          salonPriceStartingAt: true,
          salonDurationMinutes: true,
          mobilePriceStartingAt: true,
          mobileDurationMinutes: true,
        },
        take: 200,
      })
    : []

  const addOnOfferingByServiceId = new Map(
    proAddOnOfferings.map((row) => [row.serviceId, row]),
  )

  return addOnLinks.map((row) => {
    const service = row.addOnService
    const proOffering = addOnOfferingByServiceId.get(service.id) ?? null

    const durationRaw =
      row.durationOverrideMinutes ??
      (args.locationType === ServiceLocationType.MOBILE
        ? proOffering?.mobileDurationMinutes
        : proOffering?.salonDurationMinutes) ??
      service.defaultDurationMinutes

    const durationMinutesSnapshot = normalizePositiveDurationMinutes(durationRaw)
    if (durationMinutesSnapshot == null) {
      throw bookingError('ADDONS_INVALID')
    }

    const priceRaw =
      row.priceOverride ??
      (args.locationType === ServiceLocationType.MOBILE
        ? proOffering?.mobilePriceStartingAt
        : proOffering?.salonPriceStartingAt) ??
      service.minPrice

    return {
      offeringAddOnId: row.id,
      serviceId: service.id,
      durationMinutesSnapshot,
      priceSnapshot: decimalFromUnknown(priceRaw),
      sortOrder: row.sortOrder ?? 0,
    }
  })
}
