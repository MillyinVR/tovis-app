// app/api/looks/[id]/comments/route.ts
import { prisma } from '@/lib/prisma'
import { jsonFail, jsonOk, pickString, requireUser, pickInt } from '@/app/api/_utils'

export const dynamic = 'force-dynamic'

async function requirePublicEligibleLook(id: string) {
  const media = await prisma.mediaAsset.findUnique({
    where: { id },
    select: { id: true, visibility: true, isEligibleForLooks: true, isFeaturedInPortfolio: true },
  })

  if (!media || media.visibility !== 'PUBLIC') return null
  const eligible = Boolean(media.isEligibleForLooks || media.isFeaturedInPortfolio)
  if (!eligible) return null

  return media
}

function normalizeUser(u: {
  id: string
  clientProfile: { firstName: string; lastName: string; avatarUrl: string | null } | null
  professionalProfile: { businessName: string | null; avatarUrl: string | null } | null
}) {
  const cp = u.clientProfile
  const pp = u.professionalProfile
  const displayName = (`${cp?.firstName ?? ''} ${cp?.lastName ?? ''}`.trim() || pp?.businessName || 'User').trim()
  const avatarUrl = cp?.avatarUrl ?? pp?.avatarUrl ?? null
  return { id: u.id, displayName, avatarUrl }
}

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const raw = await params
    const id = pickString(raw?.id)
    if (!id) return jsonFail(400, 'Missing media id.')

    const ok = await requirePublicEligibleLook(id)
    if (!ok) return jsonFail(404, 'Not found.')

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
              clientProfile: { select: { firstName: true, lastName: true, avatarUrl: true } },
              professionalProfile: { select: { businessName: true, avatarUrl: true } },
            },
          },
        },
      }),
      prisma.mediaComment.count({ where: { mediaId: id } }),
    ])

    return jsonOk({
      ok: true,
      comments: rows.map((c) => ({
        id: c.id,
        body: c.body,
        createdAt: c.createdAt.toISOString(),
        user: normalizeUser(c.user),
      })),
      commentsCount,
    })
  } catch (e) {
    console.error('GET /api/looks/[id]/comments error', e)
    return jsonFail(500, 'Couldn’t load comments. Try again.')
  }
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireUser()
    if (auth.res) return auth.res
    const user = auth.user

    const raw = await params
    const id = pickString(raw?.id)
    if (!id) return jsonFail(400, 'Missing media id.')

    const ok = await requirePublicEligibleLook(id)
    if (!ok) return jsonFail(404, 'Not found.')

    const body = (await req.json().catch(() => ({}))) as { body?: unknown }
    const text = typeof body.body === 'string' ? body.body.trim() : ''

    if (!text) return jsonFail(400, 'Comment cannot be empty.')
    if (text.length > 500) return jsonFail(400, 'Comment too long (max 500).')

    const created = await prisma.mediaComment.create({
      data: { mediaId: id, userId: user.id, body: text },
      include: {
        user: {
          select: {
            id: true,
            clientProfile: { select: { firstName: true, lastName: true, avatarUrl: true } },
            professionalProfile: { select: { businessName: true, avatarUrl: true } },
          },
        },
      },
    })

    const commentsCount = await prisma.mediaComment.count({ where: { mediaId: id } })

    return jsonOk(
      {
        ok: true,
        comment: {
          id: created.id,
          body: created.body,
          createdAt: created.createdAt.toISOString(),
          user: normalizeUser(created.user),
        },
        commentsCount,
      },
      201,
    )
  } catch (e) {
    console.error('POST /api/looks/[id]/comments error', e)
    return jsonFail(500, 'Couldn’t post that. Try again.')
  }
}
