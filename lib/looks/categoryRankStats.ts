// lib/looks/categoryRankStats.ts
//
// Per-category Bayesian prior for Look rank scoring (personalization spec
// §4.1). The global LOOK_POST_RANK_PRIOR regresses every thin-evidence Look
// toward one typical rate; the spec wants "typical for THIS service category"
// — facials and hair color earn structurally different engagement rates, so a
// global prior systematically flatters some categories and punishes others.
//
// LookCategoryRankStat holds one aggregate row per category (sums of
// intent-weighted engagement and floored impressions over eligible looks),
// refreshed by the daily looks-category-rank-stats job and by the
// recompute-look-rank-scores sweep script. resolveLookPostRankPrior turns a
// stat row into the `options.prior` the rank compute already accepts — and
// falls back to the global prior for uncategorized looks, missing rows, and
// categories without enough evidence to be a trustworthy prior themselves.

import type { PrismaClient } from '@prisma/client'
import {
  LOOK_POST_RANK_PRIOR,
  LOOK_POST_RANK_WEIGHTS,
  type LookPostRankPrior,
} from '@/lib/looks/ranking'

/**
 * The one capability the prior lookup needs, expressed structurally so both
 * Prisma.TransactionClient and PrismaClient satisfy it — and so tests can pass
 * a plain mock without type escapes.
 */
type LookCategoryRankStatReader = {
  lookCategoryRankStat: {
    findUnique(args: {
      where: { categoryId: string }
      select: { weightedEngagement: true; impressions: true }
    }): PromiseLike<{ weightedEngagement: number; impressions: number } | null>
  }
}

/**
 * A category's aggregate must cover at least this many (floored) impressions
 * before its average rate replaces the global prior — below this the category
 * average is itself thin evidence, exactly what a prior must not be.
 */
export const LOOK_CATEGORY_PRIOR_MIN_IMPRESSIONS = 500

// The smoothed rate is hard-bounded below the max signal weight by the
// impression floor (see lib/looks/ranking.ts); the prior rate must respect the
// same bound so a corrupt stat row can't push scores past it.
const MAX_PRIOR_RATE = Math.max(...Object.values(LOOK_POST_RANK_WEIGHTS))

export type LookCategoryRankStatRow = {
  categoryId: string
  weightedEngagement: number
  impressions: number
  lookCount: number
}

/**
 * The prior rate a stat row implies, or null when the row is missing, too
 * thin (< LOOK_CATEGORY_PRIOR_MIN_IMPRESSIONS), or malformed. Pure.
 */
export function computeLookCategoryPriorRate(
  stat: Pick<
    LookCategoryRankStatRow,
    'weightedEngagement' | 'impressions'
  > | null,
): number | null {
  if (!stat) return null
  if (
    !Number.isFinite(stat.impressions) ||
    stat.impressions < LOOK_CATEGORY_PRIOR_MIN_IMPRESSIONS
  ) {
    return null
  }
  if (!Number.isFinite(stat.weightedEngagement) || stat.weightedEngagement < 0) {
    return null
  }

  return Math.min(stat.weightedEngagement / stat.impressions, MAX_PRIOR_RATE)
}

/**
 * The Bayesian prior for a Look in `categoryId`: the category's observed
 * average rate when it has earned enough evidence, else the global prior. The
 * prior STRENGTH is never per-category — how much smoothing a thin-evidence
 * Look needs doesn't depend on its category.
 */
export async function resolveLookPostRankPrior(
  db: LookCategoryRankStatReader,
  categoryId: string | null | undefined,
): Promise<LookPostRankPrior> {
  if (!categoryId) return LOOK_POST_RANK_PRIOR

  const stat = await db.lookCategoryRankStat.findUnique({
    where: { categoryId },
    select: { weightedEngagement: true, impressions: true },
  })

  const rate = computeLookCategoryPriorRate(stat)
  if (rate === null) return LOOK_POST_RANK_PRIOR

  return { rate, strength: LOOK_POST_RANK_PRIOR.strength }
}

export type RefreshLookCategoryRankStatsResult = {
  categories: number
  computedAt: Date
}

/**
 * Recompute every category's aggregate from the live Look counters and replace
 * the stat table's contents atomically. One grouped SQL aggregate: the
 * engagement weighting and the per-look impression floor
 * (GREATEST(viewCount, raw engagement)) mirror
 * computeLookPostRankWeightedEngagement / computeLookPostRankImpressions —
 * the floor is row-level, which a Prisma groupBy cannot express.
 */
export async function refreshLookCategoryRankStats(
  db: PrismaClient,
  now: Date,
): Promise<RefreshLookCategoryRankStatsResult> {
  const rows = await db.$queryRaw<LookCategoryRankStatRow[]>`
    SELECT
      s."categoryId" AS "categoryId",
      SUM(
        lp."likeCount" * ${LOOK_POST_RANK_WEIGHTS.like}
        + lp."commentCount" * ${LOOK_POST_RANK_WEIGHTS.comment}
        + lp."shareCount" * ${LOOK_POST_RANK_WEIGHTS.share}
        + lp."saveCount" * ${LOOK_POST_RANK_WEIGHTS.save}
      )::double precision AS "weightedEngagement",
      SUM(
        GREATEST(
          lp."viewCount",
          lp."likeCount" + lp."commentCount" + lp."saveCount" + lp."shareCount"
        )
      )::int AS "impressions",
      COUNT(*)::int AS "lookCount"
    FROM "LookPost" lp
    JOIN "Service" s ON s."id" = lp."serviceId"
    WHERE lp."status" = 'PUBLISHED'::"LookPostStatus"
      AND lp."moderationStatus" = 'APPROVED'::"ModerationStatus"
      AND lp."publishedAt" IS NOT NULL
    GROUP BY s."categoryId"
  `

  await db.$transaction([
    db.lookCategoryRankStat.deleteMany({}),
    ...(rows.length > 0
      ? [
          db.lookCategoryRankStat.createMany({
            data: rows.map((row) => ({ ...row, computedAt: now })),
          }),
        ]
      : []),
  ])

  return { categories: rows.length, computedAt: now }
}
