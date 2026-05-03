// lib/search/looks.test.ts
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { MediaType, ProfessionType } from '@prisma/client'

import { SearchRequestError } from './contracts'

const mocks = vi.hoisted(() => {
  const prisma = {
    lookPost: {
      findMany: vi.fn(),
    },
    lookLike: {
      findMany: vi.fn(),
    },
    boardItem: {
      findMany: vi.fn(),
    },
  }

  const getCurrentUser = vi.fn()
  const resolveLooksFeedKind = vi.fn()
  const buildLooksFeedWhere = vi.fn()
  const buildLooksFeedCursorWhere = vi.fn()
  const buildLooksFeedOrderBy = vi.fn()
  const parseLooksFeedSort = vi.fn()
  const decodeLooksFeedCursor = vi.fn()
  const encodeLooksFeedCursor = vi.fn()
  const mapLooksFeedMediaToDto = vi.fn()

  const looksFeedSelect = {
    __testSelect: 'looks-feed-select',
  }

  return {
    prisma,
    getCurrentUser,
    resolveLooksFeedKind,
    buildLooksFeedWhere,
    buildLooksFeedCursorWhere,
    buildLooksFeedOrderBy,
    parseLooksFeedSort,
    decodeLooksFeedCursor,
    encodeLooksFeedCursor,
    mapLooksFeedMediaToDto,
    looksFeedSelect,
  }
})

vi.mock('@/lib/prisma', () => ({
  prisma: mocks.prisma,
}))

vi.mock('@/lib/currentUser', () => ({
  getCurrentUser: mocks.getCurrentUser,
}))

vi.mock('@/lib/looks/feed', () => ({
  resolveLooksFeedKind: mocks.resolveLooksFeedKind,
  buildLooksFeedWhere: mocks.buildLooksFeedWhere,
  buildLooksFeedCursorWhere: mocks.buildLooksFeedCursorWhere,
  buildLooksFeedOrderBy: mocks.buildLooksFeedOrderBy,
  parseLooksFeedSort: mocks.parseLooksFeedSort,
  decodeLooksFeedCursor: mocks.decodeLooksFeedCursor,
  encodeLooksFeedCursor: mocks.encodeLooksFeedCursor,
}))

vi.mock('@/lib/looks/selects', () => ({
  looksFeedSelect: mocks.looksFeedSelect,
}))

vi.mock('@/lib/looks/mappers', () => ({
  mapLooksFeedMediaToDto: mocks.mapLooksFeedMediaToDto,
}))

import { searchLooks } from './looks'

function makeLookRow(
  id: string,
  overrides?: Partial<{
    publishedAt: Date
    spotlightScore: number
    rankScore: number
  }>,
) {
  return {
    id,
    publishedAt: new Date('2026-04-18T12:00:00.000Z'),
    spotlightScore: 0,
    rankScore: 0,
    ...overrides,
  }
}

function makeMappedDto(
  id: string,
  overrides?: Partial<{
    viewerLiked: boolean
    viewerSaved: boolean
  }>,
) {
  return {
    id,
    url: `https://cdn.example.com/${id}.jpg`,
    thumbUrl: `https://cdn.example.com/${id}-thumb.jpg`,
    mediaType: MediaType.IMAGE,
    caption: `${id} caption`,
    createdAt: '2026-04-18T12:00:00.000Z',
    professional: {
      id: `pro_${id}`,
      businessName: 'TOVIS Studio',
      handle: 'tovisstudio',
      avatarUrl: null,
      professionType: ProfessionType.BARBER,
      location: 'San Diego, CA',
    },
    serviceId: 'svc_1',
    serviceName: 'Fade',
    category: 'Hair',
    serviceIds: ['svc_1'],
    _count: {
      likes: 3,
      comments: 1,
    },
    viewerLiked: false,
    viewerSaved: false,
    uploadedByRole: null,
    reviewId: null,
    reviewHelpfulCount: null,
    reviewRating: null,
    reviewHeadline: null,
    ...overrides,
  }
}

