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
// `haircut`, `hair-treatment` and `braiding` are spelled the way the code and
// the dev seed that already know them expect (`isStrandTestOptionalAddOn`,
// `COMMITMENT_TIER_BY_CATEGORY_SLUG`, prisma/seed.cjs).
// The colour slug itself is owned by lib/consult/serviceScope.ts and re-exported
// here so the catalog has one import for every slug.

export { HAIR_COLOR_CATEGORY_SLUG } from '@/lib/consult/serviceScope'

/** Barbering — prod's original cut category keeps its slug. */
export const HAIR_CUTS_CATEGORY_SLUG = 'cuts' as const
/** Cuts — the salon side, split out 2026-09-12 (Tori). */
export const HAIR_HAIRCUT_CATEGORY_SLUG = 'haircut' as const
export const HAIR_EXTENSIONS_CATEGORY_SLUG = 'hair-extensions' as const
export const HAIR_TREATMENT_CATEGORY_SLUG = 'hair-treatment' as const
export const HAIR_STYLING_CATEGORY_SLUG = 'hair-styling' as const
export const HAIR_BRAIDING_CATEGORY_SLUG = 'braiding' as const
