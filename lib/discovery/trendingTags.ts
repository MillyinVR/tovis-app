// lib/discovery/trendingTags.ts
//
// "Trending tags" for the Discover surface (social-first D2). An honest,
// windowed computation: non-banned LookTags ranked by how many feed-visible
// looks published in the recent window carry them. No denormalized count column
// exists, so we bound a candidate set (pre-sorted by all-time popularity, a safe
// superset), then re-rank by the actual windowed count. Reuses buildLooksFeedWhere
// so the window inherits the exact discovery/visibility/tenant gates the feed and
// the /looks/tags/[slug] pages use — a tag can't trend on looks a viewer can't see.
//
// This module is server-only: it runs the query. The DTO and the browser-side
// parser live in the client-safe sibling `@/lib/discovery/trendingTagsContract`
// and are re-exported below, so server call sites keep one import.

import 'server-only'

import { Prisma } from '@prisma/client'

import { buildLooksFeedWhere } from '@/lib/looks/feed'
import { prisma } from '@/lib/prisma'
import type { TenantContext } from '@/lib/tenant'
import type { TrendingTagDto } from '@/lib/discovery/trendingTagsContract'

export { parseTrendingTagsResponse } from '@/lib/discovery/trendingTagsContract'
export type { TrendingTagDto } from '@/lib/discovery/trendingTagsContract'

const TRENDING_WINDOW_DAYS = 30
// Pre-sort by all-time popularity to bound the candidate set — every candidate
// still has >=1 windowed look (the `some` filter), so re-ranking by the windowed
// count below is exact; the cap only trims the long tail of rarely-used tags.
const CANDIDATE_LIMIT = 120
const RESULT_LIMIT = 12
const DAY_MS = 24 * 60 * 60 * 1000

const trendingTagSelect = (windowLookWhere: Prisma.LookPostWhereInput) =>
  Prisma.validator<Prisma.LookTagSelect>()({
    slug: true,
    display: true,
    _count: { select: { looks: { where: windowLookWhere } } },
  })

export async function getTrendingLookTags(args: {
  tenant: TenantContext
  now: Date
  windowDays?: number
  limit?: number
}): Promise<TrendingTagDto[]> {
  const windowDays = args.windowDays ?? TRENDING_WINDOW_DAYS
  const limit = args.limit ?? RESULT_LIMIT
  const windowStart = new Date(args.now.getTime() - windowDays * DAY_MS)

  // Feed-visible looks published within the window. buildLooksFeedWhere pins
  // `publishedAt: { not: null }`; overriding it with `gte` is strictly narrower.
  const windowLookWhere: Prisma.LookPostWhereInput = {
    ...buildLooksFeedWhere({ kind: 'ALL', tenant: args.tenant }),
    publishedAt: { gte: windowStart },
  }

  const rows = await prisma.lookTag.findMany({
    where: {
      bannedAt: null,
      looks: { some: windowLookWhere },
    },
    select: trendingTagSelect(windowLookWhere),
    orderBy: [{ looks: { _count: 'desc' } }, { createdAt: 'desc' }],
    take: CANDIDATE_LIMIT,
  })

  return rows
    .map((row) => ({
      slug: row.slug,
      display: row.display,
      lookCount: row._count.looks,
    }))
    .filter((tag) => tag.lookCount > 0)
    .sort((a, b) => b.lookCount - a.lookCount || a.slug.localeCompare(b.slug))
    .slice(0, limit)
}
