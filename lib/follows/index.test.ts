// lib/follows/index.test.ts
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  Prisma,
  PrismaClient,
  ProfessionType,
  VerificationStatus,
} from '@prisma/client'

import {
  assertCanViewFollowersList,
  assertCanViewFollowingList,
  buildMyFollowingListResponse,
  buildProFollowersListResponse,
  buildProFollowStateResponse,
  canViewFollowersList,
  canViewFollowingList,
  countFollowers,
  getFollowErrorMeta,
  getProfessionalFollowState,
  getViewerFollowState,
  listFollowersPage,
  listFollowing,
  listFollowingPage,
  requireFollowProfessionalTarget,
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
    professionalProfile: {
      findUnique: vi.fn(),
    },
  }
}

function makeRootDb(tx: ReturnType<typeof makeTxDb>) {
  return {
    ...tx,
    $transaction: vi.fn(
      async (
        fn: (innerTx: ReturnType<typeof makeTxDb>) => Promise<unknown>,
      ) => fn(tx),
    ),
  }
}

function asTxDb(db: ReturnType<typeof makeTxDb>): Prisma.TransactionClient {
  return db as unknown as Prisma.TransactionClient
}

function asRootDb(db: ReturnType<typeof makeRootDb>): PrismaClient {
  return db as unknown as PrismaClient
}

function makeProfessionalPreview(
  overrides?: Partial<{
    id: string
    businessName: string | null
    handle: string | null
    avatarUrl: string | null
    professionType: ProfessionType | null
    location: string
    verificationStatus: VerificationStatus
    isPremium: boolean
  }>,
) {
  return {
    id: 'pro_1',
    businessName: 'TOVIS Studio',
    handle: 'tovisstudio',
    avatarUrl: null,
    professionType: null,
    location: 'San Diego, CA',
    verificationStatus: VerificationStatus.APPROVED,
    isPremium: true,
    ...overrides,
  }
}

