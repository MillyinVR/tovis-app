import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  NotificationChannel,
  NotificationDeliveryEventType,
  NotificationDeliveryStatus,
  NotificationEventKey,
  NotificationPriority,
  NotificationProvider,
  NotificationRecipientKind,
} from '@prisma/client'

const mockTransaction = vi.hoisted(() => ({
  notificationDelivery: {
    findMany: vi.fn(),
    updateMany: vi.fn(),
  },
  notificationDeliveryEvent: {
    create: vi.fn(),
  },
  clientNotificationPreference: {
    findUnique: vi.fn(),
  },
  professionalNotificationPreference: {
    findUnique: vi.fn(),
  },
}))

const mockPrisma = vi.hoisted(() => ({
  $transaction: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: mockPrisma,
}))

import { claimDeliveries } from './claimDeliveries'

function resetMockGroup(group: Record<string, ReturnType<typeof vi.fn>>) {
  for (const fn of Object.values(group)) {
    fn.mockReset()
  }
}

function getProviderForChannel(
  channel: NotificationChannel,
): NotificationProvider {
  if (channel === NotificationChannel.IN_APP) {
    return NotificationProvider.INTERNAL_REALTIME
  }

  if (channel === NotificationChannel.SMS) {
    return NotificationProvider.TWILIO
  }

  return NotificationProvider.POSTMARK
}

function makeRuntimePolicyCandidate(args: {
  id: string
  channel?: NotificationChannel
  recipientKind?: NotificationRecipientKind
  clientId?: string | null
  professionalId?: string | null
  recipientTimeZone?: string | null
  eventKey?: NotificationEventKey
  nextAttemptAt?: Date
}) {
  const now = args.nextAttemptAt ?? new Date('2026-04-09T12:00:00.000Z')

  return {
    id: args.id,
    channel: args.channel ?? NotificationChannel.SMS,
    status: NotificationDeliveryStatus.PENDING,
    nextAttemptAt: now,
    lastAttemptAt: null,
    claimedAt: null,
    leaseExpiresAt: null,
    leaseToken: null,
    createdAt: now,
    dispatch: {
      id: `dispatch_${args.id}`,
      eventKey: args.eventKey ?? NotificationEventKey.APPOINTMENT_REMINDER,
      recipientKind: args.recipientKind ?? NotificationRecipientKind.CLIENT,
      professionalId: args.professionalId ?? null,
      clientId: args.clientId ?? 'client_1',
      recipientTimeZone: args.recipientTimeZone ?? 'America/Los_Angeles',
      cancelledAt: null,
    },
  }
}

function makeClaimedDelivery(args: {
  id: string
  leaseToken: string
  channel?: NotificationChannel
  eventKey?: NotificationEventKey
  recipientKind?: NotificationRecipientKind
  professionalId?: string | null
  clientId?: string | null
  recipientTimeZone?: string | null
  nextAttemptAt?: Date
  claimedAt?: Date
  leaseExpiresAt?: Date
}) {
  const channel = args.channel ?? NotificationChannel.SMS
  const now = new Date('2026-04-09T12:00:00.000Z')
  const claimedAt = args.claimedAt ?? now
  const leaseExpiresAt =
    args.leaseExpiresAt ?? new Date(claimedAt.getTime() + 60_000)

  return {
    id: args.id,
    channel,
    provider: getProviderForChannel(channel),
    status: NotificationDeliveryStatus.PENDING,
    destination:
      channel === NotificationChannel.IN_APP
        ? 'target_1'
        : channel === NotificationChannel.SMS
          ? '+15551234567'
          : 'client@example.com',
    templateKey:
      args.eventKey === NotificationEventKey.BOOKING_REQUEST_CREATED
        ? 'booking_request_created'
        : 'appointment_reminder',
    templateVersion: 1,
    attemptCount: 0,
    maxAttempts: channel === NotificationChannel.IN_APP ? 3 : 5,
    nextAttemptAt: args.nextAttemptAt ?? now,
    lastAttemptAt: null,
    claimedAt,
    leaseExpiresAt,
    leaseToken: args.leaseToken,
    providerMessageId: null,
    providerStatus: null,
    lastErrorCode: null,
    lastErrorMessage: null,
    sentAt: null,
    deliveredAt: null,
    failedAt: null,
    suppressedAt: null,
    cancelledAt: null,
    createdAt: now,
    updatedAt: now,
    dispatch: {
      id: 'dispatch_1',
      sourceKey: 'client-notification:notif_1',
      eventKey: args.eventKey ?? NotificationEventKey.APPOINTMENT_REMINDER,
      recipientKind: args.recipientKind ?? NotificationRecipientKind.CLIENT,
      priority: NotificationPriority.NORMAL,
      userId: 'user_1',
      professionalId: args.professionalId ?? null,
      clientId: args.clientId ?? 'client_1',
      recipientInAppTargetId: 'target_1',
      recipientPhone: '+15551234567',
      recipientEmail: 'client@example.com',
      recipientTimeZone: args.recipientTimeZone ?? 'America/Los_Angeles',
      notificationId: null,
      clientNotificationId: 'notif_1',
      title: 'Notification title',
      body: 'Notification body',
      href: '/client/bookings/booking_1',
      payload: {
        bookingId: 'booking_1',
      },
      scheduledFor: now,
      cancelledAt: null,
      createdAt: now,
      updatedAt: now,
    },
  }
}

