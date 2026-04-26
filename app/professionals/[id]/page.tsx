// app/professionals/[id]/page.tsx
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { BookingStatus, MediaVisibility, Role } from '@prisma/client'

import { getCurrentUser } from '@/lib/currentUser'
import { messageStartHref } from '@/lib/messages'
import { prisma } from '@/lib/prisma'
import { canViewerSeeProPublicSurface } from '@/lib/proTrustState'
import {
  buildLoginHref,
  buildProfessionalProfileHref,
  buildPublicProfileFromPath,
  buildPublicProfileTabs,
  formatPortfolioEmptyMessage,
  formatReviewsEmptyMessage,
  formatServicesEmptyMessage,
  pickPublicProfileTab,
  type PublicProfileSearchParams,
} from '@/lib/profiles/publicProfileFormatting'
import {
  mapPublicOfferingsToDtos,
  mapPublicPortfolioTilesToDtos,
  mapPublicProfileHeaderToDto,
  mapPublicProfileStatsToDto,
  mapPublicReviewsToDtos,
} from '@/lib/profiles/publicProfileMappers'
import {
  PUBLIC_PROFILE_LIMITS,
  publicOfferingSelect,
  publicPortfolioMediaAssetSelect,
  publicProfessionalProfileSelect,
  publicReviewSelect,
} from '@/lib/profiles/publicProfileSelects'

import PortfolioGrid from './PortfolioGrid'
import ProfileHero from './ProfileHero'
import ProfileTabs from './ProfileTabs'
import ReviewsSummary from './ReviewsSummary'
import ServicesPanel from './ServicesPanel'

export const dynamic = 'force-dynamic'

export default async function PublicProfessionalProfilePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams?: Promise<PublicProfileSearchParams>
}) {
  const { id } = await params
  if (!id) notFound()

  const resolvedSearchParams = searchParams ? await searchParams : undefined
  const activeTab = pickPublicProfileTab(resolvedSearchParams)

  const viewer = await getCurrentUser().catch(() => null)

  const profileRow = await prisma.professionalProfile.findUnique({
    where: { id },
    select: publicProfessionalProfileSelect,
  })

  if (!profileRow) notFound()

  const canViewPublicSurface = canViewerSeeProPublicSurface({
    viewerRole: viewer?.role ?? null,
    viewerProfessionalId: viewer?.professionalProfile?.id ?? null,
    professionalId: profileRow.id,
    verificationStatus: profileRow.verificationStatus,
  })

  if (!canViewPublicSurface) {
    return <PendingVerificationSurface />
  }

  const viewerUserId = viewer?.role === Role.CLIENT ? viewer.id : null
  const isClientViewer = viewerUserId !== null

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

  const header = mapPublicProfileHeaderToDto(profileRow)
  const offerings = mapPublicOfferingsToDtos(offeringRows)

  const reviewCount = reviewStats._count._all
  const averageRating = reviewStats._avg.rating ?? null

  const stats = mapPublicProfileStatsToDto({
    offerings: offeringRows,
    completedBookingCount,
    favoritesCount,
    reviewCount,
    averageRating,
  })

  const portfolioTiles =
    activeTab === 'portfolio'
      ? await loadPortfolioTiles(profileRow.id)
      : []

  const reviewsForUI =
    activeTab === 'reviews'
      ? await loadReviewsForUi({
          professionalId: profileRow.id,
          viewerUserId,
        })
      : []

  const fromPath = buildPublicProfileFromPath({
    professionalId: profileRow.id,
    tab: activeTab,
  })

  const messageHref = viewer
    ? messageStartHref({
        kind: 'PRO_PROFILE',
        professionalId: profileRow.id,
      })
    : buildLoginHref(fromPath)

  const servicesHref = buildProfessionalProfileHref({
    professionalId: profileRow.id,
    tab: 'services',
  })

  const tabs = buildPublicProfileTabs(profileRow.id)
  const isFavoritedByMe = Boolean(favoriteRow)

  return (
    <main className="brand-profile-page min-h-screen pb-28">
      <div className="brand-profile-shell">
        <ProfileHero
          header={header}
          stats={stats}
          isClientViewer={isClientViewer}
          isFavoritedByMe={isFavoritedByMe}
          messageHref={messageHref}
          servicesHref={servicesHref}
        />

        <ProfileTabs tabs={tabs} activeTab={activeTab} />

        {activeTab === 'portfolio' ? (
          <PortfolioGrid
            tiles={portfolioTiles}
            emptyMessage={formatPortfolioEmptyMessage()}
          />
        ) : null}

        {activeTab === 'services' ? (
          <ServicesPanel
            professionalId={profileRow.id}
            offerings={offerings}
            emptyMessage={formatServicesEmptyMessage()}
          />
        ) : null}

        {activeTab === 'reviews' ? (
          <ReviewsSummary
            stats={stats}
            reviews={reviewsForUI}
            emptyMessage={formatReviewsEmptyMessage()}
          />
        ) : null}
      </div>
    </main>
  )
}

async function loadPortfolioTiles(professionalId: string) {
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

async function loadReviewsForUi(args: {
  professionalId: string
  viewerUserId: string | null
}) {
  const reviews = await prisma.review.findMany({
    where: { professionalId: args.professionalId },
    orderBy: { createdAt: 'desc' },
    take: PUBLIC_PROFILE_LIMITS.reviews,
    select: publicReviewSelect,
  })

  if (!args.viewerUserId || reviews.length === 0) {
    return mapPublicReviewsToDtos({ reviews })
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
    viewerHelpfulReviewIds: new Set(
      helpfulRows.map((row) => row.reviewId),
    ),
  })
}

function PendingVerificationSurface() {
  return (
    <main className="brand-profile-page min-h-screen px-4 py-10">
      <div className="mx-auto max-w-180">
        <Link
          href="/looks"
          className="text-[12px] font-black text-textPrimary hover:opacity-80"
        >
          ← Back to Looks
        </Link>

        <div className="brand-profile-card mt-4 p-4">
          <div className="text-[16px] font-black text-textPrimary">
            This profile is pending verification
          </div>
          <div className="mt-2 text-[13px] text-textSecondary">
            We’re verifying the professional’s license and details. Check back
            soon.
          </div>
        </div>
      </div>
    </main>
  )
}