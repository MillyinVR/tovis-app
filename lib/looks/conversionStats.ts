// lib/looks/conversionStats.ts
//
// LookPostConversionStat refresh + serve-time reader — the per-LOOK
// booking-conversion aggregate behind the Looks feed booking_conversion_rate term
// (personalization spec §4.2). Mirrors the ProfessionalBadgeStat /
// LookCategoryRankStat pattern: one grouped raw-SQL aggregate swapped in
// atomically (deleteMany + createMany), read cheaply by PK at serve time.
//
// The spec defines the rate as `bookings_from_this_look / (saves + remix_clicks)`
// — it protects against optimizing for "pretty content" (heavily saved, rarely
// booked) over "content that fills chairs". We approximate the denominator with
// saveCount + viewCount (the interest/exposure signals we track; remix_clicks
// aren't captured, so feed/detail views stand in). The numerator is attributed
// non-cancelled bookings via Booking.sourceLookPostId — a booking is a conversion
// whether or not the client later showed up (that's a separate reliability signal,
// a future §4.2 term). The rate math + smoothing live in code
// (computeBookingConversionBoost, lib/looks/personalizedRanking.ts); this module
// only stores the raw numerator + denominator.
//
// One GROUP BY over Booking joined to LookPost gives the numerator and the
// interest snapshot in a single query, and — because it groups over bookings —
// only looks with >=1 attributed non-cancelled booking appear, so "skip the zeros"
// is automatic and the table stays proportional to CONVERTING looks. Only
// PUBLISHED + APPROVED looks are counted; an unpublished/removed look can't be
// served, so its row would be dead weight.

import type { PrismaClient } from '@prisma/client'

import type { LookConversionSignal } from '@/lib/looks/personalizedRanking'

export type LookConversionStatRow = {
  lookPostId: string
  bookingCount: number
  interestCount: number
}

export type RefreshLookPostConversionStatsResult = {
  looks: number
  computedAt: Date
}

/**
 * Recompute every converting look's booking-conversion aggregate from the live
 * Booking attribution + LookPost interest counts and replace the stat table's
 * contents atomically. One grouped SQL aggregate: attributed non-cancelled
 * bookings per source look (numerator) and that look's saveCount + viewCount
 * snapshot (denominator). Grouping over bookings yields only looks with a real
 * conversion, so the "skip the zeros" rule needs no extra filter.
 */
export async function refreshLookPostConversionStats(
  db: PrismaClient,
  now: Date,
): Promise<RefreshLookPostConversionStatsResult> {
  const rows = await db.$queryRaw<LookConversionStatRow[]>`
    SELECT
      b."sourceLookPostId" AS "lookPostId",
      COUNT(*)::int AS "bookingCount",
      (lp."saveCount" + lp."viewCount")::int AS "interestCount"
    FROM "Booking" b
    JOIN "LookPost" lp ON lp."id" = b."sourceLookPostId"
    WHERE b."sourceLookPostId" IS NOT NULL
      AND b."status" <> 'CANCELLED'::"BookingStatus"
      AND lp."status" = 'PUBLISHED'::"LookPostStatus"
      AND lp."moderationStatus" = 'APPROVED'::"ModerationStatus"
      AND lp."publishedAt" IS NOT NULL
    GROUP BY b."sourceLookPostId", lp."saveCount", lp."viewCount"
  `

  await db.$transaction([
    db.lookPostConversionStat.deleteMany({}),
    ...(rows.length > 0
      ? [
          db.lookPostConversionStat.createMany({
            data: rows.map((row) => ({ ...row, computedAt: now })),
          }),
        ]
      : []),
  ])

  return { looks: rows.length, computedAt: now }
}

/**
 * The exact LookPostConversionStat read the serve-time reader needs, expressed
 * structurally so both PrismaClient and a plain test mock satisfy it without a
 * type escape (the LookBadgeAttachDb / ProUnderbookedReaderDb pattern).
 */
export type LookConversionReaderDb = {
  lookPostConversionStat: {
    findMany(args: {
      where: { lookPostId: { in: string[] } }
      select: { lookPostId: true; bookingCount: true; interestCount: true }
    }): PromiseLike<
      Array<{ lookPostId: string; bookingCount: number; interestCount: number }>
    >
  }
}

/**
 * Serve-time reader for the §4.2 booking-conversion boost: the attributed booking
 * count + interest snapshot for a page's looks, keyed by lookPostId. A look
 * without a row (no attributed booking — the refresh "skips the zeros") is simply
 * absent from the map; the ranker reads that as no conversion evidence → boost 0
 * (NOT a prior-smoothed baseline, unlike the rankScore). One indexed IN-list read
 * — the same shape as fetchProUnderbookedSignals, keyed by look id.
 */
export async function fetchLookConversionSignals(
  db: LookConversionReaderDb,
  lookPostIds: readonly string[],
): Promise<Map<string, LookConversionSignal>> {
  const ids = [...new Set(lookPostIds)].filter((id) => id.length > 0)
  if (ids.length === 0) return new Map()

  const rows = await db.lookPostConversionStat.findMany({
    where: { lookPostId: { in: ids } },
    select: { lookPostId: true, bookingCount: true, interestCount: true },
  })

  const map = new Map<string, LookConversionSignal>()
  for (const row of rows) {
    map.set(row.lookPostId, {
      bookingCount: row.bookingCount,
      interestCount: row.interestCount,
    })
  }
  return map
}
