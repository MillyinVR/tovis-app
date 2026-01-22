// app/api/looks/route.ts
import { prisma } from '@/lib/prisma'
import { jsonFail, jsonOk, pickInt, pickString } from '@/app/api/_utils'
import { getCurrentUser } from '@/lib/currentUser'

function pickPrimaryService(
  services:
    | Array<{ service: { id: string; name: string; category?: { name: string; slug: string } | null } | null }>
    | null
    | undefined,
) {
  const first = services?.find((s) => s?.service)?.service
  if (!first) return null
  return { id: first.id, name: first.name, category: first.category?.name ?? null, categorySlug: first.category?.slug ?? null }
}

export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  try {
    const user = await getCurrentUser().catch(() => null)

    const { searchParams } = new URL(req.url)
    const limit = Math.min(pickInt(searchParams.get('limit')) ?? 12, 50)

    // ✅ category is a SLUG from the UI
    const categorySlug = pickString(searchParams.get('category'))
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

        ...(categorySlug
          ? {
              services: {
                some: { service: { category: { is: { slug: categorySlug } } } },
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
              select: { id: true, name: true, category: { select: { name: true, slug: true } } },
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
        createdAt: m.createdAt.toISOString(),

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

        // ✅ client expects _count
        _count: m._count,

        viewerLiked: user ? likedSet.has(m.id) : false,

        uploadedByRole: m.uploadedByRole ?? null,
        reviewId: m.reviewId ?? null,
      }
    })

    return jsonOk({ ok: true, items: payload })
  } catch (e) {
    console.error('GET /api/looks error', e)
    return jsonFail(500, 'Failed to load looks.')
  }
}
