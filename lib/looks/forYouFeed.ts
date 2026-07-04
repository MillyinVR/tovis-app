// lib/looks/forYouFeed.ts
//
// Server-side orchestration for the personalized "For You" Looks feed (B1).
// Layers a query-time, per-viewer blend on top of the existing RANKED feed
// backbone — no new tables, no precomputed per-viewer score:
//
//  1. Backbone: the global RANKED page (rankScore desc + cursor), the same
//     infra the search grid uses. This is authoritative for pagination, so no
//     look is ever dropped as you scroll.
//  2. Injection (entry load only): a few of the freshest looks from pros the
//     viewer follows, so brand-new followed content — which has rankScore 0 and
//     would otherwise sit on the last page — surfaces on the first screen.
//  3. Re-rank: both sets are scored by computeForYouScore (follow / category
//     affinity / freshness boosts, seen penalty) and ordered best-first.
//
// The cursor always rides the backbone, so subsequent pages continue purely by
// rankScore; injected looks appear once (they land in the viewer's session seen
// set and are excluded thereafter).

import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import type { TenantContext } from '@/lib/tenant'
import {
  buildLooksFeedCursorWhere,
  buildLooksFeedOrderBy,
  buildLooksFeedWhere,
  encodeLooksFeedCursor,
  type LooksFeedCursor,
} from '@/lib/looks/feed'
import { looksFeedSelect, type LooksFeedRow } from '@/lib/looks/selects'
import {
  rankForYouRows,
  type ForYouViewerAffinity,
} from '@/lib/looks/forYouRanking'

// How many of the viewer's most recent likes / saves feed category affinity.
// Bounded so the signal query stays cheap regardless of a power user's history.
const AFFINITY_SAMPLE_SIZE = 200

// Saves are a stronger taste signal than likes (mirrors the engagement weights
// in lib/looks/ranking.ts, scaled down).
const AFFINITY_LIKE_WEIGHT = 1
const AFFINITY_SAVE_WEIGHT = 2

// Max fresh followed-pro looks injected at entry. Kept small so the feed stays
// discovery-led rather than a followed-only timeline (that is the Following tab).
const FOLLOWED_INJECTION_LIMIT = 6

// Upper bound on the session seen list a client may send, so the exclusion
// clause can't blow up the query.
const SEEN_IDS_CAP = 300

export type ForYouCategoryAffinityEntry = {
  slug: string
  weight: number
}

/**
 * Fold raw (slug, weight) affinity signals into a summed-per-category map.
 * Pure + exported for unit testing.
 */
export function aggregateCategoryWeights(
  entries: readonly ForYouCategoryAffinityEntry[],
): Map<string, number> {
  const weights = new Map<string, number>()

  for (const entry of entries) {
    const slug = entry.slug.trim()
    if (!slug) continue
    if (!Number.isFinite(entry.weight) || entry.weight <= 0) continue
    weights.set(slug, (weights.get(slug) ?? 0) + entry.weight)
  }

  return weights
}

/**
 * Parse a client-supplied session seen list ("id1,id2,…"), trimmed, de-duped
 * and capped. Pure + exported for unit testing.
 */
export function parseSeenLookIds(
  raw: string | null | undefined,
): Set<string> {
  const seen = new Set<string>()
  if (typeof raw !== 'string') return seen

  for (const part of raw.split(',')) {
    const id = part.trim()
    if (!id) continue
    seen.add(id)
    if (seen.size >= SEEN_IDS_CAP) break
  }

  return seen
}

const categorySlugSelect = {
  lookPost: {
    select: {
      service: {
        select: {
          category: {
            select: { slug: true },
          },
        },
      },
    },
  },
} satisfies Prisma.LookLikeSelect & Prisma.BoardItemSelect

function slugFromCategoryRow(row: {
  lookPost: {
    service: { category: { slug: string | null } | null } | null
  }
}): string | null {
  const slug = row.lookPost.service?.category?.slug
  return typeof slug === 'string' && slug.trim().length > 0 ? slug.trim() : null
}

/**
 * Load the viewer's For You signals: which pros they follow, and how strongly
 * they lean toward each service category (from their likes + saved-board items).
 * Every query is bounded; missing signals just yield an empty affinity.
 */
