// lib/boards/index.test.ts
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { BoardVisibility, Prisma } from '@prisma/client'

const mocks = vi.hoisted(() => {
  return {
    looksBoardPreviewSelect: { __mocked: 'looksBoardPreviewSelect' },
    mapLooksBoardPreviewToDto: vi.fn(),
  }
})

vi.mock('@/lib/looks/selects', () => ({
  looksBoardPreviewSelect: mocks.looksBoardPreviewSelect,
}))

vi.mock('@/lib/looks/mappers', () => ({
  mapLooksBoardPreviewToDto: mocks.mapLooksBoardPreviewToDto,
}))

import {
  addBoardItem,
  assertCanManageBoard,
  canManageBoard,
  createBoard,
  getBoardSummaries,
  getViewerLookSaveState,
  removeBoardItem,
  requireBoardOwner,
} from './index'

function asTransactionClient(
  value: ReturnType<typeof makeDb>,
): Prisma.TransactionClient {
  return value as unknown as Prisma.TransactionClient
}

function makeDb() {
  return {
    board: {
      findUnique: vi.fn(),
      create: vi.fn(),
      findMany: vi.fn(),
    },
    boardItem: {
      findUnique: vi.fn(),
      create: vi.fn(),
      count: vi.fn(),
      deleteMany: vi.fn(),
      findMany: vi.fn(),
    },
  }
}

