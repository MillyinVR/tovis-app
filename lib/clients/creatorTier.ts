// lib/clients/creatorTier.ts
//
// Client-as-creator standing — the "✦ Tastemaker · top 5% saver · Brooklyn" line
// on the public profile (`/u/[handle]`).
//
// Mirrors the LookPostConversionStat / LookCategoryRankStat pattern: one grouped
// raw-SQL aggregate recomputed by a job and swapped in atomically, then read
// cheaply by primary key at serve time.
//
// WHY A JOB, NOT A REQUEST-PATH COMPUTE
// A percentile is a statement about the whole population, so it cannot be
// derived from one profile's own rows at read time — and recomputing the
// population on every profile view would make a public, unauthenticated page do
// a full-table scan. Keeping the write here also means no request path can move
// a creator's own tier: a creator using the app cannot inflate their standing,
// because nothing they do writes this table.
//
// WHAT IT MEASURES
// How widely OTHER people save this creator's looks — not how many followers
// they have. A follower count is a popularity number the creator can chase
// directly; saves are other people's judgements about the work.
import { ClientCreatorTier, type PrismaClient } from '@prisma/client'

// ── thresholds ───────────────────────────────────────────────────────────────

/**
 * Minimum PUBLIC looks before a creator is ranked at all.
 *
 * Without a floor, a brand-new creator whose single look got a handful of saves
 * can land in the top percentile of a small population and be crowned
 * Tastemaker on one data point. Unranked (`savePercentile: null`) is not a
 * failing grade — it renders as no badge, which is the honest state.
 */
export const CREATOR_TIER_MIN_PUBLIC_LOOKS = 3

/**
 * Minimum RANKED creators before anybody is given a percentile at all.
 *
 * A percentile is a claim about a population, and over a handful of people it
 * is noise wearing a statistic's clothes: with one ranked creator, whatever
 * formula you pick either crowns them or bottoms them, and both are lies. Below
 * this floor every creator stays unranked (no badge), which is the only honest
 * rendering. Set at 20 so that "top 5%" means at least one whole person.
 */
export const CREATOR_TIER_MIN_RANKED_POPULATION = 20

/** `savePercentile` at or above this is ✦ Tastemaker — the frame's "top 5%". */
export const CREATOR_TIER_TASTEMAKER_PERCENTILE = 95

/** `savePercentile` at or above this (but below Tastemaker) is Rising. */
export const CREATOR_TIER_RISING_PERCENTILE = 75

/** Tier for a percentile rank. Null (unranked) is always {@link ClientCreatorTier.NONE}. */
export function tierForSavePercentile(
  savePercentile: number | null,
): ClientCreatorTier {
  if (savePercentile === null) return ClientCreatorTier.NONE
  if (savePercentile >= CREATOR_TIER_TASTEMAKER_PERCENTILE) {
    return ClientCreatorTier.TASTEMAKER
  }
  if (savePercentile >= CREATOR_TIER_RISING_PERCENTILE) {
    return ClientCreatorTier.RISING
  }
  return ClientCreatorTier.NONE
}

/**
 * The "top N%" figure for a percentile rank, or null when unranked.
 *
 * Clamped to a minimum of 1: the single most-saved creator ranks at percentile
 * 100, and "top 0% saver" reads as a bug rather than as first place.
 */
export function topPercentFromPercentile(
  savePercentile: number | null,
): number | null {
  if (savePercentile === null) return null
  return Math.max(1, 100 - savePercentile)
}

// ── refresh job ──────────────────────────────────────────────────────────────

type CreatorAggregateRow = {
  clientId: string
  totalSaves: number
  totalRecreations: number
  publicLookCount: number
}

export type RefreshClientCreatorStatsResult = {
  /** Creators with at least one public look — every row written. */
  scored: number
  /**
   * Of those, how many actually received a percentile. Zero whenever the ranked
   * population is below {@link CREATOR_TIER_MIN_RANKED_POPULATION}, however many
   * creators cleared {@link CREATOR_TIER_MIN_PUBLIC_LOOKS}.
   */
  ranked: number
  computedAt: Date
}

