// app/api/v1/looks/route.ts
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
import { forYouFeedEnabled } from '@/lib/looks/forYouFlag'
import { buildForYouFeedPage, parseSeenLookIds } from '@/lib/looks/forYouFeed'
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

    // For You gates the DEFAULT Look tab only: signed-in viewer, no explicit
    // sort/search/category, flag on. An explicit `sort=recent` (or the flag off)
    // always falls through to the chronological feed — the capability is never
    // gated, only the default.
    const useForYou =
      forYouFeedEnabled() &&
      Boolean(user) &&
      kind === 'ALL' &&
      !q &&
      !rawCategorySlug &&
      !rawSort

    let items: LooksFeedRow[]
    let nextCursor: string | null
    let cohort: LooksFeedCohort
    let forYouMeta: Awaited<ReturnType<typeof buildForYouFeedPage>>['meta'] | null =
      null

    if (useForYou && user) {
      const seenLookIds = parseSeenLookIds(searchParams.get('seen'))

      const page = await buildForYouFeedPage({
        tenant,
        userId: user.id,
        clientId: user.clientProfile?.id ?? null,
        limit,
        cursor,
        seenLookIds,
        now: new Date(),
      })

      items = page.items
      nextCursor = page.nextCursor
      forYouMeta = page.meta
      cohort = 'for_you'
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

      const cursorWhere = buildLooksFeedCursorWhere({
        kind,
        sort,
        cursor,
      })

      const pageWhere = cursorWhere
        ? {
            AND: [where, cursorWhere],
          }
        : where

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

    logLooksFeedServe({
      cohort,
      authed: Boolean(user),
      page: cursor ? 'more' : 'entry',
      itemCount: payload.length,
      userId: user?.id ?? null,
      backboneCount: forYouMeta?.backboneCount ?? null,
      injectedCount: forYouMeta?.injectedCount ?? null,
      seenCount: forYouMeta?.seenCount ?? null,
      followedCount: forYouMeta?.followedCount ?? null,
      affinityCategoryCount: forYouMeta?.affinityCategoryCount ?? null,
      occasionTagCount: forYouMeta?.occasionTagCount ?? null,
    })

    const body: LooksFeedResponseDto & { ok: true } = {
      ok: true,
      items: payload,
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