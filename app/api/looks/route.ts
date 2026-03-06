// app/api/looks/route.ts
import { prisma } from '@/lib/prisma'
import { jsonFail, jsonOk, pickInt, pickString } from '@/app/api/_utils'
import { getCurrentUser } from '@/lib/currentUser'
import { Prisma, MediaVisibility, Role } from '@prisma/client'
import { renderMediaUrls } from '@/lib/media/renderUrls'

export const dynamic = 'force-dynamic'

const SPOTLIGHT_SLUG = 'spotlight'
const SPOTLIGHT_HELPFUL_THRESHOLD = 25
const QMODE = 'insensitive' as const

function hasStoragePointers(m: { storageBucket: string | null; storagePath: string | null }) {
  return Boolean(m.storageBucket && m.storagePath)
}

function pickPrimaryService(
  services:
    | Array<{ service: { id: string; name: string; category?: { name: string; slug: string } | null } }>
    | null
    | undefined,
) {
  const first = services?.find((s) => s?.service)?.service
  if (!first) return null
  return {
    id: first.id,
    name: first.name,
    category: first.category?.name ?? null,
    categorySlug: first.category?.slug ?? null,
  }
}

export async function GET(req: Request) {
  try {
    const user = await getCurrentUser().catch(() => null)

    const { searchParams } = new URL(req.url)
    const limit = Math.min(pickInt(searchParams.get('limit')) ?? 12, 50)

    // category is a SLUG from the UI
    const rawCategorySlug = pickString(searchParams.get('category'))
    const q = pickString(searchParams.get('q'))

    const isSpotlight = rawCategorySlug === SPOTLIGHT_SLUG
    const categorySlug = isSpotlight ? null : rawCategorySlug

    const and: Prisma.MediaAssetWhereInput[] = []

    if (isSpotlight) {
      and.push(
        { reviewId: { not: null } },
        { uploadedByRole: Role.CLIENT },
        { review: { is: { helpfulCount: { gte: SPOTLIGHT_HELPFUL_THRESHOLD } } } },
      )
    } else {
      and.push({ OR: [{ isEligibleForLooks: true }, { isFeaturedInPortfolio: true }] })

      if (categorySlug) {
        and.push({
          services: {
            some: { service: { category: { is: { slug: categorySlug } } } },
          },
        })
      }
    }

    if (q) {
      and.push({
        OR: [
          { caption: { contains: q, mode: QMODE } },
          { professional: { businessName: { contains: q, mode: QMODE } } },
          { professional: { handle: { contains: q, mode: QMODE } } },
        ],
      })
    }

    const where: Prisma.MediaAssetWhereInput = {
      visibility: MediaVisibility.PUBLIC,
      ...(and.length ? { AND: and } : {}),
    }

    const orderBy: Prisma.MediaAssetOrderByWithRelationInput | Prisma.MediaAssetOrderByWithRelationInput[] = isSpotlight
      ? [{ review: { helpfulCount: 'desc' } }, { createdAt: 'desc' }]
      : { createdAt: 'desc' }

    const items = await prisma.mediaAsset.findMany({
      where,
      orderBy,
      take: limit,
      select: {
        id: true,

        // may be null on older rows
        url: true,
        thumbUrl: true,
        storageBucket: true,
        storagePath: true,
        thumbBucket: true,
        thumbPath: true,

        mediaType: true,
        caption: true,
        createdAt: true,
        uploadedByRole: true,
        uploadedByUserId: true,
        reviewId: true,

        // ✅ review metadata for Review Spotlight UI
        review: {
          select: {
            helpfulCount: true,
            rating: true,
            headline: true,
          },
        },

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

    const payload = (
      await Promise.all(
        items.map(async (m) => {
          // Render-safe URL fallback (especially important for Spotlight review media)
          let renderUrl = (m.url ?? '').trim()
          let renderThumbUrl = (m.thumbUrl ?? '').trim() || null

          if ((!renderUrl || !renderThumbUrl) && hasStoragePointers(m)) {
            const rendered = await renderMediaUrls({
              storageBucket: m.storageBucket!,
              storagePath: m.storagePath!,
              thumbBucket: m.thumbBucket ?? null,
              thumbPath: m.thumbPath ?? null,
              url: m.url ?? null,
              thumbUrl: m.thumbUrl ?? null,
            })

            renderUrl = (rendered.renderUrl ?? renderUrl ?? '').trim()
            renderThumbUrl = (rendered.renderThumbUrl ?? renderThumbUrl ?? null)
              ? (rendered.renderThumbUrl ?? renderThumbUrl)
              : null
          }

          // If still no URL, drop it (prevents blank tiles)
          if (!renderUrl) return null

          const primaryService = pickPrimaryService(m.services)
          const serviceIds = (m.services ?? [])
            .map((s) => s.service?.id ?? null)
            .filter((id): id is string => typeof id === 'string' && id.length > 0)

          return {
            id: m.id,
            url: renderUrl,
            thumbUrl: renderThumbUrl,
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

            _count: m._count,
            viewerLiked: user ? likedSet.has(m.id) : false,

            uploadedByRole: m.uploadedByRole ?? null,
            reviewId: m.reviewId ?? null,

            // ✅ feed fields for “Review Spotlight”
            reviewHelpfulCount: m.review?.helpfulCount ?? null,
            reviewRating: m.review?.rating ?? null,
            reviewHeadline: m.review?.headline ?? null,
          }
        }),
      )
    ).filter((x): x is NonNullable<typeof x> => Boolean(x))

    return jsonOk({ ok: true, items: payload })
  } catch (e) {
    console.error('GET /api/looks error', e)
    return jsonFail(500, 'Failed to load looks.')
  }
}