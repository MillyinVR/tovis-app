import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

import {
  BoardVisibility,
  LookPostStatus,
  LookPostVisibility,
  MediaType,
  MediaVisibility,
  ModerationStatus,
  ProfessionType,
  VerificationStatus,
} from '@prisma/client'

const mocks = vi.hoisted(() => ({
  renderMediaUrls: vi.fn(),
}))

vi.mock('@/lib/media/renderUrls', () => ({
  renderMediaUrls: mocks.renderMediaUrls,
}))

import type {
  LooksBoardDetailRow,
  LooksBoardPreviewRow,
  LooksDetailRow,
  LooksFeedRow,
  LooksProProfilePreviewRow,
} from '@/lib/looks/selects'
import {
  mapLooksBoardDetailToDto,
  mapLooksBoardPreviewToDto,
  mapLooksCommentToDto,
  mapLooksDetailMediaToRenderable,
  mapLooksDetailToDto,
  mapLooksFeedMediaToDto,
  mapPortfolioTileToDto,
  mapReviewMediaAssetToDto,
} from './mappers'
import { mapLooksProProfilePreviewToDto } from './profilePreview'

function makeFeedRow(overrides?: Partial<LooksFeedRow>): LooksFeedRow {
  return {
    id: 'look_1',
    professionalId: 'pro_1',
    serviceId: 'service_1',
    caption: 'Fresh cut',
    priceStartingAt: null,
    status: LookPostStatus.PUBLISHED,
    visibility: LookPostVisibility.PUBLIC,
    moderationStatus: ModerationStatus.APPROVED,
    publishedAt: new Date('2026-04-18T13:00:00.000Z'),
    createdAt: new Date('2026-04-18T12:00:00.000Z'),
    updatedAt: new Date('2026-04-18T13:30:00.000Z'),
    likeCount: 9,
    commentCount: 3,
    saveCount: 2,
    shareCount: 1,
    spotlightScore: 42,
    rankScore: 99,
    primaryMediaAsset: {
      id: 'media_1',
      url: 'https://cdn.example.com/media.jpg',
      thumbUrl: 'https://cdn.example.com/media-thumb.jpg',
      storageBucket: 'media-public',
      storagePath: 'looks/media_1.jpg',
      thumbBucket: 'media-public',
      thumbPath: 'looks/media_1-thumb.jpg',
      mediaType: MediaType.IMAGE,
      caption: 'Primary caption',
      createdAt: new Date('2026-04-18T11:30:00.000Z'),
    },
    professional: {
      id: 'pro_1',
      businessName: 'TOVIS Studio',
      handle: 'tovisstudio',
      avatarUrl: 'https://cdn.example.com/pro-avatar.jpg',
      professionType: ProfessionType.BARBER,
      location: 'San Diego, CA',
      verificationStatus: VerificationStatus.APPROVED,
      isPremium: true,
    },
    service: {
      id: 'service_1',
      name: 'Fade',
      category: {
        name: 'Hair',
        slug: 'hair',
      },
    },
    ...overrides,
  }
}

