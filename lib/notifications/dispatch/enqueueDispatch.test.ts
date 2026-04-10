import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  NotificationChannel,
  NotificationDeliveryStatus,
  NotificationEventKey,
  NotificationPriority,
  NotificationProvider,
  NotificationRecipientKind,
  Prisma,
} from '@prisma/client'

const mockPrisma = vi.hoisted(() => ({
  notificationDispatch: {
    findUnique: vi.fn(),
    create: vi.fn(),
  },
}))

vi.mock('@/lib/prisma', () => ({
  prisma: mockPrisma,
}))

import { enqueueDispatch } from './enqueueDispatch'

function resetMockGroup(group: Record<string, ReturnType<typeof vi.fn>>) {
  for (const fn of Object.values(group)) {
    fn.mockReset()
  }
}

function makeUniqueConstraintError() {
  return new Prisma.PrismaClientKnownRequestError(
    'Unique constraint failed',
    {
      code: 'P2002',
      clientVersion: 'test',
    },
  )
}

function makeDelivery(args: {
  id: string
  channel: NotificationChannel
  provider: NotificationProvider
  status: NotificationDeliveryStatus
  destination: string | null
  templateKey?: string
  templateVersion?: number
  attemptCount?: number
  maxAttempts?: number
  nextAttemptAt?: Date
  suppressedAt?: Date | null
}) {
  const now = new Date('2026-04-08T12:00:00.000Z')

  return {
    id: args.id,
    channel: args.channel,
    provider: args.provider,
    status: args.status,
    destination: args.destination,
    templateKey: args.templateKey ?? 'booking_confirmed',
    templateVersion: args.templateVersion ?? 1,
    attemptCount: args.attemptCount ?? 0,
    maxAttempts: args.maxAttempts ?? 3,
    nextAttemptAt: args.nextAttemptAt ?? now,
    lastAttemptAt: null,
    claimedAt: null,
    leaseExpiresAt: null,
    providerMessageId: null,
    providerStatus: null,
    lastErrorCode: null,
    lastErrorMessage: null,
    sentAt: null,
    deliveredAt: null,
    failedAt: null,
    suppressedAt: args.suppressedAt ?? null,
    cancelledAt: null,
    createdAt: now,
    updatedAt: now,
  }
}

