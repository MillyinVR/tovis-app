// app/api/looks/[id]/save/route.test.ts
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  LookPostStatus,
  LookPostVisibility,
  ModerationStatus,
  Role,
  VerificationStatus,
} from '@prisma/client'

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
  const addBoardItem = vi.fn()
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
  const buildLooksSaveStateResponse = vi.fn(
    ({
      lookPostId,
      saveCount,
      state,
    }: {
      lookPostId: string
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
      lookPostId,
      isSaved: state.isSaved,
      saveCount,
      boardIds: state.boardIds,
      boards: state.boards,
    }),
  )
  const getBoardErrorMeta = vi.fn()
  const getViewerLookSaveState = vi.fn()
  const removeBoardItem = vi.fn()

  const loadLookAccess = vi.fn()
  const canViewLookPost = vi.fn()
  const canSaveLookPost = vi.fn()

  return {
    jsonOk,
    jsonFail,
    prisma,
    requireClient,
    addBoardItem,
    buildLooksBoardItemMutationResponse,
    buildLooksSaveStateResponse,
    getBoardErrorMeta,
    getViewerLookSaveState,
    removeBoardItem,
    loadLookAccess,
    canViewLookPost,
    canSaveLookPost,
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
  addBoardItem: mocks.addBoardItem,
  buildLooksBoardItemMutationResponse:
    mocks.buildLooksBoardItemMutationResponse,
  buildLooksSaveStateResponse: mocks.buildLooksSaveStateResponse,
  getBoardErrorMeta: mocks.getBoardErrorMeta,
  getViewerLookSaveState: mocks.getViewerLookSaveState,
  removeBoardItem: mocks.removeBoardItem,
}))

vi.mock('@/lib/looks/access', () => ({
  loadLookAccess: mocks.loadLookAccess,
}))

vi.mock('@/lib/looks/guards', () => ({
  canViewLookPost: mocks.canViewLookPost,
  canSaveLookPost: mocks.canSaveLookPost,
}))

import { DELETE, GET, POST } from './route'

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
    professionalProfile: { id: string } | null
  }>,
) {
  return {
    ok: true as const,
    clientId: 'client_1',
    user: {
      id: 'user_1',
      role: Role.CLIENT,
      clientProfile: { id: 'client_1' },
      professionalProfile: null,
      ...overrides,
    },
  }
}

function makeAccess(
  overrides?: Partial<{
    look: {
      id: string
      professionalId: string
      status: LookPostStatus
      visibility: LookPostVisibility
      moderationStatus: ModerationStatus
      saveCount: number
      professional: {
        id: string
        verificationStatus: VerificationStatus
      }
    }
    isOwner: boolean
    viewerFollowsProfessional: boolean
  }>,
) {
  return {
    look: {
      id: 'look_1',
      professionalId: 'pro_1',
      status: LookPostStatus.PUBLISHED,
      visibility: LookPostVisibility.PUBLIC,
      moderationStatus: ModerationStatus.APPROVED,
      saveCount: 4,
      professional: {
        id: 'pro_1',
        verificationStatus: VerificationStatus.APPROVED,
      },
    },
    isOwner: false,
    viewerFollowsProfessional: false,
    ...overrides,
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
    isSaved: true,
    boardIds: ['board_1'],
    boards: [
      {
        id: 'board_1',
        name: 'Hair ideas',
        visibility: 'PRIVATE',
      },
    ],
    ...overrides,
  }
}

