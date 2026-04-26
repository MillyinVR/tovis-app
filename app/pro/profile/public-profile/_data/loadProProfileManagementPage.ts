// app/pro/profile/public-profile/_data/loadProProfileManagementPage.ts
import 'server-only'

import { redirect } from 'next/navigation'
import {
  LookPostStatus,
  LookPostVisibility,
  ModerationStatus,
  Prisma,
  Role,
  type ProfessionType,
} from '@prisma/client'

import { getBrandConfig } from '@/lib/brand'
import { getCurrentUser } from '@/lib/currentUser'
import { countFollowers } from '@/lib/follows'
import { isRecord } from '@/lib/guards'
import { mapPortfolioTileToDto } from '@/lib/looks/mappers'
import { renderMediaUrls } from '@/lib/media/renderUrls'
import { pickString } from '@/lib/pick'
import { prisma } from '@/lib/prisma'
import { isPubliclyApprovedProStatus } from '@/lib/proTrustState'

import {
  PRO_PROFILE_MANAGEMENT_ROUTES,
  type ProProfileManagementEditProfileInitial,
  type ProProfileManagementPageModel,
  type ProProfileManagementPaymentSettingsInitial,
  type ProProfileManagementPortfolio,
  type ProProfileManagementReview,
  type ProProfileManagementReviewMedia,
  type ProProfileManagementSearchParams,
  type ProProfileManagementStat,
  type ProProfileManagementTab,
  type ProProfileManagementTipSuggestion,
} from './proProfileManagementTypes'

const PROFILE_MANAGEMENT_LIMITS = {
  portfolioAssets: 120,
  services: 500,
  reviews: 200,
} as const

const proProfileManagementSelect =
  Prisma.validator<Prisma.ProfessionalProfileSelect>()({
    id: true,
    handle: true,
    verificationStatus: true,
    isPremium: true,
    businessName: true,
    bio: true,
    location: true,
    avatarUrl: true,
    professionType: true,
    paymentSettings: {
      select: {
        collectPaymentAt: true,
        acceptCash: true,
        acceptCardOnFile: true,
        acceptTapToPay: true,
        acceptVenmo: true,
        acceptZelle: true,
        acceptAppleCash: true,
        tipsEnabled: true,
        allowCustomTip: true,
        tipSuggestions: true,
        venmoHandle: true,
        zelleHandle: true,
        appleCashHandle: true,
        paymentNote: true,
      },
    },
  })

const portfolioMediaAssetSelect = Prisma.validator<Prisma.MediaAssetSelect>()({
  id: true,
  caption: true,
  mediaType: true,
  visibility: true,
  isEligibleForLooks: true,
  isFeaturedInPortfolio: true,
  storageBucket: true,
  storagePath: true,
  thumbBucket: true,
  thumbPath: true,
  url: true,
  thumbUrl: true,
  services: {
    select: {
      serviceId: true,
    },
  },
})

const reviewSelect = Prisma.validator<Prisma.ReviewSelect>()({
  id: true,
  rating: true,
  headline: true,
  body: true,
  createdAt: true,
  mediaAssets: {
    select: {
      id: true,
      mediaType: true,
      isFeaturedInPortfolio: true,
      storageBucket: true,
      storagePath: true,
      thumbBucket: true,
      thumbPath: true,
      url: true,
      thumbUrl: true,
    },
  },
  client: {
    select: {
      firstName: true,
      lastName: true,
      user: {
        select: {
          email: true,
        },
      },
    },
  },
})

type ProProfileManagementRow = Prisma.ProfessionalProfileGetPayload<{
  select: typeof proProfileManagementSelect
}>

type ReviewRow = Prisma.ReviewGetPayload<{
  select: typeof reviewSelect
}>

type ReviewMediaRow = ReviewRow['mediaAssets'][number]

type ReviewStats = {
  reviewCount: number
  averageRating: number | null
}

