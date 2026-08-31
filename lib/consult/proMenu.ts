// lib/consult/proMenu.ts
//
// The pro's MENU, as a consult is allowed to see it: her active offerings for
// active services in the consult's own category, inside the pilot vertical.
//
// One definition, deliberately. Two consult surfaces read this list and they
// must read the SAME one:
//
//   * C4 recommendation resolution (analysisContract.ts) matches each analysis
//     serviceIntent to an offering and stores the resulting reference;
//   * B3's translation module (serviceEstimate.ts) prices the look's linked
//     service and those referenced services off the pro's own columns.
//
// If those lists could diverge, the estimate could put a price on a service the
// analysis was never able to see — or refuse one the analysis had already
// matched. They were one query copied once; this is that query, extracted.

import type { Prisma } from '@prisma/client'

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
 * Ordered by serviceId so both readers walk the menu identically — the
 * recommendation matcher takes the FIRST offering whose name/description
 * matches an intent pattern, and a stable order is what keeps that answer the
 * same between the analysis run and any later read of it.
 */
export async function loadConsultProMenuOfferings(
  tx: Prisma.TransactionClient,
  scope: { professionalId: string; serviceCategoryId: string },
): Promise<ConsultProMenuOffering[]> {
  return tx.professionalServiceOffering.findMany({
    where: {
      professionalId: scope.professionalId,
      isActive: true,
      service: {
        isActive: true,
        categoryId: scope.serviceCategoryId,
        category: { isActive: true, slug: 'hair-color' },
      },
    },
    select: CONSULT_PRO_MENU_SELECT,
    orderBy: { serviceId: 'asc' },
  })
}
