// lib/looks/forYouRanking.ts
//
// Pure, viewer-personalized re-rank for the "For You" Looks feed (B1, phase 1).
//
// The persisted `rankScore` (lib/looks/ranking.ts) is a global, viewer-agnostic
// blend of engagement × recency. For You layers a QUERY-TIME, per-viewer boost
// on top of it — no new tables, no precomputed per-viewer score:
//
//   score = rankScore * BASE_WEIGHT
//         + followBoost          (look is from a pro the viewer follows)
//         + categoryAffinityBoost(viewer has liked/saved this look's category)
//         + occasionBoost        (look's tags match a declared board occasion,
//                                 e.g. a bridal board with an upcoming wedding
//                                 — spec §7–8; weight is event-proximity-scaled
//                                 at load time in forYouFeed.ts)
//         + freshnessBoost       (extra nudge for very recent looks)
//         - seenPenalty          (viewer has already seen this look this session)
//
// Follow and category boosts are ADDITIVE (not multiplicative) so a fresh
// followed-pro look with zero engagement — rankScore 0 — still gets lifted into
// view; a multiplicative boost would leave it at zero. Seen items are normally
// excluded from the query, so the penalty is a belt-and-suspenders that also
// sinks any injected-but-already-seen look.
//
// This module is intentionally pure (all clock input injected) so the ranking
// is unit-testable in isolation from Prisma and request wiring.

const DAY_MS = 24 * 60 * 60 * 1000

export const FOR_YOU_RANK_WEIGHTS = {
  // rankScore passes through unscaled — it is the quality/recency backbone.
  base: 1,
  // A followed-pro look reliably leads its rankScore band, even at 0 engagement.
  follow: 25,
  // Per unit of category affinity (count of liked/saved looks in that category),
  // capped so a single hobby-horse category can't bury everything else.
  categoryUnit: 3,
  categoryWeightCap: 5,
  // Peak boost for a look whose tags match a declared board occasion at full
  // event proximity (weight 1.0). Sits between the category cap (15) and the
  // follow boost (25): an imminent wedding should out-pull accumulated
  // category taste but not bury the people you chose to follow.
  occasionMax: 20,
  // Peak nudge for a brand-new look; decays with a 1-day half-life.
  freshnessMax: 6,
  freshnessHalfLifeDays: 1,
  // Large enough to sink an already-seen look beneath everything unseen.
  seen: 1_000,
} as const

export type ForYouViewerAffinity = {
  followedProfessionalIds: ReadonlySet<string>
  // slug → affinity weight (raw count of the viewer's likes/saves in that
  // category; capped inside the ranker).
  categoryWeights: ReadonlyMap<string, number>
  // LookTag slug → occasion weight in [0, 1], derived from the viewer's
  // declared board purposes and scaled by event proximity at load time
  // (lib/looks/forYouFeed.ts + lib/boards/context.ts). A look matching any of
  // these tags gets occasionMax × the strongest matched weight.
  occasionTagWeights: ReadonlyMap<string, number>
}

export type ForYouRankableRow = {
  id: string
  professionalId: string
  publishedAt: Date | null
  rankScore: number
  service?: {
    category?: {
      slug?: string | null
    } | null
  } | null
  tags?: ReadonlyArray<{ slug?: string | null }> | null
}

export type ForYouRankContext = {
  affinity: ForYouViewerAffinity
  seenLookIds: ReadonlySet<string>
  now: Date
}

function safeNumber(value: number): number {
  return Number.isFinite(value) ? value : 0
}

function categorySlugOf(row: ForYouRankableRow): string | null {
  const slug = row.service?.category?.slug
  if (typeof slug !== 'string') return null
  const trimmed = slug.trim()
  return trimmed.length > 0 ? trimmed : null
}

