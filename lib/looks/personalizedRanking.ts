// lib/looks/personalizedRanking.ts
//
// Pure, viewer-personalized re-rank for the personalized Looks feed (B1, phase 1).
//
// The persisted `rankScore` (lib/looks/ranking.ts) is a global, viewer-agnostic
// blend of engagement × recency. The personalized feed layers a QUERY-TIME, per-viewer boost
// on top of it — no new tables, no precomputed per-viewer score:
//
//   score = rankScore * BASE_WEIGHT
//         + followBoost          (look is from a pro the viewer follows)
//         + categoryAffinityBoost(viewer has liked/saved this look's category)
//         + occasionBoost        (look's tags match a declared board occasion,
//                                 e.g. a bridal board with an upcoming wedding
//                                 — spec §7–8; weight is event-proximity-scaled
//                                 at load time in personalizedFeed.ts)
//         + visualBoost          (candidate look's image embedding is cosine-
//                                 similar to the viewer's taste vector — spec
//                                 §6.0; tags retrieve, embeddings RANK within
//                                 the candidates. Confidence-gated by how many
//                                 signals built the taste vector)
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

export const PERSONALIZED_RANK_WEIGHTS = {
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
  // Peak visual-similarity boost (spec §6.0): a candidate whose image embedding
  // is cosine-1.0 to the viewer's taste vector, at full taste confidence. Sits
  // alongside the occasion boost (20) and below the follow boost (25) — a strong
  // visual match should out-pull accumulated category taste (cap 15) but never
  // override a pro the viewer explicitly chose to follow. The realized boost is
  // visualMax × clamped-cosine × confidence, so a typical genuine match (cosine
  // ~0.3–0.5) contributes ~single digits, not the full 20; it nudges ordering
  // within a rankScore band rather than dominating it.
  visualMax: 20,
  // Taste-confidence ramp: the visual boost reaches full strength only once the
  // taste vector is built from this many embedded signals. A 1–2 signal vector
  // is noisy — one outlier save can swing it — so it barely steers the feed
  // until the taste picture fills in (spec §6.0 "signal-weighted average").
  visualConfidenceFullSignals: 10,
  // Peak nudge for a brand-new look; decays with a 1-day half-life.
  freshnessMax: 6,
  freshnessHalfLifeDays: 1,
  // Large enough to sink an already-seen look beneath everything unseen.
  seen: 1_000,
} as const

export type PersonalizedViewerAffinity = {
  followedProfessionalIds: ReadonlySet<string>
  // slug → affinity weight (raw count of the viewer's likes/saves in that
  // category; capped inside the ranker).
  categoryWeights: ReadonlyMap<string, number>
  // LookTag slug → occasion weight in [0, 1], derived from the viewer's
  // declared board purposes and scaled by event proximity at load time
  // (lib/looks/personalizedFeed.ts + lib/boards/context.ts). A look matching any of
  // these tags gets occasionMax × the strongest matched weight.
  occasionTagWeights: ReadonlyMap<string, number>
  // The viewer's global taste vector (spec §6.1 global_taste_embedding) —
  // L2-normalized at write in lib/personalization/tasteVectors.ts — and how many
  // embedded signals built it. null/absent when the viewer has no stored vector
  // (pre-backfill, no signals, or signals only on unembedded looks): the visual
  // boost is then 0. Optional so non-visual callers (unit tests, the follow-only
  // paths) can omit them without churn. Note: from §6.3 this vector is the stored
  // vector already blended with this sitting's fresh likes/saves at load time
  // (lib/looks/personalizedFeed.ts), and tasteSignalCount its blended confidence.
  tasteVector?: readonly number[] | null
  tasteSignalCount?: number
  // Observability only (ignored by scoring): how many fresh same-session
  // like/save embeddings folded into the taste vector this request (spec §6.3).
  sessionVisualSignalCount?: number
}

