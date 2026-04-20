// app/api/boards/[id]/route.test.ts
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
  const deleteBoard = vi.fn()
  const getBoardDetail = vi.fn()
  const getBoardErrorMeta = vi.fn()
  const parseBoardVisibility = vi.fn()
  const updateBoard = vi.fn()

  return {
    jsonOk,
    jsonFail,
    prisma,
    requireClient,
    deleteBoard,
    getBoardDetail,
    getBoardErrorMeta,
    parseBoardVisibility,
    updateBoard,
  }
})

vi.mock('@/app/api/_utils', () => ({
  jsonOk: mocks.jsonOk,
  jsonFail: mocks.jsonFail,
  pickString: (value: string | null) => {
    if (typeof value !== 'string') return null
    const trimmed = value.trim()
    return trimmed.length > 0 ? trimmed : null
  },
  requireClient: mocks.requireClient,
}))

vi.mock('@/lib/prisma', () => ({
  prisma: mocks.prisma,
}))

vi.mock('@/lib/boards', () => ({
  deleteBoard: mocks.deleteBoard,
  getBoardDetail: mocks.getBoardDetail,
  getBoardErrorMeta: mocks.getBoardErrorMeta,
  parseBoardVisibility: mocks.parseBoardVisibility,
  updateBoard: mocks.updateBoard,
}))

import { DELETE, GET, PATCH } from './route'

type Params = { id: string }
type Ctx = { params: Params | Promise<Params> }

function makeCtx(id: string): Ctx {
  return {
    params: { id },
  }
}

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

