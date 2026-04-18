// lib/looks/mappers.test.ts
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  BoardVisibility,
  LookPostStatus,
  LookPostVisibility,
  MediaType,
  MediaVisibility,
  ModerationStatus,
  ProfessionType,
  Role,
  VerificationStatus,
} from '@prisma/client'

const mocks = vi.hoisted(() => ({
  renderMediaUrls: vi.fn(),
}))

vi.mock('@/lib/media/renderUrls', () => ({
  renderMediaUrls: mocks.renderMediaUrls,
}))

import type {
  LooksBoardPreviewRow,
  LooksDetailMediaRow,
  LooksFeedMediaRow,
  LooksProProfilePreviewRow,
} from '@/lib/looks/selects'
import {
  mapLooksBoardPreviewToDto,
  mapLooksCommentToDto,
  mapLooksDetailMediaToRenderable,
  mapLooksFeedMediaToDto,
  mapLooksProProfilePreviewToDto,
  mapPortfolioTileToDto,
  mapReviewMediaAssetToDto,
  parseLooksCommentsResponse,
  parseLooksFeedResponse,
} from './mappers'

function makeFeedRow(
  overrides?: Partial<LooksFeedMediaRow>,
): LooksFeedMediaRow {
  return {
    id: 'media_1',
    url: 'https://cdn.example.com/media.jpg',
    thumbUrl: 'https://cdn.example.com/media-thumb.jpg',
    storageBucket: 'media-public',
    storagePath: 'looks/media_1.jpg',
    thumbBucket: 'media-public',
    thumbPath: 'looks/media_1-thumb.jpg',
    mediaType: MediaType.IMAGE,
    caption: 'Fresh cut',
    createdAt: new Date('2026-04-18T12:00:00.000Z'),
    uploadedByRole: Role.CLIENT,
    uploadedByUserId: 'user_1',
    reviewId: 'review_1',
    review: {
      id: 'review_1',
      helpfulCount: 42,
      rating: 5,
      headline: 'Love it',
    },
    professional: {
      id: 'pro_1',
      businessName: 'TOVIS Studio',
      handle: 'tovisstudio',
      avatarUrl: 'https://cdn.example.com/pro-avatar.jpg',
      professionType: ProfessionType.BARBER,
      location: 'San Diego, CA',
    },
    services: [
      {
        id: 'tag_1',
        serviceId: 'service_1',
        service: {
          id: 'service_1',
          name: 'Fade',
          category: {
            name: 'Hair',
            slug: 'hair',
          },
        },
      },
    ],
    _count: {
      likes: 9,
      comments: 3,
    },
    ...overrides,
  }
}

