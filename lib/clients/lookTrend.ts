// lib/clients/lookTrend.ts
//
// Per-look weekly momentum — the "Your Lived-in blonde is trending · +84 saves
// this week · top 3% in Brooklyn" banner on /client/activity.
//
// WHY THIS RIDES THE EXISTING SCORER
// This is the same shape of question `lib/clients/creatorTier.ts` already
// answers: a population statement that cannot be derived from one row at read
// time, recomputed by a job and swapped in atomically. It is written by the SAME
// hourly cron (/api/internal/jobs/client-creator-stats) rather than a second
// one, so there is one schedule to reason about and the two aggregates can never
// be computed against different clocks.
//
// NO NEW EVENT STREAM
// A save IS a `BoardItem` row — `LookPost.saveCount` is literally
// `boardItem.count({ where: { lookPostId } })` (lib/looks/counters.ts) — and
// `BoardItem` already carries `createdAt` plus the index
// `@@index([lookPostId, createdAt])`. So the weekly delta is a COUNT over rows
// that exist today.
//
// 🔴 IT COUNTS THE SAME UNIT `saveCount` COUNTS: plain BoardItem rows, not
// distinct clients. Counting people here would let the headline total and the
// weekly delta disagree about what a save is, and a "+84 saves" that cannot be
// reconciled with the number beside the bookmark icon reads as a bug.
import { Prisma, type PrismaClient } from '@prisma/client'

import {
  CREATOR_TIER_RISING_PERCENTILE,
  topPercentFromPercentile,
} from '@/lib/clients/creatorTier'

type LookTrendDb = PrismaClient | Prisma.TransactionClient

// ── thresholds ───────────────────────────────────────────────────────────────

/**
 * The trailing window, in days.
 *
 * Deliberately a rolling 7×24h instant subtraction rather than a local calendar
 * week. A calendar week has to be resolved in SOMEBODY's timezone, and the only
 * zone available to an hourly job is the server's — UTC on Vercel — so "this
 * week" would silently mean "this UTC week" for a creator in Brooklyn. An
 * instant window involves no zone at all and is the same seven days for
 * everyone. See the house rule on `@/lib/time`.
 */
export const TREND_WINDOW_DAYS = 7

/**
 * Saves inside the window before a look is called trending at all.
 *
 * The honest-signals rule applies hardest here: a look that picked up one save
 * has not trended, and "+1 save this week" in a banner with a flame on it is the
 * `incentiveLabel` bug wearing new clothes. Below this the look gets no row, so
 * ABSENCE is the whole read gate — no reader re-implements the floor and none
 * can forget it.
 *
 * ⚠️ This number is mine, not Tori's. It is deliberately low enough that a real
 * creator sees the banner and high enough that a single save never mints one.
 */
export const TREND_MIN_WEEKLY_SAVES = 5

/**
 * Eligible public looks a city must contain before anybody in it is given a
 * percentile.
 *
 * Same reasoning as `CREATOR_TIER_MIN_RANKED_POPULATION`, and it bites harder:
 * one city will routinely hold a handful of ranked creators, and "top 25% in
 * Brooklyn" over four looks is noise wearing a statistic's clothes. Below the
 * floor the look still renders its save delta — which is a real, checkable
 * number — and simply says nothing about the city.
 */
export const TREND_MIN_RANKED_CITY_LOOKS = 20

/**
 * The percentile a look must reach before its city rank is stated at all.
 *
 * 🔴 A percentile that is not a distinction must not be printed as one. The
 * lowest rank a trending look can mathematically hold is not 0 — it is equal to
 * itself, so `(0 + 0.5)/n` — which over a 20-look city is percentile 3, and
 * `topPercentFromPercentile` would render that as "top 97% in Brooklyn". True,
 * meaningless, and it reads as a put-down under a flame icon.
 *
 * Pinned to `CREATOR_TIER_RISING_PERCENTILE` on purpose: that is exactly the cut
 * at which `CreatorStandingRow` starts printing "top N%", so the worst city rank
 * this banner can ever show ("top 25%") is the worst the standing line can show.
 * Below it the banner still prints the save delta, which is a real countable
 * number — it simply says nothing about the city.
 */
export const TREND_CITY_PERCENTILE_FLOOR = CREATOR_TIER_RISING_PERCENTILE

