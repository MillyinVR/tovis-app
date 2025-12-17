// app/api/looks/[id]/like/route.ts
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getCurrentUser } from '@/lib/currentUser'

async function requirePublicEligibleLook(id: string) {
  const media = await prisma.mediaAsset.findUnique({
    where: { id },
    select: { id: true, visibility: true, isEligibleForLooks: true },
  })

  if (!media || media.visibility !== 'PUBLIC' || !media.isEligibleForLooks) {
    return null
  }
  return media
}

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser().catch(() => null)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  if (!id) return NextResponse.json({ error: 'Missing media id' }, { status: 400 })

  const ok = await requirePublicEligibleLook(id)
  if (!ok) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  try {
    // POST = like (idempotent)
    await prisma.mediaLike.create({
      data: { mediaId: id, userId: user.id },
    })
  } catch (e: any) {
    // If it already exists, Prisma will throw (unique constraint). That’s fine.
    // We treat it as "already liked".
    // P2002 = Unique constraint failed
    if (e?.code !== 'P2002') {
      console.error('POST /api/looks/[id]/like error', e)
      return NextResponse.json({ error: 'Failed to like' }, { status: 500 })
    }
  }

  const likes = await prisma.mediaLike.count({ where: { mediaId: id } })
  return NextResponse.json({ liked: true, likes })
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser().catch(() => null)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  if (!id) return NextResponse.json({ error: 'Missing media id' }, { status: 400 })

  const ok = await requirePublicEligibleLook(id)
  if (!ok) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // DELETE = unlike (idempotent)
  await prisma.mediaLike.deleteMany({
    where: { mediaId: id, userId: user.id },
  })

  const likes = await prisma.mediaLike.count({ where: { mediaId: id } })
  return NextResponse.json({ liked: false, likes })
}
