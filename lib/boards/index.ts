// lib/boards/index.ts
import {
  BoardType,
  BoardVisibility,
  Prisma,
  PrismaClient,
} from '@prisma/client'

import {
  mapLooksBoardDetailToDto,
  mapLooksBoardPreviewToDto,
} from '@/lib/looks/mappers'
import { recomputeLookPostSaveCount } from '@/lib/looks/counters'
import {
  looksBoardDetailSelect,
  looksBoardPreviewSelect,
} from '@/lib/looks/selects'
import type {
  LooksBoardDetailDto,
  LooksBoardItemMutationResponseDto,
  LooksBoardPreviewDto,
  LooksSaveStateResponseDto,
} from '@/lib/looks/types'
import { enqueueRecomputeLookCounts } from '@/lib/jobs/looksSocial/enqueue'
import { asTrimmedString, normalizeRequiredId } from '@/lib/guards'
import { resolveAvailableBoardSlug } from '@/lib/boards/slug'
import {
  boardTypeWantsEventDate,
  normalizeBoardAnswers,
} from '@/lib/boards/context'

type BoardsDb = PrismaClient | Prisma.TransactionClient

const boardOwnerSelect = Prisma.validator<Prisma.BoardSelect>()({
  id: true,
  clientId: true,
  name: true,
  slug: true,
  visibility: true,
  type: true,
  eventDate: true,
  answers: true,
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

export type BoardErrorMeta = {
  status: 400 | 403 | 404 | 409
  message: string
  code:
    | 'INVALID_BOARD_NAME'
    | 'INVALID_BOARD_VISIBILITY'
    | 'BOARD_NOT_FOUND'
    | 'BOARD_FORBIDDEN'
    | 'BOARD_NAME_CONFLICT'
}

export function parseBoardVisibility(
  value: string | null | undefined,
): BoardVisibility | null {
  const trimmed = asTrimmedString(value)
  if (!trimmed) return null

  const upper = trimmed.toUpperCase()

  if (upper === BoardVisibility.PRIVATE) return BoardVisibility.PRIVATE
  if (upper === BoardVisibility.SHARED) return BoardVisibility.SHARED

  return null
}

export function getBoardErrorMeta(error: unknown): BoardErrorMeta | null {
  const message = error instanceof Error ? error.message : ''

  switch (message) {
    case 'Board name is required.':
    case 'Board name must be 120 characters or fewer.':
      return {
        status: 400,
        message,
        code: 'INVALID_BOARD_NAME',
      }
    case 'Board not found.':
      return {
        status: 404,
        message,
        code: 'BOARD_NOT_FOUND',
      }
    case 'Not allowed to manage this board.':
      return {
        status: 403,
        message,
        code: 'BOARD_FORBIDDEN',
      }
    case 'A board with this name already exists.':
      return {
        status: 409,
        message,
        code: 'BOARD_NAME_CONFLICT',
      }
    default:
      return null
  }
}

export function buildLooksSaveStateResponse(args: {
  lookPostId: string
  saveCount: number
  state: ViewerLookSaveState
}): LooksSaveStateResponseDto {
  const lookPostId = normalizeRequiredId('lookPostId', args.lookPostId)

  return {
    lookPostId,
    isSaved: args.state.isSaved,
    saveCount: Math.max(Math.trunc(args.saveCount), 0),
    boardIds: [...args.state.boardIds],
    boards: args.state.boards.map((board) => ({
      id: board.id,
      name: board.name,
      visibility: board.visibility,
    })),
  }
}

export function buildLooksBoardItemMutationResponse(args: {
  boardId: string
  lookPostId: string
  inBoard: boolean
  saveCount: number
  state: ViewerLookSaveState
}): LooksBoardItemMutationResponseDto {
  const save = buildLooksSaveStateResponse({
    lookPostId: args.lookPostId,
    saveCount: args.saveCount,
    state: args.state,
  })

  return {
    boardId: normalizeRequiredId('boardId', args.boardId),
    lookPostId: save.lookPostId,
    inBoard: args.inBoard,
    isSaved: save.isSaved,
    saveCount: save.saveCount,
    boardIds: save.boardIds,
    boards: save.boards,
  }
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
  const viewerClientId = asTrimmedString(args.viewerClientId)
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
    type?: BoardType
    /** Calendar event date (UTC-midnight `@db.Date` value) — bridal/prom only. */
    eventDate?: Date | null
    /** Raw creation-question answers; validated against the type's question set. */
    answers?: unknown
  },
): Promise<BoardOwnerRow> {
  const clientId = normalizeRequiredId('clientId', args.clientId)
  const name = normalizeBoardName(args.name)
  const visibility = args.visibility ?? BoardVisibility.PRIVATE
  const type = args.type ?? BoardType.GENERAL
  const eventDate = boardTypeWantsEventDate(type) ? args.eventDate ?? null : null
  const answers = normalizeBoardAnswers(type, args.answers)
  const slug = await resolveAvailableBoardSlug(db, { clientId, name })

  try {
    return await db.board.create({
      data: {
        clientId,
        name,
        slug,
        visibility,
        type,
        eventDate,
        ...(answers ? { answers } : {}),
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

export async function getBoardDetail(
  db: BoardsDb,
  args: {
    boardId: string
    clientId: string
  },
): Promise<LooksBoardDetailDto> {
  const boardId = normalizeRequiredId('boardId', args.boardId)
  const clientId = normalizeRequiredId('clientId', args.clientId)

  await requireBoardOwner(db, { boardId, clientId })

  const row = await db.board.findUnique({
    where: { id: boardId },
    select: looksBoardDetailSelect,
  })

  if (!row) {
    throw new Error('Board not found.')
  }

  return mapLooksBoardDetailToDto(row)
}

export async function updateBoard(
  db: BoardsDb,
  args: {
    boardId: string
    clientId: string
    name?: string
    visibility?: BoardVisibility
    type?: BoardType
    /** Calendar event date (UTC-midnight `@db.Date` value); null clears it. */
    eventDate?: Date | null
    /** Raw answers, re-validated against the board's (possibly new) type. */
    answers?: unknown
  },
): Promise<BoardOwnerRow> {
  const boardId = normalizeRequiredId('boardId', args.boardId)
  const clientId = normalizeRequiredId('clientId', args.clientId)

  const current = await requireBoardOwner(db, { boardId, clientId })

  const data: Prisma.BoardUpdateInput = {}

  if (args.name !== undefined) {
    const name = normalizeBoardName(args.name)
    data.name = name
    // Keep the public slug in step with a rename (excluding this board's own
    // slug family), so a shared board's URL tracks its current name.
    data.slug = await resolveAvailableBoardSlug(db, {
      clientId,
      name,
      excludeBoardId: current.id,
    })
  }

  if (args.visibility !== undefined) {
    data.visibility = args.visibility
  }

  // Context follows the type: re-purposing a board re-validates answers
  // against the NEW type's question set (stale answers never survive) and
  // drops the event date when the new type has no event semantics.
  const effectiveType = args.type ?? current.type

  if (args.type !== undefined && args.type !== current.type) {
    data.type = args.type
    const answers = normalizeBoardAnswers(args.type, args.answers)
    data.answers = answers ?? Prisma.DbNull
    if (!boardTypeWantsEventDate(args.type)) {
      data.eventDate = null
    }
  } else if (args.answers !== undefined) {
    const answers = normalizeBoardAnswers(effectiveType, args.answers)
    data.answers = answers ?? Prisma.DbNull
  }

  if (args.eventDate !== undefined) {
    data.eventDate = boardTypeWantsEventDate(effectiveType)
      ? args.eventDate
      : null
  }

  if (Object.keys(data).length === 0) {
    return current
  }

  try {
    return await db.board.update({
      where: { id: current.id },
      data,
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

export async function deleteBoard(
  db: BoardsDb,
  args: {
    boardId: string
    clientId: string
  },
): Promise<{ id: string }> {
  const board = await requireBoardOwner(db, args)

  return db.board.delete({
    where: { id: board.id },
    select: { id: true },
  })
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
      const saveCount = await recomputeLookPostSaveCount(tx, lookPostId)
      await enqueueRecomputeLookCounts(tx, { lookPostId })

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

    const saveCount = await recomputeLookPostSaveCount(tx, lookPostId)
    await enqueueRecomputeLookCounts(tx, { lookPostId })

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

    const saveCount = await recomputeLookPostSaveCount(tx, lookPostId)
    await enqueueRecomputeLookCounts(tx, { lookPostId })

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
  const viewerClientId = asTrimmedString(args.viewerClientId)
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