describe('lib/boards/index.ts', () => {
  beforeEach(() => {
    vi.clearAllMocks()
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

      db.board.findUnique.mockResolvedValue({
        id: 'board_1',
        clientId: 'client_1',
        name: 'Hair ideas',
        visibility: BoardVisibility.PRIVATE,
        createdAt: new Date('2026-04-18T10:00:00.000Z'),
        updatedAt: new Date('2026-04-18T11:00:00.000Z'),
      })

      await expect(
        requireBoardOwner(asTransactionClient(db), {
          boardId: 'board_1',
          clientId: 'client_1',
        }),
      ).resolves.toEqual({
        id: 'board_1',
        clientId: 'client_1',
        name: 'Hair ideas',
        visibility: BoardVisibility.PRIVATE,
        createdAt: new Date('2026-04-18T10:00:00.000Z'),
        updatedAt: new Date('2026-04-18T11:00:00.000Z'),
      })

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
        requireBoardOwner(asTransactionClient(db), {
          boardId: 'board_missing',
          clientId: 'client_1',
        }),
      ).rejects.toThrow('Board not found.')
    })

    it('throws when the board belongs to a different client', async () => {
      const db = makeDb()

      db.board.findUnique.mockResolvedValue({
        id: 'board_1',
        clientId: 'client_2',
        name: 'Not yours',
        visibility: BoardVisibility.PRIVATE,
        createdAt: new Date('2026-04-18T10:00:00.000Z'),
        updatedAt: new Date('2026-04-18T11:00:00.000Z'),
      })

      await expect(
        requireBoardOwner(asTransactionClient(db), {
          boardId: 'board_1',
          clientId: 'client_1',
        }),
      ).rejects.toThrow('Not allowed to manage this board.')
    })
  })

  describe('createBoard', () => {
    it('creates a board with normalized name and default PRIVATE visibility', async () => {
      const db = makeDb()

      db.board.create.mockResolvedValue({
        id: 'board_1',
        clientId: 'client_1',
        name: 'Hair ideas',
        visibility: BoardVisibility.PRIVATE,
        createdAt: new Date('2026-04-18T10:00:00.000Z'),
        updatedAt: new Date('2026-04-18T10:00:00.000Z'),
      })

      const result = await createBoard(asTransactionClient(db), {
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

      expect(result).toEqual({
        id: 'board_1',
        clientId: 'client_1',
        name: 'Hair ideas',
        visibility: BoardVisibility.PRIVATE,
        createdAt: new Date('2026-04-18T10:00:00.000Z'),
        updatedAt: new Date('2026-04-18T10:00:00.000Z'),
      })
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
        createBoard(asTransactionClient(db), {
          clientId: 'client_1',
          name: 'Hair ideas',
        }),
      ).rejects.toThrow('A board with this name already exists.')
    })
  })

  describe('addBoardItem', () => {
    it('creates a board item when the look is not already saved to that board', async () => {
      const db = makeDb()

      db.board.findUnique.mockResolvedValue({
        id: 'board_1',
        clientId: 'client_1',
        name: 'Hair ideas',
        visibility: BoardVisibility.PRIVATE,
        createdAt: new Date('2026-04-18T10:00:00.000Z'),
        updatedAt: new Date('2026-04-18T10:00:00.000Z'),
      })
      db.boardItem.findUnique.mockResolvedValue(null)
      db.boardItem.create.mockResolvedValue({ id: 'item_1' })
      db.boardItem.count.mockResolvedValue(3)

      const result = await addBoardItem(asTransactionClient(db), {
        boardId: 'board_1',
        clientId: 'client_1',
        lookPostId: 'look_1',
      })

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

      expect(result).toEqual({
        board: {
          id: 'board_1',
          clientId: 'client_1',
          name: 'Hair ideas',
          visibility: BoardVisibility.PRIVATE,
          createdAt: new Date('2026-04-18T10:00:00.000Z'),
          updatedAt: new Date('2026-04-18T10:00:00.000Z'),
        },
        itemId: 'item_1',
        added: true,
        saveCount: 3,
      })
    })

    it('does not create a duplicate board item when the look is already saved', async () => {
      const db = makeDb()

      db.board.findUnique.mockResolvedValue({
        id: 'board_1',
        clientId: 'client_1',
        name: 'Hair ideas',
        visibility: BoardVisibility.PRIVATE,
        createdAt: new Date('2026-04-18T10:00:00.000Z'),
        updatedAt: new Date('2026-04-18T10:00:00.000Z'),
      })
      db.boardItem.findUnique.mockResolvedValue({ id: 'item_existing' })
      db.boardItem.count.mockResolvedValue(2)

      const result = await addBoardItem(asTransactionClient(db), {
        boardId: 'board_1',
        clientId: 'client_1',
        lookPostId: 'look_1',
      })

      expect(db.boardItem.create).not.toHaveBeenCalled()
      expect(result).toEqual({
        board: {
          id: 'board_1',
          clientId: 'client_1',
          name: 'Hair ideas',
          visibility: BoardVisibility.PRIVATE,
          createdAt: new Date('2026-04-18T10:00:00.000Z'),
          updatedAt: new Date('2026-04-18T10:00:00.000Z'),
        },
        itemId: 'item_existing',
        added: false,
        saveCount: 2,
      })
    })
  })

  describe('removeBoardItem', () => {
    it('removes the board item and returns the updated save count', async () => {
      const db = makeDb()

      db.board.findUnique.mockResolvedValue({
        id: 'board_1',
        clientId: 'client_1',
        name: 'Hair ideas',
        visibility: BoardVisibility.PRIVATE,
        createdAt: new Date('2026-04-18T10:00:00.000Z'),
        updatedAt: new Date('2026-04-18T10:00:00.000Z'),
      })
      db.boardItem.deleteMany.mockResolvedValue({ count: 1 })
      db.boardItem.count.mockResolvedValue(1)

      const result = await removeBoardItem(asTransactionClient(db), {
        boardId: 'board_1',
        clientId: 'client_1',
        lookPostId: 'look_1',
      })

      expect(db.boardItem.deleteMany).toHaveBeenCalledWith({
        where: {
          boardId: 'board_1',
          lookPostId: 'look_1',
        },
      })

      expect(result).toEqual({
        board: {
          id: 'board_1',
          clientId: 'client_1',
          name: 'Hair ideas',
          visibility: BoardVisibility.PRIVATE,
          createdAt: new Date('2026-04-18T10:00:00.000Z'),
          updatedAt: new Date('2026-04-18T10:00:00.000Z'),
        },
        removed: true,
        saveCount: 1,
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

      const result = await getBoardSummaries(asTransactionClient(db), {
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
        getBoardSummaries(asTransactionClient(db), {
          clientId: 'client_1',
          viewerClientId: 'client_2',
        }),
      ).rejects.toThrow('Not allowed to manage this board.')

      expect(db.board.findMany).not.toHaveBeenCalled()
    })
  })

  describe('getViewerLookSaveState', () => {
    it('returns unsaved when there is no viewer client id', async () => {
      const db = makeDb()

      const result = await getViewerLookSaveState(asTransactionClient(db), {
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

      const result = await getViewerLookSaveState(asTransactionClient(db), {
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
})