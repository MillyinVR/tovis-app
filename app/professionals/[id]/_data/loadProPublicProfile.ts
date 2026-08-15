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
  Role,
  type VerificationStatus,
} from '@prisma/client'

import { loadClientLinkViewer } from '@/lib/clientVisibility'
import { proOwnPublicLooksWhere } from '@/lib/looks/selects'
import {
  listPublicAcceptedMethods,
  publicPaymentMethodsSelect,
  type PublicAcceptedMethod,
} from '@/lib/payments/publicAcceptedMethods'
import { prisma } from '@/lib/prisma'
import { exportsDropPlatformMark } from '@/lib/pro/socialExportMark'
import { getProEntitlements } from '@/lib/pro/entitlements'
import type { ClientLinkViewer } from '@/lib/profiles/profileHrefs'
import { canViewerSeeProPublicSurface } from '@/lib/proTrustState'
import {
  formatOfferingLowestPricingLine,
  mapPublicOfferingsToDtos,
  mapPublicPortfolioTilesToDtos,
  mapPublicProfileHeaderToDto,
  mapPublicProfileSignatureToDto,
  mapPublicProfileStatsToDto,
  mapPublicReviewsToDtos,
  renderPublicProfileCoverUrl,
  type PublicOfferingDto,
  type PublicPortfolioTileDto,
  type PublicPortfolioTileEngagement,
  type PublicProfileHeaderDto,
  type PublicProfileSignatureDto,
  type PublicProfileStatsDto,
  type PublicReviewDto,
} from '@/lib/profiles/publicProfileMappers'
import {
  PUBLIC_PROFILE_LIMITS,
  publicOfferingSelect,
  publicPortfolioLookSelect,
  publicProfessionalProfileSelect,
  publicReviewSelect,
  publicSignatureLookSelect,
  type PublicOfferingRow,
} from '@/lib/profiles/publicProfileSelects'
import {
  loadProProfileSignals,
  type ProProfileSignalsDto,
} from '@/lib/profiles/proProfileSignals'
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
  /** Availability line + the brand-new-pro chips. See lib/profiles/proProfileSignals. */
  signals: ProProfileSignalsDto
  /** The pro's chosen Signature asset id; the work loader resolves it to a post. */
  signatureMediaAssetId: string | null
  /**
   * The raw offering rows, kept so the Signature block can resolve its own price
   * line from the SAME rows the services list renders — a second read could
   * disagree about which offerings are active.
   */
  offeringRows: PublicOfferingRow[]
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
  /**
   * Tenant brand display name, for the "New to {brand}" chip. REQUIRED rather
   * than resolved in here: tenant context comes from `next/headers`, and a data
   * loader that reaches for a request scope of its own can only be called from
   * inside one — which is a dependency neither caller can see, and which a unit
   * test cannot satisfy. Both callers resolve it the way their own context
   * allows and hand it down.
   */
  brandName: string
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
    publishedLooksCount,
    offeringRows,
    favoriteRow,
    paymentSettingsRow,
    coverUrl,
    entitlements,
    signals,
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

    // Same set the portfolio grid below renders, unbounded by its tile cap — the
    // pro-owner stats grid reports the true total.
    prisma.lookPost.count({
      where: { professionalId: profileRow.id, ...proOwnPublicLooksWhere },
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

    // Resolved here (not read from ProfessionalSubscription by the mapper) so
    // header.clientExport.dropsPlatformMark mirrors exportsDropPlatformMark on
    // /pro/membership/status without a client-facing caller ever needing the
    // pro-authed endpoint.
    getProEntitlements(profileRow.id),

    // Availability line + brand-new-pro chips. Resolved in the shared base (not
    // per caller) so the page and the native endpoint can never disagree about
    // whether a pro reads as new.
    loadProProfileSignals({
      professionalId: profileRow.id,
      userId: profileRow.userId,
      brandName: args.brandName,
    }),
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
      header: mapPublicProfileHeaderToDto(
        profileRow,
        coverUrl,
        exportsDropPlatformMark(entitlements),
      ),
      offerings: mapPublicOfferingsToDtos(offeringRows, favoritedServiceIds),
      acceptedPayments: listPublicAcceptedMethods(paymentSettingsRow),
      stats: mapPublicProfileStatsToDto({
        offerings: offeringRows,
        completedBookingCount,
        favoritesCount,
        reviewCount,
        averageRating,
        followerCount,
        publishedLooksCount,
      }),
      isFavoritedByMe: Boolean(favoriteRow),
      viewerUserId,
      signals,
      signatureMediaAssetId: profileRow.signatureMediaAssetId,
      offeringRows,
    },
  }
}

