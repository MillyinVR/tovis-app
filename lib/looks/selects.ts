// lib/looks/selects.ts
import { Prisma } from '@prisma/client'

export const looksFeedMediaSelect =
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
    uploadedByRole: true,
    uploadedByUserId: true,
    reviewId: true,

    review: {
      select: {
        id: true,
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
        id: true,
        serviceId: true,
        service: {
          select: {
            id: true,
            name: true,
            category: {
              select: {
                name: true,
                slug: true,
              },
            },
          },
        },
      },
    },

    _count: {
      select: {
        likes: true,
        comments: true,
      },
    },
  })

export type LooksFeedMediaRow = Prisma.MediaAssetGetPayload<{
  select: typeof looksFeedMediaSelect
}>

export const looksDetailMediaSelect =
  Prisma.validator<Prisma.MediaAssetSelect>()({
    id: true,
    professionalId: true,

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

    professional: {
      select: {
        id: true,
        businessName: true,
        handle: true,
        avatarUrl: true,
        professionType: true,
        location: true,
        verificationStatus: true,
      },
    },

    services: {
      select: {
        id: true,
        serviceId: true,
        service: {
          select: {
            id: true,
            name: true,
            category: {
              select: {
                name: true,
                slug: true,
              },
            },
          },
        },
      },
    },

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

    _count: {
      select: {
        likes: true,
        comments: true,
      },
    },
  })

export type LooksDetailMediaRow = Prisma.MediaAssetGetPayload<{
  select: typeof looksDetailMediaSelect
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
              select: {
                id: true,
                url: true,
                thumbUrl: true,
                storageBucket: true,
                storagePath: true,
                thumbBucket: true,
                thumbPath: true,
                mediaType: true,
              },
            },
          },
        },
      },
    },
  })

export type LooksBoardPreviewRow = Prisma.BoardGetPayload<{
  select: typeof looksBoardPreviewSelect
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