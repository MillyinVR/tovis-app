// lib/boards/index.test.ts
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { BoardVisibility, Prisma, PrismaClient } from '@prisma/client'

const mocks = vi.hoisted(() => {
  return {
    looksBoardPreviewSelect: { __mocked: 'looksBoardPreviewSelect' },
    looksBoardDetailSelect: { __mocked: 'looksBoardDetailSelect' },
    mapLooksBoardPreviewToDto: vi.fn(),
    mapLooksBoardDetailToDto: vi.fn(),
    recomputeLookPostSaveCount: vi.fn(),
    enqueueRecomputeLookCounts: vi.fn(),
  }
})

vi.mock('@/lib/looks/selects', () => ({
  looksBoardPreviewSelect: mocks.looksBoardPreviewSelect,
  looksBoardDetailSelect: mocks.looksBoardDetailSelect,
}))

vi.mock('@/lib/looks/mappers', () => ({
  mapLooksBoardPreviewToDto: mocks.mapLooksBoardPreviewToDto,
  mapLooksBoardDetailToDto: mocks.mapLooksBoardDetailToDto,
}))

vi.mock('@/lib/looks/counters', () => ({
  recomputeLookPostSaveCount: mocks.recomputeLookPostSaveCount,
}))

vi.mock('@/lib/jobs/looksSocial/enqueue', () => ({
  enqueueRecomputeLookCounts: mocks.enqueueRecomputeLookCounts,
}))

import {
  addBoardItem,
  assertCanManageBoard,
  buildLooksBoardItemMutationResponse,
  buildLooksSaveStateResponse,
  canManageBoard,
  createBoard,
  deleteBoard,
  getBoardDetail,
  getBoardErrorMeta,
  getBoardSummaries,
  getViewerLookSaveState,
  parseBoardVisibility,
  removeBoardItem,
  requireBoardOwner,
  updateBoard,
} from './index'

type BoardOwnerRow = {
  id: string
  clientId: string
  name: string
  visibility: BoardVisibility
  createdAt: Date
  updatedAt: Date
}

type MockDb = {
  $transaction: ReturnType<typeof vi.fn>
  board: {
    findUnique: ReturnType<typeof vi.fn>
    create: ReturnType<typeof vi.fn>
    findMany: ReturnType<typeof vi.fn>
    update: ReturnType<typeof vi.fn>
    delete: ReturnType<typeof vi.fn>
  }
  boardItem: {
    findUnique: ReturnType<typeof vi.fn>
    create: ReturnType<typeof vi.fn>
    deleteMany: ReturnType<typeof vi.fn>
    findMany: ReturnType<typeof vi.fn>
  }
}

