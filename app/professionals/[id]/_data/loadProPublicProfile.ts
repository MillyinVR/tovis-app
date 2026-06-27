// app/professionals/[id]/_data/loadProPublicProfile.ts
//
// Single source of truth for the PUBLIC professional profile surface. Composes
// the base profile (publicProfessionalProfileSelect) + aggregate stats +
// offerings, and exposes the portfolio/review sub-loaders. Used by BOTH the
// server-rendered profile page (which lazily loads the portfolio/reviews tabs)
// and the native read endpoint (which eagerly loads everything). The visibility
// gate (canViewerSeeProPublicSurface) lives here so a pending-verification pro is
// never exposed through either surface.
import 'server-only'

import {
  BookingStatus,
  MediaVisibility,
  Role,
  type VerificationStatus,
} from '@prisma/client'

import { loadClientLinkViewer } from '@/lib/clientVisibility'
import { prisma } from '@/lib/prisma'
import type { ClientLinkViewer } from '@/lib/profiles/profileHrefs'
import { canViewerSeeProPublicSurface } from '@/lib/proTrustState'
import {
  mapPublicOfferingsToDtos,
  mapPublicPortfolioTilesToDtos,
  mapPublicProfileHeaderToDto,
  mapPublicProfileStatsToDto,
  mapPublicReviewsToDtos,
  type PublicOfferingDto,
  type PublicPortfolioTileDto,
  type PublicProfileHeaderDto,
  type PublicProfileStatsDto,
  type PublicReviewDto,
} from '@/lib/profiles/publicProfileMappers'
import {
  PUBLIC_PROFILE_LIMITS,
  publicOfferingSelect,
  publicPortfolioMediaAssetSelect,
  publicProfessionalProfileSelect,
  publicReviewSelect,
} from '@/lib/profiles/publicProfileSelects'

type Viewer = {
  id: string
  role: Role
  professionalProfile?: { id: string } | null
} | null

export type ProPublicProfileBase = {
  professionalId: string
  verificationStatus: VerificationStatus
  header: PublicProfileHeaderDto
  stats: PublicProfileStatsDto
  offerings: PublicOfferingDto[]
  isFavoritedByMe: boolean
  viewerUserId: string | null
}

/**
 * Discriminated outcome so callers can distinguish a missing profile (→ 404)
 * from a profile the viewer isn't allowed to see yet (→ pending verification).
 */
export type ProPublicProfileBaseResult =
  | { kind: 'not-found' }
  | { kind: 'not-viewable' }
  | { kind: 'ok'; base: ProPublicProfileBase }

/**
 * Loads + gates the base public professional profile (profile + stats +
 * offerings). The visibility gate (canViewerSeeProPublicSurface) is enforced
 * here so a pending-verification pro is never exposed.
 */
export async function loadProPublicProfileBase(args: {
  professionalId: string
  viewer: Viewer
}): Promise<ProPublicProfileBaseResult> {
  const { professionalId, viewer } = args

  const profileRow = await prisma.professionalProfile.findUnique({
    where: { id: professionalId },
    select: publicProfessionalProfileSelect,
  })

  if (!profileRow) return { kind: 'not-found' }

  const canViewPublicSurface = canViewerSeeProPublicSurface({
    viewerRole: viewer?.role ?? null,
    viewerProfessionalId: viewer?.professionalProfile?.id ?? null,
    professionalId: profileRow.id,
    verificationStatus: profileRow.verificationStatus,
  })

  if (!canViewPublicSurface) return { kind: 'not-viewable' }

  const viewerUserId = viewer?.role === Role.CLIENT ? viewer.id : null

  const [
    reviewStats,
    favoritesCount,
    completedBookingCount,
    offeringRows,
    favoriteRow,
  ] = await Promise.all([
    prisma.review.aggregate({
      where: { professionalId: profileRow.id },
      _count: { _all: true },
      _avg: { rating: true },
    }),

    prisma.professionalFavorite.count({
      where: { professionalId: profileRow.id },
    }),

    prisma.booking.count({
      where: {
        professionalId: profileRow.id,
        status: BookingStatus.COMPLETED,
      },
    }),

    prisma.professionalServiceOffering.findMany({
      where: {
        professionalId: profileRow.id,
        isActive: true,
      },
      orderBy: { createdAt: 'asc' },
      take: PUBLIC_PROFILE_LIMITS.offerings,
      select: publicOfferingSelect,
    }),

    viewerUserId
      ? prisma.professionalFavorite.findUnique({
          where: {
            professionalId_userId: {
              professionalId: profileRow.id,
              userId: viewerUserId,
            },
          },
          select: { id: true },
        })
      : Promise.resolve(null),
  ])

  const reviewCount = reviewStats._count._all
  const averageRating = reviewStats._avg.rating ?? null

  return {
    kind: 'ok',
    base: {
      professionalId: profileRow.id,
      verificationStatus: profileRow.verificationStatus,
      header: mapPublicProfileHeaderToDto(profileRow),
      offerings: mapPublicOfferingsToDtos(offeringRows),
      stats: mapPublicProfileStatsToDto({
        offerings: offeringRows,
        completedBookingCount,
        favoritesCount,
        reviewCount,
        averageRating,
      }),
      isFavoritedByMe: Boolean(favoriteRow),
      viewerUserId,
    },
  }
}