export type PersonalizedRankableRow = {
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

export type PersonalizedRankContext = {
  affinity: PersonalizedViewerAffinity
  seenLookIds: ReadonlySet<string>
  now: Date
  // Candidate look image embeddings keyed by look id (raw provider vectors,
  // fetched by PK for the page in lib/looks/personalizedFeed.ts). A look absent from
  // the map is not yet embedded → 0 visual boost. Optional/empty when the viewer
  // has no taste vector to compare against (the fetch is skipped entirely then).
  candidateEmbeddings?: ReadonlyMap<string, readonly number[]>
}

function safeNumber(value: number): number {
  return Number.isFinite(value) ? value : 0
}

function categorySlugOf(row: PersonalizedRankableRow): string | null {
  const slug = row.service?.category?.slug
  if (typeof slug !== 'string') return null
  const trimmed = slug.trim()
  return trimmed.length > 0 ? trimmed : null
}

export function computePersonalizedFreshnessBoost(
  publishedAt: Date | null,
  now: Date,
): number {
  if (!(publishedAt instanceof Date) || Number.isNaN(publishedAt.getTime())) {
    return 0
  }

  const ageMs = Math.max(0, now.getTime() - publishedAt.getTime())
  const ageDays = ageMs / DAY_MS
  const decay =
    1 / (1 + ageDays / PERSONALIZED_RANK_WEIGHTS.freshnessHalfLifeDays)

  return PERSONALIZED_RANK_WEIGHTS.freshnessMax * decay
}

/**
 * Cosine similarity between two equal-length vectors, computed as
 * dot / (‖a‖·‖b‖) so it is correct regardless of whether either side is
 * pre-normalized — the taste vector is L2-normalized at write, but raw look
 * embeddings are not. Returns 0 on a length mismatch or a zero-norm/degenerate
 * input (no signal, never NaN). Pure + exported for unit testing.
 */
export function cosineSimilarity(
  a: readonly number[],
  b: readonly number[],
): number {
  if (a.length === 0 || a.length !== b.length) return 0

  let dot = 0
  let normA = 0
  let normB = 0
  for (let i = 0; i < a.length; i += 1) {
    const av = a[i] ?? 0
    const bv = b[i] ?? 0
    dot += av * bv
    normA += av * av
    normB += bv * bv
  }

  if (normA <= 0 || normB <= 0) return 0
  const sim = dot / Math.sqrt(normA * normB)
  return Number.isFinite(sim) ? sim : 0
}

/**
 * Additive visual-similarity boost (spec §6.0):
 *   visualMax × clamped-cosine × confidence
 * Cosine is clamped to [0, 1] — a look aesthetically opposite the viewer's taste
 * earns no boost rather than a negative penalty (sinking dissimilar looks is not
 * this term's job; the seen penalty handles exclusion). Confidence ramps 0→1 as
 * the taste vector accrues embedded signals (visualConfidenceFullSignals), so a
 * thin, noisy vector barely moves the feed. Any missing input — no taste vector,
 * no candidate embedding — yields 0. Pure + exported for unit testing.
 */
export function computeVisualSimilarityBoost(args: {
  tasteVector: readonly number[] | null | undefined
  tasteSignalCount: number | null | undefined
  candidateEmbedding: readonly number[] | null | undefined
}): number {
  const { tasteVector, candidateEmbedding } = args
  if (!tasteVector || tasteVector.length === 0) return 0
  if (!candidateEmbedding || candidateEmbedding.length === 0) return 0

  const clampedCosine = Math.min(
    Math.max(cosineSimilarity(tasteVector, candidateEmbedding), 0),
    1,
  )
  if (clampedCosine <= 0) return 0

  const rawSignals = args.tasteSignalCount
  const signals =
    typeof rawSignals === 'number' && Number.isFinite(rawSignals)
      ? Math.max(0, rawSignals)
      : 0
  const confidence = Math.min(
    signals / PERSONALIZED_RANK_WEIGHTS.visualConfidenceFullSignals,
    1,
  )
  if (confidence <= 0) return 0

  return PERSONALIZED_RANK_WEIGHTS.visualMax * clampedCosine * confidence
}

export function computePersonalizedScore(
  row: PersonalizedRankableRow,
  context: PersonalizedRankContext,
): number {
  const base = safeNumber(row.rankScore) * PERSONALIZED_RANK_WEIGHTS.base

  const followBoost = context.affinity.followedProfessionalIds.has(
    row.professionalId,
  )
    ? PERSONALIZED_RANK_WEIGHTS.follow
    : 0

  const slug = categorySlugOf(row)
  const rawCategoryWeight = slug
    ? safeNumber(context.affinity.categoryWeights.get(slug) ?? 0)
    : 0
  const categoryBoost =
    Math.min(
      Math.max(rawCategoryWeight, 0),
      PERSONALIZED_RANK_WEIGHTS.categoryWeightCap,
    ) * PERSONALIZED_RANK_WEIGHTS.categoryUnit

  const occasionBoost =
    PERSONALIZED_RANK_WEIGHTS.occasionMax *
    strongestTagWeightMatch(row, context.affinity.occasionTagWeights)

  const visualBoost = computeVisualSimilarityBoost({
    tasteVector: context.affinity.tasteVector,
    tasteSignalCount: context.affinity.tasteSignalCount,
    candidateEmbedding: context.candidateEmbeddings?.get(row.id),
  })

  const freshnessBoost = computePersonalizedFreshnessBoost(
    row.publishedAt,
    context.now,
  )

  const seenPenalty = context.seenLookIds.has(row.id)
    ? PERSONALIZED_RANK_WEIGHTS.seen
    : 0

  return (
    base +
    followBoost +
    categoryBoost +
    occasionBoost +
    visualBoost +
    freshnessBoost -
    seenPenalty
  )
}

/**
 * Strongest single tag match wins (clamped to [0, 1]) — matching both #bridal
 * and #wedding on one look is the same occasion said twice, not double the
 * signal, so weights are NOT summed across tags. Generic over any slug→weight
 * map, so the §4.4 board feed reuses it for its occasion term. Pure + exported.
 */
export function strongestTagWeightMatch(
  row: Pick<PersonalizedRankableRow, 'tags'>,
  tagWeights: ReadonlyMap<string, number>,
): number {
  if (tagWeights.size === 0) return 0

  const tags = row.tags
  if (!Array.isArray(tags) || tags.length === 0) return 0

  let strongest = 0
  for (const tag of tags) {
    const slug = typeof tag?.slug === 'string' ? tag.slug.trim() : ''
    if (!slug) continue
    const weight = safeNumber(tagWeights.get(slug) ?? 0)
    if (weight > strongest) strongest = weight
  }

  return Math.min(Math.max(strongest, 0), 1)
}

// Deterministic tie-break mirrors the DB RANKED order (rankScore desc,
// publishedAt desc, id desc) so equal personalized scores fall back to the
// global ordering rather than an arbitrary sort.
function comparePersonalized(
  a: { row: PersonalizedRankableRow; score: number },
  b: { row: PersonalizedRankableRow; score: number },
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
 * Re-rank a candidate set by personalized score, returning a NEW array
 * ordered best-first. Does not mutate the input.
 */
export function rankPersonalizedRows<T extends PersonalizedRankableRow>(
  rows: readonly T[],
  context: PersonalizedRankContext,
): T[] {
  return rows
    .map((row) => ({ row, score: computePersonalizedScore(row, context) }))
    .sort(comparePersonalized)
    .map((entry) => entry.row)
}
