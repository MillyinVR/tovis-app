// lib/boards/index.ts
import {
  BoardVisibility,
  Prisma,
  PrismaClient,
} from '@prisma/client'

import { looksBoardPreviewSelect } from '@/lib/looks/selects'
import { mapLooksBoardPreviewToDto } from '@/lib/looks/mappers'
import type { LooksBoardPreviewDto } from '@/lib/looks/types'

type BoardsDb = PrismaClient | Prisma.TransactionClient

const boardOwnerSelect = Prisma.validator<Prisma.BoardSelect>()({
  id: true,
  clientId: true,
  name: true,
  visibility: true,
  createdAt: true,
  updatedAt: true,
})

type BoardOwnerRow = Prisma.BoardGetPayload<{
  select: typeof boardOwnerSelect
}>

export type ViewerLookSaveState = {
  isSaved: boolean
  boardIds: string[]
  boards: Array<{
    id: string
    name: string
    visibility: BoardVisibility
  }>
}

function normalizeRequiredId(name: string, value: string): string {
  const trimmed = value.trim()
  if (!trimmed) {
    throw new Error(`${name} is required.`)
  }
  return trimmed
}

function normalizeOptionalId(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function normalizeBoardName(name: string): string {
  const trimmed = name.trim()
  if (!trimmed) {
    throw new Error('Board name is required.')
  }
  if (trimmed.length > 120) {
    throw new Error('Board name must be 120 characters or fewer.')
  }
  return trimmed
}

function normalizeTake(value: number | null | undefined): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 24
  return Math.min(Math.max(Math.trunc(value), 1), 100)
}

function normalizeSkip(value: number | null | undefined): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0
  return Math.max(Math.trunc(value), 0)
}

function canUseRootTransaction(db: BoardsDb): db is PrismaClient {
  return '$transaction' in db
}

async function withBoardsTx<T>(
  db: BoardsDb,
  fn: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  if (canUseRootTransaction(db)) {
    return db.$transaction(fn)
  }
  return fn(db)
}

export function canManageBoard(args: {
  viewerClientId: string | null | undefined
  ownerClientId: string
}): boolean {
  const viewerClientId = normalizeOptionalId(args.viewerClientId)
  const ownerClientId = normalizeRequiredId('ownerClientId', args.ownerClientId)
  return viewerClientId === ownerClientId
}

export function assertCanManageBoard(args: {
  viewerClientId: string | null | undefined
  ownerClientId: string
}): void {
  if (!canManageBoard(args)) {
    throw new Error('Not allowed to manage this board.')
  }
}

export async function requireBoardOwner(
  db: BoardsDb,
  args: {
    boardId: string
    clientId: string
  },
): Promise<BoardOwnerRow> {
  const boardId = normalizeRequiredId('boardId', args.boardId)
  const clientId = normalizeRequiredId('clientId', args.clientId)

  const board = await db.board.findUnique({
    where: { id: boardId },
    select: boardOwnerSelect,
  })

  if (!board) {
    throw new Error('Board not found.')
  }

  if (board.clientId !== clientId) {
    throw new Error('Not allowed to manage this board.')
  }

  return board
}

export async function createBoard(
  db: BoardsDb,
  args: {
    clientId: string
    name: string
    visibility?: BoardVisibility
  },
): Promise<BoardOwnerRow> {
  const clientId = normalizeRequiredId('clientId', args.clientId)
  const name = normalizeBoardName(args.name)
  const visibility = args.visibility ?? BoardVisibility.PRIVATE

  try {
    return await db.board.create({
      data: {
        clientId,
        name,
        visibility,
      },
      select: boardOwnerSelect,
    })
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    ) {
      throw new Error('A board with this name already exists.')
    }
    throw error
  }
}

export async function addBoardItem(
  db: BoardsDb,
  args: {
    boardId: string
    clientId: string
    lookPostId: string
  },
): Promise<{
  board: BoardOwnerRow
  itemId: string
  added: boolean
  saveCount: number
}> {
  const boardId = normalizeRequiredId('boardId', args.boardId)
  const clientId = normalizeRequiredId('clientId', args.clientId)
  const lookPostId = normalizeRequiredId('lookPostId', args.lookPostId)

  return withBoardsTx(db, async (tx) => {
    const board = await requireBoardOwner(tx, { boardId, clientId })

    const existing = await tx.boardItem.findUnique({
      where: {
        boardId_lookPostId: {
          boardId,
          lookPostId,
        },
      },
      select: { id: true },
    })

    if (existing) {
      const saveCount = await tx.boardItem.count({
        where: { lookPostId },
      })

      return {
        board,
        itemId: existing.id,
        added: false,
        saveCount,
      }
    }

    const created = await tx.boardItem.create({
      data: {
        boardId,
        lookPostId,
      },
      select: { id: true },
    })

    const saveCount = await tx.boardItem.count({
      where: { lookPostId },
    })

    return {
      board,
      itemId: created.id,
      added: true,
      saveCount,
    }
  })
}

export async function removeBoardItem(
  db: BoardsDb,
  args: {
    boardId: string
    clientId: string
    lookPostId: string
  },
): Promise<{
  board: BoardOwnerRow
  removed: boolean
  saveCount: number
}> {
  const boardId = normalizeRequiredId('boardId', args.boardId)
  const clientId = normalizeRequiredId('clientId', args.clientId)
  const lookPostId = normalizeRequiredId('lookPostId', args.lookPostId)

  return withBoardsTx(db, async (tx) => {
    const board = await requireBoardOwner(tx, { boardId, clientId })

    const deleted = await tx.boardItem.deleteMany({
      where: {
        boardId,
        lookPostId,
      },
    })

    const saveCount = await tx.boardItem.count({
      where: { lookPostId },
    })

    return {
      board,
      removed: deleted.count > 0,
      saveCount,
    }
  })
}

export async function getBoardSummaries(
  db: BoardsDb,
  args: {
    clientId: string
    viewerClientId?: string | null
    take?: number
    skip?: number
  },
): Promise<LooksBoardPreviewDto[]> {
  const clientId = normalizeRequiredId('clientId', args.clientId)

  if (args.viewerClientId !== undefined) {
    assertCanManageBoard({
      viewerClientId: args.viewerClientId,
      ownerClientId: clientId,
    })
  }

  const rows = await db.board.findMany({
    where: { clientId },
    orderBy: [{ updatedAt: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }],
    take: normalizeTake(args.take),
    skip: normalizeSkip(args.skip),
    select: looksBoardPreviewSelect,
  })

  return Promise.all(rows.map(mapLooksBoardPreviewToDto))
}

export async function getViewerLookSaveState(
  db: BoardsDb,
  args: {
    viewerClientId: string | null | undefined
    lookPostId: string
  },
): Promise<ViewerLookSaveState> {
  const viewerClientId = normalizeOptionalId(args.viewerClientId)
  const lookPostId = normalizeRequiredId('lookPostId', args.lookPostId)

  if (!viewerClientId) {
    return {
      isSaved: false,
      boardIds: [],
      boards: [],
    }
  }

  const rows = await db.boardItem.findMany({
    where: {
      lookPostId,
      board: {
        clientId: viewerClientId,
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

  const seenBoardIds = new Set<string>()
  const boards: ViewerLookSaveState['boards'] = []

  for (const row of rows) {
    if (seenBoardIds.has(row.boardId)) continue
    seenBoardIds.add(row.boardId)

    boards.push({
      id: row.board.id,
      name: row.board.name,
      visibility: row.board.visibility,
    })
  }

  return {
    isSaved: boards.length > 0,
    boardIds: boards.map((board) => board.id),
    boards,
  }
}