/**
 * The looks a city percentile is computed over, and the looks a weekly delta may
 * be counted for. Written ONCE and interpolated into both aggregates below: the
 * percentile's denominator and its numerator have to describe the same
 * population, and two hand-copied predicates are two chances for them not to.
 *
 * Matches `refreshClientCreatorStats`'s public-look CTE exactly — same six
 * conditions, same reason: this is what "publicly visible, client-authored look"
 * means everywhere in the creator surfaces.
 */
const ELIGIBLE_LOOK_SQL = Prisma.sql`
  lp."clientAuthorId" IS NOT NULL
  AND lp."status" = 'PUBLISHED'::"LookPostStatus"
  AND lp."visibility" = 'PUBLIC'::"LookPostVisibility"
  AND lp."moderationStatus" = 'APPROVED'::"ModerationStatus"
  AND lp."publishedAt" IS NOT NULL
  AND lp."removedAt" IS NULL
`

/** The city grouping key: trimmed and case-folded, so "brooklyn" ranks with "Brooklyn". */
const CITY_KEY_SQL = Prisma.sql`lower(btrim(cp."publicCity"))`

// ── refresh job ──────────────────────────────────────────────────────────────

type WeeklySaveRow = {
  lookPostId: string
  clientId: string
  /** As the author spells it — what the banner prints. Null when they show none. */
  publicCity: string | null
  /** Case-folded grouping key, or null when the author shows no city. */
  cityKey: string | null
  weeklySaves: number
}

type CityPopulationRow = {
  cityKey: string
  eligibleLooks: number
}

export type RefreshClientLookTrendStatsResult = {
  /** Looks that cleared {@link TREND_MIN_WEEKLY_SAVES} — one row written each. */
  trending: number
  /** Of those, how many also received a city percentile. */
  ranked: number
  windowStart: Date
  computedAt: Date
}

export function trendWindowStart(now: Date): Date {
  return new Date(now.getTime() - TREND_WINDOW_DAYS * 24 * 60 * 60 * 1000)
}

/**
 * Where one look's weekly saves rank among its city's eligible public looks,
 * 0–100, using the same tie-aware rank as the creator tier: `(below + equal/2) / n`.
 *
 * 🔴 The denominator is EVERY eligible look in the city, including the ones that
 * got no saves this week — not just the ones that moved. "Top 3% in Brooklyn"
 * reads as a claim about Brooklyn's looks, and ranking only the movers would
 * quietly make it a claim about a much smaller, self-selected field. Zero-save
 * looks have no stat row, so they are counted rather than materialized.
 *
 * Null below {@link TREND_MIN_RANKED_CITY_LOOKS} (too small a field to rank in)
 * and below {@link TREND_CITY_PERCENTILE_FLOOR} (a rank that is not a
 * distinction). Both are the same refusal: nothing true to say about the city.
 */
function cityPercentileFor(args: {
  weeklySaves: number
  /** Every mover's weekly saves in this city. */
  moverSaves: number[]
  /** Eligible looks in the city, movers and non-movers alike. */
  population: number
}): number | null {
  if (args.population < TREND_MIN_RANKED_CITY_LOOKS) return null

  let below = args.population - args.moverSaves.length // the zero-save tail
  let equal = 0
  for (const value of args.moverSaves) {
    if (value < args.weeklySaves) below += 1
    else if (value === args.weeklySaves) equal += 1
  }

  const percentile = Math.round(((below + equal / 2) / args.population) * 100)
  return percentile >= TREND_CITY_PERCENTILE_FLOOR ? percentile : null
}

/**
 * Recompute every trending look from live BoardItem rows and replace the stat
 * table's contents atomically.
 *
 * Two aggregates, both scoped by the same {@link ELIGIBLE_LOOK_SQL} predicate:
 * the movers (looks saved at least once inside the window) and each city's total
 * eligible population (the percentile's denominator). Only looks past
 * {@link TREND_MIN_WEEKLY_SAVES} are written, so a row existing IS the signal.
 */
