// app/api/boards/[id]/items/[lookId]/route.test.ts
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Role } from '@prisma/client'

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

  const prisma = {
    lookPost: {
      findUnique: vi.fn(),
    },
  }

  const requireClient = vi.fn()
  const buildLooksBoardItemMutationResponse = vi.fn(
    ({
      boardId,
      lookPostId,
      inBoard,
      saveCount,
      state,
    }: {
      boardId: string
      lookPostId: string
      inBoard: boolean
      saveCount: number
      state: {
        isSaved: boolean
        boardIds: string[]
        boards: Array<{
          id: string
          name: string
          visibility: string
        }>
      }
    }) => ({
      boardId,
      lookPostId,
      inBoard,
      isSaved: state.isSaved,
      saveCount,
      boardIds: state.boardIds,
      boards: state.boards,
    }),
  )
  const getBoardErrorMeta = vi.fn()
  const getViewerLookSaveState = vi.fn()
  const removeBoardItem = vi.fn()

  return {
    jsonOk,
    jsonFail,
    prisma,
    requireClient,
    buildLooksBoardItemMutationResponse,
    getBoardErrorMeta,
    getViewerLookSaveState,
    removeBoardItem,
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
  buildLooksBoardItemMutationResponse:
    mocks.buildLooksBoardItemMutationResponse,
  getBoardErrorMeta: mocks.getBoardErrorMeta,
  getViewerLookSaveState: mocks.getViewerLookSaveState,
  removeBoardItem: mocks.removeBoardItem,
}))

import { DELETE } from './route'

type Params = { id: string; lookId: string }
type Ctx = { params: Params | Promise<Params> }