export type ProPublicProfileWork = {
  /**
   * The pro's chosen Signature post, or null when they haven't picked one (or
   * the look they picked is no longer publicly visible). The grid below EXCLUDES
   * it — the frame promotes that post out of the grid rather than showing it
   * twice.
   */
  signature: PublicProfileSignatureDto | null
  portfolioTiles: PublicPortfolioTileDto[]
}

/**
 * The portfolio grid + the Signature block, in one pass so the two share their
 * "N recreated this" read. Every count on this surface — likes, comments,
 * recreates — comes from at most ONE extra query for the whole grid, never one
 * per tile.
 */
export async function loadProProfileWork(args: {
  professionalId: string
  signatureMediaAssetId: string | null
  offerings: PublicOfferingRow[]
}): Promise<ProPublicProfileWork> {
  const { professionalId, signatureMediaAssetId } = args

  // §19c — the grid reads the pro's own `LookPost`s (the unified public-content
  // atom the feed/search/boards also read), not `MediaAsset.isFeaturedInPortfolio`.
  // Since §19b featuring publishes a look and un-featuring retracts it, this yields
  // the same set of tiles — except the moderation gate below now (correctly) hides
  // anything not yet APPROVED, so nothing renders public pre-approval (§19 divergence
  // a). Each tile still renders from the look's `primaryMediaAsset`.
  //
  // Read the looks through the owner relation (`professionalProfile.lookPosts`), not
  // a top-level looks discovery query, so it's an owner-scoped read (this one pro's
  // rows) — not cross-tenant looks discovery — and mirrors the `/u/[handle]` client
  // grid's `clientProfile.authoredLooks` shape (§19c). See the tenant-aware-discovery
  // guard: owner-relation reads are tenant-safe by construction.
  //
  // The Signature is read as a LookPost under the SAME publicity clause, and
  // scoped to this pro — so a pro who picks a look and then unpublishes it (or
  // whose chosen asset never belonged to them) simply loses the block. A stale
  // FK can never resurrect a retracted post.
  const [row, signatureLook] = await Promise.all([
    prisma.professionalProfile.findUnique({
      where: { id: professionalId },
      select: {
        lookPosts: {
          where: proOwnPublicLooksWhere,
          orderBy: { publishedAt: 'desc' },
          take: PUBLIC_PROFILE_LIMITS.portfolioTiles,
          select: publicPortfolioLookSelect,
        },
      },
    }),
    signatureMediaAssetId
      ? prisma.lookPost.findFirst({
          where: {
            professionalId,
            primaryMediaAssetId: signatureMediaAssetId,
            ...proOwnPublicLooksWhere,
          },
          select: publicSignatureLookSelect,
        })
      : Promise.resolve(null),
  ])

  const gridLooks = (row?.lookPosts ?? []).filter(
    // The promoted post leaves the grid; it is already the largest thing on the
    // page. Without this it renders twice — once big, once small.
    (look) => look.id !== signatureLook?.id,
  )

  const recreationsByLook = await countRecreationsByLook([
    ...gridLooks.map((look) => look.id),
    ...(signatureLook ? [signatureLook.id] : []),
  ])

  const engagementFor = (look: {
    id: string
    likeCount: number
    commentCount: number
  }): PublicPortfolioTileEngagement => ({
    likeCount: look.likeCount,
    commentCount: look.commentCount,
    recreatedCount: recreationsByLook.get(look.id) ?? 0,
  })

  const [portfolioTiles, signature] = await Promise.all([
    mapPublicPortfolioTilesToDtos(
      gridLooks.map((look) => ({
        lookId: look.id,
        asset: look.primaryMediaAsset,
        engagement: engagementFor(look),
      })),
    ),
    signatureLook
      ? mapPublicProfileSignatureToDto({
          lookId: signatureLook.id,
          asset: signatureLook.primaryMediaAsset,
          engagement: engagementFor(signatureLook),
          priceLine: resolveSignaturePriceLine(
            signatureLook.serviceId,
            args.offerings,
          ),
        })
      : Promise.resolve(null),
  ])

  return { signature, portfolioTiles }
}

