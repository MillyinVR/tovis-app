// app/api/pro/media/[id]/toggle-portfolio/route.ts
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getCurrentUser } from '@/lib/currentUser'

type Body = {
  value?: unknown // boolean optional
}

export async function POST(
  req: Request,
  props: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await props.params

    const user = await getCurrentUser()
    if (!user || user.role !== 'PRO' || !user.professionalProfile) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const media = await prisma.mediaAsset.findUnique({
      where: { id },
      select: {
        id: true,
        professionalId: true,
        isFeaturedInPortfolio: true,
      },
    })

    if (!media) {
      return NextResponse.json({ error: 'Media not found.' }, { status: 404 })
    }

    if (media.professionalId !== user.professionalProfile.id) {
      return NextResponse.json({ error: 'Forbidden.' }, { status: 403 })
    }

    const body = (await req.json().catch(() => ({}))) as Body

    let nextValue: boolean
    if (body.value === undefined) {
      nextValue = !media.isFeaturedInPortfolio // toggle fallback
    } else if (typeof body.value === 'boolean') {
      nextValue = body.value
    } else {
      return NextResponse.json(
        { error: 'value must be boolean if provided.' },
        { status: 400 },
      )
    }

    const updated = await prisma.mediaAsset.update({
      where: { id },
      data: { isFeaturedInPortfolio: nextValue },
      select: {
        id: true,
        isFeaturedInPortfolio: true,
      },
    })

    return NextResponse.json({ media: updated }, { status: 200 })
  } catch (e) {
    console.error('POST /api/pro/media/[id]/toggle-portfolio error', e)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