function makeDetailRow(overrides?: Partial<LooksDetailRow>): LooksDetailRow {
  return {
    id: 'look_1',
    professionalId: 'pro_1',
    serviceId: 'service_1',
    primaryMediaAssetId: 'media_1',
    caption: 'Detailed caption',
    priceStartingAt: null,
    status: LookPostStatus.PUBLISHED,
    visibility: LookPostVisibility.PUBLIC,
    moderationStatus: ModerationStatus.APPROVED,
    publishedAt: new Date('2026-04-18T12:00:00.000Z'),
    archivedAt: null,
    removedAt: null,
    createdAt: new Date('2026-04-18T11:00:00.000Z'),
    updatedAt: new Date('2026-04-18T12:30:00.000Z'),
    likeCount: 4,
    commentCount: 2,
    saveCount: 1,
    shareCount: 0,
    spotlightScore: 18,
    rankScore: 27,
    professional: {
      id: 'pro_1',
      businessName: 'TOVIS Studio',
      handle: 'tovisstudio',
      avatarUrl: 'https://cdn.example.com/pro-avatar.jpg',
      professionType: ProfessionType.BARBER,
      location: 'San Diego, CA',
      verificationStatus: VerificationStatus.APPROVED,
      isPremium: true,
    },
    service: {
      id: 'service_1',
      name: 'Fade',
      category: {
        name: 'Hair',
        slug: 'hair',
      },
    },
    primaryMediaAsset: {
      id: 'media_1',
      url: 'https://cdn.example.com/detail.jpg',
      thumbUrl: 'https://cdn.example.com/detail-thumb.jpg',
      storageBucket: 'media-public',
      storagePath: 'looks/detail.jpg',
      thumbBucket: 'media-public',
      thumbPath: 'looks/detail-thumb.jpg',
      mediaType: MediaType.IMAGE,
      caption: 'Primary detail caption',
      createdAt: new Date('2026-04-18T10:30:00.000Z'),
      visibility: MediaVisibility.PUBLIC,
      isEligibleForLooks: true,
      isFeaturedInPortfolio: false,
      reviewId: 'review_1',
      review: {
        id: 'review_1',
        rating: 5,
        headline: 'Love it',
        body: 'Looks amazing',
        createdAt: new Date('2026-04-17T12:00:00.000Z'),
        helpfulCount: 8,
      },
    },
    assets: [
      {
        id: 'asset_1',
        sortOrder: 0,
        mediaAssetId: 'media_1',
        mediaAsset: {
          id: 'media_1',
          url: 'https://cdn.example.com/detail.jpg',
          thumbUrl: 'https://cdn.example.com/detail-thumb.jpg',
          storageBucket: 'media-public',
          storagePath: 'looks/detail.jpg',
          thumbBucket: 'media-public',
          thumbPath: 'looks/detail-thumb.jpg',
          mediaType: MediaType.IMAGE,
          caption: 'Primary detail caption',
          createdAt: new Date('2026-04-18T10:30:00.000Z'),
          visibility: MediaVisibility.PUBLIC,
          isEligibleForLooks: true,
          isFeaturedInPortfolio: false,
          reviewId: 'review_1',
          review: {
            id: 'review_1',
            rating: 5,
            headline: 'Love it',
            body: 'Looks amazing',
            createdAt: new Date('2026-04-17T12:00:00.000Z'),
            helpfulCount: 8,
          },
        },
      },
    ],
    ...overrides,
  }
}

function makeBoardPreviewRow(
  overrides?: Partial<LooksBoardPreviewRow>,
): LooksBoardPreviewRow {
  return {
    id: 'board_1',
    clientId: 'client_1',
    name: 'Hair ideas',
    visibility: BoardVisibility.PRIVATE,
    createdAt: new Date('2026-04-18T10:00:00.000Z'),
    updatedAt: new Date('2026-04-18T11:00:00.000Z'),
    _count: {
      items: 1,
    },
    items: [
      {
        id: 'item_1',
        createdAt: new Date('2026-04-18T11:30:00.000Z'),
        lookPostId: 'look_1',
        lookPost: {
          id: 'look_1',
          caption: 'Wolf cut inspo',
          status: LookPostStatus.PUBLISHED,
          visibility: LookPostVisibility.PUBLIC,
          moderationStatus: ModerationStatus.APPROVED,
          publishedAt: new Date('2026-04-18T09:00:00.000Z'),
          primaryMediaAsset: {
            id: 'media_1',
            url: 'https://cdn.example.com/look.jpg',
            thumbUrl: 'https://cdn.example.com/look-thumb.jpg',
            storageBucket: 'media-public',
            storagePath: 'looks/look.jpg',
            thumbBucket: 'media-public',
            thumbPath: 'looks/look-thumb.jpg',
            mediaType: MediaType.IMAGE,
            caption: 'Look preview',
            createdAt: new Date('2026-04-18T08:30:00.000Z'),
          },
        },
      },
    ],
    ...overrides,
  }
}

