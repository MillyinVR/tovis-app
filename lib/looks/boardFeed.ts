// lib/looks/boardFeed.ts
//
// Server-side orchestration for the board-scoped "Recommended for this board"
// feed (spec §4.4) — the board-page sibling of the personalized feed. Same shape as
// buildPersonalizedFeedPage:
//
//  1. Backbone: the global RANKED page (rankScore desc + cursor) — authoritative
//     for pagination, so no look is dropped as you scroll — scoped to the tenant
//     and with the board's own saved looks excluded (a board recommends looks
//     you HAVEN'T saved yet).
//  2. Retrieval injection (entry load only): looks whose tags/category match the
//     board's declared purpose + chip answers + owner self-profile. This is the
//     "retrieve by occasion, then re-rank" step — it surfaces occasion-relevant
//     looks that have a low GLOBAL rankScore and would otherwise sit far down.
//  3. Re-rank: both sets scored by computeBoardFeedScore (occasion / answer /
//     visual / feasibility / freshness, seen penalty) and ordered best-first.
//
// The cursor always rides the RANKED backbone, so subsequent pages continue
// purely by rankScore; injected looks appear once (they land in the session
// seen set and are excluded thereafter). Every board-specific signal is
// null-safe: an undated GENERAL board with no answers/taste/self-profile just
// gets the engagement backbone re-served.

import { BoardType, Prisma } from '@prisma/client'

import { prisma } from '@/lib/prisma'
import type { TenantContext } from '@/lib/tenant'
import {
  BOARD_TYPE_FEED_SIGNALS,
  boardAnswerFeedTagSlugs,
  computeBoardEventProximity,
  normalizeBoardAnswers,
} from '@/lib/boards/context'
import {
  normalizeSelfProfile,
  selfProfileFeasibilityTagSlugs,
} from '@/lib/personalization/selfProfile'
import {
  fetchBoardTasteVector,
  fetchLookPostEmbeddings,
} from '@/lib/personalization/lookEmbeddingStore'
import {
  buildLooksFeedCursorWhere,
  buildLooksFeedOrderBy,
  buildLooksFeedWhere,
  encodeLooksFeedCursor,
  type LooksFeedCursor,
} from '@/lib/looks/feed'
import { looksFeedSelect, type LooksFeedRow } from '@/lib/looks/selects'
import { loadHiddenLookIds } from '@/lib/looks/hides'
import {
  rankBoardFeedRows,
  type BoardFeedContext,
} from '@/lib/looks/boardFeedRanking'
import { fetchProAvailabilitySignals } from '@/lib/looks/availabilityStats'

// How many occasion/answer-matched looks are retrieved and injected at entry.
const BOARD_FEED_RETRIEVAL_LIMIT = 24

// Upper bound on the board's own saved looks pulled to exclude from the feed —
// a board recommends looks you haven't saved. Bounded so the exclusion clause
// can't blow up the query on a huge board.
const SAVED_EXCLUSION_CAP = 300

// Upper bound on the session seen list the client may send.
const SEEN_IDS_CAP = 300

/** The board fields the feed personalizes against (loaded + owner-checked by the caller). */
export type BoardFeedBoard = {
  id: string
  clientId: string
  type: BoardType
  eventDate: Date | null
  answers: Prisma.JsonValue
}

/**
 * Resolve a board's personalization context: which occasion tags its purpose
 * implies (scaled by event proximity), which look tags its answers + the
 * owner's self-profile imply, and the board's saved-look taste vector. Every
 * signal is independent and null-safe. Exported for the integration test.
 */