export async function loadPortfolioTiles(
  professionalId: string,
): Promise<PublicPortfolioTileDto[]> {
  const portfolioRows = await prisma.mediaAsset.findMany({
    where: {
      professionalId,
      visibility: MediaVisibility.PUBLIC,
      isFeaturedInPortfolio: true,
    },
    orderBy: { createdAt: 'desc' },
    take: PUBLIC_PROFILE_LIMITS.portfolioTiles,
    select: publicPortfolioMediaAssetSelect,
  })

  return mapPublicPortfolioTilesToDtos(portfolioRows)
}

export async function loadReviewsForUi(args: {
  professionalId: string
  viewerUserId: string | null
  clientLinkViewer: ClientLinkViewer
}): Promise<PublicReviewDto[]> {
  const reviews = await prisma.review.findMany({
    where: { professionalId: args.professionalId },
    orderBy: { createdAt: 'desc' },
    take: PUBLIC_PROFILE_LIMITS.reviews,
    select: publicReviewSelect,
  })

  if (!args.viewerUserId || reviews.length === 0) {
    return mapPublicReviewsToDtos({
      reviews,
      clientLinkViewer: args.clientLinkViewer,
    })
  }

  const helpfulRows = await prisma.reviewHelpful.findMany({
    where: {
      userId: args.viewerUserId,
      reviewId: {
        in: reviews.map((review) => review.id),
      },
    },
    select: { reviewId: true },
  })

  return mapPublicReviewsToDtos({
    reviews,
    viewerHelpfulReviewIds: new Set(helpfulRows.map((row) => row.reviewId)),
    clientLinkViewer: args.clientLinkViewer,
  })
}

export type ProPublicProfileDto = {
  professionalId: string
  header: PublicProfileHeaderDto
  stats: PublicProfileStatsDto
  offerings: PublicOfferingDto[]
  portfolioTiles: PublicPortfolioTileDto[]
  reviews: PublicReviewDto[]
  isFavoritedByMe: boolean
}

/**
 * Eager full-profile load for the native read endpoint: base profile + stats +
 * offerings + portfolio tiles + reviews, all gated and JSON-safe. Returns null
 * when the profile is missing or not viewable.
 */
export async function loadProPublicProfile(args: {
  professionalId: string
  viewer: Viewer
}): Promise<ProPublicProfileDto | null> {
  const result = await loadProPublicProfileBase(args)
  if (result.kind !== 'ok') return null

  const { base } = result

  const [portfolioTiles, reviews] = await Promise.all([
    loadPortfolioTiles(base.professionalId),
    loadReviewsForUi({
      professionalId: base.professionalId,
      viewerUserId: base.viewerUserId,
      clientLinkViewer: await loadClientLinkViewer(args.viewer),
    }),
  ])

  return {
    professionalId: base.professionalId,
    header: base.header,
    stats: base.stats,
    offerings: base.offerings,
    portfolioTiles,
    reviews,
    isFavoritedByMe: base.isFavoritedByMe,
  }
}