describe('lib/notifications/delivery/claimDeliveries', () => {
  beforeEach(() => {
    resetMockGroup(mockTransaction.notificationDelivery)
    resetMockGroup(mockTransaction.notificationDeliveryEvent)
    resetMockGroup(mockTransaction.clientNotificationPreference)
    resetMockGroup(mockTransaction.professionalNotificationPreference)
    mockPrisma.$transaction.mockReset()

    mockPrisma.$transaction.mockImplementation(async (callback) =>
      callback(mockTransaction),
    )

    mockTransaction.clientNotificationPreference.findUnique.mockResolvedValue(
      null,
    )
    mockTransaction.professionalNotificationPreference.findUnique.mockResolvedValue(
      null,
    )
  })

  it('claims due deliveries and stamps lease fields plus CLAIMED events', async () => {
    const now = new Date('2026-04-09T12:00:00.000Z')

    mockTransaction.notificationDelivery.findMany
      .mockResolvedValueOnce([
        makeRuntimePolicyCandidate({ id: 'delivery_1' }),
        makeRuntimePolicyCandidate({ id: 'delivery_2' }),
      ])
      .mockResolvedValueOnce([
        makeClaimedDelivery({
          id: 'delivery_1',
          leaseToken: 'token_1',
          claimedAt: now,
          leaseExpiresAt: new Date(now.getTime() + 60_000),
        }),
        makeClaimedDelivery({
          id: 'delivery_2',
          leaseToken: 'token_2',
          claimedAt: now,
          leaseExpiresAt: new Date(now.getTime() + 60_000),
        }),
      ])

    mockTransaction.notificationDelivery.updateMany
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 1 })

    mockTransaction.notificationDeliveryEvent.create
      .mockResolvedValueOnce({ id: 'event_1' })
      .mockResolvedValueOnce({ id: 'event_2' })

    const result = await claimDeliveries({
      now,
      batchSize: 2,
      leaseMs: 60_000,
    })

    expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1)

    expect(
      mockTransaction.notificationDelivery.findMany,
    ).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        where: {
          status: NotificationDeliveryStatus.PENDING,
          cancelledAt: null,
          suppressedAt: null,
          failedAt: null,
          sentAt: null,
          deliveredAt: null,
          nextAttemptAt: {
            lte: now,
          },
          OR: [
            { claimedAt: null },
            { leaseExpiresAt: null },
            { leaseExpiresAt: { lte: now } },
          ],
          dispatch: {
            cancelledAt: null,
          },
        },
        orderBy: [
          { nextAttemptAt: 'asc' },
          { createdAt: 'asc' },
          { id: 'asc' },
        ],
        take: 2,
      }),
    )

    expect(mockTransaction.notificationDelivery.updateMany).toHaveBeenCalledTimes(
      2,
    )
    expect(mockTransaction.notificationDeliveryEvent.create).toHaveBeenCalledTimes(
      2,
    )

    const firstUpdate =
      mockTransaction.notificationDelivery.updateMany.mock.calls[0][0]
    const secondUpdate =
      mockTransaction.notificationDelivery.updateMany.mock.calls[1][0]

    expect(firstUpdate.where.id).toBe('delivery_1')
    expect(secondUpdate.where.id).toBe('delivery_2')

    for (const call of [firstUpdate, secondUpdate]) {
      expect(call.where).toMatchObject({
        status: NotificationDeliveryStatus.PENDING,
        cancelledAt: null,
        suppressedAt: null,
        failedAt: null,
        sentAt: null,
        deliveredAt: null,
        nextAttemptAt: { lte: now },
        dispatch: { cancelledAt: null },
      })

      expect(call.data.claimedAt).toEqual(now)
      expect(call.data.leaseExpiresAt).toEqual(
        new Date(now.getTime() + 60_000),
      )
      expect(typeof call.data.leaseToken).toBe('string')
      expect(call.data.leaseToken.length).toBeGreaterThan(0)
    }

    expect(
      mockTransaction.notificationDeliveryEvent.create.mock.calls[0][0],
    ).toEqual({
      data: {
        type: NotificationDeliveryEventType.CLAIMED,
        fromStatus: NotificationDeliveryStatus.PENDING,
        toStatus: NotificationDeliveryStatus.PENDING,
        message: 'Delivery claimed for worker processing.',
        payload: {
          source: 'claimDeliveries',
          claimedAt: now.toISOString(),
          leaseExpiresAt: new Date(now.getTime() + 60_000).toISOString(),
          leaseToken: firstUpdate.data.leaseToken,
        },
        delivery: {
          connect: {
            id: 'delivery_1',
          },
        },
      },
    })

    expect(
      mockTransaction.notificationDeliveryEvent.create.mock.calls[1][0],
    ).toEqual({
      data: {
        type: NotificationDeliveryEventType.CLAIMED,
        fromStatus: NotificationDeliveryStatus.PENDING,
        toStatus: NotificationDeliveryStatus.PENDING,
        message: 'Delivery claimed for worker processing.',
        payload: {
          source: 'claimDeliveries',
          claimedAt: now.toISOString(),
          leaseExpiresAt: new Date(now.getTime() + 60_000).toISOString(),
          leaseToken: secondUpdate.data.leaseToken,
        },
        delivery: {
          connect: {
            id: 'delivery_2',
          },
        },
      },
    })

    expect(
      mockTransaction.notificationDelivery.findMany,
    ).toHaveBeenNthCalledWith(2, {
      where: {
        id: {
          in: ['delivery_1', 'delivery_2'],
        },
      },
      orderBy: [
        { nextAttemptAt: 'asc' },
        { createdAt: 'asc' },
        { id: 'asc' },
      ],
      select: expect.any(Object),
    })

    expect(result).toEqual({
      now,
      claimedAt: now,
      leaseExpiresAt: new Date(now.getTime() + 60_000),
      deliveries: expect.arrayContaining([
        expect.objectContaining({ id: 'delivery_1' }),
        expect.objectContaining({ id: 'delivery_2' }),
      ]),
    })
  })

  it('returns no deliveries when no candidates are due', async () => {
    const now = new Date('2026-04-09T12:00:00.000Z')

    mockTransaction.notificationDelivery.findMany.mockResolvedValueOnce([])

    const result = await claimDeliveries({ now })

    expect(mockTransaction.notificationDelivery.findMany).toHaveBeenCalledTimes(
      1,
    )
    expect(mockTransaction.notificationDelivery.updateMany).not.toHaveBeenCalled()
    expect(
      mockTransaction.notificationDeliveryEvent.create,
    ).not.toHaveBeenCalled()

    expect(result).toEqual({
      now,
      claimedAt: now,
      leaseExpiresAt: new Date(now.getTime() + 60_000),
      deliveries: [],
    })
  })

  it('returns no deliveries when candidates are raced away before guarded updates succeed', async () => {
    const now = new Date('2026-04-09T12:00:00.000Z')

    mockTransaction.notificationDelivery.findMany
      .mockResolvedValueOnce([
        makeRuntimePolicyCandidate({ id: 'delivery_1' }),
        makeRuntimePolicyCandidate({ id: 'delivery_2' }),
      ])
      .mockResolvedValueOnce([])

    mockTransaction.notificationDelivery.updateMany
      .mockResolvedValueOnce({ count: 0 })
      .mockResolvedValueOnce({ count: 0 })

    const result = await claimDeliveries({
      now,
      batchSize: 2,
    })

    expect(mockTransaction.notificationDelivery.updateMany).toHaveBeenCalledTimes(
      2,
    )
    expect(mockTransaction.notificationDelivery.findMany).toHaveBeenCalledTimes(
      2,
    )
    expect(
      mockTransaction.notificationDeliveryEvent.create,
    ).not.toHaveBeenCalled()

    expect(result).toEqual({
      now,
      claimedAt: now,
      leaseExpiresAt: new Date(now.getTime() + 60_000),
      deliveries: [],
    })
  })

  it('returns only successfully claimed deliveries when some candidates race and some do not', async () => {
    const now = new Date('2026-04-09T12:00:00.000Z')

    mockTransaction.notificationDelivery.findMany
      .mockResolvedValueOnce([
        makeRuntimePolicyCandidate({ id: 'delivery_1' }),
        makeRuntimePolicyCandidate({ id: 'delivery_2' }),
        makeRuntimePolicyCandidate({ id: 'delivery_3' }),
      ])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        makeClaimedDelivery({
          id: 'delivery_1',
          leaseToken: 'token_1',
          claimedAt: now,
        }),
        makeClaimedDelivery({
          id: 'delivery_3',
          leaseToken: 'token_3',
          claimedAt: now,
        }),
      ])

    mockTransaction.notificationDelivery.updateMany
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 0 })
      .mockResolvedValueOnce({ count: 1 })

    mockTransaction.notificationDeliveryEvent.create
      .mockResolvedValueOnce({ id: 'event_1' })
      .mockResolvedValueOnce({ id: 'event_3' })

    const result = await claimDeliveries({
      now,
      batchSize: 3,
    })

    expect(mockTransaction.notificationDelivery.findMany).toHaveBeenCalledTimes(
      3,
    )
    expect(
      mockTransaction.notificationDeliveryEvent.create,
    ).toHaveBeenCalledTimes(2)
    expect(result.deliveries.map((delivery) => delivery.id)).toEqual([
      'delivery_1',
      'delivery_3',
    ])
  })

  it('defers sms deliveries during quiet hours instead of claiming them', async () => {
    const now = new Date('2026-04-09T06:30:00.000Z') // 11:30 PM America/Los_Angeles

    mockTransaction.notificationDelivery.findMany
      .mockResolvedValueOnce([
        makeRuntimePolicyCandidate({
          id: 'delivery_quiet_1',
          channel: NotificationChannel.SMS,
          recipientKind: NotificationRecipientKind.CLIENT,
          clientId: 'client_1',
          recipientTimeZone: 'America/Los_Angeles',
          eventKey: NotificationEventKey.APPOINTMENT_REMINDER,
          nextAttemptAt: now,
        }),
      ])
      .mockResolvedValueOnce([])

    mockTransaction.clientNotificationPreference.findUnique.mockResolvedValueOnce(
      {
        id: 'pref_1',
        clientId: 'client_1',
        eventKey: NotificationEventKey.APPOINTMENT_REMINDER,
        inAppEnabled: true,
        smsEnabled: true,
        emailEnabled: true,
        quietHoursStartMinutes: 22 * 60,
        quietHoursEndMinutes: 8 * 60,
        createdAt: new Date('2026-04-01T00:00:00.000Z'),
        updatedAt: new Date('2026-04-01T00:00:00.000Z'),
      },
    )

    mockTransaction.notificationDelivery.updateMany.mockResolvedValueOnce({
      count: 1,
    })

    mockTransaction.notificationDeliveryEvent.create.mockResolvedValueOnce({
      id: 'event_quiet_1',
    })

    const result = await claimDeliveries({
      now,
      batchSize: 1,
    })

    expect(
      mockTransaction.clientNotificationPreference.findUnique,
    ).toHaveBeenCalledWith({
      where: {
        clientId_eventKey: {
          clientId: 'client_1',
          eventKey: NotificationEventKey.APPOINTMENT_REMINDER,
        },
      },
    })

    expect(
      mockTransaction.professionalNotificationPreference.findUnique,
    ).not.toHaveBeenCalled()

    expect(mockTransaction.notificationDelivery.updateMany).toHaveBeenCalledTimes(
      1,
    )

    expect(mockTransaction.notificationDelivery.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'delivery_quiet_1',
        status: NotificationDeliveryStatus.PENDING,
        cancelledAt: null,
        suppressedAt: null,
        failedAt: null,
        sentAt: null,
        deliveredAt: null,
        nextAttemptAt: {
          lte: now,
        },
        OR: [
          { claimedAt: null },
          { leaseExpiresAt: null },
          { leaseExpiresAt: { lte: now } },
        ],
        dispatch: {
          cancelledAt: null,
        },
      },
      data: {
        nextAttemptAt: new Date('2026-04-09T15:00:00.000Z'),
        claimedAt: null,
        leaseExpiresAt: null,
        leaseToken: null,
      },
    })

    expect(
      mockTransaction.notificationDeliveryEvent.create,
    ).toHaveBeenCalledTimes(1)

    expect(
      mockTransaction.notificationDeliveryEvent.create.mock.calls[0][0],
    ).toEqual({
      data: {
        type: NotificationDeliveryEventType.RETRY_SCHEDULED,
        fromStatus: NotificationDeliveryStatus.PENDING,
        toStatus: NotificationDeliveryStatus.PENDING,
        message: 'Delivery deferred due to quiet hours.',
        payload: {
          source: 'claimDeliveries',
          channel: NotificationChannel.SMS,
          deferredAt: now.toISOString(),
          nextAttemptAt: '2026-04-09T15:00:00.000Z',
          reason: 'QUIET_HOURS',
          recipientLocalMinutes: 23 * 60 + 30,
          quietHoursStartMinutes: 22 * 60,
          quietHoursEndMinutes: 8 * 60,
        },
        delivery: {
          connect: {
            id: 'delivery_quiet_1',
          },
        },
      },
    })

    expect(mockTransaction.notificationDelivery.findMany).toHaveBeenCalledTimes(
      2,
    )

    expect(result).toEqual({
      now,
      claimedAt: now,
      leaseExpiresAt: new Date(now.getTime() + 60_000),
      deliveries: [],
    })
  })

  it('claims sms deliveries during quiet hours when the event allows bypass', async () => {
    const now = new Date('2026-04-09T06:30:00.000Z') // 11:30 PM America/Los_Angeles

    mockTransaction.notificationDelivery.findMany
      .mockResolvedValueOnce([
        makeRuntimePolicyCandidate({
          id: 'delivery_bypass_1',
          channel: NotificationChannel.SMS,
          recipientKind: NotificationRecipientKind.PRO,
          professionalId: 'pro_1',
          clientId: null,
          recipientTimeZone: 'America/Los_Angeles',
          eventKey: NotificationEventKey.BOOKING_REQUEST_CREATED,
          nextAttemptAt: now,
        }),
      ])
      .mockResolvedValueOnce([
        makeClaimedDelivery({
          id: 'delivery_bypass_1',
          leaseToken: 'token_bypass_1',
          channel: NotificationChannel.SMS,
          eventKey: NotificationEventKey.BOOKING_REQUEST_CREATED,
          recipientKind: NotificationRecipientKind.PRO,
          professionalId: 'pro_1',
          clientId: null,
          recipientTimeZone: 'America/Los_Angeles',
          claimedAt: now,
          leaseExpiresAt: new Date(now.getTime() + 60_000),
        }),
      ])

    mockTransaction.professionalNotificationPreference.findUnique.mockResolvedValueOnce(
      {
        id: 'pref_pro_1',
        professionalId: 'pro_1',
        eventKey: NotificationEventKey.BOOKING_REQUEST_CREATED,
        inAppEnabled: true,
        smsEnabled: true,
        emailEnabled: true,
        quietHoursStartMinutes: 22 * 60,
        quietHoursEndMinutes: 8 * 60,
        createdAt: new Date('2026-04-01T00:00:00.000Z'),
        updatedAt: new Date('2026-04-01T00:00:00.000Z'),
      },
    )

    mockTransaction.notificationDelivery.updateMany.mockResolvedValueOnce({
      count: 1,
    })

    mockTransaction.notificationDeliveryEvent.create.mockResolvedValueOnce({
      id: 'event_bypass_1',
    })

    const result = await claimDeliveries({
      now,
      batchSize: 1,
    })

    expect(
      mockTransaction.professionalNotificationPreference.findUnique,
    ).toHaveBeenCalledWith({
      where: {
        professionalId_eventKey: {
          professionalId: 'pro_1',
          eventKey: NotificationEventKey.BOOKING_REQUEST_CREATED,
        },
      },
    })

    expect(mockTransaction.notificationDelivery.updateMany).toHaveBeenCalledTimes(
      1,
    )
    expect(
      mockTransaction.notificationDeliveryEvent.create,
    ).toHaveBeenCalledTimes(1)

    expect(
      mockTransaction.notificationDeliveryEvent.create.mock.calls[0][0].data.type,
    ).toBe(NotificationDeliveryEventType.CLAIMED)

    expect(result.deliveries.map((delivery) => delivery.id)).toEqual([
      'delivery_bypass_1',
    ])
  })

  it('continues scanning after quiet-hours deferrals so deferred rows do not starve sendable rows', async () => {
    const now = new Date('2026-04-09T06:30:00.000Z') // 11:30 PM America/Los_Angeles

    mockTransaction.notificationDelivery.findMany
      .mockResolvedValueOnce([
        makeRuntimePolicyCandidate({
          id: 'delivery_quiet_1',
          channel: NotificationChannel.SMS,
          recipientKind: NotificationRecipientKind.CLIENT,
          clientId: 'client_1',
          recipientTimeZone: 'America/Los_Angeles',
          eventKey: NotificationEventKey.APPOINTMENT_REMINDER,
          nextAttemptAt: now,
        }),
        makeRuntimePolicyCandidate({
          id: 'delivery_send_1',
          channel: NotificationChannel.IN_APP,
          recipientKind: NotificationRecipientKind.CLIENT,
          clientId: 'client_1',
          recipientTimeZone: 'America/Los_Angeles',
          eventKey: NotificationEventKey.APPOINTMENT_REMINDER,
          nextAttemptAt: now,
        }),
      ])
      .mockResolvedValueOnce([
        makeRuntimePolicyCandidate({
          id: 'delivery_send_2',
          channel: NotificationChannel.IN_APP,
          recipientKind: NotificationRecipientKind.CLIENT,
          clientId: 'client_1',
          recipientTimeZone: 'America/Los_Angeles',
          eventKey: NotificationEventKey.APPOINTMENT_REMINDER,
          nextAttemptAt: now,
        }),
      ])
      .mockResolvedValueOnce([
        makeClaimedDelivery({
          id: 'delivery_send_1',
          leaseToken: 'token_send_1',
          channel: NotificationChannel.IN_APP,
          claimedAt: now,
        }),
        makeClaimedDelivery({
          id: 'delivery_send_2',
          leaseToken: 'token_send_2',
          channel: NotificationChannel.IN_APP,
          claimedAt: now,
        }),
      ])

    mockTransaction.clientNotificationPreference.findUnique.mockResolvedValueOnce(
      {
        id: 'pref_1',
        clientId: 'client_1',
        eventKey: NotificationEventKey.APPOINTMENT_REMINDER,
        inAppEnabled: true,
        smsEnabled: true,
        emailEnabled: true,
        quietHoursStartMinutes: 22 * 60,
        quietHoursEndMinutes: 8 * 60,
        createdAt: new Date('2026-04-01T00:00:00.000Z'),
        updatedAt: new Date('2026-04-01T00:00:00.000Z'),
      },
    )

    mockTransaction.notificationDelivery.updateMany
      .mockResolvedValueOnce({ count: 1 }) // defer quiet row
      .mockResolvedValueOnce({ count: 1 }) // claim send_1
      .mockResolvedValueOnce({ count: 1 }) // claim send_2

    mockTransaction.notificationDeliveryEvent.create
      .mockResolvedValueOnce({ id: 'event_defer_1' })
      .mockResolvedValueOnce({ id: 'event_claim_1' })
      .mockResolvedValueOnce({ id: 'event_claim_2' })

    const result = await claimDeliveries({
      now,
      batchSize: 2,
    })

    expect(mockTransaction.notificationDelivery.findMany).toHaveBeenCalledTimes(
      3,
    )
    expect(mockTransaction.notificationDelivery.updateMany).toHaveBeenCalledTimes(
      3,
    )
    expect(
      mockTransaction.notificationDeliveryEvent.create,
    ).toHaveBeenCalledTimes(3)

    expect(result.deliveries.map((delivery) => delivery.id)).toEqual([
      'delivery_send_1',
      'delivery_send_2',
    ])
  })

  it('claims a previously deferred sms delivery once nextAttemptAt resumes outside quiet hours', async () => {
    const now = new Date('2026-04-09T15:00:00.000Z') // 8:00 AM America/Los_Angeles

    mockTransaction.notificationDelivery.findMany
      .mockResolvedValueOnce([
        makeRuntimePolicyCandidate({
          id: 'delivery_resumed_1',
          channel: NotificationChannel.SMS,
          recipientKind: NotificationRecipientKind.CLIENT,
          clientId: 'client_1',
          recipientTimeZone: 'America/Los_Angeles',
          eventKey: NotificationEventKey.APPOINTMENT_REMINDER,
          nextAttemptAt: now,
        }),
      ])
      .mockResolvedValueOnce([
        makeClaimedDelivery({
          id: 'delivery_resumed_1',
          leaseToken: 'token_resumed_1',
          channel: NotificationChannel.SMS,
          eventKey: NotificationEventKey.APPOINTMENT_REMINDER,
          claimedAt: now,
          nextAttemptAt: now,
          leaseExpiresAt: new Date(now.getTime() + 60_000),
        }),
      ])

    mockTransaction.clientNotificationPreference.findUnique.mockResolvedValueOnce(
      {
        id: 'pref_1',
        clientId: 'client_1',
        eventKey: NotificationEventKey.APPOINTMENT_REMINDER,
        inAppEnabled: true,
        smsEnabled: true,
        emailEnabled: true,
        quietHoursStartMinutes: 22 * 60,
        quietHoursEndMinutes: 8 * 60,
        createdAt: new Date('2026-04-01T00:00:00.000Z'),
        updatedAt: new Date('2026-04-01T00:00:00.000Z'),
      },
    )

    mockTransaction.notificationDelivery.updateMany.mockResolvedValueOnce({
      count: 1,
    })

    mockTransaction.notificationDeliveryEvent.create.mockResolvedValueOnce({
      id: 'event_resumed_1',
    })

    const result = await claimDeliveries({
      now,
      batchSize: 1,
    })

    expect(mockTransaction.notificationDelivery.updateMany).toHaveBeenCalledTimes(
      1,
    )
    expect(
      mockTransaction.notificationDeliveryEvent.create.mock.calls[0][0].data.type,
    ).toBe(NotificationDeliveryEventType.CLAIMED)
    expect(result.deliveries.map((delivery) => delivery.id)).toEqual([
      'delivery_resumed_1',
    ])
  })

  it('uses the default batch size when none is provided', async () => {
    mockTransaction.notificationDelivery.findMany.mockResolvedValueOnce([])

    await claimDeliveries()

    expect(mockTransaction.notificationDelivery.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        take: 25,
      }),
    )
  })

  it('clamps batchSize to the maximum allowed', async () => {
    mockTransaction.notificationDelivery.findMany.mockResolvedValueOnce([])

    await claimDeliveries({
      batchSize: 999,
    })

    expect(mockTransaction.notificationDelivery.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        take: 100,
      }),
    )
  })

  it('throws for invalid now', async () => {
    await expect(
      claimDeliveries({
        now: new Date('invalid'),
      }),
    ).rejects.toThrow('claimDeliveries: invalid now')
  })

  it('throws for invalid batchSize', async () => {
    await expect(
      claimDeliveries({
        batchSize: 0,
      }),
    ).rejects.toThrow('claimDeliveries: invalid batchSize')
  })

  it('throws for invalid leaseMs', async () => {
    await expect(
      claimDeliveries({
        leaseMs: 0,
      }),
    ).rejects.toThrow('claimDeliveries: invalid leaseMs')
  })
})