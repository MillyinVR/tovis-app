// lib/viralRequests/index.test.ts
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  ModerationStatus,
  NotificationEventKey,
  NotificationRecipientKind,
  Prisma,
  ProfessionType,
  VerificationStatus,
  ViralServiceRequestStatus,
} from '@prisma/client'

const mocks = vi.hoisted(() => ({
  enqueueDispatch: vi.fn(),
}))

vi.mock('@/lib/notifications/dispatch/enqueueDispatch', () => ({
  enqueueDispatch: mocks.enqueueDispatch,
}))

import {
  buildViralRequestUploadTargetPath,
  createClientViralRequest,
  deleteClientViralRequest,
  enqueueViralRequestApprovalNotifications,
  findMatchingProsByRequestedCategory,
  findMatchingProsForViralRequest,
  updateViralRequestStatus,
} from './index'

function makeDb() {
  return {
    viralServiceRequest: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      deleteMany: vi.fn(),
      update: vi.fn(),
    },
    professionalProfile: {
      findMany: vi.fn(),
    },
  }
}

/**
 * Narrow local test-only cast:
 * production helpers accept Prisma.TransactionClient | PrismaClient,
 * but these unit tests only mock the members exercised by viralRequests/index.ts.
 */
function asTransactionClient(
  value: ReturnType<typeof makeDb>,
): Prisma.TransactionClient {
  return value as unknown as Prisma.TransactionClient
}

function makeViralRequestRow(
  overrides?: Partial<{
    id: string
    clientId: string
    name: string
    description: string | null
    sourceUrl: string | null
    linksJson: Prisma.JsonValue | null
    mediaUrlsJson: Prisma.JsonValue | null
    requestedCategoryId: string | null
    status: ViralServiceRequestStatus
    moderationStatus: ModerationStatus
    reviewedAt: Date | null
    reviewedByUserId: string | null
    approvedAt: Date | null
    rejectedAt: Date | null
    adminNotes: string | null
    createdAt: Date
    updatedAt: Date
    requestedCategory:
      | {
          id: string
          name: string
          slug: string
        }
      | null
  }>,
) {
  return {
    id: overrides?.id ?? 'request_1',
    clientId: overrides?.clientId ?? 'client_1',
    name: overrides?.name ?? 'Wolf Cut',
    description: overrides?.description ?? null,
    sourceUrl: overrides?.sourceUrl ?? 'https://example.com/inspo',
    linksJson: overrides?.linksJson ?? null,
    mediaUrlsJson: overrides?.mediaUrlsJson ?? null,
    requestedCategoryId:
        overrides && 'requestedCategoryId' in overrides
            ? overrides.requestedCategoryId ?? null
            : 'cat_1',
    status: overrides?.status ?? ViralServiceRequestStatus.REQUESTED,
    moderationStatus:
      overrides?.moderationStatus ?? ModerationStatus.APPROVED,
    reviewedAt: overrides?.reviewedAt ?? null,
    reviewedByUserId: overrides?.reviewedByUserId ?? null,
    approvedAt: overrides?.approvedAt ?? null,
    rejectedAt: overrides?.rejectedAt ?? null,
    adminNotes: overrides?.adminNotes ?? null,
    createdAt:
      overrides?.createdAt ?? new Date('2026-04-19T00:00:00.000Z'),
    updatedAt:
      overrides?.updatedAt ?? new Date('2026-04-19T00:00:00.000Z'),
    requestedCategory:
      overrides && 'requestedCategory' in overrides
        ? overrides.requestedCategory ?? null
        : {
            id: 'cat_1',
            name: 'Hair',
            slug: 'hair',
          },
  }
}

