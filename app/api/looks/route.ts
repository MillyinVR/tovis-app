// app/api/looks/route.ts
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getCurrentUser } from '@/lib/currentUser'

function toInt(value: string | null, fallback: number) {
  const n = Number(value)
  return Number.isFinite(n) ? n : fallback
}

function pickPrimaryService(
  services:
    | Array<{ service: { id: string; name: string; category?: { name: string } | null } | null }>
    | null
    | undefined,
) {
  const first = services?.find((s) => s?.service)?.service
  if (!first) return null
  return { id: first.id, name: first.name, category: first.category?.name ?? null }
}

function pickString(v: string | null) {
  const s = (v ?? '').trim()
  return s.length ? s : null
}

export async function GET(req: Request) {
  try {
    const user = await getCurrentUser().catch(() => null)

    const { searchParams } = new URL(req.url)
    const limit = Math.min(toInt(searchParams.get('limit'), 12) || 12, 50)

    const category = pickString(searchParams.get('category'))
    const q = pickString(searchParams.get('q'))

    const items = await prisma.mediaAsset.findMany({
      where: {
        visibility: 'PUBLIC',
        OR: [{ isEligibleForLooks: true }, { isFeaturedInPortfolio: true }],

        ...(q
          ? {
              OR: [
                { caption: { contains: q, mode: 'insensitive' } },
                { professional: { businessName: { contains: q, mode: 'insensitive' } } },
                { professional: { handle: { contains: q, mode: 'insensitive' } } },
              ],
            }
          : {}),

        ...(category
          ? {
              services: {
                some: { service: { category: { is: { name: category } } } },
              },
            }
          : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
      select: {
        id: true,
        url: true,
        thumbUrl: true,
        mediaType: true,
        caption: true,
        createdAt: true,
        uploadedByRole: true,
        uploadedByUserId: true,
        reviewId: true,
        professional: {
          select: {
            id: true,
            businessName: true,
            handle: true,
            avatarUrl: true,
            professionType: true,
            location: true,
          },
        },
        services: {
          select: {
            service: {
              select: { id: true, name: true, category: { select: { name: true } } },
            },
          },
        },
        _count: { select: { likes: true, comments: true } },
      },
    })

    let likedSet = new Set<string>()
    if (user && items.length) {
      const likes = await prisma.mediaLike.findMany({
        where: { userId: user.id, mediaId: { in: items.map((i) => i.id) } },
        select: { mediaId: true },
      })
      likedSet = new Set(likes.map((l) => l.mediaId))
    }

    const payload = items.map((m) => {
      const primaryService = pickPrimaryService(m.services)
      const serviceIds = (m.services ?? []).map((s) => s?.service?.id).filter(Boolean) as string[]

      return {
        id: m.id,
        url: m.url,
        thumbUrl: m.thumbUrl ?? null,
        mediaType: m.mediaType,
        caption: m.caption ?? null,
        createdAt: m.createdAt,

        professional: m.professional
          ? {
              id: m.professional.id,
              businessName: m.professional.businessName ?? null,
              handle: m.professional.handle ?? null,
              avatarUrl: m.professional.avatarUrl ?? null,
              professionType: m.professional.professionType ?? null,
              location: m.professional.location ?? null,
            }
          : null,

        serviceId: primaryService?.id ?? null,
        serviceName: primaryService?.name ?? null,
        category: primaryService?.category ?? null,
        serviceIds,

        _count: m._count,
        viewerLiked: user ? likedSet.has(m.id) : false,

        uploadedByRole: m.uploadedByRole ?? null,
        reviewId: m.reviewId ?? null,
      }
    })

    return NextResponse.json({ items: payload })
  } catch (e) {
    console.error('GET /api/looks error', e)
    return NextResponse.json({ error: 'Failed to load looks' }, { status: 500 })
  }
}
