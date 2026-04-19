// lib/looks/selects.ts
import { Prisma } from '@prisma/client'

const looksServiceCategorySelect =
  Prisma.validator<Prisma.ServiceCategorySelect>()({
    name: true,
    slug: true,
  })

export const looksServicePreviewSelect =
  Prisma.validator<Prisma.ServiceSelect>()({
    id: true,
    name: true,
    category: {
      select: looksServiceCategorySelect,
    },
  })

export type LooksServicePreviewRow = Prisma.ServiceGetPayload<{
  select: typeof looksServicePreviewSelect
}>

export const looksProProfilePreviewSelect =
  Prisma.validator<Prisma.ProfessionalProfileSelect>()({
    id: true,
    businessName: true,
    handle: true,
    avatarUrl: true,
    professionType: true,
    location: true,
    verificationStatus: true,
    isPremium: true,
  })

export type LooksProProfilePreviewRow =
  Prisma.ProfessionalProfileGetPayload<{
    select: typeof looksProProfilePreviewSelect
  }>

const looksMediaPreviewSelect =
  Prisma.validator<Prisma.MediaAssetSelect>()({
    id: true,
    url: true,
    thumbUrl: true,
    storageBucket: true,
    storagePath: true,
    thumbBucket: true,
    thumbPath: true,
    mediaType: true,
    caption: true,
    createdAt: true,
  })

const looksDetailMediaAssetSelect =
  Prisma.validator<Prisma.MediaAssetSelect>()({
    id: true,
    url: true,
    thumbUrl: true,
    storageBucket: true,
    storagePath: true,
    thumbBucket: true,
    thumbPath: true,
    mediaType: true,
    caption: true,
    createdAt: true,

    visibility: true,
    isEligibleForLooks: true,
    isFeaturedInPortfolio: true,
    reviewId: true,

    review: {
      select: {
        id: true,
        rating: true,
        headline: true,
        body: true,
        createdAt: true,
        helpfulCount: true,
      },
    },
  })

export const looksFeedSelect =
  Prisma.validator<Prisma.LookPostSelect>()({
    id: true,
    professionalId: true,
    serviceId: true,

    caption: true,
    priceStartingAt: true,

    status: true,
    visibility: true,
    moderationStatus: true,

    publishedAt: true,
    createdAt: true,
    updatedAt: true,

    likeCount: true,
    commentCount: true,
    saveCount: true,
    shareCount: true,

    spotlightScore: true,
    rankScore: true,

    primaryMediaAsset: {
      select: looksMediaPreviewSelect,
    },

    professional: {
      select: looksProProfilePreviewSelect,
    },

    service: {
      select: looksServicePreviewSelect,
    },
  })

export type LooksFeedRow = Prisma.LookPostGetPayload<{
  select: typeof looksFeedSelect
}>

export const looksDetailSelect =
  Prisma.validator<Prisma.LookPostSelect>()({
    id: true,
    professionalId: true,
    serviceId: true,
    primaryMediaAssetId: true,

    caption: true,
    priceStartingAt: true,

    status: true,
    visibility: true,
    moderationStatus: true,

    publishedAt: true,
    archivedAt: true,
    removedAt: true,

    createdAt: true,
    updatedAt: true,

    likeCount: true,
    commentCount: true,
    saveCount: true,
    shareCount: true,

    spotlightScore: true,
    rankScore: true,

    professional: {
      select: looksProProfilePreviewSelect,
    },

    service: {
      select: looksServicePreviewSelect,
    },

    primaryMediaAsset: {
      select: looksDetailMediaAssetSelect,
    },

    assets: {
      orderBy: {
        sortOrder: 'asc',
      },
      select: {
        id: true,
        sortOrder: true,
        mediaAssetId: true,
        mediaAsset: {
          select: looksDetailMediaAssetSelect,
        },
      },
    },
  })

export type LooksDetailRow = Prisma.LookPostGetPayload<{
  select: typeof looksDetailSelect
}>

export const looksBoardPreviewSelect =
  Prisma.validator<Prisma.BoardSelect>()({
    id: true,
    clientId: true,
    name: true,
    visibility: true,
    createdAt: true,
    updatedAt: true,

    _count: {
      select: {
        items: true,
      },
    },

    items: {
      orderBy: {
        createdAt: 'desc',
      },
      take: 3,
      select: {
        id: true,
        createdAt: true,
        lookPostId: true,
        lookPost: {
          select: {
            id: true,
            caption: true,
            status: true,
            visibility: true,
            moderationStatus: true,
            publishedAt: true,
            primaryMediaAsset: {
              select: looksMediaPreviewSelect,
            },
          },
        },
      },
    },
  })

export type LooksBoardPreviewRow = Prisma.BoardGetPayload<{
  select: typeof looksBoardPreviewSelect
}>