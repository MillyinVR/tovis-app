import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getCurrentUser } from '@/lib/currentUser'

type MediaType = 'IMAGE' | 'VIDEO'
type MediaVisibility = 'PUBLIC' | 'PRIVATE'

type CreateMediaBody = {
  url?: unknown
  caption?: unknown
  mediaType?: unknown
  visibility?: unknown
  isFeaturedInPortfolio?: unknown
  isEligibleForLooks?: unknown
  serviceIds?: unknown
}

export async function POST(req: Request) {
  try {
    const user = await getCurrentUser()
    if (!user || user.role !== 'PRO' || !user.professionalProfile) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = (await req.json().catch(() => ({}))) as CreateMediaBody

    const url = typeof body.url === 'string' ? body.url.trim() : ''
    const caption = typeof body.caption === 'string' ? body.caption.trim() : null

    const mediaType: MediaType = body.mediaType === 'VIDEO' ? 'VIDEO' : 'IMAGE'
    const visibility: MediaVisibility =
      body.visibility === 'PRIVATE' ? 'PRIVATE' : 'PUBLIC'

    const isFeaturedInPortfolio = Boolean(body.isFeaturedInPortfolio)
    const isEligibleForLooks = Boolean(body.isEligibleForLooks)

    const serviceIds: string[] = Array.isArray(body.serviceIds)
      ? (body.serviceIds as unknown[]).filter((x: unknown): x is string => typeof x === 'string')
      : []

    if (!url) return NextResponse.json({ error: 'Missing url' }, { status: 400 })
    if (serviceIds.length === 0) {
      return NextResponse.json(
        { error: 'Select at least one service tag.' },
        { status: 400 },
      )
    }

    // validate services exist
    const services = await prisma.service.findMany({
      where: { id: { in: serviceIds } },
      select: { id: true },
    })

    if (services.length !== serviceIds.length) {
      return NextResponse.json(
        { error: 'One or more serviceIds are invalid.' },
        { status: 400 },
      )
    }

    const proId = user.professionalProfile.id

    const created = await prisma.mediaAsset.create({
      data: {
        professionalId: proId,
        url,
        caption: caption || null,
        mediaType,
        visibility,
        isFeaturedInPortfolio,
        isEligibleForLooks,
        services: {
          createMany: {
            data: serviceIds.map((serviceId: string) => ({ serviceId })),
            skipDuplicates: true,
          },
        },
      },
      include: {
        services: { include: { service: true } },
      },
    })

    return NextResponse.json({ media: created }, { status: 201 })
  } catch (e) {
    console.error('POST /api/pro/media error', e)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
