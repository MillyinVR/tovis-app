// lib/looks/boardFeedRanking.ts
//
// Pure, board-scoped re-rank for the "Recommended for this board" feed —
// the board-page sibling of the For You feed (spec §4.4 board_feed_score).
// Where For You personalizes against the viewer's WHOLE-account taste, this
// personalizes against ONE board's declared purpose, its chip answers, its
// saved-look taste, and the owner's self-profile:
//
//   score = engagement_score (rankScore backbone, same as For You's base)
//         + occasion_tag_match(board.type)        // heaviest — the board's
//                                                 //   purpose tags, scaled by
//                                                 //   event proximity (§7–8)
//         + service_specific_match(board.answers) // chip answers → look tags
//         + visual_similarity(BoardTasteVector)   // cosine vs saved-look taste
//                                                 //   (§6.0; dark pre-backfill)
//         + feasibility_match(self_profile)       // §6.6 person-attributes
//         + freshnessBoost                        // nudge very recent looks
//         - seenPenalty                           // already-seen this session
//
// Spec §4.4 also lists availability_boost. There is no per-look availability
// primitive yet (neither does For You use one), so that term is deliberately
// omitted here rather than faked; it lands when a look-side availability signal
// exists. All other terms are additive and null-safe — a board with no event
// date, no answers, no taste vector, or an owner with no self-profile simply
// sees those terms contribute 0 and falls back to the engagement backbone.
//
// Reuses the For You primitives (cosineSimilarity, computeVisualSimilarityBoost,
// computeForYouFreshnessBoost, strongestTagWeightMatch) so the two feeds share
// one visual/occasion/freshness implementation. Pure (clock injected) so the
// whole score is unit-testable without Prisma.

import {
  computeForYouFreshnessBoost,
  computeVisualSimilarityBoost,
  strongestTagWeightMatch,
  type ForYouRankableRow,
} from '@/lib/looks/forYouRanking'

// A board-feed candidate is the same row shape the For You ranker scores.
export type BoardFeedRankableRow = ForYouRankableRow

export const BOARD_FEED_RANK_WEIGHTS = {
  // rankScore passes through unscaled — the engagement/recency backbone.
  base: 1,
  // Peak occasion boost: a candidate whose tags match the board's declared
  // purpose at full event proximity (an imminent wedding). The HEAVIEST term
  // (spec §4.4) — a bridal board should lead with bridal looks. Matches the For
  // You occasion weight so the two feeds calibrate against the same band.
  occasionMax: 20,
  // service_specific_match (spec §4.4): the board's chip answers (a red prom
  // dress, a platinum dream color, an acne focus) mapped to look tags. Below
  // occasion — the purpose is a stronger steer than a single answer — but a
  // real, above-freshness nudge.
  serviceAnswerMax: 12,
  // feasibility_match (spec §4.4/§6.6): the owner's self-profile person-
  // attributes ("hair like mine"). Below the answer term; the buildable
  // tag-level approximation until look-side start-state attributes exist.
  feasibilityMax: 10,
  // Peak visual-similarity boost (spec §6.0) — realized as visualMax × clamped
  // cosine × confidence, so a typical genuine match contributes single digits.
  // Reuses the For You visual weight/scale.
  visualMax: 20,
  // Peak nudge for a brand-new look (via computeForYouFreshnessBoost, 1-day
  // half-life) — same freshness curve/weight as For You.
  freshnessMax: 6,
  // Large enough to sink an already-seen look beneath everything unseen.
  seen: 1_000,
} as const

export type BoardFeedContext = {
  // LookTag slug → occasion weight in [0, 1]: the board's BOARD_TYPE_FEED_SIGNALS
  // tag slugs, each carrying the board's event proximity (computed at load time
  // in lib/looks/boardFeed.ts). Empty for a GENERAL / undated / passed board.
  occasionTagWeights: ReadonlyMap<string, number>
  // LookTag slugs implied by the board's chip answers (§4.4 service_specific_
  // match). Any candidate tag in this set earns the full serviceAnswer boost.
  answerTagSlugs: ReadonlySet<string>
  // LookTag slugs implied by the owner's self-profile (§4.4 feasibility_match).
  // Any candidate tag in this set earns the full feasibility boost.
  feasibilityTagSlugs: ReadonlySet<string>
  // The board's local taste vector (§6.1 local_taste_embedding), L2-normalized
  // at write, plus how many embedded saves built it. null/0 = no visual boost.
  tasteVector: readonly number[] | null
  tasteSignalCount: number
  // Candidate look image embeddings keyed by look id (fetched by PK for the
  // page). A look absent from the map is unembedded → 0 visual boost.
  candidateEmbeddings: ReadonlyMap<string, readonly number[]>
  seenLookIds: ReadonlySet<string>
  now: Date
}

/** Full boost if the row carries any tag in the set, else 0. Pure. */
function tagSetMatchBoost(
  row: Pick<BoardFeedRankableRow, 'tags'>,
  slugs: ReadonlySet<string>,
  max: number,
): number {
  if (slugs.size === 0) return 0
  const tags = row.tags
  if (!Array.isArray(tags) || tags.length === 0) return 0
  for (const tag of tags) {
    const slug = typeof tag?.slug === 'string' ? tag.slug.trim() : ''
    if (slug && slugs.has(slug)) return max
  }
  return 0
}

export function computeBoardFeedScore(
  row: BoardFeedRankableRow,
  context: BoardFeedContext,
): number {
  const base =
    (Number.isFinite(row.rankScore) ? row.rankScore : 0) *
    BOARD_FEED_RANK_WEIGHTS.base

  const occasionBoost =
    BOARD_FEED_RANK_WEIGHTS.occasionMax *
    strongestTagWeightMatch(row, context.occasionTagWeights)

  const serviceAnswerBoost = tagSetMatchBoost(
    row,
    context.answerTagSlugs,
    BOARD_FEED_RANK_WEIGHTS.serviceAnswerMax,
  )

  const feasibilityBoost = tagSetMatchBoost(
    row,
    context.feasibilityTagSlugs,
    BOARD_FEED_RANK_WEIGHTS.feasibilityMax,
  )

  const visualBoost = computeVisualSimilarityBoost({
    tasteVector: context.tasteVector,
    tasteSignalCount: context.tasteSignalCount,
    candidateEmbedding: context.candidateEmbeddings.get(row.id),
  })

  const freshnessBoost = computeForYouFreshnessBoost(row.publishedAt, context.now)

  const seenPenalty = context.seenLookIds.has(row.id)
    ? BOARD_FEED_RANK_WEIGHTS.seen
    : 0

  return (
    base +
    occasionBoost +
    serviceAnswerBoost +
    feasibilityBoost +
    visualBoost +
    freshnessBoost -
    seenPenalty
  )
}

// Deterministic tie-break mirrors the DB RANKED order (rankScore desc,
// publishedAt desc, id desc) so equal personalized scores fall back to the
// global ordering rather than an arbitrary sort.
function compareBoardFeed(
  a: { row: BoardFeedRankableRow; score: number },
  b: { row: BoardFeedRankableRow; score: number },
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
 * Re-rank a candidate set by board-feed score, returning a NEW array ordered
 * best-first. Does not mutate the input.
 */
export function rankBoardFeedRows<T extends BoardFeedRankableRow>(
  rows: readonly T[],
  context: BoardFeedContext,
): T[] {
  return rows
    .map((row) => ({ row, score: computeBoardFeedScore(row, context) }))
    .sort(compareBoardFeed)
    .map((entry) => entry.row)
}
