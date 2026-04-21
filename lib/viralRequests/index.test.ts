// lib/viralRequests/index.test.ts
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  ModerationStatus,
  Prisma,
  ProfessionType,
  VerificationStatus,
  ViralRequestApprovalFanOutStatus,
  ViralServiceRequestStatus,
} from '@prisma/client'

const mocks = vi.hoisted(() => ({
  notifyMatchedProsAboutApprovedViralRequest: vi.fn(),
}))

vi.mock('@/lib/notifications/social', () => ({
  notifyMatchedProsAboutApprovedViralRequest:
    mocks.notifyMatchedProsAboutApprovedViralRequest,
}))

import {
  buildViralRequestUploadTargetPath,
  createClientViralRequest,
  createViralRequestApprovalFanOutRows,
  deleteClientViralRequest,
  enqueueViralRequestApprovalNotifications,
  findMatchingProsByRequestedCategory,
  findMatchingProsForViralRequest,
  listViralRequestApprovalFanOutRows,
  markViralRequestApprovalFanOutRowsFailed,
  markViralRequestApprovalFanOutRowsQueued,
  markViralRequestApprovalFanOutRowsSkipped,
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
    viralRequestApprovalFanOut: {
      createMany: vi.fn(),
      findMany: vi.fn(),
      updateMany: vi.fn(),
    },
  }
}