function makeClientPreview(
  overrides?: Partial<{
    id: string
    firstName: string
    lastName: string
    avatarUrl: string | null
  }>,
) {
  return {
    id: 'client_1',
    firstName: 'Tori',
    lastName: 'Morales',
    avatarUrl: null,
    ...overrides,
  }
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

  describe('followers list ownership helpers', () => {
    it('allows a professional to view their own followers list', () => {
      expect(
        canViewFollowersList({
          viewerProfessionalId: 'pro_1',
          ownerProfessionalId: 'pro_1',
        }),
      ).toBe(true)
    })

    it('blocks a different professional from viewing the followers list', () => {
      expect(
        canViewFollowersList({
          viewerProfessionalId: 'pro_2',
          ownerProfessionalId: 'pro_1',
        }),
      ).toBe(false)
    })

    it('throws when the viewer cannot view the followers list', () => {
      expect(() =>
        assertCanViewFollowersList({
          viewerProfessionalId: 'pro_2',
          ownerProfessionalId: 'pro_1',
        }),
      ).toThrow('Not allowed to view this followers list.')
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

  describe('requireFollowProfessionalTarget', () => {
    it('returns the canonical professional target when it exists', async () => {
      const db = makeTxDb()

      db.professionalProfile.findUnique.mockResolvedValue({
        id: 'pro_1',
        userId: 'user_1',
      })

      const result = await requireFollowProfessionalTarget(asTxDb(db), 'pro_1')

      expect(db.professionalProfile.findUnique).toHaveBeenCalledWith({
        where: { id: 'pro_1' },
        select: {
          id: true,
          userId: true,
        },
      })

      expect(result).toEqual({
        id: 'pro_1',
        userId: 'user_1',
      })
    })

    it('throws when the professional target cannot be found', async () => {
      const db = makeTxDb()
      db.professionalProfile.findUnique.mockResolvedValue(null)

      await expect(
        requireFollowProfessionalTarget(asTxDb(db), 'pro_missing'),
      ).rejects.toThrow('Professional not found.')
    })
  })

  describe('getProfessionalFollowState', () => {
    it('returns the viewer follow state and follower count together', async () => {
      const db = makeTxDb()
      db.proFollow.findUnique.mockResolvedValue({ id: 'follow_1' })
      db.proFollow.count.mockResolvedValue(7)

      const result = await getProfessionalFollowState(asTxDb(db), {
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

      expect(db.proFollow.count).toHaveBeenCalledWith({
        where: {
          professionalId: 'pro_1',
        },
      })

      expect(result).toEqual({
        following: true,
        followerCount: 7,
      })
    })
  })

  describe('listFollowing', () => {
    it('returns followed professionals ordered by newest follow first', async () => {
      const db = makeTxDb()

      db.proFollow.findMany.mockResolvedValue([
        {
          createdAt: new Date('2026-04-18T12:00:00.000Z'),
          professional: makeProfessionalPreview(),
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
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: 25,
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
          professional: makeProfessionalPreview(),
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

  describe('listFollowingPage', () => {
    it('returns paginated following items with hasMore=true when an extra row exists', async () => {
      const db = makeTxDb()

      db.proFollow.findMany.mockResolvedValue([
        {
          createdAt: new Date('2026-04-18T12:00:00.000Z'),
          professional: makeProfessionalPreview({ id: 'pro_1' }),
        },
        {
          createdAt: new Date('2026-04-17T12:00:00.000Z'),
          professional: makeProfessionalPreview({ id: 'pro_2', handle: 'tovis2' }),
        },
        {
          createdAt: new Date('2026-04-16T12:00:00.000Z'),
          professional: makeProfessionalPreview({ id: 'pro_3', handle: 'tovis3' }),
        },
      ])

      const result = await listFollowingPage(asTxDb(db), {
        clientId: 'client_1',
        viewerClientId: 'client_1',
        take: 2,
        skip: 4,
      })

      expect(db.proFollow.findMany).toHaveBeenCalledWith({
        where: {
          clientId: 'client_1',
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: 3,
        skip: 4,
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

      expect(result).toEqual({
        items: [
          {
            followedAt: '2026-04-18T12:00:00.000Z',
            professional: makeProfessionalPreview({ id: 'pro_1' }),
          },
          {
            followedAt: '2026-04-17T12:00:00.000Z',
            professional: makeProfessionalPreview({ id: 'pro_2', handle: 'tovis2' }),
          },
        ],
        pagination: {
          take: 2,
          skip: 4,
          hasMore: true,
        },
      })
    })

    it('throws when a different viewer tries to read the paginated following list', async () => {
      const db = makeTxDb()

      await expect(
        listFollowingPage(asTxDb(db), {
          clientId: 'client_1',
          viewerClientId: 'client_2',
        }),
      ).rejects.toThrow('Not allowed to view this following list.')

      expect(db.proFollow.findMany).not.toHaveBeenCalled()
    })
  })

  describe('listFollowersPage', () => {
    it('returns paginated followers with follower count and stable row shape', async () => {
      const db = makeTxDb()

      db.proFollow.findMany.mockResolvedValue([
        {
          createdAt: new Date('2026-04-18T12:00:00.000Z'),
          client: makeClientPreview({ id: 'client_1' }),
        },
        {
          createdAt: new Date('2026-04-17T12:00:00.000Z'),
          client: makeClientPreview({
            id: 'client_2',
            firstName: 'Atlas',
            lastName: 'Morales',
          }),
        },
        {
          createdAt: new Date('2026-04-16T12:00:00.000Z'),
          client: makeClientPreview({
            id: 'client_3',
            firstName: 'Opal',
            lastName: 'Morales',
          }),
        },
      ])
      db.proFollow.count.mockResolvedValue(12)

      const result = await listFollowersPage(asTxDb(db), {
        professionalId: 'pro_1',
        viewerProfessionalId: 'pro_1',
        take: 2,
        skip: 6,
      })

      expect(db.proFollow.findMany).toHaveBeenCalledWith({
        where: {
          professionalId: 'pro_1',
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: 3,
        skip: 6,
        select: {
          createdAt: true,
          client: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              avatarUrl: true,
            },
          },
        },
      })

      expect(db.proFollow.count).toHaveBeenCalledWith({
        where: {
          professionalId: 'pro_1',
        },
      })

      expect(result).toEqual({
        followerCount: 12,
        items: [
          {
            followedAt: '2026-04-18T12:00:00.000Z',
            client: makeClientPreview({ id: 'client_1' }),
          },
          {
            followedAt: '2026-04-17T12:00:00.000Z',
            client: makeClientPreview({
              id: 'client_2',
              firstName: 'Atlas',
              lastName: 'Morales',
            }),
          },
        ],
        pagination: {
          take: 2,
          skip: 6,
          hasMore: true,
        },
      })
    })

    it('throws when a different professional tries to read the followers list', async () => {
      const db = makeTxDb()

      await expect(
        listFollowersPage(asTxDb(db), {
          professionalId: 'pro_1',
          viewerProfessionalId: 'pro_2',
        }),
      ).rejects.toThrow('Not allowed to view this followers list.')

      expect(db.proFollow.findMany).not.toHaveBeenCalled()
      expect(db.proFollow.count).not.toHaveBeenCalled()
    })
  })

  describe('response builders', () => {
    it('buildProFollowStateResponse returns the stable follow state contract', () => {
      expect(
        buildProFollowStateResponse({
          professionalId: 'pro_1',
          following: true,
          followerCount: 8,
        }),
      ).toEqual({
        professionalId: 'pro_1',
        following: true,
        followerCount: 8,
      })
    })

    it('buildProFollowersListResponse maps follower rows into DTOs', () => {
      expect(
        buildProFollowersListResponse({
          professionalId: 'pro_1',
          followerCount: 2,
          items: [
            {
              followedAt: '2026-04-18T12:00:00.000Z',
              client: makeClientPreview({
                id: 'client_1',
                firstName: 'Tori',
                lastName: 'Morales',
              }),
            },
          ],
          pagination: {
            take: 24,
            skip: 0,
            hasMore: false,
          },
        }),
      ).toEqual({
        professionalId: 'pro_1',
        followerCount: 2,
        items: [
          {
            followedAt: '2026-04-18T12:00:00.000Z',
            client: {
              id: 'client_1',
              firstName: 'Tori',
              lastName: 'Morales',
              avatarUrl: null,
            },
          },
        ],
        pagination: {
          take: 24,
          skip: 0,
          hasMore: false,
        },
      })
    })

    it('buildMyFollowingListResponse maps professional previews into DTOs', () => {
      expect(
        buildMyFollowingListResponse({
          clientId: 'client_1',
          items: [
            {
              followedAt: '2026-04-18T12:00:00.000Z',
              professional: makeProfessionalPreview(),
            },
          ],
          pagination: {
            take: 24,
            skip: 0,
            hasMore: false,
          },
        }),
      ).toEqual({
        clientId: 'client_1',
        items: [
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
        ],
        pagination: {
          take: 24,
          skip: 0,
          hasMore: false,
        },
      })
    })
  })

  describe('getFollowErrorMeta', () => {
    it('maps professional not found errors', () => {
      expect(getFollowErrorMeta(new Error('Professional not found.'))).toEqual({
        status: 404,
        message: 'Professional not found.',
        code: 'PRO_NOT_FOUND',
      })
    })

    it('maps followers visibility errors', () => {
      expect(
        getFollowErrorMeta(new Error('Not allowed to view this followers list.')),
      ).toEqual({
        status: 403,
        message: 'Not allowed to view this followers list.',
        code: 'FOLLOWERS_FORBIDDEN',
      })
    })

    it('maps following visibility errors', () => {
      expect(
        getFollowErrorMeta(new Error('Not allowed to view this following list.')),
      ).toEqual({
        status: 403,
        message: 'Not allowed to view this following list.',
        code: 'FOLLOWING_FORBIDDEN',
      })
    })

    it('returns null for unknown errors', () => {
      expect(getFollowErrorMeta(new Error('nope'))).toBeNull()
    })
  })
})