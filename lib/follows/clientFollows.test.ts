// lib/follows/clientFollows.test.ts
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Prisma, PrismaClient } from '@prisma/client'

import {
  buildClientFollowStateResponse,
  countClientFollowers,
  getClientFollowErrorMeta,
  getClientFollowState,
  getViewerClientFollowState,
  requireFollowableClientByHandle,
  toggleClientFollow,
} from './clientFollows'

function makeTxDb() {
  return {
    clientFollow: {
      findUnique: vi.fn(),
      create: vi.fn(),
      delete: vi.fn(),
      count: vi.fn(),
    },
    clientProfile: {
      findUnique: vi.fn(),
    },
  }
}

function makeRootDb(tx: ReturnType<typeof makeTxDb>) {
  return {
    ...tx,
    $transaction: vi.fn(
      async (fn: (innerTx: ReturnType<typeof makeTxDb>) => Promise<unknown>) =>
        fn(tx),
    ),
  }
}

function asTxDb(db: ReturnType<typeof makeTxDb>): Prisma.TransactionClient {
  return db as unknown as Prisma.TransactionClient
}

function asRootDb(db: ReturnType<typeof makeRootDb>): PrismaClient {
  return db as unknown as PrismaClient
}

describe('requireFollowableClientByHandle', () => {
  let tx: ReturnType<typeof makeTxDb>

  beforeEach(() => {
    tx = makeTxDb()
  })

  it('returns the public client when the handle resolves', async () => {
    tx.clientProfile.findUnique.mockResolvedValue({
      id: 'client_2',
      handle: 'amara',
      isPublicProfile: true,
    })

    const result = await requireFollowableClientByHandle(asTxDb(tx), 'Amara')

    expect(tx.clientProfile.findUnique).toHaveBeenCalledWith({
      where: { handleNormalized: 'amara' },
      select: expect.anything(),
    })
    expect(result.id).toBe('client_2')
  })

  it('throws "Public profile not found." for a missing handle', async () => {
    tx.clientProfile.findUnique.mockResolvedValue(null)

    await expect(
      requireFollowableClientByHandle(asTxDb(tx), 'ghost'),
    ).rejects.toThrow('Public profile not found.')
  })

  it('throws "Public profile not found." for a private (non-public) profile', async () => {
    tx.clientProfile.findUnique.mockResolvedValue({
      id: 'client_2',
      handle: 'amara',
      isPublicProfile: false,
    })

    await expect(
      requireFollowableClientByHandle(asTxDb(tx), 'amara'),
    ).rejects.toThrow('Public profile not found.')
  })

  it('throws for a blank handle without hitting the DB', async () => {
    await expect(
      requireFollowableClientByHandle(asTxDb(tx), '   '),
    ).rejects.toThrow('Public profile not found.')
    expect(tx.clientProfile.findUnique).not.toHaveBeenCalled()
  })
})

describe('getViewerClientFollowState', () => {
  let tx: ReturnType<typeof makeTxDb>

  beforeEach(() => {
    tx = makeTxDb()
  })

  it('returns false for a guest (no viewer) without a query', async () => {
    const following = await getViewerClientFollowState(asTxDb(tx), {
      viewerClientId: null,
      followedClientId: 'client_2',
    })

    expect(following).toBe(false)
    expect(tx.clientFollow.findUnique).not.toHaveBeenCalled()
  })

  it('returns false when the viewer is the owner, without a query', async () => {
    const following = await getViewerClientFollowState(asTxDb(tx), {
      viewerClientId: 'client_2',
      followedClientId: 'client_2',
    })

    expect(following).toBe(false)
    expect(tx.clientFollow.findUnique).not.toHaveBeenCalled()
  })

  it('returns true when a follow row exists', async () => {
    tx.clientFollow.findUnique.mockResolvedValue({ id: 'follow_1' })

    const following = await getViewerClientFollowState(asTxDb(tx), {
      viewerClientId: 'client_1',
      followedClientId: 'client_2',
    })

    expect(following).toBe(true)
    expect(tx.clientFollow.findUnique).toHaveBeenCalledWith({
      where: {
        followerClientId_followedClientId: {
          followerClientId: 'client_1',
          followedClientId: 'client_2',
        },
      },
      select: { id: true },
    })
  })
})

