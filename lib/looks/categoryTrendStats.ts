// lib/looks/categoryTrendStats.ts
//
// Per-family RECENT engagement-trend aggregate — the data source behind the
// engagement-driven ordering of the camera shot packs (camera-perfect C10,
// lib/pro/cameraShotPacks.ts). Sibling of lib/looks/categoryRankStats.ts: same
// per-category engagement primitive, but summed over a RECENT publish window
// instead of all time, so it answers "which service family is hot right now?"
// rather than "what engagement rate is typical for this family?".
//
// Rows are keyed by the TOP-LEVEL family category: leaf categories (a look's
// Service.categoryId is usually a leaf like `hair-color`) are rolled up to their
// root (`hair`) at refresh time, because a shot pack targets a whole family, not
// a leaf. One small row per active family (~10 rows), refreshed daily by the
// looks-category-trend-stats job and read cheaply at serve time.
//
// Honesty notes (a soft ordering signal must stay honest):
//   - "Recent" is windowed by the look's `publishedAt`, NOT by when the
//     engagement accrued — the LookPost counters are lifetime totals, so there
//     is no per-window engagement breakdown to sum. So this measures "looks
//     published in the last `windowDays` that are getting engagement", a good
//     proxy for current heat, not a strict trailing-window engagement count.
//   - The strength is FIELD-RELATIVE: each family's rate is scored against the
//     hottest evidenced family this cycle, so the numbers spread meaningfully
//     across families (an absolute rate-per-impression is a few percent and
//     would barely move the ordering). It ranks families against each other now
//     — exactly what "trending" means — and is damped by a confidence ramp so a
//     thin-evidence family can't win on noise.
//   - A missing/empty table reads as "no trend signal" (strength 0), which
//     leaves the shot packs in their editorial order — byte-identical to the
//     pre-C10 payload. This table can only REORDER packs, never break the camera.

import type { PrismaClient } from '@prisma/client'

import { LOOK_POST_RANK_WEIGHTS } from '@/lib/looks/ranking'

const DAY_MS = 24 * 60 * 60 * 1000

export const LOOK_CATEGORY_TREND = {
  // How many days back (by publishedAt) a look counts toward "recent" heat.
  // A month balances recency against a sparse catalog — a 7-day window would be
  // too noisy with few new looks; the header still refreshes daily so a genuine
  // shift surfaces within a day.
  windowDays: 30,
  // Floored impressions a family needs before its rate is trusted as the field
  // reference and lifts a pack at full strength. Below this the family still
  // scores, but its confidence (and so its lift) ramps up from zero — thin
  // evidence barely reorders. Narrower window than the rank prior's 500, so a
  // lower floor.
  minImpressions: 200,
} as const

export type CategoryTrendNode = {
  id: string
  slug: string
  parentId: string | null
}

// One grouped-by-leaf-category row as the windowed SQL returns it.
export type CategoryTrendLeafRow = {
  categoryId: string
  weightedEngagement: number
  impressions: number
  lookCount: number
}

// A family (root) row after leaves are folded up — the table's shape.
export type LookCategoryTrendStatRow = {
  categoryId: string
  categorySlug: string
  weightedEngagement: number
  impressions: number
  lookCount: number
}

/**
 * Walk `categoryId` up to its top-level ancestor via `parentById`. Stops at the
 * first category with no parent (root), an unknown category, or a dangling
 * parent id, and guards against a parent cycle — always returns a concrete id.
 * Pure.
 */
export function resolveRootCategoryId(
  categoryId: string,
  parentById: ReadonlyMap<string, string | null>,
): string {
  let current = categoryId
  const seen = new Set<string>()
  while (!seen.has(current)) {
    seen.add(current)
    const parent = parentById.get(current)
    // No parent (root), unknown category, or a parent id we don't have → the
    // highest ancestor we can name is `current`.
    if (!parent || !parentById.has(parent)) return current
    current = parent
  }
  return current // cycle guard
}

/**
 * Fold per-leaf-category engagement sums up to their top-level family and drop
 * families with no impressions ("skip the zeros"). A leaf whose root category is
 * absent from `categories` is skipped (it can't be keyed or served). Pure —
 * unit-tested separately from the SQL.
 */
export function foldCategoryTrendToRoots(
  leafRows: readonly CategoryTrendLeafRow[],
  categories: readonly CategoryTrendNode[],
): LookCategoryTrendStatRow[] {
  const parentById = new Map<string, string | null>()
  const slugById = new Map<string, string>()
  for (const c of categories) {
    parentById.set(c.id, c.parentId)
    slugById.set(c.id, c.slug)
  }

  const byRoot = new Map<string, LookCategoryTrendStatRow>()
  for (const row of leafRows) {
    const rootId = resolveRootCategoryId(row.categoryId, parentById)
    const slug = slugById.get(rootId)
    if (!slug) continue
    const we = Number.isFinite(row.weightedEngagement)
      ? Math.max(row.weightedEngagement, 0)
      : 0
    const impressions = Number.isFinite(row.impressions)
      ? Math.max(row.impressions, 0)
      : 0
    const lookCount = Number.isFinite(row.lookCount) ? Math.max(row.lookCount, 0) : 0
    const existing = byRoot.get(rootId)
    if (existing) {
      existing.weightedEngagement += we
      existing.impressions += impressions
      existing.lookCount += lookCount
    } else {
      byRoot.set(rootId, {
        categoryId: rootId,
        categorySlug: slug,
        weightedEngagement: we,
        impressions,
        lookCount,
      })
    }
  }

  return [...byRoot.values()].filter((row) => row.impressions > 0)
}

