import { describe, expect, it } from 'vitest'
import {
  LookPostStatus,
  LookPostVisibility,
  MediaType,
  ModerationStatus,
  ProfessionType,
  VerificationStatus,
} from '@prisma/client'

import {
  parseLooksCommentsResponse,
  parseLooksDetailResponse,
  parseLooksFeedEnvelope,
  parseLooksFeedResponse,
} from './parsers'

function makeFeedDto(
  overrides?: Partial<{
    id: string
    url: string
    thumbUrl: string | null
    mediaType: MediaType
    caption: string | null
    createdAt: string
    professional: {
      id: string
      businessName: string | null
      handle: string | null
      professionType: ProfessionType | null
      avatarUrl: string | null
      location: string | null
    } | null
    _count: {
      likes: number
      comments: number
    }
    viewerLiked: boolean
    viewerSaved: boolean
    serviceId: string | null
    serviceName: string | null
    category: string | null
    serviceIds: string[]
    uploadedByRole: string | null
    reviewId: string | null
    reviewHelpfulCount: number | null
    reviewRating: number | null
    reviewHeadline: string | null
  }>,
) {
  return {
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
    ...overrides,
  }
}

describe('lib/looks/parsers.ts', () => {
  describe('parseLooksFeedResponse', () => {
    it('parses valid feed payload rows into typed DTOs', () => {
      const result = parseLooksFeedResponse({
        items: [makeFeedDto()],
      })

      expect(result).toEqual([makeFeedDto()])
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
          makeFeedDto({
            thumbUrl: null,
            caption: null,
            professional: {
              id: 'pro_1',
              businessName: 'TOVIS Studio',
              handle: 'tovisstudio',
              professionType: 'SPACE_WIZARD' as never,
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
          }),
        ],
      })

      expect(result).toEqual([
        {
          id: 'look_1',
          url: 'https://cdn.example.com/media.jpg',
          thumbUrl: null,
          mediaType: MediaType.IMAGE,
          caption: null,
          createdAt: '2026-04-18T13:00:00.000Z',
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
          viewerSaved: false,
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

  describe('parseLooksFeedEnvelope', () => {
    it('parses the full feed envelope with nextCursor and viewerContext', () => {
      const result = parseLooksFeedEnvelope({
        items: [makeFeedDto()],
        nextCursor: 'cursor_123',
        viewerContext: {
          isAuthenticated: true,
        },
      })

      expect(result).toEqual({
        items: [makeFeedDto()],
        nextCursor: 'cursor_123',
        viewerContext: {
          isAuthenticated: true,
        },
      })
    })

    it('defaults nextCursor to null when it is missing or invalid', () => {
      expect(
        parseLooksFeedEnvelope({
          items: [makeFeedDto()],
        }),
      ).toEqual({
        items: [makeFeedDto()],
        nextCursor: null,
      })

      expect(
        parseLooksFeedEnvelope({
          items: [makeFeedDto()],
          nextCursor: 123,
        }),
      ).toEqual({
        items: [makeFeedDto()],
        nextCursor: null,
      })
    })

    it('omits malformed viewerContext instead of trusting junk', () => {
      const result = parseLooksFeedEnvelope({
        items: [makeFeedDto()],
        nextCursor: 'cursor_123',
        viewerContext: {
          isAuthenticated: 'yes absolutely',
        },
      })

      expect(result).toEqual({
        items: [makeFeedDto()],
        nextCursor: 'cursor_123',
      })
    })

    it('returns an empty safe envelope for malformed payloads', () => {
      expect(parseLooksFeedEnvelope(null)).toEqual({
        items: [],
        nextCursor: null,
      })

      expect(parseLooksFeedEnvelope('not an object')).toEqual({
        items: [],
        nextCursor: null,
      })
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

  describe('parseLooksDetailResponse', () => {
    it('parses a valid detail payload into the stable DTO shape', () => {
      const result = parseLooksDetailResponse({
        item: {
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
            avatarUrl: null,
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
            url: 'https://cdn.example.com/look.jpg',
            thumbUrl: null,
            mediaType: MediaType.IMAGE,
            caption: null,
            createdAt: '2026-04-18T10:30:00.000Z',
            review: null,
          },
          assets: [],
          _count: {
            likes: 1,
            comments: 2,
            saves: 3,
            shares: 4,
          },
          viewerContext: {
            isAuthenticated: false,
            viewerLiked: false,
            canComment: true,
            canSave: true,
            isOwner: false,
          },
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
          avatarUrl: null,
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
          url: 'https://cdn.example.com/look.jpg',
          thumbUrl: null,
          mediaType: MediaType.IMAGE,
          caption: null,
          createdAt: '2026-04-18T10:30:00.000Z',
          review: null,
        },
        assets: [],
        _count: {
          likes: 1,
          comments: 2,
          saves: 3,
          shares: 4,
        },
        viewerContext: {
          isAuthenticated: false,
          viewerLiked: false,
          canComment: true,
          canSave: true,
          isOwner: false,
        },
      })
    })

    it('returns null for malformed detail payloads', () => {
      const result = parseLooksDetailResponse({
        item: {
          id: 'look_1',
          status: LookPostStatus.PUBLISHED,
          visibility: LookPostVisibility.PUBLIC,
          moderationStatus: ModerationStatus.APPROVED,
          createdAt: '2026-04-18T11:00:00.000Z',
          updatedAt: '2026-04-18T12:30:00.000Z',
          professional: {
            id: 'pro_1',
            verificationStatus: VerificationStatus.APPROVED,
            isPremium: true,
          },
          primaryMedia: {
            id: 'media_1',
            url: 'https://cdn.example.com/look.jpg',
            mediaType: MediaType.IMAGE,
            createdAt: '2026-04-18T10:30:00.000Z',
          },
          _count: {
            likes: 1,
            comments: 2,
            saves: 3,
            shares: 4,
          },
          viewerContext: {
            isAuthenticated: 'nope',
            viewerLiked: false,
            canComment: true,
            canSave: true,
            isOwner: false,
          },
        },
      })

      expect(result).toBeNull()
    })
  })
})