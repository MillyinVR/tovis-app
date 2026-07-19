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
    firstName: true,
    lastName: true,
    nameDisplay: true,
    bio: true,
    avatarUrl: true,
    professionType: true,
    licenseState: true,
    licenseVerified: true,
    location: true,
    timeZone: true,
    instagramHandle: true,
    tiktokHandle: true,
    websiteUrl: true,

    // Creator-page cover banner (§18). Just the render pointers so the mapper can
    // resolve a display URL; null when the pro hasn't set a cover (branded
    // fallback). Public-bucket covers render as permanent URLs, private ones sign.
    coverMediaAsset: {
      select: {
        storageBucket: true,
        storagePath: true,
        thumbBucket: true,
        thumbPath: true,
        url: true,
        thumbUrl: true,
      },
    },
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
    // The tag's display name, so a tile can render service chips without a
    // second round trip to resolve ids. Web's `/media/[id]` already renders
    // these names; the DTO carries them so native clients can too.
    service: {
      select: { name: true },
    },
  })

/**
 * The chosen "before" counterpart of a paired portfolio/review asset — just the
 * pointers needed to render its thumbnail + full-size URL for the comparison
 * slider. (No nested `beforeAsset` here: pairing is one level deep.)
 */
export const pairedBeforeAssetSelect =
  Prisma.validator<Prisma.MediaAssetSelect>()({
    id: true,
    mediaType: true,
    storageBucket: true,
    storagePath: true,
    thumbBucket: true,
    thumbPath: true,
    url: true,
    thumbUrl: true,
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

    // Opt-in before/after pairing → render the comparison slider when present.
    beforeAsset: {
      select: pairedBeforeAssetSelect,
    },

    services: {
      select: publicPortfolioServiceTagSelect,
    },
  })

/**
 * §19c — the public profile grid now reads the pro's `LookPost`s (the same rows
 * the feed/search/boards read), not `MediaAsset.isFeaturedInPortfolio` directly,
 * so grid + feed can never diverge. Each tile still renders from the look's
 * `primaryMediaAsset` (reusing {@link publicPortfolioMediaAssetSelect} + the
 * existing tile mapper), so the tile DTO shape is unchanged. `publishedAt` drives
 * newest-first ordering (preserving today's "★ FEAT" first tile).
 */
export const publicPortfolioLookSelect =
  Prisma.validator<Prisma.LookPostSelect>()({
    id: true,
    publishedAt: true,
    primaryMediaAsset: {
      select: publicPortfolioMediaAssetSelect,
    },
  })

export const publicReviewClientSelect =
  Prisma.validator<Prisma.ClientProfileSelect>()({
    // id + name are used server-side: id to upgrade the link to the pro chart for
    // an authorized pro viewer (never sent to the client — see
    // resolveClientProfileHref), name to render a redacted public reviewer label
    // (first name + last initial — see formatPublicReviewerName). The reviewer's
    // email is intentionally NOT selected: a public pro profile must not expose
    // reviewer contact info.
    id: true,
    firstName: true,
    lastName: true,
    // Linking a reviewer to their /u/[handle] profile is only possible once
    // they've opted into a public creator identity with a handle.
    handle: true,
    isPublicProfile: true,
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

    // Opt-in before/after pairing → render the comparison slider when present.
    beforeAsset: {
      select: pairedBeforeAssetSelect,
    },
  })

export const publicReviewSelect = Prisma.validator<Prisma.ReviewSelect>()({
  id: true,
  rating: true,
  headline: true,
  body: true,
  createdAt: true,
  helpfulCount: true,
  proReplyBody: true,
  proReplyAt: true,

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

export type PublicPortfolioLookRow = Prisma.LookPostGetPayload<{
  select: typeof publicPortfolioLookSelect
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