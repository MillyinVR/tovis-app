// lib/profiles/publicProfileSelects.ts
// lib/profiles/publicProfileSelects.ts
import { Prisma } from '@prisma/client'

/**
 * Public professional profile query source of truth.
 *
 * Keep these selectors narrow:
 * - Base profile data should stay cheap and safe to load before the tab content.
 * - Portfolio, services, and reviews stay tab-specific so the public profile route
 *   does not fetch heavy data that the user is not viewing.
 * - Do not add UI-only formatting here. Put display mapping in publicProfileMappers.ts.
 */

export const PUBLIC_PROFILE_LIMITS = {
  offerings: 80,
  portfolioTiles: 60,
  reviews: 50,
  reviewMediaAssets: 12,
  serviceOptions: 500,
} as const

export const publicProfessionalProfileSelect =
  Prisma.validator<Prisma.ProfessionalProfileSelect>()({
    id: true,
    userId: true,
    verificationStatus: true,
    handle: true,
    isPremium: true,
    businessName: true,
    bio: true,
    avatarUrl: true,
    professionType: true,
    location: true,
    timeZone: true,
  })

export const publicOfferingServiceSelect =
  Prisma.validator<Prisma.ServiceSelect>()({
    id: true,
    name: true,
    defaultImageUrl: true,
  })

export const publicOfferingSelect =
  Prisma.validator<Prisma.ProfessionalServiceOfferingSelect>()({
    id: true,
    professionalId: true,
    serviceId: true,
    title: true,
    description: true,
    customImageUrl: true,

    salonPriceStartingAt: true,
    salonDurationMinutes: true,
    mobilePriceStartingAt: true,
    mobileDurationMinutes: true,

    offersInSalon: true,
    offersMobile: true,
    isActive: true,

    service: {
      select: publicOfferingServiceSelect,
    },
  })

export const publicPortfolioServiceTagSelect =
  Prisma.validator<Prisma.MediaServiceTagSelect>()({
    serviceId: true,
  })

export const publicPortfolioMediaAssetSelect =
  Prisma.validator<Prisma.MediaAssetSelect>()({
    id: true,
    professionalId: true,
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
      select: publicPortfolioServiceTagSelect,
    },
  })

export const publicReviewClientUserSelect =
  Prisma.validator<Prisma.UserSelect>()({
    email: true,
  })

export const publicReviewClientSelect =
  Prisma.validator<Prisma.ClientProfileSelect>()({
    firstName: true,
    lastName: true,
    user: {
      select: publicReviewClientUserSelect,
    },
  })

export const publicReviewMediaAssetSelect =
  Prisma.validator<Prisma.MediaAssetSelect>()({
    id: true,
    mediaType: true,
    isFeaturedInPortfolio: true,

    storageBucket: true,
    storagePath: true,
    thumbBucket: true,
    thumbPath: true,
    url: true,
    thumbUrl: true,
  })

export const publicReviewSelect = Prisma.validator<Prisma.ReviewSelect>()({
  id: true,
  rating: true,
  headline: true,
  body: true,
  createdAt: true,
  helpfulCount: true,

  client: {
    select: publicReviewClientSelect,
  },

  mediaAssets: {
    take: PUBLIC_PROFILE_LIMITS.reviewMediaAssets,
    orderBy: {
      createdAt: 'desc',
    },
    select: publicReviewMediaAssetSelect,
  },
})

export const serviceOptionSelect = Prisma.validator<Prisma.ServiceSelect>()({
  id: true,
  name: true,
})

export type PublicProfessionalProfileRow =
  Prisma.ProfessionalProfileGetPayload<{
    select: typeof publicProfessionalProfileSelect
  }>

export type PublicOfferingServiceRow = Prisma.ServiceGetPayload<{
  select: typeof publicOfferingServiceSelect
}>

export type PublicOfferingRow =
  Prisma.ProfessionalServiceOfferingGetPayload<{
    select: typeof publicOfferingSelect
  }>

export type PublicPortfolioServiceTagRow =
  Prisma.MediaServiceTagGetPayload<{
    select: typeof publicPortfolioServiceTagSelect
  }>

export type PublicPortfolioMediaAssetRow =
  Prisma.MediaAssetGetPayload<{
    select: typeof publicPortfolioMediaAssetSelect
  }>

export type PublicReviewClientUserRow = Prisma.UserGetPayload<{
  select: typeof publicReviewClientUserSelect
}>

export type PublicReviewClientRow = Prisma.ClientProfileGetPayload<{
  select: typeof publicReviewClientSelect
}>

export type PublicReviewMediaAssetRow = Prisma.MediaAssetGetPayload<{
  select: typeof publicReviewMediaAssetSelect
}>

export type PublicReviewRow = Prisma.ReviewGetPayload<{
  select: typeof publicReviewSelect
}>

export type ServiceOptionRow = Prisma.ServiceGetPayload<{
  select: typeof serviceOptionSelect
}>