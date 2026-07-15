// lib/looks/badges/commitmentTiers.ts
//
// Commitment tier per service category (personalization spec §5.3) — the
// guardrail that decides which badge CLASSES may render on a look. The hard
// rule (spec §5.3 / guardrail #2): never badge-pressure someone toward a
// high-commitment / semi-permanent decision with scarcity tactics — trust and
// information beat urgency for anything body-modification-adjacent.
//
// This is a code-level policy SSOT keyed by ServiceCategory slug (the same
// pattern as BOARD_TYPE_FEED_SIGNALS in lib/boards/context.ts and the license
// scope map): the tier assignment IS product policy, so it lives in reviewable
// code rather than an admin-editable column. A slug that isn't listed —
// including categories added to the live catalog later — defaults to MEDIUM,
// the conservative middle: urgency stays lowest-priority, but the category
// isn't treated as body-modification-grade either. Uncategorized looks also
// read as MEDIUM.

export type LookCommitmentTier = 'LOW' | 'MEDIUM' | 'HIGH'

export const DEFAULT_COMMITMENT_TIER: LookCommitmentTier = 'MEDIUM'

/**
 * Slug → tier policy map. Slugs mirror prisma/seed.cjs and the live catalog;
 * a slug that never matches is harmless (the default applies).
 *
 * HIGH — semi-permanent / body-modification-adjacent: no urgency, trend, or
 * event-pressure badges, ever (spec §5.3).
 * MEDIUM — meaningful spend or multi-session arcs (color, extensions, skin).
 * LOW — routine, easily-reversed services where urgency is honest.
 */
export const COMMITMENT_TIER_BY_CATEGORY_SLUG: Record<
  string,
  LookCommitmentTier
> = {
  'permanent-makeup': 'HIGH',

  'hair-color': 'MEDIUM',
  'hair-extensions': 'MEDIUM',
  'hair-treatment': 'MEDIUM',
  'hair-removal': 'MEDIUM',
  lashes: 'MEDIUM',
  skin: 'MEDIUM',
  skincare: 'MEDIUM',
  facials: 'MEDIUM',

  hair: 'LOW',
  haircut: 'LOW',
  braiding: 'LOW',
  makeup: 'LOW',
  massage: 'LOW',
  waxing: 'LOW',
  brows: 'LOW',
  nails: 'LOW',
  'nails-enhancements': 'LOW',
  'nails-manicure': 'LOW',
  'nails-pedicure': 'LOW',
}

export function resolveCommitmentTier(
  categorySlug: string | null | undefined,
): LookCommitmentTier {
  if (!categorySlug) return DEFAULT_COMMITMENT_TIER
  return COMMITMENT_TIER_BY_CATEGORY_SLUG[categorySlug] ?? DEFAULT_COMMITMENT_TIER
}

/**
 * Whether a category slug names a KNOWN meaningful-commitment service — HIGH or
 * MEDIUM in the explicit policy map — where an unhurried "have questions? book a
 * consult" nudge is appropriate for a saved-not-booked look (spec §6.8 hesitation
 * row). This deliberately reads the explicit map rather than resolveCommitmentTier:
 *   - LOW categories (haircut, nails, makeup, waxing, brows) are routine and
 *     easily reversed — no consult needed, so they're excluded;
 *   - an UNKNOWN / uncategorized slug (which resolveCommitmentTier defaults to
 *     MEDIUM) is ALSO excluded — we only nudge a consult for a category we can
 *     name as meaningful-commitment, never one we're merely unsure about.
 *
 * The spec's hesitation row is scoped to "(high-commitment)"; we generalize it to
 * the commitmentTiers SSOT's notion of meaningful commitment (HIGH ∪ MEDIUM), so
 * a client mulling a big color change or extensions — not just permanent makeup —
 * gets the same gentle, information-first treatment. Broadening or narrowing this
 * is a one-line change to the tier map above.
 */
export function isConsultWorthyCommitmentSlug(
  categorySlug: string | null | undefined,
): boolean {
  if (!categorySlug) return false
  const tier = COMMITMENT_TIER_BY_CATEGORY_SLUG[categorySlug]
  return tier === 'HIGH' || tier === 'MEDIUM'
}

/**
 * The explicit list of consult-worthy category slugs (HIGH ∪ MEDIUM in the policy
 * map). Used to scope the §6.8 hesitation-consult scan's SQL to saved looks in a
 * meaningful-commitment category — the anchor that keeps that scan bounded, the
 * way the availability-gated triggers anchor on the open-pro set. Derived from the
 * single tier map, so it can never drift from isConsultWorthyCommitmentSlug.
 */
export function consultWorthyCommitmentSlugs(): string[] {
  return Object.entries(COMMITMENT_TIER_BY_CATEGORY_SLUG)
    .filter(([, tier]) => tier === 'HIGH' || tier === 'MEDIUM')
    .map(([slug]) => slug)
}
