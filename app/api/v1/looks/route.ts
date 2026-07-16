// app/api/v1/looks/route.ts
import { Prisma } from '@prisma/client'

import { prisma } from '@/lib/prisma'
import { jsonFail, jsonOk, pickInt, pickString } from '@/app/api/_utils'
import { getOptionalUser } from '@/app/api/_utils/auth/getOptionalUser'
import {
  buildLooksFeedCursorWhere,
  buildLooksFeedOrderBy,
  buildLooksFeedWhere,
  decodeLooksFeedCursor,
  encodeLooksFeedCursor,
  parseLooksFeedSort,
  resolveLooksFeedKind,
} from '@/lib/looks/feed'
import { mapLooksFeedMediaToDto } from '@/lib/looks/mappers'
import { buildLooksViewerFlagResolver } from '@/lib/looks/viewerFlags'
import { loadClientLinkViewer } from '@/lib/clientVisibility'
import { listFollowedClientIds } from '@/lib/follows/clientFollows'
import { looksFeedSelect, type LooksFeedRow } from '@/lib/looks/selects'
import type { LooksFeedResponseDto } from '@/lib/looks/types'
import { resolveTenantContextForRequest } from '@/lib/tenant'
import { getBrandForTenantContext } from '@/lib/brand/forTenant'
import { attachLookBadges } from '@/lib/looks/badges/attach'
import { personalizedFeedEnabled } from '@/lib/looks/personalizedFlag'
import { buildPersonalizedFeedPage, parseSeenLookIds } from '@/lib/looks/personalizedFeed'
import { parseSessionIntent } from '@/lib/looks/feedComposition'
import { loadHiddenLookIds } from '@/lib/looks/hides'
import {
  logLooksFeedServe,
  type LooksFeedCohort,
} from '@/lib/observability/looksFeedEvents'
import type { LooksFeedKind } from '@/lib/looks/feed'

export const dynamic = 'force-dynamic'

// Instrumentation bucket for the default (non-For-You) serve, so log-based
// dwell/return comparison can separate the chronological baseline from search,
// spotlight, following and category browsing.
function resolveDefaultCohort(args: {
  kind: LooksFeedKind
  q: string | null
  categorySlug: string | null
}): LooksFeedCohort {
  if (args.q) return 'search'
  if (args.kind === 'SPOTLIGHT') return 'spotlight'
  if (args.kind === 'FOLLOWING') return 'following'
  if (args.categorySlug) return 'category'
  return 'recent'
}

// Viewer coordinates for the distance badge (spec §5.2 convenience class).
// Optional, client-supplied from the same localStorage viewer location the
// availability drawer uses; out-of-range or half-provided pairs read as
// absent. Never persisted — used only to compute this page's distances.
function parseCoordinateParam(
  value: string | null,
  min: number,
  max: number,
): number | null {
  if (typeof value !== 'string' || value.trim().length === 0) return null
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return null
  if (parsed < min || parsed > max) return null
  return parsed
}

function parseBooleanParam(value: string | null): boolean {
  if (typeof value !== 'string') return false

  const normalized = value.trim().toLowerCase()
  return (
    normalized === '1' ||
    normalized === 'true' ||
    normalized === 'yes' ||
    normalized === 'on'
  )
}

async function loadFollowingProfessionalIds(args: {
  clientId: string | null | undefined
}): Promise<string[]> {
  if (!args.clientId) return []

  const follows = await prisma.proFollow.findMany({
    where: {
      clientId: args.clientId,
    },
    select: {
      professionalId: true,
    },
  })

  return follows.map((follow) => follow.professionalId)
}