describe('app/api/boards/[id]/route.ts', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    mocks.requireClient.mockResolvedValue(makeAuth())
    mocks.getBoardDetail.mockResolvedValue(makeBoardDetail())
    mocks.parseBoardVisibility.mockReturnValue(BoardVisibility.SHARED)
    mocks.updateBoard.mockResolvedValue({
      id: 'board_1',
      clientId: 'client_1',
      name: 'Hair ideas',
      visibility: BoardVisibility.PRIVATE,
      createdAt: new Date('2026-04-18T10:00:00.000Z'),
      updatedAt: new Date('2026-04-18T11:00:00.000Z'),
    })
    mocks.deleteBoard.mockResolvedValue({ id: 'board_1' })
    mocks.getBoardErrorMeta.mockReturnValue(null)
  })

  describe('GET', () => {
    it('loads owner board detail by board id', async () => {
      const res = await GET(
        new Request('http://localhost/api/boards/board_1'),
        makeCtx('board_1'),
      )
      const body = await readJson(res)

      expect(res.status).toBe(200)

      expect(mocks.getBoardDetail).toHaveBeenCalledWith(mocks.prisma, {
        boardId: 'board_1',
        clientId: 'client_1',
      })

      expect(body).toEqual({
        board: makeBoardDetail(),
      })
    })

    it('returns 400 when the route param is blank', async () => {
      const res = await GET(
        new Request('http://localhost/api/boards/%20%20'),
        makeCtx('   '),
      )
      const body = await readJson(res)

      expect(res.status).toBe(400)
      expect(body).toEqual({
        ok: false,
        error: 'Missing board id.',
        code: 'MISSING_BOARD_ID',
      })

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

      const res = await GET(
        new Request('http://localhost/api/boards/board_1'),
        makeCtx('board_1'),
      )
      const body = await readJson(res)

      expect(res.status).toBe(403)
      expect(body).toEqual({
        ok: false,
        error: 'Only clients can perform this action.',
      })

      expect(mocks.getBoardDetail).not.toHaveBeenCalled()
    })

    it('maps shared board errors into stable route responses', async () => {
      mocks.getBoardDetail.mockRejectedValueOnce(new Error('forbidden'))
      mocks.getBoardErrorMeta.mockReturnValueOnce({
        status: 403,
        message: 'Not allowed to manage this board.',
        code: 'BOARD_FORBIDDEN',
      })

      const res = await GET(
        new Request('http://localhost/api/boards/board_1'),
        makeCtx('board_1'),
      )
      const body = await readJson(res)

      expect(res.status).toBe(403)
      expect(body).toEqual({
        ok: false,
        error: 'Not allowed to manage this board.',
        code: 'BOARD_FORBIDDEN',
      })
    })

    it('returns 500 when loading board detail throws an unknown error', async () => {
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
      mocks.getBoardDetail.mockRejectedValueOnce(new Error('db blew up'))
      mocks.getBoardErrorMeta.mockReturnValueOnce(null)

      const res = await GET(
        new Request('http://localhost/api/boards/board_1'),
        makeCtx('board_1'),
      )
      const body = await readJson(res)

      expect(res.status).toBe(500)
      expect(body).toEqual({
        ok: false,
        error: 'Couldn’t load board. Try again.',
        code: 'INTERNAL',
      })

      consoleError.mockRestore()
    })
  })

  describe('PATCH', () => {
    it('updates the board name and returns refreshed board detail', async () => {
      const detail = makeBoardDetail({
        name: 'Updated board',
      })
      mocks.getBoardDetail.mockResolvedValueOnce(detail)

      const res = await PATCH(
        new Request('http://localhost/api/boards/board_1', {
          method: 'PATCH',
          body: JSON.stringify({
            name: 'Updated board',
          }),
        }),
        makeCtx('board_1'),
      )
      const body = await readJson(res)

      expect(res.status).toBe(200)

      expect(mocks.updateBoard).toHaveBeenCalledWith(mocks.prisma, {
        boardId: 'board_1',
        clientId: 'client_1',
        name: 'Updated board',
      })

      expect(mocks.getBoardDetail).toHaveBeenCalledWith(mocks.prisma, {
        boardId: 'board_1',
        clientId: 'client_1',
      })

      expect(body).toEqual({
        board: detail,
      })
    })

    it('updates board visibility when a valid visibility string is provided', async () => {
      const detail = makeBoardDetail({
        visibility: BoardVisibility.SHARED,
      })
      mocks.parseBoardVisibility.mockReturnValueOnce(BoardVisibility.SHARED)
      mocks.getBoardDetail.mockResolvedValueOnce(detail)

      const res = await PATCH(
        new Request('http://localhost/api/boards/board_1', {
          method: 'PATCH',
          body: JSON.stringify({
            visibility: 'shared',
          }),
        }),
        makeCtx('board_1'),
      )
      const body = await readJson(res)

      expect(res.status).toBe(200)

      expect(mocks.parseBoardVisibility).toHaveBeenCalledWith('shared')

      expect(mocks.updateBoard).toHaveBeenCalledWith(mocks.prisma, {
        boardId: 'board_1',
        clientId: 'client_1',
        visibility: BoardVisibility.SHARED,
      })

      expect(body).toEqual({
        board: detail,
      })
    })

    it('updates both name and visibility together', async () => {
      mocks.parseBoardVisibility.mockReturnValueOnce(BoardVisibility.SHARED)

      const res = await PATCH(
        new Request('http://localhost/api/boards/board_1', {
          method: 'PATCH',
          body: JSON.stringify({
            name: 'Shared inspo',
            visibility: 'shared',
          }),
        }),
        makeCtx('board_1'),
      )

      expect(res.status).toBe(200)

      expect(mocks.updateBoard).toHaveBeenCalledWith(mocks.prisma, {
        boardId: 'board_1',
        clientId: 'client_1',
        name: 'Shared inspo',
        visibility: BoardVisibility.SHARED,
      })
    })

    it('returns 400 when the route param is blank', async () => {
      const res = await PATCH(
        new Request('http://localhost/api/boards/%20%20', {
          method: 'PATCH',
          body: JSON.stringify({
            name: 'Updated board',
          }),
        }),
        makeCtx('   '),
      )
      const body = await readJson(res)

      expect(res.status).toBe(400)
      expect(body).toEqual({
        ok: false,
        error: 'Missing board id.',
        code: 'MISSING_BOARD_ID',
      })

      expect(mocks.updateBoard).not.toHaveBeenCalled()
    })

    it('returns 400 when neither name nor visibility is provided', async () => {
      const res = await PATCH(
        new Request('http://localhost/api/boards/board_1', {
          method: 'PATCH',
          body: JSON.stringify({}),
        }),
        makeCtx('board_1'),
      )
      const body = await readJson(res)

      expect(res.status).toBe(400)
      expect(body).toEqual({
        ok: false,
        error: 'Nothing to update.',
        code: 'NOTHING_TO_UPDATE',
      })

      expect(mocks.updateBoard).not.toHaveBeenCalled()
    })

    it('returns 400 when name is present but not a string', async () => {
      const res = await PATCH(
        new Request('http://localhost/api/boards/board_1', {
          method: 'PATCH',
          body: JSON.stringify({
            name: 123,
          }),
        }),
        makeCtx('board_1'),
      )
      const body = await readJson(res)

      expect(res.status).toBe(400)
      expect(body).toEqual({
        ok: false,
        error: 'Invalid board name.',
        code: 'INVALID_BOARD_NAME',
      })

      expect(mocks.updateBoard).not.toHaveBeenCalled()
    })

    it('returns 400 when visibility is present but not a string', async () => {
      const res = await PATCH(
        new Request('http://localhost/api/boards/board_1', {
          method: 'PATCH',
          body: JSON.stringify({
            visibility: 123,
          }),
        }),
        makeCtx('board_1'),
      )
      const body = await readJson(res)

      expect(res.status).toBe(400)
      expect(body).toEqual({
        ok: false,
        error: 'Invalid board visibility.',
        code: 'INVALID_BOARD_VISIBILITY',
      })

      expect(mocks.parseBoardVisibility).not.toHaveBeenCalled()
      expect(mocks.updateBoard).not.toHaveBeenCalled()
    })

    it('returns 400 when visibility cannot be parsed', async () => {
      mocks.parseBoardVisibility.mockReturnValueOnce(null)

      const res = await PATCH(
        new Request('http://localhost/api/boards/board_1', {
          method: 'PATCH',
          body: JSON.stringify({
            visibility: 'chaos',
          }),
        }),
        makeCtx('board_1'),
      )
      const body = await readJson(res)

      expect(res.status).toBe(400)
      expect(body).toEqual({
        ok: false,
        error: 'Invalid board visibility.',
        code: 'INVALID_BOARD_VISIBILITY',
      })

      expect(mocks.updateBoard).not.toHaveBeenCalled()
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

      const res = await PATCH(
        new Request('http://localhost/api/boards/board_1', {
          method: 'PATCH',
          body: JSON.stringify({
            name: 'Updated board',
          }),
        }),
        makeCtx('board_1'),
      )
      const body = await readJson(res)

      expect(res.status).toBe(403)
      expect(body).toEqual({
        ok: false,
        error: 'Only clients can perform this action.',
      })

      expect(mocks.updateBoard).not.toHaveBeenCalled()
    })

    it('maps shared board errors into stable route responses', async () => {
      mocks.updateBoard.mockRejectedValueOnce(new Error('forbidden'))
      mocks.getBoardErrorMeta.mockReturnValueOnce({
        status: 403,
        message: 'Not allowed to manage this board.',
        code: 'BOARD_FORBIDDEN',
      })

      const res = await PATCH(
        new Request('http://localhost/api/boards/board_1', {
          method: 'PATCH',
          body: JSON.stringify({
            name: 'Updated board',
          }),
        }),
        makeCtx('board_1'),
      )
      const body = await readJson(res)

      expect(res.status).toBe(403)
      expect(body).toEqual({
        ok: false,
        error: 'Not allowed to manage this board.',
        code: 'BOARD_FORBIDDEN',
      })
    })

    it('returns 500 when updating the board throws an unknown error', async () => {
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
      mocks.updateBoard.mockRejectedValueOnce(new Error('db blew up'))
      mocks.getBoardErrorMeta.mockReturnValueOnce(null)

      const res = await PATCH(
        new Request('http://localhost/api/boards/board_1', {
          method: 'PATCH',
          body: JSON.stringify({
            name: 'Updated board',
          }),
        }),
        makeCtx('board_1'),
      )
      const body = await readJson(res)

      expect(res.status).toBe(500)
      expect(body).toEqual({
        ok: false,
        error: 'Couldn’t update board. Try again.',
        code: 'INTERNAL',
      })

      consoleError.mockRestore()
    })
  })

  describe('DELETE', () => {
    it('deletes the board and returns the stable delete response', async () => {
      const res = await DELETE(
        new Request('http://localhost/api/boards/board_1', {
          method: 'DELETE',
        }),
        makeCtx('board_1'),
      )
      const body = await readJson(res)

      expect(res.status).toBe(200)

      expect(mocks.deleteBoard).toHaveBeenCalledWith(mocks.prisma, {
        boardId: 'board_1',
        clientId: 'client_1',
      })

      expect(body).toEqual({
        deleted: true,
        id: 'board_1',
      })
    })

    it('returns 400 when the route param is blank', async () => {
      const res = await DELETE(
        new Request('http://localhost/api/boards/%20%20', {
          method: 'DELETE',
        }),
        makeCtx('   '),
      )
      const body = await readJson(res)

      expect(res.status).toBe(400)
      expect(body).toEqual({
        ok: false,
        error: 'Missing board id.',
        code: 'MISSING_BOARD_ID',
      })

      expect(mocks.deleteBoard).not.toHaveBeenCalled()
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

      const res = await DELETE(
        new Request('http://localhost/api/boards/board_1', {
          method: 'DELETE',
        }),
        makeCtx('board_1'),
      )
      const body = await readJson(res)

      expect(res.status).toBe(403)
      expect(body).toEqual({
        ok: false,
        error: 'Only clients can perform this action.',
      })

      expect(mocks.deleteBoard).not.toHaveBeenCalled()
    })

    it('maps shared board errors into stable route responses', async () => {
      mocks.deleteBoard.mockRejectedValueOnce(new Error('missing'))
      mocks.getBoardErrorMeta.mockReturnValueOnce({
        status: 404,
        message: 'Board not found.',
        code: 'BOARD_NOT_FOUND',
      })

      const res = await DELETE(
        new Request('http://localhost/api/boards/board_1', {
          method: 'DELETE',
        }),
        makeCtx('board_1'),
      )
      const body = await readJson(res)

      expect(res.status).toBe(404)
      expect(body).toEqual({
        ok: false,
        error: 'Board not found.',
        code: 'BOARD_NOT_FOUND',
      })
    })

    it('returns 500 when deleting the board throws an unknown error', async () => {
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
      mocks.deleteBoard.mockRejectedValueOnce(new Error('db blew up'))
      mocks.getBoardErrorMeta.mockReturnValueOnce(null)

      const res = await DELETE(
        new Request('http://localhost/api/boards/board_1', {
          method: 'DELETE',
        }),
        makeCtx('board_1'),
      )
      const body = await readJson(res)

      expect(res.status).toBe(500)
      expect(body).toEqual({
        ok: false,
        error: 'Couldn’t delete board. Try again.',
        code: 'INTERNAL',
      })

      consoleError.mockRestore()
    })
  })
})