export async function loadForYouAffinity(args: {
  userId: string
  clientId: string | null | undefined
}): Promise<ForYouViewerAffinity> {
  const clientId = args.clientId ?? null

  const [follows, likes, boardItems] = await Promise.all([
    clientId
      ? prisma.proFollow.findMany({
          where: { clientId },
          select: { professionalId: true },
        })
      : Promise.resolve([]),
    prisma.lookLike.findMany({
      where: { userId: args.userId },
      orderBy: { createdAt: 'desc' },
      take: AFFINITY_SAMPLE_SIZE,
      select: categorySlugSelect,
    }),
    clientId
      ? prisma.boardItem.findMany({
          where: { board: { clientId } },
          orderBy: { createdAt: 'desc' },
          take: AFFINITY_SAMPLE_SIZE,
          select: categorySlugSelect,
        })
      : Promise.resolve([]),
  ])

  const entries: ForYouCategoryAffinityEntry[] = []
  for (const like of likes) {
    const slug = slugFromCategoryRow(like)
    if (slug) entries.push({ slug, weight: AFFINITY_LIKE_WEIGHT })
  }
  for (const item of boardItems) {
    const slug = slugFromCategoryRow(item)
    if (slug) entries.push({ slug, weight: AFFINITY_SAVE_WEIGHT })
  }

  return {
    followedProfessionalIds: new Set(
      follows.map((follow) => follow.professionalId),
    ),
    categoryWeights: aggregateCategoryWeights(entries),
  }
}

export type ForYouFeedPage = {
  items: LooksFeedRow[]
  nextCursor: string | null
  // Instrumentation surface — how the page was assembled.
  meta: {
    backboneCount: number
    injectedCount: number
    seenCount: number
    followedCount: number
    affinityCategoryCount: number
  }
}

/**
 * Assemble one personalized For You page. `cursor` null means the entry load
 * (fresh followed content is injected only there). The returned items are
 * ordered for display; `nextCursor` continues the RANKED backbone.
 */
export async function buildForYouFeedPage(args: {
  tenant: TenantContext
  userId: string
  clientId: string | null | undefined
  limit: number
  cursor: LooksFeedCursor | null
  seenLookIds: ReadonlySet<string>
  now: Date
}): Promise<ForYouFeedPage> {
  const affinity = await loadForYouAffinity({
    userId: args.userId,
    clientId: args.clientId,
  })

  const baseWhere = buildLooksFeedWhere({
    kind: 'ALL',
    tenant: args.tenant,
  })

  const seenIds = [...args.seenLookIds]
  const seenExclusion: Prisma.LookPostWhereInput | null =
    seenIds.length > 0 ? { id: { notIn: seenIds } } : null

  const cursorWhere = buildLooksFeedCursorWhere({
    kind: 'ALL',
    sort: 'RANKED',
    cursor: args.cursor,
  })

  const backboneWhere: Prisma.LookPostWhereInput = {
    AND: [
      baseWhere,
      ...(cursorWhere ? [cursorWhere] : []),
      ...(seenExclusion ? [seenExclusion] : []),
    ],
  }

  const backboneRows = await prisma.lookPost.findMany({
    where: backboneWhere,
    orderBy: buildLooksFeedOrderBy({ kind: 'ALL', sort: 'RANKED' }),
    take: args.limit + 1,
    select: looksFeedSelect,
  })

  const hasMore = backboneRows.length > args.limit
  const backbonePage = hasMore
    ? backboneRows.slice(0, args.limit)
    : backboneRows

  // Cursor rides the backbone: the DB-RANKED boundary of the page, NOT the
  // personalized-last row. This keeps pagination monotonic in rankScore so no
  // backbone look is skipped by the personalized re-rank.
  const cursorRow = backbonePage[backbonePage.length - 1]
  const nextCursor =
    hasMore && cursorRow
      ? encodeLooksFeedCursor({
          kind: 'ALL',
          sort: 'RANKED',
          row: cursorRow,
        })
      : null

  // Inject fresh followed-pro looks only on the entry load. They ride ON TOP of
  // the backbone page (never displacing it), so the cursor stays honest and
  // nothing is dropped; they appear once, then land in the session seen set.
  let injectedRows: LooksFeedRow[] = []
  const isEntryLoad = args.cursor === null
  const followedIds = [...affinity.followedProfessionalIds]

  if (isEntryLoad && followedIds.length > 0) {
    const alreadyOnPage = new Set(backbonePage.map((row) => row.id))
    const excludeIds = [...new Set([...seenIds, ...alreadyOnPage])]

    injectedRows = await prisma.lookPost.findMany({
      where: {
        AND: [
          baseWhere,
          { professionalId: { in: followedIds } },
          ...(excludeIds.length > 0 ? [{ id: { notIn: excludeIds } }] : []),
        ],
      },
      orderBy: [{ publishedAt: 'desc' }, { id: 'desc' }],
      take: FOLLOWED_INJECTION_LIMIT,
      select: looksFeedSelect,
    })
  }

  const items = rankForYouRows([...backbonePage, ...injectedRows], {
    affinity,
    seenLookIds: args.seenLookIds,
    now: args.now,
  })

  return {
    items,
    nextCursor,
    meta: {
      backboneCount: backbonePage.length,
      injectedCount: injectedRows.length,
      seenCount: seenIds.length,
      followedCount: followedIds.length,
      affinityCategoryCount: affinity.categoryWeights.size,
    },
  }
}
