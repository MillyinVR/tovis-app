// lib/offerings/locationCapability.ts
//
// W6: whether a pro can ACTUALLY be booked in-salon / mobile, derived from the
// locations they really have — not from the offering's mode flags.
//
// `ProfessionalServiceOffering.offersInSalon` used to default to `true` and the
// pro-facing form pre-checked it, so a mobile-only pro ended up with four
// offerings all claiming in-salon and a "Set salon address" placeholder location
// auto-written on their behalf. The client's booking drawer reads those flags
// straight through, so it rendered an In-salon toggle — and the salon waitlist
// panel under it — for a pro who only travels.
//
// The capability test is `isBookable: true` on a non-archived location of the
// right type. That is deliberately the SAME predicate that
// `loadPlacementCandidatesForLocationType` (lib/availability/core/placement.ts)
// already uses to find somewhere to put the appointment. Anything looser and the
// drawer offers a mode placement cannot fill; anything stricter (e.g. also
// requiring `formattedAddress`) would depend on the address-encryption expand
// phase still keeping raw columns populated, which is not a safe thing to bet a
// pro's bookability on.

import { Prisma, ProfessionalLocationType } from '@prisma/client'

import { prisma } from '@/lib/prisma'

type DbClient = Prisma.TransactionClient | typeof prisma

export type ProLocationCapability = {
  /** The pro has at least one bookable SALON/SUITE location. */
  salon: boolean
  /** The pro has at least one bookable MOBILE_BASE location. */
  mobile: boolean
}

export const SALON_CAPABLE_LOCATION_TYPES: readonly ProfessionalLocationType[] = [
  ProfessionalLocationType.SALON,
  ProfessionalLocationType.SUITE,
]

export const MOBILE_CAPABLE_LOCATION_TYPES: readonly ProfessionalLocationType[] = [
  ProfessionalLocationType.MOBILE_BASE,
]

/**
 * Which booking modes this pro can actually host, from their bookable locations.
 *
 * One query, no per-mode round trip. Callers use it to (a) narrow an offering's
 * advertised modes before they reach a client, and (b) pick an honest default
 * when a mode flag was never explicitly chosen.
 */
export async function loadProLocationCapability(
  professionalId: string,
  client: DbClient = prisma,
): Promise<ProLocationCapability> {
  const rows = await client.professionalLocation.findMany({
    where: {
      professionalId,
      archivedAt: null,
      isBookable: true,
      type: {
        in: [...SALON_CAPABLE_LOCATION_TYPES, ...MOBILE_CAPABLE_LOCATION_TYPES],
      },
    },
    select: { type: true },
    take: 50,
  })

  const types = new Set(rows.map((row) => row.type))

  return {
    salon: SALON_CAPABLE_LOCATION_TYPES.some((type) => types.has(type)),
    mobile: MOBILE_CAPABLE_LOCATION_TYPES.some((type) => types.has(type)),
  }
}

/**
 * Narrow an offering's advertised modes to what the pro can actually host.
 *
 * ⚠️ Read boundary — belt and braces. Prod already contains offerings whose
 * `offersInSalon` was never a choice, so the flag alone cannot be trusted even
 * after the default changes and the backfill runs. Apply this everywhere an
 * offering's modes are published to a CLIENT; the pro's own management surfaces
 * keep showing the raw flags so they can see and fix what they have.
 */
export function narrowOfferingModes<T extends { offersInSalon: boolean; offersMobile: boolean }>(
  offering: T,
  capability: ProLocationCapability,
): T {
  return {
    ...offering,
    offersInSalon: offering.offersInSalon && capability.salon,
    offersMobile: offering.offersMobile && capability.mobile,
  }
}
