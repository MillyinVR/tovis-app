import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
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
  deviceToken: {
    findMany: vi.fn(),
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
    templateKey: args.templateKey ?? 'consultation_proposal_sent',
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
    eventKey: overrides.eventKey ?? NotificationEventKey.CONSULTATION_PROPOSAL_SENT,
    recipientKind: overrides.recipientKind ?? NotificationRecipientKind.CLIENT,
    priority: overrides.priority ?? NotificationPriority.NORMAL,
    userId: 'userId' in overrides ? overrides.userId! : 'user_1',
    professionalId:
      'professionalId' in overrides ? overrides.professionalId! : null,
    clientId: 'clientId' in overrides ? overrides.clientId! : 'client_1',
    recipientInAppTargetId:
      'recipientInAppTargetId' in overrides
        ? overrides.recipientInAppTargetId!
        : 'client_1',
    recipientPhone:
      'recipientPhone' in overrides ? overrides.recipientPhone! : '+15551234567',
    recipientEmail:
      'recipientEmail' in overrides
        ? overrides.recipientEmail!
        : 'client@example.com',
    recipientTimeZone:
      'recipientTimeZone' in overrides
        ? overrides.recipientTimeZone!
        : 'America/Los_Angeles',
    notificationId:
      'notificationId' in overrides ? overrides.notificationId! : null,
    clientNotificationId:
      'clientNotificationId' in overrides
        ? overrides.clientNotificationId!
        : 'notif_1',
    title: overrides.title ?? 'Appointment confirmed',
    body: overrides.body ?? 'Your appointment has been confirmed.',
    href: overrides.href ?? '/client/bookings/booking_1',
    scheduledFor,
    cancelledAt: 'cancelledAt' in overrides ? overrides.cancelledAt! : null,
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
          templateKey: 'consultation_proposal_sent',
          maxAttempts: 3,
          nextAttemptAt: scheduledFor,
        }),
        makeDelivery({
          id: 'delivery_sms',
          channel: NotificationChannel.SMS,
          provider: NotificationProvider.TWILIO,
          status: NotificationDeliveryStatus.PENDING,
          destination: '+15551234567',
          templateKey: 'consultation_proposal_sent',
          maxAttempts: 5,
          nextAttemptAt: scheduledFor,
        }),
        makeDelivery({
          id: 'delivery_email',
          channel: NotificationChannel.EMAIL,
          provider: NotificationProvider.POSTMARK,
          status: NotificationDeliveryStatus.PENDING,
          destination: 'client@example.com',
          templateKey: 'consultation_proposal_sent',
          maxAttempts: 6,
          nextAttemptAt: scheduledFor,
        }),
      ],
  }
}

