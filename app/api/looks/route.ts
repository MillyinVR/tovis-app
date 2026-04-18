// app/api/looks/route.ts
import { prisma } from '@/lib/prisma'
import { jsonFail, jsonOk, pickInt, pickString } from '@/app/api/_utils'
import { getCurrentUser } from '@/lib/currentUser'
import {
  buildLooksMediaFeedOrderBy,
  buildLooksMediaFeedWhere,
  resolveLooksMediaFeedKind,
} from '@/lib/looks/feed'
import { looksFeedMediaSelect } from '@/lib/looks/selects'
import { mapLooksFeedMediaToDto } from '@/lib/looks/mappers'

export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  try {
    const user = await getCurrentUser().catch(() => null)

    const { searchParams } = new URL(req.url)
    const limit = Math.min(pickInt(searchParams.get('limit')) ?? 12, 50)

    const rawCategorySlug = pickString(searchParams.get('category'))
    const q = pickString(searchParams.get('q'))

    const kind = resolveLooksMediaFeedKind({
      categorySlug: rawCategorySlug,
    })

    const where = buildLooksMediaFeedWhere({
      kind,
      categorySlug: rawCategorySlug,
      q,
    })

    const orderBy = buildLooksMediaFeedOrderBy({ kind })

    const items = await prisma.mediaAsset.findMany({
      where,
      orderBy,
      take: limit,
      select: looksFeedMediaSelect,
    })

    let likedSet = new Set<string>()

    if (user && items.length > 0) {
      const likes = await prisma.mediaLike.findMany({
        where: {
          userId: user.id,
          mediaId: { in: items.map((item) => item.id) },
        },
        select: { mediaId: true },
      })

      likedSet = new Set(likes.map((like) => like.mediaId))
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

    return jsonOk({ ok: true, items: payload })
  } catch (e) {
    console.error('GET /api/looks error', e)
    return jsonFail(500, 'Failed to load looks.')
  }
}