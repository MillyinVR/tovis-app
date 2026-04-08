import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  NotificationChannel,
  NotificationDeliveryEventType,
  NotificationDeliveryStatus,
  NotificationProvider,
} from '@prisma/client'

const mockTx = vi.hoisted(() => ({
  notificationDelivery: {
    findFirst: vi.fn(),
    update: vi.fn(),
    findUnique: vi.fn(),
  },
  notificationDeliveryEvent: {
    create: vi.fn(),
  },
}))

const mockPrisma = vi.hoisted(() => ({
  $transaction: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: mockPrisma,
}))

import { applyDeliveryWebhookUpdate } from './applyDeliveryWebhookUpdate'

function resetMockGroup(group: Record<string, ReturnType<typeof vi.fn>>) {
  for (const fn of Object.values(group)) {
    fn.mockReset()
  }
}

function makeMatchedDelivery(
  overrides?: Partial<{
    id: string
    status: NotificationDeliveryStatus
    attemptCount: number
    provider: NotificationProvider
    providerMessageId: string | null
    providerStatus: string | null
    lastErrorCode: string | null
    lastErrorMessage: string | null
    sentAt: Date | null
    deliveredAt: Date | null
    failedAt: Date | null
    suppressedAt: Date | null
    cancelledAt: Date | null
  }>,
) {
  const now = new Date('2026-04-10T12:00:00.000Z')

  return {
    id: overrides?.id ?? 'delivery_1',
    status: overrides?.status ?? NotificationDeliveryStatus.SENT,
    attemptCount: overrides?.attemptCount ?? 1,
    provider: overrides?.provider ?? NotificationProvider.POSTMARK,
    providerMessageId:
      overrides?.providerMessageId ?? 'provider_msg_1',
    providerStatus: overrides?.providerStatus ?? 'accepted',
    lastErrorCode: overrides?.lastErrorCode ?? null,
    lastErrorMessage: overrides?.lastErrorMessage ?? null,
    sentAt: overrides?.sentAt ?? now,
    deliveredAt: overrides?.deliveredAt ?? null,
    failedAt: overrides?.failedAt ?? null,
    suppressedAt: overrides?.suppressedAt ?? null,
    cancelledAt: overrides?.cancelledAt ?? null,
  }
}

function makeUpdatedDelivery(
  overrides?: Partial<{
    id: string
    status: NotificationDeliveryStatus
    attemptCount: number
    provider: NotificationProvider
    providerMessageId: string | null
    providerStatus: string | null
    lastErrorCode: string | null
    lastErrorMessage: string | null
    sentAt: Date | null
    deliveredAt: Date | null
    failedAt: Date | null
  }>,
) {
  const now = new Date('2026-04-10T12:00:00.000Z')

  return {
    id: overrides?.id ?? 'delivery_1',
    dispatchId: 'dispatch_1',
    channel: NotificationChannel.EMAIL,
    provider: overrides?.provider ?? NotificationProvider.POSTMARK,
    status: overrides?.status ?? NotificationDeliveryStatus.SENT,
    destination: 'client@example.com',
    templateKey: 'booking_confirmed',
    templateVersion: 1,
    attemptCount: overrides?.attemptCount ?? 1,
    maxAttempts: 6,
    nextAttemptAt: now,
    lastAttemptAt: now,
    claimedAt: null,
    leaseExpiresAt: null,
    leaseToken: null,
    providerMessageId:
      overrides?.providerMessageId ?? 'provider_msg_1',
    providerStatus: overrides?.providerStatus ?? 'accepted',
    lastErrorCode: overrides?.lastErrorCode ?? null,
    lastErrorMessage: overrides?.lastErrorMessage ?? null,
    sentAt: overrides?.sentAt ?? now,
    deliveredAt: overrides?.deliveredAt ?? null,
    failedAt: overrides?.failedAt ?? null,
    suppressedAt: null,
    cancelledAt: null,
    createdAt: now,
    updatedAt: now,
  }
}

