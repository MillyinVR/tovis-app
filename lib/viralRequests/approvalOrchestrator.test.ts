import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  createViralRequestApprovalFanOutRows: vi.fn(),
  enqueueViralRequestApprovalNotifications: vi.fn(),
  markViralRequestApprovalFanOutRowsQueued: vi.fn(),
  markViralRequestApprovalFanOutRowsFailed: vi.fn(),
}))

vi.mock('@/lib/viralRequests', () => ({
  createViralRequestApprovalFanOutRows:
    mocks.createViralRequestApprovalFanOutRows,
  enqueueViralRequestApprovalNotifications:
    mocks.enqueueViralRequestApprovalNotifications,
  markViralRequestApprovalFanOutRowsQueued:
    mocks.markViralRequestApprovalFanOutRowsQueued,
  markViralRequestApprovalFanOutRowsFailed:
    mocks.markViralRequestApprovalFanOutRowsFailed,
}))

import { runViralRequestApprovalOrchestration } from './approvalOrchestrator'

describe('lib/viralRequests/approvalOrchestrator.ts', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('creates durable fan-out rows, enqueues notifications, and marks rows queued', async () => {
    const db = {} as never

    mocks.createViralRequestApprovalFanOutRows.mockResolvedValue({
      requestId: 'request_1',
      matchedProfessionalIds: ['pro_1', 'pro_2'],
      fanOutRows: [
        {
          id: 'fanout_1',
          professionalId: 'pro_1',
        },
        {
          id: 'fanout_2',
          professionalId: 'pro_2',
        },
      ],
    })

    mocks.enqueueViralRequestApprovalNotifications.mockResolvedValue({
      enqueued: true,
      matchedProfessionalIds: ['pro_1', 'pro_2'],
      notificationIds: ['notif_1', 'notif_2'],
    })

    mocks.markViralRequestApprovalFanOutRowsQueued.mockResolvedValue({
      updatedCount: 2,
    })

    const result = await runViralRequestApprovalOrchestration(db, {
      requestId: 'request_1',
    })

    expect(
      mocks.createViralRequestApprovalFanOutRows,
    ).toHaveBeenCalledWith(db, {
      requestId: 'request_1',
    })

    expect(
      mocks.enqueueViralRequestApprovalNotifications,
    ).toHaveBeenCalledWith(db, {
      requestId: 'request_1',
    })

    expect(
      mocks.markViralRequestApprovalFanOutRowsQueued,
    ).toHaveBeenCalledWith(db, {
      fanOutRowIds: ['fanout_1', 'fanout_2'],
    })

    expect(
      mocks.markViralRequestApprovalFanOutRowsFailed,
    ).not.toHaveBeenCalled()

    expect(result).toEqual({
      requestId: 'request_1',
      matchedProfessionalIds: ['pro_1', 'pro_2'],
      fanOutRowIds: ['fanout_1', 'fanout_2'],
      notificationIds: ['notif_1', 'notif_2'],
      smsDeferred: true,
      fanOutRowsCreated: true,
      blocked: {
        durableFanOutRows: false,
        smsForEvent: true,
      },
    })
  })

  it('returns without enqueueing notifications when there are no fan-out rows to process', async () => {
    const db = {} as never

    mocks.createViralRequestApprovalFanOutRows.mockResolvedValue({
      requestId: 'request_1',
      matchedProfessionalIds: [],
      fanOutRows: [],
    })

    const result = await runViralRequestApprovalOrchestration(db, {
      requestId: 'request_1',
    })

    expect(
      mocks.createViralRequestApprovalFanOutRows,
    ).toHaveBeenCalledWith(db, {
      requestId: 'request_1',
    })

    expect(
      mocks.enqueueViralRequestApprovalNotifications,
    ).not.toHaveBeenCalled()

    expect(
      mocks.markViralRequestApprovalFanOutRowsQueued,
    ).not.toHaveBeenCalled()

    expect(
      mocks.markViralRequestApprovalFanOutRowsFailed,
    ).not.toHaveBeenCalled()

    expect(result).toEqual({
      requestId: 'request_1',
      matchedProfessionalIds: [],
      fanOutRowIds: [],
      notificationIds: [],
      smsDeferred: true,
      fanOutRowsCreated: false,
      blocked: {
        durableFanOutRows: false,
        smsForEvent: true,
      },
    })
  })

  it('marks fan-out rows failed when downstream notification enqueue throws', async () => {
    const db = {} as never
    const error = new Error('Notification enqueue failed.')

    mocks.createViralRequestApprovalFanOutRows.mockResolvedValue({
      requestId: 'request_1',
      matchedProfessionalIds: ['pro_1', 'pro_2'],
      fanOutRows: [
        {
          id: 'fanout_1',
          professionalId: 'pro_1',
        },
        {
          id: 'fanout_2',
          professionalId: 'pro_2',
        },
      ],
    })

    mocks.enqueueViralRequestApprovalNotifications.mockRejectedValue(error)

    mocks.markViralRequestApprovalFanOutRowsFailed.mockResolvedValue({
      updatedCount: 2,
    })

    await expect(
      runViralRequestApprovalOrchestration(db, {
        requestId: 'request_1',
      }),
    ).rejects.toThrow('Notification enqueue failed.')

    expect(
      mocks.markViralRequestApprovalFanOutRowsQueued,
    ).not.toHaveBeenCalled()

    expect(
      mocks.markViralRequestApprovalFanOutRowsFailed,
    ).toHaveBeenCalledWith(db, {
      fanOutRowIds: ['fanout_1', 'fanout_2'],
      message: 'Notification enqueue failed.',
    })
  })

  it('uses a fallback failure message for non-Error throws', async () => {
    const db = {} as never

    mocks.createViralRequestApprovalFanOutRows.mockResolvedValue({
      requestId: 'request_1',
      matchedProfessionalIds: ['pro_1'],
      fanOutRows: [
        {
          id: 'fanout_1',
          professionalId: 'pro_1',
        },
      ],
    })

    mocks.enqueueViralRequestApprovalNotifications.mockRejectedValue('boom')

    mocks.markViralRequestApprovalFanOutRowsFailed.mockResolvedValue({
      updatedCount: 1,
    })

    await expect(
      runViralRequestApprovalOrchestration(db, {
        requestId: 'request_1',
      }),
    ).rejects.toBe('boom')

    expect(
      mocks.markViralRequestApprovalFanOutRowsFailed,
    ).toHaveBeenCalledWith(db, {
      fanOutRowIds: ['fanout_1'],
      message: 'Unknown viral approval orchestration error.',
    })
  })
})