describe('lib/notifications/dispatch/enqueueDispatch', () => {
  beforeEach(() => {
    resetMockGroup(mockPrisma.notificationDispatch)
    resetMockGroup(mockPrisma.deviceToken)
    // Default: no active device tokens (push fan-out only runs when configured).
    mockPrisma.deviceToken.findMany.mockResolvedValue([])

    // SMS dispatch is gated on a configured Twilio provider. Configure one so the
    // existing default-channel assertions (which include SMS) hold; the dedicated
    // "no Twilio provider" case below clears these to assert SMS suppression.
    process.env.TWILIO_ACCOUNT_SID = 'AC_test'
    process.env.TWILIO_AUTH_TOKEN = 'token_test'
    process.env.TWILIO_NOTIFICATION_FROM_NUMBER = '+15550000000'
  })

  afterEach(() => {
    delete process.env.TWILIO_ACCOUNT_SID
    delete process.env.TWILIO_AUTH_TOKEN
    delete process.env.TWILIO_NOTIFICATION_FROM_NUMBER
  })

  it('creates a dispatch and persists the normalized recipient snapshot fields', async () => {
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
      key: NotificationEventKey.CONSULTATION_PROPOSAL_SENT,
      sourceKey: 'client-notification:notif_1',
      recipient: {
        kind: NotificationRecipientKind.CLIENT,
        clientId: 'client_1',
        userId: 'user_1',
        inAppTargetId: 'client_1',
        phone: '+15551234567',
        phoneVerifiedAt: new Date('2026-04-08T11:00:00.000Z'),
        transactionalSmsConsentAt: new Date('2026-04-08T11:00:00.000Z'),
        email: 'client@example.com',
        emailVerifiedAt: new Date('2026-04-08T11:30:00.000Z'),
        timeZone: ' America/Los_Angeles ',
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
        eventKey: NotificationEventKey.CONSULTATION_PROPOSAL_SENT,
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
              templateKey: 'consultation_proposal_sent',
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
              templateKey: 'consultation_proposal_sent',
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
              templateKey: 'consultation_proposal_sent',
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

  it('suppresses SMS when no Twilio provider is configured (launch gate)', async () => {
    delete process.env.TWILIO_ACCOUNT_SID
    delete process.env.TWILIO_AUTH_TOKEN
    delete process.env.TWILIO_NOTIFICATION_FROM_NUMBER

    const scheduledFor = new Date('2026-04-12T15:30:00.000Z')

    mockPrisma.notificationDispatch.findUnique.mockResolvedValue(null)
    mockPrisma.notificationDispatch.create.mockResolvedValue(
      makeDispatchRecord({
        sourceKey: 'client-notification:notif_no_sms',
        clientNotificationId: 'notif_no_sms',
        scheduledFor,
      }),
    )

    const result = await enqueueDispatch({
      key: NotificationEventKey.CONSULTATION_PROPOSAL_SENT,
      sourceKey: 'client-notification:notif_no_sms',
      recipient: {
        kind: NotificationRecipientKind.CLIENT,
        clientId: 'client_1',
        userId: 'user_1',
        inAppTargetId: 'client_1',
        phone: '+15551234567',
        phoneVerifiedAt: new Date('2026-04-08T11:00:00.000Z'),
        // Consent present so SMS suppression here is attributable to the Twilio
        // launch gate, not the consent gate.
        transactionalSmsConsentAt: new Date('2026-04-08T11:00:00.000Z'),
        email: 'client@example.com',
        emailVerifiedAt: new Date('2026-04-08T11:30:00.000Z'),
        timeZone: 'America/Los_Angeles',
        preference: null,
      },
      title: 'Appointment confirmed',
      body: 'Your appointment has been confirmed.',
      href: '/client/bookings/booking_1',
      payload: { bookingId: 'booking_1' },
      scheduledFor,
      clientNotificationId: 'notif_no_sms',
    })

    // SMS dropped from selection even though the phone is verified.
    expect(result.selectedChannels).toEqual([
      NotificationChannel.IN_APP,
      NotificationChannel.EMAIL,
    ])

    const smsEvaluation = result.evaluations.find(
      (evaluation) => evaluation.channel === NotificationChannel.SMS,
    )
    expect(smsEvaluation).toMatchObject({
      enabled: false,
      reason: 'MISSING_SMS_DESTINATION',
    })

    // The SMS delivery row is persisted as SUPPRESSED, not PENDING (no send).
    const createData = mockPrisma.notificationDispatch.create.mock.calls[0]?.[0]
      ?.data as { deliveries: { create: Array<{ channel: string; status: string }> } }
    const smsRow = createData.deliveries.create.find(
      (row) => row.channel === NotificationChannel.SMS,
    )
    expect(smsRow?.status).toBe(NotificationDeliveryStatus.SUPPRESSED)
  })

  it('stores recipientTimeZone as null when the provided timezone is invalid', async () => {
    const scheduledFor = new Date('2026-04-12T15:30:00.000Z')

    mockPrisma.notificationDispatch.findUnique.mockResolvedValue(null)
    mockPrisma.notificationDispatch.create.mockResolvedValue(
      makeDispatchRecord({
        sourceKey: 'client-notification:notif_invalid_tz',
        clientNotificationId: 'notif_invalid_tz',
        recipientTimeZone: null,
        scheduledFor,
      }),
    )

    const result = await enqueueDispatch({
      key: NotificationEventKey.CONSULTATION_PROPOSAL_SENT,
      sourceKey: 'client-notification:notif_invalid_tz',
      recipient: {
        kind: NotificationRecipientKind.CLIENT,
        clientId: 'client_1',
        userId: 'user_1',
        inAppTargetId: 'client_1',
        phone: '+15551234567',
        phoneVerifiedAt: new Date('2026-04-08T11:00:00.000Z'),
        email: 'client@example.com',
        emailVerifiedAt: new Date('2026-04-08T11:30:00.000Z'),
        timeZone: 'Mars/Olympus',
        preference: null,
      },
      title: 'Appointment confirmed',
      body: 'Your appointment has been confirmed.',
      href: '/client/bookings/booking_1',
      scheduledFor,
      clientNotificationId: 'notif_invalid_tz',
    })

    expect(mockPrisma.notificationDispatch.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        recipientTimeZone: null,
      }),
      select: expect.any(Object),
    })

    expect(result.dispatch.recipientTimeZone).toBeNull()
  })

  it('returns the existing dispatch unchanged when sourceKey already exists', async () => {
    const existing = makeDispatchRecord({
      id: 'dispatch_existing',
      sourceKey: 'client-notification:notif_existing',
      clientNotificationId: 'notif_existing',
    })

    mockPrisma.notificationDispatch.findUnique.mockResolvedValue(existing)

    const result = await enqueueDispatch({
      key: NotificationEventKey.CONSULTATION_PROPOSAL_SENT,
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
      key: NotificationEventKey.CONSULTATION_PROPOSAL_SENT,
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
            templateKey: 'consultation_proposal_sent',
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
            templateKey: 'consultation_proposal_sent',
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
            templateKey: 'consultation_proposal_sent',
            maxAttempts: 6,
            nextAttemptAt: scheduledFor,
            suppressedAt: new Date('2026-04-08T12:00:00.000Z'),
          }),
        ],
      }),
    )

    const result = await enqueueDispatch({
      key: NotificationEventKey.CONSULTATION_PROPOSAL_SENT,
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
              templateKey: 'consultation_proposal_sent',
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
              templateKey: 'consultation_proposal_sent',
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
              templateKey: 'consultation_proposal_sent',
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
            templateKey: 'consultation_proposal_sent',
            maxAttempts: 3,
            nextAttemptAt: scheduledFor,
          }),
          makeDelivery({
            id: 'delivery_sms_ok',
            channel: NotificationChannel.SMS,
            provider: NotificationProvider.TWILIO,
            status: NotificationDeliveryStatus.PENDING,
            destination: '+15551234567',
            templateKey: 'consultation_proposal_sent',
            maxAttempts: 5,
            nextAttemptAt: scheduledFor,
          }),
          makeDelivery({
            id: 'delivery_email_suppressed_unverified',
            channel: NotificationChannel.EMAIL,
            provider: NotificationProvider.POSTMARK,
            status: NotificationDeliveryStatus.SUPPRESSED,
            destination: null,
            templateKey: 'consultation_proposal_sent',
            maxAttempts: 6,
            nextAttemptAt: scheduledFor,
            suppressedAt: new Date('2026-04-08T12:00:00.000Z'),
          }),
        ],
      }),
    )

    const result = await enqueueDispatch({
      key: NotificationEventKey.CONSULTATION_PROPOSAL_SENT,
      sourceKey: 'client-notification:notif_email_unverified',
      recipient: {
        kind: NotificationRecipientKind.CLIENT,
        clientId: 'client_1',
        userId: 'user_1',
        inAppTargetId: 'client_1',
        phone: '+15551234567',
        phoneVerifiedAt: new Date('2026-04-08T11:00:00.000Z'),
        transactionalSmsConsentAt: new Date('2026-04-08T11:00:00.000Z'),
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
              templateKey: 'consultation_proposal_sent',
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

  describe('PUSH per-device fan-out', () => {
    const APNS_ENV = {
      APNS_AUTH_KEY: 'p8_key',
      APNS_KEY_ID: 'key_id',
      APNS_TEAM_ID: 'team_id',
      APNS_BUNDLE_ID: 'me.tovis.app',
    } as const

    function configureApns() {
      for (const [name, value] of Object.entries(APNS_ENV)) {
        process.env[name] = value
      }
    }

    function clearApns() {
      for (const name of Object.keys(APNS_ENV)) {
        delete process.env[name]
      }
    }

    afterEach(() => {
      clearApns()
    })

    it('does NOT create any PUSH rows or query device tokens when no push provider is configured (inert)', async () => {
      // No APNS/FCM env configured → push capability gate is off.
      const scheduledFor = new Date('2026-04-12T15:30:00.000Z')

      mockPrisma.notificationDispatch.findUnique.mockResolvedValue(null)
      mockPrisma.notificationDispatch.create.mockResolvedValue(
        makeDispatchRecord({ scheduledFor }),
      )

      const result = await enqueueDispatch({
        key: NotificationEventKey.BOOKING_CONFIRMED,
        sourceKey: 'client-notification:push_inert',
        recipient: {
          kind: NotificationRecipientKind.CLIENT,
          clientId: 'client_1',
          userId: 'user_1',
          inAppTargetId: 'client_1',
          email: 'client@example.com',
          emailVerifiedAt: new Date('2026-04-08T11:30:00.000Z'),
          timeZone: 'America/Los_Angeles',
          preference: null,
        },
        title: 'Booking confirmed',
        scheduledFor,
      })

      // Push must never even hit the DB when no provider is configured.
      expect(mockPrisma.deviceToken.findMany).not.toHaveBeenCalled()
      // BOOKING_CONFIRMED default channels for a client are in-app + email + push,
      // but with no provider configured PUSH is suppressed (not selected).
      expect(result.selectedChannels).not.toContain(NotificationChannel.PUSH)

      const createArg = mockPrisma.notificationDispatch.create.mock.calls[0]?.[0]
      const createdDeliveries =
        createArg?.data?.deliveries?.create ?? []
      const pushRows = createdDeliveries.filter(
        (row: { channel: NotificationChannel }) =>
          row.channel === NotificationChannel.PUSH,
      )
      // A single suppressed PUSH row (null destination) is fine; what matters is
      // there is NO sendable (PENDING) PUSH row.
      const pendingPushRows = pushRows.filter(
        (row: { status: NotificationDeliveryStatus }) =>
          row.status === NotificationDeliveryStatus.PENDING,
      )
      expect(pendingPushRows).toHaveLength(0)
    })

    it('fans PUSH out to one row per active device token with the per-device provider', async () => {
      configureApns()

      const scheduledFor = new Date('2026-04-12T15:30:00.000Z')

      mockPrisma.deviceToken.findMany.mockResolvedValue([
        { platform: 'IOS', token: 'apns_token_a' },
        { platform: 'ANDROID', token: 'fcm_token_b' },
        { platform: 'IOS', token: 'apns_token_c' },
      ])

      mockPrisma.notificationDispatch.findUnique.mockResolvedValue(null)
      mockPrisma.notificationDispatch.create.mockResolvedValue(
        makeDispatchRecord({ scheduledFor }),
      )

      const result = await enqueueDispatch({
        key: NotificationEventKey.BOOKING_CONFIRMED,
        sourceKey: 'client-notification:push_fanout',
        recipient: {
          kind: NotificationRecipientKind.CLIENT,
          clientId: 'client_1',
          userId: 'user_1',
          inAppTargetId: 'client_1',
          email: 'client@example.com',
          emailVerifiedAt: new Date('2026-04-08T11:30:00.000Z'),
          timeZone: 'America/Los_Angeles',
          preference: null,
        },
        title: 'Booking confirmed',
        href: '/client/bookings/booking_1',
        scheduledFor,
      })

      // Device tokens are queried for the recipient user, active only.
      expect(mockPrisma.deviceToken.findMany).toHaveBeenCalledWith({
        where: { userId: 'user_1', isActive: true },
        select: { platform: true, token: true },
      })

      expect(result.selectedChannels).toContain(NotificationChannel.PUSH)

      const createArg = mockPrisma.notificationDispatch.create.mock.calls[0]?.[0]
      const createdDeliveries: Array<{
        channel: NotificationChannel
        provider: NotificationProvider
        destination: string | null
        status: NotificationDeliveryStatus
        maxAttempts: number
      }> = createArg?.data?.deliveries?.create ?? []

      const pushRows = createdDeliveries.filter(
        (row) => row.channel === NotificationChannel.PUSH,
      )

      // One PUSH row per active token, each PENDING with the token as destination.
      expect(pushRows).toHaveLength(3)
      expect(
        pushRows.map((row) => ({
          destination: row.destination,
          provider: row.provider,
          status: row.status,
          maxAttempts: row.maxAttempts,
        })),
      ).toEqual([
        {
          destination: 'apns_token_a',
          provider: NotificationProvider.APNS,
          status: NotificationDeliveryStatus.PENDING,
          maxAttempts: 4,
        },
        {
          destination: 'fcm_token_b',
          provider: NotificationProvider.FCM,
          status: NotificationDeliveryStatus.PENDING,
          maxAttempts: 4,
        },
        {
          destination: 'apns_token_c',
          provider: NotificationProvider.APNS,
          status: NotificationDeliveryStatus.PENDING,
          maxAttempts: 4,
        },
      ])
    })

    it('suppresses PUSH (no PENDING rows) when the provider is configured but the user has no active tokens', async () => {
      configureApns()

      const scheduledFor = new Date('2026-04-12T15:30:00.000Z')

      mockPrisma.deviceToken.findMany.mockResolvedValue([])
      mockPrisma.notificationDispatch.findUnique.mockResolvedValue(null)
      mockPrisma.notificationDispatch.create.mockResolvedValue(
        makeDispatchRecord({ scheduledFor }),
      )

      const result = await enqueueDispatch({
        key: NotificationEventKey.BOOKING_CONFIRMED,
        sourceKey: 'client-notification:push_no_tokens',
        recipient: {
          kind: NotificationRecipientKind.CLIENT,
          clientId: 'client_1',
          userId: 'user_1',
          inAppTargetId: 'client_1',
          email: 'client@example.com',
          emailVerifiedAt: new Date('2026-04-08T11:30:00.000Z'),
          timeZone: 'America/Los_Angeles',
          preference: null,
        },
        title: 'Booking confirmed',
        scheduledFor,
      })

      expect(mockPrisma.deviceToken.findMany).toHaveBeenCalledTimes(1)
      expect(result.selectedChannels).not.toContain(NotificationChannel.PUSH)

      const createArg = mockPrisma.notificationDispatch.create.mock.calls[0]?.[0]
      const createdDeliveries: Array<{
        channel: NotificationChannel
        status: NotificationDeliveryStatus
        destination: string | null
      }> = createArg?.data?.deliveries?.create ?? []

      const pendingPushRows = createdDeliveries.filter(
        (row) =>
          row.channel === NotificationChannel.PUSH &&
          row.status === NotificationDeliveryStatus.PENDING,
      )
      expect(pendingPushRows).toHaveLength(0)
    })
  })
})