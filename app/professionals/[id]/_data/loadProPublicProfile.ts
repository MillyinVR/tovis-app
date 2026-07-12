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
  LookPostStatus,
  LookPostVisibility,
  ModerationStatus,
  Role,
  type VerificationStatus,
} from '@prisma/client'

import { loadClientLinkViewer } from '@/lib/clientVisibility'
import {
  listPublicAcceptedMethods,
  publicPaymentMethodsSelect,
  type PublicAcceptedMethod,
} from '@/lib/payments/publicAcceptedMethods'
import { prisma } from '@/lib/prisma'
import type { ClientLinkViewer } from '@/lib/profiles/profileHrefs'
import { canViewerSeeProPublicSurface } from '@/lib/proTrustState'
import {
  mapPublicOfferingsToDtos,
  mapPublicPortfolioTilesToDtos,
  mapPublicProfileHeaderToDto,
  mapPublicProfileStatsToDto,
  mapPublicReviewsToDtos,
  renderPublicProfileCoverUrl,
  type PublicOfferingDto,
  type PublicPortfolioTileDto,
  type PublicProfileHeaderDto,
  type PublicProfileStatsDto,
  type PublicReviewDto,
} from '@/lib/profiles/publicProfileMappers'
import {
  PUBLIC_PROFILE_LIMITS,
  publicOfferingSelect,
  publicPortfolioLookSelect,
  publicProfessionalProfileSelect,
  publicReviewSelect,
} from '@/lib/profiles/publicProfileSelects'
import { visibleReviewsWhere } from '@/lib/reviews/visibility'

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
  acceptedPayments: PublicAcceptedMethod[]
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
    followerCount,
    offeringRows,
    favoriteRow,
    paymentSettingsRow,
    coverUrl,
  ] = await Promise.all([
    prisma.review.aggregate({
      where: { professionalId: profileRow.id, ...visibleReviewsWhere },
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

    prisma.proFollow.count({
      where: { professionalId: profileRow.id },
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

    prisma.professionalPaymentSettings.findUnique({
      where: { professionalId: profileRow.id },
      select: publicPaymentMethodsSelect,
    }),

    // §18 cover banner: render the pro-chosen cover photo's display URL (null
    // when unset → branded fallback). Parallel with the other base aggregates.
    renderPublicProfileCoverUrl(profileRow),
  ])

  const reviewCount = reviewStats._count._all
  const averageRating = reviewStats._avg.rating ?? null

  // Which of this pro's offered services the viewer has saved (client-only).
  // Keyed on the underlying serviceId, matching the /services/[id]/favorite API.
  const favoritedServiceIds = new Set<string>()
  if (viewerUserId && offeringRows.length > 0) {
    const serviceIds = [...new Set(offeringRows.map((o) => o.serviceId))]
    const savedRows = await prisma.serviceFavorite.findMany({
      where: { userId: viewerUserId, serviceId: { in: serviceIds } },
      select: { serviceId: true },
    })
    for (const row of savedRows) favoritedServiceIds.add(row.serviceId)
  }

  return {
    kind: 'ok',
    base: {
      professionalId: profileRow.id,
      verificationStatus: profileRow.verificationStatus,
      header: mapPublicProfileHeaderToDto(profileRow, coverUrl),
      offerings: mapPublicOfferingsToDtos(offeringRows, favoritedServiceIds),
      acceptedPayments: listPublicAcceptedMethods(paymentSettingsRow),
      stats: mapPublicProfileStatsToDto({
        offerings: offeringRows,
        completedBookingCount,
        favoritesCount,
        reviewCount,
        averageRating,
        followerCount,
      }),
      isFavoritedByMe: Boolean(favoriteRow),
      viewerUserId,
    },
  }
}

export async function loadPortfolioTiles(
  professionalId: string,
): Promise<PublicPortfolioTileDto[]> {
  // §19c — the grid now reads the pro's own `LookPost`s (the unified public-content
  // atom the feed/search/boards also read), not `MediaAsset.isFeaturedInPortfolio`.
  // Since §19b featuring publishes a look and un-featuring retracts it, this yields
  // the same set of tiles — except the moderation gate below now (correctly) hides
  // anything not yet APPROVED, so nothing renders public pre-approval (§19 divergence
  // a). Each tile still renders from the look's `primaryMediaAsset`, so the tile DTO
  // is unchanged.
  //
  // Read the looks through the owner relation (`professionalProfile.lookPosts`), not
  // a top-level looks discovery query, so it's an owner-scoped read (this one pro's
  // rows) — not cross-tenant looks discovery — and mirrors the `/u/[handle]` client
  // grid's `clientProfile.authoredLooks` shape (§19c). See the tenant-aware-discovery
  // guard: owner-relation reads are tenant-safe by construction.
  const row = await prisma.professionalProfile.findUnique({
    where: { id: professionalId },
    select: {
      lookPosts: {
        where: {
          // Pro-authored looks only — a client-authored look points at this pro but
          // belongs on the client's own /u/[handle] grid, not the pro's portfolio.
          clientAuthorId: null,
          status: LookPostStatus.PUBLISHED,
          moderationStatus: ModerationStatus.APPROVED,
          visibility: LookPostVisibility.PUBLIC,
          removedAt: null,
        },
        orderBy: { publishedAt: 'desc' },
        take: PUBLIC_PROFILE_LIMITS.portfolioTiles,
        select: publicPortfolioLookSelect,
      },
    },
  })

  if (!row) return []

  return mapPublicPortfolioTilesToDtos(
    row.lookPosts.map((look) => ({
      lookId: look.id,
      asset: look.primaryMediaAsset,
    })),
  )
}

export async function loadReviewsForUi(args: {
  professionalId: string
  viewerUserId: string | null
  clientLinkViewer: ClientLinkViewer
}): Promise<PublicReviewDto[]> {
  const reviews = await prisma.review.findMany({
    where: { professionalId: args.professionalId, ...visibleReviewsWhere },
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
  // Handle-free payment method labels the pro accepts (e.g. "Cash", "Venmo").
  // Empty when the pro has no saved payment settings.
  acceptedPayments: string[]
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
    acceptedPayments: base.acceptedPayments.map((method) => method.label),
    portfolioTiles,
    reviews,
    isFavoritedByMe: base.isFavoritedByMe,
  }
}