function makeDispatchRecord(
  overrides: Partial<{
    id: string
    sourceKey: string
    eventKey: NotificationEventKey
    recipientKind: NotificationRecipientKind
    priority: NotificationPriority
    userId: string | null
    professionalId: string | null
    clientId: string | null
    recipientInAppTargetId: string | null
    recipientPhone: string | null
    recipientEmail: string | null
    recipientTimeZone: string | null
    notificationId: string | null
    clientNotificationId: string | null
    title: string
    body: string
    href: string
    scheduledFor: Date
    cancelledAt: Date | null
    createdAt: Date
    updatedAt: Date
    deliveries: ReturnType<typeof makeDelivery>[]
  }> = {},
) {
  const scheduledFor =
    overrides.scheduledFor ?? new Date('2026-04-08T12:00:00.000Z')
  const createdAt =
    overrides.createdAt ?? new Date('2026-04-08T12:00:00.000Z')
  const updatedAt =
    overrides.updatedAt ?? new Date('2026-04-08T12:00:00.000Z')

  return {
    id: overrides.id ?? 'dispatch_1',
    sourceKey: overrides.sourceKey ?? 'client-notification:notif_1',
    eventKey: overrides.eventKey ?? NotificationEventKey.BOOKING_CONFIRMED,
    recipientKind: overrides.recipientKind ?? NotificationRecipientKind.CLIENT,
    priority: overrides.priority ?? NotificationPriority.NORMAL,
    userId: overrides.userId ?? 'user_1',
    professionalId: overrides.professionalId ?? null,
    clientId: overrides.clientId ?? 'client_1',
    recipientInAppTargetId: overrides.recipientInAppTargetId ?? 'client_1',
    recipientPhone: overrides.recipientPhone ?? '+15551234567',
    recipientEmail: overrides.recipientEmail ?? 'client@example.com',
    recipientTimeZone:
      overrides.recipientTimeZone ?? 'America/Los_Angeles',
    notificationId: overrides.notificationId ?? null,
    clientNotificationId: overrides.clientNotificationId ?? 'notif_1',
    title: overrides.title ?? 'Appointment confirmed',
    body: overrides.body ?? 'Your appointment has been confirmed.',
    href: overrides.href ?? '/client/bookings/booking_1',
    scheduledFor,
    cancelledAt: overrides.cancelledAt ?? null,
    createdAt,
    updatedAt,
    deliveries:
      overrides.deliveries ??
      [
        makeDelivery({
          id: 'delivery_in_app',
          channel: NotificationChannel.IN_APP,
          provider: NotificationProvider.INTERNAL_REALTIME,
          status: NotificationDeliveryStatus.PENDING,
          destination: 'client_1',
          maxAttempts: 3,
          nextAttemptAt: scheduledFor,
        }),
        makeDelivery({
          id: 'delivery_sms',
          channel: NotificationChannel.SMS,
          provider: NotificationProvider.TWILIO,
          status: NotificationDeliveryStatus.PENDING,
          destination: '+15551234567',
          maxAttempts: 5,
          nextAttemptAt: scheduledFor,
        }),
        makeDelivery({
          id: 'delivery_email',
          channel: NotificationChannel.EMAIL,
          provider: NotificationProvider.POSTMARK,
          status: NotificationDeliveryStatus.PENDING,
          destination: 'client@example.com',
          maxAttempts: 6,
          nextAttemptAt: scheduledFor,
        }),
      ],
  }
}