function makeBoardDetailRow(
  overrides?: Partial<LooksBoardDetailRow>,
): LooksBoardDetailRow {
  return {
    id: 'board_1',
    clientId: 'client_1',
    name: 'Hair ideas',
    visibility: BoardVisibility.PRIVATE,
    createdAt: new Date('2026-04-18T10:00:00.000Z'),
    updatedAt: new Date('2026-04-18T11:00:00.000Z'),
    _count: {
      items: 2,
    },
    items: [
      {
        id: 'item_2',
        createdAt: new Date('2026-04-18T12:00:00.000Z'),
        lookPostId: 'look_2',
        lookPost: {
          id: 'look_2',
          caption: 'Bob cut inspo',
          status: LookPostStatus.PUBLISHED,
          visibility: LookPostVisibility.PUBLIC,
          moderationStatus: ModerationStatus.APPROVED,
          publishedAt: new Date('2026-04-18T10:00:00.000Z'),
          primaryMediaAsset: {
            id: 'media_2',
            url: 'https://cdn.example.com/look-2.jpg',
            thumbUrl: 'https://cdn.example.com/look-2-thumb.jpg',
            storageBucket: 'media-public',
            storagePath: 'looks/look-2.jpg',
            thumbBucket: 'media-public',
            thumbPath: 'looks/look-2-thumb.jpg',
            mediaType: MediaType.IMAGE,
            caption: 'Second look preview',
            createdAt: new Date('2026-04-18T09:30:00.000Z'),
          },
        },
      },
      {
        id: 'item_1',
        createdAt: new Date('2026-04-18T11:30:00.000Z'),
        lookPostId: 'look_1',
        lookPost: {
          id: 'look_1',
          caption: 'Wolf cut inspo',
          status: LookPostStatus.PUBLISHED,
          visibility: LookPostVisibility.PUBLIC,
          moderationStatus: ModerationStatus.APPROVED,
          publishedAt: new Date('2026-04-18T09:00:00.000Z'),
          primaryMediaAsset: {
            id: 'media_1',
            url: 'https://cdn.example.com/look.jpg',
            thumbUrl: 'https://cdn.example.com/look-thumb.jpg',
            storageBucket: 'media-public',
            storagePath: 'looks/look.jpg',
            thumbBucket: 'media-public',
            thumbPath: 'looks/look-thumb.jpg',
            mediaType: MediaType.IMAGE,
            caption: 'Look preview',
            createdAt: new Date('2026-04-18T08:30:00.000Z'),
          },
        },
      },
    ],
    ...overrides,
  }
}

function makeProProfilePreviewRow(
  overrides?: Partial<LooksProProfilePreviewRow>,
): LooksProProfilePreviewRow {
  return {
    id: 'pro_1',
    businessName: 'TOVIS Studio',
    handle: 'tovisstudio',
    avatarUrl: 'https://cdn.example.com/pro-avatar.jpg',
    professionType: ProfessionType.BARBER,
    location: 'San Diego, CA',
    verificationStatus: VerificationStatus.APPROVED,
    isPremium: true,
    ...overrides,
  }
}

