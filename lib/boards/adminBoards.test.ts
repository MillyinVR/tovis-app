import { describe, expect, it, vi } from 'vitest'

import {
  isAdminBoardVisibilityFilter,
  setBoardHidden,
} from './adminBoards'

describe('isAdminBoardVisibilityFilter', () => {
  it('accepts the known filters', () => {
    expect(isAdminBoardVisibilityFilter('ALL')).toBe(true)
    expect(isAdminBoardVisibilityFilter('VISIBLE')).toBe(true)
    expect(isAdminBoardVisibilityFilter('HIDDEN')).toBe(true)
  })

  it('rejects anything else', () => {
    expect(isAdminBoardVisibilityFilter('hidden')).toBe(false)
    expect(isAdminBoardVisibilityFilter(null)).toBe(false)
    expect(isAdminBoardVisibilityFilter(undefined)).toBe(false)
  })
})

// Minimal structural db — real Prisma and this stub both satisfy it.
import type { BoardHideDb } from './adminBoards'

function makeDb() {
  return {
    board: { findUnique: vi.fn(), update: vi.fn() },
  }
}

const NOW = new Date('2026-07-07T00:00:00.000Z')

describe('setBoardHidden', () => {
  it('returns found:false for a missing board', async () => {
    const db = makeDb()
    db.board.findUnique.mockResolvedValue(null)

    const result = await setBoardHidden(db, {
      boardId: 'board_1',
      hidden: true,
      adminUserId: 'admin_1',
      now: NOW,
    })

    expect(result).toEqual({ found: false })
    expect(db.board.update).not.toHaveBeenCalled()
  })

  it('hides a visible board and stamps hiddenAt + admin id', async () => {
    const db = makeDb()
    db.board.findUnique.mockResolvedValue({
      id: 'board_1',
      hiddenAt: null,
      slug: 'hair',
      client: { handle: 'alice' },
    })
    db.board.update.mockResolvedValue({ hiddenAt: NOW })

    const result = await setBoardHidden(db, {
      boardId: 'board_1',
      hidden: true,
      adminUserId: 'admin_1',
      now: NOW,
    })

    expect(db.board.update).toHaveBeenCalledWith({
      where: { id: 'board_1' },
      data: { hiddenAt: NOW, hiddenByUserId: 'admin_1' },
      select: { hiddenAt: true },
    })
    expect(result).toEqual({
      found: true,
      changed: true,
      hidden: true,
      hiddenAt: NOW.toISOString(),
      slug: 'hair',
      ownerHandle: 'alice',
    })
  })

  it('is a no-op when already in the requested state', async () => {
    const db = makeDb()
    db.board.findUnique.mockResolvedValue({
      id: 'board_1',
      hiddenAt: NOW,
      slug: 'hair',
      client: { handle: 'alice' },
    })

    const result = await setBoardHidden(db, {
      boardId: 'board_1',
      hidden: true,
      adminUserId: 'admin_1',
      now: NOW,
    })

    expect(result).toMatchObject({ found: true, changed: false, hidden: true })
    expect(db.board.update).not.toHaveBeenCalled()
  })

  it('unhides a hidden board and clears the admin id', async () => {
    const db = makeDb()
    db.board.findUnique.mockResolvedValue({
      id: 'board_1',
      hiddenAt: NOW,
      slug: 'hair',
      client: { handle: 'alice' },
    })
    db.board.update.mockResolvedValue({ hiddenAt: null })

    const result = await setBoardHidden(db, {
      boardId: 'board_1',
      hidden: false,
      adminUserId: 'admin_1',
      now: NOW,
    })

    expect(db.board.update).toHaveBeenCalledWith({
      where: { id: 'board_1' },
      data: { hiddenAt: null, hiddenByUserId: null },
      select: { hiddenAt: true },
    })
    expect(result).toMatchObject({ changed: true, hidden: false, hiddenAt: null })
  })
})