describe('lib/viralRequests/index.ts', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('createClientViralRequest', () => {
    it('normalizes request input, persists the request, and returns the hydrated row', async () => {
      const db = makeDb()
      const tx = asTransactionClient(db)

      db.viralServiceRequest.create.mockResolvedValue({
        id: 'request_1',
      })

      db.viralServiceRequest.findUnique.mockResolvedValue(
        makeViralRequestRow({
          id: 'request_1',
          clientId: 'client_1',
          name: 'Wolf Cut',
          sourceUrl: 'https://example.com/inspo',
          linksJson: ['https://example.com/a'],
          mediaUrlsJson: ['https://example.com/media-1'],
        }),
      )

      const result = await createClientViralRequest(tx, {
        clientId: ' client_1 ',
        name: ' Wolf Cut ',
        description: ' Trend reference ',
        sourceUrl: ' https://example.com/inspo ',
        requestedCategoryId: ' cat_1 ',
        links: [' https://example.com/a ', 'https://example.com/a'],
        mediaUrls: [
          ' https://example.com/media-1 ',
          'https://example.com/media-1',
        ],
      })

      expect(db.viralServiceRequest.create).toHaveBeenCalledWith({
        data: {
          clientId: 'client_1',
          name: 'Wolf Cut',
          description: 'Trend reference',
          sourceUrl: 'https://example.com/inspo',
          requestedCategoryId: 'cat_1',
          status: ViralServiceRequestStatus.REQUESTED,
          linksJson: ['https://example.com/a'],
          mediaUrlsJson: ['https://example.com/media-1'],
        },
        select: { id: true },
      })

      expect(result).toEqual(
        makeViralRequestRow({
          id: 'request_1',
          clientId: 'client_1',
          name: 'Wolf Cut',
          sourceUrl: 'https://example.com/inspo',
          linksJson: ['https://example.com/a'],
          mediaUrlsJson: ['https://example.com/media-1'],
        }),
      )
    })
  })

  describe('deleteClientViralRequest', () => {
    it('deletes only the requesting client’s viral request', async () => {
      const db = makeDb()
      const tx = asTransactionClient(db)

      db.viralServiceRequest.deleteMany.mockResolvedValue({
        count: 1,
      })

      const result = await deleteClientViralRequest(tx, {
        clientId: 'client_1',
        requestId: 'request_1',
      })

      expect(db.viralServiceRequest.deleteMany).toHaveBeenCalledWith({
        where: {
          id: 'request_1',
          clientId: 'client_1',
        },
      })

      expect(result).toEqual({
        deleted: true,
      })
    })
  })

  describe('updateViralRequestStatus', () => {
    it('updates approval timestamps and review metadata when approving a request', async () => {
      const db = makeDb()
      const tx = asTransactionClient(db)

      db.viralServiceRequest.findUnique
        .mockResolvedValueOnce({
          id: 'request_1',
          status: ViralServiceRequestStatus.IN_REVIEW,
          approvedAt: null,
          rejectedAt: null,
          reviewedAt: null,
          reviewedByUserId: null,
          adminNotes: null,
          moderationStatus: ModerationStatus.APPROVED,
        })
        .mockResolvedValueOnce(
          makeViralRequestRow({
            id: 'request_1',
            status: ViralServiceRequestStatus.APPROVED,
            reviewedByUserId: 'admin_1',
            adminNotes: 'Looks viable.',
            approvedAt: new Date('2026-04-19T01:00:00.000Z'),
            reviewedAt: new Date('2026-04-19T01:00:00.000Z'),
          }),
        )

      db.viralServiceRequest.update.mockResolvedValue({
        id: 'request_1',
      })

      const result = await updateViralRequestStatus(tx, {
        requestId: 'request_1',
        nextStatus: ViralServiceRequestStatus.APPROVED,
        reviewerUserId: 'admin_1',
        adminNotes: ' Looks viable. ',
        moderationStatus: ModerationStatus.APPROVED,
      })

      expect(db.viralServiceRequest.update).toHaveBeenCalledWith({
        where: { id: 'request_1' },
        data: expect.objectContaining({
          status: ViralServiceRequestStatus.APPROVED,
          reviewedByUserId: 'admin_1',
          adminNotes: 'Looks viable.',
          moderationStatus: ModerationStatus.APPROVED,
          approvedAt: expect.any(Date),
          reviewedAt: expect.any(Date),
          rejectedAt: null,
        }),
        select: { id: true },
      })

      expect(result.status).toBe(ViralServiceRequestStatus.APPROVED)
      expect(result.reviewedByUserId).toBe('admin_1')
      expect(result.adminNotes).toBe('Looks viable.')
    })

    it('throws on an invalid status transition', async () => {
      const db = makeDb()
      const tx = asTransactionClient(db)

      db.viralServiceRequest.findUnique.mockResolvedValue({
        id: 'request_1',
        status: ViralServiceRequestStatus.APPROVED,
        approvedAt: new Date('2026-04-19T01:00:00.000Z'),
        rejectedAt: null,
        reviewedAt: new Date('2026-04-19T01:00:00.000Z'),
        reviewedByUserId: 'admin_1',
        adminNotes: null,
        moderationStatus: ModerationStatus.APPROVED,
      })

      await expect(
        updateViralRequestStatus(tx, {
          requestId: 'request_1',
          nextStatus: ViralServiceRequestStatus.REQUESTED,
        }),
      ).rejects.toThrow(
        'Invalid viral request status transition: APPROVED -> REQUESTED.',
      )

      expect(db.viralServiceRequest.update).not.toHaveBeenCalled()
    })
  })

  describe('findMatchingProsByRequestedCategory', () => {
    it('returns approved matching professionals and dedupes matching services', async () => {
      const db = makeDb()
      const tx = asTransactionClient(db)

      db.professionalProfile.findMany.mockResolvedValue([
        {
          id: 'pro_1',
          businessName: 'Studio One',
          handle: 'studio-one',
          avatarUrl: 'https://example.com/pro-1.jpg',
          professionType: ProfessionType.HAIRSTYLIST,
          location: 'San Diego, CA',
          verificationStatus: VerificationStatus.APPROVED,
          isPremium: true,
          offerings: [
            {
              service: {
                id: 'service_1',
                name: 'Wolf Cut',
              },
            },
            {
              service: {
                id: 'service_1',
                name: 'Wolf Cut',
              },
            },
            {
              service: {
                id: 'service_2',
                name: 'Shag Cut',
              },
            },
          ],
        },
      ])

      const result = await findMatchingProsByRequestedCategory(tx, {
        requestedCategoryId: 'cat_1',
        take: 10,
        skip: 0,
      })

      expect(db.professionalProfile.findMany).toHaveBeenCalledWith({
        where: {
          verificationStatus: {
            in: [VerificationStatus.APPROVED],
          },
          offerings: {
            some: {
              isActive: true,
              service: {
                isActive: true,
                categoryId: 'cat_1',
              },
            },
          },
        },
        orderBy: [{ isPremium: 'desc' }, { id: 'asc' }],
        take: 10,
        skip: 0,
        select: {
          id: true,
          businessName: true,
          handle: true,
          avatarUrl: true,
          professionType: true,
          location: true,
          verificationStatus: true,
          isPremium: true,
          offerings: {
            where: {
              isActive: true,
              service: {
                isActive: true,
                categoryId: 'cat_1',
              },
            },
            orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }],
            take: 5,
            select: {
              service: {
                select: {
                  id: true,
                  name: true,
                },
              },
            },
          },
        },
      })

      expect(result).toEqual([
        {
          id: 'pro_1',
          businessName: 'Studio One',
          handle: 'studio-one',
          avatarUrl: 'https://example.com/pro-1.jpg',
          professionType: ProfessionType.HAIRSTYLIST,
          location: 'San Diego, CA',
          verificationStatus: VerificationStatus.APPROVED,
          isPremium: true,
          matchingServices: [
            {
              id: 'service_1',
              name: 'Wolf Cut',
            },
            {
              id: 'service_2',
              name: 'Shag Cut',
            },
          ],
        },
      ])
    })
  })

  describe('findMatchingProsForViralRequest', () => {
    it('returns an empty list when the viral request has no requested category', async () => {
        const db = makeDb()
        const tx = asTransactionClient(db)

        db.viralServiceRequest.findUnique.mockResolvedValue(
            makeViralRequestRow({
            requestedCategoryId: null,
            requestedCategory: null,
            }),
        )

        const result = await findMatchingProsForViralRequest(tx, {
            requestId: 'request_1',
        })

        expect(result).toEqual([])
        expect(db.professionalProfile.findMany).not.toHaveBeenCalled()
        })
  })

  describe('buildViralRequestUploadTargetPath', () => {
    it('builds a deterministic sanitized upload path', () => {
      expect(
        buildViralRequestUploadTargetPath({
          requestId: 'request_1',
          fileName: ' ..\\Wolf Cut Inspo.PNG ',
        }),
      ).toBe(
        'viral-requests/request_1/uploads/wolf-cut-inspo.png',
      )
    })
  })

  describe('enqueueViralRequestApprovalNotifications', () => {
    it('throws if the request is not approved', async () => {
      const db = makeDb()
      const tx = asTransactionClient(db)

      db.viralServiceRequest.findUnique.mockResolvedValue(
        makeViralRequestRow({
          status: ViralServiceRequestStatus.REQUESTED,
        }),
      )

      await expect(
        enqueueViralRequestApprovalNotifications(tx, {
          requestId: 'request_1',
        }),
      ).rejects.toThrow(
        'Viral request must be APPROVED before approval notifications can be enqueued.',
      )

      expect(mocks.enqueueDispatch).not.toHaveBeenCalled()
    })

    it('enqueues one pro dispatch per matching professional with stable source keys', async () => {
      const db = makeDb()
      const tx = asTransactionClient(db)

      const approvedRequest = makeViralRequestRow({
        id: 'request_1',
        name: 'Wolf Cut',
        status: ViralServiceRequestStatus.APPROVED,
        requestedCategoryId: 'cat_1',
      })

      db.viralServiceRequest.findUnique
        .mockResolvedValueOnce(approvedRequest)
        .mockResolvedValueOnce(approvedRequest)

      db.professionalProfile.findMany.mockResolvedValue([
        {
          id: 'pro_1',
          businessName: 'Studio One',
          handle: 'studio-one',
          avatarUrl: null,
          professionType: ProfessionType.HAIRSTYLIST,
          location: 'San Diego, CA',
          verificationStatus: VerificationStatus.APPROVED,
          isPremium: true,
          offerings: [
            {
              service: {
                id: 'service_1',
                name: 'Wolf Cut',
              },
            },
          ],
        },
        {
          id: 'pro_2',
          businessName: 'Studio Two',
          handle: 'studio-two',
          avatarUrl: null,
          professionType: ProfessionType.HAIRSTYLIST,
          location: 'Los Angeles, CA',
          verificationStatus: VerificationStatus.APPROVED,
          isPremium: false,
          offerings: [
            {
              service: {
                id: 'service_2',
                name: 'Shag Cut',
              },
            },
          ],
        },
      ])

      mocks.enqueueDispatch
        .mockResolvedValueOnce({
          dispatch: {
            sourceKey:
              'viral-request:request_1:professional:pro_1:approved',
          },
        })
        .mockResolvedValueOnce({
          dispatch: {
            sourceKey:
              'viral-request:request_1:professional:pro_2:approved',
          },
        })

      const result =
        await enqueueViralRequestApprovalNotifications(tx, {
          requestId: 'request_1',
        })

      expect(mocks.enqueueDispatch).toHaveBeenCalledTimes(2)

      expect(mocks.enqueueDispatch).toHaveBeenNthCalledWith(1, {
        key: NotificationEventKey.VIRAL_REQUEST_APPROVED,
        sourceKey:
          'viral-request:request_1:professional:pro_1:approved',
        recipient: {
          kind: NotificationRecipientKind.PRO,
          professionalId: 'pro_1',
          inAppTargetId: 'pro_1',
        },
        title: 'New viral request in your category',
        body: '"Wolf Cut" was approved and matches your services.',
        href: '/admin/viral-requests/request_1',
        tx,
      })

      expect(mocks.enqueueDispatch).toHaveBeenNthCalledWith(2, {
        key: NotificationEventKey.VIRAL_REQUEST_APPROVED,
        sourceKey:
          'viral-request:request_1:professional:pro_2:approved',
        recipient: {
          kind: NotificationRecipientKind.PRO,
          professionalId: 'pro_2',
          inAppTargetId: 'pro_2',
        },
        title: 'New viral request in your category',
        body: '"Wolf Cut" was approved and matches your services.',
        href: '/admin/viral-requests/request_1',
        tx,
      })

      expect(result).toEqual({
        enqueued: true,
        matchedProfessionalIds: ['pro_1', 'pro_2'],
        dispatchSourceKeys: [
          'viral-request:request_1:professional:pro_1:approved',
          'viral-request:request_1:professional:pro_2:approved',
        ],
      })
    })
  })
})