describe('lib/search/looks.ts', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    mocks.getCurrentUser.mockResolvedValue(null)
    mocks.resolveLooksFeedKind.mockReturnValue('ALL')
    mocks.buildLooksFeedWhere.mockReturnValue({
      whereToken: 'default-where',
    })
    mocks.buildLooksFeedCursorWhere.mockReturnValue(undefined)
    mocks.buildLooksFeedOrderBy.mockReturnValue([
      { publishedAt: 'desc' },
      { id: 'desc' },
    ])
    mocks.parseLooksFeedSort.mockReturnValue(null)
    mocks.decodeLooksFeedCursor.mockReturnValue(null)
    mocks.encodeLooksFeedCursor.mockReturnValue('next_cursor_1')

    mocks.prisma.lookPost.findMany.mockResolvedValue([])
    mocks.prisma.lookLike.findMany.mockResolvedValue([])
    mocks.prisma.boardItem.findMany.mockResolvedValue([])

    mocks.mapLooksFeedMediaToDto.mockResolvedValue(null)
  })

  it('queries public looks search through shared helpers with no followingProfessionalIds', async () => {
    const sharedWhere = { whereToken: 'public-search-where' }
    const sharedOrderBy = [{ publishedAt: 'desc' }, { id: 'desc' }]

    mocks.buildLooksFeedWhere.mockReturnValue(sharedWhere)
    mocks.buildLooksFeedOrderBy.mockReturnValue(sharedOrderBy)

    const result = await searchLooks(new URLSearchParams(''))

    expect(mocks.resolveLooksFeedKind).toHaveBeenCalledWith({
      filter: null,
      categorySlug: null,
      following: false,
    })

    expect(mocks.parseLooksFeedSort).toHaveBeenCalledWith(null)
    expect(mocks.decodeLooksFeedCursor).toHaveBeenCalledWith(null)

    expect(mocks.buildLooksFeedWhere).toHaveBeenCalledWith({
      kind: 'ALL',
      categorySlug: null,
      q: null,
      followingProfessionalIds: [],
    })

    expect(mocks.buildLooksFeedCursorWhere).toHaveBeenCalledWith({
      kind: 'ALL',
      sort: null,
      cursor: null,
    })

    expect(mocks.buildLooksFeedOrderBy).toHaveBeenCalledWith({
      kind: 'ALL',
      sort: null,
    })

    expect(mocks.prisma.lookPost.findMany).toHaveBeenCalledWith({
      where: sharedWhere,
      orderBy: sharedOrderBy,
      take: 13,
      select: mocks.looksFeedSelect,
    })

    expect(result).toEqual({
      items: [],
      nextCursor: null,
    })

    expect(mocks.prisma.lookLike.findMany).not.toHaveBeenCalled()
    expect(mocks.prisma.boardItem.findMany).not.toHaveBeenCalled()
    expect(mocks.mapLooksFeedMediaToDto).not.toHaveBeenCalled()
    expect(mocks.encodeLooksFeedCursor).not.toHaveBeenCalled()
  })

  it('rejects following=true because looks search is public-search-only', async () => {
    await expect(
      searchLooks(new URLSearchParams('following=true')),
    ).rejects.toMatchObject({
      status: 400,
      message: 'Looks search does not support following.',
    })

    expect(mocks.resolveLooksFeedKind).not.toHaveBeenCalled()
    expect(mocks.buildLooksFeedWhere).not.toHaveBeenCalled()
    expect(mocks.prisma.lookPost.findMany).not.toHaveBeenCalled()
  })

  it('rejects filter=following because following stays owned by the feed route', async () => {
    await expect(
      searchLooks(new URLSearchParams('filter=following')),
    ).rejects.toMatchObject({
      status: 400,
      message: 'Looks search does not support following.',
    })

    expect(mocks.resolveLooksFeedKind).not.toHaveBeenCalled()
    expect(mocks.buildLooksFeedWhere).not.toHaveBeenCalled()
    expect(mocks.prisma.lookPost.findMany).not.toHaveBeenCalled()
  })

  it('returns the stable looks search envelope for valid q/category/sort/cursor/limit inputs', async () => {
    const sharedWhere = { whereToken: 'ranked-where' }
    const cursorWhere = { cursorToken: 'ranked-cursor-where' }
    const rankedOrderBy = [
      { rankScore: 'desc' },
      { publishedAt: 'desc' },
      { id: 'desc' },
    ]

    const decodedCursor = {
      rankScore: 42,
      publishedAt: new Date('2026-04-18T10:00:00.000Z'),
      id: 'look_ranked_1',
    }

    const look1 = makeLookRow('look_1')
    const dto1 = makeMappedDto('look_1')

    mocks.parseLooksFeedSort.mockReturnValue('RANKED')
    mocks.decodeLooksFeedCursor.mockReturnValue(decodedCursor)
    mocks.buildLooksFeedWhere.mockReturnValue(sharedWhere)
    mocks.buildLooksFeedCursorWhere.mockReturnValue(cursorWhere)
    mocks.buildLooksFeedOrderBy.mockReturnValue(rankedOrderBy)
    mocks.prisma.lookPost.findMany.mockResolvedValue([look1])
    mocks.mapLooksFeedMediaToDto.mockResolvedValueOnce(dto1)

    const result = await searchLooks(
      new URLSearchParams(
        'sort=ranked&cursor=cursor_123&category=nails&q=fade&limit=18',
      ),
    )

    expect(mocks.resolveLooksFeedKind).toHaveBeenCalledWith({
      filter: null,
      categorySlug: 'nails',
      following: false,
    })

    expect(mocks.parseLooksFeedSort).toHaveBeenCalledWith('ranked')
    expect(mocks.decodeLooksFeedCursor).toHaveBeenCalledWith('cursor_123')

    expect(mocks.buildLooksFeedWhere).toHaveBeenCalledWith({
      kind: 'ALL',
      categorySlug: 'nails',
      q: 'fade',
      followingProfessionalIds: [],
    })

    expect(mocks.buildLooksFeedCursorWhere).toHaveBeenCalledWith({
      kind: 'ALL',
      sort: 'RANKED',
      cursor: decodedCursor,
    })

    expect(mocks.buildLooksFeedOrderBy).toHaveBeenCalledWith({
      kind: 'ALL',
      sort: 'RANKED',
    })

    expect(mocks.prisma.lookPost.findMany).toHaveBeenCalledWith({
      where: {
        AND: [sharedWhere, cursorWhere],
      },
      orderBy: rankedOrderBy,
      take: 19,
      select: mocks.looksFeedSelect,
    })

    expect(mocks.mapLooksFeedMediaToDto).toHaveBeenCalledWith({
      item: look1,
      viewerLiked: false,
      viewerSaved: false,
    })

    expect(result).toEqual({
      items: [dto1],
      nextCursor: null,
    })
  })

  it('hydrates viewer likes, saved state, and viewerContext for an authenticated viewer', async () => {
    const look1 = makeLookRow('look_1')
    const look2 = makeLookRow('look_2')
    const look3 = makeLookRow('look_3')

    const dto1 = makeMappedDto('look_1', { viewerSaved: true })
    const dto2 = makeMappedDto('look_2', { viewerLiked: true })

    mocks.getCurrentUser.mockResolvedValue({
      id: 'user_1',
      clientProfile: { id: 'client_1' },
    })

    mocks.prisma.lookPost.findMany.mockResolvedValue([look1, look2, look3])
    mocks.prisma.lookLike.findMany.mockResolvedValue([
      { lookPostId: 'look_2' },
    ])
    mocks.prisma.boardItem.findMany.mockResolvedValue([
      { lookPostId: 'look_1' },
    ])

    mocks.mapLooksFeedMediaToDto
      .mockResolvedValueOnce(dto1)
      .mockResolvedValueOnce(dto2)

    const result = await searchLooks(new URLSearchParams('limit=2'))

    expect(mocks.prisma.lookPost.findMany).toHaveBeenCalledWith({
      where: { whereToken: 'default-where' },
      orderBy: [{ publishedAt: 'desc' }, { id: 'desc' }],
      take: 3,
      select: mocks.looksFeedSelect,
    })

    expect(mocks.prisma.lookLike.findMany).toHaveBeenCalledWith({
      where: {
        userId: 'user_1',
        lookPostId: { in: ['look_1', 'look_2'] },
      },
      select: { lookPostId: true },
    })

    expect(mocks.prisma.boardItem.findMany).toHaveBeenCalledWith({
      where: {
        lookPostId: { in: ['look_1', 'look_2'] },
        board: {
          clientId: 'client_1',
        },
      },
      select: { lookPostId: true },
    })

    expect(mocks.mapLooksFeedMediaToDto).toHaveBeenCalledTimes(2)

    expect(mocks.mapLooksFeedMediaToDto).toHaveBeenNthCalledWith(1, {
      item: look1,
      viewerLiked: false,
      viewerSaved: true,
    })

    expect(mocks.mapLooksFeedMediaToDto).toHaveBeenNthCalledWith(2, {
      item: look2,
      viewerLiked: true,
      viewerSaved: false,
    })

    expect(mocks.encodeLooksFeedCursor).toHaveBeenCalledWith({
      kind: 'ALL',
      sort: null,
      row: look2,
    })

    expect(result).toEqual({
      items: [dto1, dto2],
      nextCursor: 'next_cursor_1',
      viewerContext: {
        isAuthenticated: true,
      },
    })
  })

  it('returns 400-style SearchRequestError for an invalid filter', async () => {
    mocks.resolveLooksFeedKind.mockReturnValue(null)

    await expect(
      searchLooks(new URLSearchParams('filter=banana')),
    ).rejects.toMatchObject({
      status: 400,
      message: 'Invalid looks filter.',
    })

    expect(mocks.buildLooksFeedWhere).not.toHaveBeenCalled()
    expect(mocks.buildLooksFeedCursorWhere).not.toHaveBeenCalled()
    expect(mocks.buildLooksFeedOrderBy).not.toHaveBeenCalled()
    expect(mocks.prisma.lookPost.findMany).not.toHaveBeenCalled()
  })

  it('returns 400-style SearchRequestError for an invalid sort', async () => {
    mocks.parseLooksFeedSort.mockReturnValue(null)

    await expect(
      searchLooks(new URLSearchParams('sort=chaos')),
    ).rejects.toMatchObject({
      status: 400,
      message: 'Invalid looks sort.',
    })

    expect(mocks.buildLooksFeedWhere).not.toHaveBeenCalled()
    expect(mocks.buildLooksFeedCursorWhere).not.toHaveBeenCalled()
    expect(mocks.buildLooksFeedOrderBy).not.toHaveBeenCalled()
    expect(mocks.prisma.lookPost.findMany).not.toHaveBeenCalled()
  })

  it('returns 400-style SearchRequestError for an invalid cursor', async () => {
    mocks.decodeLooksFeedCursor.mockReturnValue(null)

    await expect(
      searchLooks(new URLSearchParams('cursor=bad_cursor')),
    ).rejects.toMatchObject({
      status: 400,
      message: 'Invalid looks cursor.',
    })

    expect(mocks.buildLooksFeedWhere).not.toHaveBeenCalled()
    expect(mocks.buildLooksFeedCursorWhere).not.toHaveBeenCalled()
    expect(mocks.buildLooksFeedOrderBy).not.toHaveBeenCalled()
    expect(mocks.prisma.lookPost.findMany).not.toHaveBeenCalled()
  })

  it('throws SearchRequestError instances for contract validation failures', async () => {
    mocks.decodeLooksFeedCursor.mockReturnValue(null)

    try {
      await searchLooks(new URLSearchParams('cursor=bad_cursor'))
      throw new Error('expected searchLooks to throw')
    } catch (error) {
      expect(error).toBeInstanceOf(SearchRequestError)
      expect((error as SearchRequestError).status).toBe(400)
      expect((error as SearchRequestError).message).toBe(
        'Invalid looks cursor.',
      )
    }
  })
})