describe('getClientFollowState', () => {
  it('combines viewer follow state with the follower count', async () => {
    const tx = makeTxDb()
    tx.clientFollow.findUnique.mockResolvedValue({ id: 'follow_1' })
    tx.clientFollow.count.mockResolvedValue(7)

    const state = await getClientFollowState(asTxDb(tx), {
      viewerClientId: 'client_1',
      followedClientId: 'client_2',
    })

    expect(state).toEqual({ following: true, followerCount: 7 })
  })
})

describe('countClientFollowers', () => {
  it('counts rows for the followed client', async () => {
    const tx = makeTxDb()
    tx.clientFollow.count.mockResolvedValue(3)

    const count = await countClientFollowers(asTxDb(tx), 'client_2')

    expect(count).toBe(3)
    expect(tx.clientFollow.count).toHaveBeenCalledWith({
      where: { followedClientId: 'client_2' },
    })
  })
})

describe('toggleClientFollow', () => {
  let tx: ReturnType<typeof makeTxDb>
  let root: ReturnType<typeof makeRootDb>

  beforeEach(() => {
    tx = makeTxDb()
    root = makeRootDb(tx)
  })

  it('creates a follow when none exists and returns the new count', async () => {
    tx.clientFollow.findUnique.mockResolvedValue(null)
    tx.clientFollow.create.mockResolvedValue({ id: 'follow_1' })
    tx.clientFollow.count.mockResolvedValue(1)

    const result = await toggleClientFollow(asRootDb(root), {
      followerClientId: 'client_1',
      followedClientId: 'client_2',
    })

    expect(root.$transaction).toHaveBeenCalledTimes(1)
    expect(tx.clientFollow.create).toHaveBeenCalledWith({
      data: { followerClientId: 'client_1', followedClientId: 'client_2' },
      select: { id: true },
    })
    expect(tx.clientFollow.delete).not.toHaveBeenCalled()
    expect(result).toEqual({ following: true, followerCount: 1 })
  })

  it('removes an existing follow and returns the decremented count', async () => {
    tx.clientFollow.findUnique.mockResolvedValue({ id: 'follow_1' })
    tx.clientFollow.count.mockResolvedValue(0)

    const result = await toggleClientFollow(asRootDb(root), {
      followerClientId: 'client_1',
      followedClientId: 'client_2',
    })

    expect(tx.clientFollow.delete).toHaveBeenCalledWith({
      where: {
        followerClientId_followedClientId: {
          followerClientId: 'client_1',
          followedClientId: 'client_2',
        },
      },
    })
    expect(tx.clientFollow.create).not.toHaveBeenCalled()
    expect(result).toEqual({ following: false, followerCount: 0 })
  })

  it('rejects a self-follow before touching the DB', async () => {
    await expect(
      toggleClientFollow(asRootDb(root), {
        followerClientId: 'client_1',
        followedClientId: 'client_1',
      }),
    ).rejects.toThrow('You can’t follow yourself.')

    expect(root.$transaction).not.toHaveBeenCalled()
  })
})

describe('getClientFollowErrorMeta', () => {
  it('maps "Public profile not found." to a 404', () => {
    expect(
      getClientFollowErrorMeta(new Error('Public profile not found.')),
    ).toEqual({
      status: 404,
      message: 'Public profile not found.',
      code: 'CLIENT_PROFILE_NOT_FOUND',
    })
  })

  it('maps the self-follow error to a 403', () => {
    expect(
      getClientFollowErrorMeta(new Error('You can’t follow yourself.')),
    ).toEqual({
      status: 403,
      message: 'You can’t follow yourself.',
      code: 'SELF_FOLLOW_FORBIDDEN',
    })
  })

  it('returns null for unrelated errors', () => {
    expect(getClientFollowErrorMeta(new Error('boom'))).toBeNull()
  })
})

describe('buildClientFollowStateResponse', () => {
  it('clamps a negative count to zero', () => {
    expect(
      buildClientFollowStateResponse({
        handle: 'amara',
        following: true,
        followerCount: -4,
      }),
    ).toEqual({ handle: 'amara', following: true, followerCount: 0 })
  })
})
