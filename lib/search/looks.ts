import { getCurrentUser } from '@/lib/currentUser'
import {
  buildLooksFeedCursorWhere,
  buildLooksFeedOrderBy,
  buildLooksFeedWhere,
  decodeLooksFeedCursor,
  encodeLooksFeedCursor,
  parseLooksFeedSort,
  resolveLooksFeedKind,
  type LooksFeedKind,
} from '@/lib/looks/feed'
import { mapLooksFeedMediaToDto } from '@/lib/looks/mappers'
import { looksFeedSelect } from '@/lib/looks/selects'
import type { LooksFeedResponseDto } from '@/lib/looks/types'
import { prisma } from '@/lib/prisma'
import {
  SearchRequestError,
  parseBooleanParam,
  parseLimit,
  pickNonEmptyString,
} from './contracts'

type PublicLooksSearchKind = Exclude<LooksFeedKind, 'FOLLOWING'>

function resolvePublicLooksSearchKind(args: {
  filter: string | null
  categorySlug: string | null
}): PublicLooksSearchKind | null {
  const kind = resolveLooksFeedKind({
    filter: args.filter,
    categorySlug: args.categorySlug,
    following: false,
  })

  if (!kind || kind === 'FOLLOWING') return null
  return kind
}

export async function searchLooks(
  searchParams: URLSearchParams,
): Promise<LooksFeedResponseDto> {
  const limit = parseLimit(searchParams.get('limit'), {
    defaultValue: 12,
    max: 50,
  })

  const rawCategorySlug = pickNonEmptyString(searchParams.get('category'))
  const q = pickNonEmptyString(searchParams.get('q'))
  const rawFilter = pickNonEmptyString(searchParams.get('filter'))
  const following = parseBooleanParam(searchParams.get('following'))

  if (following || rawFilter?.toLowerCase() === 'following') {
    throw new SearchRequestError(
      400,
      'Looks search does not support following.',
    )
  }

  const kind = resolvePublicLooksSearchKind({
    filter: rawFilter,
    categorySlug: rawCategorySlug,
  })

  if (!kind) {
    throw new SearchRequestError(400, 'Invalid looks filter.')
  }

  const rawSort = searchParams.get('sort')
  const sort = parseLooksFeedSort(rawSort)

  if (rawSort && !sort) {
    throw new SearchRequestError(400, 'Invalid looks sort.')
  }

  const rawCursor = pickNonEmptyString(searchParams.get('cursor'))
  const cursor = decodeLooksFeedCursor(rawCursor)

  if (rawCursor && !cursor) {
    throw new SearchRequestError(400, 'Invalid looks cursor.')
  }

  const user = await getCurrentUser().catch(() => null)

  const where = buildLooksFeedWhere({
    kind,
    categorySlug: rawCategorySlug,
    q,
    followingProfessionalIds: [],
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
  const page = hasMore ? rows.slice(0, limit) : rows

  let likedSet = new Set<string>()
  let savedSet = new Set<string>()

  if (user && page.length > 0) {
    const [likes, savedItems] = await Promise.all([
      prisma.lookLike.findMany({
        where: {
          userId: user.id,
          lookPostId: {
            in: page.map((item) => item.id),
          },
        },
        select: {
          lookPostId: true,
        },
      }),
      user.clientProfile?.id
        ? prisma.boardItem.findMany({
            where: {
              lookPostId: {
                in: page.map((item) => item.id),
              },
              board: {
                clientId: user.clientProfile.id,
              },
            },
            select: {
              lookPostId: true,
            },
          })
        : Promise.resolve([] as Array<{ lookPostId: string }>),
    ])

    likedSet = new Set(likes.map((like) => like.lookPostId))
    savedSet = new Set(savedItems.map((item) => item.lookPostId))
  }

  const mapped = await Promise.all(
    page.map((item) =>
      mapLooksFeedMediaToDto({
        item,
        viewerLiked: user ? likedSet.has(item.id) : false,
        viewerSaved: user?.clientProfile?.id ? savedSet.has(item.id) : false,
      }),
    ),
  )

  const items = mapped.filter(
    (item): item is NonNullable<typeof item> => item !== null,
  )

  const nextCursor =
    hasMore && page.length > 0
      ? encodeLooksFeedCursor({
          kind,
          sort,
          row: page[page.length - 1],
        })
      : null

  return {
    items,
    nextCursor,
    ...(user
      ? {
          viewerContext: {
            isAuthenticated: true,
          },
        }
      : {}),
  }
}