describe('lib/looks/mappers.ts', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.renderMediaUrls.mockResolvedValue({
      renderUrl: 'https://rendered.example.com/media.jpg',
      renderThumbUrl: 'https://rendered.example.com/media-thumb.jpg',
    })
  })

  describe('mapLooksFeedMediaToDto', () => {
    it('keeps explicit serviceId even when the joined service relation is null', async () => {
      const row = makeFeedRow({
        serviceId: 'service_1',
        service: null,
      })

      const result = await mapLooksFeedMediaToDto({
        item: row,
        viewerLiked: false,
        viewerSaved: false,
      })

      expect(result).toEqual({
        id: 'look_1',
        url: 'https://cdn.example.com/media.jpg',
        thumbUrl: 'https://cdn.example.com/media-thumb.jpg',
        mediaType: MediaType.IMAGE,
        caption: 'Fresh cut',
        createdAt: '2026-04-18T13:00:00.000Z',
        professional: {
          id: 'pro_1',
          businessName: 'TOVIS Studio',
          handle: 'tovisstudio',
          professionType: ProfessionType.BARBER,
          avatarUrl: 'https://cdn.example.com/pro-avatar.jpg',
          location: 'San Diego, CA',
        },
        _count: {
          likes: 9,
          comments: 3,
        },
        viewerLiked: false,
        viewerSaved: false,
        serviceId: 'service_1',
        serviceName: null,
        category: null,
        serviceIds: ['service_1'],
        uploadedByRole: null,
        reviewId: null,
        reviewHelpfulCount: null,
        reviewRating: null,
        reviewHeadline: null,
      })
    })

    it('maps a look-post feed row into the stable feed DTO', async () => {
      const row = makeFeedRow()

      const result = await mapLooksFeedMediaToDto({
        item: row,
        viewerLiked: true,
        viewerSaved: false,
      })

      expect(result).toEqual({
        id: 'look_1',
        url: 'https://cdn.example.com/media.jpg',
        thumbUrl: 'https://cdn.example.com/media-thumb.jpg',
        mediaType: MediaType.IMAGE,
        caption: 'Fresh cut',
        createdAt: '2026-04-18T13:00:00.000Z',
        professional: {
          id: 'pro_1',
          businessName: 'TOVIS Studio',
          handle: 'tovisstudio',
          professionType: ProfessionType.BARBER,
          avatarUrl: 'https://cdn.example.com/pro-avatar.jpg',
          location: 'San Diego, CA',
        },
        _count: {
          likes: 9,
          comments: 3,
        },
        viewerLiked: true,
        viewerSaved: false,
        serviceId: 'service_1',
        serviceName: 'Fade',
        category: 'Hair',
        serviceIds: ['service_1'],
        uploadedByRole: null,
        reviewId: null,
        reviewHelpfulCount: null,
        reviewRating: null,
        reviewHeadline: null,
      })

      expect(mocks.renderMediaUrls).not.toHaveBeenCalled()
    })

    it('uses rendered URLs when direct URLs are missing', async () => {
      const row = makeFeedRow({
        primaryMediaAsset: {
          id: 'media_1',
          url: null,
          thumbUrl: null,
          storageBucket: 'media-public',
          storagePath: 'looks/media_1.jpg',
          thumbBucket: 'media-public',
          thumbPath: 'looks/media_1-thumb.jpg',
          mediaType: MediaType.IMAGE,
          caption: 'Primary caption',
          createdAt: new Date('2026-04-18T11:30:00.000Z'),
        },
      })

      const result = await mapLooksFeedMediaToDto({
        item: row,
        viewerLiked: false,
        viewerSaved: false,
      })

      expect(mocks.renderMediaUrls).toHaveBeenCalledWith({
        storageBucket: 'media-public',
        storagePath: 'looks/media_1.jpg',
        thumbBucket: 'media-public',
        thumbPath: 'looks/media_1-thumb.jpg',
        url: null,
        thumbUrl: null,
      })

      expect(result?.url).toBe('https://rendered.example.com/media.jpg')
      expect(result?.thumbUrl).toBe(
        'https://rendered.example.com/media-thumb.jpg',
      )
    })

    it('returns null when no renderable URL can be produced', async () => {
      const row = makeFeedRow({
        primaryMediaAsset: {
          id: 'media_1',
          url: null,
          thumbUrl: null,
          storageBucket: 'media-public',
          storagePath: 'looks/media_1.jpg',
          thumbBucket: 'media-public',
          thumbPath: 'looks/media_1-thumb.jpg',
          mediaType: MediaType.IMAGE,
          caption: 'Primary caption',
          createdAt: new Date('2026-04-18T11:30:00.000Z'),
        },
      })

      mocks.renderMediaUrls.mockResolvedValueOnce({
        renderUrl: null,
        renderThumbUrl: null,
      })

      const result = await mapLooksFeedMediaToDto({
        item: row,
        viewerLiked: false,
        viewerSaved: false,
      })

      expect(result).toBeNull()
    })
  })

  describe('mapLooksCommentToDto', () => {
    it('prefers the client full name when present', () => {
      const result = mapLooksCommentToDto({
        id: 'comment_1',
        body: 'This is fire',
        createdAt: new Date('2026-04-18T12:00:00.000Z'),
        user: {
          id: 'user_1',
          clientProfile: {
            firstName: 'Tori',
            lastName: 'Morales',
            avatarUrl: 'https://cdn.example.com/client-avatar.jpg',
          },
          professionalProfile: {
            businessName: 'Other Name',
            avatarUrl: 'https://cdn.example.com/pro-avatar.jpg',
          },
        },
      })

      expect(result).toEqual({
        id: 'comment_1',
        body: 'This is fire',
        createdAt: '2026-04-18T12:00:00.000Z',
        user: {
          id: 'user_1',
          displayName: 'Tori Morales',
          avatarUrl: 'https://cdn.example.com/client-avatar.jpg',
        },
      })
    })

    it('falls back to professional business name when no client name exists', () => {
      const result = mapLooksCommentToDto({
        id: 'comment_1',
        body: 'Nice',
        createdAt: new Date('2026-04-18T12:00:00.000Z'),
        user: {
          id: 'user_2',
          clientProfile: null,
          professionalProfile: {
            businessName: 'TOVIS Studio',
            avatarUrl: null,
          },
        },
      })

      expect(result.user.displayName).toBe('TOVIS Studio')
    })
  })

  describe('mapReviewMediaAssetToDto', () => {
    it('maps review media using rendered URLs when needed', async () => {
      const result = await mapReviewMediaAssetToDto({
        id: 'media_1',
        mediaType: MediaType.VIDEO,
        isFeaturedInPortfolio: true,
        storageBucket: 'media-public',
        storagePath: 'reviews/review-video.mp4',
        thumbBucket: 'media-public',
        thumbPath: 'reviews/review-video-thumb.jpg',
        url: null,
        thumbUrl: null,
      })

      expect(result).toEqual({
        id: 'media_1',
        url: 'https://rendered.example.com/media.jpg',
        thumbUrl: 'https://rendered.example.com/media-thumb.jpg',
        mediaType: MediaType.VIDEO,
        isFeaturedInPortfolio: true,
      })
    })
  })

  describe('mapPortfolioTileToDto', () => {
    it('maps a portfolio tile and collects distinct service ids', async () => {
      const result = await mapPortfolioTileToDto({
        id: 'media_1',
        caption: 'Portfolio shot',
        visibility: MediaVisibility.PUBLIC,
        isEligibleForLooks: true,
        isFeaturedInPortfolio: true,
        mediaType: MediaType.VIDEO,
        storageBucket: 'media-public',
        storagePath: 'portfolio/shot.mp4',
        thumbBucket: 'media-public',
        thumbPath: 'portfolio/shot-thumb.jpg',
        url: null,
        thumbUrl: null,
        services: [
          {
            serviceId: 'service_1',
          },
          {
            service: {
              id: 'service_2',
            },
          },
          {
            serviceId: 'service_1',
          },
        ],
      })

      expect(result).toEqual({
        id: 'media_1',
        caption: 'Portfolio shot',
        visibility: MediaVisibility.PUBLIC,
        isEligibleForLooks: true,
        isFeaturedInPortfolio: true,
        src: 'https://rendered.example.com/media-thumb.jpg',
        serviceIds: ['service_1', 'service_2'],
        isVideo: true,
        mediaType: MediaType.VIDEO,
      })
    })

    it('returns null when neither thumb nor URL can be rendered', async () => {
      mocks.renderMediaUrls.mockResolvedValueOnce({
        renderUrl: null,
        renderThumbUrl: null,
      })

      const result = await mapPortfolioTileToDto({
        id: 'media_1',
        caption: null,
        visibility: MediaVisibility.PUBLIC,
        isEligibleForLooks: false,
        isFeaturedInPortfolio: true,
        mediaType: MediaType.IMAGE,
        storageBucket: 'media-public',
        storagePath: 'portfolio/shot.jpg',
        thumbBucket: 'media-public',
        thumbPath: 'portfolio/shot-thumb.jpg',
        url: null,
        thumbUrl: null,
        services: null,
      })

      expect(result).toBeNull()
    })
  })

  describe('mapLooksDetailMediaToRenderable', () => {
    it('returns the detail row with rendered media attached', async () => {
      const row = makeDetailRow({
        primaryMediaAsset: {
          id: 'media_1',
          url: null,
          thumbUrl: null,
          storageBucket: 'media-public',
          storagePath: 'looks/detail.jpg',
          thumbBucket: 'media-public',
          thumbPath: 'looks/detail-thumb.jpg',
          mediaType: MediaType.IMAGE,
          caption: 'Primary detail caption',
          createdAt: new Date('2026-04-18T10:30:00.000Z'),
          visibility: MediaVisibility.PUBLIC,
          isEligibleForLooks: true,
          isFeaturedInPortfolio: false,
          reviewId: 'review_1',
          review: {
            id: 'review_1',
            rating: 5,
            headline: 'Love it',
            body: 'Looks amazing',
            createdAt: new Date('2026-04-17T12:00:00.000Z'),
            helpfulCount: 8,
          },
        },
        assets: [
          {
            id: 'asset_1',
            sortOrder: 0,
            mediaAssetId: 'media_1',
            mediaAsset: {
              id: 'media_1',
              url: null,
              thumbUrl: null,
              storageBucket: 'media-public',
              storagePath: 'looks/detail.jpg',
              thumbBucket: 'media-public',
              thumbPath: 'looks/detail-thumb.jpg',
              mediaType: MediaType.IMAGE,
              caption: 'Primary detail caption',
              createdAt: new Date('2026-04-18T10:30:00.000Z'),
              visibility: MediaVisibility.PUBLIC,
              isEligibleForLooks: true,
              isFeaturedInPortfolio: false,
              reviewId: 'review_1',
              review: {
                id: 'review_1',
                rating: 5,
                headline: 'Love it',
                body: 'Looks amazing',
                createdAt: new Date('2026-04-17T12:00:00.000Z'),
                helpfulCount: 8,
              },
            },
          },
        ],
      })

      const result = await mapLooksDetailMediaToRenderable(row)

      expect(result).not.toBeNull()
      expect(result?.primaryMediaAsset.renderUrl).toBe(
        'https://rendered.example.com/media.jpg',
      )
      expect(result?.primaryMediaAsset.renderThumbUrl).toBe(
        'https://rendered.example.com/media-thumb.jpg',
      )
      expect(result?.assets[0]?.mediaAsset.renderUrl).toBe(
        'https://rendered.example.com/media.jpg',
      )
      expect(result?.professional.verificationStatus).toBe(
        VerificationStatus.APPROVED,
      )
    })
  })

  describe('mapLooksDetailToDto', () => {
    it('maps a renderable detail row into the stable detail DTO', async () => {
      const renderable = await mapLooksDetailMediaToRenderable(makeDetailRow())

      if (!renderable) {
        throw new Error('Expected renderable look detail row')
      }

      const result = mapLooksDetailToDto({
        item: renderable,
        viewerContext: {
          isAuthenticated: true,
          viewerLiked: true,
          canComment: true,
          canSave: true,
          isOwner: false,
          canModerate: false,
        },
      })

      expect(result).toEqual({
        id: 'look_1',
        caption: 'Detailed caption',
        status: LookPostStatus.PUBLISHED,
        visibility: LookPostVisibility.PUBLIC,
        moderationStatus: ModerationStatus.APPROVED,
        publishedAt: '2026-04-18T12:00:00.000Z',
        createdAt: '2026-04-18T11:00:00.000Z',
        updatedAt: '2026-04-18T12:30:00.000Z',
        professional: {
          id: 'pro_1',
          businessName: 'TOVIS Studio',
          handle: 'tovisstudio',
          avatarUrl: 'https://cdn.example.com/pro-avatar.jpg',
          professionType: ProfessionType.BARBER,
          location: 'San Diego, CA',
          verificationStatus: VerificationStatus.APPROVED,
          isPremium: true,
        },
        service: {
          id: 'service_1',
          name: 'Fade',
          category: {
            name: 'Hair',
            slug: 'hair',
          },
        },
        primaryMedia: {
          id: 'media_1',
          url: 'https://cdn.example.com/detail.jpg',
          thumbUrl: 'https://cdn.example.com/detail-thumb.jpg',
          mediaType: MediaType.IMAGE,
          caption: 'Primary detail caption',
          createdAt: '2026-04-18T10:30:00.000Z',
          review: {
            id: 'review_1',
            rating: 5,
            headline: 'Love it',
            helpfulCount: 8,
          },
        },
        assets: [
          {
            id: 'asset_1',
            sortOrder: 0,
            mediaAssetId: 'media_1',
            media: {
              id: 'media_1',
              url: 'https://cdn.example.com/detail.jpg',
              thumbUrl: 'https://cdn.example.com/detail-thumb.jpg',
              mediaType: MediaType.IMAGE,
              caption: 'Primary detail caption',
              createdAt: '2026-04-18T10:30:00.000Z',
              review: {
                id: 'review_1',
                rating: 5,
                headline: 'Love it',
                helpfulCount: 8,
              },
            },
          },
        ],
        _count: {
          likes: 4,
          comments: 2,
          saves: 1,
          shares: 0,
        },
        viewerContext: {
          isAuthenticated: true,
          viewerLiked: true,
          canComment: true,
          canSave: true,
          isOwner: false,
        },
      })
    })

    it('adds the admin block only when moderation access is allowed', async () => {
      const renderable = await mapLooksDetailMediaToRenderable(makeDetailRow())

      if (!renderable) {
        throw new Error('Expected renderable look detail row')
      }

      const result = mapLooksDetailToDto({
        item: renderable,
        viewerContext: {
          isAuthenticated: true,
          viewerLiked: false,
          canComment: false,
          canSave: false,
          isOwner: false,
          canModerate: true,
        },
      })

      expect(result.admin).toEqual({
        canModerate: true,
        archivedAt: null,
        removedAt: null,
        primaryMediaAssetId: 'media_1',
        primaryMedia: {
          visibility: MediaVisibility.PUBLIC,
          isEligibleForLooks: true,
          isFeaturedInPortfolio: false,
          reviewBody: 'Looks amazing',
        },
      })
    })
  })

  describe('mapLooksBoardPreviewToDto', () => {
    it('maps a board preview row into the shared DTO', async () => {
      const row = makeBoardPreviewRow()

      const result = await mapLooksBoardPreviewToDto(row)

      expect(result).toEqual({
        id: 'board_1',
        clientId: 'client_1',
        name: 'Hair ideas',
        visibility: BoardVisibility.PRIVATE,
        createdAt: '2026-04-18T10:00:00.000Z',
        updatedAt: '2026-04-18T11:00:00.000Z',
        itemCount: 1,
        items: [
          {
            id: 'item_1',
            createdAt: '2026-04-18T11:30:00.000Z',
            lookPostId: 'look_1',
            lookPost: {
              id: 'look_1',
              caption: 'Wolf cut inspo',
              status: LookPostStatus.PUBLISHED,
              visibility: LookPostVisibility.PUBLIC,
              moderationStatus: ModerationStatus.APPROVED,
              publishedAt: '2026-04-18T09:00:00.000Z',
              primaryMedia: {
                id: 'media_1',
                url: 'https://cdn.example.com/look.jpg',
                thumbUrl: 'https://cdn.example.com/look-thumb.jpg',
                mediaType: MediaType.IMAGE,
              },
            },
          },
        ],
      })
    })
  })

  describe('mapLooksBoardDetailToDto', () => {
    it('maps a board detail row into the stable detail DTO', async () => {
      const row = makeBoardDetailRow()

      const result = await mapLooksBoardDetailToDto(row)

      expect(result).toEqual({
        id: 'board_1',
        clientId: 'client_1',
        name: 'Hair ideas',
        visibility: BoardVisibility.PRIVATE,
        createdAt: '2026-04-18T10:00:00.000Z',
        updatedAt: '2026-04-18T11:00:00.000Z',
        itemCount: 2,
        items: [
          {
            id: 'item_2',
            createdAt: '2026-04-18T12:00:00.000Z',
            lookPostId: 'look_2',
            lookPost: {
              id: 'look_2',
              caption: 'Bob cut inspo',
              status: LookPostStatus.PUBLISHED,
              visibility: LookPostVisibility.PUBLIC,
              moderationStatus: ModerationStatus.APPROVED,
              publishedAt: '2026-04-18T10:00:00.000Z',
              primaryMedia: {
                id: 'media_2',
                url: 'https://cdn.example.com/look-2.jpg',
                thumbUrl: 'https://cdn.example.com/look-2-thumb.jpg',
                mediaType: MediaType.IMAGE,
              },
            },
          },
          {
            id: 'item_1',
            createdAt: '2026-04-18T11:30:00.000Z',
            lookPostId: 'look_1',
            lookPost: {
              id: 'look_1',
              caption: 'Wolf cut inspo',
              status: LookPostStatus.PUBLISHED,
              visibility: LookPostVisibility.PUBLIC,
              moderationStatus: ModerationStatus.APPROVED,
              publishedAt: '2026-04-18T09:00:00.000Z',
              primaryMedia: {
                id: 'media_1',
                url: 'https://cdn.example.com/look.jpg',
                thumbUrl: 'https://cdn.example.com/look-thumb.jpg',
                mediaType: MediaType.IMAGE,
              },
            },
          },
        ],
      })
    })
  })

  describe('mapLooksProProfilePreviewToDto', () => {
    it('maps the professional preview row directly into the DTO', () => {
      const row = makeProProfilePreviewRow()

      const result = mapLooksProProfilePreviewToDto(row)

      expect(result).toEqual({
        id: 'pro_1',
        businessName: 'TOVIS Studio',
        handle: 'tovisstudio',
        avatarUrl: 'https://cdn.example.com/pro-avatar.jpg',
        professionType: ProfessionType.BARBER,
        location: 'San Diego, CA',
        verificationStatus: VerificationStatus.APPROVED,
        isPremium: true,
      })
    })
  })
})