export type CategoryTrendStrengthInput = {
  categorySlug: string
  weightedEngagement: number
  impressions: number
}

/**
 * Field-relative trend strength per family slug, each in [0,1]. A family's
 * weighted-engagement rate is scored against the hottest EVIDENCED family this
 * cycle (>= minImpressions), then damped by a confidence ramp
 * (impressions / minImpressions, capped at 1) so a thin family can't win on
 * noise. With no evidenced family the reference falls back to the hottest of
 * all (confidence still keeps every lift small). Pure.
 */
export function computeCategoryTrendStrengths(
  rows: readonly CategoryTrendStrengthInput[],
): Map<string, number> {
  const min = LOOK_CATEGORY_TREND.minImpressions

  const entries = rows.map((row) => {
    const impressions =
      Number.isFinite(row.impressions) && row.impressions > 0 ? row.impressions : 0
    const weighted =
      Number.isFinite(row.weightedEngagement) && row.weightedEngagement > 0
        ? row.weightedEngagement
        : 0
    const rate = impressions > 0 ? weighted / impressions : 0
    const confidence = Math.min(Math.max(impressions / min, 0), 1)
    return {
      slug: row.categorySlug,
      rate,
      confidence,
      evidenced: impressions >= min,
    }
  })

  const evidencedRates = entries.filter((e) => e.evidenced).map((e) => e.rate)
  const reference =
    evidencedRates.length > 0
      ? Math.max(...evidencedRates)
      : Math.max(0, ...entries.map((e) => e.rate))

  const out = new Map<string, number>()
  for (const entry of entries) {
    const relative =
      reference > 0 ? Math.min(Math.max(entry.rate / reference, 0), 1) : 0
    out.set(entry.slug, relative * entry.confidence)
  }
  return out
}

/**
 * The one capability the serve-time reader needs, expressed structurally so both
 * PrismaClient and a plain test mock satisfy it (no type escapes).
 */
export type CategoryTrendStatReader = {
  lookCategoryTrendStat: {
    findMany(args: {
      select: {
        categorySlug: true
        weightedEngagement: true
        impressions: true
      }
    }): PromiseLike<CategoryTrendStrengthInput[]>
  }
}

/**
 * Serve-time reader: load every family trend row (a small table) and reduce it
 * to a slug → strength[0,1] map. Field-relative strength needs the whole set, so
 * we read all rows (not a filtered subset). A slug absent from the returned map
 * has no trend signal → strength 0 at the call site.
 */
export async function fetchCategoryTrendStrengths(
  db: CategoryTrendStatReader,
): Promise<Map<string, number>> {
  const rows = await db.lookCategoryTrendStat.findMany({
    select: {
      categorySlug: true,
      weightedEngagement: true,
      impressions: true,
    },
  })
  return computeCategoryTrendStrengths(rows)
}

export type RefreshLookCategoryTrendStatsResult = {
  families: number
  windowDays: number
  computedAt: Date
}

/**
 * Recompute every family's recent engagement trend and swap the table contents
 * in atomically. One grouped SQL aggregate over looks PUBLISHED in the trailing
 * window (the engagement weighting + per-look impression floor mirror
 * categoryRankStats — a row-level floor a Prisma groupBy cannot express), folded
 * from leaf categories up to their top-level family in code.
 */
export async function refreshLookCategoryTrendStats(
  db: PrismaClient,
  now: Date,
): Promise<RefreshLookCategoryTrendStatsResult> {
  const windowDays = LOOK_CATEGORY_TREND.windowDays
  const publishedSince = new Date(now.getTime() - windowDays * DAY_MS)

  const [leafRows, categories] = await Promise.all([
    db.$queryRaw<CategoryTrendLeafRow[]>`
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
        AND lp."publishedAt" >= ${publishedSince}
      GROUP BY s."categoryId"
    `,
    db.serviceCategory.findMany({
      select: { id: true, slug: true, parentId: true },
    }),
  ])

  const rows = foldCategoryTrendToRoots(leafRows, categories)

  await db.$transaction([
    db.lookCategoryTrendStat.deleteMany({}),
    ...(rows.length > 0
      ? [
          db.lookCategoryTrendStat.createMany({
            data: rows.map((row) => ({ ...row, windowDays, computedAt: now })),
          }),
        ]
      : []),
  ])

  return { families: rows.length, windowDays, computedAt: now }
}