function makeCtx(id: string, lookId: string): Ctx {
  return {
    params: { id, lookId },
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

function makeSaveState(
  overrides?: Partial<{
    isSaved: boolean
    boardIds: string[]
    boards: Array<{
      id: string
      name: string
      visibility: string
    }>
  }>,
) {
  return {
    isSaved: false,
    boardIds: [],
    boards: [],
    ...overrides,
  }
}

describe('app/api/boards/[id]/items/[lookId]/route.ts', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    mocks.requireClient.mockResolvedValue(makeAuth())
    mocks.prisma.lookPost.findUnique.mockResolvedValue({ id: 'look_1' })
    mocks.removeBoardItem.mockResolvedValue({
      board: {
        id: 'board_1',
      },
      removed: true,
      saveCount: 3,
    })
    mocks.getViewerLookSaveState.mockResolvedValue(makeSaveState())
    mocks.getBoardErrorMeta.mockReturnValue(null)
  })

  it('removes the canonical lookPostId from the board and returns stable mutation state', async () => {
    const res = await DELETE(
      new Request('http://localhost/api/boards/board_1/items/look_1', {
        method: 'DELETE',
      }),
      makeCtx('board_1', 'look_1'),
    )
    const body = await readJson(res)

    expect(res.status).toBe(200)

    expect(mocks.prisma.lookPost.findUnique).toHaveBeenCalledWith({
      where: { id: 'look_1' },
      select: { id: true },
    })

    expect(mocks.removeBoardItem).toHaveBeenCalledWith(mocks.prisma, {
      boardId: 'board_1',
      clientId: 'client_1',
      lookPostId: 'look_1',
    })

    expect(mocks.getViewerLookSaveState).toHaveBeenCalledWith(mocks.prisma, {
      viewerClientId: 'client_1',
      lookPostId: 'look_1',
    })

    expect(mocks.buildLooksBoardItemMutationResponse).toHaveBeenCalledWith({
      boardId: 'board_1',
      lookPostId: 'look_1',
      inBoard: false,
      saveCount: 3,
      state: makeSaveState(),
    })

    expect(body).toEqual({
      boardId: 'board_1',
      lookPostId: 'look_1',
      inBoard: false,
      isSaved: false,
      saveCount: 3,
      boardIds: [],
      boards: [],
    })
  })

  it('returns 400 when the board route param is blank', async () => {
    const res = await DELETE(
      new Request('http://localhost/api/boards/%20%20/items/look_1', {
        method: 'DELETE',
      }),
      makeCtx('   ', 'look_1'),
    )
    const body = await readJson(res)

    expect(res.status).toBe(400)
    expect(body).toEqual({
      ok: false,
      error: 'Missing board id.',
      code: 'MISSING_BOARD_ID',
    })

    expect(mocks.prisma.lookPost.findUnique).not.toHaveBeenCalled()
    expect(mocks.removeBoardItem).not.toHaveBeenCalled()
  })

  it('returns 400 when the look route param is blank', async () => {
    const res = await DELETE(
      new Request('http://localhost/api/boards/board_1/items/%20%20', {
        method: 'DELETE',
      }),
      makeCtx('board_1', '   '),
    )
    const body = await readJson(res)

    expect(res.status).toBe(400)
    expect(body).toEqual({
      ok: false,
      error: 'Missing look id.',
      code: 'MISSING_LOOK_ID',
    })

    expect(mocks.prisma.lookPost.findUnique).not.toHaveBeenCalled()
    expect(mocks.removeBoardItem).not.toHaveBeenCalled()
  })

  it('returns 404 when the canonical lookPostId does not exist', async () => {
    mocks.prisma.lookPost.findUnique.mockResolvedValueOnce(null)

    const res = await DELETE(
      new Request('http://localhost/api/boards/board_1/items/look_missing', {
        method: 'DELETE',
      }),
      makeCtx('board_1', 'look_missing'),
    )
    const body = await readJson(res)

    expect(res.status).toBe(404)
    expect(body).toEqual({
      ok: false,
      error: 'Not found.',
      code: 'LOOK_NOT_FOUND',
    })

    expect(mocks.removeBoardItem).not.toHaveBeenCalled()
    expect(mocks.getViewerLookSaveState).not.toHaveBeenCalled()
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
      new Request('http://localhost/api/boards/board_1/items/look_1', {
        method: 'DELETE',
      }),
      makeCtx('board_1', 'look_1'),
    )
    const body = await readJson(res)

    expect(res.status).toBe(403)
    expect(body).toEqual({
      ok: false,
      error: 'Only clients can perform this action.',
    })

    expect(mocks.prisma.lookPost.findUnique).not.toHaveBeenCalled()
    expect(mocks.removeBoardItem).not.toHaveBeenCalled()
  })

  it('does not treat legacy media ids as fallback identifiers', async () => {
    mocks.prisma.lookPost.findUnique.mockResolvedValueOnce(null)

    const res = await DELETE(
      new Request('http://localhost/api/boards/board_1/items/media_legacy_1', {
        method: 'DELETE',
      }),
      makeCtx('board_1', 'media_legacy_1'),
    )
    const body = await readJson(res)

    expect(res.status).toBe(404)
    expect(body).toEqual({
      ok: false,
      error: 'Not found.',
      code: 'LOOK_NOT_FOUND',
    })

    expect(mocks.prisma.lookPost.findUnique).toHaveBeenCalledWith({
      where: { id: 'media_legacy_1' },
      select: { id: true },
    })

    expect(mocks.removeBoardItem).not.toHaveBeenCalled()
  })

  it('maps shared board errors into stable route responses', async () => {
    mocks.removeBoardItem.mockRejectedValueOnce(new Error('forbidden'))
    mocks.getBoardErrorMeta.mockReturnValueOnce({
      status: 403,
      message: 'Not allowed to manage this board.',
      code: 'BOARD_FORBIDDEN',
    })

    const res = await DELETE(
      new Request('http://localhost/api/boards/board_1/items/look_1', {
        method: 'DELETE',
      }),
      makeCtx('board_1', 'look_1'),
    )
    const body = await readJson(res)

    expect(res.status).toBe(403)
    expect(body).toEqual({
      ok: false,
      error: 'Not allowed to manage this board.',
      code: 'BOARD_FORBIDDEN',
    })
  })

  it('returns 500 when removing the board item throws an unknown error', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    mocks.removeBoardItem.mockRejectedValueOnce(new Error('db blew up'))
    mocks.getBoardErrorMeta.mockReturnValueOnce(null)

    const res = await DELETE(
      new Request('http://localhost/api/boards/board_1/items/look_1', {
        method: 'DELETE',
      }),
      makeCtx('board_1', 'look_1'),
    )
    const body = await readJson(res)

    expect(res.status).toBe(500)
    expect(body).toEqual({
      ok: false,
      error: 'Couldn’t remove that look from the board. Try again.',
      code: 'INTERNAL',
    })

    consoleError.mockRestore()
  })
})