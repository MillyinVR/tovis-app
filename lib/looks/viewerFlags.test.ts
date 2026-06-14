import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  prisma: {
    lookLike: { findMany: vi.fn() },
    boardItem: { findMany: vi.fn() },
    proFollow: { findMany: vi.fn() },
  },
}))

vi.mock('@/lib/prisma', () => ({ prisma: mocks.prisma }))

import { buildLooksViewerFlagResolver } from './viewerFlags'

const LOOK_1 = { id: 'look_1', professionalId: 'pro_1' }
const LOOK_2 = { id: 'look_2', professionalId: 'pro_2' }
const ITEMS = [LOOK_1, LOOK_2]

describe('buildLooksViewerFlagResolver', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.prisma.lookLike.findMany.mockResolvedValue([])
    mocks.prisma.boardItem.findMany.mockResolvedValue([])
    mocks.prisma.proFollow.findMany.mockResolvedValue([])
  })

  it('returns all-false and runs no queries for a guest', async () => {
    const resolve = await buildLooksViewerFlagResolver({ user: null, items: ITEMS })

    expect(resolve(LOOK_1)).toEqual({
      viewerLiked: false,
      viewerSaved: false,
      viewerFollows: false,
    })
    expect(mocks.prisma.lookLike.findMany).not.toHaveBeenCalled()
    expect(mocks.prisma.boardItem.findMany).not.toHaveBeenCalled()
    expect(mocks.prisma.proFollow.findMany).not.toHaveBeenCalled()
  })

  it('runs no queries when there are no items', async () => {
    const resolve = await buildLooksViewerFlagResolver({
      user: { id: 'user_1', clientProfile: { id: 'client_1' } },
      items: [],
    })

    expect(mocks.prisma.lookLike.findMany).not.toHaveBeenCalled()
    expect(mocks.prisma.proFollow.findMany).not.toHaveBeenCalled()
    // A row that wasn't in the (empty) page resolves to all-false.
    expect(resolve(LOOK_1)).toEqual({
      viewerLiked: false,
      viewerSaved: false,
      viewerFollows: false,
    })
  })

  it('queries only likes for a user without a client profile (e.g. a pro)', async () => {
    mocks.prisma.lookLike.findMany.mockResolvedValue([{ lookPostId: 'look_1' }])

    const resolve = await buildLooksViewerFlagResolver({
      user: { id: 'user_1', clientProfile: null },
      items: ITEMS,
    })

    expect(mocks.prisma.lookLike.findMany).toHaveBeenCalledWith({
      where: { userId: 'user_1', lookPostId: { in: ['look_1', 'look_2'] } },
      select: { lookPostId: true },
    })
    expect(mocks.prisma.boardItem.findMany).not.toHaveBeenCalled()
    expect(mocks.prisma.proFollow.findMany).not.toHaveBeenCalled()

    expect(resolve(LOOK_1)).toEqual({
      viewerLiked: true,
      viewerSaved: false,
      viewerFollows: false,
    })
    expect(resolve(LOOK_2).viewerLiked).toBe(false)
  })

  it('hydrates likes, saves, and follows for a client viewer', async () => {
    mocks.prisma.lookLike.findMany.mockResolvedValue([{ lookPostId: 'look_2' }])
    mocks.prisma.boardItem.findMany.mockResolvedValue([{ lookPostId: 'look_1' }])
    mocks.prisma.proFollow.findMany.mockResolvedValue([
      { professionalId: 'pro_1' },
    ])

    const resolve = await buildLooksViewerFlagResolver({
      user: { id: 'user_1', clientProfile: { id: 'client_1' } },
      items: ITEMS,
    })

    expect(mocks.prisma.boardItem.findMany).toHaveBeenCalledWith({
      where: {
        lookPostId: { in: ['look_1', 'look_2'] },
        board: { clientId: 'client_1' },
      },
      select: { lookPostId: true },
    })
    expect(mocks.prisma.proFollow.findMany).toHaveBeenCalledWith({
      where: { clientId: 'client_1', professionalId: { in: ['pro_1', 'pro_2'] } },
      select: { professionalId: true },
    })

    expect(resolve(LOOK_1)).toEqual({
      viewerLiked: false,
      viewerSaved: true,
      viewerFollows: true,
    })
    expect(resolve(LOOK_2)).toEqual({
      viewerLiked: true,
      viewerSaved: false,
      viewerFollows: false,
    })
  })
})