export async function loadProProfileManagementPage({
  searchParams,
}: {
  searchParams?: ProProfileManagementSearchParams | null
}): Promise<ProProfileManagementPageModel> {
  const user = await getCurrentUser()
  const brand = getBrandConfig()

  if (!user || user.role !== Role.PRO || !user.professionalProfile) {
    redirect(
      `/login?from=${encodeURIComponent(
        PRO_PROFILE_MANAGEMENT_ROUTES.proPublicProfile,
      )}`,
    )
  }

  const tab = pickProProfileManagementTab(searchParams)
  const professionalId = user.professionalProfile.id

  const pro = await prisma.professionalProfile.findUnique({
    where: { id: professionalId },
    select: proProfileManagementSelect,
  })

  if (!pro) {
    redirect(PRO_PROFILE_MANAGEMENT_ROUTES.proHome)
  }

  const [
    reviewStats,
    favoritesCount,
    publishedLooksCount,
    followersCount,
    unreadNotificationCount,
    portfolio,
    reviews,
  ] = await Promise.all([
    loadReviewStats(pro.id),
    prisma.professionalFavorite.count({
      where: { professionalId: pro.id },
    }),
    prisma.lookPost.count({
      where: {
        professionalId: pro.id,
        status: LookPostStatus.PUBLISHED,
        moderationStatus: ModerationStatus.APPROVED,
        visibility: LookPostVisibility.PUBLIC,
        publishedAt: { not: null },
      },
    }),
    countFollowers(prisma, pro.id),
    prisma.notification.count({
      where: {
        professionalId: pro.id,
        archivedAt: null,
        readAt: null,
      },
    }),
    tab === 'portfolio' ? loadPortfolio(pro.id) : emptyPortfolio(),
    tab === 'reviews'
      ? loadReviews(pro.id)
      : Promise.resolve<ProProfileManagementReview[]>([]),
  ])

  const averageRatingLabel = formatAverageRating(reviewStats.averageRating)

  return {
    brandDisplayName: brand.displayName,
    routes: PRO_PROFILE_MANAGEMENT_ROUTES,
    tab,

    profile: buildProfileModel(pro),
    stats: buildStats({
      reviewCount: reviewStats.reviewCount,
      averageRatingLabel,
      favoritesCount,
      publishedLooksCount,
      followersCount,
    }),
    unreadNotificationCount: normalizeCount(unreadNotificationCount),

    editProfileInitial: buildEditProfileInitial(pro),
    paymentSettingsInitial: buildPaymentSettingsInitial(pro),

    portfolio,
    reviews: {
      items: reviews,
      reviewCount: reviewStats.reviewCount,
      averageRatingLabel,
    },
  }
}

export function pickProProfileManagementTab(
  searchParams: ProProfileManagementSearchParams | null | undefined,
): ProProfileManagementTab {
  const rawValue = searchParams?.tab
  const raw =
    typeof rawValue === 'string'
      ? rawValue
      : Array.isArray(rawValue)
        ? rawValue[0]
        : null

  return raw === 'services' || raw === 'reviews' ? raw : 'portfolio'
}

async function loadReviewStats(
  professionalId: string,
): Promise<ReviewStats> {
  const stats = await prisma.review.aggregate({
    where: { professionalId },
    _count: { _all: true },
    _avg: { rating: true },
  })

  return {
    reviewCount: normalizeCount(stats._count._all),
    averageRating: stats._avg.rating ?? null,
  }
}

