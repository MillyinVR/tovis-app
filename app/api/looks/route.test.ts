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
    lookPost: {
      findMany: vi.fn(),
    },
    lookLike: {
      findMany: vi.fn(),
    },
    proFollow: {
      findMany: vi.fn(),
    },
  }

  const getCurrentUser = vi.fn()
  const resolveLooksFeedKind = vi.fn()
  const buildLooksFeedWhere = vi.fn()
  const buildLooksFeedOrderBy = vi.fn()
  const mapLooksFeedMediaToDto = vi.fn()

  const looksFeedSelect = {
    __testSelect: 'looks-feed-select',
  }

  return {
    jsonOk,
    jsonFail,
    prisma,
    getCurrentUser,
    resolveLooksFeedKind,
    buildLooksFeedWhere,
    buildLooksFeedOrderBy,
    mapLooksFeedMediaToDto,
    looksFeedSelect,
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
  resolveLooksFeedKind: mocks.resolveLooksFeedKind,
  buildLooksFeedWhere: mocks.buildLooksFeedWhere,
  buildLooksFeedOrderBy: mocks.buildLooksFeedOrderBy,
}))

vi.mock('@/lib/looks/selects', () => ({
  looksFeedSelect: mocks.looksFeedSelect,
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

function makeLookRow(id: string) {
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
    uploadedByRole: null,
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
    mocks.resolveLooksFeedKind.mockReturnValue('ALL')
    mocks.buildLooksFeedWhere.mockReturnValue({
      whereToken: 'default-where',
    })
    mocks.buildLooksFeedOrderBy.mockReturnValue({
      publishedAt: 'desc',
    })
    mocks.prisma.lookPost.findMany.mockResolvedValue([])
    mocks.prisma.lookLike.findMany.mockResolvedValue([])
    mocks.prisma.proFollow.findMany.mockResolvedValue([])
    mocks.mapLooksFeedMediaToDto.mockResolvedValue(null)
  })

  it('queries the looks feed through shared look-post feed helpers', async () => {
    const sharedWhere = { whereToken: 'all-feed' }
    const sharedOrderBy = [{ publishedAt: 'desc' }]

    mocks.resolveLooksFeedKind.mockReturnValue('ALL')
    mocks.buildLooksFeedWhere.mockReturnValue(sharedWhere)
    mocks.buildLooksFeedOrderBy.mockReturnValue(sharedOrderBy)

    const res = await GET(makeRequest('/api/looks'))

    expect(res.status).toBe(200)

    expect(mocks.resolveLooksFeedKind).toHaveBeenCalledWith({
      categorySlug: null,
      following: false,
    })

    expect(mocks.buildLooksFeedWhere).toHaveBeenCalledWith({
      kind: 'ALL',
      categorySlug: null,
      q: null,
      followingProfessionalIds: [],
    })

    expect(mocks.buildLooksFeedOrderBy).toHaveBeenCalledWith({
      kind: 'ALL',
    })

    expect(mocks.prisma.lookPost.findMany).toHaveBeenCalledWith({
      where: sharedWhere,
      orderBy: sharedOrderBy,
      take: 12,
      select: mocks.looksFeedSelect,
    })

    expect(mocks.prisma.proFollow.findMany).not.toHaveBeenCalled()
    expect(mocks.prisma.lookLike.findMany).not.toHaveBeenCalled()
    expect(mocks.mapLooksFeedMediaToDto).not.toHaveBeenCalled()
  })

  it('hydrates viewer likes and returns mapped payload', async () => {
    const look1 = makeLookRow('look_1')
    const look2 = makeLookRow('look_2')
    const dto1 = makeMappedDto('look_1')
    const dto2 = {
      ...makeMappedDto('look_2'),
      viewerLiked: true,
    }

    mocks.getCurrentUser.mockResolvedValue({
      id: 'user_1',
      clientProfile: { id: 'client_1' },
    })
    mocks.prisma.lookPost.findMany.mockResolvedValue([look1, look2])
    mocks.prisma.lookLike.findMany.mockResolvedValue([
      { lookPostId: 'look_2' },
    ])

    mocks.mapLooksFeedMediaToDto
      .mockResolvedValueOnce(dto1)
      .mockResolvedValueOnce(dto2)

    const res = await GET(makeRequest('/api/looks?limit=20'))
    const body = await readJson<{
      ok: true
      items: Array<typeof dto1>
    }>(res)

    expect(res.status).toBe(200)

    expect(mocks.prisma.lookPost.findMany).toHaveBeenCalledWith({
      where: { whereToken: 'default-where' },
      orderBy: { publishedAt: 'desc' },
      take: 20,
      select: mocks.looksFeedSelect,
    })

    expect(mocks.prisma.lookLike.findMany).toHaveBeenCalledWith({
      where: {
        userId: 'user_1',
        lookPostId: { in: ['look_1', 'look_2'] },
      },
      select: { lookPostId: true },
    })

    expect(mocks.mapLooksFeedMediaToDto).toHaveBeenNthCalledWith(1, {
      item: look1,
      viewerLiked: false,
    })

    expect(mocks.mapLooksFeedMediaToDto).toHaveBeenNthCalledWith(2, {
      item: look2,
      viewerLiked: true,
    })

    expect(body).toEqual({
      ok: true,
      items: [dto1, dto2],
    })
  })

  it('loads followed pros for the following feed and passes them into shared feed helpers', async () => {
    mocks.getCurrentUser.mockResolvedValue({
      id: 'user_1',
      clientProfile: { id: 'client_1' },
    })
    mocks.resolveLooksFeedKind.mockReturnValue('FOLLOWING')
    mocks.prisma.proFollow.findMany.mockResolvedValue([
      { professionalId: 'pro_1' },
      { professionalId: 'pro_2' },
    ])

    const res = await GET(makeRequest('/api/looks?following=true'))

    expect(res.status).toBe(200)

    expect(mocks.resolveLooksFeedKind).toHaveBeenCalledWith({
      categorySlug: null,
      following: true,
    })

    expect(mocks.prisma.proFollow.findMany).toHaveBeenCalledWith({
      where: {
        clientId: 'client_1',
      },
      select: {
        professionalId: true,
      },
    })

    expect(mocks.buildLooksFeedWhere).toHaveBeenCalledWith({
      kind: 'FOLLOWING',
      categorySlug: null,
      q: null,
      followingProfessionalIds: ['pro_1', 'pro_2'],
    })
  })

  it('passes spotlight and search params through shared feed helpers and filters null mapped items', async () => {
    const look1 = makeLookRow('look_1')
    const look2 = makeLookRow('look_2')
    const dto1 = makeMappedDto('look_1')

    mocks.resolveLooksFeedKind.mockReturnValue('SPOTLIGHT')
    mocks.buildLooksFeedWhere.mockReturnValue({
      whereToken: 'spotlight-where',
    })
    mocks.buildLooksFeedOrderBy.mockReturnValue([
      { spotlightScore: 'desc' },
      { publishedAt: 'desc' },
      { id: 'desc' },
    ])
    mocks.prisma.lookPost.findMany.mockResolvedValue([look1, look2])

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

    expect(mocks.resolveLooksFeedKind).toHaveBeenCalledWith({
      categorySlug: 'spotlight',
      following: false,
    })

    expect(mocks.buildLooksFeedWhere).toHaveBeenCalledWith({
      kind: 'SPOTLIGHT',
      categorySlug: 'spotlight',
      q: 'fade',
      followingProfessionalIds: [],
    })

    expect(mocks.buildLooksFeedOrderBy).toHaveBeenCalledWith({
      kind: 'SPOTLIGHT',
    })

    expect(body).toEqual({
      ok: true,
      items: [dto1],
    })

    expect(mocks.prisma.proFollow.findMany).not.toHaveBeenCalled()
    expect(mocks.prisma.lookLike.findMany).not.toHaveBeenCalled()
  })

  it('returns 500 when loading the looks feed fails', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    mocks.prisma.lookPost.findMany.mockRejectedValue(new Error('db blew up'))

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