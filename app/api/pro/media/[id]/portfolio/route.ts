import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getCurrentUser } from '@/lib/currentUser'

type Props = { params: Promise<{ id: string }> }

export async function POST(_req: Request, props: Props) {
  try {
    const user = await getCurrentUser()
    if (!user || user.role !== 'PRO' || !user.professionalProfile) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { id } = await props.params
    const proId = user.professionalProfile.id

    const media = await prisma.mediaAsset.findUnique({
      where: { id },
      select: { id: true, professionalId: true, isFeaturedInPortfolio: true },
    })

    if (!media) {
      return NextResponse.json({ error: 'Media not found' }, { status: 404 })
    }
    if (media.professionalId !== proId) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const updated = await prisma.mediaAsset.update({
      where: { id },
      data: { isFeaturedInPortfolio: true },
      select: { id: true, isFeaturedInPortfolio: true },
    })

    return NextResponse.json({ media: updated }, { status: 200 })
  } catch (e) {
    console.error('POST /api/pro/media/[id]/portfolio error', e)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function DELETE(_req: Request, props: Props) {
  try {
    const user = await getCurrentUser()
    if (!user || user.role !== 'PRO' || !user.professionalProfile) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { id } = await props.params
    const proId = user.professionalProfile.id

    const media = await prisma.mediaAsset.findUnique({
      where: { id },
      select: { id: true, professionalId: true, isFeaturedInPortfolio: true },
    })

    if (!media) {
      return NextResponse.json({ error: 'Media not found' }, { status: 404 })
    }
    if (media.professionalId !== proId) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const updated = await prisma.mediaAsset.update({
      where: { id },
      data: { isFeaturedInPortfolio: false },
      select: { id: true, isFeaturedInPortfolio: true },
    })

    return NextResponse.json({ media: updated }, { status: 200 })
  } catch (e) {
    console.error('DELETE /api/pro/media/[id]/portfolio error', e)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
