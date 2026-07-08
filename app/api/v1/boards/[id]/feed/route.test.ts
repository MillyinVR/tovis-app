// app/api/v1/boards/[id]/feed/route.test.ts
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { BoardType } from '@prisma/client'

const mocks = vi.hoisted(() => {
  const jsonOk = vi.fn(
    (data: unknown, status = 200) =>
      new Response(JSON.stringify(data), {
        status,
        headers: { 'content-type': 'application/json' },
      }),
  )
  const jsonFail = vi.fn(
    (status: number, message: string, details?: Record<string, unknown> | null) =>
      new Response(
        JSON.stringify({ ok: false, error: message, ...(details ?? {}) }),
        { status, headers: { 'content-type': 'application/json' } },
      ),
  )

  return {
    jsonOk,
    jsonFail,
    prisma: {},
    requireClient: vi.fn(),
    requireBoardOwner: vi.fn(),
    getBoardErrorMeta: vi.fn(),
    buildBoardFeedPage: vi.fn(),
    decodeLooksFeedCursor: vi.fn(),
    mapLooksFeedMediaToDto: vi.fn(),
    buildLooksViewerFlagResolver: vi.fn(),
    loadClientLinkViewer: vi.fn(),
    resolveTenantContextForRequest: vi.fn(),
    parseSeenLookIds: vi.fn(),
    logLooksFeedServe: vi.fn(),
  }
})

vi.mock('@/app/api/_utils', () => ({
  jsonOk: mocks.jsonOk,
  jsonFail: mocks.jsonFail,
  pickString: (v: string | null) => {
    if (typeof v !== 'string') return null
    const t = v.trim()
    return t.length > 0 ? t : null
  },
  pickInt: (v: string | null) => {
    if (typeof v !== 'string') return null
    const n = Number.parseInt(v, 10)
    return Number.isFinite(n) ? n : null
  },
}))
vi.mock('@/app/api/_utils/auth/requireClient', () => ({
  requireClient: mocks.requireClient,
}))
vi.mock('@/app/api/_utils/routeContext', () => ({
  resolveRouteParams: (ctx: { params: unknown }) => Promise.resolve(ctx.params),
}))
vi.mock('@/lib/prisma', () => ({ prisma: mocks.prisma }))
vi.mock('@/lib/boards', () => ({
  requireBoardOwner: mocks.requireBoardOwner,
  getBoardErrorMeta: mocks.getBoardErrorMeta,
}))
vi.mock('@/lib/looks/boardFeed', () => ({
  buildBoardFeedPage: mocks.buildBoardFeedPage,
}))
vi.mock('@/lib/looks/feed', () => ({
  decodeLooksFeedCursor: mocks.decodeLooksFeedCursor,
}))
vi.mock('@/lib/looks/mappers', () => ({
  mapLooksFeedMediaToDto: mocks.mapLooksFeedMediaToDto,
}))
vi.mock('@/lib/looks/viewerFlags', () => ({
  buildLooksViewerFlagResolver: mocks.buildLooksViewerFlagResolver,
}))
vi.mock('@/lib/clientVisibility', () => ({
  loadClientLinkViewer: mocks.loadClientLinkViewer,
}))
vi.mock('@/lib/tenant', () => ({
  resolveTenantContextForRequest: mocks.resolveTenantContextForRequest,
}))
vi.mock('@/lib/looks/personalizedFeed', () => ({
  parseSeenLookIds: mocks.parseSeenLookIds,
}))
vi.mock('@/lib/observability/looksFeedEvents', () => ({
  logLooksFeedServe: mocks.logLooksFeedServe,
}))

import { GET } from './route'

type Ctx = { params: { id: string } }

function req(url = 'https://x.test/api/v1/boards/b1/feed'): Request {
  return new Request(url)
}

const OWNER_BOARD = {
  id: 'b1',
  clientId: 'c1',
  type: BoardType.BRIDAL,
  eventDate: null,
  answers: null,
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.requireClient.mockResolvedValue({
    ok: true,
    clientId: 'c1',
    user: { id: 'u1', clientProfile: { id: 'c1' } },
  })
  mocks.requireBoardOwner.mockResolvedValue(OWNER_BOARD)
  mocks.decodeLooksFeedCursor.mockReturnValue(null)
  mocks.parseSeenLookIds.mockReturnValue(new Set())
  mocks.resolveTenantContextForRequest.mockResolvedValue({ isRoot: true })
  mocks.getBoardErrorMeta.mockReturnValue(null)
  mocks.buildBoardFeedPage.mockResolvedValue({
    items: [{ id: 'look_1' }],
    nextCursor: null,
    meta: {
      backboneCount: 1,
      injectedCount: 0,
      savedExcludedCount: 0,
      seenCount: 0,
      occasionTagCount: 4,
      answerTagCount: 0,
      feasibilityTagCount: 0,
      tasteSignalCount: 0,
      candidateEmbeddingCount: 0,
    },
  })
  mocks.buildLooksViewerFlagResolver.mockResolvedValue(() => ({
    viewerLiked: false,
    viewerSaved: false,
    viewerFollows: false,
  }))
  mocks.loadClientLinkViewer.mockResolvedValue({})
  mocks.mapLooksFeedMediaToDto.mockImplementation((args: { item: { id: string } }) =>
    Promise.resolve({ id: args.item.id }),
  )
})

describe('GET /api/v1/boards/[id]/feed', () => {
  it('returns the mapped board recommendations for the owner', async () => {
    const res = await GET(req(), { params: { id: 'b1' } } as Ctx)
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      ok: boolean
      items: Array<{ id: string }>
      nextCursor: string | null
    }
    expect(body.ok).toBe(true)
    expect(body.items).toEqual([{ id: 'look_1' }])
    expect(body.nextCursor).toBeNull()
    expect(mocks.buildBoardFeedPage).toHaveBeenCalledOnce()
    expect(mocks.logLooksFeedServe).toHaveBeenCalledWith(
      expect.objectContaining({ cohort: 'board_feed' }),
    )
  })

  it('propagates the auth failure response when the viewer is not a client', async () => {
    const failRes = new Response('nope', { status: 403 })
    mocks.requireClient.mockResolvedValue({ ok: false, res: failRes })

    const res = await GET(req(), { params: { id: 'b1' } } as Ctx)
    expect(res).toBe(failRes)
    expect(mocks.buildBoardFeedPage).not.toHaveBeenCalled()
  })

  it('maps a board ownership error to its status (404/403)', async () => {
    mocks.requireBoardOwner.mockRejectedValue(new Error('Board not found.'))
    mocks.getBoardErrorMeta.mockReturnValue({
      status: 404,
      message: 'Board not found.',
      code: 'BOARD_NOT_FOUND',
    })

    const res = await GET(req(), { params: { id: 'missing' } } as Ctx)
    expect(res.status).toBe(404)
    expect(mocks.buildBoardFeedPage).not.toHaveBeenCalled()
  })

  it('rejects an unparseable cursor with 400', async () => {
    mocks.decodeLooksFeedCursor.mockReturnValue(null)
    const res = await GET(
      req('https://x.test/api/v1/boards/b1/feed?cursor=garbage'),
      { params: { id: 'b1' } } as Ctx,
    )
    expect(res.status).toBe(400)
    expect(mocks.buildBoardFeedPage).not.toHaveBeenCalled()
  })
})
