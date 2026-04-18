// app/api/looks/route.test.ts
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { MediaType, ProfessionType, Role } from '@prisma/client'

const mocks = vi.hoisted(() => {
  const jsonOk = vi.fn((data: unknown, status = 200) => {
    return new Response(JSON.stringify(data), {
      status,
      headers: { 'content-type': 'application/json' },
    })
  })

  const jsonFail = vi.fn((status: number, message: string) => {
    return new Response(JSON.stringify({ ok: false, error: message }), {
      status,
      headers: { 'content-type': 'application/json' },
    })
  })

  const prisma = {
    mediaAsset: {
      findMany: vi.fn(),
    },
    mediaLike: {
      findMany: vi.fn(),
    },
  }

  const getCurrentUser = vi.fn()
  const resolveLooksMediaFeedKind = vi.fn()
  const buildLooksMediaFeedWhere = vi.fn()
  const buildLooksMediaFeedOrderBy = vi.fn()
  const mapLooksFeedMediaToDto = vi.fn()

  const looksFeedMediaSelect = {
    __testSelect: 'looks-feed-media-select',
  }

  return {
    jsonOk,
    jsonFail,
    prisma,
    getCurrentUser,
    resolveLooksMediaFeedKind,
    buildLooksMediaFeedWhere,
    buildLooksMediaFeedOrderBy,
    mapLooksFeedMediaToDto,
    looksFeedMediaSelect,
  }
})

vi.mock('@/app/api/_utils', () => ({
  jsonOk: mocks.jsonOk,
  jsonFail: mocks.jsonFail,
  pickInt: (value: string | null) => {
    if (!value) return null
    const parsed = Number.parseInt(value, 10)
    return Number.isFinite(parsed) ? parsed : null
  },
  pickString: (value: string | null) => {
    if (typeof value !== 'string') return null
    const trimmed = value.trim()
    return trimmed.length > 0 ? trimmed : null
  },
}))

vi.mock('@/lib/prisma', () => ({
  prisma: mocks.prisma,
}))

vi.mock('@/lib/currentUser', () => ({
  getCurrentUser: mocks.getCurrentUser,
}))

vi.mock('@/lib/looks/feed', () => ({
  resolveLooksMediaFeedKind: mocks.resolveLooksMediaFeedKind,
  buildLooksMediaFeedWhere: mocks.buildLooksMediaFeedWhere,
  buildLooksMediaFeedOrderBy: mocks.buildLooksMediaFeedOrderBy,
}))

vi.mock('@/lib/looks/selects', () => ({
  looksFeedMediaSelect: mocks.looksFeedMediaSelect,
}))

vi.mock('@/lib/looks/mappers', () => ({
  mapLooksFeedMediaToDto: mocks.mapLooksFeedMediaToDto,
}))

import { GET } from './route'

function makeRequest(path: string): Request {
  return new Request(`http://localhost${path}`)
}

async function readJson<T>(res: Response): Promise<T> {
  return (await res.json()) as T
}

function makeMediaRow(id: string) {
  return { id }
}

function makeMappedDto(id: string) {
  return {
    id,
    url: `https://cdn.example.com/${id}.jpg`,
    thumbUrl: `https://cdn.example.com/${id}-thumb.jpg`,
    mediaType: MediaType.IMAGE,
    caption: `${id} caption`,
    createdAt: '2026-04-01T12:00:00.000Z',
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
    uploadedByRole: Role.PRO,
    reviewId: null,
    reviewHelpfulCount: null,
    reviewRating: null,
    reviewHeadline: null,
  }
}

