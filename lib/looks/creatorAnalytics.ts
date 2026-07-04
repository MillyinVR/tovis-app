// lib/looks/creatorAnalytics.ts
//
// Read-layer creator analytics for pros (social-first plan C1). Every number
// here already exists on the schema — this module only aggregates it, never
// instruments anything new:
//   - per-look engagement (views / likes / comments / saves / shares) reads the
//     denormalized counters on LookPost;
//   - bookings-attributed reads the LookInspiredBookings relation
//     (Booking.sourceLookPostId);
//   - follower total + growth reads ProFollow (createdAt buckets).
//
// All queries are index-backed: the aggregate + candidate list ride the
// professionalId/rankScore indexes, booking attribution rides sourceLookPostId,
// and follower growth rides `@@index([professionalId, createdAt])`. There is no
// per-look N+1 — the candidate set is bounded and bookings are resolved in a
// single groupBy.
import { LookPostStatus, Prisma } from '@prisma/client'

import { renderMediaUrls } from '@/lib/media/renderUrls'
import { prisma } from '@/lib/prisma'

// ── DTOs ────────────────────────────────────────────────────────────────────

export type CreatorLookStatsDto = {
  lookPostId: string
  caption: string | null
  thumbUrl: string | null
  publishedAt: string | null
  views: number
  likes: number
  comments: number
  saves: number
  shares: number
  // Bookings the client attributed to this look ("recreate this look").
  bookings: number
  // Display heuristic used to rank "top-performing" looks — NOT a stored field.
  engagementScore: number
}

export type CreatorEngagementTotalsDto = {
  views: number
  likes: number
  comments: number
  saves: number
  shares: number
  bookings: number
}

// One week's worth of new followers, oldest bucket first. `weeksAgo` counts back
// from the current (partial) week: 0 = this week, 1 = last week, …
export type CreatorFollowerBucketDto = {
  weeksAgo: number
  count: number
}

export type CreatorFollowerGrowthDto = {
  total: number
  // New followers in the trailing 30 days.
  new30d: number
  // Trailing weekly buckets, oldest → newest, for a small sparkline.
  weekly: CreatorFollowerBucketDto[]
}

export type CreatorLooksAnalyticsDto = {
  publishedCount: number
  totals: CreatorEngagementTotalsDto
  followers: CreatorFollowerGrowthDto
  topLooks: CreatorLookStatsDto[]
}

// ── Tunables ─────────────────────────────────────────────────────────────────

// How many highest-ranked looks to pull as candidates before re-ranking by the
// engagement heuristic (which folds in bookings, absent from rankScore). Bounded
// so the analytics query never scans a pro's entire history.
const TOP_LOOK_CANDIDATE_LIMIT = 24
// How many top looks to surface in the UI.
const TOP_LOOK_DISPLAY_LIMIT = 6
// Trailing window (in weeks) for the follower-growth sparkline.
const FOLLOWER_GROWTH_WEEKS = 8
// Safety bound on the follower rows scanned for bucketing — a pro with more than
// this many recent followers still gets accurate totals (via count), only the
// sparkline saturates.
const FOLLOWER_GROWTH_SCAN_LIMIT = 2000

const DAY_MS = 24 * 60 * 60 * 1000
const WEEK_MS = 7 * DAY_MS

// ── Pure helpers (unit-tested directly) ──────────────────────────────────────

/**
 * Display heuristic for "top-performing" — deliberately weights outcomes over
 * raw reach (a booking is worth far more than a view). Not persisted; only used
 * to order the small candidate set already filtered by the DB's rankScore.
 */
export function computeLookEngagementScore(counts: {
  views: number
  likes: number
  comments: number
  saves: number
  shares: number
  bookings: number
}): number {
  return (
    counts.views * 0.1 +
    counts.likes * 1 +
    counts.comments * 2 +
    counts.saves * 3 +
    counts.shares * 4 +
    counts.bookings * 8
  )
}