async function loadPortfolio(
  professionalId: string,
): Promise<ProProfileManagementPortfolio> {
  const [assets, serviceOptions] = await Promise.all([
    prisma.mediaAsset.findMany({
      where: {
        professionalId,
        isFeaturedInPortfolio: true,
      },
      orderBy: { createdAt: 'desc' },
      take: PROFILE_MANAGEMENT_LIMITS.portfolioAssets,
      select: portfolioMediaAssetSelect,
    }),
    prisma.service.findMany({
      where: { isActive: true },
      orderBy: { name: 'asc' },
      take: PROFILE_MANAGEMENT_LIMITS.services,
      select: {
        id: true,
        name: true,
      },
    }),
  ])

  const mappedTiles = await Promise.all(
    assets.map((asset) => mapPortfolioTileToDto(asset)),
  )

  const tiles = mappedTiles.filter(isNonNull)

  return {
    tiles,
    serviceOptions,
    hasLooksEligibleBridge: tiles.some((tile) => tile.isEligibleForLooks),
  }
}

async function emptyPortfolio(): Promise<ProProfileManagementPortfolio> {
  return {
    tiles: [],
    serviceOptions: [],
    hasLooksEligibleBridge: false,
  }
}

async function loadReviews(
  professionalId: string,
): Promise<ProProfileManagementReview[]> {
  const reviews = await prisma.review.findMany({
    where: { professionalId },
    orderBy: { createdAt: 'desc' },
    take: PROFILE_MANAGEMENT_LIMITS.reviews,
    select: reviewSelect,
  })

  return Promise.all(reviews.map(mapReviewForUi))
}

async function mapReviewForUi(
  review: ReviewRow,
): Promise<ProProfileManagementReview> {
  const mediaAssets = await Promise.all(
    review.mediaAssets.map(mapReviewMediaForUi),
  )

  return {
    id: review.id,
    rating: review.rating,
    headline: review.headline ?? null,
    body: review.body ?? null,
    createdAt: review.createdAt.toISOString(),
    clientName: formatClientName({
      userEmail: review.client?.user?.email ?? null,
      firstName: review.client?.firstName ?? null,
      lastName: review.client?.lastName ?? null,
    }),
    mediaAssets: mediaAssets.filter(isNonNull),
  }
}

async function mapReviewMediaForUi(
  media: ReviewMediaRow,
): Promise<ProProfileManagementReviewMedia | null> {
  const rendered = await renderMediaUrls({
    storageBucket: media.storageBucket,
    storagePath: media.storagePath,
    thumbBucket: media.thumbBucket,
    thumbPath: media.thumbPath,
    url: media.url,
    thumbUrl: media.thumbUrl,
  })

  const url = pickString(rendered.renderUrl)
  if (!url) return null

  return {
    id: media.id,
    url,
    thumbUrl: pickString(rendered.renderThumbUrl),
    mediaType: media.mediaType,
    isFeaturedInPortfolio: media.isFeaturedInPortfolio,
  }
}

function buildProfileModel(pro: ProProfileManagementRow) {
  const isApproved = isPubliclyApprovedProStatus(pro.verificationStatus)
  const publicUrl = `/professionals/${encodeURIComponent(pro.id)}`

  return {
    id: pro.id,
    handle: pickString(pro.handle),
    verificationStatus: pro.verificationStatus,
    isApproved,
    isPremium: pro.isPremium,
    canEditHandle: isApproved,

    displayName: pickString(pro.businessName) ?? 'Your business name',
    subtitle: formatProfessionType(pro.professionType),
    location: pickString(pro.location),
    bio: pickString(pro.bio),
    avatarUrl: pickString(pro.avatarUrl),
    professionType: pro.professionType ?? null,

    publicUrl,
    livePublicUrl: isApproved ? publicUrl : null,
  }
}

function buildEditProfileInitial(
  pro: ProProfileManagementRow,
): ProProfileManagementEditProfileInitial {
  return {
    businessName: pickString(pro.businessName),
    bio: pickString(pro.bio),
    location: pickString(pro.location),
    avatarUrl: pickString(pro.avatarUrl),
    professionType: pro.professionType ?? null,
    handle: pickString(pro.handle),
    isPremium: pro.isPremium,
  }
}

