import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  assertProCanViewClient: vi.fn(),
  bookingFindFirst: vi.fn(),
  consultSessionFindMany: vi.fn(),
  consultSessionFindFirst: vi.fn(),
  queryRaw: vi.fn(),
  feedbackFindUnique: vi.fn(),
  feedbackCreate: vi.fn(),
  revisionFindFirst: vi.fn(),
  auditCreate: vi.fn(),
  transaction: vi.fn(),
}))

vi.mock('./access', () => ({
  isAiConsultC6ExposureEnabledForPro: () => true,
}))

vi.mock('@/lib/clientVisibility', () => ({
  assertProCanViewClient: mocks.assertProCanViewClient,
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    booking: { findFirst: mocks.bookingFindFirst },
    $transaction: mocks.transaction,
  },
}))

import {
  loadAuthorizedProConsultBriefs,
  ProConsultBriefError,
  recordConsultBriefFeedback,
  selectLatestConsultRevision,
  sortConsultBriefHistory,
} from './proBrief'

describe('authorized pro consult brief loader', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.consultSessionFindMany.mockResolvedValue([])
    mocks.transaction.mockImplementation(
      async (work: (tx: {
        $queryRaw: typeof mocks.queryRaw
        consultSession: {
          findMany: typeof mocks.consultSessionFindMany
          findFirst: typeof mocks.consultSessionFindFirst
        }
        consultBriefFeedback: {
          findUnique: typeof mocks.feedbackFindUnique
          create: typeof mocks.feedbackCreate
        }
        consultRevision: { findFirst: typeof mocks.revisionFindFirst }
        consultAuditEvent: { create: typeof mocks.auditCreate }
      }) => Promise<unknown>) =>
        work({
          $queryRaw: mocks.queryRaw,
          consultSession: {
            findMany: mocks.consultSessionFindMany,
            findFirst: mocks.consultSessionFindFirst,
          },
          consultBriefFeedback: {
            findUnique: mocks.feedbackFindUnique,
            create: mocks.feedbackCreate,
          },
          consultRevision: { findFirst: mocks.revisionFindFirst },
          consultAuditEvent: { create: mocks.auditCreate },
        }),
    )
  })

  it('uses the normal chart authorization gate and does not read history when denied', async () => {
    mocks.assertProCanViewClient.mockResolvedValue({ ok: false })

    await expect(
      loadAuthorizedProConsultBriefs({
        professionalId: 'pro_1',
        clientId: 'client_1',
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' } satisfies Partial<ProConsultBriefError>)
    expect(mocks.assertProCanViewClient).toHaveBeenCalledWith('pro_1', 'client_1')
    expect(mocks.transaction).not.toHaveBeenCalled()
  })

  it('scopes booking detail authorization to the signed-in professional', async () => {
    mocks.bookingFindFirst.mockResolvedValue({ id: 'booking_1', clientId: 'client_1' })

    await loadAuthorizedProConsultBriefs({
      professionalId: 'pro_1',
      bookingId: 'booking_1',
    })

    expect(mocks.bookingFindFirst).toHaveBeenCalledWith({
      where: { id: 'booking_1', professionalId: 'pro_1' },
      select: { id: true, clientId: true },
    })
  })
})

describe('immutable consult brief feedback', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.queryRaw.mockResolvedValue([{ id: 'consult_1' }])
    mocks.consultSessionFindFirst.mockResolvedValue({ id: 'consult_1' })
    mocks.transaction.mockImplementation(async (work: (tx: {
      $queryRaw: typeof mocks.queryRaw
      consultSession: { findFirst: typeof mocks.consultSessionFindFirst }
      consultBriefFeedback: {
        findUnique: typeof mocks.feedbackFindUnique
        create: typeof mocks.feedbackCreate
      }
      consultRevision: { findFirst: typeof mocks.revisionFindFirst }
      consultAuditEvent: { create: typeof mocks.auditCreate }
    }) => Promise<unknown>) =>
      work({
        $queryRaw: mocks.queryRaw,
        consultSession: { findFirst: mocks.consultSessionFindFirst },
        consultBriefFeedback: {
          findUnique: mocks.feedbackFindUnique,
          create: mocks.feedbackCreate,
        },
        consultRevision: { findFirst: mocks.revisionFindFirst },
        consultAuditEvent: { create: mocks.auditCreate },
      }),
    )
  })

  it('replays the identical tap without inserting another row', async () => {
    mocks.feedbackFindUnique.mockResolvedValue({
      rating: 'ACCURATE_USEFUL',
      createdAt: new Date('2026-08-01T00:00:00.000Z'),
    })

    await expect(
      recordConsultBriefFeedback({
        consultSessionId: 'consult_1',
        professionalId: 'pro_1',
        rating: 'ACCURATE_USEFUL',
      }),
    ).resolves.toMatchObject({ replayed: true })
    expect(mocks.feedbackCreate).not.toHaveBeenCalled()
    expect(mocks.auditCreate).not.toHaveBeenCalled()
  })

  it('refuses a different second tap instead of mutating the audit signal', async () => {
    mocks.feedbackFindUnique.mockResolvedValue({
      rating: 'ACCURATE_USEFUL',
      createdAt: new Date('2026-08-01T00:00:00.000Z'),
    })

    await expect(
      recordConsultBriefFeedback({
        consultSessionId: 'consult_1',
        professionalId: 'pro_1',
        rating: 'OFF',
      }),
    ).rejects.toMatchObject({ code: 'RATING_CONFLICT' })
    expect(mocks.feedbackCreate).not.toHaveBeenCalled()
  })

  it('creates one feedback row and its content-free audit event atomically', async () => {
    mocks.feedbackFindUnique.mockResolvedValue(null)
    mocks.revisionFindFirst.mockResolvedValue({ id: 'brief_1' })
    mocks.feedbackCreate.mockResolvedValue({
      id: 'feedback_1',
      rating: 'OFF',
      createdAt: new Date('2026-08-01T00:00:00.000Z'),
    })

    await recordConsultBriefFeedback({
      consultSessionId: 'consult_1',
      professionalId: 'pro_1',
      rating: 'OFF',
    })

    expect(mocks.feedbackCreate).toHaveBeenCalledWith({
      data: {
        consultSessionId: 'consult_1',
        briefRevisionId: 'brief_1',
        professionalId: 'pro_1',
        rating: 'OFF',
      },
      select: { id: true, rating: true, createdAt: true },
    })
    expect(mocks.auditCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        consultSessionId: 'consult_1',
        briefFeedbackId: 'feedback_1',
      }),
    })
  })
})

describe('consult revision and chart history ordering', () => {
  it('selects the highest immutable revision regardless of query order', () => {
    expect(
      selectLatestConsultRevision([
        { id: 'analysis_2', revision: 2 },
        { id: 'analysis_7', revision: 7 },
        { id: 'analysis_4', revision: 4 },
      ]),
    ).toEqual({ id: 'analysis_7', revision: 7 })
  })

  it('orders dated chart history newest first with a stable id tie-break', () => {
    expect(
      sortConsultBriefHistory([
        { consultId: 'a', createdAt: '2026-01-01T00:00:00.000Z' },
        { consultId: 'b', createdAt: '2026-02-01T00:00:00.000Z' },
        { consultId: 'c', createdAt: '2026-02-01T00:00:00.000Z' },
      ]).map((brief) => brief.consultId),
    ).toEqual(['c', 'b', 'a'])
  })
})