export async function loadBoardFeedContext(args: {
  board: BoardFeedBoard
  now: Date
}): Promise<{
  occasionTagWeights: Map<string, number>
  answerTagSlugs: Set<string>
  feasibilityTagSlugs: Set<string>
  tasteVector: readonly number[] | null
  tasteSignalCount: number
  categorySlugs: string[]
}> {
  const { board } = args

  const signals = BOARD_TYPE_FEED_SIGNALS[board.type]
  const proximity = computeBoardEventProximity(board.eventDate, args.now)

  // Occasion tags carry the board's event proximity (§7–8) — an imminent
  // wedding at full strength, a passed one (proximity 0) not at all.
  const occasionTagWeights = new Map<string, number>()
  if (proximity > 0) {
    for (const slug of signals.tagSlugs) occasionTagWeights.set(slug, proximity)
  }

  const answers = normalizeBoardAnswers(board.type, board.answers)
  const answerTagSlugs = new Set(boardAnswerFeedTagSlugs(board.type, answers))

  const [ownerRow, tasteVectorRow] = await Promise.all([
    prisma.clientProfile.findUnique({
      where: { id: board.clientId },
      select: { selfProfile: true },
    }),
    fetchBoardTasteVector(prisma, board.id),
  ])

  const selfProfile = normalizeSelfProfile(ownerRow?.selfProfile)
  const feasibilityTagSlugs = new Set(
    selfProfileFeasibilityTagSlugs(selfProfile),
  )

  return {
    occasionTagWeights,
    answerTagSlugs,
    feasibilityTagSlugs,
    tasteVector: tasteVectorRow?.embedding ?? null,
    tasteSignalCount: tasteVectorRow?.signalCount ?? 0,
    // Category retrieval widens the injection beyond hashtag matches, using the
    // board purpose's implied service categories (empty for GENERAL).
    categorySlugs:
      proximity > 0 ? [...signals.categorySlugs] : [],
  }
}

export type BoardFeedPage = {
  items: LooksFeedRow[]
  nextCursor: string | null
  meta: {
    backboneCount: number
    injectedCount: number
    savedExcludedCount: number
    seenCount: number
    occasionTagCount: number
    answerTagCount: number
    feasibilityTagCount: number
    tasteSignalCount: number
    candidateEmbeddingCount: number
    // §4.4 availability_boost: pros on the page with a near-term-opening row.
    availabilitySignalCount: number
    // §2.2: the owner's "not for me" hides excluded from this board feed too.
    hiddenExcludedCount: number
  }
}

/**
 * Assemble one page of a board's recommended looks. `cursor` null is the entry
 * load (occasion/answer retrieval is injected only there). Returned items are
 * ordered for display; `nextCursor` continues the RANKED backbone.
 */
