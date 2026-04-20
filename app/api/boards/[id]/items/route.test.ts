// app/api/boards/[id]/items/route.test.ts
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

  const prisma = {}

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
  const getBoardErrorMeta = vi.fn()
  const getViewerLookSaveState = vi.fn()

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
    getBoardErrorMeta,
    getViewerLookSaveState,
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
  getBoardErrorMeta: mocks.getBoardErrorMeta,
  getViewerLookSaveState: mocks.getViewerLookSaveState,
}))

vi.mock('@/lib/looks/access', () => ({
  loadLookAccess: mocks.loadLookAccess,
}))

vi.mock('@/lib/looks/guards', () => ({
  canViewLookPost: mocks.canViewLookPost,
  canSaveLookPost: mocks.canSaveLookPost,
}))

import { POST } from './route'

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
  const clientId = overrides?.clientId ?? 'client_1'

  return {
    ok: true as const,
    clientId,
    user: {
      id: overrides?.id ?? 'user_1',
      role: overrides?.role ?? Role.CLIENT,
      clientProfile: { id: clientId },
      professionalProfile: overrides?.professionalProfile ?? null,
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

describe('app/api/boards/[id]/items/route.ts', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    mocks.requireClient.mockResolvedValue(makeAuth())
    mocks.loadLookAccess.mockResolvedValue(makeAccess())
    mocks.canViewLookPost.mockReturnValue(true)
    mocks.canSaveLookPost.mockReturnValue(true)
    mocks.addBoardItem.mockResolvedValue({
      board: {
        id: 'board_1',
      },
      itemId: 'item_1',
      added: true,
      saveCount: 5,
    })
    mocks.getViewerLookSaveState.mockResolvedValue(makeSaveState())
    mocks.getBoardErrorMeta.mockReturnValue(null)
  })

  it('adds the canonical lookPostId to the board and returns stable mutation state', async () => {
    const res = await POST(
      new Request('http://localhost/api/boards/board_1/items', {
        method: 'POST',
        body: JSON.stringify({
          lookPostId: 'look_1',
        }),
      }),
      makeCtx('board_1'),
    )
    const body = await readJson(res)

    expect(res.status).toBe(201)

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

  it('returns 200 when the look is already in the board', async () => {
    mocks.addBoardItem.mockResolvedValueOnce({
      board: {
        id: 'board_1',
      },
      itemId: 'item_existing',
      added: false,
      saveCount: 5,
    })

    const res = await POST(
      new Request('http://localhost/api/boards/board_1/items', {
        method: 'POST',
        body: JSON.stringify({
          lookPostId: 'look_1',
        }),
      }),
      makeCtx('board_1'),
    )

    expect(res.status).toBe(200)
  })

  it('returns 400 when the board route param is blank', async () => {
    const res = await POST(
      new Request('http://localhost/api/boards/%20%20/items', {
        method: 'POST',
        body: JSON.stringify({
          lookPostId: 'look_1',
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

    expect(mocks.loadLookAccess).not.toHaveBeenCalled()
    expect(mocks.addBoardItem).not.toHaveBeenCalled()
  })

  it('returns 400 when lookPostId is missing', async () => {
    const res = await POST(
      new Request('http://localhost/api/boards/board_1/items', {
        method: 'POST',
        body: JSON.stringify({}),
      }),
      makeCtx('board_1'),
    )
    const body = await readJson(res)

    expect(res.status).toBe(400)
    expect(body).toEqual({
      ok: false,
      error: 'Missing look id.',
      code: 'MISSING_LOOK_ID',
    })

    expect(mocks.loadLookAccess).not.toHaveBeenCalled()
    expect(mocks.addBoardItem).not.toHaveBeenCalled()
  })

  it('returns 404 when the canonical lookPostId cannot be resolved', async () => {
    mocks.loadLookAccess.mockResolvedValueOnce(null)

    const res = await POST(
      new Request('http://localhost/api/boards/board_1/items', {
        method: 'POST',
        body: JSON.stringify({
          lookPostId: 'look_missing',
        }),
      }),
      makeCtx('board_1'),
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

  it('returns 404 when the viewer cannot view the look', async () => {
    mocks.canViewLookPost.mockReturnValueOnce(false)

    const res = await POST(
      new Request('http://localhost/api/boards/board_1/items', {
        method: 'POST',
        body: JSON.stringify({
          lookPostId: 'look_1',
        }),
      }),
      makeCtx('board_1'),
    )
    const body = await readJson(res)

    expect(res.status).toBe(404)
    expect(body).toEqual({
      ok: false,
      error: 'Not found.',
      code: 'LOOK_NOT_FOUND',
    })

    expect(mocks.canSaveLookPost).not.toHaveBeenCalled()
    expect(mocks.addBoardItem).not.toHaveBeenCalled()
  })

  it('returns 403 when the shared save policy forbids saving the look', async () => {
    mocks.canSaveLookPost.mockReturnValueOnce(false)

    const res = await POST(
      new Request('http://localhost/api/boards/board_1/items', {
        method: 'POST',
        body: JSON.stringify({
          lookPostId: 'look_1',
        }),
      }),
      makeCtx('board_1'),
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
      new Request('http://localhost/api/boards/board_1/items', {
        method: 'POST',
        body: JSON.stringify({
          lookPostId: 'look_1',
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

    expect(mocks.loadLookAccess).not.toHaveBeenCalled()
    expect(mocks.addBoardItem).not.toHaveBeenCalled()
  })

  it('does not treat legacy media ids as fallback identifiers', async () => {
    mocks.loadLookAccess.mockResolvedValueOnce(null)

    const res = await POST(
      new Request('http://localhost/api/boards/board_1/items', {
        method: 'POST',
        body: JSON.stringify({
          lookPostId: 'media_legacy_1',
        }),
      }),
      makeCtx('board_1'),
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

    expect(mocks.addBoardItem).not.toHaveBeenCalled()
  })

  it('maps shared board errors into stable route responses', async () => {
    mocks.addBoardItem.mockRejectedValueOnce(new Error('forbidden'))
    mocks.getBoardErrorMeta.mockReturnValueOnce({
      status: 403,
      message: 'Not allowed to manage this board.',
      code: 'BOARD_FORBIDDEN',
    })

    const res = await POST(
      new Request('http://localhost/api/boards/board_1/items', {
        method: 'POST',
        body: JSON.stringify({
          lookPostId: 'look_1',
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

  it('returns 500 when adding the board item throws an unknown error', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    mocks.addBoardItem.mockRejectedValueOnce(new Error('db blew up'))
    mocks.getBoardErrorMeta.mockReturnValueOnce(null)

    const res = await POST(
      new Request('http://localhost/api/boards/board_1/items', {
        method: 'POST',
        body: JSON.stringify({
          lookPostId: 'look_1',
        }),
      }),
      makeCtx('board_1'),
    )
    const body = await readJson(res)

    expect(res.status).toBe(500)
    expect(body).toEqual({
      ok: false,
      error: 'Couldn’t add that look to the board. Try again.',
      code: 'INTERNAL',
    })

    consoleError.mockRestore()
  })
})