export async function GET(req: Request) {
  try {
    const user = await getOptionalUser()

    const { searchParams } = new URL(req.url)

    const requestedLimit = pickInt(searchParams.get('limit')) ?? 12
    const limit = Math.max(1, Math.min(requestedLimit, 50))

    const rawCategorySlug = pickString(searchParams.get('category'))
    const q = pickString(searchParams.get('q'))
    const following = parseBooleanParam(searchParams.get('following'))

    const rawFilter = pickString(searchParams.get('filter'))
    const kind = resolveLooksFeedKind({
      filter: rawFilter,
      categorySlug: rawCategorySlug,
      following,
    })

    if (!kind) {
      return jsonFail(400, 'Invalid looks filter.')
    }

    const rawSort = searchParams.get('sort')
    const sort = parseLooksFeedSort(rawSort)

    if (rawSort && !sort) {
      return jsonFail(400, 'Invalid looks sort.')
    }

    const rawCursor = pickString(searchParams.get('cursor'))
    const cursor = decodeLooksFeedCursor(rawCursor)

    if (rawCursor && !cursor) {
      return jsonFail(400, 'Invalid looks cursor.')
    }

    const tenant = await resolveTenantContextForRequest(req)

    // Optional viewer location (the client's localStorage geolocation, both-or-neither,
    // range-checked). Powers the §5 DISTANCE badge AND the §4.5 proximity_fit ranking
    // term — parsed once, up front, so both the personalized feed and badge attach read
    // the same coordinates. Absent → both proximity surfaces stay off (byte-identical).
    const rawViewerLat = parseCoordinateParam(
      searchParams.get('viewerLat'),
      -90,
      90,
    )
    const rawViewerLng = parseCoordinateParam(
      searchParams.get('viewerLng'),
      -180,
      180,
    )
    const hasViewerCoords = rawViewerLat !== null && rawViewerLng !== null
    const viewerLocation =
      rawViewerLat !== null && rawViewerLng !== null
        ? { lat: rawViewerLat, lng: rawViewerLng }
        : null

    // The personalized feed gates the DEFAULT Look tab only: signed-in viewer, no explicit
    // sort/search/category, flag on. An explicit `sort=recent` (or the flag off)
    // always falls through to the chronological feed — the capability is never
    // gated, only the default.
    const usePersonalized =
      personalizedFeedEnabled() &&
      Boolean(user) &&
      kind === 'ALL' &&
      !q &&
      !rawCategorySlug &&
      !rawSort

    let items: LooksFeedRow[]
    let nextCursor: string | null
    let cohort: LooksFeedCohort
    let personalizedMeta: Awaited<ReturnType<typeof buildPersonalizedFeedPage>>['meta'] | null =
      null
    // §2.2: how many of the signed-in viewer's hidden looks were excluded from a
    // NON-personalized serve (the personalized path reports its own count in
    // personalizedMeta). null for a signed-out viewer (no hides).
    let chronoHiddenExcludedCount: number | null = null

    if (usePersonalized && user) {
      const seenLookIds = parseSeenLookIds(searchParams.get('seen'))
      // §4.3.2 session intent: an optional client hint (opened from an opening
      // push → 'book'; repeated availability/pricing taps escalate the same way).
      // Absent / unknown → 'default' (neutral lean), so today's requests are
      // unchanged. Search intent lives on the non-personalized path (an explicit
      // `q` bypasses the personalized feed entirely), so it isn't handled here.
      const intent = parseSessionIntent(searchParams.get('intent'))

      const page = await buildPersonalizedFeedPage({
        tenant,
        userId: user.id,
        clientId: user.clientProfile?.id ?? null,
        limit,
        cursor,
        seenLookIds,
        now: new Date(),
        intent,
        // §4.5 proximity_fit: lean the bookable feed toward pros near the viewer.
        viewerLocation,
      })

      items = page.items
      nextCursor = page.nextCursor
      personalizedMeta = page.meta
      cohort = 'personalized'
    } else {
      const [followingProfessionalIds, followingClientIds] =
        kind === 'FOLLOWING'
          ? await Promise.all([
              loadFollowingProfessionalIds({
                clientId: user?.clientProfile?.id,
              }),
              // Followed CLIENTS' public looks join the Following tab too
              // (social-first D3).
              listFollowedClientIds(prisma, user?.clientProfile?.id),
            ])
          : [[], []]

      const where = buildLooksFeedWhere({
        kind,
        tenant,
        categorySlug: rawCategorySlug,
        q,
        followingProfessionalIds,
        followingClientIds,
      })

      // §2.2: exclude the signed-in viewer's hidden looks from every
      // non-personalized feed too (following / spotlight / category / search /
      // sort=recent). Signed-out viewers have no hides — skip the query.
      const hiddenLookIds = user
        ? await loadHiddenLookIds(prisma, { userId: user.id })
        : []
      chronoHiddenExcludedCount = user ? hiddenLookIds.length : null

      const cursorWhere = buildLooksFeedCursorWhere({
        kind,
        sort,
        cursor,
      })

      const andParts: Prisma.LookPostWhereInput[] = [
        ...(cursorWhere ? [cursorWhere] : []),
        ...(hiddenLookIds.length > 0
          ? [{ id: { notIn: hiddenLookIds } }]
          : []),
      ]

      const pageWhere =
        andParts.length > 0 ? { AND: [where, ...andParts] } : where

      const orderBy = buildLooksFeedOrderBy({ kind, sort })

      const rows = await prisma.lookPost.findMany({
        where: pageWhere,
        orderBy,
        take: limit + 1,
        select: looksFeedSelect,
      })

      const hasMore = rows.length > limit
      items = hasMore ? rows.slice(0, limit) : rows

      const lastItem = items[items.length - 1]
      nextCursor =
        hasMore && lastItem !== undefined
          ? encodeLooksFeedCursor({
              kind,
              sort,
              row: lastItem,
            })
          : null

      cohort = resolveDefaultCohort({ kind, q, categorySlug: rawCategorySlug })
    }

    const resolveViewerFlags = await buildLooksViewerFlagResolver({
      user,
      items,
    })

    const clientLinkViewer = await loadClientLinkViewer(user)

    const mapped = await Promise.all(
      items.map((item) =>
        mapLooksFeedMediaToDto({
          item,
          ...resolveViewerFlags(item),
          clientLinkViewer,
        }),
      ),
    )

    const payload = mapped.filter(
      (item): item is NonNullable<typeof item> => item !== null,
    )

    // Badge attachment (spec §5): engine-computed, per-viewer where relevant,
    // with the §9 measurement holdout. Universal badges apply to every cohort
    // (signed-out included); viewer-intent badges need coords / a client. The
    // viewer coordinates were parsed once up front (shared with §4.5 proximity_fit).
    const badgeResult = await attachLookBadges({
      db: prisma,
      rows: items,
      viewer: {
        userId: user?.id ?? null,
        clientId: user?.clientProfile?.id ?? null,
        lat: hasViewerCoords ? rawViewerLat : null,
        lng: hasViewerCoords ? rawViewerLng : null,
      },
      brandName: getBrandForTenantContext(tenant).displayName,
      now: new Date(),
    })

    const badgedPayload = payload.map((item) => ({
      ...item,
      badge: badgeResult.badges.get(item.id) ?? null,
    }))

    logLooksFeedServe({
      cohort,
      authed: Boolean(user),
      page: cursor ? 'more' : 'entry',
      itemCount: payload.length,
      userId: user?.id ?? null,
      backboneCount: personalizedMeta?.backboneCount ?? null,
      injectedCount: personalizedMeta?.injectedCount ?? null,
      seenCount: personalizedMeta?.seenCount ?? null,
      followedCount: personalizedMeta?.followedCount ?? null,
      affinityCategoryCount: personalizedMeta?.affinityCategoryCount ?? null,
      occasionTagCount: personalizedMeta?.occasionTagCount ?? null,
      tasteSignalCount: personalizedMeta?.tasteSignalCount ?? null,
      candidateEmbeddingCount: personalizedMeta?.candidateEmbeddingCount ?? null,
      availabilitySignalCount: personalizedMeta?.availabilitySignalCount ?? null,
      sessionVisualSignalCount: personalizedMeta?.sessionVisualSignalCount ?? null,
      hiddenExcludedCount:
        personalizedMeta?.hiddenExcludedCount ?? chronoHiddenExcludedCount,
      categorySuppressionCount:
        personalizedMeta?.categorySuppressionCount ?? null,
      // §4.3/§4.3.1/§4.3.2 composition (personalized cohort only).
      sessionIntent: personalizedMeta?.sessionIntent ?? null,
      availabilityWeightMultiplier:
        personalizedMeta?.availabilityWeightMultiplier ?? null,
      explorationInjectedCount:
        personalizedMeta?.explorationInjectedCount ?? null,
      bookableCount: personalizedMeta?.bookableCount ?? null,
      inspirationCount: personalizedMeta?.inspirationCount ?? null,
      // §6.7 post-booking relationship layer (personalized cohort only).
      relationshipProCount: personalizedMeta?.relationshipProCount ?? null,
      relationshipBoostedCount:
        personalizedMeta?.relationshipBoostedCount ?? null,
      // §4.2/§4.5 underbooked fairness on-ramp (personalized cohort only).
      underbookedBoostedCount:
        personalizedMeta?.underbookedBoostedCount ?? null,
      // §4.2 booking_conversion_rate (personalized cohort only).
      conversionBoostedCount: personalizedMeta?.conversionBoostedCount ?? null,
      // §4.2 pro_reliability (personalized cohort only).
      reliabilityBoostedCount:
        personalizedMeta?.reliabilityBoostedCount ?? null,
      // §4.5 price_fit learned price band (personalized cohort only).
      priceFitBoostedCount: personalizedMeta?.priceFitBoostedCount ?? null,
      // §4.5 proximity_fit viewer→pro distance (personalized cohort only).
      proximityFitBoostedCount:
        personalizedMeta?.proximityFitBoostedCount ?? null,
      // §4.6 impression freshness + retrieval widening (personalized cohort only).
      freshnessRatio: personalizedMeta?.freshnessRatio ?? null,
      widenedBackfillCount: personalizedMeta?.widenedBackfillCount ?? null,
      badgeEligibleCount: badgeResult.meta.eligibleCount,
      badgeShownCount: badgeResult.meta.shownCount,
      badgeHoldoutCount: badgeResult.meta.holdoutCount,
      badgeKindCounts: badgeResult.meta.kindCounts,
    })

    const body: LooksFeedResponseDto & { ok: true } = {
      ok: true,
      items: badgedPayload,
      nextCursor,
      ...(user
        ? {
            viewerContext: {
              isAuthenticated: true,
            },
          }
        : {}),
    }

    return jsonOk(body)
  } catch (e) {
    console.error('GET /api/v1/looks error', e)
    return jsonFail(500, 'Failed to load looks.')
  }
}