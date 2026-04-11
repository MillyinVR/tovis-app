import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  NotificationChannel,
  NotificationDeliveryEventType,
  NotificationDeliveryStatus,
  NotificationEventKey,
  NotificationPriority,
  NotificationProvider,
  NotificationRecipientKind,
  Prisma,
} from '@prisma/client'

const mockTx = vi.hoisted(() => ({
  notificationDelivery: {
    findFirst: vi.fn(),
    update: vi.fn(),
    findUnique: vi.fn(),
  },
  notificationDeliveryEvent: {
    createMany: vi.fn(),
  },
}))

const mockPrisma = vi.hoisted(() => ({
  $transaction: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: mockPrisma,
}))

import { completeDeliveryAttempt } from './completeDeliveryAttempt'

function resetMockGroup(group: Record<string, ReturnType<typeof vi.fn>>) {
  for (const fn of Object.values(group)) {
    fn.mockReset()
  }
}

function makeOwnedDelivery(
  overrides?: Partial<{
    id: string
    status: NotificationDeliveryStatus
    attemptCount: number
    maxAttempts: number
    claimedAt: Date | null
    leaseExpiresAt: Date | null
    leaseToken: string | null
    cancelledAt: Date | null
    dispatchCancelledAt: Date | null
  }>,
) {
  return {
    id: overrides?.id ?? 'delivery_1',
    status: overrides?.status ?? NotificationDeliveryStatus.PENDING,
    attemptCount: overrides?.attemptCount ?? 0,
    maxAttempts: overrides?.maxAttempts ?? 5,
    claimedAt:
      overrides?.claimedAt ?? new Date('2026-04-09T12:00:00.000Z'),
    leaseExpiresAt:
      overrides?.leaseExpiresAt ?? new Date('2026-04-09T12:01:00.000Z'),
    leaseToken: overrides?.leaseToken ?? 'lease_token_1',
    cancelledAt: overrides?.cancelledAt ?? null,
    dispatch: {
      cancelledAt: overrides?.dispatchCancelledAt ?? null,
    },
  }
}

function makeCompletedDelivery(
  overrides?: Partial<{
    id: string
    status: NotificationDeliveryStatus
    attemptCount: number
    maxAttempts: number
    lastAttemptAt: Date | null
    nextAttemptAt: Date
    claimedAt: Date | null
    leaseExpiresAt: Date | null
    leaseToken: string | null
    providerMessageId: string | null
    providerStatus: string | null
    lastErrorCode: string | null
    lastErrorMessage: string | null
    sentAt: Date | null
    deliveredAt: Date | null
    failedAt: Date | null
  }>,
) {
  const now = new Date('2026-04-09T12:00:00.000Z')

  return {
    id: overrides?.id ?? 'delivery_1',
    dispatchId: 'dispatch_1',
    channel: NotificationChannel.SMS,
    provider: NotificationProvider.TWILIO,
    status: overrides?.status ?? NotificationDeliveryStatus.SENT,
    destination: '+15551234567',
    templateKey: 'appointment_reminder',
    templateVersion: 1,
    attemptCount: overrides?.attemptCount ?? 1,
    maxAttempts: overrides?.maxAttempts ?? 5,
    nextAttemptAt: overrides?.nextAttemptAt ?? now,
    lastAttemptAt: overrides?.lastAttemptAt ?? now,
    claimedAt: overrides?.claimedAt ?? null,
    leaseExpiresAt: overrides?.leaseExpiresAt ?? null,
    leaseToken: overrides?.leaseToken ?? null,
    providerMessageId: overrides?.providerMessageId ?? 'provider_msg_1',
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
    dispatch: {
      id: 'dispatch_1',
      sourceKey: 'client-notification:notif_1',
      eventKey: NotificationEventKey.APPOINTMENT_REMINDER,
      recipientKind: NotificationRecipientKind.CLIENT,
      priority: NotificationPriority.NORMAL,
      userId: 'user_1',
      professionalId: null,
      clientId: 'client_1',
      recipientInAppTargetId: 'client_1',
      recipientPhone: '+15551234567',
      recipientEmail: 'client@example.com',
      recipientTimeZone: 'America/Los_Angeles',
      notificationId: null,
      clientNotificationId: 'notif_1',
      title: 'Appointment reminder',
      body: 'Reminder body',
      href: '/client/bookings/booking_1',
      payload: { bookingId: 'booking_1' },
      scheduledFor: now,
      cancelledAt: null,
      createdAt: now,
      updatedAt: now,
    },
  }
}