/**
 * Recompute every client-creator's standing from live look/booking rows and
 * replace the stat table's contents atomically.
 *
 * One grouped aggregate over the creator's PUBLIC looks gives saves and the look
 * count; a LEFT JOIN onto attributed non-cancelled bookings gives recreations in
 * the same pass (same attribution rule as `refreshLookPostConversionStats` —
 * `Booking.sourceLookPostId`, excluding cancellations). Grouping over looks means
 * only clients who have actually published appear, so clients who never posted
 * cost nothing and correctly stay untiered.
 */
export async function refreshClientCreatorStats(
  db: PrismaClient,
  now: Date,
): Promise<RefreshClientCreatorStatsResult> {
  // ⚠️ The booking count is a correlated subquery over the SAME public-look CTE
  // rather than a join in the outer aggregate. Joining bookings in directly
  // would fan each look out to one row per attributed booking, and
  // SUM(saveCount) would then count a look's saves once per booking — silently
  // multiplying the number the whole tier is ranked on.
  const scored = await db.$queryRaw<CreatorAggregateRow[]>`
    WITH public_looks AS (
      SELECT lp."id", lp."clientAuthorId", lp."saveCount"
      FROM "LookPost" lp
      WHERE lp."clientAuthorId" IS NOT NULL
        AND lp."status" = 'PUBLISHED'::"LookPostStatus"
        AND lp."visibility" = 'PUBLIC'::"LookPostVisibility"
        AND lp."moderationStatus" = 'APPROVED'::"ModerationStatus"
        AND lp."publishedAt" IS NOT NULL
        AND lp."removedAt" IS NULL
    )
    SELECT
      pl."clientAuthorId" AS "clientId",
      COALESCE(SUM(pl."saveCount"), 0)::int AS "totalSaves",
      COUNT(*)::int AS "publicLookCount",
      (
        SELECT COUNT(*)::int
        FROM "Booking" b
        JOIN public_looks src ON src."id" = b."sourceLookPostId"
        WHERE src."clientAuthorId" = pl."clientAuthorId"
          AND b."status" <> 'CANCELLED'::"BookingStatus"
      ) AS "totalRecreations"
    FROM public_looks pl
    GROUP BY pl."clientAuthorId"
  `

  // Percentile is computed over the RANKED population only (creators past the
  // minimum-looks floor). Including unranked creators in the denominator would
  // let a flood of one-look accounts inflate everyone else's percentile.
  const rankable = scored
    .filter((row) => row.publicLookCount >= CREATOR_TIER_MIN_PUBLIC_LOOKS)
    .sort((a, b) => a.totalSaves - b.totalSaves)

  // Single ascending pass over the ranked population, using the standard
  // tie-aware percentile rank: (below + equal/2) / n. Ties share one rank, and
  // splitting the tied block is what stops a field where everyone is level from
  // reading as everyone being top — plain "at or below" would hand all of them
  // 100 and mint a page of Tastemakers.
  //
  // Skipped entirely below the population floor: nobody gets a percentile, so
  // `tierForSavePercentile(null)` leaves the whole field untiered.
  const percentileByClient = new Map<string, number>()
  if (rankable.length >= CREATOR_TIER_MIN_RANKED_POPULATION) {
    for (let i = 0; i < rankable.length; ) {
      const value = rankable[i]!.totalSaves
      const below = i
      let j = i
      while (j < rankable.length && rankable[j]!.totalSaves === value) j += 1
      const equal = j - i
      const percentile = Math.round(
        ((below + equal / 2) / rankable.length) * 100,
      )
      for (let k = i; k < j; k += 1) {
        percentileByClient.set(rankable[k]!.clientId, percentile)
      }
      i = j
    }
  }

  const data = scored.map((row) => {
    const savePercentile = percentileByClient.get(row.clientId) ?? null
    return {
      clientId: row.clientId,
      totalSaves: row.totalSaves,
      totalRecreations: row.totalRecreations,
      publicLookCount: row.publicLookCount,
      savePercentile,
      tier: tierForSavePercentile(savePercentile),
      computedAt: now,
    }
  })

  await db.$transaction([
    db.clientCreatorStat.deleteMany({}),
    ...(data.length > 0 ? [db.clientCreatorStat.createMany({ data })] : []),
  ])

  // `ranked` is what actually received a percentile — 0 when the population is
  // below the floor, even though `rankable` cleared the per-creator look gate.
  return { scored: data.length, ranked: percentileByClient.size, computedAt: now }
}