describe('lib/notifications/webhooks/applyDeliveryWebhookUpdate', () => {
  beforeEach(() => {
    resetMockGroup(mockTx.notificationDelivery)
    resetMockGroup(mockTx.notificationDeliveryEvent)
    mockPrisma.$transaction.mockReset()

    mockPrisma.$transaction.mockImplementation(
      async (callback: (tx: typeof mockTx) => Promise<unknown>) => {
        return callback(mockTx)
      },
    )
  })

  it('returns matched false when no delivery exists for the provider message id', async () => {
    mockTx.notificationDelivery.findFirst.mockResolvedValue(null)

    const result = await applyDeliveryWebhookUpdate({
      provider: NotificationProvider.POSTMARK,
      providerMessageId: 'missing_msg',
      providerStatus: 'delivered',
      kind: 'DELIVERED',
      occurredAt: new Date('2026-04-10T12:05:00.000Z'),
    })

    expect(mockTx.notificationDelivery.findFirst).toHaveBeenCalledWith({
      where: {
        provider: NotificationProvider.POSTMARK,
        providerMessageId: 'missing_msg',
      },
      select: {
        id: true,
        status: true,
        attemptCount: true,
        provider: true,
        providerMessageId: true,
        providerStatus: true,
        lastErrorCode: true,
        lastErrorMessage: true,
        sentAt: true,
        deliveredAt: true,
        failedAt: true,
        suppressedAt: true,
        cancelledAt: true,
      },
    })

    expect(mockTx.notificationDelivery.update).not.toHaveBeenCalled()
    expect(mockTx.notificationDeliveryEvent.create).not.toHaveBeenCalled()
    expect(mockTx.notificationDelivery.findUnique).not.toHaveBeenCalled()

    expect(result).toEqual({
      matched: false,
      delivery: null,
    })
  })

  it('records a STATUS_UPDATE without changing the delivery status', async () => {
    const occurredAt = new Date('2026-04-10T12:05:00.000Z')

    mockTx.notificationDelivery.findFirst.mockResolvedValue(
      makeMatchedDelivery({
        status: NotificationDeliveryStatus.SENT,
        attemptCount: 1,
        provider: NotificationProvider.POSTMARK,
        providerMessageId: 'pm_123',
        providerStatus: 'accepted',
      }),
    )

    mockTx.notificationDelivery.update.mockResolvedValue(undefined)
    mockTx.notificationDeliveryEvent.create.mockResolvedValue({ id: 'event_1' })
    mockTx.notificationDelivery.findUnique.mockResolvedValue(
      makeUpdatedDelivery({
        status: NotificationDeliveryStatus.SENT,
        attemptCount: 1,
        provider: NotificationProvider.POSTMARK,
        providerMessageId: 'pm_123',
        providerStatus: 'opened',
      }),
    )

    const result = await applyDeliveryWebhookUpdate({
      provider: NotificationProvider.POSTMARK,
      providerMessageId: 'pm_123',
      providerStatus: 'opened',
      kind: 'STATUS_UPDATE',
      occurredAt,
      payload: {
        stream: 'outbound',
        rawStatus: 'Opened',
      },
    })

    expect(mockTx.notificationDelivery.update).toHaveBeenCalledWith({
      where: {
        id: 'delivery_1',
      },
      data: {
        status: NotificationDeliveryStatus.SENT,
        providerStatus: 'opened',
      },
    })

    expect(mockTx.notificationDeliveryEvent.create).toHaveBeenCalledWith({
      data: {
        delivery: {
          connect: {
            id: 'delivery_1',
          },
        },
        attemptNumber: 1,
        type: NotificationDeliveryEventType.WEBHOOK_UPDATE,
        fromStatus: NotificationDeliveryStatus.SENT,
        toStatus: NotificationDeliveryStatus.SENT,
        providerStatus: 'opened',
        providerMessageId: 'pm_123',
        errorCode: null,
        errorMessage: null,
        message: 'Provider webhook recorded status update (opened).',
        payload: {
          source: 'applyDeliveryWebhookUpdate',
          kind: 'STATUS_UPDATE',
          occurredAt: occurredAt.toISOString(),
          webhook: {
            stream: 'outbound',
            rawStatus: 'Opened',
          },
        },
        createdAt: occurredAt,
      },
    })

    expect(result).toEqual({
      matched: true,
      delivery: makeUpdatedDelivery({
        status: NotificationDeliveryStatus.SENT,
        attemptCount: 1,
        provider: NotificationProvider.POSTMARK,
        providerMessageId: 'pm_123',
        providerStatus: 'opened',
      }),
      previousStatus: NotificationDeliveryStatus.SENT,
      nextStatus: NotificationDeliveryStatus.SENT,
      statusChanged: false,
    })
  })

  it('marks a delivery DELIVERED and clears failure fields', async () => {
    const occurredAt = new Date('2026-04-10T12:10:00.000Z')

    mockTx.notificationDelivery.findFirst.mockResolvedValue(
      makeMatchedDelivery({
        status: NotificationDeliveryStatus.SENT,
        attemptCount: 2,
        provider: NotificationProvider.POSTMARK,
        providerMessageId: 'pm_delivered_1',
        providerStatus: 'accepted',
        lastErrorCode: 'OLD_ERROR',
        lastErrorMessage: 'Old error',
        failedAt: new Date('2026-04-10T12:01:00.000Z'),
      }),
    )

    mockTx.notificationDelivery.update.mockResolvedValue(undefined)
    mockTx.notificationDeliveryEvent.create.mockResolvedValue({ id: 'event_2' })
    mockTx.notificationDelivery.findUnique.mockResolvedValue(
      makeUpdatedDelivery({
        status: NotificationDeliveryStatus.DELIVERED,
        attemptCount: 2,
        provider: NotificationProvider.POSTMARK,
        providerMessageId: 'pm_delivered_1',
        providerStatus: 'delivered',
        deliveredAt: occurredAt,
        failedAt: null,
        lastErrorCode: null,
        lastErrorMessage: null,
      }),
    )

    const result = await applyDeliveryWebhookUpdate({
      provider: NotificationProvider.POSTMARK,
      providerMessageId: 'pm_delivered_1',
      providerStatus: 'delivered',
      kind: 'DELIVERED',
      occurredAt,
    })

    expect(mockTx.notificationDelivery.update).toHaveBeenCalledWith({
      where: {
        id: 'delivery_1',
      },
      data: {
        status: NotificationDeliveryStatus.DELIVERED,
        providerStatus: 'delivered',
        deliveredAt: occurredAt,
        failedAt: null,
        lastErrorCode: null,
        lastErrorMessage: null,
      },
    })

    expect(mockTx.notificationDeliveryEvent.create).toHaveBeenCalledWith({
      data: {
        delivery: {
          connect: {
            id: 'delivery_1',
          },
        },
        attemptNumber: 2,
        type: NotificationDeliveryEventType.WEBHOOK_UPDATE,
        fromStatus: NotificationDeliveryStatus.SENT,
        toStatus: NotificationDeliveryStatus.DELIVERED,
        providerStatus: 'delivered',
        providerMessageId: 'pm_delivered_1',
        errorCode: null,
        errorMessage: null,
        message: 'Provider webhook marked delivery delivered (delivered).',
        payload: {
          source: 'applyDeliveryWebhookUpdate',
          kind: 'DELIVERED',
          occurredAt: occurredAt.toISOString(),
        },
        createdAt: occurredAt,
      },
    })

    expect(result).toEqual({
      matched: true,
      delivery: makeUpdatedDelivery({
        status: NotificationDeliveryStatus.DELIVERED,
        attemptCount: 2,
        provider: NotificationProvider.POSTMARK,
        providerMessageId: 'pm_delivered_1',
        providerStatus: 'delivered',
        deliveredAt: occurredAt,
        failedAt: null,
        lastErrorCode: null,
        lastErrorMessage: null,
      }),
      previousStatus: NotificationDeliveryStatus.SENT,
      nextStatus: NotificationDeliveryStatus.DELIVERED,
      statusChanged: true,
    })
  })

  it('marks a delivery FAILED_FINAL from webhook failure', async () => {
    const occurredAt = new Date('2026-04-10T12:15:00.000Z')

    mockTx.notificationDelivery.findFirst.mockResolvedValue(
      makeMatchedDelivery({
        status: NotificationDeliveryStatus.SENT,
        attemptCount: 3,
        provider: NotificationProvider.TWILIO,
        providerMessageId: 'SM123',
        providerStatus: 'queued',
      }),
    )

    mockTx.notificationDelivery.update.mockResolvedValue(undefined)
    mockTx.notificationDeliveryEvent.create.mockResolvedValue({ id: 'event_3' })
    mockTx.notificationDelivery.findUnique.mockResolvedValue(
      makeUpdatedDelivery({
        status: NotificationDeliveryStatus.FAILED_FINAL,
        attemptCount: 3,
        provider: NotificationProvider.TWILIO,
        providerMessageId: 'SM123',
        providerStatus: 'undelivered',
        failedAt: occurredAt,
        lastErrorCode: '30005',
        lastErrorMessage: 'Unknown destination handset.',
      }),
    )

    const result = await applyDeliveryWebhookUpdate({
      provider: NotificationProvider.TWILIO,
      providerMessageId: 'SM123',
      providerStatus: 'undelivered',
      kind: 'FAILED_FINAL',
      occurredAt,
      errorCode: '30005',
      errorMessage: 'Unknown destination handset.',
      payload: {
        twilioStatus: 'undelivered',
      },
    })

    expect(mockTx.notificationDelivery.update).toHaveBeenCalledWith({
      where: {
        id: 'delivery_1',
      },
      data: {
        status: NotificationDeliveryStatus.FAILED_FINAL,
        providerStatus: 'undelivered',
        failedAt: occurredAt,
        lastErrorCode: '30005',
        lastErrorMessage: 'Unknown destination handset.',
      },
    })

    expect(mockTx.notificationDeliveryEvent.create).toHaveBeenCalledWith({
      data: {
        delivery: {
          connect: {
            id: 'delivery_1',
          },
        },
        attemptNumber: 3,
        type: NotificationDeliveryEventType.WEBHOOK_UPDATE,
        fromStatus: NotificationDeliveryStatus.SENT,
        toStatus: NotificationDeliveryStatus.FAILED_FINAL,
        providerStatus: 'undelivered',
        providerMessageId: 'SM123',
        errorCode: '30005',
        errorMessage: 'Unknown destination handset.',
        message: 'Provider webhook marked delivery failed (undelivered).',
        payload: {
          source: 'applyDeliveryWebhookUpdate',
          kind: 'FAILED_FINAL',
          occurredAt: occurredAt.toISOString(),
          webhook: {
            twilioStatus: 'undelivered',
          },
        },
        createdAt: occurredAt,
      },
    })

    expect(result).toEqual({
      matched: true,
      delivery: makeUpdatedDelivery({
        status: NotificationDeliveryStatus.FAILED_FINAL,
        attemptCount: 3,
        provider: NotificationProvider.TWILIO,
        providerMessageId: 'SM123',
        providerStatus: 'undelivered',
        failedAt: occurredAt,
        lastErrorCode: '30005',
        lastErrorMessage: 'Unknown destination handset.',
      }),
      previousStatus: NotificationDeliveryStatus.SENT,
      nextStatus: NotificationDeliveryStatus.FAILED_FINAL,
      statusChanged: true,
    })
  })

  it('does not overwrite FAILED_FINAL when a delivered webhook arrives late', async () => {
    const occurredAt = new Date('2026-04-10T12:20:00.000Z')

    mockTx.notificationDelivery.findFirst.mockResolvedValue(
      makeMatchedDelivery({
        status: NotificationDeliveryStatus.FAILED_FINAL,
        attemptCount: 2,
        provider: NotificationProvider.POSTMARK,
        providerMessageId: 'pm_late_1',
        providerStatus: 'bounced',
        failedAt: new Date('2026-04-10T12:18:00.000Z'),
        lastErrorCode: 'HARD_BOUNCE',
        lastErrorMessage: 'Mailbox unavailable.',
      }),
    )

    mockTx.notificationDelivery.update.mockResolvedValue(undefined)
    mockTx.notificationDeliveryEvent.create.mockResolvedValue({ id: 'event_4' })
    mockTx.notificationDelivery.findUnique.mockResolvedValue(
      makeUpdatedDelivery({
        status: NotificationDeliveryStatus.FAILED_FINAL,
        attemptCount: 2,
        provider: NotificationProvider.POSTMARK,
        providerMessageId: 'pm_late_1',
        providerStatus: 'delivered',
        failedAt: new Date('2026-04-10T12:18:00.000Z'),
        lastErrorCode: 'HARD_BOUNCE',
        lastErrorMessage: 'Mailbox unavailable.',
      }),
    )

    const result = await applyDeliveryWebhookUpdate({
      provider: NotificationProvider.POSTMARK,
      providerMessageId: 'pm_late_1',
      providerStatus: 'delivered',
      kind: 'DELIVERED',
      occurredAt,
    })

    expect(mockTx.notificationDelivery.update).toHaveBeenCalledWith({
      where: {
        id: 'delivery_1',
      },
      data: {
        status: NotificationDeliveryStatus.FAILED_FINAL,
        providerStatus: 'delivered',
      },
    })

    expect(result).toEqual({
      matched: true,
      delivery: makeUpdatedDelivery({
        status: NotificationDeliveryStatus.FAILED_FINAL,
        attemptCount: 2,
        provider: NotificationProvider.POSTMARK,
        providerMessageId: 'pm_late_1',
        providerStatus: 'delivered',
        failedAt: new Date('2026-04-10T12:18:00.000Z'),
        lastErrorCode: 'HARD_BOUNCE',
        lastErrorMessage: 'Mailbox unavailable.',
      }),
      previousStatus: NotificationDeliveryStatus.FAILED_FINAL,
      nextStatus: NotificationDeliveryStatus.FAILED_FINAL,
      statusChanged: false,
    })
  })

  it('does not overwrite DELIVERED when a failed webhook arrives late', async () => {
    const occurredAt = new Date('2026-04-10T12:25:00.000Z')
    const deliveredAt = new Date('2026-04-10T12:22:00.000Z')

    mockTx.notificationDelivery.findFirst.mockResolvedValue(
      makeMatchedDelivery({
        status: NotificationDeliveryStatus.DELIVERED,
        attemptCount: 2,
        provider: NotificationProvider.TWILIO,
        providerMessageId: 'SM999',
        providerStatus: 'delivered',
        deliveredAt,
      }),
    )

    mockTx.notificationDelivery.update.mockResolvedValue(undefined)
    mockTx.notificationDeliveryEvent.create.mockResolvedValue({ id: 'event_5' })
    mockTx.notificationDelivery.findUnique.mockResolvedValue(
      makeUpdatedDelivery({
        status: NotificationDeliveryStatus.DELIVERED,
        attemptCount: 2,
        provider: NotificationProvider.TWILIO,
        providerMessageId: 'SM999',
        providerStatus: 'undelivered',
        deliveredAt,
      }),
    )

    const result = await applyDeliveryWebhookUpdate({
      provider: NotificationProvider.TWILIO,
      providerMessageId: 'SM999',
      providerStatus: 'undelivered',
      kind: 'FAILED_FINAL',
      occurredAt,
      errorCode: '30003',
      errorMessage: 'Unreachable destination handset.',
    })

    expect(mockTx.notificationDelivery.update).toHaveBeenCalledWith({
      where: {
        id: 'delivery_1',
      },
      data: {
        status: NotificationDeliveryStatus.DELIVERED,
        providerStatus: 'undelivered',
      },
    })

    expect(result).toEqual({
      matched: true,
      delivery: makeUpdatedDelivery({
        status: NotificationDeliveryStatus.DELIVERED,
        attemptCount: 2,
        provider: NotificationProvider.TWILIO,
        providerMessageId: 'SM999',
        providerStatus: 'undelivered',
        deliveredAt,
      }),
      previousStatus: NotificationDeliveryStatus.DELIVERED,
      nextStatus: NotificationDeliveryStatus.DELIVERED,
      statusChanged: false,
    })
  })

  it('throws for blank providerMessageId', async () => {
    await expect(
      applyDeliveryWebhookUpdate({
        provider: NotificationProvider.POSTMARK,
        providerMessageId: '   ',
        providerStatus: 'delivered',
        kind: 'DELIVERED',
      }),
    ).rejects.toThrow(
      'applyDeliveryWebhookUpdate: missing providerMessageId',
    )

    expect(mockPrisma.$transaction).not.toHaveBeenCalled()
  })

  it('throws for blank providerStatus', async () => {
    await expect(
      applyDeliveryWebhookUpdate({
        provider: NotificationProvider.POSTMARK,
        providerMessageId: 'pm_123',
        providerStatus: '   ',
        kind: 'DELIVERED',
      }),
    ).rejects.toThrow(
      'applyDeliveryWebhookUpdate: missing providerStatus',
    )

    expect(mockPrisma.$transaction).not.toHaveBeenCalled()
  })

  it('throws for invalid occurredAt', async () => {
    await expect(
      applyDeliveryWebhookUpdate({
        provider: NotificationProvider.POSTMARK,
        providerMessageId: 'pm_123',
        providerStatus: 'delivered',
        kind: 'DELIVERED',
        occurredAt: new Date('invalid'),
      }),
    ).rejects.toThrow('applyDeliveryWebhookUpdate: invalid occurredAt')

    expect(mockPrisma.$transaction).not.toHaveBeenCalled()
  })
})