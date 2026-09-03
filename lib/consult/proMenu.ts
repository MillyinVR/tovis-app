// lib/consult/proMenu.ts
//
// The pro's MENU, as a consult is allowed to see it: her active offerings for
// active services in the consult's own category. The category is the scope;
// the consult's service family (lib/consult/serviceProfile.ts) decides how the
// analysis reads the menu, never which rows it may see.
//
// One definition, deliberately. Every consult surface reads this list and they
// must read the SAME one:
//
//   * C4 recommendation resolution (analysisContract.ts) matches each analysis
//     serviceIntent to an offering and stores the resulting reference;
//   * B3's translation module (serviceEstimate.ts) prices the look's linked
//     service and those referenced services off the pro's own columns;
//   * B4's booking proposal (bookingProposal.ts) and the pro's proposal review
//     re-derive lines under the mode the client chose.
//
// If those lists could diverge, the estimate could put a price on a service the
// analysis was never able to see — or refuse one the analysis had already
// matched. They were one query copied once; this is that query, extracted.
//
// ⚠️ Read boundary (W6, `narrowOfferingModes`). The rows come back with their
// mode flags NARROWED to what the pro can actually host — prod holds offerings
// whose `offersInSalon` was never a choice, and the founder's own pro has only
// a MOBILE_BASE that is bookable. Before this, a look anchor read the SALON
// column unconditionally: a pro who only travels had her look estimate refused
// (`PRO_SCHEDULING_NOT_READY`) and her Patch Test never found, and a raw salon
// flag on a pro with an unhostable salon could price a column the commit then
// refused (`MODE_NOT_SUPPORTED`). #1066 fixed the same class on the public
// profile one step earlier. Nothing downstream of this module re-reads the
// raw flags.

import { ServiceLocationType, type Prisma } from '@prisma/client'

import {
  loadProLocationCapability,
  narrowOfferingModes,
  type ProLocationCapability,
} from '@/lib/offerings/locationCapability'

/**
 * Everything either reader needs. `id` is the offering id — the estimate stores
 * it as the snapshot of WHICH menu row a line was priced from.
 */
export const CONSULT_PRO_MENU_SELECT = {
  id: true,
  serviceId: true,
  offersInSalon: true,
  offersMobile: true,
  salonPriceStartingAt: true,
  salonDurationMinutes: true,
  mobilePriceStartingAt: true,
  mobileDurationMinutes: true,
  service: {
    select: {
      name: true,
      description: true,
      categoryId: true,
      defaultDurationMinutes: true,
    },
  },
} satisfies Prisma.ProfessionalServiceOfferingSelect

export type ConsultProMenuOffering =
  Prisma.ProfessionalServiceOfferingGetPayload<{
    select: typeof CONSULT_PRO_MENU_SELECT
  }>

/**
 * A menu plus the capability it was narrowed by, for the readers that also
 * need to CHOOSE a mode (the look-anchored estimate and safety lookup).
 */
export type ConsultProMenu = {
  capability: ProLocationCapability
  offerings: ConsultProMenuOffering[]
}

/**
 * The mode a look-anchored consult reads the pro's columns in. A booking has
 * already chosen salon or mobile; a look has not (the booking proposal is
 * where the client chooses), so the consult reads the mode the pro can host —
 * salon when she has a bookable salon or suite (where a pro's primary prices
 * live and the safety tests are performed), else mobile. A pro with nothing
 * bookable reads salon, which is the column `resolveBookingLocationContext`
 * then refuses honestly (`PRO_SCHEDULING_NOT_READY`) rather than a guess.
 */
export function consultLookLocationType(
  capability: ProLocationCapability,
): ServiceLocationType {
  if (capability.salon) return ServiceLocationType.SALON
  if (capability.mobile) return ServiceLocationType.MOBILE
  return ServiceLocationType.SALON
}

function narrowMenu<T extends { offersInSalon: boolean; offersMobile: boolean }>(
  rows: readonly T[],
  capability: ProLocationCapability,
): T[] {
  return rows.map((row) => narrowOfferingModes(row, capability))
}

/**
 * Ordered by serviceId so both readers walk the menu identically — the
 * recommendation matcher takes the FIRST offering whose name/description
 * matches an intent pattern, and a stable order is what keeps that answer the
 * same between the analysis run and any later read of it.
 */
/**
 * The professional's safety-test offerings — a Patch Test and a Strand Test
 * are ONE service each, whichever category the pro filed them under. The
 * analysis routes a nails or brows consult to a patch test as readily as a
 * colour one, so the lookup is by exact name across her whole active menu,
 * not inside the consult's category.
 */
export async function loadConsultSafetyOfferings(
  tx: Prisma.TransactionClient,
  scope: { professionalId: string; serviceNames: readonly string[] },
  /** Pass the capability already loaded for this pro to skip a second read. */
  capability?: ProLocationCapability,
): Promise<ConsultProMenuOffering[]> {
  if (scope.serviceNames.length === 0) return []
  const rows = await tx.professionalServiceOffering.findMany({
    where: {
      professionalId: scope.professionalId,
      isActive: true,
      service: {
        isActive: true,
        name: { in: [...scope.serviceNames], mode: 'insensitive' },
        category: { isActive: true },
      },
    },
    select: CONSULT_PRO_MENU_SELECT,
    orderBy: { serviceId: 'asc' },
  })
  return narrowMenu(
    rows,
    capability ?? (await loadProLocationCapability(scope.professionalId, tx)),
  )
}

export async function loadConsultProMenu(
  tx: Prisma.TransactionClient,
  scope: { professionalId: string; serviceCategoryId: string },
): Promise<ConsultProMenu> {
  // Sequential on purpose: both reads share the caller's transaction client.
  const capability = await loadProLocationCapability(scope.professionalId, tx)
  const rows = await tx.professionalServiceOffering.findMany({
    where: {
      professionalId: scope.professionalId,
      isActive: true,
      service: {
        isActive: true,
        categoryId: scope.serviceCategoryId,
        category: { isActive: true },
      },
    },
    select: CONSULT_PRO_MENU_SELECT,
    orderBy: { serviceId: 'asc' },
  })
  return { capability, offerings: narrowMenu(rows, capability) }
}

/** The narrowed rows alone, for readers whose mode was chosen elsewhere. */
export async function loadConsultProMenuOfferings(
  tx: Prisma.TransactionClient,
  scope: { professionalId: string; serviceCategoryId: string },
): Promise<ConsultProMenuOffering[]> {
  return (await loadConsultProMenu(tx, scope)).offerings
}
