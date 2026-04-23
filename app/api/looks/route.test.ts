// app/api/looks/route.test.ts
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { MediaType, ProfessionType } from '@prisma/client'

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
    boardItem: {
      findMany: vi.fn(),
    },
    proFollow: {
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
    jsonOk,
    jsonFail,
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

import { GET } from './route'

function makeRequest(path: string): Request {
  return new Request(`http://localhost${path}`)
}

async function readJson(res: Response): Promise<unknown> {
  return res.json()
}

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

describe('app/api/looks/route.ts', () => {
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
    mocks.prisma.proFollow.findMany.mockResolvedValue([])

    mocks.mapLooksFeedMediaToDto.mockResolvedValue(null)
  })

  it('queries the default feed through shared look-post helpers and returns the new envelope', async () => {
    const sharedWhere = { whereToken: 'all-feed' }
    const sharedOrderBy = [{ publishedAt: 'desc' }, { id: 'desc' }]

    mocks.buildLooksFeedWhere.mockReturnValue(sharedWhere)
    mocks.buildLooksFeedOrderBy.mockReturnValue(sharedOrderBy)

    const res = await GET(makeRequest('/api/looks'))
    const body = await readJson(res)

    expect(res.status).toBe(200)

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

    expect(body).toEqual({
      ok: true,
      items: [],
      nextCursor: null,
    })

    expect(mocks.prisma.proFollow.findMany).not.toHaveBeenCalled()
    expect(mocks.prisma.lookLike.findMany).not.toHaveBeenCalled()
    expect(mocks.prisma.boardItem.findMany).not.toHaveBeenCalled()
    expect(mocks.mapLooksFeedMediaToDto).not.toHaveBeenCalled()
    expect(mocks.encodeLooksFeedCursor).not.toHaveBeenCalled()
  })

  it('hydrates viewer likes and saves, returns viewerContext, and emits nextCursor when another page exists', async () => {
    const look1 = makeLookRow('look_1')
    const look2 = makeLookRow('look_2')
    const look3 = makeLookRow('look_3')

    const dto1 = makeMappedDto('look_1', { viewerSaved: true })
    const dto2 = makeMappedDto('look_2', {
      viewerLiked: true,
      viewerSaved: false,
    })

    mocks.getCurrentUser.mockResolvedValue({
      id: 'user_1',
      clientProfile: { id: 'client_1' },
    })

    mocks.prisma.lookPost.findMany.mockResolvedValue([look1, look2, look3])
    mocks.prisma.lookLike.findMany.mockResolvedValue([{ lookPostId: 'look_2' }])
    mocks.prisma.boardItem.findMany.mockResolvedValue([{ lookPostId: 'look_1' }])

    mocks.mapLooksFeedMediaToDto
      .mockResolvedValueOnce(dto1)
      .mockResolvedValueOnce(dto2)

    const res = await GET(makeRequest('/api/looks?limit=2'))
    const body = await readJson(res)

    expect(res.status).toBe(200)

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

    expect(body).toEqual({
      ok: true,
      items: [dto1, dto2],
      nextCursor: 'next_cursor_1',
      viewerContext: {
        isAuthenticated: true,
      },
    })
  })

  it('loads followed pros for filter=following and passes them into shared feed helpers', async () => {
    mocks.getCurrentUser.mockResolvedValue({
      id: 'user_1',
      clientProfile: { id: 'client_1' },
    })

    mocks.resolveLooksFeedKind.mockReturnValue('FOLLOWING')
    mocks.prisma.proFollow.findMany.mockResolvedValue([
      { professionalId: 'pro_1' },
      { professionalId: 'pro_2' },
    ])

    const res = await GET(makeRequest('/api/looks?filter=following'))

    expect(res.status).toBe(200)

    expect(mocks.resolveLooksFeedKind).toHaveBeenCalledWith({
      filter: 'following',
      categorySlug: null,
      following: false,
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

    expect(mocks.buildLooksFeedCursorWhere).toHaveBeenCalledWith({
      kind: 'FOLLOWING',
      sort: null,
      cursor: null,
    })
  })

  it('still supports the legacy following=true alias', async () => {
    mocks.getCurrentUser.mockResolvedValue({
      id: 'user_1',
      clientProfile: { id: 'client_1' },
    })

    mocks.resolveLooksFeedKind.mockReturnValue('FOLLOWING')

    const res = await GET(makeRequest('/api/looks?following=true'))

    expect(res.status).toBe(200)

    expect(mocks.resolveLooksFeedKind).toHaveBeenCalledWith({
      filter: null,
      categorySlug: null,
      following: true,
    })
  })

  it('passes spotlight alias + search params through shared helpers and filters null mapped items', async () => {
    const look1 = makeLookRow('look_1', { spotlightScore: 91.5 })
    const look2 = makeLookRow('look_2', { spotlightScore: 88.2 })
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
    const body = await readJson(res)

    expect(res.status).toBe(200)

    expect(mocks.resolveLooksFeedKind).toHaveBeenCalledWith({
      filter: null,
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
      sort: null,
    })

    expect(body).toEqual({
      ok: true,
      items: [dto1],
      nextCursor: null,
    })

    expect(mocks.prisma.proFollow.findMany).not.toHaveBeenCalled()
    expect(mocks.prisma.lookLike.findMany).not.toHaveBeenCalled()
    expect(mocks.prisma.boardItem.findMany).not.toHaveBeenCalled()
  })

  it('supports ranked sort and cursor seek through shared feed helpers', async () => {
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

    mocks.parseLooksFeedSort.mockReturnValue('RANKED')
    mocks.decodeLooksFeedCursor.mockReturnValue(decodedCursor)
    mocks.buildLooksFeedWhere.mockReturnValue(sharedWhere)
    mocks.buildLooksFeedCursorWhere.mockReturnValue(cursorWhere)
    mocks.buildLooksFeedOrderBy.mockReturnValue(rankedOrderBy)

    const res = await GET(
      makeRequest(
        '/api/looks?sort=ranked&cursor=cursor_123&category=nails&q=fade',
      ),
    )
    const body = await readJson(res)

    expect(res.status).toBe(200)

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
      take: 13,
      select: mocks.looksFeedSelect,
    })

    expect(body).toEqual({
      ok: true,
      items: [],
      nextCursor: null,
    })
  })

  it('returns 400 for an invalid filter', async () => {
    mocks.resolveLooksFeedKind.mockReturnValue(null)

    const res = await GET(makeRequest('/api/looks?filter=banana'))
    const body = await readJson(res)

    expect(res.status).toBe(400)
    expect(body).toEqual({
      ok: false,
      error: 'Invalid looks filter.',
    })

    expect(mocks.buildLooksFeedWhere).not.toHaveBeenCalled()
    expect(mocks.buildLooksFeedCursorWhere).not.toHaveBeenCalled()
    expect(mocks.buildLooksFeedOrderBy).not.toHaveBeenCalled()
    expect(mocks.prisma.lookPost.findMany).not.toHaveBeenCalled()
  })

  it('returns 400 for an invalid sort', async () => {
    mocks.parseLooksFeedSort.mockReturnValue(null)

    const res = await GET(makeRequest('/api/looks?sort=chaos'))
    const body = await readJson(res)

    expect(res.status).toBe(400)
    expect(body).toEqual({
      ok: false,
      error: 'Invalid looks sort.',
    })

    expect(mocks.buildLooksFeedWhere).not.toHaveBeenCalled()
    expect(mocks.buildLooksFeedCursorWhere).not.toHaveBeenCalled()
    expect(mocks.buildLooksFeedOrderBy).not.toHaveBeenCalled()
    expect(mocks.prisma.lookPost.findMany).not.toHaveBeenCalled()
  })

  it('returns 400 for an invalid cursor', async () => {
    mocks.decodeLooksFeedCursor.mockReturnValue(null)

    const res = await GET(makeRequest('/api/looks?cursor=bad_cursor'))
    const body = await readJson(res)

    expect(res.status).toBe(400)
    expect(body).toEqual({
      ok: false,
      error: 'Invalid looks cursor.',
    })

    expect(mocks.buildLooksFeedWhere).not.toHaveBeenCalled()
    expect(mocks.buildLooksFeedCursorWhere).not.toHaveBeenCalled()
    expect(mocks.buildLooksFeedOrderBy).not.toHaveBeenCalled()
    expect(mocks.prisma.lookPost.findMany).not.toHaveBeenCalled()
  })

  it('returns 500 when loading the looks feed fails', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    mocks.prisma.lookPost.findMany.mockRejectedValue(new Error('db blew up'))

    const res = await GET(makeRequest('/api/looks'))
    const body = await readJson(res)

    expect(res.status).toBe(500)
    expect(body).toEqual({
      ok: false,
      error: 'Failed to load looks.',
    })

    consoleError.mockRestore()
  })
})