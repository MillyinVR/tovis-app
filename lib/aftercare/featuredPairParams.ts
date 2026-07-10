// lib/aftercare/featuredPairParams.ts
//
// Query-param plumbing for carrying a pro's featured before/after pair
// pre-selection from the session "after-photos" wrap-up step into the aftercare
// authoring form — WITHOUT an early DB write (see the AF2 follow-up). The pro
// can tap "Feature" on a before and an after photo at the after-photos step; the
// choice rides along as `?fb=…&fa=…` and pre-fills the aftercare form, which
// remains the single persist boundary (the `AftercareSummary` upsert).
//
// This module is deliberately Prisma-free so it is safe to import into the
// client picker component AND the server pages. The validation that a carried id
// is actually an IMAGE of the matching phase on the booking lives in
// `resolveFeaturedPairSeed` (server-side, Prisma-aware).

export const FEATURED_BEFORE_PARAM = 'fb'
export const FEATURED_AFTER_PARAM = 'fa'

/**
 * Serialize a featured pair into a query string. Both keys are ALWAYS emitted
 * (empty string when unset) so the reader can distinguish "the pro carried an
 * explicit choice — possibly cleared" (key present) from "no pre-selection at
 * all" (key absent → fall back to any saved value). See `resolveFeaturedPairSeed`.
 */
export function buildFeaturedPairQuery(
  beforeAssetId: string | null,
  afterAssetId: string | null,
): string {
  const params = new URLSearchParams()
  params.set(FEATURED_BEFORE_PARAM, beforeAssetId ?? '')
  params.set(FEATURED_AFTER_PARAM, afterAssetId ?? '')
  return params.toString()
}

/**
 * Normalize a Next.js searchParams value (`string | string[] | undefined`) to a
 * single `string | undefined`. `undefined` means the key was absent — a
 * meaningful signal here (see `buildFeaturedPairQuery`), so it is preserved
 * rather than coerced to `''`.
 */
export function normalizeSeedParam(
  value: string | string[] | undefined,
): string | undefined {
  if (Array.isArray(value)) return value[0]
  return value
}
