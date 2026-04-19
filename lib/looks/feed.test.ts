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
  decodeLooksFeedCursor,
  encodeLooksFeedCursor,
  parseLooksFeedSort,
  resolveLooksFeedKind,
} from './feed'

describe('lib/looks/feed.ts', () => {
  describe('resolveLooksFeedKind', () => {
    it('resolves FOLLOWING ahead of spotlight/category handling', () => {
      expect(
        resolveLooksFeedKind({
          filter: 'all',
          categorySlug: LOOKS_SPOTLIGHT_SLUG,
          following: true,
        }),
      ).toBe('FOLLOWING')
    })

    it('resolves SPOTLIGHT for the spotlight slug when no explicit filter is set', () => {
      expect(
        resolveLooksFeedKind({
          categorySlug: LOOKS_SPOTLIGHT_SLUG,
        }),
      ).toBe('SPOTLIGHT')
    })

    it('resolves ALL by default', () => {
      expect(resolveLooksFeedKind({})).toBe('ALL')
    })

    it('resolves explicit filter values', () => {
      expect(resolveLooksFeedKind({ filter: 'all' })).toBe('ALL')
      expect(resolveLooksFeedKind({ filter: 'following' })).toBe('FOLLOWING')
      expect(resolveLooksFeedKind({ filter: 'spotlight' })).toBe('SPOTLIGHT')
    })

    it('returns null for an invalid filter', () => {
      expect(resolveLooksFeedKind({ filter: 'banana' })).toBeNull()
    })
  })

  describe('parseLooksFeedSort', () => {
    it('parses supported sort values', () => {
      expect(parseLooksFeedSort(null)).toBeNull()
      expect(parseLooksFeedSort(undefined)).toBeNull()
      expect(parseLooksFeedSort('recent')).toBe('RECENT')
      expect(parseLooksFeedSort('ranked')).toBe('RANKED')
      expect(parseLooksFeedSort('  ranked  ')).toBe('RANKED')
    })

    it('returns null for unsupported sort values', () => {
      expect(parseLooksFeedSort('spotlight')).toBeNull()
      expect(parseLooksFeedSort('chaos')).toBeNull()
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
    it('uses spotlight ordering for spotlight feeds by default', () => {
      expect(
        buildLooksFeedOrderBy({
          kind: 'SPOTLIGHT',
          sort: null,
        }),
      ).toEqual([
        { spotlightScore: 'desc' },
        { publishedAt: 'desc' },
        { id: 'desc' },
      ])
    })

    it('uses recent ordering for the all feed by default', () => {
      expect(
        buildLooksFeedOrderBy({
          kind: 'ALL',
          sort: null,
        }),
      ).toEqual([
        { publishedAt: 'desc' },
        { id: 'desc' },
      ])
    })

    it('uses ranked ordering when sort=RANKED', () => {
      expect(
        buildLooksFeedOrderBy({
          kind: 'ALL',
          sort: 'RANKED',
        }),
      ).toEqual([
        { rankScore: 'desc' },
        { publishedAt: 'desc' },
        { id: 'desc' },
      ])
    })

    it('keeps spotlight ordering when spotlight feed explicitly asks for RECENT', () => {
      expect(
        buildLooksFeedOrderBy({
          kind: 'SPOTLIGHT',
          sort: 'RECENT',
        }),
      ).toEqual([
        { spotlightScore: 'desc' },
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
          sort: null,
          cursor: null,
        }),
      ).toBeUndefined()
    })

    it('builds standard seek pagination for recent ALL/FOLLOWING feeds', () => {
      const cursor = {
        publishedAt: new Date('2026-04-18T12:00:00.000Z'),
        id: 'look_123',
      } as const

      expect(
        buildLooksFeedCursorWhere({
          kind: 'ALL',
          sort: null,
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
          sort: 'RECENT',
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
          sort: null,
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

    it('builds ranked seek pagination using rankScore, publishedAt, and id', () => {
      const cursor = {
        rankScore: 47,
        publishedAt: new Date('2026-04-18T12:00:00.000Z'),
        id: 'look_ranked_1',
      } as const

      expect(
        buildLooksFeedCursorWhere({
          kind: 'ALL',
          sort: 'RANKED',
          cursor,
        }),
      ).toEqual({
        OR: [
          {
            rankScore: {
              lt: 47,
            },
          },
          {
            rankScore: 47,
            publishedAt: {
              lt: cursor.publishedAt,
            },
          },
          {
            rankScore: 47,
            publishedAt: cursor.publishedAt,
            id: {
              lt: 'look_ranked_1',
            },
          },
        ],
      })
    })

    it('returns undefined when the cursor shape does not match the active order mode', () => {
      expect(
        buildLooksFeedCursorWhere({
          kind: 'SPOTLIGHT',
          sort: null,
          cursor: {
            publishedAt: new Date('2026-04-18T12:00:00.000Z'),
            id: 'look_123',
          },
        }),
      ).toBeUndefined()

      expect(
        buildLooksFeedCursorWhere({
          kind: 'ALL',
          sort: 'RANKED',
          cursor: {
            publishedAt: new Date('2026-04-18T12:00:00.000Z'),
            id: 'look_123',
          },
        }),
      ).toBeUndefined()
    })
  })

  describe('looks feed cursor encoding', () => {
    it('round-trips a recent cursor', () => {
      const token = encodeLooksFeedCursor({
        kind: 'ALL',
        sort: null,
        row: {
          id: 'look_recent_1',
          publishedAt: new Date('2026-04-18T12:00:00.000Z'),
          spotlightScore: 0,
          rankScore: 12,
        },
      })

      expect(token).toEqual(expect.any(String))
      expect(decodeLooksFeedCursor(token)).toEqual({
        id: 'look_recent_1',
        publishedAt: new Date('2026-04-18T12:00:00.000Z'),
      })
    })

    it('round-trips a spotlight cursor', () => {
      const token = encodeLooksFeedCursor({
        kind: 'SPOTLIGHT',
        sort: null,
        row: {
          id: 'look_spotlight_1',
          publishedAt: new Date('2026-04-18T12:00:00.000Z'),
          spotlightScore: 91.25,
          rankScore: 33,
        },
      })

      expect(token).toEqual(expect.any(String))
      expect(decodeLooksFeedCursor(token)).toEqual({
        id: 'look_spotlight_1',
        publishedAt: new Date('2026-04-18T12:00:00.000Z'),
        spotlightScore: 91.25,
      })
    })

    it('round-trips a ranked cursor', () => {
      const token = encodeLooksFeedCursor({
        kind: 'ALL',
        sort: 'RANKED',
        row: {
          id: 'look_ranked_1',
          publishedAt: new Date('2026-04-18T12:00:00.000Z'),
          spotlightScore: 8,
          rankScore: 54.5,
        },
      })

      expect(token).toEqual(expect.any(String))
      expect(decodeLooksFeedCursor(token)).toEqual({
        id: 'look_ranked_1',
        publishedAt: new Date('2026-04-18T12:00:00.000Z'),
        rankScore: 54.5,
      })
    })

    it('returns null for malformed cursor tokens', () => {
      expect(decodeLooksFeedCursor(null)).toBeNull()
      expect(decodeLooksFeedCursor(undefined)).toBeNull()
      expect(decodeLooksFeedCursor('')).toBeNull()
      expect(decodeLooksFeedCursor('this-is-not-valid-base64url')).toBeNull()
    })

    it('returns null when encoding a row without publishedAt', () => {
      const token = encodeLooksFeedCursor({
        kind: 'ALL',
        sort: null,
        row: {
          id: 'look_missing_date',
          publishedAt: null,
          spotlightScore: 0,
          rankScore: 0,
        },
      })

      expect(token).toBeNull()
    })
  })
})