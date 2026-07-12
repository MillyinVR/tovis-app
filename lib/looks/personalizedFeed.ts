// lib/looks/personalizedFeed.ts
//
// Server-side orchestration for the personalized Looks feed (B1).
// Layers a query-time, per-viewer blend on top of the existing RANKED feed
// backbone — no new tables, no precomputed per-viewer score:
//
//  1. Backbone: the global RANKED page (rankScore desc + cursor), the same
//     infra the search grid uses. This is authoritative for pagination, so no
//     look is ever dropped as you scroll.
//  2. Injection (entry load only): a few of the freshest looks from pros the
//     viewer follows, so brand-new followed content — which has rankScore 0 and
//     would otherwise sit on the last page — surfaces on the first screen.
//  3. Re-rank: both sets are scored by computePersonalizedScore (follow / category
//     affinity / freshness boosts, seen penalty) and ordered best-first.
//
// The cursor always rides the backbone, so subsequent pages continue purely by
// rankScore; injected looks appear once (they land in the viewer's session seen
// set and are excluded thereafter).

import { BoardType, Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import type { TenantContext } from '@/lib/tenant'
import {
  BOARD_TYPE_FEED_SIGNALS,
  computeBoardEventProximity,
} from '@/lib/boards/context'
import {
  buildLooksFeedCursorWhere,
  buildLooksFeedOrderBy,
  buildLooksFeedWhere,
  encodeLooksFeedCursor,
  type LooksFeedCursor,
} from '@/lib/looks/feed'
import { looksFeedSelect, type LooksFeedRow } from '@/lib/looks/selects'
import { HIDDEN_LOOK_IDS_CAP, hideCategorySelect } from '@/lib/looks/hides'
import {
  normalizeSelfProfile,
  selfProfileInterestCategorySlugs,
} from '@/lib/personalization/selfProfile'
import {
  fetchClientTasteVector,
  fetchLookPostEmbeddings,
} from '@/lib/personalization/lookEmbeddingStore'
import {
  blendSessionTasteVector,
  type TasteVectorSignal,
} from '@/lib/personalization/tasteVectorMath'
import {
  rankPersonalizedRows,
  type PersonalizedViewerAffinity,
} from '@/lib/looks/personalizedRanking'

// How many of the viewer's most recent likes / saves feed category affinity.
// Bounded so the signal query stays cheap regardless of a power user's history.
// Exported: the taste-vector recompute (lib/personalization/tasteVectors.ts)
// samples the same signals with the same bound.
export const AFFINITY_SAMPLE_SIZE = 200

// Saves are a stronger taste signal than likes (mirrors the engagement weights
// in lib/looks/ranking.ts, scaled down). Exported: taste vectors weight the
// same signals identically (spec §2 hierarchy applied to §6.0 embeddings).
export const AFFINITY_LIKE_WEIGHT = 1
export const AFFINITY_SAVE_WEIGHT = 2

// Behavioral affinity half-life (spec §6.2 time decay, 60–90 day band): a
// like/save contributes at full weight today and half as much 75 days from
// now, so last year's prom obsession stops shaping this year's feed. Event
// signals decay separately (computeBoardEventProximity's sharp post-event
// fade); booking-driven affinity should decay slowest (~6–12 months) when
// bookings become an affinity source.
export const AFFINITY_HALF_LIFE_DAYS = 75

// Half-life for explicit "not for me" hide suppression (spec §2.2 "suppressions
// decay over weeks, not forever … explicit hides decay slower than inferred
// skips"). We have no inferred-skip signal yet, so this is the explicit-hide
// rate: a category hidden today suppresses at full weight, half as much in 30
// days, and is nearly gone by ~90 — "one bad veil week shouldn't permanently
// kill veils." Longer than an inferred skip would warrant, shorter than the
// 75-day POSITIVE affinity half-life (a mistaken hide should fade faster than a
// genuine like).
export const HIDE_SUPPRESSION_HALF_LIFE_DAYS = 30

// Spec §6.2 separation rule ("board activity should NOT flood the general Looks
// feed"): a board save fully updates that board's LOCAL taste — its
// BoardTasteVector and the §4.4 board feed — but bleeds into the GLOBAL feed at
// only this small, tunable fraction, so an active wedding board colors the
// discovery feed ("I know about your wedding") without dominating it. Looks-feed
// likes stay at full global weight; boards never receive Looks-feed signals, so
// the bleed is one-directional (spec §6.2). Applied to the board-save weight in
// BOTH projections of global taste — the categorical affinity here in
// loadPersonalizedAffinity and the visual ClientTasteVector in
// lib/personalization/tasteVectors — while recomputeBoardTasteVector keeps the
// full weight locally. Declared board PURPOSE (aggregateBoardContextSignals,
// sharply event-decayed) is the deliberate "I know about your wedding" channel
// and is NOT damped; this fraction governs raw save-engagement only. Start
// conservative (~0.15) and tune as prod accumulates board activity.
export const BOARD_GLOBAL_BLEED_WEIGHT = 0.15

const DAY_MS = 24 * 60 * 60 * 1000

// §6.3 in-session responsiveness: a like/save created within this window of the
// request is treated as belonging to "this sitting" and folds into an in-request
// visual taste delta, so the feed leans toward what the viewer just engaged with
// before the daily taste-vector cron catches up. Category/occasion affinity is
// already live (loadPersonalizedAffinity re-queries likes/saves every page); the
// visual taste vector is the one signal that lagged a full day, so this overlay
// targets it. Two hours comfortably spans a single scroll session without
// treating yesterday's browsing as "now".
const SESSION_RESPONSIVENESS_WINDOW_MS = 2 * 60 * 60 * 1000

// Cost bound on the extra in-session embedding fetch: only the freshest few
// signals of a sitting steer the visual delta, and nobody saves more than a
// handful of Looks in one window that actually matters.
const SESSION_SIGNAL_CAP = 20

// Category weight contributed by each declared self-profile interest (spec
// §6.6 / §2.1 onboarding chips) — an explicit, editable taste statement, so it
// matches a board purpose at full proximity and does NOT time-decay.
const INTEREST_CATEGORY_WEIGHT = 3

/**
 * Exponential time-decay factor in (0, 1] for a behavioral affinity signal of
 * the given age (spec §6.2). Missing/invalid timestamps decay as brand-new —
 * over-weighting is the safe failure for a taste signal. `halfLifeDays` defaults
 * to the positive-affinity half-life; the hide-suppression path passes the
 * slower explicit-hide half-life (§2.2). Pure + exported for unit testing.
 */
export function computeAffinityDecayFactor(
  createdAt: Date | null | undefined,
  now: Date,
  halfLifeDays: number = AFFINITY_HALF_LIFE_DAYS,
): number {
  if (!(createdAt instanceof Date) || Number.isNaN(createdAt.getTime())) {
    return 1
  }

  const effectiveHalfLife =
    Number.isFinite(halfLifeDays) && halfLifeDays > 0
      ? halfLifeDays
      : AFFINITY_HALF_LIFE_DAYS
  const ageDays = Math.max(0, now.getTime() - createdAt.getTime()) / DAY_MS
  return 2 ** (-ageDays / effectiveHalfLife)
}

// How many of the viewer's purposed boards feed occasion/category signals.
// Nobody keeps 24 concurrently-active occasions; this is a cost bound only.
const BOARD_CONTEXT_SAMPLE_SIZE = 24

// Category weight contributed by a declared board purpose at full event
// proximity — comparable to 1.5 saves in that category, before scaling.
const BOARD_TYPE_CATEGORY_WEIGHT = 3

// Max fresh followed-pro looks injected at entry. Kept small so the feed stays
// discovery-led rather than a followed-only timeline (that is the Following tab).
const FOLLOWED_INJECTION_LIMIT = 6

// Upper bound on the session seen list a client may send, so the exclusion
// clause can't blow up the query.
const SEEN_IDS_CAP = 300

export type PersonalizedCategoryAffinityEntry = {
  slug: string
  weight: number
}

/**
 * Fold raw (slug, weight) affinity signals into a summed-per-category map.
 * Pure + exported for unit testing.
 */
export function aggregateCategoryWeights(
  entries: readonly PersonalizedCategoryAffinityEntry[],
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

export type BoardContextSignalRow = {
  type: BoardType
  eventDate: Date | null
}

export type BoardContextSignals = {
  categoryEntries: PersonalizedCategoryAffinityEntry[]
  occasionTagWeights: Map<string, number>
}

/**
 * Fold the viewer's declared board purposes (type + event date, spec §7–8)
 * into feed signals: category-affinity entries (added alongside like/save
 * entries) and occasion tag weights (the new boost term in personalizedRanking).
 * Each board's contribution is scaled by its event proximity — an imminent
 * wedding shapes the feed at full strength, a passed one not at all. Multiple
 * boards mapping to the same tag/category keep the STRONGEST weight (the same
 * occasion declared twice isn't double the interest). Pure + exported for
 * unit testing.
 */
export function aggregateBoardContextSignals(
  boards: readonly BoardContextSignalRow[],
  now: Date,
): BoardContextSignals {
  const occasionTagWeights = new Map<string, number>()
  const categoryWeights = new Map<string, number>()

  for (const board of boards) {
    const signals = BOARD_TYPE_FEED_SIGNALS[board.type]
    if (
      signals.tagSlugs.length === 0 &&
      signals.categorySlugs.length === 0
    ) {
      continue
    }

    const proximity = computeBoardEventProximity(board.eventDate, now)
    if (proximity <= 0) continue

    for (const slug of signals.tagSlugs) {
      const current = occasionTagWeights.get(slug) ?? 0
      if (proximity > current) occasionTagWeights.set(slug, proximity)
    }

    const categoryWeight = BOARD_TYPE_CATEGORY_WEIGHT * proximity
    for (const slug of signals.categorySlugs) {
      const current = categoryWeights.get(slug) ?? 0
      if (categoryWeight > current) categoryWeights.set(slug, categoryWeight)
    }
  }

  return {
    categoryEntries: [...categoryWeights.entries()].map(([slug, weight]) => ({
      slug,
      weight,
    })),
    occasionTagWeights,
  }
}

const categorySlugSelect = {
  // Which look the signal is on — feeds the §6.3 in-session visual delta.
  lookPostId: true,
  // When the signal happened — the input to the §6.2 time decay and the §6.3
  // in-session freshness window.
  createdAt: true,
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

type AffinitySignalRow = {
  lookPostId?: string | null
  createdAt?: Date | null
}

/**
 * Collect the freshest same-session (spec §6.3) like/save signals as
 * (lookPostId, weight) pairs: a signal counts when its look id is present and it
 * landed inside SESSION_RESPONSIVENESS_WINDOW_MS of `now`. Rows arrive newest
 * first (the queries order by createdAt desc), so the window subset is a prefix;
 * the combined set is capped for the downstream embedding fetch. Pure.
 */
function collectSessionSignals(
  likes: readonly AffinitySignalRow[],
  saves: readonly AffinitySignalRow[],
  now: Date,
): Array<{ lookPostId: string; weight: number }> {
  const windowStart = now.getTime() - SESSION_RESPONSIVENESS_WINDOW_MS

  const inWindow = (
    rows: readonly AffinitySignalRow[],
    baseWeight: number,
  ): Array<{ lookPostId: string; createdAt: Date; weight: number }> => {
    const collected: Array<{
      lookPostId: string
      createdAt: Date
      weight: number
    }> = []
    for (const row of rows) {
      const lookPostId =
        typeof row.lookPostId === 'string' ? row.lookPostId.trim() : ''
      if (!lookPostId) continue
      const createdAt = row.createdAt
      if (!(createdAt instanceof Date) || Number.isNaN(createdAt.getTime())) {
        continue
      }
      if (createdAt.getTime() < windowStart) continue
      collected.push({
        lookPostId,
        createdAt,
        weight: baseWeight * computeAffinityDecayFactor(createdAt, now),
      })
    }
    return collected
  }

  return [
    ...inWindow(likes, AFFINITY_LIKE_WEIGHT),
    ...inWindow(saves, AFFINITY_SAVE_WEIGHT),
  ]
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    .slice(0, SESSION_SIGNAL_CAP)
    .map(({ lookPostId, weight }) => ({ lookPostId, weight }))
}

/**
 * Load the viewer's personalized-feed signals: which pros they follow, how strongly they
 * lean toward each service category (from their likes + saved-board items),
 * and their declared board purposes/event dates (occasion signals, spec §7–8).
 * Every query is bounded; missing signals just yield an empty affinity.
 */
export async function loadPersonalizedAffinity(args: {
  userId: string
  clientId: string | null | undefined
  now: Date
}): Promise<PersonalizedViewerAffinity & { hiddenLookIds: string[] }> {
  const clientId = args.clientId ?? null

  const [
    follows,
    likes,
    boardItems,
    boardContexts,
    selfProfileRow,
    tasteVectorRow,
    hides,
  ] = await Promise.all([
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
      clientId
        ? prisma.board.findMany({
            where: {
              clientId,
              type: { not: BoardType.GENERAL },
            },
            orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
            take: BOARD_CONTEXT_SAMPLE_SIZE,
            select: { type: true, eventDate: true },
          })
        : Promise.resolve([]),
      clientId
        ? prisma.clientProfile.findUnique({
            where: { id: clientId },
            select: { selfProfile: true },
          })
        : Promise.resolve(null),
      // The viewer's visual taste vector (spec §6.0/§6.1). null pre-backfill or
      // before any embedded signal — the ranking layer then skips visual scoring
      // entirely (missing vector = no boost).
      clientId
        ? fetchClientTasteVector(prisma, clientId)
        : Promise.resolve(null),
      // §2.2 explicit "not for me" hides. Keyed by userId (like lookLike), so
      // loaded for any signed-in viewer — a pro-only account can hide looks too.
      // Serves both the hard feed exclusion (hiddenLookIds) and the decayed
      // category suppression below.
      prisma.lookHide.findMany({
        where: { userId: args.userId },
        orderBy: { createdAt: 'desc' },
        take: HIDDEN_LOOK_IDS_CAP,
        select: hideCategorySelect,
      }),
    ])

  // Behavioral signals decay with age (spec §6.2) so stale taste fades.
  const entries: PersonalizedCategoryAffinityEntry[] = []
  for (const like of likes) {
    const slug = slugFromCategoryRow(like)
    if (!slug) continue
    entries.push({
      slug,
      weight:
        AFFINITY_LIKE_WEIGHT * computeAffinityDecayFactor(like.createdAt, args.now),
    })
  }
  for (const item of boardItems) {
    const slug = slugFromCategoryRow(item)
    if (!slug) continue
    // §6.2 separation: a board save bleeds into the GLOBAL category affinity at
    // only BOARD_GLOBAL_BLEED_WEIGHT of a like's strength (Looks-feed likes above
    // stay at full weight), so board activity flavors the discovery feed without
    // flooding it.
    entries.push({
      slug,
      weight:
        AFFINITY_SAVE_WEIGHT *
        BOARD_GLOBAL_BLEED_WEIGHT *
        computeAffinityDecayFactor(item.createdAt, args.now),
    })
  }

  const boardSignals = aggregateBoardContextSignals(boardContexts, args.now)
  entries.push(...boardSignals.categoryEntries)

  // Declared self-profile interests (spec §6.6): explicit taste, no decay —
  // gives a brand-new client a category signal before any like/save history.
  const selfProfile = normalizeSelfProfile(selfProfileRow?.selfProfile)
  for (const slug of selfProfileInterestCategorySlugs(selfProfile)) {
    entries.push({ slug, weight: INTEREST_CATEGORY_WEIGHT })
  }

  // §6.3 in-session responsiveness: fold this sitting's freshest like/save
  // embeddings into the (daily-cron) taste vector at request time. Client-gated
  // so a viewer without a client profile stays on today's exact path (no taste
  // vector, no extra query). Byte-identical to the pre-§6.3 feed whenever the
  // sitting produced no fresh embedded signal.
  const sessionSignalRefs =
    clientId !== null ? collectSessionSignals(likes, boardItems, args.now) : []
  const sessionEmbeddings =
    sessionSignalRefs.length > 0
      ? await fetchLookPostEmbeddings(
          prisma,
          sessionSignalRefs.map((ref) => ref.lookPostId),
        )
      : new Map<string, number[]>()
  const sessionSignals: TasteVectorSignal[] = []
  for (const ref of sessionSignalRefs) {
    const embedding = sessionEmbeddings.get(ref.lookPostId)
    if (!embedding) continue
    sessionSignals.push({ embedding, weight: ref.weight })
  }

  const tasteBlend = blendSessionTasteVector({
    storedVector: tasteVectorRow?.embedding ?? null,
    storedSignalCount: tasteVectorRow?.signalCount ?? 0,
    sessionSignals,
  })

  // §2.2 hides → hard-exclusion id list + decayed category-suppression weights.
  // Every hide contributes its id (feed exclusion); those whose look resolves to
  // a service category also add a decayed weight to that category (the softer,
  // repeated-hides suppression, ranked in personalizedRanking with a
  // slower-than-positive half-life so a mistaken hide fades).
  const hiddenLookIds: string[] = []
  const categorySuppressionWeights = new Map<string, number>()
  for (const hide of hides) {
    hiddenLookIds.push(hide.lookPostId)
    const slug = slugFromCategoryRow(hide)
    if (!slug) continue
    categorySuppressionWeights.set(
      slug,
      (categorySuppressionWeights.get(slug) ?? 0) +
        computeAffinityDecayFactor(
          hide.createdAt,
          args.now,
          HIDE_SUPPRESSION_HALF_LIFE_DAYS,
        ),
    )
  }

  return {
    followedProfessionalIds: new Set(
      follows.map((follow) => follow.professionalId),
    ),
    categoryWeights: aggregateCategoryWeights(entries),
    categorySuppressionWeights,
    occasionTagWeights: boardSignals.occasionTagWeights,
    tasteVector: tasteBlend.vector,
    tasteSignalCount: tasteBlend.signalCount,
    sessionVisualSignalCount: sessionSignals.length,
    hiddenLookIds,
  }
}

export type PersonalizedFeedPage = {
  items: LooksFeedRow[]
  nextCursor: string | null
  // Instrumentation surface — how the page was assembled.
  meta: {
    backboneCount: number
    injectedCount: number
    seenCount: number
    followedCount: number
    affinityCategoryCount: number
    occasionTagCount: number
    // Visual layer (spec §6.0): how many embedded signals built the viewer's
    // taste vector (0 = no vector, visual scoring off) and how many candidate
    // looks on this page had an embedding to score against.
    tasteSignalCount: number
    candidateEmbeddingCount: number
    // §6.3 in-session responsiveness: how many fresh same-session like/save
    // embeddings folded into the taste vector for this request (0 = the vector
    // is the stored one unchanged).
    sessionVisualSignalCount: number
    // §2.2 "not for me": how many hidden looks were excluded from this serve,
    // and how many categories are currently under decayed suppression. Feed the
    // §9 hide-rate early-warning signal.
    hiddenExcludedCount: number
    categorySuppressionCount: number
  }
}

/**
 * Assemble one personalized feed page. `cursor` null means the entry load
 * (fresh followed content is injected only there). The returned items are
 * ordered for display; `nextCursor` continues the RANKED backbone.
 */
export async function buildPersonalizedFeedPage(args: {
  tenant: TenantContext
  userId: string
  clientId: string | null | undefined
  limit: number
  cursor: LooksFeedCursor | null
  seenLookIds: ReadonlySet<string>
  now: Date
}): Promise<PersonalizedFeedPage> {
  const affinity = await loadPersonalizedAffinity({
    userId: args.userId,
    clientId: args.clientId,
    now: args.now,
  })

  const baseWhere = buildLooksFeedWhere({
    kind: 'ALL',
    tenant: args.tenant,
  })

  const seenIds = [...args.seenLookIds]
  // §2.2: hidden looks are hard-excluded (never re-served), alongside the
  // session seen list. Both are folded into one bounded `notIn`.
  const hiddenLookIds = affinity.hiddenLookIds
  const excludedIds = [...new Set([...seenIds, ...hiddenLookIds])]
  const idExclusion: Prisma.LookPostWhereInput | null =
    excludedIds.length > 0 ? { id: { notIn: excludedIds } } : null

  const cursorWhere = buildLooksFeedCursorWhere({
    kind: 'ALL',
    sort: 'RANKED',
    cursor: args.cursor,
  })

  const backboneWhere: Prisma.LookPostWhereInput = {
    AND: [
      baseWhere,
      ...(cursorWhere ? [cursorWhere] : []),
      ...(idExclusion ? [idExclusion] : []),
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
    // Hidden + seen + already-on-page all excluded from the injection too.
    const excludeIds = [...new Set([...excludedIds, ...alreadyOnPage])]

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

  // Fetch candidate embeddings by PK for the page's rows — only when the viewer
  // actually has a taste vector to compare against (otherwise every row scores 0
  // visually, so the query would be pure overhead). No corpus-wide ANN: the set
  // is just this page's ids, and no vector index exists yet by design.
  const candidateRows = [...backbonePage, ...injectedRows]
  const candidateEmbeddings =
    affinity.tasteVector && candidateRows.length > 0
      ? await fetchLookPostEmbeddings(
          prisma,
          candidateRows.map((row) => row.id),
        )
      : new Map<string, number[]>()

  const items = rankPersonalizedRows(candidateRows, {
    affinity,
    seenLookIds: args.seenLookIds,
    now: args.now,
    candidateEmbeddings,
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
      occasionTagCount: affinity.occasionTagWeights.size,
      tasteSignalCount: affinity.tasteSignalCount ?? 0,
      candidateEmbeddingCount: candidateEmbeddings.size,
      sessionVisualSignalCount: affinity.sessionVisualSignalCount ?? 0,
      hiddenExcludedCount: hiddenLookIds.length,
      categorySuppressionCount: affinity.categorySuppressionWeights?.size ?? 0,
    },
  }
}
