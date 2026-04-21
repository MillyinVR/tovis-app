import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ViralServiceRequestStatus } from '@prisma/client'

const mocks = vi.hoisted(() => ({
  getViralRequestByIdOrThrow: vi.fn(),
  findMatchingProsForViralRequest: vi.fn(),
  enqueueViralRequestApprovalNotifications: vi.fn(),
}))

vi.mock('@/lib/viralRequests', () => ({
  getViralRequestByIdOrThrow: mocks.getViralRequestByIdOrThrow,
  findMatchingProsForViralRequest: mocks.findMatchingProsForViralRequest,
  enqueueViralRequestApprovalNotifications:
    mocks.enqueueViralRequestApprovalNotifications,
}))

import { runViralRequestApprovalOrchestration } from './approvalOrchestrator'

describe('lib/viralRequests/approvalOrchestrator.ts', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('runs the shared viral approval orchestration through matching + notification enqueue', async () => {
    const db = {} as never

    mocks.getViralRequestByIdOrThrow.mockResolvedValue({
      id: 'request_1',
      status: ViralServiceRequestStatus.APPROVED,
    })

    mocks.findMatchingProsForViralRequest.mockResolvedValue([
      { id: 'pro_1' },
      { id: 'pro_2' },
    ])

    mocks.enqueueViralRequestApprovalNotifications.mockResolvedValue({
      enqueued: true,
      matchedProfessionalIds: ['pro_1', 'pro_2'],
      notificationIds: ['notif_1', 'notif_2'],
    })

    const result = await runViralRequestApprovalOrchestration(db, {
      requestId: 'request_1',
    })

    expect(mocks.getViralRequestByIdOrThrow).toHaveBeenCalledWith(db, 'request_1')
    expect(mocks.findMatchingProsForViralRequest).toHaveBeenCalledWith(db, {
      requestId: 'request_1',
    })
    expect(mocks.enqueueViralRequestApprovalNotifications).toHaveBeenCalledWith(
      db,
      {
        requestId: 'request_1',
      },
    )

    expect(result).toEqual({
      requestId: 'request_1',
      matchedProfessionalIds: ['pro_1', 'pro_2'],
      notificationIds: ['notif_1', 'notif_2'],
      smsDeferred: true,
      fanOutRowsCreated: false,
      blocked: {
        durableFanOutRows: true,
        smsForEvent: true,
      },
    })
  })

  it('rejects orchestration when the request is not approved', async () => {
    const db = {} as never

    mocks.getViralRequestByIdOrThrow.mockResolvedValue({
      id: 'request_1',
      status: ViralServiceRequestStatus.IN_REVIEW,
    })

    await expect(
      runViralRequestApprovalOrchestration(db, {
        requestId: 'request_1',
      }),
    ).rejects.toThrow(
      'Viral request must be APPROVED before approval orchestration can run.',
    )

    expect(mocks.findMatchingProsForViralRequest).not.toHaveBeenCalled()
    expect(
      mocks.enqueueViralRequestApprovalNotifications,
    ).not.toHaveBeenCalled()
  })
})