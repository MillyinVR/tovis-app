// app/api/looks/route.ts
import { prisma } from '@/lib/prisma'
import { jsonFail, jsonOk, pickInt, pickString } from '@/app/api/_utils'
import { getCurrentUser } from '@/lib/currentUser'
import {
  buildLooksFeedCursorWhere,
  buildLooksFeedOrderBy,
  buildLooksFeedWhere,
  decodeLooksFeedCursor,
  encodeLooksFeedCursor,
  parseLooksFeedSort,
  resolveLooksFeedKind,
} from '@/lib/looks/feed'
import { looksFeedSelect } from '@/lib/looks/selects'
import { mapLooksFeedMediaToDto } from '@/lib/looks/mappers'
import type { LooksFeedResponseDto } from '@/lib/looks/types'

export const dynamic = 'force-dynamic'

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
    const user = await getCurrentUser().catch(() => null)

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

    const followingProfessionalIds =
      kind === 'FOLLOWING'
        ? await loadFollowingProfessionalIds({
            clientId: user?.clientProfile?.id,
          })
        : []

    const where = buildLooksFeedWhere({
      kind,
      categorySlug: rawCategorySlug,
      q,
      followingProfessionalIds,
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
    const items = hasMore ? rows.slice(0, limit) : rows

    let likedSet = new Set<string>()

    if (user && items.length > 0) {
      const likes = await prisma.lookLike.findMany({
        where: {
          userId: user.id,
          lookPostId: {
            in: items.map((item) => item.id),
          },
        },
        select: {
          lookPostId: true,
        },
      })

      likedSet = new Set(likes.map((like) => like.lookPostId))
    }

    const mapped = await Promise.all(
      items.map((item) =>
        mapLooksFeedMediaToDto({
          item,
          viewerLiked: user ? likedSet.has(item.id) : false,
        }),
      ),
    )

    const payload = mapped.filter(
      (item): item is NonNullable<typeof item> => item !== null,
    )

    const nextCursor =
      hasMore && items.length > 0
        ? encodeLooksFeedCursor({
            kind,
            sort,
            row: items[items.length - 1],
          })
        : null

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
    console.error('GET /api/looks error', e)
    return jsonFail(500, 'Failed to load looks.')
  }
}