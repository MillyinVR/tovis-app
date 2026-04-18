// app/api/looks/[id]/comments/route.ts
import { prisma } from '@/lib/prisma'
import {
  jsonFail,
  jsonOk,
  pickInt,
  pickString,
  requireUser,
} from '@/app/api/_utils'
import { isPublicLooksEligibleMedia } from '@/lib/looks/guards'
import { mapLooksCommentToDto } from '@/lib/looks/mappers'

export const dynamic = 'force-dynamic'

type Params = { id: string }
type Ctx = { params: Params | Promise<Params> }

async function getParams(ctx: Ctx): Promise<Params> {
  return await Promise.resolve(ctx.params)
}

async function requirePublicEligibleLook(id: string) {
  const media = await prisma.mediaAsset.findUnique({
    where: { id },
    select: {
      id: true,
      visibility: true,
      isEligibleForLooks: true,
      isFeaturedInPortfolio: true,
    },
  })

  if (!media) return null
  return isPublicLooksEligibleMedia(media) ? media : null
}

export async function GET(req: Request, ctx: Ctx) {
  try {
    const { id: rawId } = await getParams(ctx)
    const id = pickString(rawId)

    if (!id) {
      return jsonFail(400, 'Missing media id.', {
        code: 'MISSING_MEDIA_ID',
      })
    }

    const media = await requirePublicEligibleLook(id)
    if (!media) {
      return jsonFail(404, 'Not found.', {
        code: 'NOT_FOUND',
      })
    }

    const { searchParams } = new URL(req.url)
    const limit = Math.min(pickInt(searchParams.get('limit')) ?? 30, 100)

    const [rows, commentsCount] = await prisma.$transaction([
      prisma.mediaComment.findMany({
        where: { mediaId: id },
        orderBy: { createdAt: 'desc' },
        take: limit,
        include: {
          user: {
            select: {
              id: true,
              clientProfile: {
                select: {
                  firstName: true,
                  lastName: true,
                  avatarUrl: true,
                },
              },
              professionalProfile: {
                select: {
                  businessName: true,
                  avatarUrl: true,
                },
              },
            },
          },
        },
      }),
      prisma.mediaComment.count({
        where: { mediaId: id },
      }),
    ])

    return jsonOk(
      {
        comments: rows.map(mapLooksCommentToDto),
        commentsCount,
      },
      200,
    )
  } catch (e) {
    console.error('GET /api/looks/[id]/comments error', e)
    return jsonFail(500, 'Couldn’t load comments. Try again.', {
      code: 'INTERNAL',
    })
  }
}

export async function POST(req: Request, ctx: Ctx) {
  try {
    const auth = await requireUser()
    if (!auth.ok) return auth.res

    const user = auth.user

    const { id: rawId } = await getParams(ctx)
    const id = pickString(rawId)

    if (!id) {
      return jsonFail(400, 'Missing media id.', {
        code: 'MISSING_MEDIA_ID',
      })
    }

    const media = await requirePublicEligibleLook(id)
    if (!media) {
      return jsonFail(404, 'Not found.', {
        code: 'NOT_FOUND',
      })
    }

    const body = (await req.json().catch(() => ({}))) as { body?: unknown }
    const text = typeof body.body === 'string' ? body.body.trim() : ''

    if (!text) {
      return jsonFail(400, 'Comment cannot be empty.', {
        code: 'EMPTY_COMMENT',
      })
    }

    if (text.length > 500) {
      return jsonFail(400, 'Comment too long (max 500).', {
        code: 'COMMENT_TOO_LONG',
      })
    }

    const created = await prisma.mediaComment.create({
      data: {
        mediaId: id,
        userId: user.id,
        body: text,
      },
      include: {
        user: {
          select: {
            id: true,
            clientProfile: {
              select: {
                firstName: true,
                lastName: true,
                avatarUrl: true,
              },
            },
            professionalProfile: {
              select: {
                businessName: true,
                avatarUrl: true,
              },
            },
          },
        },
      },
    })

    const commentsCount = await prisma.mediaComment.count({
      where: { mediaId: id },
    })

    return jsonOk(
      {
        comment: mapLooksCommentToDto(created),
        commentsCount,
      },
      201,
    )
  } catch (e) {
    console.error('POST /api/looks/[id]/comments error', e)
    return jsonFail(500, 'Couldn’t post that. Try again.', {
      code: 'INTERNAL',
    })
  }
}