describe('lib/notifications/dispatch/enqueueDispatch', () => {
  beforeEach(() => {
    resetMockGroup(mockPrisma.notificationDispatch)
  })

  it('creates a dispatch and persists the recipient snapshot fields', async () => {
    const scheduledFor = new Date('2026-04-12T15:30:00.000Z')

    mockPrisma.notificationDispatch.findUnique.mockResolvedValue(null)
    mockPrisma.notificationDispatch.create.mockResolvedValue(
      makeDispatchRecord({
        sourceKey: 'client-notification:notif_1',
        clientNotificationId: 'notif_1',
        scheduledFor,
      }),
    )

    const result = await enqueueDispatch({
      key: NotificationEventKey.BOOKING_CONFIRMED,
      sourceKey: 'client-notification:notif_1',
      recipient: {
        kind: NotificationRecipientKind.CLIENT,
        clientId: 'client_1',
        userId: 'user_1',
        inAppTargetId: 'client_1',
        phone: '+15551234567',
        phoneVerifiedAt: new Date('2026-04-08T11:00:00.000Z'),
        email: 'client@example.com',
        emailVerifiedAt: new Date('2026-04-08T11:30:00.000Z'),
        timeZone: 'America/Los_Angeles',
        preference: null,
      },
      title: ' Appointment confirmed ',
      body: ' Your appointment has been confirmed. ',
      href: ' /client/bookings/booking_1 ',
      payload: {
        bookingId: 'booking_1',
      },
      scheduledFor,
      clientNotificationId: 'notif_1',
    })

    expect(result.created).toBe(true)
    expect(result.selectedChannels).toEqual([
      NotificationChannel.IN_APP,
      NotificationChannel.SMS,
      NotificationChannel.EMAIL,
    ])

    expect(mockPrisma.notificationDispatch.findUnique).toHaveBeenCalledWith({
      where: {
        sourceKey: 'client-notification:notif_1',
      },
      select: expect.objectContaining({
        id: true,
        sourceKey: true,
        recipientInAppTargetId: true,
        recipientPhone: true,
        recipientEmail: true,
        recipientTimeZone: true,
        deliveries: expect.any(Object),
      }),
    })

    expect(mockPrisma.notificationDispatch.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        sourceKey: 'client-notification:notif_1',
        eventKey: NotificationEventKey.BOOKING_CONFIRMED,
        recipientKind: NotificationRecipientKind.CLIENT,
        priority: NotificationPriority.NORMAL,
        recipientInAppTargetId: 'client_1',
        recipientPhone: '+15551234567',
        recipientEmail: 'client@example.com',
        recipientTimeZone: 'America/Los_Angeles',
        title: 'Appointment confirmed',
        body: 'Your appointment has been confirmed.',
        href: '/client/bookings/booking_1',
        scheduledFor,
        payload: {
          bookingId: 'booking_1',
        },
        user: {
          connect: {
            id: 'user_1',
          },
        },
        client: {
          connect: {
            id: 'client_1',
          },
        },
        clientNotification: {
          connect: {
            id: 'notif_1',
          },
        },
        deliveries: {
          create: expect.arrayContaining([
            expect.objectContaining({
              channel: NotificationChannel.IN_APP,
              provider: NotificationProvider.INTERNAL_REALTIME,
              status: NotificationDeliveryStatus.PENDING,
              destination: 'client_1',
              templateKey: 'booking_confirmed',
              templateVersion: 1,
              attemptCount: 0,
              maxAttempts: 3,
              nextAttemptAt: scheduledFor,
              events: {
                create: [
                  expect.objectContaining({
                    type: 'CREATED',
                    toStatus: NotificationDeliveryStatus.PENDING,
                    message: 'Delivery row enqueued.',
                  }),
                ],
              },
            }),
            expect.objectContaining({
              channel: NotificationChannel.SMS,
              provider: NotificationProvider.TWILIO,
              status: NotificationDeliveryStatus.PENDING,
              destination: '+15551234567',
              templateKey: 'booking_confirmed',
              templateVersion: 1,
              attemptCount: 0,
              maxAttempts: 5,
              nextAttemptAt: scheduledFor,
            }),
            expect.objectContaining({
              channel: NotificationChannel.EMAIL,
              provider: NotificationProvider.POSTMARK,
              status: NotificationDeliveryStatus.PENDING,
              destination: 'client@example.com',
              templateKey: 'booking_confirmed',
              templateVersion: 1,
              attemptCount: 0,
              maxAttempts: 6,
              nextAttemptAt: scheduledFor,
            }),
          ]),
        },
      }),
      select: expect.any(Object),
    })

    expect(result.dispatch).toMatchObject({
      sourceKey: 'client-notification:notif_1',
      recipientInAppTargetId: 'client_1',
      recipientPhone: '+15551234567',
      recipientEmail: 'client@example.com',
      recipientTimeZone: 'America/Los_Angeles',
      clientNotificationId: 'notif_1',
    })
  })

  it('returns the existing dispatch unchanged when sourceKey already exists', async () => {
    const existing = makeDispatchRecord({
      id: 'dispatch_existing',
      sourceKey: 'client-notification:notif_existing',
      clientNotificationId: 'notif_existing',
    })

    mockPrisma.notificationDispatch.findUnique.mockResolvedValue(existing)

    const result = await enqueueDispatch({
      key: NotificationEventKey.BOOKING_CONFIRMED,
      sourceKey: 'client-notification:notif_existing',
      recipient: {
        kind: NotificationRecipientKind.CLIENT,
        clientId: 'client_1',
        userId: 'user_1',
        inAppTargetId: 'client_1',
        phone: '+15551234567',
        phoneVerifiedAt: new Date('2026-04-08T11:00:00.000Z'),
        email: 'client@example.com',
        emailVerifiedAt: new Date('2026-04-08T11:30:00.000Z'),
        timeZone: 'America/Los_Angeles',
        preference: null,
      },
      title: 'Appointment confirmed',
      body: 'Your appointment has been confirmed.',
      href: '/client/bookings/booking_1',
      clientNotificationId: 'notif_existing',
    })

    expect(result.created).toBe(false)
    expect(result.dispatch).toEqual(existing)
    expect(mockPrisma.notificationDispatch.create).not.toHaveBeenCalled()
  })

  it('returns the existing dispatch after a create race on sourceKey', async () => {
    const raced = makeDispatchRecord({
      id: 'dispatch_raced',
      sourceKey: 'client-notification:notif_raced',
      clientNotificationId: 'notif_raced',
    })

    mockPrisma.notificationDispatch.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(raced)

    mockPrisma.notificationDispatch.create.mockRejectedValueOnce(
      makeUniqueConstraintError(),
    )

    const result = await enqueueDispatch({
      key: NotificationEventKey.BOOKING_CONFIRMED,
      sourceKey: 'client-notification:notif_raced',
      recipient: {
        kind: NotificationRecipientKind.CLIENT,
        clientId: 'client_1',
        userId: 'user_1',
        inAppTargetId: 'client_1',
        phone: '+15551234567',
        phoneVerifiedAt: new Date('2026-04-08T11:00:00.000Z'),
        email: 'client@example.com',
        emailVerifiedAt: new Date('2026-04-08T11:30:00.000Z'),
        timeZone: 'America/Los_Angeles',
        preference: null,
      },
      title: 'Appointment confirmed',
      body: 'Your appointment has been confirmed.',
      href: '/client/bookings/booking_1',
      clientNotificationId: 'notif_raced',
    })

    expect(result.created).toBe(false)
    expect(result.dispatch).toEqual(raced)
    expect(mockPrisma.notificationDispatch.create).toHaveBeenCalledTimes(1)
    expect(mockPrisma.notificationDispatch.findUnique).toHaveBeenCalledTimes(2)
  })

  it('creates suppressed delivery rows when a requested channel lacks capability', async () => {
    const scheduledFor = new Date('2026-04-12T15:30:00.000Z')

    mockPrisma.notificationDispatch.findUnique.mockResolvedValue(null)
    mockPrisma.notificationDispatch.create.mockResolvedValue(
      makeDispatchRecord({
        sourceKey: 'client-notification:notif_sms_missing',
        clientNotificationId: 'notif_sms_missing',
        recipientPhone: null,
        deliveries: [
          makeDelivery({
            id: 'delivery_in_app_suppressed',
            channel: NotificationChannel.IN_APP,
            provider: NotificationProvider.INTERNAL_REALTIME,
            status: NotificationDeliveryStatus.SUPPRESSED,
            destination: 'client_1',
            maxAttempts: 3,
            nextAttemptAt: scheduledFor,
            suppressedAt: new Date('2026-04-08T12:00:00.000Z'),
          }),
          makeDelivery({
            id: 'delivery_sms_suppressed',
            channel: NotificationChannel.SMS,
            provider: NotificationProvider.TWILIO,
            status: NotificationDeliveryStatus.SUPPRESSED,
            destination: null,
            maxAttempts: 5,
            nextAttemptAt: scheduledFor,
            suppressedAt: new Date('2026-04-08T12:00:00.000Z'),
          }),
          makeDelivery({
            id: 'delivery_email_suppressed',
            channel: NotificationChannel.EMAIL,
            provider: NotificationProvider.POSTMARK,
            status: NotificationDeliveryStatus.SUPPRESSED,
            destination: 'client@example.com',
            maxAttempts: 6,
            nextAttemptAt: scheduledFor,
            suppressedAt: new Date('2026-04-08T12:00:00.000Z'),
          }),
        ],
      }),
    )

    const result = await enqueueDispatch({
      key: NotificationEventKey.BOOKING_CONFIRMED,
      sourceKey: 'client-notification:notif_sms_missing',
      recipient: {
        kind: NotificationRecipientKind.CLIENT,
        clientId: 'client_1',
        userId: 'user_1',
        inAppTargetId: 'client_1',
        phone: null,
        phoneVerifiedAt: null,
        email: 'client@example.com',
        emailVerifiedAt: new Date('2026-04-08T11:30:00.000Z'),
        timeZone: 'America/Los_Angeles',
        preference: null,
      },
      title: 'Appointment confirmed',
      body: 'Your appointment has been confirmed.',
      href: '/client/bookings/booking_1',
      requestedChannels: [NotificationChannel.SMS],
      scheduledFor,
      clientNotificationId: 'notif_sms_missing',
    })

    expect(result.created).toBe(true)
    expect(result.selectedChannels).toEqual([])

    expect(mockPrisma.notificationDispatch.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        recipientPhone: null,
        deliveries: {
          create: expect.arrayContaining([
            expect.objectContaining({
              channel: NotificationChannel.IN_APP,
              provider: NotificationProvider.INTERNAL_REALTIME,
              status: NotificationDeliveryStatus.SUPPRESSED,
              destination: 'client_1',
              maxAttempts: 3,
              nextAttemptAt: scheduledFor,
              suppressedAt: expect.any(Date),
              events: {
                create: [
                  expect.objectContaining({
                    type: 'CREATED',
                    toStatus: NotificationDeliveryStatus.SUPPRESSED,
                  }),
                  expect.objectContaining({
                    type: 'SUPPRESSED',
                    toStatus: NotificationDeliveryStatus.SUPPRESSED,
                    message:
                      'Delivery suppressed at enqueue: CHANNEL_NOT_REQUESTED',
                    payload: {
                      source: 'enqueueDispatch',
                      suppressionReason: 'CHANNEL_NOT_REQUESTED',
                    },
                  }),
                ],
              },
            }),
            expect.objectContaining({
              channel: NotificationChannel.SMS,
              provider: NotificationProvider.TWILIO,
              status: NotificationDeliveryStatus.SUPPRESSED,
              destination: null,
              maxAttempts: 5,
              nextAttemptAt: scheduledFor,
              suppressedAt: expect.any(Date),
              events: {
                create: [
                  expect.objectContaining({
                    type: 'CREATED',
                    toStatus: NotificationDeliveryStatus.SUPPRESSED,
                  }),
                  expect.objectContaining({
                    type: 'SUPPRESSED',
                    toStatus: NotificationDeliveryStatus.SUPPRESSED,
                    message:
                      'Delivery suppressed at enqueue: MISSING_SMS_DESTINATION',
                    payload: {
                      source: 'enqueueDispatch',
                      suppressionReason: 'MISSING_SMS_DESTINATION',
                    },
                  }),
                ],
              },
            }),
            expect.objectContaining({
              channel: NotificationChannel.EMAIL,
              provider: NotificationProvider.POSTMARK,
              status: NotificationDeliveryStatus.SUPPRESSED,
              destination: 'client@example.com',
              maxAttempts: 6,
              nextAttemptAt: scheduledFor,
              suppressedAt: expect.any(Date),
              events: {
                create: [
                  expect.objectContaining({
                    type: 'CREATED',
                    toStatus: NotificationDeliveryStatus.SUPPRESSED,
                  }),
                  expect.objectContaining({
                    type: 'SUPPRESSED',
                    toStatus: NotificationDeliveryStatus.SUPPRESSED,
                    message:
                      'Delivery suppressed at enqueue: CHANNEL_NOT_REQUESTED',
                    payload: {
                      source: 'enqueueDispatch',
                      suppressionReason: 'CHANNEL_NOT_REQUESTED',
                    },
                  }),
                ],
              },
            }),
          ]),
        },
      }),
      select: expect.any(Object),
    })
  })

  it('suppresses EMAIL when the address exists but email ownership is not verified', async () => {
    const scheduledFor = new Date('2026-04-12T15:30:00.000Z')

    mockPrisma.notificationDispatch.findUnique.mockResolvedValue(null)
    mockPrisma.notificationDispatch.create.mockResolvedValue(
      makeDispatchRecord({
        sourceKey: 'client-notification:notif_email_unverified',
        clientNotificationId: 'notif_email_unverified',
        deliveries: [
          makeDelivery({
            id: 'delivery_in_app_ok',
            channel: NotificationChannel.IN_APP,
            provider: NotificationProvider.INTERNAL_REALTIME,
            status: NotificationDeliveryStatus.PENDING,
            destination: 'client_1',
            maxAttempts: 3,
            nextAttemptAt: scheduledFor,
          }),
          makeDelivery({
            id: 'delivery_sms_ok',
            channel: NotificationChannel.SMS,
            provider: NotificationProvider.TWILIO,
            status: NotificationDeliveryStatus.PENDING,
            destination: '+15551234567',
            maxAttempts: 5,
            nextAttemptAt: scheduledFor,
          }),
          makeDelivery({
            id: 'delivery_email_suppressed_unverified',
            channel: NotificationChannel.EMAIL,
            provider: NotificationProvider.POSTMARK,
            status: NotificationDeliveryStatus.SUPPRESSED,
            destination: null,
            maxAttempts: 6,
            nextAttemptAt: scheduledFor,
            suppressedAt: new Date('2026-04-08T12:00:00.000Z'),
          }),
        ],
      }),
    )

    const result = await enqueueDispatch({
      key: NotificationEventKey.BOOKING_CONFIRMED,
      sourceKey: 'client-notification:notif_email_unverified',
      recipient: {
        kind: NotificationRecipientKind.CLIENT,
        clientId: 'client_1',
        userId: 'user_1',
        inAppTargetId: 'client_1',
        phone: '+15551234567',
        phoneVerifiedAt: new Date('2026-04-08T11:00:00.000Z'),
        email: 'client@example.com',
        emailVerifiedAt: null,
        timeZone: 'America/Los_Angeles',
        preference: null,
      },
      title: 'Appointment confirmed',
      body: 'Your appointment has been confirmed.',
      href: '/client/bookings/booking_1',
      scheduledFor,
      clientNotificationId: 'notif_email_unverified',
    })

    expect(result.created).toBe(true)
    expect(result.selectedChannels).toEqual([
      NotificationChannel.IN_APP,
      NotificationChannel.SMS,
    ])

    expect(mockPrisma.notificationDispatch.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        recipientEmail: 'client@example.com',
        deliveries: {
          create: expect.arrayContaining([
            expect.objectContaining({
              channel: NotificationChannel.IN_APP,
              status: NotificationDeliveryStatus.PENDING,
              destination: 'client_1',
            }),
            expect.objectContaining({
              channel: NotificationChannel.SMS,
              status: NotificationDeliveryStatus.PENDING,
              destination: '+15551234567',
            }),
            expect.objectContaining({
              channel: NotificationChannel.EMAIL,
              provider: NotificationProvider.POSTMARK,
              status: NotificationDeliveryStatus.SUPPRESSED,
              destination: null,
              suppressedAt: expect.any(Date),
              events: {
                create: [
                  expect.objectContaining({
                    type: 'CREATED',
                    toStatus: NotificationDeliveryStatus.SUPPRESSED,
                  }),
                  expect.objectContaining({
                    type: 'SUPPRESSED',
                    toStatus: NotificationDeliveryStatus.SUPPRESSED,
                    message:
                      'Delivery suppressed at enqueue: MISSING_EMAIL_DESTINATION',
                    payload: {
                      source: 'enqueueDispatch',
                      suppressionReason: 'MISSING_EMAIL_DESTINATION',
                    },
                  }),
                ],
              },
            }),
          ]),
        },
      }),
      select: expect.any(Object),
    })
  })
})