function makeDb(): MockDb {
  const db: MockDb = {
    $transaction: vi.fn(),
    board: {
      findUnique: vi.fn(),
      create: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    boardItem: {
      findUnique: vi.fn(),
      create: vi.fn(),
      deleteMany: vi.fn(),
      findMany: vi.fn(),
    },
  }

  db.$transaction.mockImplementation(
    async (
      callback: (tx: Prisma.TransactionClient) => Promise<unknown> | unknown,
    ) => {
      return await callback(db as unknown as Prisma.TransactionClient)
    },
  )

  return db
}

function asRootDb(db: MockDb): PrismaClient {
  return db as unknown as PrismaClient
}

function asTx(db: MockDb): Prisma.TransactionClient {
  return db as unknown as Prisma.TransactionClient
}

function makeOwnedBoard(
  overrides?: Partial<BoardOwnerRow>,
): BoardOwnerRow {
  return {
    id: 'board_1',
    clientId: 'client_1',
    name: 'Hair ideas',
    visibility: BoardVisibility.PRIVATE,
    createdAt: new Date('2026-04-18T10:00:00.000Z'),
    updatedAt: new Date('2026-04-18T10:00:00.000Z'),
    ...overrides,
  }
}

function makeQueuedJob() {
  return {
    id: 'job_1',
    type: 'RECOMPUTE_LOOK_COUNTS',
    dedupeKey: 'look:look_1:recompute-counts',
    status: 'PENDING',
    runAt: new Date('2026-04-20T12:00:00.000Z'),
    attemptCount: 0,
    maxAttempts: 5,
  }
}

function expectSaveRecomputeAndEnqueue(
  db: MockDb,
  lookPostId: string,
  times = 1,
): void {
  expect(mocks.recomputeLookPostSaveCount).toHaveBeenCalledTimes(times)
  expect(mocks.recomputeLookPostSaveCount).toHaveBeenCalledWith(
    asTx(db),
    lookPostId,
  )

  expect(mocks.enqueueRecomputeLookCounts).toHaveBeenCalledTimes(times)
  expect(mocks.enqueueRecomputeLookCounts).toHaveBeenCalledWith(asTx(db), {
    lookPostId,
  })
}

describe('lib/boards/index.ts', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    mocks.recomputeLookPostSaveCount.mockResolvedValue(0)
    mocks.enqueueRecomputeLookCounts.mockResolvedValue(makeQueuedJob())
  })

  describe('ownership helpers', () => {
    it('allows a client to manage their own board', () => {
      expect(
        canManageBoard({
          viewerClientId: 'client_1',
          ownerClientId: 'client_1',
        }),
      ).toBe(true)
    })

    it('blocks a different client from managing the board', () => {
      expect(
        canManageBoard({
          viewerClientId: 'client_2',
          ownerClientId: 'client_1',
        }),
      ).toBe(false)
    })

    it('throws when viewer cannot manage the board', () => {
      expect(() =>
        assertCanManageBoard({
          viewerClientId: 'client_2',
          ownerClientId: 'client_1',
        }),
      ).toThrow('Not allowed to manage this board.')
    })
  })

  describe('requireBoardOwner', () => {
    it('returns the board for the owning client', async () => {
      const db = makeDb()
      const board = makeOwnedBoard({
        updatedAt: new Date('2026-04-18T11:00:00.000Z'),
      })

      db.board.findUnique.mockResolvedValue(board)

      await expect(
        requireBoardOwner(asTx(db), {
          boardId: 'board_1',
          clientId: 'client_1',
        }),
      ).resolves.toEqual(board)

      expect(db.board.findUnique).toHaveBeenCalledWith({
        where: { id: 'board_1' },
        select: {
          id: true,
          clientId: true,
          name: true,
          visibility: true,
          createdAt: true,
          updatedAt: true,
        },
      })
    })

    it('throws when the board does not exist', async () => {
      const db = makeDb()
      db.board.findUnique.mockResolvedValue(null)

      await expect(
        requireBoardOwner(asTx(db), {
          boardId: 'board_missing',
          clientId: 'client_1',
        }),
      ).rejects.toThrow('Board not found.')
    })

    it('throws when the board belongs to a different client', async () => {
      const db = makeDb()

      db.board.findUnique.mockResolvedValue(
        makeOwnedBoard({ clientId: 'client_2', name: 'Not yours' }),
      )

      await expect(
        requireBoardOwner(asTx(db), {
          boardId: 'board_1',
          clientId: 'client_1',
        }),
      ).rejects.toThrow('Not allowed to manage this board.')
    })
  })

  describe('createBoard', () => {
    it('creates a board with normalized name and default PRIVATE visibility', async () => {
      const db = makeDb()
      const board = makeOwnedBoard()

      db.board.create.mockResolvedValue(board)

      const result = await createBoard(asTx(db), {
        clientId: 'client_1',
        name: '  Hair ideas  ',
      })

      expect(db.board.create).toHaveBeenCalledWith({
        data: {
          clientId: 'client_1',
          name: 'Hair ideas',
          visibility: BoardVisibility.PRIVATE,
        },
        select: {
          id: true,
          clientId: true,
          name: true,
          visibility: true,
          createdAt: true,
          updatedAt: true,
        },
      })

      expect(result).toEqual(board)
    })

    it('translates duplicate board names into a stable error', async () => {
      const db = makeDb()

      db.board.create.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('duplicate', {
          code: 'P2002',
          clientVersion: 'test',
        }),
      )

      await expect(
        createBoard(asTx(db), {
          clientId: 'client_1',
          name: 'Hair ideas',
        }),
      ).rejects.toThrow('A board with this name already exists.')
    })
  })

  describe('updateBoard', () => {
    it('updates name and visibility for an owned board', async () => {
      const db = makeDb()
      const current = makeOwnedBoard({
        updatedAt: new Date('2026-04-18T11:00:00.000Z'),
      })
      const updated = makeOwnedBoard({
        name: 'Nails later',
        visibility: BoardVisibility.SHARED,
        updatedAt: new Date('2026-04-19T11:00:00.000Z'),
      })

      db.board.findUnique.mockResolvedValue(current)
      db.board.update.mockResolvedValue(updated)

      const result = await updateBoard(asTx(db), {
        boardId: 'board_1',
        clientId: 'client_1',
        name: '  Nails later  ',
        visibility: BoardVisibility.SHARED,
      })

      expect(db.board.update).toHaveBeenCalledWith({
        where: { id: 'board_1' },
        data: {
          name: 'Nails later',
          visibility: BoardVisibility.SHARED,
        },
        select: {
          id: true,
          clientId: true,
          name: true,
          visibility: true,
          createdAt: true,
          updatedAt: true,
        },
      })

      expect(result).toEqual(updated)
    })

    it('returns the current board when no update fields are provided', async () => {
      const db = makeDb()
      const current = makeOwnedBoard({
        updatedAt: new Date('2026-04-18T11:00:00.000Z'),
      })

      db.board.findUnique.mockResolvedValue(current)

      const result = await updateBoard(asTx(db), {
        boardId: 'board_1',
        clientId: 'client_1',
      })

      expect(db.board.update).not.toHaveBeenCalled()
      expect(result).toEqual(current)
    })
  })

  describe('deleteBoard', () => {
    it('deletes an owned board', async () => {
      const db = makeDb()

      db.board.findUnique.mockResolvedValue(makeOwnedBoard())
      db.board.delete.mockResolvedValue({ id: 'board_1' })

      const result = await deleteBoard(asTx(db), {
        boardId: 'board_1',
        clientId: 'client_1',
      })

      expect(db.board.delete).toHaveBeenCalledWith({
        where: { id: 'board_1' },
        select: { id: true },
      })

      expect(result).toEqual({ id: 'board_1' })
    })
  })

  describe('addBoardItem', () => {
    it('uses the root db transaction path, creates the item, recomputes save count, and enqueues reconciliation at the real save write point', async () => {
      const db = makeDb()

      db.board.findUnique.mockResolvedValue(makeOwnedBoard())
      db.boardItem.findUnique.mockResolvedValue(null)
      db.boardItem.create.mockResolvedValue({ id: 'item_1' })
      mocks.recomputeLookPostSaveCount.mockResolvedValue(3)

      const result = await addBoardItem(asRootDb(db), {
        boardId: 'board_1',
        clientId: 'client_1',
        lookPostId: 'look_1',
      })

      expect(db.$transaction).toHaveBeenCalledTimes(1)

      expect(db.boardItem.findUnique).toHaveBeenCalledWith({
        where: {
          boardId_lookPostId: {
            boardId: 'board_1',
            lookPostId: 'look_1',
          },
        },
        select: { id: true },
      })

      expect(db.boardItem.create).toHaveBeenCalledWith({
        data: {
          boardId: 'board_1',
          lookPostId: 'look_1',
        },
        select: { id: true },
      })

      expectSaveRecomputeAndEnqueue(db, 'look_1')

      expect(result).toEqual({
        board: makeOwnedBoard(),
        itemId: 'item_1',
        added: true,
        saveCount: 3,
      })
    })

    it('does not create a duplicate item when already present, but still recomputes save count and enqueues reconciliation', async () => {
      const db = makeDb()

      db.board.findUnique.mockResolvedValue(makeOwnedBoard())
      db.boardItem.findUnique.mockResolvedValue({ id: 'item_existing' })
      mocks.recomputeLookPostSaveCount.mockResolvedValue(2)

      const result = await addBoardItem(asRootDb(db), {
        boardId: 'board_1',
        clientId: 'client_1',
        lookPostId: 'look_1',
      })

      expect(db.$transaction).toHaveBeenCalledTimes(1)
      expect(db.boardItem.create).not.toHaveBeenCalled()

      expectSaveRecomputeAndEnqueue(db, 'look_1')

      expect(result).toEqual({
        board: makeOwnedBoard(),
        itemId: 'item_existing',
        added: false,
        saveCount: 2,
      })
    })

    it('surfaces enqueue failure after recompute so the save path cannot silently skip async reconciliation', async () => {
      const db = makeDb()

      db.board.findUnique.mockResolvedValue(makeOwnedBoard())
      db.boardItem.findUnique.mockResolvedValue(null)
      db.boardItem.create.mockResolvedValue({ id: 'item_1' })
      mocks.recomputeLookPostSaveCount.mockResolvedValue(3)
      mocks.enqueueRecomputeLookCounts.mockRejectedValue(
        new Error('enqueue exploded'),
      )

      await expect(
        addBoardItem(asRootDb(db), {
          boardId: 'board_1',
          clientId: 'client_1',
          lookPostId: 'look_1',
        }),
      ).rejects.toThrow('enqueue exploded')

      expect(mocks.recomputeLookPostSaveCount).toHaveBeenCalledWith(
        asTx(db),
        'look_1',
      )
      expect(mocks.enqueueRecomputeLookCounts).toHaveBeenCalledWith(asTx(db), {
        lookPostId: 'look_1',
      })
    })
  })

  describe('removeBoardItem', () => {
    it('uses the root db transaction path, deletes matching board items, recomputes save count, and enqueues reconciliation at the real unsave write point', async () => {
      const db = makeDb()

      db.board.findUnique.mockResolvedValue(makeOwnedBoard())
      db.boardItem.deleteMany.mockResolvedValue({ count: 1 })
      mocks.recomputeLookPostSaveCount.mockResolvedValue(1)

      const result = await removeBoardItem(asRootDb(db), {
        boardId: 'board_1',
        clientId: 'client_1',
        lookPostId: 'look_1',
      })

      expect(db.$transaction).toHaveBeenCalledTimes(1)

      expect(db.boardItem.deleteMany).toHaveBeenCalledWith({
        where: {
          boardId: 'board_1',
          lookPostId: 'look_1',
        },
      })

      expectSaveRecomputeAndEnqueue(db, 'look_1')

      expect(result).toEqual({
        board: makeOwnedBoard(),
        removed: true,
        saveCount: 1,
      })
    })

    it('still recomputes save count and enqueues reconciliation when deleteMany removes zero rows, preventing silent drift on idempotent unsave paths', async () => {
      const db = makeDb()

      db.board.findUnique.mockResolvedValue(makeOwnedBoard())
      db.boardItem.deleteMany.mockResolvedValue({ count: 0 })
      mocks.recomputeLookPostSaveCount.mockResolvedValue(4)

      const result = await removeBoardItem(asRootDb(db), {
        boardId: 'board_1',
        clientId: 'client_1',
        lookPostId: 'look_1',
      })

      expect(db.$transaction).toHaveBeenCalledTimes(1)

      expect(db.boardItem.deleteMany).toHaveBeenCalledWith({
        where: {
          boardId: 'board_1',
          lookPostId: 'look_1',
        },
      })

      expectSaveRecomputeAndEnqueue(db, 'look_1')

      expect(result).toEqual({
        board: makeOwnedBoard(),
        removed: false,
        saveCount: 4,
      })
    })

    it('surfaces enqueue failure after recompute so the unsave path cannot silently skip async reconciliation', async () => {
      const db = makeDb()

      db.board.findUnique.mockResolvedValue(makeOwnedBoard())
      db.boardItem.deleteMany.mockResolvedValue({ count: 1 })
      mocks.recomputeLookPostSaveCount.mockResolvedValue(1)
      mocks.enqueueRecomputeLookCounts.mockRejectedValue(
        new Error('enqueue exploded'),
      )

      await expect(
        removeBoardItem(asRootDb(db), {
          boardId: 'board_1',
          clientId: 'client_1',
          lookPostId: 'look_1',
        }),
      ).rejects.toThrow('enqueue exploded')

      expect(mocks.recomputeLookPostSaveCount).toHaveBeenCalledWith(
        asTx(db),
        'look_1',
      )
      expect(mocks.enqueueRecomputeLookCounts).toHaveBeenCalledWith(asTx(db), {
        lookPostId: 'look_1',
      })
    })
  })

  describe('getBoardSummaries', () => {
    it('loads board summaries with the shared board preview select and mapper', async () => {
      const db = makeDb()

      const rows = [
        {
          id: 'board_1',
          clientId: 'client_1',
          name: 'Hair ideas',
          visibility: BoardVisibility.PRIVATE,
          createdAt: new Date('2026-04-18T10:00:00.000Z'),
          updatedAt: new Date('2026-04-18T11:00:00.000Z'),
          _count: { items: 1 },
          items: [],
        },
      ]

      db.board.findMany.mockResolvedValue(rows)

      mocks.mapLooksBoardPreviewToDto.mockResolvedValue({
        id: 'board_1',
        clientId: 'client_1',
        name: 'Hair ideas',
        visibility: BoardVisibility.PRIVATE,
        createdAt: '2026-04-18T10:00:00.000Z',
        updatedAt: '2026-04-18T11:00:00.000Z',
        itemCount: 1,
        items: [],
      })

      const result = await getBoardSummaries(asTx(db), {
        clientId: 'client_1',
        viewerClientId: 'client_1',
      })

      expect(db.board.findMany).toHaveBeenCalledWith({
        where: { clientId: 'client_1' },
        orderBy: [
          { updatedAt: 'desc' },
          { createdAt: 'desc' },
          { id: 'desc' },
        ],
        take: 24,
        skip: 0,
        select: mocks.looksBoardPreviewSelect,
      })

      expect(mocks.mapLooksBoardPreviewToDto).toHaveBeenCalledTimes(1)
      expect(mocks.mapLooksBoardPreviewToDto.mock.calls[0]?.[0]).toEqual(rows[0])

      expect(result).toEqual([
        {
          id: 'board_1',
          clientId: 'client_1',
          name: 'Hair ideas',
          visibility: BoardVisibility.PRIVATE,
          createdAt: '2026-04-18T10:00:00.000Z',
          updatedAt: '2026-04-18T11:00:00.000Z',
          itemCount: 1,
          items: [],
        },
      ])
    })

    it('rejects when a different viewer tries to read board summaries', async () => {
      const db = makeDb()

      await expect(
        getBoardSummaries(asTx(db), {
          clientId: 'client_1',
          viewerClientId: 'client_2',
        }),
      ).rejects.toThrow('Not allowed to manage this board.')

      expect(db.board.findMany).not.toHaveBeenCalled()
    })
  })

  describe('getBoardDetail', () => {
    it('loads a board detail with the shared detail select and mapper', async () => {
      const db = makeDb()

      db.board.findUnique
        .mockResolvedValueOnce(
          makeOwnedBoard({
            updatedAt: new Date('2026-04-18T11:00:00.000Z'),
          }),
        )
        .mockResolvedValueOnce({
          id: 'board_1',
          clientId: 'client_1',
          name: 'Hair ideas',
          visibility: BoardVisibility.PRIVATE,
          createdAt: new Date('2026-04-18T10:00:00.000Z'),
          updatedAt: new Date('2026-04-18T11:00:00.000Z'),
          _count: { items: 1 },
          items: [],
        })

      mocks.mapLooksBoardDetailToDto.mockReturnValue({
        id: 'board_1',
        clientId: 'client_1',
        name: 'Hair ideas',
        visibility: BoardVisibility.PRIVATE,
        createdAt: '2026-04-18T10:00:00.000Z',
        updatedAt: '2026-04-18T11:00:00.000Z',
        itemCount: 1,
        items: [],
      })

      const result = await getBoardDetail(asTx(db), {
        boardId: 'board_1',
        clientId: 'client_1',
      })

      expect(db.board.findUnique).toHaveBeenNthCalledWith(2, {
        where: { id: 'board_1' },
        select: mocks.looksBoardDetailSelect,
      })

      expect(mocks.mapLooksBoardDetailToDto).toHaveBeenCalledTimes(1)
      expect(result).toEqual({
        id: 'board_1',
        clientId: 'client_1',
        name: 'Hair ideas',
        visibility: BoardVisibility.PRIVATE,
        createdAt: '2026-04-18T10:00:00.000Z',
        updatedAt: '2026-04-18T11:00:00.000Z',
        itemCount: 1,
        items: [],
      })
    })
  })

  describe('getViewerLookSaveState', () => {
    it('returns unsaved when there is no viewer client id', async () => {
      const db = makeDb()

      const result = await getViewerLookSaveState(asTx(db), {
        viewerClientId: null,
        lookPostId: 'look_1',
      })

      expect(db.boardItem.findMany).not.toHaveBeenCalled()
      expect(result).toEqual({
        isSaved: false,
        boardIds: [],
        boards: [],
      })
    })

    it('returns deduped boards for the viewer save state', async () => {
      const db = makeDb()

      db.boardItem.findMany.mockResolvedValue([
        {
          boardId: 'board_1',
          board: {
            id: 'board_1',
            name: 'Hair ideas',
            visibility: BoardVisibility.PRIVATE,
          },
        },
        {
          boardId: 'board_1',
          board: {
            id: 'board_1',
            name: 'Hair ideas',
            visibility: BoardVisibility.PRIVATE,
          },
        },
        {
          boardId: 'board_2',
          board: {
            id: 'board_2',
            name: 'Nails later',
            visibility: BoardVisibility.SHARED,
          },
        },
      ])

      const result = await getViewerLookSaveState(asTx(db), {
        viewerClientId: 'client_1',
        lookPostId: 'look_1',
      })

      expect(db.boardItem.findMany).toHaveBeenCalledWith({
        where: {
          lookPostId: 'look_1',
          board: {
            clientId: 'client_1',
          },
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        select: {
          boardId: true,
          board: {
            select: {
              id: true,
              name: true,
              visibility: true,
            },
          },
        },
      })

      expect(result).toEqual({
        isSaved: true,
        boardIds: ['board_1', 'board_2'],
        boards: [
          {
            id: 'board_1',
            name: 'Hair ideas',
            visibility: BoardVisibility.PRIVATE,
          },
          {
            id: 'board_2',
            name: 'Nails later',
            visibility: BoardVisibility.SHARED,
          },
        ],
      })
    })
  })

  describe('response builders and helpers', () => {
    it('buildLooksSaveStateResponse normalizes the payload shape', () => {
      const result = buildLooksSaveStateResponse({
        lookPostId: 'look_1',
        saveCount: 3,
        state: {
          isSaved: true,
          boardIds: ['board_1'],
          boards: [
            {
              id: 'board_1',
              name: 'Hair ideas',
              visibility: BoardVisibility.PRIVATE,
            },
          ],
        },
      })

      expect(result).toEqual({
        lookPostId: 'look_1',
        isSaved: true,
        saveCount: 3,
        boardIds: ['board_1'],
        boards: [
          {
            id: 'board_1',
            name: 'Hair ideas',
            visibility: BoardVisibility.PRIVATE,
          },
        ],
      })
    })

    it('buildLooksBoardItemMutationResponse projects save state into the mutation contract', () => {
      const result = buildLooksBoardItemMutationResponse({
        boardId: 'board_1',
        lookPostId: 'look_1',
        inBoard: true,
        saveCount: 4,
        state: {
          isSaved: true,
          boardIds: ['board_1', 'board_2'],
          boards: [
            {
              id: 'board_1',
              name: 'Hair ideas',
              visibility: BoardVisibility.PRIVATE,
            },
            {
              id: 'board_2',
              name: 'Nails later',
              visibility: BoardVisibility.SHARED,
            },
          ],
        },
      })

      expect(result).toEqual({
        boardId: 'board_1',
        lookPostId: 'look_1',
        inBoard: true,
        isSaved: true,
        saveCount: 4,
        boardIds: ['board_1', 'board_2'],
        boards: [
          {
            id: 'board_1',
            name: 'Hair ideas',
            visibility: BoardVisibility.PRIVATE,
          },
          {
            id: 'board_2',
            name: 'Nails later',
            visibility: BoardVisibility.SHARED,
          },
        ],
      })
    })

    it('parseBoardVisibility accepts valid values case-insensitively', () => {
      expect(parseBoardVisibility('private')).toBe(BoardVisibility.PRIVATE)
      expect(parseBoardVisibility('SHARED')).toBe(BoardVisibility.SHARED)
      expect(parseBoardVisibility('  shared  ')).toBe(BoardVisibility.SHARED)
    })

    it('parseBoardVisibility returns null for invalid values', () => {
      expect(parseBoardVisibility('weird')).toBeNull()
      expect(parseBoardVisibility(null)).toBeNull()
      expect(parseBoardVisibility(undefined)).toBeNull()
    })

    it('getBoardErrorMeta maps known stable board errors', () => {
      expect(getBoardErrorMeta(new Error('Board not found.'))).toEqual({
        status: 404,
        message: 'Board not found.',
        code: 'BOARD_NOT_FOUND',
      })

      expect(
        getBoardErrorMeta(new Error('Not allowed to manage this board.')),
      ).toEqual({
        status: 403,
        message: 'Not allowed to manage this board.',
        code: 'BOARD_FORBIDDEN',
      })

      expect(
        getBoardErrorMeta(new Error('A board with this name already exists.')),
      ).toEqual({
        status: 409,
        message: 'A board with this name already exists.',
        code: 'BOARD_NAME_CONFLICT',
      })
    })

    it('getBoardErrorMeta returns null for unknown errors', () => {
      expect(getBoardErrorMeta(new Error('something else'))).toBeNull()
      expect(getBoardErrorMeta('boom')).toBeNull()
    })
  })
})