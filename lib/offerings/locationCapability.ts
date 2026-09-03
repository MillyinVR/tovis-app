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
//
// This module is server-side: it runs the query, and the location-type
// constants below are Prisma enum values. The shape and the two pure rules
// (`narrowOfferingModes`, `defaultOfferingModes`) live in the client-safe
// sibling `@/lib/offerings/locationCapabilityRules` and are re-exported here.
//
// No `import 'server-only'`: unlike its sibling splits, this module IS reached
// by two CLI entry points — scripts/backfill-search-index.ts (which CI runs) and
// prisma/scripts/seedDemoClientProfile.ts — and `server-only` does not resolve
// under `tsx`. See the note in lib/prisma.ts.

import { Prisma, ProfessionalLocationType } from '@prisma/client'

import { prisma } from '@/lib/prisma'
import type { ProLocationCapability } from '@/lib/offerings/locationCapabilityRules'

export {
  narrowOfferingModes,
  defaultOfferingModes,
} from '@/lib/offerings/locationCapabilityRules'
export type { ProLocationCapability } from '@/lib/offerings/locationCapabilityRules'

type DbClient = Prisma.TransactionClient | typeof prisma

export const SALON_CAPABLE_LOCATION_TYPES: readonly ProfessionalLocationType[] = [
  ProfessionalLocationType.SALON,
  ProfessionalLocationType.SUITE,
]

export const MOBILE_CAPABLE_LOCATION_TYPES: readonly ProfessionalLocationType[] = [
  ProfessionalLocationType.MOBILE_BASE,
]

const CAPABLE_LOCATION_TYPES: readonly ProfessionalLocationType[] = [
  ...SALON_CAPABLE_LOCATION_TYPES,
  ...MOBILE_CAPABLE_LOCATION_TYPES,
]

/** The one predicate: bookable, not archived, of a type a booking can be placed at. */
function bookableLocationWhere(): Prisma.ProfessionalLocationWhereInput {
  return {
    archivedAt: null,
    isBookable: true,
    type: { in: [...CAPABLE_LOCATION_TYPES] },
  }
}

/** Fold the location types a pro really has into the two capabilities. */
function capabilityFromLocationTypes(
  types: Iterable<ProfessionalLocationType>,
): ProLocationCapability {
  const set = new Set(types)
  return {
    salon: SALON_CAPABLE_LOCATION_TYPES.some((type) => set.has(type)),
    mobile: MOBILE_CAPABLE_LOCATION_TYPES.some((type) => set.has(type)),
  }
}

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
    where: { professionalId, ...bookableLocationWhere() },
    select: { type: true },
    take: 50,
  })

  return capabilityFromLocationTypes(rows.map((row) => row.type))
}

/**
 * The same answer for MANY pros in one query — for list surfaces (discovery)
 * that would otherwise need a round trip per card. A pro with no bookable
 * location at all is present in the map with both capabilities false, so a
 * caller can narrow every row without a fallback branch.
 */
export async function loadProLocationCapabilities(
  professionalIds: readonly string[],
  client: DbClient = prisma,
): Promise<Map<string, ProLocationCapability>> {
  const byPro = new Map<string, ProfessionalLocationType[]>(
    professionalIds.map((id) => [id, []]),
  )
  if (professionalIds.length === 0) return new Map()

  const rows = await client.professionalLocation.findMany({
    where: {
      professionalId: { in: [...professionalIds] },
      ...bookableLocationWhere(),
    },
    select: { professionalId: true, type: true },
    take: 50 * professionalIds.length,
  })
  for (const row of rows) byPro.get(row.professionalId)?.push(row.type)

  return new Map(
    [...byPro].map(([id, types]) => [id, capabilityFromLocationTypes(types)]),
  )
}