/**
 * Narrow local test-only cast:
 * production helpers accept Prisma.TransactionClient | PrismaClient,
 * but these unit tests mock only the members exercised by lib/viralRequests/index.ts.
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
    reportCount: number
    removedAt: Date | null
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
    reportCount: overrides?.reportCount ?? 0,
    removedAt: overrides?.removedAt ?? null,
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

function makeFanOutRow(
  overrides?: Partial<{
    id: string
    viralServiceRequestId: string
    professionalId: string
    status: ViralRequestApprovalFanOutStatus
    matchedAt: Date
    queuedAt: Date | null
    sentAt: Date | null
    skippedAt: Date | null
    failedAt: Date | null
    skipReason: string | null
    lastError: string | null
    notificationId: string | null
    notificationDispatchId: string | null
    createdAt: Date
    updatedAt: Date
  }>,
) {
  return {
    id: overrides?.id ?? 'fanout_1',
    viralServiceRequestId: overrides?.viralServiceRequestId ?? 'request_1',
    professionalId: overrides?.professionalId ?? 'pro_1',
    status: overrides?.status ?? ViralRequestApprovalFanOutStatus.PLANNED,
    matchedAt: overrides?.matchedAt ?? new Date('2026-04-19T00:00:00.000Z'),
    queuedAt: overrides?.queuedAt ?? null,
    sentAt: overrides?.sentAt ?? null,
    skippedAt: overrides?.skippedAt ?? null,
    failedAt: overrides?.failedAt ?? null,
    skipReason: overrides?.skipReason ?? null,
    lastError: overrides?.lastError ?? null,
    notificationId: overrides?.notificationId ?? null,
    notificationDispatchId: overrides?.notificationDispatchId ?? null,
    createdAt: overrides?.createdAt ?? new Date('2026-04-19T00:00:00.000Z'),
    updatedAt: overrides?.updatedAt ?? new Date('2026-04-19T00:00:00.000Z'),
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
      expect(result.reportCount).toBe(0)
      expect(result.removedAt).toBeNull()
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
            in: expect.arrayContaining([VerificationStatus.APPROVED]),
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

  describe('createViralRequestApprovalFanOutRows', () => {
    it('creates durable per-pro fan-out rows and returns them in matched-pro order', async () => {
      const db = makeDb()
      const tx = asTransactionClient(db)

      db.viralServiceRequest.findUnique.mockResolvedValue(
        makeViralRequestRow({
          id: 'request_1',
          status: ViralServiceRequestStatus.APPROVED,
          requestedCategoryId: 'cat_1',
        }),
      )

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

      db.viralRequestApprovalFanOut.createMany.mockResolvedValue({
        count: 2,
      })

      db.viralRequestApprovalFanOut.findMany.mockResolvedValue([
        makeFanOutRow({
          id: 'fanout_2',
          professionalId: 'pro_2',
        }),
        makeFanOutRow({
          id: 'fanout_1',
          professionalId: 'pro_1',
        }),
      ])

      const result = await createViralRequestApprovalFanOutRows(tx, {
        requestId: 'request_1',
      })

      expect(db.viralRequestApprovalFanOut.createMany).toHaveBeenCalledWith({
        data: [
          {
            viralServiceRequestId: 'request_1',
            professionalId: 'pro_1',
            status: ViralRequestApprovalFanOutStatus.PLANNED,
          },
          {
            viralServiceRequestId: 'request_1',
            professionalId: 'pro_2',
            status: ViralRequestApprovalFanOutStatus.PLANNED,
          },
        ],
        skipDuplicates: true,
      })

      expect(db.viralRequestApprovalFanOut.findMany).toHaveBeenCalledWith({
        where: {
          viralServiceRequestId: 'request_1',
          professionalId: {
            in: ['pro_1', 'pro_2'],
          },
        },
        select: {
          id: true,
          viralServiceRequestId: true,
          professionalId: true,
          status: true,
          matchedAt: true,
          queuedAt: true,
          sentAt: true,
          skippedAt: true,
          failedAt: true,
          skipReason: true,
          lastError: true,
          notificationId: true,
          notificationDispatchId: true,
          createdAt: true,
          updatedAt: true,
        },
      })

      expect(result).toEqual({
        requestId: 'request_1',
        matchedProfessionalIds: ['pro_1', 'pro_2'],
        fanOutRows: [
          makeFanOutRow({
            id: 'fanout_1',
            professionalId: 'pro_1',
          }),
          makeFanOutRow({
            id: 'fanout_2',
            professionalId: 'pro_2',
          }),
        ],
      })
    })

    it('returns an empty result when no pros match the approved request', async () => {
      const db = makeDb()
      const tx = asTransactionClient(db)

      db.viralServiceRequest.findUnique.mockResolvedValue(
        makeViralRequestRow({
          id: 'request_1',
          status: ViralServiceRequestStatus.APPROVED,
          requestedCategoryId: 'cat_1',
        }),
      )

      db.professionalProfile.findMany.mockResolvedValue([])

      const result = await createViralRequestApprovalFanOutRows(tx, {
        requestId: 'request_1',
      })

      expect(db.viralRequestApprovalFanOut.createMany).not.toHaveBeenCalled()
      expect(db.viralRequestApprovalFanOut.findMany).not.toHaveBeenCalled()

      expect(result).toEqual({
        requestId: 'request_1',
        matchedProfessionalIds: [],
        fanOutRows: [],
      })
    })
  })

  describe('listViralRequestApprovalFanOutRows', () => {
    it('lists fan-out rows with optional status filtering', async () => {
      const db = makeDb()
      const tx = asTransactionClient(db)

      db.viralRequestApprovalFanOut.findMany.mockResolvedValue([
        makeFanOutRow({
          id: 'fanout_1',
          status: ViralRequestApprovalFanOutStatus.PLANNED,
        }),
      ])

      const result = await listViralRequestApprovalFanOutRows(tx, {
        requestId: 'request_1',
        statuses: [ViralRequestApprovalFanOutStatus.PLANNED],
        take: 10,
        skip: 0,
      })

      expect(db.viralRequestApprovalFanOut.findMany).toHaveBeenCalledWith({
        where: {
          viralServiceRequestId: 'request_1',
          status: {
            in: [ViralRequestApprovalFanOutStatus.PLANNED],
          },
        },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        take: 10,
        skip: 0,
        select: {
          id: true,
          viralServiceRequestId: true,
          professionalId: true,
          status: true,
          matchedAt: true,
          queuedAt: true,
          sentAt: true,
          skippedAt: true,
          failedAt: true,
          skipReason: true,
          lastError: true,
          notificationId: true,
          notificationDispatchId: true,
          createdAt: true,
          updatedAt: true,
        },
      })

      expect(result).toEqual([
        makeFanOutRow({
          id: 'fanout_1',
          status: ViralRequestApprovalFanOutStatus.PLANNED,
        }),
      ])
    })
  })

  describe('markViralRequestApprovalFanOutRowsQueued', () => {
    it('marks fan-out rows as notification enqueued', async () => {
      const db = makeDb()
      const tx = asTransactionClient(db)

      db.viralRequestApprovalFanOut.updateMany.mockResolvedValue({
        count: 2,
      })

      const result = await markViralRequestApprovalFanOutRowsQueued(tx, {
        fanOutRowIds: ['fanout_1', 'fanout_2'],
      })

      expect(db.viralRequestApprovalFanOut.updateMany).toHaveBeenCalledWith({
        where: {
          id: {
            in: ['fanout_1', 'fanout_2'],
          },
        },
        data: {
          status: ViralRequestApprovalFanOutStatus.NOTIFICATION_ENQUEUED,
          queuedAt: expect.any(Date),
          failedAt: null,
          skippedAt: null,
          lastError: null,
          skipReason: null,
        },
      })

      expect(result).toEqual({
        updatedCount: 2,
      })
    })
  })

  describe('markViralRequestApprovalFanOutRowsSkipped', () => {
    it('marks fan-out rows as skipped with a normalized reason', async () => {
      const db = makeDb()
      const tx = asTransactionClient(db)

      db.viralRequestApprovalFanOut.updateMany.mockResolvedValue({
        count: 1,
      })

      const result = await markViralRequestApprovalFanOutRowsSkipped(tx, {
        fanOutRowIds: ['fanout_1'],
        reason: '  no supported delivery channel  ',
      })

      expect(db.viralRequestApprovalFanOut.updateMany).toHaveBeenCalledWith({
        where: {
          id: {
            in: ['fanout_1'],
          },
        },
        data: {
          status: ViralRequestApprovalFanOutStatus.SKIPPED,
          skippedAt: expect.any(Date),
          failedAt: null,
          lastError: null,
          skipReason: 'no supported delivery channel',
        },
      })

      expect(result).toEqual({
        updatedCount: 1,
      })
    })

    it('throws when the skip reason is empty', async () => {
      const db = makeDb()
      const tx = asTransactionClient(db)

      await expect(
        markViralRequestApprovalFanOutRowsSkipped(tx, {
          fanOutRowIds: ['fanout_1'],
          reason: '   ',
        }),
      ).rejects.toThrow('reason is required.')

      expect(db.viralRequestApprovalFanOut.updateMany).not.toHaveBeenCalled()
    })
  })

  describe('markViralRequestApprovalFanOutRowsFailed', () => {
    it('marks fan-out rows as failed with the supplied message', async () => {
      const db = makeDb()
      const tx = asTransactionClient(db)

      db.viralRequestApprovalFanOut.updateMany.mockResolvedValue({
        count: 1,
      })

      const result = await markViralRequestApprovalFanOutRowsFailed(tx, {
        fanOutRowIds: ['fanout_1'],
        message: '  downstream notification enqueue failed  ',
      })

      expect(db.viralRequestApprovalFanOut.updateMany).toHaveBeenCalledWith({
        where: {
          id: {
            in: ['fanout_1'],
          },
        },
        data: {
          status: ViralRequestApprovalFanOutStatus.FAILED,
          failedAt: expect.any(Date),
          lastError: 'downstream notification enqueue failed',
        },
      })

      expect(result).toEqual({
        updatedCount: 1,
      })
    })

    it('throws when the failure message is empty', async () => {
      const db = makeDb()
      const tx = asTransactionClient(db)

      await expect(
        markViralRequestApprovalFanOutRowsFailed(tx, {
          fanOutRowIds: ['fanout_1'],
          message: '   ',
        }),
      ).rejects.toThrow('message is required.')

      expect(db.viralRequestApprovalFanOut.updateMany).not.toHaveBeenCalled()
    })
  })

  describe('buildViralRequestUploadTargetPath', () => {
    it('builds a deterministic sanitized upload path', () => {
      expect(
        buildViralRequestUploadTargetPath({
          requestId: 'request_1',
          fileName: ' ..\\Wolf Cut Inspo.PNG ',
        }),
      ).toBe('viral-requests/request_1/uploads/wolf-cut-inspo.png')
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
        'Viral request must be APPROVED before approval fan-out can run.',
      )

      expect(
        mocks.notifyMatchedProsAboutApprovedViralRequest,
      ).not.toHaveBeenCalled()
    })

    it('creates one canonical pro notification per matching professional', async () => {
      const db = makeDb()
      const tx = asTransactionClient(db)

      db.viralServiceRequest.findUnique.mockResolvedValue(
        makeViralRequestRow({
          id: 'request_1',
          name: 'Wolf Cut',
          status: ViralServiceRequestStatus.APPROVED,
          requestedCategoryId: 'cat_1',
        }),
      )

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

      mocks.notifyMatchedProsAboutApprovedViralRequest.mockResolvedValue({
        matchedProfessionalIds: ['pro_1', 'pro_2'],
        notificationIds: ['notif_1', 'notif_2'],
      })

      const result =
        await enqueueViralRequestApprovalNotifications(tx, {
          requestId: 'request_1',
        })

      expect(
        mocks.notifyMatchedProsAboutApprovedViralRequest,
      ).toHaveBeenCalledTimes(1)

      expect(
        mocks.notifyMatchedProsAboutApprovedViralRequest,
      ).toHaveBeenCalledWith({
        viralRequestId: 'request_1',
        requestName: 'Wolf Cut',
        requestedCategoryId: 'cat_1',
        recipients: [
          {
            professionalId: 'pro_1',
            matchedServiceIds: ['service_1'],
          },
          {
            professionalId: 'pro_2',
            matchedServiceIds: ['service_2'],
          },
        ],
        tx,
      })

      expect(result).toEqual({
        enqueued: true,
        matchedProfessionalIds: ['pro_1', 'pro_2'],
        notificationIds: ['notif_1', 'notif_2'],
      })
    })
  })
})