export async function refreshClientLookTrendStats(
  db: PrismaClient,
  now: Date,
): Promise<RefreshClientLookTrendStatsResult> {
  const windowStart = trendWindowStart(now)

  const [movers, cityPopulations] = await Promise.all([
    db.$queryRaw<WeeklySaveRow[]>`
      SELECT
        bi."lookPostId" AS "lookPostId",
        lp."clientAuthorId" AS "clientId",
        cp."publicCity" AS "publicCity",
        CASE
          WHEN btrim(coalesce(cp."publicCity", '')) = '' THEN NULL
          ELSE ${CITY_KEY_SQL}
        END AS "cityKey",
        COUNT(*)::int AS "weeklySaves"
      FROM "BoardItem" bi
      JOIN "LookPost" lp ON lp."id" = bi."lookPostId"
      JOIN "ClientProfile" cp ON cp."id" = lp."clientAuthorId"
      WHERE bi."createdAt" >= ${windowStart}
        AND ${ELIGIBLE_LOOK_SQL}
      GROUP BY bi."lookPostId", lp."clientAuthorId", cp."publicCity"
    `,
    db.$queryRaw<CityPopulationRow[]>`
      SELECT ${CITY_KEY_SQL} AS "cityKey", COUNT(*)::int AS "eligibleLooks"
      FROM "LookPost" lp
      JOIN "ClientProfile" cp ON cp."id" = lp."clientAuthorId"
      WHERE ${ELIGIBLE_LOOK_SQL}
        AND btrim(coalesce(cp."publicCity", '')) <> ''
      GROUP BY 1
    `,
  ])

  const populationByCity = new Map(
    cityPopulations.map((row) => [row.cityKey, row.eligibleLooks]),
  )

  // Every mover's saves, per city — the ranking input. Built from ALL movers,
  // including the ones below the trending floor: they are part of the city's
  // field even though they will never render a banner of their own.
  const moverSavesByCity = new Map<string, number[]>()
  for (const row of movers) {
    if (!row.cityKey) continue
    const bucket = moverSavesByCity.get(row.cityKey)
    if (bucket) bucket.push(row.weeklySaves)
    else moverSavesByCity.set(row.cityKey, [row.weeklySaves])
  }

  const data = movers
    .filter((row) => row.weeklySaves >= TREND_MIN_WEEKLY_SAVES)
    .map((row) => {
      const cityPercentile = row.cityKey
        ? cityPercentileFor({
            weeklySaves: row.weeklySaves,
            moverSaves: moverSavesByCity.get(row.cityKey) ?? [],
            population: populationByCity.get(row.cityKey) ?? 0,
          })
        : null

      return {
        lookPostId: row.lookPostId,
        clientId: row.clientId,
        weeklySaves: row.weeklySaves,
        cityPercentile,
        // 🔴 The city rides WITH the percentile or not at all — the database
        // CHECK enforces the same pairing. A city with no percentile is a place
        // the banner has nothing true to say about.
        city: cityPercentile === null ? null : (row.publicCity?.trim() ?? null),
        windowStart,
        computedAt: now,
      }
    })

  await db.$transaction([
    db.clientLookTrendStat.deleteMany({}),
    ...(data.length > 0 ? [db.clientLookTrendStat.createMany({ data })] : []),
  ])

  return {
    trending: data.length,
    ranked: data.filter((row) => row.cityPercentile !== null).length,
    windowStart,
    computedAt: now,
  }
}

// ── read path ────────────────────────────────────────────────────────────────

export type ClientLookTrend = {
  lookPostId: string
  /** Saves inside the trailing window. Always ≥ {@link TREND_MIN_WEEKLY_SAVES}. */
  weeklySaves: number
  /** e.g. 3 for "top 3% in Brooklyn". Null when the city could not be ranked. */
  topPercent: number | null
  /** Null exactly when {@link topPercent} is. */
  city: string | null
}

/**
 * The client's best-moving look this week, or null when nothing of theirs
 * trended.
 *
 * "Best" is the largest weekly delta, tie-broken by look id so two looks on the
 * same number produce a stable banner rather than one that changes on every
 * page load for no reason the client can see.
 */
export async function getClientLookTrend(
  db: LookTrendDb,
  clientId: string,
): Promise<ClientLookTrend | null> {
  const row = await db.clientLookTrendStat.findFirst({
    where: { clientId },
    orderBy: [{ weeklySaves: 'desc' }, { lookPostId: 'asc' }],
    select: {
      lookPostId: true,
      weeklySaves: true,
      cityPercentile: true,
      city: true,
    },
  })

  if (!row) return null

  return {
    lookPostId: row.lookPostId,
    weeklySaves: row.weeklySaves,
    // The same "top N%" conversion the creator standing uses, clamped to 1 so
    // the single best look never reads "top 0%".
    topPercent: topPercentFromPercentile(row.cityPercentile),
    city: row.city,
  }
}
