// app/api/looks/[id]/comments/route.ts
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getCurrentUser } from '@/lib/currentUser'

async function requirePublicEligibleLook(id: string) {
  const media = await prisma.mediaAsset.findUnique({
    where: { id },
    select: { id: true, visibility: true, isEligibleForLooks: true },
  })
  if (!media || media.visibility !== 'PUBLIC' || !media.isEligibleForLooks) return null
  return media
}

function normalizeUser(u: {
  id: string
  clientProfile: { firstName: string | null; lastName: string | null; avatarUrl: string | null } | null
  professionalProfile: { businessName: string | null; avatarUrl: string | null } | null
}) {
  const cp = u.clientProfile
  const pp = u.professionalProfile

  const displayName =
    (cp ? `${cp.firstName ?? ''} ${cp.lastName ?? ''}`.trim() : '') ||
    (pp?.businessName ?? '') ||
    'User'

  const avatarUrl = cp?.avatarUrl ?? pp?.avatarUrl ?? null

  return { id: u.id, displayName, avatarUrl }
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params
    if (!id) return NextResponse.json({ error: 'Missing media id' }, { status: 400 })

    const ok = await requirePublicEligibleLook(id)
    if (!ok) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    const { searchParams } = new URL(req.url)
    const limit = Math.min(parseInt(searchParams.get('limit') || '30', 10) || 30, 100)

    const rows = await prisma.mediaComment.findMany({
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
    })

    const commentsCount = await prisma.mediaComment.count({ where: { mediaId: id } })

    const comments = rows.map((c) => ({
      id: c.id,
      body: c.body,
      createdAt: c.createdAt.toISOString(),
      user: normalizeUser(c.user),
    }))

    return NextResponse.json({ comments, commentsCount }, { status: 200 })
  } catch (e) {
    console.error('GET /api/looks/[id]/comments error', e)
    return NextResponse.json({ error: 'Failed to load comments' }, { status: 500 })
  }
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser().catch(() => null)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  if (!id) return NextResponse.json({ error: 'Missing media id' }, { status: 400 })

  const ok = await requirePublicEligibleLook(id)
  if (!ok) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const body = await req.json().catch(() => null)
  const text = String(body?.body ?? '').trim()

  if (!text) return NextResponse.json({ error: 'Comment cannot be empty' }, { status: 400 })
  if (text.length > 500) return NextResponse.json({ error: 'Comment too long (max 500)' }, { status: 400 })

  // Create comment
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

  // Return the created comment normalized so the client can add it immediately
  const comment = {
    id: created.id,
    body: created.body,
    createdAt: created.createdAt.toISOString(),
    user: normalizeUser(created.user),
  }

  return NextResponse.json({ ok: true, comment, commentsCount }, { status: 200 })
}