function buildPaymentSettingsInitial(
  pro: ProProfileManagementRow,
): ProProfileManagementPaymentSettingsInitial | null {
  const settings = pro.paymentSettings
  if (!settings) return null

  return {
    collectPaymentAt: settings.collectPaymentAt,
    acceptCash: settings.acceptCash,
    acceptCardOnFile: settings.acceptCardOnFile,
    acceptTapToPay: settings.acceptTapToPay,
    acceptVenmo: settings.acceptVenmo,
    acceptZelle: settings.acceptZelle,
    acceptAppleCash: settings.acceptAppleCash,
    tipsEnabled: settings.tipsEnabled,
    allowCustomTip: settings.allowCustomTip,
    tipSuggestions: parseTipSuggestions(settings.tipSuggestions),
    venmoHandle: pickString(settings.venmoHandle),
    zelleHandle: pickString(settings.zelleHandle),
    appleCashHandle: pickString(settings.appleCashHandle),
    paymentNote: pickString(settings.paymentNote),
  }
}

function parseTipSuggestions(
  value: Prisma.JsonValue | null,
): ProProfileManagementTipSuggestion[] | null {
  if (!Array.isArray(value)) return null

  const suggestions = value.map(parseTipSuggestion).filter(isNonNull)

  return suggestions.length > 0 ? suggestions : null
}

function parseTipSuggestion(
  value: unknown,
): ProProfileManagementTipSuggestion | null {
  if (!isRecord(value)) return null

  const label = pickString(value.label)
  const percent = normalizePercent(value.percent)

  if (!label || percent === null) return null

  return {
    label,
    percent,
  }
}

function normalizePercent(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null
  if (value < 0 || value > 100) return null

  return value
}

function buildStats(args: {
  reviewCount: number
  averageRatingLabel: string | null
  favoritesCount: number
  publishedLooksCount: number
  followersCount: number
}): ProProfileManagementStat[] {
  return [
    {
      key: 'rating',
      label: 'Rating',
      value: args.reviewCount > 0 ? args.averageRatingLabel ?? '–' : '–',
    },
    {
      key: 'reviews',
      label: 'Reviews',
      value: formatCompactCount(args.reviewCount),
    },
    {
      key: 'favorites',
      label: 'Favs',
      value: formatCompactCount(args.favoritesCount),
    },
    {
      key: 'looks',
      label: 'Looks',
      value: formatCompactCount(args.publishedLooksCount),
    },
    {
      key: 'followers',
      label: 'Followers',
      value: formatCompactCount(args.followersCount),
    },
  ]
}

function formatAverageRating(value: number | null): string | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null

  return value.toFixed(1)
}

function formatCompactCount(value: number): string {
  const count = normalizeCount(value)

  if (count >= 1_000_000) {
    return `${trimTrailingZero((count / 1_000_000).toFixed(1))}M`
  }

  if (count >= 1_000) {
    return `${trimTrailingZero((count / 1_000).toFixed(1))}K`
  }

  return String(count)
}

function trimTrailingZero(value: string): string {
  return value.endsWith('.0') ? value.slice(0, -2) : value
}

function normalizeCount(value: number): number {
  if (!Number.isFinite(value)) return 0

  return Math.max(0, Math.trunc(value))
}

function formatProfessionType(value: ProfessionType | null): string {
  if (!value) return 'Beauty professional'

  return value
    .toLowerCase()
    .split('_')
    .filter(Boolean)
    .map(capitalize)
    .join(' ')
}

function capitalize(value: string): string {
  if (!value) return value

  return `${value.charAt(0).toUpperCase()}${value.slice(1)}`
}

function formatClientName(input: {
  userEmail?: string | null
  firstName?: string | null
  lastName?: string | null
}): string {
  const email = pickString(input.userEmail)
  if (email) return email

  const firstName = pickString(input.firstName)
  const lastName = pickString(input.lastName)
  const fullName = [firstName, lastName].filter(isNonNull).join(' ').trim()

  return fullName || 'Client'
}

function isNonNull<T>(value: T | null): value is T {
  return value !== null
}