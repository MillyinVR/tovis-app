// app/api/boards/route.test.ts
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { BoardVisibility, Role } from '@prisma/client'

const mocks = vi.hoisted(() => {
  const jsonOk = vi.fn((data: unknown, status = 200) => {
    return new Response(JSON.stringify(data), {
      status,
      headers: { 'content-type': 'application/json' },
    })
  })

  const jsonFail = vi.fn(
    (
      status: number,
      message: string,
      details?: Record<string, unknown> | null,
    ) => {
      const safeDetails =
        typeof details === 'object' && details !== null && !Array.isArray(details)
          ? details
          : {}

      return new Response(
        JSON.stringify({
          ok: false,
          error: message,
          ...safeDetails,
        }),
        {
          status,
          headers: { 'content-type': 'application/json' },
        },
      )
    },
  )

  const prisma = {}

  const requireClient = vi.fn()
  const createBoard = vi.fn()
  const getBoardDetail = vi.fn()
  const getBoardErrorMeta = vi.fn()
  const getBoardSummaries = vi.fn()
  const parseBoardVisibility = vi.fn()

  return {
    jsonOk,
    jsonFail,
    prisma,
    requireClient,
    createBoard,
    getBoardDetail,
    getBoardErrorMeta,
    getBoardSummaries,
    parseBoardVisibility,
  }
})

vi.mock('@/app/api/_utils', () => ({
  jsonOk: mocks.jsonOk,
  jsonFail: mocks.jsonFail,
  pickInt: (value: string | null) => {
    if (typeof value !== 'string') return null
    const trimmed = value.trim()
    if (!trimmed) return null
    const parsed = Number.parseInt(trimmed, 10)
    return Number.isFinite(parsed) ? parsed : null
  },
  requireClient: mocks.requireClient,
}))

vi.mock('@/lib/prisma', () => ({
  prisma: mocks.prisma,
}))

vi.mock('@/lib/boards', () => ({
  createBoard: mocks.createBoard,
  getBoardDetail: mocks.getBoardDetail,
  getBoardErrorMeta: mocks.getBoardErrorMeta,
  getBoardSummaries: mocks.getBoardSummaries,
  parseBoardVisibility: mocks.parseBoardVisibility,
}))

import { GET, POST } from './route'

async function readJson(res: Response): Promise<unknown> {
  return res.json()
}

function makeAuth(
  overrides?: Partial<{
    id: string
    role: Role
    clientId: string
  }>,
) {
  const clientId = overrides?.clientId ?? 'client_1'

  return {
    ok: true as const,
    clientId,
    user: {
      id: overrides?.id ?? 'user_1',
      role: overrides?.role ?? Role.CLIENT,
      clientProfile: { id: clientId },
      professionalProfile: null,
    },
  }
}

function makeBoardPreview(
  overrides?: Partial<{
    id: string
    clientId: string
    name: string
    visibility: BoardVisibility
    createdAt: string
    updatedAt: string
    itemCount: number
    items: Array<{
      id: string
      createdAt: string
      lookPostId: string
      lookPost: null
    }>
  }>,
) {
  return {
    id: 'board_1',
    clientId: 'client_1',
    name: 'Hair ideas',
    visibility: BoardVisibility.PRIVATE,
    createdAt: '2026-04-18T10:00:00.000Z',
    updatedAt: '2026-04-18T11:00:00.000Z',
    itemCount: 1,
    items: [
      {
        id: 'item_1',
        createdAt: '2026-04-18T11:30:00.000Z',
        lookPostId: 'look_1',
        lookPost: null,
      },
    ],
    ...overrides,
  }
}

function makeBoardDetail(
  overrides?: Partial<{
    id: string
    clientId: string
    name: string
    visibility: BoardVisibility
    createdAt: string
    updatedAt: string
    itemCount: number
    items: Array<{
      id: string
      createdAt: string
      lookPostId: string
      lookPost: null
    }>
  }>,
) {
  return {
    id: 'board_1',
    clientId: 'client_1',
    name: 'Hair ideas',
    visibility: BoardVisibility.PRIVATE,
    createdAt: '2026-04-18T10:00:00.000Z',
    updatedAt: '2026-04-18T11:00:00.000Z',
    itemCount: 1,
    items: [
      {
        id: 'item_1',
        createdAt: '2026-04-18T11:30:00.000Z',
        lookPostId: 'look_1',
        lookPost: null,
      },
    ],
    ...overrides,
  }
}