export async function buildBoardFeedPage(args: {
  tenant: TenantContext
  board: BoardFeedBoard
  // The board owner's user id (the feed is owner-only). Used to exclude the
  // owner's §2.2 "not for me" hides. Optional so a caller without it (or a test)
  // just skips hide exclusion.
  viewerUserId?: string | null
  limit: number
  cursor: LooksFeedCursor | null
  seenLookIds: ReadonlySet<string>
  now: Date
}): Promise<BoardFeedPage> {
  const ctx = await loadBoardFeedContext({ board: args.board, now: args.now })

  // A board recommends looks the owner hasn't already saved to it, and never a
  // look the owner explicitly hid (§2.2).
  const [savedItems, hiddenLookIds] = await Promise.all([
    prisma.boardItem.findMany({
      where: { boardId: args.board.id },
      orderBy: { createdAt: 'desc' },
      take: SAVED_EXCLUSION_CAP,
      select: { lookPostId: true },
    }),
    args.viewerUserId
      ? loadHiddenLookIds(prisma, { userId: args.viewerUserId })
      : Promise.resolve<string[]>([]),
  ])
  const savedLookIds = savedItems.map((item) => item.lookPostId)

  const seenIds = [...args.seenLookIds].slice(0, SEEN_IDS_CAP)
  const excludeIds = [...new Set([...savedLookIds, ...seenIds, ...hiddenLookIds])]

  const baseWhere = buildLooksFeedWhere({ kind: 'ALL', tenant: args.tenant })
  const exclusion: Prisma.LookPostWhereInput | null =
    excludeIds.length > 0 ? { id: { notIn: excludeIds } } : null

  const cursorWhere = buildLooksFeedCursorWhere({
    kind: 'ALL',
    sort: 'RANKED',
    cursor: args.cursor,
  })

  const backboneWhere: Prisma.LookPostWhereInput = {
    AND: [
      baseWhere,
      ...(cursorWhere ? [cursorWhere] : []),
      ...(exclusion ? [exclusion] : []),
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
  // personalized-last row — keeps pagination monotonic in rankScore.
  const cursorRow = backbonePage[backbonePage.length - 1]
  const nextCursor =
    hasMore && cursorRow
      ? encodeLooksFeedCursor({ kind: 'ALL', sort: 'RANKED', row: cursorRow })
      : null

  // Retrieve occasion/answer/feasibility-matched looks and inject them at entry
  // — they ride ON TOP of the backbone page (never displacing it), so the cursor
  // stays honest; they appear once, then land in the session seen set.
  const retrievalTagSlugs = [
    ...new Set([
      ...ctx.occasionTagWeights.keys(),
      ...ctx.answerTagSlugs,
      ...ctx.feasibilityTagSlugs,
    ]),
  ]

  let injectedRows: LooksFeedRow[] = []
  const isEntryLoad = args.cursor === null
  const retrievalOr: Prisma.LookPostWhereInput[] = []
  if (retrievalTagSlugs.length > 0) {
    retrievalOr.push({
      tags: { some: { slug: { in: retrievalTagSlugs }, bannedAt: null } },
    })
  }
  if (ctx.categorySlugs.length > 0) {
    retrievalOr.push({
      service: { is: { category: { is: { slug: { in: ctx.categorySlugs } } } } },
    })
  }

  if (isEntryLoad && retrievalOr.length > 0) {
    const alreadyOnPage = new Set(backbonePage.map((row) => row.id))
    const injectionExclude = [
      ...new Set([...excludeIds, ...alreadyOnPage]),
    ]

    injectedRows = await prisma.lookPost.findMany({
      where: {
        AND: [
          baseWhere,
          { OR: retrievalOr },
          ...(injectionExclude.length > 0
            ? [{ id: { notIn: injectionExclude } }]
            : []),
        ],
      },
      orderBy: buildLooksFeedOrderBy({ kind: 'ALL', sort: 'RANKED' }),
      take: BOARD_FEED_RETRIEVAL_LIMIT,
      select: looksFeedSelect,
    })
  }

  // Fetch candidate embeddings by PK for the page — only when the board has a
  // taste vector to compare against (otherwise every row scores 0 visually).
  const candidateRows = [...backbonePage, ...injectedRows]
  const candidateEmbeddings =
    ctx.tasteVector && candidateRows.length > 0
      ? await fetchLookPostEmbeddings(
          prisma,
          candidateRows.map((row) => row.id),
        )
      : new Map<string, number[]>()

  // §4.4 availability_boost: per-pro next-opening + 14-day fullness for the
  // page's pros. Empty until the pro-availability-stats cron populates the
  // primitive, so the board feed is byte-identical until then.
  const availabilitySignals =
    candidateRows.length > 0
      ? await fetchProAvailabilitySignals(
          prisma,
          candidateRows.map((row) => row.professionalId),
        )
      : new Map<string, never>()

  const boardContext: BoardFeedContext = {
    occasionTagWeights: ctx.occasionTagWeights,
    answerTagSlugs: ctx.answerTagSlugs,
    feasibilityTagSlugs: ctx.feasibilityTagSlugs,
    tasteVector: ctx.tasteVector,
    tasteSignalCount: ctx.tasteSignalCount,
    candidateEmbeddings,
    availabilitySignals,
    seenLookIds: args.seenLookIds,
    now: args.now,
  }

  const items = rankBoardFeedRows(candidateRows, boardContext)

  return {
    items,
    nextCursor,
    meta: {
      backboneCount: backbonePage.length,
      injectedCount: injectedRows.length,
      savedExcludedCount: savedLookIds.length,
      seenCount: seenIds.length,
      occasionTagCount: ctx.occasionTagWeights.size,
      answerTagCount: ctx.answerTagSlugs.size,
      feasibilityTagCount: ctx.feasibilityTagSlugs.size,
      tasteSignalCount: ctx.tasteSignalCount,
      candidateEmbeddingCount: candidateEmbeddings.size,
      availabilitySignalCount: availabilitySignals.size,
      hiddenExcludedCount: hiddenLookIds.length,
    },
  }
}
