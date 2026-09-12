// lib/services/catalog/types.ts
//
// The shape of ONE canonical catalog row, as the seed owns it. These are the
// columns `ServiceCategory` and `Service` actually carry (prisma/schema.prisma
// is the source of truth for the database shape; this is the subset the
// catalog decides), plus the licence professions a row is granted to.

import type { ConsultServiceFamily, ProfessionType } from '@prisma/client'

export type CatalogCategory = {
  /** `ServiceCategory.slug` — the identity the seed upserts by. */
  slug: string
  name: string
  description: string
  /** A sub-category names its parent; parents must be listed first. */
  parentSlug: string | null
  /** Which consult packs the category resolves (lib/consult/serviceProfile.ts). */
  consultFamily: ConsultServiceFamily
}

export type CatalogService = {
  /** `Service.name` — `@unique`, the identity the seed upserts by, and the exact string the consult recommends from. */
  name: string
  /** The PRIMARY category (`Service.categoryId`) — what the consult and every non-picker reader use. */
  categorySlug: string
  /**
   * Other categories the service is listed under in the library picker
   * (`ServiceCategoryLink`), without a second row. Never the primary.
   */
  alsoInCategorySlugs: readonly string[]
  defaultDurationMinutes: number
  /**
   * `Service.minPrice` as a two-decimal string. ⚠️ This is a HARD FLOOR, not a
   * suggestion: a pro cannot save an offering priced under it
   * (app/api/v1/pro/offerings/route.ts) and a booking charges
   * max(list price, floor) (lib/booking/rampedUnitPrice.ts). Keep it at the
   * platform minimum, never at a typical price.
   */
  floorUsd: string
  allowMobile: boolean
  isAddOnEligible: boolean
  addOnGroup: string | null
  /** Client-facing description shown in the library picker; null for none. */
  description: string | null
  /** Licences granted an ALLOW `ServicePermission` (inert unless `ENABLE_SERVICE_PERMISSION_FILTER` is on). */
  professions: readonly ProfessionType[]
}

export type ServiceCatalog = {
  categories: readonly CatalogCategory[]
  services: readonly CatalogService[]
}
