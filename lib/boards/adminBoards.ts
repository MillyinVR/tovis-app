// lib/boards/adminBoards.ts
//
// SUPER_ADMIN moderation for public (SHARED) boards (social-first D3): list the
// shared boards and hide/unhide one. A hidden board 404s on its public page +
// share surfaces (via loadPublicBoard's `hiddenAt: null` gate) while the owner
// keeps their private copy. Boards are addressed by handle — no legal-name PII
// is read — so this lives in lib/boards, not lib/privacy (like the D1 tag
// admin, and unlike the pro-scoped adminLookModeration).
import { BoardVisibility, Prisma } from '@prisma/client'

import { prisma } from '@/lib/prisma'
import { normalizeRequiredId } from '@/lib/guards'

const QMODE: Prisma.QueryMode = 'insensitive'

// Minimal structural db for setBoardHidden — real Prisma and a plain vi.fn stub
// both satisfy it, so the setter is unit-testable without a DB or type escape.
type BoardHideRow = {
  id: string
  hiddenAt: Date | null
  slug: string
  client: { handle: string | null }
}

export type BoardHideDb = {
  board: {
    findUnique(args: {
      where: { id: string }
      select: {
        id: true
        hiddenAt: true
        slug: true
        client: { select: { handle: true } }
      }
    }): Promise<BoardHideRow | null>
    update(args: {
      where: { id: string }
      data:
        | { hiddenAt: Date; hiddenByUserId: string }
        | { hiddenAt: null; hiddenByUserId: null }
      select: { hiddenAt: true }
    }): Promise<{ hiddenAt: Date | null }>
  }
}

export type AdminBoardVisibilityFilter = 'ALL' | 'VISIBLE' | 'HIDDEN'

const ADMIN_BOARD_VISIBILITY_FILTERS: readonly AdminBoardVisibilityFilter[] = [
  'ALL',
  'VISIBLE',
  'HIDDEN',
]

export function isAdminBoardVisibilityFilter(
  value: string | null | undefined,
): value is AdminBoardVisibilityFilter {
  return (
    typeof value === 'string' &&
    (ADMIN_BOARD_VISIBILITY_FILTERS as readonly string[]).includes(value)
  )
}

export type AdminBoardRow = {
  boardId: string
  name: string
  slug: string
  ownerHandle: string | null
  ownerClientId: string
  itemCount: number
  hidden: boolean
  hiddenAt: string | null
  createdAt: string
  /** Public board URL when the owner has a handle, else null. */
  publicUrl: string | null
}

export async function listAdminBoards(args: {
  q?: string | null
  visibility?: AdminBoardVisibilityFilter
}): Promise<AdminBoardRow[]> {
  const q = typeof args.q === 'string' ? args.q.trim() : ''
  const visibility = args.visibility ?? 'ALL'

  const where: Prisma.BoardWhereInput = {
    visibility: BoardVisibility.SHARED,
    ...(visibility === 'HIDDEN'
      ? { hiddenAt: { not: null } }
      : visibility === 'VISIBLE'
        ? { hiddenAt: null }
        : {}),
    ...(q
      ? {
          OR: [
            { name: { contains: q, mode: QMODE } },
            { slug: { contains: q, mode: QMODE } },
            { client: { is: { handle: { contains: q, mode: QMODE } } } },
          ],
        }
      : {}),
  }

  const rows = await prisma.board.findMany({
    where,
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: 200,
    select: {
      id: true,
      name: true,
      slug: true,
      hiddenAt: true,
      createdAt: true,
      clientId: true,
      _count: { select: { items: true } },
      client: { select: { handle: true } },
    },
  })

  return rows.map((row) => {
    const handle = row.client.handle
    return {
      boardId: row.id,
      name: row.name,
      slug: row.slug,
      ownerHandle: handle,
      ownerClientId: row.clientId,
      itemCount: row._count.items,
      hidden: row.hiddenAt !== null,
      hiddenAt: row.hiddenAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
      publicUrl: handle ? `/u/${handle}/boards/${row.slug}` : null,
    }
  })
}

export type SetBoardHiddenResult =
  | { found: false }
  | {
      found: true
      changed: boolean
      hidden: boolean
      hiddenAt: string | null
      slug: string
      ownerHandle: string | null
    }

export async function setBoardHidden(
  db: BoardHideDb,
  args: {
    boardId: string
    hidden: boolean
    adminUserId: string
    now: Date
  },
): Promise<SetBoardHiddenResult> {
  const boardId = normalizeRequiredId('boardId', args.boardId)

  const board = await db.board.findUnique({
    where: { id: boardId },
    select: {
      id: true,
      hiddenAt: true,
      slug: true,
      client: { select: { handle: true } },
    },
  })

  if (!board) return { found: false }

  const alreadyHidden = board.hiddenAt !== null
  const ownerHandle = board.client.handle

  if (alreadyHidden === args.hidden) {
    return {
      found: true,
      changed: false,
      hidden: alreadyHidden,
      hiddenAt: board.hiddenAt?.toISOString() ?? null,
      slug: board.slug,
      ownerHandle,
    }
  }

  const updated = await db.board.update({
    where: { id: board.id },
    data: args.hidden
      ? { hiddenAt: args.now, hiddenByUserId: args.adminUserId }
      : { hiddenAt: null, hiddenByUserId: null },
    select: { hiddenAt: true },
  })

  return {
    found: true,
    changed: true,
    hidden: args.hidden,
    hiddenAt: updated.hiddenAt?.toISOString() ?? null,
    slug: board.slug,
    ownerHandle,
  }
}
