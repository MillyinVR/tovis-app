// lib/services/catalog/slugs.ts
//
// The category slugs the hair catalog is keyed on, as one leaf module. The
// catalog data (./hair.ts) and the consult's safety routing
// (lib/consult/safetyRouting.ts) both need them, and the catalog also reads the
// routing's safety-service rules — so the slugs live here, below both, rather
// than in either.
//
// `cuts`, `hair-color` and `hair-extensions` are the slugs PRODUCTION already
// has (verified by SQL 2026-09-12); the rest are the slugs this catalog adds.
// `hair-treatment` and `braiding` are spelled the way the code that already
// reads them expects (`isStrandTestOptionalAddOn`, `COMMITMENT_TIER_BY_CATEGORY_SLUG`).
// The colour slug itself is owned by lib/consult/serviceScope.ts and re-exported
// here so the catalog has one import for every slug.

export { HAIR_COLOR_CATEGORY_SLUG } from '@/lib/consult/serviceScope'

export const HAIR_CUTS_CATEGORY_SLUG = 'cuts' as const
export const HAIR_EXTENSIONS_CATEGORY_SLUG = 'hair-extensions' as const
export const HAIR_TREATMENT_CATEGORY_SLUG = 'hair-treatment' as const
export const HAIR_STYLING_CATEGORY_SLUG = 'hair-styling' as const
export const HAIR_BRAIDING_CATEGORY_SLUG = 'braiding' as const

/**
 * The slug the dev seed (prisma/seed.cjs) files cuts under. Production never
 * had it, but local databases do, so the one rule that keys on a cut category
 * accepts both spellings.
 */
export const LEGACY_DEV_HAIRCUT_CATEGORY_SLUG = 'haircut' as const
