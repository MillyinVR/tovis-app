// lib/search/services.test.ts
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { SearchRequestError, encodeIdCursor } from './contracts'

const mocks = vi.hoisted(() => {
  const prisma = {
    service: {
      findMany: vi.fn(),
    },
  }

  return {
    prisma,
  }
})

vi.mock('@/lib/prisma', () => ({
  prisma: mocks.prisma,
}))

import { parseSearchServicesParams, searchServices } from './services'

describe('lib/search/services.ts', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.prisma.service.findMany.mockResolvedValue([])
  })

  describe('parseSearchServicesParams', () => {
    it('parses the stable default services search params', () => {
      const params = parseSearchServicesParams(
        new URLSearchParams('q=silk'),
      )

      expect(params).toEqual({
        q: 'silk',
        categoryId: null,
        cursorId: null,
        limit: 40,
      })
    })

    it('decodes a valid cursor and clamps limit', () => {
      const cursor = encodeIdCursor('svc_2')

      const params = parseSearchServicesParams(
        new URLSearchParams(
          `cursor=${encodeURIComponent(cursor)}&limit=999&categoryId=cat_hair`,
        ),
      )

      expect(params).toEqual({
        q: null,
        categoryId: 'cat_hair',
        cursorId: 'svc_2',
        limit: 40,
      })
    })

    it('throws a 400 SearchRequestError for an invalid cursor', () => {
      expect(() =>
        parseSearchServicesParams(
          new URLSearchParams('cursor=definitely-not-valid'),
        ),
      ).toThrowError(SearchRequestError)

      try {
        parseSearchServicesParams(
          new URLSearchParams('cursor=definitely-not-valid'),
        )
        throw new Error('expected parseSearchServicesParams to throw')
      } catch (error) {
        expect(error).toBeInstanceOf(SearchRequestError)
        expect((error as SearchRequestError).status).toBe(400)
        expect((error as SearchRequestError).message).toBe(
          'Invalid services search cursor.',
        )
      }
    })
  })

  describe('searchServices', () => {
    it('queries only active services and returns the stable DTO envelope', async () => {
      mocks.prisma.service.findMany.mockResolvedValue([
        {
          id: 'svc_1',
          name: 'Silk Press',
          category: {
            id: 'cat_hair',
            name: 'Hair',
            slug: 'hair',
          },
        },
      ])

      const result = await searchServices({
        q: null,
        categoryId: null,
        cursorId: null,
        limit: 40,
      })

      expect(mocks.prisma.service.findMany).toHaveBeenCalledWith({
        where: {
          isActive: true,
        },
        orderBy: [{ name: 'asc' }, { id: 'asc' }],
        select: {
          id: true,
          name: true,
          category: {
            select: {
              id: true,
              name: true,
              slug: true,
            },
          },
        },
      })

      expect(result).toEqual({
        items: [
          {
            id: 'svc_1',
            name: 'Silk Press',
            categoryId: 'cat_hair',
            categoryName: 'Hair',
            categorySlug: 'hair',
          },
        ],
        nextCursor: null,
      })

      expect(result.items[0]?.id).toBe('svc_1')
    })

    it('searches by service name and category name when q is provided', async () => {
      await searchServices({
        q: 'silk',
        categoryId: null,
        cursorId: null,
        limit: 40,
      })

      expect(mocks.prisma.service.findMany).toHaveBeenCalledWith({
        where: {
          isActive: true,
          OR: [
            {
              name: {
                contains: 'silk',
                mode: 'insensitive',
              },
            },
            {
              category: {
                name: {
                  contains: 'silk',
                  mode: 'insensitive',
                },
              },
            },
          ],
        },
        orderBy: [{ name: 'asc' }, { id: 'asc' }],
        select: {
          id: true,
          name: true,
          category: {
            select: {
              id: true,
              name: true,
              slug: true,
            },
          },
        },
      })
    })

    it('narrows the query by categoryId when provided', async () => {
      await searchServices({
        q: null,
        categoryId: 'cat_hair',
        cursorId: null,
        limit: 40,
      })

      expect(mocks.prisma.service.findMany).toHaveBeenCalledWith({
        where: {
          isActive: true,
          categoryId: 'cat_hair',
        },
        orderBy: [{ name: 'asc' }, { id: 'asc' }],
        select: {
          id: true,
          name: true,
          category: {
            select: {
              id: true,
              name: true,
              slug: true,
            },
          },
        },
      })
    })

    it('supports q and categoryId together without changing the stable result shape', async () => {
      mocks.prisma.service.findMany.mockResolvedValue([
        {
          id: 'svc_1',
          name: 'Silk Press',
          category: {
            id: 'cat_hair',
            name: 'Hair',
            slug: 'hair',
          },
        },
      ])

      const result = await searchServices({
        q: 'silk',
        categoryId: 'cat_hair',
        cursorId: null,
        limit: 40,
      })

      expect(mocks.prisma.service.findMany).toHaveBeenCalledWith({
        where: {
          isActive: true,
          categoryId: 'cat_hair',
          OR: [
            {
              name: {
                contains: 'silk',
                mode: 'insensitive',
              },
            },
            {
              category: {
                name: {
                  contains: 'silk',
                  mode: 'insensitive',
                },
              },
            },
          ],
        },
        orderBy: [{ name: 'asc' }, { id: 'asc' }],
        select: {
          id: true,
          name: true,
          category: {
            select: {
              id: true,
              name: true,
              slug: true,
            },
          },
        },
      })

      expect(result).toEqual({
        items: [
          {
            id: 'svc_1',
            name: 'Silk Press',
            categoryId: 'cat_hair',
            categoryName: 'Hair',
            categorySlug: 'hair',
          },
        ],
        nextCursor: null,
      })
    })

    it('emits nextCursor when more results exist than the requested limit', async () => {
      mocks.prisma.service.findMany.mockResolvedValue([
        {
          id: 'svc_1',
          name: 'Acrylic Fill',
          category: {
            id: 'cat_nails',
            name: 'Nails',
            slug: 'nails',
          },
        },
        {
          id: 'svc_2',
          name: 'Balayage',
          category: {
            id: 'cat_hair',
            name: 'Hair',
            slug: 'hair',
          },
        },
        {
          id: 'svc_3',
          name: 'Blowout',
          category: {
            id: 'cat_hair',
            name: 'Hair',
            slug: 'hair',
          },
        },
      ])

      const result = await searchServices({
        q: null,
        categoryId: null,
        cursorId: null,
        limit: 2,
      })

      expect(result).toEqual({
        items: [
          {
            id: 'svc_1',
            name: 'Acrylic Fill',
            categoryId: 'cat_nails',
            categoryName: 'Nails',
            categorySlug: 'nails',
          },
          {
            id: 'svc_2',
            name: 'Balayage',
            categoryId: 'cat_hair',
            categoryName: 'Hair',
            categorySlug: 'hair',
          },
        ],
        nextCursor: encodeIdCursor('svc_2'),
      })
    })

    it('resumes from cursorId for the next page', async () => {
      mocks.prisma.service.findMany.mockResolvedValue([
        {
          id: 'svc_1',
          name: 'Acrylic Fill',
          category: {
            id: 'cat_nails',
            name: 'Nails',
            slug: 'nails',
          },
        },
        {
          id: 'svc_2',
          name: 'Balayage',
          category: {
            id: 'cat_hair',
            name: 'Hair',
            slug: 'hair',
          },
        },
        {
          id: 'svc_3',
          name: 'Blowout',
          category: {
            id: 'cat_hair',
            name: 'Hair',
            slug: 'hair',
          },
        },
      ])

      const result = await searchServices({
        q: null,
        categoryId: null,
        cursorId: 'svc_2',
        limit: 1,
      })

      expect(result).toEqual({
        items: [
          {
            id: 'svc_3',
            name: 'Blowout',
            categoryId: 'cat_hair',
            categoryName: 'Hair',
            categorySlug: 'hair',
          },
        ],
        nextCursor: null,
      })
    })
  })
})