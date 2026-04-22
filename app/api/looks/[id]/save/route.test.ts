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
        typeof details === 'object' &&
        details !== null &&
        !Array.isArray(details)
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

function makeRequest(
  method: 'GET' | 'POST' | 'DELETE',
  body?: unknown,
): Request {
  return new Request('http://localhost/api/looks/look_1/save', {
    method,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
}

async function readJson(res: Response): Promise<unknown> {
  return await res.json()
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

function makeBoardMutationResult(added: boolean, saveCount: number) {
  return {
    board: { id: 'board_1' },
    itemId: added ? 'item_1' : 'item_existing',
    added,
    saveCount,
  }
}

function makeRemoveMutationResult(saveCount: number) {
  return {
    board: { id: 'board_1' },
    removed: true,
    saveCount,
  }
}

function expectDefaultLoadLookAccess(lookPostId: string): void {
  expect(mocks.loadLookAccess).toHaveBeenCalledWith(mocks.prisma, {
    lookPostId,
    viewerClientId: 'client_1',
    viewerProfessionalId: null,
  })
}

function expectDefaultGuardInputs(): void {
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
}

function expectNoSaveStateReadsOrWrites(): void {
  expect(mocks.getViewerLookSaveState).not.toHaveBeenCalled()
  expect(mocks.addBoardItem).not.toHaveBeenCalled()
  expect(mocks.removeBoardItem).not.toHaveBeenCalled()
  expect(mocks.prisma.lookPost.findUnique).not.toHaveBeenCalled()
}

describe('app/api/looks/[id]/save/route.ts', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    mocks.requireClient.mockResolvedValue(makeAuth())
    mocks.loadLookAccess.mockResolvedValue(makeAccess())
    mocks.canViewLookPost.mockReturnValue(true)
    mocks.canSaveLookPost.mockReturnValue(true)
    mocks.getViewerLookSaveState.mockResolvedValue(makeSaveState())
    mocks.addBoardItem.mockResolvedValue(makeBoardMutationResult(true, 5))
    mocks.removeBoardItem.mockResolvedValue(makeRemoveMutationResult(3))
    mocks.getBoardErrorMeta.mockReturnValue(null)
    mocks.prisma.lookPost.findUnique.mockResolvedValue({ id: 'look_1' })
  })

  describe('GET', () => {
    it('loads viewer save state by canonical lookPostId and returns the route-level response contract', async () => {
      const res = await GET(makeRequest('GET'), makeCtx('look_1'))
      const body = await readJson(res)

      expect(res.status).toBe(200)

      expectDefaultLoadLookAccess('look_1')
      expectDefaultGuardInputs()

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

    it('returns the auth response immediately and does not perform access or save-state work', async () => {
      const authResponse = new Response(
        JSON.stringify({
          ok: false,
          error: 'Unauthorized',
        }),
        {
          status: 401,
          headers: { 'content-type': 'application/json' },
        },
      )

      mocks.requireClient.mockResolvedValue({
        ok: false as const,
        res: authResponse,
      })

      const res = await GET(makeRequest('GET'), makeCtx('look_1'))
      const body = await readJson(res)

      expect(res.status).toBe(401)
      expect(body).toEqual({
        ok: false,
        error: 'Unauthorized',
      })

      expect(mocks.loadLookAccess).not.toHaveBeenCalled()
      expectNoSaveStateReadsOrWrites()
    })

    it('returns 400 for a blank look id and does not perform access or save-state work', async () => {
      const res = await GET(makeRequest('GET'), makeCtx('   '))
      const body = await readJson(res)

      expect(res.status).toBe(400)
      expect(body).toEqual({
        ok: false,
        error: 'Missing look id.',
        code: 'MISSING_LOOK_ID',
      })

      expect(mocks.loadLookAccess).not.toHaveBeenCalled()
      expectNoSaveStateReadsOrWrites()
    })

    it('returns 404 when canonical look access cannot be resolved', async () => {
      mocks.loadLookAccess.mockResolvedValueOnce(null)

      const res = await GET(makeRequest('GET'), makeCtx('look_missing'))
      const body = await readJson(res)

      expect(res.status).toBe(404)
      expect(body).toEqual({
        ok: false,
        error: 'Not found.',
        code: 'LOOK_NOT_FOUND',
      })

      expectDefaultLoadLookAccess('look_missing')
      expect(mocks.getViewerLookSaveState).not.toHaveBeenCalled()
    })

    it('returns 404 when the viewer cannot view the look and does not read save state', async () => {
      mocks.canViewLookPost.mockReturnValueOnce(false)

      const res = await GET(makeRequest('GET'), makeCtx('look_1'))
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

    it('returns 500 on unexpected save-state read failures', async () => {
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
      mocks.getViewerLookSaveState.mockRejectedValueOnce(new Error('db blew up'))

      const res = await GET(makeRequest('GET'), makeCtx('look_1'))
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

  describe('POST', () => {
    it('delegates save writes to addBoardItem using the canonical lookPostId and returns route-level mutation state', async () => {
      const res = await POST(
        makeRequest('POST', { boardId: 'board_1' }),
        makeCtx('look_1'),
      )
      const body = await readJson(res)

      expect(res.status).toBe(201)

      expectDefaultLoadLookAccess('look_1')
      expectDefaultGuardInputs()

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

    it('returns 200 when addBoardItem reports the item was already present, keeping route behavior delegation-only', async () => {
      mocks.addBoardItem.mockResolvedValueOnce(makeBoardMutationResult(false, 5))

      const res = await POST(
        makeRequest('POST', { boardId: 'board_1' }),
        makeCtx('look_1'),
      )
      const body = await readJson(res)

      expect(res.status).toBe(200)

      expect(mocks.addBoardItem).toHaveBeenCalledWith(mocks.prisma, {
        boardId: 'board_1',
        clientId: 'client_1',
        lookPostId: 'look_1',
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

    it('returns the auth response immediately and does not perform access, helper, or save-state work', async () => {
      const authResponse = new Response(
        JSON.stringify({
          ok: false,
          error: 'Unauthorized',
        }),
        {
          status: 401,
          headers: { 'content-type': 'application/json' },
        },
      )

      mocks.requireClient.mockResolvedValue({
        ok: false as const,
        res: authResponse,
      })

      const res = await POST(
        makeRequest('POST', { boardId: 'board_1' }),
        makeCtx('look_1'),
      )
      const body = await readJson(res)

      expect(res.status).toBe(401)
      expect(body).toEqual({
        ok: false,
        error: 'Unauthorized',
      })

      expect(mocks.loadLookAccess).not.toHaveBeenCalled()
      expect(mocks.addBoardItem).not.toHaveBeenCalled()
      expect(mocks.getViewerLookSaveState).not.toHaveBeenCalled()
    })

    it('returns 400 when boardId is missing and does not call the write helper', async () => {
      const res = await POST(makeRequest('POST', {}), makeCtx('look_1'))
      const body = await readJson(res)

      expect(res.status).toBe(400)
      expect(body).toEqual({
        ok: false,
        error: 'Missing board id.',
        code: 'MISSING_BOARD_ID',
      })

      expect(mocks.loadLookAccess).not.toHaveBeenCalled()
      expect(mocks.addBoardItem).not.toHaveBeenCalled()
      expect(mocks.getViewerLookSaveState).not.toHaveBeenCalled()
    })

    it('returns 404 when canonical look access cannot be resolved and does not call the write helper', async () => {
      mocks.loadLookAccess.mockResolvedValueOnce(null)

      const res = await POST(
        makeRequest('POST', { boardId: 'board_1' }),
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
      expect(mocks.getViewerLookSaveState).not.toHaveBeenCalled()
    })

    it('returns 403 when the shared save policy forbids saves and does not call the write helper', async () => {
      mocks.canSaveLookPost.mockReturnValueOnce(false)

      const res = await POST(
        makeRequest('POST', { boardId: 'board_1' }),
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
      expect(mocks.getViewerLookSaveState).not.toHaveBeenCalled()
    })

    it('maps board-helper errors into route responses without inventing route-owned save logic', async () => {
      mocks.addBoardItem.mockRejectedValueOnce(new Error('forbidden'))
      mocks.getBoardErrorMeta.mockReturnValueOnce({
        status: 403,
        message: 'Not allowed to manage this board.',
        code: 'BOARD_FORBIDDEN',
      })

      const res = await POST(
        makeRequest('POST', { boardId: 'board_1' }),
        makeCtx('look_1'),
      )
      const body = await readJson(res)

      expect(res.status).toBe(403)
      expect(body).toEqual({
        ok: false,
        error: 'Not allowed to manage this board.',
        code: 'BOARD_FORBIDDEN',
      })

      expect(mocks.getViewerLookSaveState).not.toHaveBeenCalled()
    })
  })

  describe('DELETE', () => {
    it('delegates unsave writes to removeBoardItem using the canonical lookPostId and returns route-level mutation state', async () => {
      mocks.getViewerLookSaveState.mockResolvedValueOnce(
        makeSaveState({
          isSaved: false,
          boardIds: [],
          boards: [],
        }),
      )

      const res = await DELETE(
        makeRequest('DELETE', { boardId: 'board_1' }),
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

      expect(mocks.getViewerLookSaveState).toHaveBeenCalledWith(mocks.prisma, {
        viewerClientId: 'client_1',
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

    it('returns the auth response immediately and does not perform existence checks or helper work', async () => {
      const authResponse = new Response(
        JSON.stringify({
          ok: false,
          error: 'Unauthorized',
        }),
        {
          status: 401,
          headers: { 'content-type': 'application/json' },
        },
      )

      mocks.requireClient.mockResolvedValue({
        ok: false as const,
        res: authResponse,
      })

      const res = await DELETE(
        makeRequest('DELETE', { boardId: 'board_1' }),
        makeCtx('look_1'),
      )
      const body = await readJson(res)

      expect(res.status).toBe(401)
      expect(body).toEqual({
        ok: false,
        error: 'Unauthorized',
      })

      expect(mocks.prisma.lookPost.findUnique).not.toHaveBeenCalled()
      expect(mocks.removeBoardItem).not.toHaveBeenCalled()
      expect(mocks.getViewerLookSaveState).not.toHaveBeenCalled()
    })

    it('returns 400 when boardId is missing and does not call the delete helper', async () => {
      const res = await DELETE(makeRequest('DELETE', {}), makeCtx('look_1'))
      const body = await readJson(res)

      expect(res.status).toBe(400)
      expect(body).toEqual({
        ok: false,
        error: 'Missing board id.',
        code: 'MISSING_BOARD_ID',
      })

      expect(mocks.prisma.lookPost.findUnique).not.toHaveBeenCalled()
      expect(mocks.removeBoardItem).not.toHaveBeenCalled()
      expect(mocks.getViewerLookSaveState).not.toHaveBeenCalled()
    })

    it('returns 404 when the canonical lookPostId does not exist and does not call the delete helper', async () => {
      mocks.prisma.lookPost.findUnique.mockResolvedValueOnce(null)

      const res = await DELETE(
        makeRequest('DELETE', { boardId: 'board_1' }),
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
      expect(mocks.getViewerLookSaveState).not.toHaveBeenCalled()
    })

    it('maps board-helper errors into route responses without moving save-side effects into the route', async () => {
      mocks.removeBoardItem.mockRejectedValueOnce(new Error('forbidden'))
      mocks.getBoardErrorMeta.mockReturnValueOnce({
        status: 403,
        message: 'Not allowed to manage this board.',
        code: 'BOARD_FORBIDDEN',
      })

      const res = await DELETE(
        makeRequest('DELETE', { boardId: 'board_1' }),
        makeCtx('look_1'),
      )
      const body = await readJson(res)

      expect(res.status).toBe(403)
      expect(body).toEqual({
        ok: false,
        error: 'Not allowed to manage this board.',
        code: 'BOARD_FORBIDDEN',
      })

      expect(mocks.getViewerLookSaveState).not.toHaveBeenCalled()
    })
  })
})