/**
 * Buckets follower sign-up instants into trailing weekly counts. Returns exactly
 * `weeks` buckets oldest → newest; the last bucket is the current (partial)
 * week. Instants older than the window are ignored.
 */
export function bucketFollowerGrowth(
  createdAts: readonly Date[],
  now: Date,
  weeks: number = FOLLOWER_GROWTH_WEEKS,
): CreatorFollowerBucketDto[] {
  const buckets: CreatorFollowerBucketDto[] = []
  for (let weeksAgo = weeks - 1; weeksAgo >= 0; weeksAgo -= 1) {
    buckets.push({ weeksAgo, count: 0 })
  }

  const nowMs = now.getTime()
  for (const createdAt of createdAts) {
    const ageMs = nowMs - createdAt.getTime()
    if (ageMs < 0) {
      // Clock skew — count it in the current week.
      const current = buckets[buckets.length - 1]
      if (current) current.count += 1
      continue
    }
    const weeksAgo = Math.floor(ageMs / WEEK_MS)
    if (weeksAgo >= weeks) continue
    const bucket = buckets[weeks - 1 - weeksAgo]
    if (bucket) bucket.count += 1
  }

  return buckets
}

/** New followers within the trailing 30 days. */
export function countRecentFollowers(
  createdAts: readonly Date[],
  now: Date,
  days = 30,
): number {
  const cutoffMs = now.getTime() - days * DAY_MS
  let count = 0
  for (const createdAt of createdAts) {
    if (createdAt.getTime() >= cutoffMs) count += 1
  }
  return count
}

// Shape shared by the aggregate-sum result and each candidate row. Kept explicit
// so `assembleCreatorLooksAnalytics` stays a pure function testable without a DB.
export type CreatorLookCandidate = {
  id: string
  caption: string | null
  thumbUrl: string | null
  publishedAt: Date | null
  views: number
  likes: number
  comments: number
  saves: number
  shares: number
  bookings: number
}

export function assembleCreatorLooksAnalytics(input: {
  publishedCount: number
  totals: CreatorEngagementTotalsDto
  followerTotal: number
  followerCreatedAts: readonly Date[]
  candidates: readonly CreatorLookCandidate[]
  now: Date
}): CreatorLooksAnalyticsDto {
  const topLooks: CreatorLookStatsDto[] = input.candidates
    .map((row) => {
      const engagementScore = computeLookEngagementScore(row)
      return {
        lookPostId: row.id,
        caption: row.caption,
        thumbUrl: row.thumbUrl,
        publishedAt: row.publishedAt ? row.publishedAt.toISOString() : null,
        views: row.views,
        likes: row.likes,
        comments: row.comments,
        saves: row.saves,
        shares: row.shares,
        bookings: row.bookings,
        engagementScore,
      }
    })
    .sort((a, b) => b.engagementScore - a.engagementScore)
    .slice(0, TOP_LOOK_DISPLAY_LIMIT)

  return {
    publishedCount: input.publishedCount,
    totals: input.totals,
    followers: {
      total: input.followerTotal,
      new30d: countRecentFollowers(input.followerCreatedAts, input.now),
      weekly: bucketFollowerGrowth(input.followerCreatedAts, input.now),
    },
    topLooks,
  }
}

// ── Prisma orchestrator ──────────────────────────────────────────────────────

// The pro's own PUBLISHED, pro-authored looks — the manageable, public-facing
// set whose performance is theirs to see. Mirrors buildProLooksWhere's scoping
// (owner + clientAuthorId null + not removed) but pinned to PUBLISHED.
function buildPublishedLooksWhere(
  professionalId: string,
): Prisma.LookPostWhereInput {
  return {
    professionalId,
    clientAuthorId: null,
    removedAt: null,
    status: LookPostStatus.PUBLISHED,
  }
}

const candidateMediaSelect = Prisma.validator<Prisma.MediaAssetSelect>()({
  thumbUrl: true,
  thumbBucket: true,
  thumbPath: true,
  url: true,
  storageBucket: true,
  storagePath: true,
})