describe('app/api/boards/route.ts', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    mocks.requireClient.mockResolvedValue(makeAuth())
    mocks.getBoardSummaries.mockResolvedValue([makeBoardPreview()])
    mocks.parseBoardVisibility.mockReturnValue(BoardVisibility.SHARED)
    mocks.createBoard.mockResolvedValue({
      id: 'board_1',
      clientId: 'client_1',
      name: 'Hair ideas',
      visibility: BoardVisibility.PRIVATE,
      createdAt: new Date('2026-04-18T10:00:00.000Z'),
      updatedAt: new Date('2026-04-18T10:00:00.000Z'),
    })
    mocks.getBoardDetail.mockResolvedValue(makeBoardDetail())
    mocks.getBoardErrorMeta.mockReturnValue(null)
  })

  describe('GET', () => {
    it('lists the current viewer boards with parsed limit and skip', async () => {
      const res = await GET(
        new Request('http://localhost/api/boards?limit=12&skip=3'),
      )
      const body = await readJson(res)

      expect(res.status).toBe(200)

      expect(mocks.getBoardSummaries).toHaveBeenCalledWith(mocks.prisma, {
        clientId: 'client_1',
        viewerClientId: 'client_1',
        take: 12,
        skip: 3,
      })

      expect(body).toEqual({
        boards: [makeBoardPreview()],
      })
    })

    it('defaults limit and skip when query params are missing', async () => {
      const res = await GET(new Request('http://localhost/api/boards'))
      const body = await readJson(res)

      expect(res.status).toBe(200)

      expect(mocks.getBoardSummaries).toHaveBeenCalledWith(mocks.prisma, {
        clientId: 'client_1',
        viewerClientId: 'client_1',
        take: 24,
        skip: 0,
      })

      expect(body).toEqual({
        boards: [makeBoardPreview()],
      })
    })

    it('returns the auth failure response when the viewer is not an authenticated client', async () => {
      const authRes = new Response(
        JSON.stringify({
          ok: false,
          error: 'Only clients can perform this action.',
        }),
        {
          status: 403,
          headers: { 'content-type': 'application/json' },
        },
      )

      mocks.requireClient.mockResolvedValueOnce({
        ok: false as const,
        res: authRes,
      })

      const res = await GET(new Request('http://localhost/api/boards'))
      const body = await readJson(res)

      expect(res.status).toBe(403)
      expect(body).toEqual({
        ok: false,
        error: 'Only clients can perform this action.',
      })

      expect(mocks.getBoardSummaries).not.toHaveBeenCalled()
    })

    it('returns 500 when loading boards throws unexpectedly', async () => {
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
      mocks.getBoardSummaries.mockRejectedValueOnce(new Error('db blew up'))

      const res = await GET(new Request('http://localhost/api/boards'))
      const body = await readJson(res)

      expect(res.status).toBe(500)
      expect(body).toEqual({
        ok: false,
        error: 'Couldn’t load boards. Try again.',
        code: 'INTERNAL',
      })

      consoleError.mockRestore()
    })
  })

  describe('POST', () => {
    it('creates a board and returns the hydrated board detail response', async () => {
      const created = {
        id: 'board_1',
        clientId: 'client_1',
        name: 'Hair ideas',
        visibility: BoardVisibility.SHARED,
        createdAt: new Date('2026-04-18T10:00:00.000Z'),
        updatedAt: new Date('2026-04-18T10:00:00.000Z'),
      }

      const detail = makeBoardDetail({
        visibility: BoardVisibility.SHARED,
      })

      mocks.createBoard.mockResolvedValueOnce(created)
      mocks.getBoardDetail.mockResolvedValueOnce(detail)
      mocks.parseBoardVisibility.mockReturnValueOnce(BoardVisibility.SHARED)

      const res = await POST(
        new Request('http://localhost/api/boards', {
          method: 'POST',
          body: JSON.stringify({
            name: 'Hair ideas',
            visibility: 'shared',
          }),
        }),
      )
      const body = await readJson(res)

      expect(res.status).toBe(201)

      expect(mocks.parseBoardVisibility).toHaveBeenCalledWith('shared')

      expect(mocks.createBoard).toHaveBeenCalledWith(mocks.prisma, {
        clientId: 'client_1',
        name: 'Hair ideas',
        visibility: BoardVisibility.SHARED,
      })

      expect(mocks.getBoardDetail).toHaveBeenCalledWith(mocks.prisma, {
        boardId: 'board_1',
        clientId: 'client_1',
      })

      expect(body).toEqual({
        board: detail,
      })
    })

    it('creates a board without visibility when the request does not provide one', async () => {
      const res = await POST(
        new Request('http://localhost/api/boards', {
          method: 'POST',
          body: JSON.stringify({
            name: 'Hair ideas',
          }),
        }),
      )
      const body = await readJson(res)

      expect(res.status).toBe(201)

      expect(mocks.parseBoardVisibility).not.toHaveBeenCalled()

      expect(mocks.createBoard).toHaveBeenCalledWith(mocks.prisma, {
        clientId: 'client_1',
        name: 'Hair ideas',
      })

      expect(body).toEqual({
        board: makeBoardDetail(),
      })
    })

    it('uses an empty string name when the request body does not include a string name', async () => {
      await POST(
        new Request('http://localhost/api/boards', {
          method: 'POST',
          body: JSON.stringify({
            name: 123,
          }),
        }),
      )

      expect(mocks.createBoard).toHaveBeenCalledWith(mocks.prisma, {
        clientId: 'client_1',
        name: '',
      })
    })

    it('returns 400 when visibility is invalid', async () => {
      mocks.parseBoardVisibility.mockReturnValueOnce(null)

      const res = await POST(
        new Request('http://localhost/api/boards', {
          method: 'POST',
          body: JSON.stringify({
            name: 'Hair ideas',
            visibility: 'chaos',
          }),
        }),
      )
      const body = await readJson(res)

      expect(res.status).toBe(400)
      expect(body).toEqual({
        ok: false,
        error: 'Invalid board visibility.',
        code: 'INVALID_BOARD_VISIBILITY',
      })

      expect(mocks.createBoard).not.toHaveBeenCalled()
      expect(mocks.getBoardDetail).not.toHaveBeenCalled()
    })

    it('returns the auth failure response when the viewer is not an authenticated client', async () => {
      const authRes = new Response(
        JSON.stringify({
          ok: false,
          error: 'Only clients can perform this action.',
        }),
        {
          status: 403,
          headers: { 'content-type': 'application/json' },
        },
      )

      mocks.requireClient.mockResolvedValueOnce({
        ok: false as const,
        res: authRes,
      })

      const res = await POST(
        new Request('http://localhost/api/boards', {
          method: 'POST',
          body: JSON.stringify({
            name: 'Hair ideas',
          }),
        }),
      )
      const body = await readJson(res)

      expect(res.status).toBe(403)
      expect(body).toEqual({
        ok: false,
        error: 'Only clients can perform this action.',
      })

      expect(mocks.createBoard).not.toHaveBeenCalled()
    })

    it('maps shared board errors into stable route responses', async () => {
      const thrown = new Error('duplicate')
      mocks.createBoard.mockRejectedValueOnce(thrown)
      mocks.getBoardErrorMeta.mockReturnValueOnce({
        status: 409,
        message: 'A board with this name already exists.',
        code: 'BOARD_NAME_CONFLICT',
      })

      const res = await POST(
        new Request('http://localhost/api/boards', {
          method: 'POST',
          body: JSON.stringify({
            name: 'Hair ideas',
          }),
        }),
      )
      const body = await readJson(res)

      expect(res.status).toBe(409)
      expect(body).toEqual({
        ok: false,
        error: 'A board with this name already exists.',
        code: 'BOARD_NAME_CONFLICT',
      })
    })

    it('returns 500 when board creation throws an unknown error', async () => {
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
      mocks.createBoard.mockRejectedValueOnce(new Error('db blew up'))
      mocks.getBoardErrorMeta.mockReturnValueOnce(null)

      const res = await POST(
        new Request('http://localhost/api/boards', {
          method: 'POST',
          body: JSON.stringify({
            name: 'Hair ideas',
          }),
        }),
      )
      const body = await readJson(res)

      expect(res.status).toBe(500)
      expect(body).toEqual({
        ok: false,
        error: 'Couldn’t create board. Try again.',
        code: 'INTERNAL',
      })

      consoleError.mockRestore()
    })
  })
})