describe('lib/notifications/delivery/completeDeliveryAttempt', () => {
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

  it('completes a successful send and releases the lease', async () => {
    const attemptedAt = new Date('2026-04-09T12:00:00.000Z')

    mockTx.notificationDelivery.findFirst.mockResolvedValue(
      makeOwnedDelivery({
        status: NotificationDeliveryStatus.PENDING,
        attemptCount: 0,
        maxAttempts: 5,
        leaseToken: 'lease_token_1',
        leaseExpiresAt: new Date('2026-04-09T12:01:00.000Z'),
      }),
    )

    mockTx.notificationDelivery.update.mockResolvedValue(undefined)
    mockTx.notificationDeliveryEvent.createMany.mockResolvedValue({ count: 1 })
    mockTx.notificationDelivery.findUnique.mockResolvedValue(
      makeCompletedDelivery({
        status: NotificationDeliveryStatus.SENT,
        attemptCount: 1,
        lastAttemptAt: attemptedAt,
        sentAt: attemptedAt,
        deliveredAt: null,
        failedAt: null,
        providerMessageId: 'twilio_123',
        providerStatus: 'queued',
      }),
    )

    const result = await completeDeliveryAttempt({
      kind: 'SUCCESS',
      deliveryId: 'delivery_1',
      leaseToken: 'lease_token_1',
      attemptedAt,
      providerMessageId: 'twilio_123',
      providerStatus: 'queued',
      responseMeta: {
        sid: 'twilio_123',
      },
    })

    expect(mockTx.notificationDelivery.findFirst).toHaveBeenCalledWith({
      where: {
        id: 'delivery_1',
        leaseToken: 'lease_token_1',
        cancelledAt: null,
        claimedAt: {
          not: null,
        },
        leaseExpiresAt: {
          gt: attemptedAt,
        },
        dispatch: {
          cancelledAt: null,
        },
      },
      select: {
        id: true,
        status: true,
        attemptCount: true,
        maxAttempts: true,
        claimedAt: true,
        leaseExpiresAt: true,
        leaseToken: true,
        cancelledAt: true,
        dispatch: {
          select: {
            cancelledAt: true,
          },
        },
      },
    })

    expect(mockTx.notificationDelivery.update).toHaveBeenCalledWith({
      where: {
        id: 'delivery_1',
      },
      data: {
        status: NotificationDeliveryStatus.SENT,
        attemptCount: 1,
        lastAttemptAt: attemptedAt,
        providerMessageId: 'twilio_123',
        providerStatus: 'queued',
        lastErrorCode: null,
        lastErrorMessage: null,
        sentAt: attemptedAt,
        deliveredAt: null,
        failedAt: null,
        claimedAt: null,
        leaseExpiresAt: null,
        leaseToken: null,
      },
    })

    expect(mockTx.notificationDeliveryEvent.createMany).toHaveBeenCalledWith({
      data: [
        {
          deliveryId: 'delivery_1',
          attemptNumber: 1,
          type: NotificationDeliveryEventType.PROVIDER_ACCEPTED,
          fromStatus: NotificationDeliveryStatus.PENDING,
          toStatus: NotificationDeliveryStatus.SENT,
          providerStatus: 'queued',
          providerMessageId: 'twilio_123',
          message: 'Provider accepted the delivery attempt.',
          payload: {
            sid: 'twilio_123',
          },
          createdAt: attemptedAt,
        },
      ],
    })

    expect(result.delivery).toMatchObject({
      id: 'delivery_1',
      status: NotificationDeliveryStatus.SENT,
      attemptCount: 1,
      providerMessageId: 'twilio_123',
      providerStatus: 'queued',
    })
  })

  it('marks delivered success with both PROVIDER_ACCEPTED and DELIVERED events', async () => {
    const attemptedAt = new Date('2026-04-09T12:00:00.000Z')
    const deliveredAt = new Date('2026-04-09T12:00:05.000Z')

    mockTx.notificationDelivery.findFirst.mockResolvedValue(
      makeOwnedDelivery({
        status: NotificationDeliveryStatus.PENDING,
        attemptCount: 1,
        maxAttempts: 5,
        leaseToken: 'lease_token_1',
      }),
    )

    mockTx.notificationDelivery.update.mockResolvedValue(undefined)
    mockTx.notificationDeliveryEvent.createMany.mockResolvedValue({ count: 2 })
    mockTx.notificationDelivery.findUnique.mockResolvedValue(
      makeCompletedDelivery({
        status: NotificationDeliveryStatus.DELIVERED,
        attemptCount: 2,
        lastAttemptAt: attemptedAt,
        sentAt: attemptedAt,
        deliveredAt,
        providerMessageId: 'provider_accepted_1',
        providerStatus: 'delivered',
      }),
    )

    await completeDeliveryAttempt({
      kind: 'SUCCESS',
      deliveryId: 'delivery_1',
      leaseToken: 'lease_token_1',
      attemptedAt,
      deliveredAt,
      providerMessageId: 'provider_accepted_1',
      providerStatus: 'delivered',
      message: 'Immediate delivery confirmed.',
      responseMeta: {
        deliveredImmediately: true,
      },
    })

    expect(mockTx.notificationDelivery.update).toHaveBeenCalledWith({
      where: {
        id: 'delivery_1',
      },
      data: {
        status: NotificationDeliveryStatus.DELIVERED,
        attemptCount: 2,
        lastAttemptAt: attemptedAt,
        providerMessageId: 'provider_accepted_1',
        providerStatus: 'delivered',
        lastErrorCode: null,
        lastErrorMessage: null,
        sentAt: attemptedAt,
        deliveredAt,
        failedAt: null,
        claimedAt: null,
        leaseExpiresAt: null,
        leaseToken: null,
      },
    })

    expect(mockTx.notificationDeliveryEvent.createMany).toHaveBeenCalledWith({
      data: [
        {
          deliveryId: 'delivery_1',
          attemptNumber: 2,
          type: NotificationDeliveryEventType.PROVIDER_ACCEPTED,
          fromStatus: NotificationDeliveryStatus.PENDING,
          toStatus: NotificationDeliveryStatus.SENT,
          providerStatus: 'delivered',
          providerMessageId: 'provider_accepted_1',
          message: 'Immediate delivery confirmed.',
          payload: {
            deliveredImmediately: true,
          },
          createdAt: attemptedAt,
        },
        {
          deliveryId: 'delivery_1',
          attemptNumber: 2,
          type: NotificationDeliveryEventType.DELIVERED,
          fromStatus: NotificationDeliveryStatus.SENT,
          toStatus: NotificationDeliveryStatus.DELIVERED,
          providerStatus: 'delivered',
          providerMessageId: 'provider_accepted_1',
          message: 'Delivery marked delivered.',
          payload: {
            deliveredImmediately: true,
          },
          createdAt: deliveredAt,
        },
      ],
    })
  })

  it('records retryable failure, schedules retry, and releases the lease', async () => {
    const attemptedAt = new Date('2026-04-09T12:00:00.000Z')
    const nextAttemptAt = new Date('2026-04-09T12:05:00.000Z')

    mockTx.notificationDelivery.findFirst.mockResolvedValue(
      makeOwnedDelivery({
        status: NotificationDeliveryStatus.PENDING,
        attemptCount: 1,
        maxAttempts: 5,
        leaseToken: 'lease_token_1',
      }),
    )

    mockTx.notificationDelivery.update.mockResolvedValue(undefined)
    mockTx.notificationDeliveryEvent.createMany.mockResolvedValue({ count: 2 })
    mockTx.notificationDelivery.findUnique.mockResolvedValue(
      makeCompletedDelivery({
        status: NotificationDeliveryStatus.FAILED_RETRYABLE,
        attemptCount: 2,
        lastAttemptAt: attemptedAt,
        nextAttemptAt,
        sentAt: null,
        deliveredAt: null,
        failedAt: null,
        providerMessageId: 'provider_fail_1',
        providerStatus: '429',
        lastErrorCode: 'RATE_LIMIT',
        lastErrorMessage: 'Provider rate limited request.',
      }),
    )

    const result = await completeDeliveryAttempt({
      kind: 'RETRYABLE_FAILURE',
      deliveryId: 'delivery_1',
      leaseToken: 'lease_token_1',
      attemptedAt,
      nextAttemptAt,
      code: 'RATE_LIMIT',
      message: 'Provider rate limited request.',
      providerMessageId: 'provider_fail_1',
      providerStatus: '429',
      responseMeta: {
        retryAfterSeconds: 300,
      },
    })

    expect(mockTx.notificationDelivery.update).toHaveBeenCalledWith({
      where: {
        id: 'delivery_1',
      },
      data: {
        status: NotificationDeliveryStatus.FAILED_RETRYABLE,
        attemptCount: 2,
        lastAttemptAt: attemptedAt,
        nextAttemptAt,
        providerMessageId: 'provider_fail_1',
        providerStatus: '429',
        lastErrorCode: 'RATE_LIMIT',
        lastErrorMessage: 'Provider rate limited request.',
        failedAt: null,
        claimedAt: null,
        leaseExpiresAt: null,
        leaseToken: null,
      },
    })

    expect(mockTx.notificationDeliveryEvent.createMany).toHaveBeenCalledWith({
      data: [
        {
          deliveryId: 'delivery_1',
          attemptNumber: 2,
          type: NotificationDeliveryEventType.FAILED,
          fromStatus: NotificationDeliveryStatus.PENDING,
          toStatus: NotificationDeliveryStatus.FAILED_RETRYABLE,
          providerStatus: '429',
          providerMessageId: 'provider_fail_1',
          errorCode: 'RATE_LIMIT',
          errorMessage: 'Provider rate limited request.',
          message: 'Delivery attempt failed and will be retried.',
          payload: {
            retryAfterSeconds: 300,
          },
          createdAt: attemptedAt,
        },
        {
          deliveryId: 'delivery_1',
          attemptNumber: 2,
          type: NotificationDeliveryEventType.RETRY_SCHEDULED,
          fromStatus: NotificationDeliveryStatus.FAILED_RETRYABLE,
          toStatus: NotificationDeliveryStatus.FAILED_RETRYABLE,
          providerStatus: '429',
          providerMessageId: 'provider_fail_1',
          message: `Retry scheduled for ${nextAttemptAt.toISOString()}.`,
          payload: {
            source: 'completeDeliveryAttempt',
            nextAttemptAt: nextAttemptAt.toISOString(),
            responseMeta: {
              retryAfterSeconds: 300,
            },
          },
          createdAt: attemptedAt,
        },
      ],
    })

    expect(result.delivery).toMatchObject({
      id: 'delivery_1',
      status: NotificationDeliveryStatus.FAILED_RETRYABLE,
      attemptCount: 2,
      lastErrorCode: 'RATE_LIMIT',
    })
  })

  it('records final failure and releases the lease', async () => {
    const attemptedAt = new Date('2026-04-09T12:00:00.000Z')

    mockTx.notificationDelivery.findFirst.mockResolvedValue(
      makeOwnedDelivery({
        status: NotificationDeliveryStatus.PENDING,
        attemptCount: 4,
        maxAttempts: 5,
        leaseToken: 'lease_token_1',
      }),
    )

    mockTx.notificationDelivery.update.mockResolvedValue(undefined)
    mockTx.notificationDeliveryEvent.createMany.mockResolvedValue({ count: 1 })
    mockTx.notificationDelivery.findUnique.mockResolvedValue(
      makeCompletedDelivery({
        status: NotificationDeliveryStatus.FAILED_FINAL,
        attemptCount: 5,
        lastAttemptAt: attemptedAt,
        sentAt: null,
        deliveredAt: null,
        failedAt: attemptedAt,
        providerMessageId: 'provider_final_1',
        providerStatus: '550',
        lastErrorCode: 'BOUNCE',
        lastErrorMessage: 'Mailbox unavailable.',
      }),
    )

    const result = await completeDeliveryAttempt({
      kind: 'FINAL_FAILURE',
      deliveryId: 'delivery_1',
      leaseToken: 'lease_token_1',
      attemptedAt,
      code: 'BOUNCE',
      message: 'Mailbox unavailable.',
      providerMessageId: 'provider_final_1',
      providerStatus: '550',
      responseMeta: {
        classification: 'hard_bounce',
      },
    })

    expect(mockTx.notificationDelivery.update).toHaveBeenCalledWith({
      where: {
        id: 'delivery_1',
      },
      data: {
        status: NotificationDeliveryStatus.FAILED_FINAL,
        attemptCount: 5,
        lastAttemptAt: attemptedAt,
        providerMessageId: 'provider_final_1',
        providerStatus: '550',
        lastErrorCode: 'BOUNCE',
        lastErrorMessage: 'Mailbox unavailable.',
        failedAt: attemptedAt,
        claimedAt: null,
        leaseExpiresAt: null,
        leaseToken: null,
      },
    })

    expect(mockTx.notificationDeliveryEvent.createMany).toHaveBeenCalledWith({
      data: [
        {
          deliveryId: 'delivery_1',
          attemptNumber: 5,
          type: NotificationDeliveryEventType.FAILED,
          fromStatus: NotificationDeliveryStatus.PENDING,
          toStatus: NotificationDeliveryStatus.FAILED_FINAL,
          providerStatus: '550',
          providerMessageId: 'provider_final_1',
          errorCode: 'BOUNCE',
          errorMessage: 'Mailbox unavailable.',
          message: 'Delivery attempt failed permanently.',
          payload: {
            classification: 'hard_bounce',
          },
          createdAt: attemptedAt,
        },
      ],
    })

    expect(result.delivery).toMatchObject({
      id: 'delivery_1',
      status: NotificationDeliveryStatus.FAILED_FINAL,
      attemptCount: 5,
      failedAt: attemptedAt,
    })
  })

  it('writes Prisma.JsonNull payload when responseMeta is explicitly null', async () => {
    const attemptedAt = new Date('2026-04-09T12:00:00.000Z')

    mockTx.notificationDelivery.findFirst.mockResolvedValue(
      makeOwnedDelivery({
        status: NotificationDeliveryStatus.PENDING,
        attemptCount: 0,
        maxAttempts: 5,
        leaseToken: 'lease_token_1',
      }),
    )

    mockTx.notificationDelivery.update.mockResolvedValue(undefined)
    mockTx.notificationDeliveryEvent.createMany.mockResolvedValue({ count: 1 })
    mockTx.notificationDelivery.findUnique.mockResolvedValue(
      makeCompletedDelivery({
        status: NotificationDeliveryStatus.SENT,
        attemptCount: 1,
        lastAttemptAt: attemptedAt,
        sentAt: attemptedAt,
      }),
    )

    await completeDeliveryAttempt({
      kind: 'SUCCESS',
      deliveryId: 'delivery_1',
      leaseToken: 'lease_token_1',
      attemptedAt,
      responseMeta: null,
    })

    expect(mockTx.notificationDeliveryEvent.createMany).toHaveBeenCalledWith({
      data: [
        {
          deliveryId: 'delivery_1',
          attemptNumber: 1,
          type: NotificationDeliveryEventType.PROVIDER_ACCEPTED,
          fromStatus: NotificationDeliveryStatus.PENDING,
          toStatus: NotificationDeliveryStatus.SENT,
          providerStatus: null,
          providerMessageId: null,
          message: 'Provider accepted the delivery attempt.',
          payload: Prisma.JsonNull,
          createdAt: attemptedAt,
        },
      ],
    })
  })

  it('throws when lease ownership cannot be proven', async () => {
    mockTx.notificationDelivery.findFirst.mockResolvedValue(null)

    await expect(
      completeDeliveryAttempt({
        kind: 'SUCCESS',
        deliveryId: 'delivery_1',
        leaseToken: 'wrong_token',
        attemptedAt: new Date('2026-04-09T12:00:00.000Z'),
      }),
    ).rejects.toThrow(
      'completeDeliveryAttempt: delivery not owned by active lease',
    )

    expect(mockTx.notificationDelivery.update).not.toHaveBeenCalled()
    expect(mockTx.notificationDeliveryEvent.createMany).not.toHaveBeenCalled()
  })

  it('throws when retryable failure would exceed remaining maxAttempts', async () => {
    mockTx.notificationDelivery.findFirst.mockResolvedValue(
      makeOwnedDelivery({
        status: NotificationDeliveryStatus.PENDING,
        attemptCount: 4,
        maxAttempts: 5,
        leaseToken: 'lease_token_1',
      }),
    )

    await expect(
      completeDeliveryAttempt({
        kind: 'RETRYABLE_FAILURE',
        deliveryId: 'delivery_1',
        leaseToken: 'lease_token_1',
        attemptedAt: new Date('2026-04-09T12:00:00.000Z'),
        nextAttemptAt: new Date('2026-04-09T12:05:00.000Z'),
        code: 'TEMPORARY',
        message: 'Temporary issue.',
      }),
    ).rejects.toThrow(
      'completeDeliveryAttempt: retryable failure exceeds remaining maxAttempts',
    )

    expect(mockTx.notificationDelivery.update).not.toHaveBeenCalled()
  })

  it('throws when retryable nextAttemptAt is not after attemptedAt', async () => {
    const attemptedAt = new Date('2026-04-09T12:00:00.000Z')

    mockTx.notificationDelivery.findFirst.mockResolvedValue(
      makeOwnedDelivery({
        status: NotificationDeliveryStatus.PENDING,
        attemptCount: 1,
        maxAttempts: 5,
        leaseToken: 'lease_token_1',
      }),
    )

    await expect(
      completeDeliveryAttempt({
        kind: 'RETRYABLE_FAILURE',
        deliveryId: 'delivery_1',
        leaseToken: 'lease_token_1',
        attemptedAt,
        nextAttemptAt: attemptedAt,
        code: 'TEMPORARY',
        message: 'Temporary issue.',
      }),
    ).rejects.toThrow(
      'completeDeliveryAttempt: nextAttemptAt must be after attemptedAt',
    )

    expect(mockTx.notificationDelivery.update).not.toHaveBeenCalled()
  })

  it('throws for blank deliveryId', async () => {
    await expect(
      completeDeliveryAttempt({
        kind: 'SUCCESS',
        deliveryId: '   ',
        leaseToken: 'lease_token_1',
      }),
    ).rejects.toThrow('completeDeliveryAttempt: missing deliveryId')
  })

  it('throws for blank leaseToken', async () => {
    await expect(
      completeDeliveryAttempt({
        kind: 'SUCCESS',
        deliveryId: 'delivery_1',
        leaseToken: '   ',
      }),
    ).rejects.toThrow('completeDeliveryAttempt: missing leaseToken')
  })

  it('throws for invalid attemptedAt', async () => {
    await expect(
      completeDeliveryAttempt({
        kind: 'SUCCESS',
        deliveryId: 'delivery_1',
        leaseToken: 'lease_token_1',
        attemptedAt: new Date('invalid'),
      }),
    ).rejects.toThrow('completeDeliveryAttempt: invalid attemptedAt')
  })

  it('throws for invalid deliveredAt', async () => {
    mockTx.notificationDelivery.findFirst.mockResolvedValue(
      makeOwnedDelivery({
        leaseToken: 'lease_token_1',
      }),
    )

    await expect(
      completeDeliveryAttempt({
        kind: 'SUCCESS',
        deliveryId: 'delivery_1',
        leaseToken: 'lease_token_1',
        attemptedAt: new Date('2026-04-09T12:00:00.000Z'),
        deliveredAt: new Date('invalid'),
      }),
    ).rejects.toThrow('completeDeliveryAttempt: invalid deliveredAt')
  })

  it('throws for invalid nextAttemptAt before transaction work continues', async () => {
    await expect(
      completeDeliveryAttempt({
        kind: 'RETRYABLE_FAILURE',
        deliveryId: 'delivery_1',
        leaseToken: 'lease_token_1',
        nextAttemptAt: new Date('invalid'),
        code: 'TEMPORARY',
        message: 'Temporary issue.',
      }),
    ).rejects.toThrow('completeDeliveryAttempt: invalid nextAttemptAt')

    expect(mockPrisma.$transaction).not.toHaveBeenCalled()
  })
})