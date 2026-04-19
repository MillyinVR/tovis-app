// app/api/looks/route.ts
import { prisma } from '@/lib/prisma'
import { jsonFail, jsonOk, pickInt, pickString } from '@/app/api/_utils'
import { getCurrentUser } from '@/lib/currentUser'
import {
  buildLooksFeedOrderBy,
  buildLooksFeedWhere,
  resolveLooksFeedKind,
} from '@/lib/looks/feed'
import { looksFeedSelect } from '@/lib/looks/selects'
import { mapLooksFeedMediaToDto } from '@/lib/looks/mappers'

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

    const kind = resolveLooksFeedKind({
      categorySlug: rawCategorySlug,
      following,
    })

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

    const orderBy = buildLooksFeedOrderBy({ kind })

    const items = await prisma.lookPost.findMany({
      where,
      orderBy,
      take: limit,
      select: looksFeedSelect,
    })

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

    return jsonOk({
      ok: true,
      items: payload,
    })
  } catch (e) {
    console.error('GET /api/looks error', e)
    return jsonFail(500, 'Failed to load looks.')
  }
}