describe('app/api/looks/route.ts', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    mocks.getCurrentUser.mockResolvedValue(null)
    mocks.resolveLooksMediaFeedKind.mockReturnValue('ALL')
    mocks.buildLooksMediaFeedWhere.mockReturnValue({
      whereToken: 'default-where',
    })
    mocks.buildLooksMediaFeedOrderBy.mockReturnValue({
      createdAt: 'desc',
    })
    mocks.prisma.mediaAsset.findMany.mockResolvedValue([])
    mocks.prisma.mediaLike.findMany.mockResolvedValue([])
    mocks.mapLooksFeedMediaToDto.mockResolvedValue(null)
  })

  it('queries the looks feed through shared feed helpers', async () => {
    const sharedWhere = { whereToken: 'all-feed' }
    const sharedOrderBy = [{ createdAt: 'desc' }]

    mocks.resolveLooksMediaFeedKind.mockReturnValue('ALL')
    mocks.buildLooksMediaFeedWhere.mockReturnValue(sharedWhere)
    mocks.buildLooksMediaFeedOrderBy.mockReturnValue(sharedOrderBy)

    const res = await GET(makeRequest('/api/looks'))

    expect(res.status).toBe(200)

    expect(mocks.resolveLooksMediaFeedKind).toHaveBeenCalledWith({
      categorySlug: null,
    })

    expect(mocks.buildLooksMediaFeedWhere).toHaveBeenCalledWith({
      kind: 'ALL',
      categorySlug: null,
      q: null,
    })

    expect(mocks.buildLooksMediaFeedOrderBy).toHaveBeenCalledWith({
      kind: 'ALL',
    })

    expect(mocks.prisma.mediaAsset.findMany).toHaveBeenCalledWith({
      where: sharedWhere,
      orderBy: sharedOrderBy,
      take: 12,
      select: mocks.looksFeedMediaSelect,
    })

    expect(mocks.prisma.mediaLike.findMany).not.toHaveBeenCalled()
    expect(mocks.mapLooksFeedMediaToDto).not.toHaveBeenCalled()
  })

  it('hydrates viewer likes and returns mapped payload', async () => {
    const media1 = makeMediaRow('media_1')
    const media2 = makeMediaRow('media_2')
    const dto1 = makeMappedDto('media_1')
    const dto2 = {
      ...makeMappedDto('media_2'),
      viewerLiked: true,
    }

    mocks.getCurrentUser.mockResolvedValue({ id: 'user_1' })
    mocks.prisma.mediaAsset.findMany.mockResolvedValue([media1, media2])
    mocks.prisma.mediaLike.findMany.mockResolvedValue([{ mediaId: 'media_2' }])

    mocks.mapLooksFeedMediaToDto
      .mockResolvedValueOnce(dto1)
      .mockResolvedValueOnce(dto2)

    const res = await GET(makeRequest('/api/looks?limit=20'))
    const body = await readJson<{
      ok: true
      items: Array<typeof dto1>
    }>(res)

    expect(res.status).toBe(200)

    expect(mocks.prisma.mediaAsset.findMany).toHaveBeenCalledWith({
      where: { whereToken: 'default-where' },
      orderBy: { createdAt: 'desc' },
      take: 20,
      select: mocks.looksFeedMediaSelect,
    })

    expect(mocks.prisma.mediaLike.findMany).toHaveBeenCalledWith({
      where: {
        userId: 'user_1',
        mediaId: { in: ['media_1', 'media_2'] },
      },
      select: { mediaId: true },
    })

    expect(mocks.mapLooksFeedMediaToDto).toHaveBeenNthCalledWith(1, {
      item: media1,
      viewerLiked: false,
    })

    expect(mocks.mapLooksFeedMediaToDto).toHaveBeenNthCalledWith(2, {
      item: media2,
      viewerLiked: true,
    })

    expect(body).toEqual({
      ok: true,
      items: [dto1, dto2],
    })
  })

  it('passes spotlight and search params through shared feed helpers and filters null mapped items', async () => {
    const media1 = makeMediaRow('media_1')
    const media2 = makeMediaRow('media_2')
    const dto1 = makeMappedDto('media_1')

    mocks.resolveLooksMediaFeedKind.mockReturnValue('SPOTLIGHT')
    mocks.buildLooksMediaFeedWhere.mockReturnValue({
      whereToken: 'spotlight-where',
    })
    mocks.buildLooksMediaFeedOrderBy.mockReturnValue([
      { review: { helpfulCount: 'desc' } },
      { createdAt: 'desc' },
    ])
    mocks.prisma.mediaAsset.findMany.mockResolvedValue([media1, media2])

    mocks.mapLooksFeedMediaToDto
      .mockResolvedValueOnce(dto1)
      .mockResolvedValueOnce(null)

    const res = await GET(
      makeRequest('/api/looks?category=spotlight&q=fade&limit=18'),
    )
    const body = await readJson<{
      ok: true
      items: Array<typeof dto1>
    }>(res)

    expect(res.status).toBe(200)

    expect(mocks.resolveLooksMediaFeedKind).toHaveBeenCalledWith({
      categorySlug: 'spotlight',
    })

    expect(mocks.buildLooksMediaFeedWhere).toHaveBeenCalledWith({
      kind: 'SPOTLIGHT',
      categorySlug: 'spotlight',
      q: 'fade',
    })

    expect(mocks.buildLooksMediaFeedOrderBy).toHaveBeenCalledWith({
      kind: 'SPOTLIGHT',
    })

    expect(body).toEqual({
      ok: true,
      items: [dto1],
    })

    expect(mocks.prisma.mediaLike.findMany).not.toHaveBeenCalled()
  })

  it('returns 500 when loading the looks feed fails', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    mocks.prisma.mediaAsset.findMany.mockRejectedValue(new Error('db blew up'))

    const res = await GET(makeRequest('/api/looks'))
    const body = await readJson<{ ok: false; error: string }>(res)

    expect(res.status).toBe(500)
    expect(body).toEqual({
      ok: false,
      error: 'Failed to load looks.',
    })

    consoleError.mockRestore()
  })
})