export async function loadCreatorLooksAnalytics(args: {
  professionalId: string
  now: Date
}): Promise<CreatorLooksAnalyticsDto> {
  const { professionalId, now } = args
  const where = buildPublishedLooksWhere(professionalId)
  const followerWindowStart = new Date(
    now.getTime() - FOLLOWER_GROWTH_WEEKS * WEEK_MS,
  )

  const [aggregate, candidateRows, followerTotal, followerRows] =
    await Promise.all([
      prisma.lookPost.aggregate({
        where,
        _count: { _all: true },
        _sum: {
          viewCount: true,
          likeCount: true,
          commentCount: true,
          saveCount: true,
          shareCount: true,
        },
      }),
      prisma.lookPost.findMany({
        where,
        orderBy: [
          { rankScore: 'desc' },
          { publishedAt: 'desc' },
          { id: 'desc' },
        ],
        take: TOP_LOOK_CANDIDATE_LIMIT,
        select: {
          id: true,
          caption: true,
          publishedAt: true,
          viewCount: true,
          likeCount: true,
          commentCount: true,
          saveCount: true,
          shareCount: true,
          primaryMediaAsset: { select: candidateMediaSelect },
        },
      }),
      prisma.proFollow.count({ where: { professionalId } }),
      prisma.proFollow.findMany({
        where: { professionalId, createdAt: { gte: followerWindowStart } },
        orderBy: { createdAt: 'desc' },
        take: FOLLOWER_GROWTH_SCAN_LIMIT,
        select: { createdAt: true },
      }),
    ])

  // Bookings attributed to the candidate looks, in one indexed groupBy.
  const candidateIds = candidateRows.map((row) => row.id)
  const bookingGroups =
    candidateIds.length > 0
      ? await prisma.booking.groupBy({
          by: ['sourceLookPostId'],
          where: { sourceLookPostId: { in: candidateIds } },
          _count: { _all: true },
        })
      : []

  const bookingsByLook = new Map<string, number>()
  for (const group of bookingGroups) {
    if (group.sourceLookPostId) {
      bookingsByLook.set(group.sourceLookPostId, group._count._all)
    }
  }

  const candidates: CreatorLookCandidate[] = await Promise.all(
    candidateRows.map(async (row) => {
      const media = row.primaryMediaAsset
      const rendered = await renderMediaUrls({
        storageBucket: media.storageBucket,
        storagePath: media.storagePath,
        thumbBucket: media.thumbBucket,
        thumbPath: media.thumbPath,
        url: media.url,
        thumbUrl: media.thumbUrl,
      })

      return {
        id: row.id,
        caption: row.caption,
        thumbUrl: rendered.renderThumbUrl ?? rendered.renderUrl ?? null,
        publishedAt: row.publishedAt,
        views: row.viewCount,
        likes: row.likeCount,
        comments: row.commentCount,
        saves: row.saveCount,
        shares: row.shareCount,
        bookings: bookingsByLook.get(row.id) ?? 0,
      }
    }),
  )

  const totals: CreatorEngagementTotalsDto = {
    views: aggregate._sum.viewCount ?? 0,
    likes: aggregate._sum.likeCount ?? 0,
    comments: aggregate._sum.commentCount ?? 0,
    saves: aggregate._sum.saveCount ?? 0,
    shares: aggregate._sum.shareCount ?? 0,
    // Total attributed bookings across ALL published looks (not just the
    // candidate set) — the candidate groupBy only covers the top looks' rows.
    bookings: await prisma.booking.count({
      where: {
        sourceLookPost: {
          is: { professionalId, clientAuthorId: null },
        },
      },
    }),
  }

  return assembleCreatorLooksAnalytics({
    publishedCount: aggregate._count._all,
    totals,
    followerTotal,
    followerCreatedAts: followerRows.map((row) => row.createdAt),
    candidates,
    now,
  })
}