function makeDetailRow(
  overrides?: Partial<LooksDetailMediaRow>,
): LooksDetailMediaRow {
  return {
    id: 'media_1',
    professionalId: 'pro_1',
    url: 'https://cdn.example.com/detail.jpg',
    thumbUrl: 'https://cdn.example.com/detail-thumb.jpg',
    storageBucket: 'media-public',
    storagePath: 'looks/detail.jpg',
    thumbBucket: 'media-public',
    thumbPath: 'looks/detail-thumb.jpg',
    mediaType: MediaType.IMAGE,
    caption: 'Detailed caption',
    createdAt: new Date('2026-04-18T12:00:00.000Z'),
    visibility: MediaVisibility.PUBLIC,
    isEligibleForLooks: true,
    isFeaturedInPortfolio: false,
    professional: {
      id: 'pro_1',
      businessName: 'TOVIS Studio',
      handle: 'tovisstudio',
      avatarUrl: 'https://cdn.example.com/pro-avatar.jpg',
      professionType: ProfessionType.BARBER,
      location: 'San Diego, CA',
      verificationStatus: VerificationStatus.APPROVED,
    },
    services: [
      {
        id: 'tag_1',
        serviceId: 'service_1',
        service: {
          id: 'service_1',
          name: 'Fade',
          category: {
            name: 'Hair',
            slug: 'hair',
          },
        },
      },
    ],
    review: {
      id: 'review_1',
      rating: 5,
      headline: 'Love it',
      body: 'Looks amazing',
      createdAt: new Date('2026-04-17T12:00:00.000Z'),
      helpfulCount: 8,
    },
    _count: {
      likes: 4,
      comments: 2,
    },
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
    it('maps a feed row into the stable feed DTO', async () => {
      const row = makeFeedRow()

      const result = await mapLooksFeedMediaToDto({
        item: row,
        viewerLiked: true,
      })

      expect(result).toEqual({
        id: 'media_1',
        url: 'https://cdn.example.com/media.jpg',
        thumbUrl: 'https://cdn.example.com/media-thumb.jpg',
        mediaType: MediaType.IMAGE,
        caption: 'Fresh cut',
        createdAt: '2026-04-18T12:00:00.000Z',
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
        serviceId: 'service_1',
        serviceName: 'Fade',
        category: 'Hair',
        serviceIds: ['service_1'],
        uploadedByRole: Role.CLIENT,
        reviewId: 'review_1',
        reviewHelpfulCount: 42,
        reviewRating: 5,
        reviewHeadline: 'Love it',
      })

      expect(mocks.renderMediaUrls).not.toHaveBeenCalled()
    })

    it('uses rendered URLs when direct URLs are missing', async () => {
      const row = makeFeedRow({
        url: null,
        thumbUrl: null,
      })

      const result = await mapLooksFeedMediaToDto({
        item: row,
        viewerLiked: false,
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
        url: null,
        thumbUrl: null,
      })

      mocks.renderMediaUrls.mockResolvedValueOnce({
        renderUrl: null,
        renderThumbUrl: null,
      })

      const result = await mapLooksFeedMediaToDto({
        item: row,
        viewerLiked: false,
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
    it('maps a portfolio tile and collects service ids from both explicit and nested service ids', async () => {
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
    it('returns the detail row with renderUrl fields attached', async () => {
      const row = makeDetailRow({
        url: null,
        thumbUrl: null,
      })

      const result = await mapLooksDetailMediaToRenderable(row)

      expect(result).not.toBeNull()
      expect(result?.renderUrl).toBe(
        'https://rendered.example.com/media.jpg',
      )
      expect(result?.renderThumbUrl).toBe(
        'https://rendered.example.com/media-thumb.jpg',
      )
      expect(result?.professional.verificationStatus).toBe(
        VerificationStatus.APPROVED,
      )
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

  describe('parseLooksFeedResponse', () => {
    it('parses valid feed payload rows into typed DTOs', () => {
      const result = parseLooksFeedResponse({
        items: [
          {
            id: 'media_1',
            url: 'https://cdn.example.com/media.jpg',
            thumbUrl: 'https://cdn.example.com/media-thumb.jpg',
            mediaType: MediaType.IMAGE,
            caption: 'Fresh cut',
            createdAt: '2026-04-18T12:00:00.000Z',
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
            serviceId: 'service_1',
            serviceName: 'Fade',
            category: 'Hair',
            serviceIds: ['service_1'],
            uploadedByRole: Role.CLIENT,
            reviewId: 'review_1',
            reviewHelpfulCount: 42,
            reviewRating: 5,
            reviewHeadline: 'Love it',
          },
        ],
      })

      expect(result).toEqual([
        {
          id: 'media_1',
          url: 'https://cdn.example.com/media.jpg',
          thumbUrl: 'https://cdn.example.com/media-thumb.jpg',
          mediaType: MediaType.IMAGE,
          caption: 'Fresh cut',
          createdAt: '2026-04-18T12:00:00.000Z',
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
          serviceId: 'service_1',
          serviceName: 'Fade',
          category: 'Hair',
          serviceIds: ['service_1'],
          uploadedByRole: Role.CLIENT,
          reviewId: 'review_1',
          reviewHelpfulCount: 42,
          reviewRating: 5,
          reviewHeadline: 'Love it',
        },
      ])
    })

    it('skips invalid feed payload rows', () => {
      const result = parseLooksFeedResponse({
        items: [
          {
            id: 'bad_1',
            url: null,
            mediaType: MediaType.IMAGE,
            createdAt: '2026-04-18T12:00:00.000Z',
            _count: { likes: 1, comments: 1 },
            viewerLiked: true,
          },
          {
            id: 'bad_2',
            url: 'https://cdn.example.com/media.jpg',
            mediaType: 'NOT_REAL',
            createdAt: '2026-04-18T12:00:00.000Z',
            _count: { likes: 1, comments: 1 },
            viewerLiked: true,
          },
        ],
      })

      expect(result).toEqual([])
    })

    it('nulls invalid role and professionType values instead of trusting junk', () => {
      const result = parseLooksFeedResponse({
        items: [
          {
            id: 'media_1',
            url: 'https://cdn.example.com/media.jpg',
            thumbUrl: null,
            mediaType: MediaType.IMAGE,
            caption: null,
            createdAt: '2026-04-18T12:00:00.000Z',
            professional: {
              id: 'pro_1',
              businessName: 'TOVIS Studio',
              handle: 'tovisstudio',
              professionType: 'SPACE_WIZARD',
              avatarUrl: null,
              location: null,
            },
            _count: {
              likes: 1,
              comments: 2,
            },
            viewerLiked: false,
            serviceId: null,
            serviceName: null,
            category: null,
            serviceIds: [],
            uploadedByRole: 'CHAOS_GREMLIN',
            reviewId: null,
            reviewHelpfulCount: null,
            reviewRating: null,
            reviewHeadline: null,
          },
        ],
      })

      expect(result).toEqual([
        {
          id: 'media_1',
          url: 'https://cdn.example.com/media.jpg',
          thumbUrl: null,
          mediaType: MediaType.IMAGE,
          caption: null,
          createdAt: '2026-04-18T12:00:00.000Z',
          professional: {
            id: 'pro_1',
            businessName: 'TOVIS Studio',
            handle: 'tovisstudio',
            professionType: null,
            avatarUrl: null,
            location: null,
          },
          _count: {
            likes: 1,
            comments: 2,
          },
          viewerLiked: false,
          serviceId: null,
          serviceName: null,
          category: null,
          serviceIds: [],
          uploadedByRole: null,
          reviewId: null,
          reviewHelpfulCount: null,
          reviewRating: null,
          reviewHeadline: null,
        },
      ])
    })
  })

  describe('parseLooksCommentsResponse', () => {
    it('parses valid comments payload rows', () => {
      const result = parseLooksCommentsResponse({
        comments: [
          {
            id: 'comment_1',
            body: 'This is fire',
            createdAt: '2026-04-18T12:00:00.000Z',
            user: {
              id: 'user_1',
              displayName: 'Tori Morales',
              avatarUrl: 'https://cdn.example.com/avatar.jpg',
            },
          },
        ],
      })

      expect(result).toEqual([
        {
          id: 'comment_1',
          body: 'This is fire',
          createdAt: '2026-04-18T12:00:00.000Z',
          user: {
            id: 'user_1',
            displayName: 'Tori Morales',
            avatarUrl: 'https://cdn.example.com/avatar.jpg',
          },
        },
      ])
    })

    it('skips malformed comments payload rows', () => {
      const result = parseLooksCommentsResponse({
        comments: [
          {
            id: 'comment_1',
            body: '',
            createdAt: '2026-04-18T12:00:00.000Z',
            user: {
              id: 'user_1',
              displayName: 'Tori Morales',
              avatarUrl: null,
            },
          },
          {
            id: 'comment_2',
            body: 'valid body',
            createdAt: '2026-04-18T12:00:00.000Z',
            user: {
              id: '',
              displayName: 'Tori Morales',
              avatarUrl: null,
            },
          },
        ],
      })

      expect(result).toEqual([])
    })
  })
})