describe('app/api/looks/[id]/save/route.ts', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    mocks.requireClient.mockResolvedValue(makeAuth())
    mocks.loadLookAccess.mockResolvedValue(makeAccess())
    mocks.canViewLookPost.mockReturnValue(true)
    mocks.canSaveLookPost.mockReturnValue(true)
    mocks.getViewerLookSaveState.mockResolvedValue(makeSaveState())
    mocks.addBoardItem.mockResolvedValue({
      board: {
        id: 'board_1',
      },
      itemId: 'item_1',
      added: true,
      saveCount: 5,
    })
    mocks.removeBoardItem.mockResolvedValue({
      board: {
        id: 'board_1',
      },
      removed: true,
      saveCount: 3,
    })
    mocks.getBoardErrorMeta.mockReturnValue(null)
    mocks.prisma.lookPost.findUnique.mockResolvedValue({ id: 'look_1' })
  })

  it('GET returns viewer save state by canonical lookPostId', async () => {
    const res = await GET(
      new Request('http://localhost/api/looks/look_1/save'),
      makeCtx('look_1'),
    )
    const body = await readJson(res)

    expect(res.status).toBe(200)

    expect(mocks.loadLookAccess).toHaveBeenCalledWith(mocks.prisma, {
      lookPostId: 'look_1',
      viewerClientId: 'client_1',
      viewerProfessionalId: null,
    })

    expect(mocks.canViewLookPost).toHaveBeenCalledWith({
      isOwner: false,
      viewerRole: Role.CLIENT,
      status: LookPostStatus.PUBLISHED,
      visibility: LookPostVisibility.PUBLIC,
      moderationStatus: ModerationStatus.APPROVED,
      proVerificationStatus: VerificationStatus.APPROVED,
      viewerFollowsProfessional: false,
    })

    expect(mocks.canSaveLookPost).toHaveBeenCalledWith({
      isOwner: false,
      viewerRole: Role.CLIENT,
      status: LookPostStatus.PUBLISHED,
      visibility: LookPostVisibility.PUBLIC,
      moderationStatus: ModerationStatus.APPROVED,
      proVerificationStatus: VerificationStatus.APPROVED,
      viewerFollowsProfessional: false,
    })

    expect(mocks.getViewerLookSaveState).toHaveBeenCalledWith(mocks.prisma, {
      viewerClientId: 'client_1',
      lookPostId: 'look_1',
    })

    expect(mocks.buildLooksSaveStateResponse).toHaveBeenCalledWith({
      lookPostId: 'look_1',
      saveCount: 4,
      state: makeSaveState(),
    })

    expect(body).toEqual({
      lookPostId: 'look_1',
      isSaved: true,
      saveCount: 4,
      boardIds: ['board_1'],
      boards: [
        {
          id: 'board_1',
          name: 'Hair ideas',
          visibility: 'PRIVATE',
        },
      ],
    })
  })

  it('POST adds the canonical lookPostId to an explicit board and returns stable mutation state', async () => {
    const res = await POST(
      new Request('http://localhost/api/looks/look_1/save', {
        method: 'POST',
        body: JSON.stringify({ boardId: 'board_1' }),
      }),
      makeCtx('look_1'),
    )
    const body = await readJson(res)

    expect(res.status).toBe(201)

    expect(mocks.loadLookAccess).toHaveBeenCalledWith(mocks.prisma, {
      lookPostId: 'look_1',
      viewerClientId: 'client_1',
      viewerProfessionalId: null,
    })

    expect(mocks.addBoardItem).toHaveBeenCalledWith(mocks.prisma, {
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
      inBoard: true,
      saveCount: 5,
      state: makeSaveState(),
    })

    expect(body).toEqual({
      boardId: 'board_1',
      lookPostId: 'look_1',
      inBoard: true,
      isSaved: true,
      saveCount: 5,
      boardIds: ['board_1'],
      boards: [
        {
          id: 'board_1',
          name: 'Hair ideas',
          visibility: 'PRIVATE',
        },
      ],
    })
  })

  it('POST returns 200 when the item was already in the board', async () => {
    mocks.addBoardItem.mockResolvedValueOnce({
      board: {
        id: 'board_1',
      },
      itemId: 'item_existing',
      added: false,
      saveCount: 5,
    })

    const res = await POST(
      new Request('http://localhost/api/looks/look_1/save', {
        method: 'POST',
        body: JSON.stringify({ boardId: 'board_1' }),
      }),
      makeCtx('look_1'),
    )

    expect(res.status).toBe(200)
  })

  it('DELETE removes the canonical lookPostId from an explicit board and returns stable mutation state', async () => {
    mocks.getViewerLookSaveState.mockResolvedValueOnce(
      makeSaveState({
        isSaved: false,
        boardIds: [],
        boards: [],
      }),
    )

    const res = await DELETE(
      new Request('http://localhost/api/looks/look_1/save', {
        method: 'DELETE',
        body: JSON.stringify({ boardId: 'board_1' }),
      }),
      makeCtx('look_1'),
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

    expect(mocks.buildLooksBoardItemMutationResponse).toHaveBeenCalledWith({
      boardId: 'board_1',
      lookPostId: 'look_1',
      inBoard: false,
      saveCount: 3,
      state: {
        isSaved: false,
        boardIds: [],
        boards: [],
      },
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

  it('returns 400 when the route param is blank', async () => {
    const res = await GET(
      new Request('http://localhost/api/looks/%20%20/save'),
      makeCtx('   '),
    )
    const body = await readJson(res)

    expect(res.status).toBe(400)
    expect(body).toEqual({
      ok: false,
      error: 'Missing look id.',
      code: 'MISSING_LOOK_ID',
    })

    expect(mocks.loadLookAccess).not.toHaveBeenCalled()
    expect(mocks.getViewerLookSaveState).not.toHaveBeenCalled()
  })

  it('POST returns 400 when boardId is missing', async () => {
    const res = await POST(
      new Request('http://localhost/api/looks/look_1/save', {
        method: 'POST',
        body: JSON.stringify({}),
      }),
      makeCtx('look_1'),
    )
    const body = await readJson(res)

    expect(res.status).toBe(400)
    expect(body).toEqual({
      ok: false,
      error: 'Missing board id.',
      code: 'MISSING_BOARD_ID',
    })

    expect(mocks.loadLookAccess).not.toHaveBeenCalled()
    expect(mocks.addBoardItem).not.toHaveBeenCalled()
  })

  it('DELETE returns 400 when boardId is missing', async () => {
    const res = await DELETE(
      new Request('http://localhost/api/looks/look_1/save', {
        method: 'DELETE',
        body: JSON.stringify({}),
      }),
      makeCtx('look_1'),
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

  it('GET returns 404 when the canonical lookPostId cannot be resolved', async () => {
    mocks.loadLookAccess.mockResolvedValueOnce(null)

    const res = await GET(
      new Request('http://localhost/api/looks/look_missing/save'),
      makeCtx('look_missing'),
    )
    const body = await readJson(res)

    expect(res.status).toBe(404)
    expect(body).toEqual({
      ok: false,
      error: 'Not found.',
      code: 'LOOK_NOT_FOUND',
    })

    expect(mocks.getViewerLookSaveState).not.toHaveBeenCalled()
  })

  it('POST returns 404 when the canonical lookPostId cannot be resolved', async () => {
    mocks.loadLookAccess.mockResolvedValueOnce(null)

    const res = await POST(
      new Request('http://localhost/api/looks/look_missing/save', {
        method: 'POST',
        body: JSON.stringify({ boardId: 'board_1' }),
      }),
      makeCtx('look_missing'),
    )
    const body = await readJson(res)

    expect(res.status).toBe(404)
    expect(body).toEqual({
      ok: false,
      error: 'Not found.',
      code: 'LOOK_NOT_FOUND',
    })

    expect(mocks.addBoardItem).not.toHaveBeenCalled()
  })

  it('GET returns 404 when the viewer cannot view the look', async () => {
    mocks.canViewLookPost.mockReturnValueOnce(false)

    const res = await GET(
      new Request('http://localhost/api/looks/look_1/save'),
      makeCtx('look_1'),
    )
    const body = await readJson(res)

    expect(res.status).toBe(404)
    expect(body).toEqual({
      ok: false,
      error: 'Not found.',
      code: 'LOOK_NOT_FOUND',
    })

    expect(mocks.canSaveLookPost).not.toHaveBeenCalled()
    expect(mocks.getViewerLookSaveState).not.toHaveBeenCalled()
  })

  it('POST returns 403 when the shared save policy forbids saves', async () => {
    mocks.canSaveLookPost.mockReturnValueOnce(false)

    const res = await POST(
      new Request('http://localhost/api/looks/look_1/save', {
        method: 'POST',
        body: JSON.stringify({ boardId: 'board_1' }),
      }),
      makeCtx('look_1'),
    )
    const body = await readJson(res)

    expect(res.status).toBe(403)
    expect(body).toEqual({
      ok: false,
      error: 'You can’t save this look.',
      code: 'SAVE_FORBIDDEN',
    })

    expect(mocks.addBoardItem).not.toHaveBeenCalled()
  })

  it('DELETE returns 404 when the canonical lookPostId does not exist', async () => {
    mocks.prisma.lookPost.findUnique.mockResolvedValueOnce(null)

    const res = await DELETE(
      new Request('http://localhost/api/looks/look_missing/save', {
        method: 'DELETE',
        body: JSON.stringify({ boardId: 'board_1' }),
      }),
      makeCtx('look_missing'),
    )
    const body = await readJson(res)

    expect(res.status).toBe(404)
    expect(body).toEqual({
      ok: false,
      error: 'Not found.',
      code: 'LOOK_NOT_FOUND',
    })

    expect(mocks.removeBoardItem).not.toHaveBeenCalled()
  })

  it('does not treat legacy media ids as fallback identifiers', async () => {
    mocks.loadLookAccess.mockResolvedValueOnce(null)

    const res = await GET(
      new Request('http://localhost/api/looks/media_legacy_1/save'),
      makeCtx('media_legacy_1'),
    )
    const body = await readJson(res)

    expect(res.status).toBe(404)
    expect(body).toEqual({
      ok: false,
      error: 'Not found.',
      code: 'LOOK_NOT_FOUND',
    })

    expect(mocks.loadLookAccess).toHaveBeenCalledWith(mocks.prisma, {
      lookPostId: 'media_legacy_1',
      viewerClientId: 'client_1',
      viewerProfessionalId: null,
    })

    expect(mocks.getViewerLookSaveState).not.toHaveBeenCalled()
  })

  it('maps shared board errors into route responses', async () => {
    mocks.addBoardItem.mockRejectedValueOnce(new Error('forbidden'))
    mocks.getBoardErrorMeta.mockReturnValueOnce({
      status: 403,
      message: 'Not allowed to manage this board.',
      code: 'BOARD_FORBIDDEN',
    })

    const res = await POST(
      new Request('http://localhost/api/looks/look_1/save', {
        method: 'POST',
        body: JSON.stringify({ boardId: 'board_1' }),
      }),
      makeCtx('look_1'),
    )
    const body = await readJson(res)

    expect(res.status).toBe(403)
    expect(body).toEqual({
      ok: false,
      error: 'Not allowed to manage this board.',
      code: 'BOARD_FORBIDDEN',
    })
  })

  it('returns 500 on unexpected GET errors', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    mocks.getViewerLookSaveState.mockRejectedValueOnce(new Error('db blew up'))

    const res = await GET(
      new Request('http://localhost/api/looks/look_1/save'),
      makeCtx('look_1'),
    )
    const body = await readJson(res)

    expect(res.status).toBe(500)
    expect(body).toEqual({
      ok: false,
      error: 'Couldn’t load save state. Try again.',
      code: 'INTERNAL',
    })

    consoleError.mockRestore()
  })
})