export function computeForYouFreshnessBoost(
  publishedAt: Date | null,
  now: Date,
): number {
  if (!(publishedAt instanceof Date) || Number.isNaN(publishedAt.getTime())) {
    return 0
  }

  const ageMs = Math.max(0, now.getTime() - publishedAt.getTime())
  const ageDays = ageMs / DAY_MS
  const decay =
    1 / (1 + ageDays / FOR_YOU_RANK_WEIGHTS.freshnessHalfLifeDays)

  return FOR_YOU_RANK_WEIGHTS.freshnessMax * decay
}

export function computeForYouScore(
  row: ForYouRankableRow,
  context: ForYouRankContext,
): number {
  const base = safeNumber(row.rankScore) * FOR_YOU_RANK_WEIGHTS.base

  const followBoost = context.affinity.followedProfessionalIds.has(
    row.professionalId,
  )
    ? FOR_YOU_RANK_WEIGHTS.follow
    : 0

  const slug = categorySlugOf(row)
  const rawCategoryWeight = slug
    ? safeNumber(context.affinity.categoryWeights.get(slug) ?? 0)
    : 0
  const categoryBoost =
    Math.min(
      Math.max(rawCategoryWeight, 0),
      FOR_YOU_RANK_WEIGHTS.categoryWeightCap,
    ) * FOR_YOU_RANK_WEIGHTS.categoryUnit

  const occasionBoost =
    FOR_YOU_RANK_WEIGHTS.occasionMax *
    strongestOccasionMatch(row, context.affinity.occasionTagWeights)

  const freshnessBoost = computeForYouFreshnessBoost(
    row.publishedAt,
    context.now,
  )

  const seenPenalty = context.seenLookIds.has(row.id)
    ? FOR_YOU_RANK_WEIGHTS.seen
    : 0

  return (
    base +
    followBoost +
    categoryBoost +
    occasionBoost +
    freshnessBoost -
    seenPenalty
  )
}

// Strongest single tag match wins (clamped to [0, 1]) — matching both #bridal
// and #wedding on one look is the same occasion said twice, not double the
// signal, so weights are NOT summed across tags.
function strongestOccasionMatch(
  row: ForYouRankableRow,
  occasionTagWeights: ReadonlyMap<string, number>,
): number {
  if (occasionTagWeights.size === 0) return 0

  const tags = row.tags
  if (!Array.isArray(tags) || tags.length === 0) return 0

  let strongest = 0
  for (const tag of tags) {
    const slug = typeof tag?.slug === 'string' ? tag.slug.trim() : ''
    if (!slug) continue
    const weight = safeNumber(occasionTagWeights.get(slug) ?? 0)
    if (weight > strongest) strongest = weight
  }

  return Math.min(Math.max(strongest, 0), 1)
}

// Deterministic tie-break mirrors the DB RANKED order (rankScore desc,
// publishedAt desc, id desc) so equal personalized scores fall back to the
// global ordering rather than an arbitrary sort.
function compareForYou(
  a: { row: ForYouRankableRow; score: number },
  b: { row: ForYouRankableRow; score: number },
): number {
  if (b.score !== a.score) return b.score - a.score
  if (b.row.rankScore !== a.row.rankScore) {
    return b.row.rankScore - a.row.rankScore
  }
  const aTime = a.row.publishedAt?.getTime() ?? 0
  const bTime = b.row.publishedAt?.getTime() ?? 0
  if (bTime !== aTime) return bTime - aTime
  return b.row.id < a.row.id ? -1 : b.row.id > a.row.id ? 1 : 0
}

/**
 * Re-rank a candidate set by personalized For You score, returning a NEW array
 * ordered best-first. Does not mutate the input.
 */
export function rankForYouRows<T extends ForYouRankableRow>(
  rows: readonly T[],
  context: ForYouRankContext,
): T[] {
  return rows
    .map((row) => ({ row, score: computeForYouScore(row, context) }))
    .sort(compareForYou)
    .map((entry) => entry.row)
}