/**
 * "N recreated this" for a set of looks — ONE grouped read for the whole grid.
 * Same attribution rule as the creator-tier job, the pro's own analytics and the
 * `/u/[handle]` client grid: a non-cancelled booking citing the look as its
 * source. Look-id keyed, so it works unchanged for a pro's own looks.
 */
async function countRecreationsByLook(
  lookIds: string[],
): Promise<Map<string, number>> {
  const byLook = new Map<string, number>()
  if (lookIds.length === 0) return byLook

  const grouped = await prisma.booking.groupBy({
    by: ['sourceLookPostId'],
    where: {
      sourceLookPostId: { in: lookIds },
      status: { not: BookingStatus.CANCELLED },
    },
    _count: { _all: true },
  })

  for (const group of grouped) {
    if (group.sourceLookPostId) {
      byLook.set(group.sourceLookPostId, group._count._all)
    }
  }

  return byLook
}

/**
 * The Signature block's price line: the pro's own ACTIVE offering for the
 * service the look shows, rendered as "Salon: From $250 · 180 min". Null when
 * the look carries no service or the pro doesn't currently offer it — the block
 * then prints no price rather than one it can't stand behind.
 */
function resolveSignaturePriceLine(
  serviceId: string | null,
  offerings: PublicOfferingRow[],
): string | null {
  if (!serviceId) return null

  const offering = offerings.find(
    (row) => row.isActive && row.serviceId === serviceId,
  )

  return offering ? formatOfferingLowestPricingLine(offering) : null
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
  // The pro's chosen Signature post, promoted above the grid. Null when unset —
  // the page is then pure feed, which is the ordinary state.
  signature: PublicProfileSignatureDto | null
  portfolioTiles: PublicPortfolioTileDto[]
  reviews: PublicReviewDto[]
  isFavoritedByMe: boolean
  // Availability line for the book bar + the brand-new-pro chips. `chips` is
  // empty for an established pro BY DESIGN, not for want of data.
  signals: ProProfileSignalsDto
}

/**
 * Eager full-profile load for the native read endpoint: base profile + stats +
 * offerings + portfolio tiles + reviews, all gated and JSON-safe. Returns null
 * when the profile is missing or not viewable.
 */
export async function loadProPublicProfile(args: {
  professionalId: string
  viewer: Viewer
  brandName: string
}): Promise<ProPublicProfileDto | null> {
  const result = await loadProPublicProfileBase(args)
  if (result.kind !== 'ok') return null

  const { base } = result

  const [work, reviews] = await Promise.all([
    loadProProfileWork({
      professionalId: base.professionalId,
      signatureMediaAssetId: base.signatureMediaAssetId,
      offerings: base.offeringRows,
    }),
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
    signature: work.signature,
    portfolioTiles: work.portfolioTiles,
    reviews,
    isFavoritedByMe: base.isFavoritedByMe,
    signals: base.signals,
  }
}
