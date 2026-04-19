// lib/looks/feed.test.ts
import { describe, expect, it } from 'vitest'
import {
  LookPostStatus,
  LookPostVisibility,
  ModerationStatus,
} from '@prisma/client'

import {
  LOOKS_SPOTLIGHT_SLUG,
  buildLooksFeedCursorWhere,
  buildLooksFeedOrderBy,
  buildLooksFeedWhere,
  resolveLooksFeedKind,
} from './feed'

describe('lib/looks/feed.ts', () => {
  describe('resolveLooksFeedKind', () => {
    it('resolves FOLLOWING ahead of spotlight/category handling', () => {
      expect(
        resolveLooksFeedKind({
          categorySlug: LOOKS_SPOTLIGHT_SLUG,
          following: true,
        }),
      ).toBe('FOLLOWING')
    })

    it('resolves SPOTLIGHT for the spotlight slug', () => {
      expect(
        resolveLooksFeedKind({
          categorySlug: LOOKS_SPOTLIGHT_SLUG,
        }),
      ).toBe('SPOTLIGHT')
    })

    it('resolves ALL by default', () => {
      expect(resolveLooksFeedKind({})).toBe('ALL')
    })
  })

  describe('buildLooksFeedWhere', () => {
    it('builds shared published/approved/pro-verified policy for spotlight', () => {
      const where = buildLooksFeedWhere({
        kind: 'SPOTLIGHT',
      })

      expect(where).toMatchObject({
        status: LookPostStatus.PUBLISHED,
        moderationStatus: ModerationStatus.APPROVED,
        publishedAt: { not: null },
        professional: {
          is: {
            verificationStatus: {
              in: expect.any(Array),
            },
          },
        },
      })

      const andFilters = Array.isArray(where.AND) ? where.AND : []

      expect(andFilters).toContainEqual({
        visibility: LookPostVisibility.PUBLIC,
      })
    })

    it('builds category and text-search filters for the all feed', () => {
      const where = buildLooksFeedWhere({
        kind: 'ALL',
        categorySlug: 'nails',
        q: 'gloss',
      })

      expect(where).toMatchObject({
        status: LookPostStatus.PUBLISHED,
        moderationStatus: ModerationStatus.APPROVED,
        publishedAt: { not: null },
      })

      const andFilters = Array.isArray(where.AND) ? where.AND : []

      expect(andFilters).toEqual(
        expect.arrayContaining([
          {
            visibility: LookPostVisibility.PUBLIC,
          },
          {
            service: {
              is: {
                category: {
                  is: { slug: 'nails' },
                },
              },
            },
          },
          {
            OR: [
              { caption: { contains: 'gloss', mode: 'insensitive' } },
              {
                professional: {
                  is: {
                    businessName: {
                      contains: 'gloss',
                      mode: 'insensitive',
                    },
                  },
                },
              },
              {
                professional: {
                  is: {
                    handle: {
                      contains: 'gloss',
                      mode: 'insensitive',
                    },
                  },
                },
              },
              {
                service: {
                  is: {
                    name: {
                      contains: 'gloss',
                      mode: 'insensitive',
                    },
                  },
                },
              },
              {
                service: {
                  is: {
                    category: {
                      is: {
                        name: {
                          contains: 'gloss',
                          mode: 'insensitive',
                        },
                      },
                    },
                  },
                },
              },
            ],
          },
        ]),
      )
    })

    it('includes followers-only visibility for the following feed', () => {
      const where = buildLooksFeedWhere({
        kind: 'FOLLOWING',
        followingProfessionalIds: ['pro_1', 'pro_2'],
      })

      const andFilters = Array.isArray(where.AND) ? where.AND : []

      expect(andFilters).toEqual(
        expect.arrayContaining([
          {
            visibility: {
              in: [
                LookPostVisibility.PUBLIC,
                LookPostVisibility.FOLLOWERS_ONLY,
              ],
            },
          },
          {
            professionalId: {
              in: ['pro_1', 'pro_2'],
            },
          },
        ]),
      )
    })

    it('builds an empty following guard when following ids are absent', () => {
      const where = buildLooksFeedWhere({
        kind: 'FOLLOWING',
        followingProfessionalIds: [],
      })

      const andFilters = Array.isArray(where.AND) ? where.AND : []

      expect(andFilters).toContainEqual({
        professionalId: {
          in: [],
        },
      })
    })

    it('dedupes and trims following professional ids', () => {
      const where = buildLooksFeedWhere({
        kind: 'FOLLOWING',
        followingProfessionalIds: ['pro_1', ' pro_1 ', '', 'pro_2'],
      })

      const andFilters = Array.isArray(where.AND) ? where.AND : []
      const followingFilter = andFilters.find(
        (filter) =>
          typeof filter === 'object' &&
          filter !== null &&
          'professionalId' in filter,
      )

      expect(followingFilter).toEqual({
        professionalId: {
          in: ['pro_1', 'pro_2'],
        },
      })
    })
  })

  describe('buildLooksFeedOrderBy', () => {
    it('uses spotlight ordering only for spotlight feeds', () => {
      expect(
        buildLooksFeedOrderBy({
          kind: 'SPOTLIGHT',
        }),
      ).toEqual([
        { spotlightScore: 'desc' },
        { publishedAt: 'desc' },
        { id: 'desc' },
      ])

      expect(
        buildLooksFeedOrderBy({
          kind: 'ALL',
        }),
      ).toEqual([
        { publishedAt: 'desc' },
        { id: 'desc' },
      ])
    })
  })

  describe('buildLooksFeedCursorWhere', () => {
    it('returns undefined when no cursor is provided', () => {
      expect(
        buildLooksFeedCursorWhere({
          kind: 'ALL',
          cursor: null,
        }),
      ).toBeUndefined()
    })

    it('builds standard seek pagination for ALL/FOLLOWING feeds', () => {
      const cursor = {
        publishedAt: new Date('2026-04-18T12:00:00.000Z'),
        id: 'look_123',
      } as const

      expect(
        buildLooksFeedCursorWhere({
          kind: 'ALL',
          cursor,
        }),
      ).toEqual({
        OR: [
          {
            publishedAt: {
              lt: cursor.publishedAt,
            },
          },
          {
            publishedAt: cursor.publishedAt,
            id: {
              lt: cursor.id,
            },
          },
        ],
      })

      expect(
        buildLooksFeedCursorWhere({
          kind: 'FOLLOWING',
          cursor,
        }),
      ).toEqual({
        OR: [
          {
            publishedAt: {
              lt: cursor.publishedAt,
            },
          },
          {
            publishedAt: cursor.publishedAt,
            id: {
              lt: cursor.id,
            },
          },
        ],
      })
    })

    it('builds spotlight seek pagination using spotlightScore, publishedAt, and id', () => {
      const cursor = {
        spotlightScore: 87.5,
        publishedAt: new Date('2026-04-18T12:00:00.000Z'),
        id: 'look_999',
      } as const

      expect(
        buildLooksFeedCursorWhere({
          kind: 'SPOTLIGHT',
          cursor,
        }),
      ).toEqual({
        OR: [
          {
            spotlightScore: {
              lt: 87.5,
            },
          },
          {
            spotlightScore: 87.5,
            publishedAt: {
              lt: cursor.publishedAt,
            },
          },
          {
            spotlightScore: 87.5,
            publishedAt: cursor.publishedAt,
            id: {
              lt: 'look_999',
            },
          },
        ],
      })
    })
  })
})