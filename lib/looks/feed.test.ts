import { describe, expect, it } from 'vitest'
import { MediaVisibility, Role } from '@prisma/client'

import {
  LOOKS_SPOTLIGHT_HELPFUL_THRESHOLD,
  LOOKS_SPOTLIGHT_SLUG,
  buildLooksMediaFeedOrderBy,
  buildLooksMediaFeedWhere,
  resolveLooksMediaFeedKind,
} from './feed'

describe('lib/looks/feed.ts', () => {
  it('resolves FOLLOWING ahead of spotlight/category handling', () => {
    expect(
      resolveLooksMediaFeedKind({
        categorySlug: LOOKS_SPOTLIGHT_SLUG,
        following: true,
      }),
    ).toBe('FOLLOWING')
  })

  it('resolves SPOTLIGHT for the spotlight slug', () => {
    expect(
      resolveLooksMediaFeedKind({
        categorySlug: LOOKS_SPOTLIGHT_SLUG,
      }),
    ).toBe('SPOTLIGHT')
  })

  it('resolves ALL by default', () => {
    expect(resolveLooksMediaFeedKind({})).toBe('ALL')
  })

  it('builds spotlight feed filters from shared policy', () => {
    const where = buildLooksMediaFeedWhere({
      kind: 'SPOTLIGHT',
    })

    expect(where.visibility).toBe(MediaVisibility.PUBLIC)
    expect(where.professional).toEqual({
      is: {
        verificationStatus: {
          in: expect.any(Array),
        },
      },
    })

    const andFilters = Array.isArray(where.AND) ? where.AND : []
    expect(andFilters).toEqual(
      expect.arrayContaining([
        { reviewId: { not: null } },
        { uploadedByRole: Role.CLIENT },
        {
          review: {
            is: {
              helpfulCount: {
                gte: LOOKS_SPOTLIGHT_HELPFUL_THRESHOLD,
              },
            },
          },
        },
      ]),
    )
  })

  it('builds category and text-search filters for the all feed', () => {
    const where = buildLooksMediaFeedWhere({
      kind: 'ALL',
      categorySlug: 'nails',
      q: 'gloss',
    })

    const andFilters = Array.isArray(where.AND) ? where.AND : []
    expect(andFilters).toEqual(
      expect.arrayContaining([
        {
          OR: [
            { isEligibleForLooks: true },
            { isFeaturedInPortfolio: true },
          ],
        },
        {
          services: {
            some: {
              service: {
                category: {
                  is: { slug: 'nails' },
                },
              },
            },
          },
        },
        {
          OR: [
            { caption: { contains: 'gloss', mode: 'insensitive' } },
            {
              professional: {
                businessName: {
                  contains: 'gloss',
                  mode: 'insensitive',
                },
              },
            },
            {
              professional: {
                handle: {
                  contains: 'gloss',
                  mode: 'insensitive',
                },
              },
            },
          ],
        },
      ]),
    )
  })

  it('builds an empty following guard when following ids are absent', () => {
    const where = buildLooksMediaFeedWhere({
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

  it('uses spotlight ordering only for spotlight feeds', () => {
    expect(
      buildLooksMediaFeedOrderBy({
        kind: 'SPOTLIGHT',
      }),
    ).toEqual([
      { review: { helpfulCount: 'desc' } },
      { createdAt: 'desc' },
      { id: 'desc' },
    ])

    expect(
      buildLooksMediaFeedOrderBy({
        kind: 'ALL',
      }),
    ).toEqual([
      { createdAt: 'desc' },
      { id: 'desc' },
    ])
  })
})