// lib/follows/index.test.ts
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Prisma, PrismaClient, VerificationStatus } from '@prisma/client'

import {
  assertCanViewFollowingList,
  canViewFollowingList,
  countFollowers,
  getViewerFollowState,
  listFollowing,
  toggleProFollow,
} from './index'

function makeTxDb() {
  return {
    proFollow: {
      findUnique: vi.fn(),
      create: vi.fn(),
      delete: vi.fn(),
      count: vi.fn(),
      findMany: vi.fn(),
    },
  }
}

function makeRootDb(tx: ReturnType<typeof makeTxDb>) {
  return {
    ...tx,
    $transaction: vi.fn(
      async (
        fn: (
          innerTx: ReturnType<typeof makeTxDb>,
        ) => Promise<unknown>,
      ) => fn(tx),
    ),
  }
}

function asTxDb(db: ReturnType<typeof makeTxDb>): Prisma.TransactionClient {
  return db as unknown as Prisma.TransactionClient
}

function asRootDb(
  db: ReturnType<typeof makeRootDb>,
): PrismaClient {
  return db as unknown as PrismaClient
}

describe('lib/follows/index.ts', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('following list ownership helpers', () => {
    it('allows a client to view their own following list', () => {
      expect(
        canViewFollowingList({
          viewerClientId: 'client_1',
          ownerClientId: 'client_1',
        }),
      ).toBe(true)
    })

    it('blocks a different client from viewing the following list', () => {
      expect(
        canViewFollowingList({
          viewerClientId: 'client_2',
          ownerClientId: 'client_1',
        }),
      ).toBe(false)
    })

    it('throws when the viewer cannot view the following list', () => {
      expect(() =>
        assertCanViewFollowingList({
          viewerClientId: 'client_2',
          ownerClientId: 'client_1',
        }),
      ).toThrow('Not allowed to view this following list.')
    })
  })

  describe('toggleProFollow', () => {
    it('creates a follow when none exists and returns updated follower count', async () => {
      const tx = makeTxDb()
      const db = asRootDb(makeRootDb(tx))

      tx.proFollow.findUnique.mockResolvedValue(null)
      tx.proFollow.create.mockResolvedValue({ id: 'follow_1' })
      tx.proFollow.count.mockResolvedValue(5)

      const result = await toggleProFollow(db, {
        clientId: 'client_1',
        professionalId: 'pro_1',
      })

      expect(db.$transaction).toHaveBeenCalledTimes(1)

      expect(tx.proFollow.findUnique).toHaveBeenCalledWith({
        where: {
          clientId_professionalId: {
            clientId: 'client_1',
            professionalId: 'pro_1',
          },
        },
        select: { id: true },
      })

      expect(tx.proFollow.create).toHaveBeenCalledWith({
        data: {
          clientId: 'client_1',
          professionalId: 'pro_1',
        },
        select: { id: true },
      })

      expect(tx.proFollow.delete).not.toHaveBeenCalled()
      expect(tx.proFollow.count).toHaveBeenCalledWith({
        where: { professionalId: 'pro_1' },
      })

      expect(result).toEqual({
        following: true,
        followerCount: 5,
      })
    })

    it('deletes an existing follow and returns updated follower count', async () => {
      const tx = makeTxDb()
      const db = asRootDb(makeRootDb(tx))

      tx.proFollow.findUnique.mockResolvedValue({ id: 'follow_1' })
      tx.proFollow.delete.mockResolvedValue({ id: 'follow_1' })
      tx.proFollow.count.mockResolvedValue(4)

      const result = await toggleProFollow(db, {
        clientId: 'client_1',
        professionalId: 'pro_1',
      })

      expect(tx.proFollow.delete).toHaveBeenCalledWith({
        where: {
          clientId_professionalId: {
            clientId: 'client_1',
            professionalId: 'pro_1',
          },
        },
      })

      expect(tx.proFollow.create).not.toHaveBeenCalled()

      expect(result).toEqual({
        following: false,
        followerCount: 4,
      })
    })
  })

  describe('countFollowers', () => {
    it('counts followers for a professional', async () => {
      const db = makeTxDb()
      db.proFollow.count.mockResolvedValue(12)

      const result = await countFollowers(asTxDb(db), 'pro_1')

      expect(db.proFollow.count).toHaveBeenCalledWith({
        where: {
          professionalId: 'pro_1',
        },
      })

      expect(result).toBe(12)
    })
  })

  describe('getViewerFollowState', () => {
    it('returns false when there is no viewer client id', async () => {
      const db = makeTxDb()

      const result = await getViewerFollowState(asTxDb(db), {
        viewerClientId: null,
        professionalId: 'pro_1',
      })

      expect(db.proFollow.findUnique).not.toHaveBeenCalled()
      expect(result).toBe(false)
    })

    it('returns false when the viewer does not follow the professional', async () => {
      const db = makeTxDb()
      db.proFollow.findUnique.mockResolvedValue(null)

      const result = await getViewerFollowState(asTxDb(db), {
        viewerClientId: 'client_1',
        professionalId: 'pro_1',
      })

      expect(db.proFollow.findUnique).toHaveBeenCalledWith({
        where: {
          clientId_professionalId: {
            clientId: 'client_1',
            professionalId: 'pro_1',
          },
        },
        select: { id: true },
      })

      expect(result).toBe(false)
    })

    it('returns true when the viewer already follows the professional', async () => {
      const db = makeTxDb()
      db.proFollow.findUnique.mockResolvedValue({ id: 'follow_1' })

      const result = await getViewerFollowState(asTxDb(db), {
        viewerClientId: 'client_1',
        professionalId: 'pro_1',
      })

      expect(result).toBe(true)
    })
  })

  describe('listFollowing', () => {
    it('returns followed professionals ordered by newest follow first', async () => {
      const db = makeTxDb()

      db.proFollow.findMany.mockResolvedValue([
        {
          createdAt: new Date('2026-04-18T12:00:00.000Z'),
          professional: {
            id: 'pro_1',
            businessName: 'TOVIS Studio',
            handle: 'tovisstudio',
            avatarUrl: null,
            professionType: null,
            location: 'San Diego, CA',
            verificationStatus: VerificationStatus.APPROVED,
            isPremium: true,
          },
        },
      ])

      const result = await listFollowing(asTxDb(db), {
        clientId: 'client_1',
        viewerClientId: 'client_1',
      })

      expect(db.proFollow.findMany).toHaveBeenCalledWith({
        where: {
          clientId: 'client_1',
        },
        orderBy: {
          createdAt: 'desc',
        },
        take: 24,
        skip: 0,
        select: {
          createdAt: true,
          professional: {
            select: {
              id: true,
              businessName: true,
              handle: true,
              avatarUrl: true,
              professionType: true,
              location: true,
              verificationStatus: true,
              isPremium: true,
            },
          },
        },
      })

      expect(result).toEqual([
        {
          followedAt: '2026-04-18T12:00:00.000Z',
          professional: {
            id: 'pro_1',
            businessName: 'TOVIS Studio',
            handle: 'tovisstudio',
            avatarUrl: null,
            professionType: null,
            location: 'San Diego, CA',
            verificationStatus: VerificationStatus.APPROVED,
            isPremium: true,
          },
        },
      ])
    })

    it('throws when a different viewer tries to read the following list', async () => {
      const db = makeTxDb()

      await expect(
        listFollowing(asTxDb(db), {
          clientId: 'client_1',
          viewerClientId: 'client_2',
        }),
      ).rejects.toThrow('Not allowed to view this following list.')

      expect(db.proFollow.findMany).not.toHaveBeenCalled()
    })
  })
})