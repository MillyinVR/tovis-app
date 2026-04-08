import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  NotificationChannel,
  NotificationEventKey,
  NotificationPriority,
  NotificationProvider,
  NotificationRecipientKind,
  type NotificationDeliveryStatus,
} from '@prisma/client'

import { EmailDeliveryProvider } from './sendEmail'
import { InAppDeliveryProvider } from './sendInApp'
import { SmsDeliveryProvider } from './sendSms'

const mockClaimDeliveries = vi.hoisted(() => vi.fn())
const mockCompleteDeliveryAttempt = vi.hoisted(() => vi.fn())

vi.mock('./claimDeliveries', () => ({
  claimDeliveries: mockClaimDeliveries,
}))

vi.mock('./completeDeliveryAttempt', () => ({
  completeDeliveryAttempt: mockCompleteDeliveryAttempt,
}))

import { processDueDeliveries } from './processDueDeliveries'

function makeClaimedDelivery(
  args: Partial<{
    id: string
    channel: NotificationChannel
    provider: NotificationProvider
    destination: string | null
    templateKey: string
    templateVersion: number
    attemptCount: number
    maxAttempts: number
    leaseToken: string | null
    status: NotificationDeliveryStatus
    eventKey: NotificationEventKey
  }> = {},
) {
  const now = new Date('2026-04-09T12:00:00.000Z')

  return {
    id: args.id ?? 'delivery_1',
    channel: args.channel ?? NotificationChannel.IN_APP,
    provider: args.provider ?? NotificationProvider.INTERNAL_REALTIME,
    status: args.status ?? 'PENDING',
    destination: args.destination ?? 'client_1',
    templateKey: args.templateKey ?? 'booking_confirmed',
    templateVersion: args.templateVersion ?? 1,
    attemptCount: args.attemptCount ?? 0,
    maxAttempts: args.maxAttempts ?? 3,
    nextAttemptAt: now,
    lastAttemptAt: null,
    claimedAt: now,
    leaseExpiresAt: new Date(now.getTime() + 60_000),
    leaseToken: args.leaseToken === undefined ? 'lease_token_1' : args.leaseToken,
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
      eventKey: args.eventKey ?? NotificationEventKey.BOOKING_CONFIRMED,
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
      title: 'Appointment confirmed',
      body: 'Your appointment is confirmed.',
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

function makeResponse(args: {
  ok: boolean
  status: number
  text: string
}): Response {
  return {
    ok: args.ok,
    status: args.status,
    text: vi.fn().mockResolvedValue(args.text),
  } as unknown as Response
}

function makeProviders() {
  const inApp = new InAppDeliveryProvider({
    publish: vi.fn().mockResolvedValue({
      accepted: true,
      providerMessageId: 'default_in_app_msg',
      providerStatus: 'accepted',
      responseMeta: {
        source: 'sendInApp',
      },
    }),
  })

  const sms = new SmsDeliveryProvider({
    client: {
      messages: {
        create: vi.fn().mockResolvedValue({
          to: '+15551234567',
          body: 'default sms body',
          status: 'queued',
          sid: 'default_sms_sid',
        }),
      },
    },
  })

  const email = new EmailDeliveryProvider({
    apiToken: 'postmark-token',
    fromEmail: 'hello@tovis.com',
    fetchImpl: vi.fn().mockResolvedValue(
      makeResponse({
        ok: true,
        status: 200,
        text: JSON.stringify({
          ErrorCode: 0,
          MessageID: 'default_email_msg',
          SubmittedAt: '2026-04-09T12:00:00Z',
          To: 'client@example.com',
        }),
      }),
    ),
  })

  const inAppSend = vi.spyOn(inApp, 'send')
  const smsSend = vi.spyOn(sms, 'send')
  const emailSend = vi.spyOn(email, 'send')

  return {
    providers: {
      inApp,
      sms,
      email,
    },
    inAppSend,
    smsSend,
    emailSend,
  }
}

describe('lib/notifications/delivery/processDueDeliveries', () => {
  beforeEach(() => {
    mockClaimDeliveries.mockReset()
    mockCompleteDeliveryAttempt.mockReset()
    mockCompleteDeliveryAttempt.mockResolvedValue(undefined)
  })

  it('processes a successful in-app delivery', async () => {
    const now = new Date('2026-04-09T12:00:00.000Z')
    const { providers, inAppSend, smsSend, emailSend } = makeProviders()

    mockClaimDeliveries.mockResolvedValue({
      now,
      claimedAt: now,
      leaseExpiresAt: new Date(now.getTime() + 60_000),
      deliveries: [
        makeClaimedDelivery({
          id: 'delivery_in_app_1',
          channel: NotificationChannel.IN_APP,
          provider: NotificationProvider.INTERNAL_REALTIME,
          destination: 'client_1',
          attemptCount: 0,
          maxAttempts: 3,
        }),
      ],
    })

    inAppSend.mockResolvedValue({
      ok: true,
      providerMessageId: 'realtime_msg_1',
      providerStatus: 'accepted',
      responseMeta: {
        source: 'sendInApp',
      },
    })

    const result = await processDueDeliveries({
      providers,
      claim: {
        now,
        batchSize: 10,
      },
    })

    expect(mockClaimDeliveries).toHaveBeenCalledWith({
      now,
      batchSize: 10,
    })

    expect(inAppSend).toHaveBeenCalledTimes(1)
    expect(smsSend).not.toHaveBeenCalled()
    expect(emailSend).not.toHaveBeenCalled()

    expect(mockCompleteDeliveryAttempt).toHaveBeenCalledWith({
      kind: 'SUCCESS',
      deliveryId: 'delivery_in_app_1',
      leaseToken: 'lease_token_1',
      attemptedAt: now,
      providerMessageId: 'realtime_msg_1',
      providerStatus: 'accepted',
      responseMeta: {
        source: 'sendInApp',
      },
    })

    expect(result).toEqual({
      claimedCount: 1,
      processedCount: 1,
      sentCount: 1,
      retryScheduledCount: 0,
      finalFailureCount: 0,
      orchestrationErrorCount: 0,
      outcomes: [
        {
          deliveryId: 'delivery_in_app_1',
          provider: NotificationProvider.INTERNAL_REALTIME,
          channel: NotificationChannel.IN_APP,
          result: 'SENT',
        },
      ],
    })
  })

  it('processes a successful sms delivery through the sms provider', async () => {
    const now = new Date('2026-04-09T12:00:00.000Z')
    const { providers, inAppSend, smsSend, emailSend } = makeProviders()

    mockClaimDeliveries.mockResolvedValue({
      now,
      claimedAt: now,
      leaseExpiresAt: new Date(now.getTime() + 60_000),
      deliveries: [
        makeClaimedDelivery({
          id: 'delivery_sms_1',
          channel: NotificationChannel.SMS,
          provider: NotificationProvider.TWILIO,
          destination: '+15551234567',
          templateKey: 'booking_confirmed',
          attemptCount: 0,
          maxAttempts: 5,
        }),
      ],
    })

    smsSend.mockResolvedValue({
      ok: true,
      providerMessageId: 'SM123',
      providerStatus: 'queued',
      responseMeta: {
        source: 'sendSms',
      },
    })

    const result = await processDueDeliveries({
      providers,
      claim: { now },
    })

    expect(inAppSend).not.toHaveBeenCalled()
    expect(smsSend).toHaveBeenCalledTimes(1)
    expect(emailSend).not.toHaveBeenCalled()

    expect(mockCompleteDeliveryAttempt).toHaveBeenCalledWith({
      kind: 'SUCCESS',
      deliveryId: 'delivery_sms_1',
      leaseToken: 'lease_token_1',
      attemptedAt: now,
      providerMessageId: 'SM123',
      providerStatus: 'queued',
      responseMeta: {
        source: 'sendSms',
      },
    })

    expect(result).toEqual({
      claimedCount: 1,
      processedCount: 1,
      sentCount: 1,
      retryScheduledCount: 0,
      finalFailureCount: 0,
      orchestrationErrorCount: 0,
      outcomes: [
        {
          deliveryId: 'delivery_sms_1',
          provider: NotificationProvider.TWILIO,
          channel: NotificationChannel.SMS,
          result: 'SENT',
        },
      ],
    })
  })

  it('schedules a retryable failure with backoff', async () => {
    const now = new Date('2026-04-09T12:00:00.000Z')
    const { providers, smsSend } = makeProviders()

    mockClaimDeliveries.mockResolvedValue({
      now,
      claimedAt: now,
      leaseExpiresAt: new Date(now.getTime() + 60_000),
      deliveries: [
        makeClaimedDelivery({
          id: 'delivery_sms_retry',
          channel: NotificationChannel.SMS,
          provider: NotificationProvider.TWILIO,
          destination: '+15551234567',
          templateKey: 'booking_confirmed',
          attemptCount: 1,
          maxAttempts: 5,
        }),
      ],
    })

    smsSend.mockResolvedValue({
      ok: false,
      retryable: true,
      code: 'SMS_PROVIDER_ERROR',
      message: 'twilio timeout',
      providerStatus: 'error',
      responseMeta: {
        source: 'sendSms',
      },
    })

    const result = await processDueDeliveries({
      providers,
      claim: { now },
    })

    const expectedNextAttemptAt = new Date(now.getTime() + 5 * 60_000)

    expect(mockCompleteDeliveryAttempt).toHaveBeenCalledWith({
      kind: 'RETRYABLE_FAILURE',
      deliveryId: 'delivery_sms_retry',
      leaseToken: 'lease_token_1',
      attemptedAt: now,
      nextAttemptAt: expectedNextAttemptAt,
      code: 'SMS_PROVIDER_ERROR',
      message: 'twilio timeout',
      providerStatus: 'error',
      responseMeta: {
        source: 'sendSms',
      },
    })

    expect(result).toEqual({
      claimedCount: 1,
      processedCount: 1,
      sentCount: 0,
      retryScheduledCount: 1,
      finalFailureCount: 0,
      orchestrationErrorCount: 0,
      outcomes: [
        {
          deliveryId: 'delivery_sms_retry',
          provider: NotificationProvider.TWILIO,
          channel: NotificationChannel.SMS,
          result: 'RETRY_SCHEDULED',
          nextAttemptAt: expectedNextAttemptAt,
        },
      ],
    })
  })

  it('marks final failure when retryable send has no attempts remaining', async () => {
    const now = new Date('2026-04-09T12:00:00.000Z')
    const { providers, emailSend } = makeProviders()

    mockClaimDeliveries.mockResolvedValue({
      now,
      claimedAt: now,
      leaseExpiresAt: new Date(now.getTime() + 60_000),
      deliveries: [
        makeClaimedDelivery({
          id: 'delivery_email_final',
          channel: NotificationChannel.EMAIL,
          provider: NotificationProvider.POSTMARK,
          destination: 'client@example.com',
          templateKey: 'booking_confirmed',
          attemptCount: 5,
          maxAttempts: 6,
        }),
      ],
    })

    emailSend.mockResolvedValue({
      ok: false,
      retryable: true,
      code: 'POSTMARK_HTTP_429',
      message: 'Rate limited',
      providerStatus: 'http_429',
      responseMeta: {
        source: 'sendEmail',
      },
    })

    const result = await processDueDeliveries({
      providers,
      claim: { now },
    })

    expect(mockCompleteDeliveryAttempt).toHaveBeenCalledWith({
      kind: 'FINAL_FAILURE',
      deliveryId: 'delivery_email_final',
      leaseToken: 'lease_token_1',
      attemptedAt: now,
      code: 'POSTMARK_HTTP_429',
      message: 'Rate limited',
      providerStatus: 'http_429',
      responseMeta: {
        source: 'sendEmail',
      },
    })

    expect(result).toEqual({
      claimedCount: 1,
      processedCount: 1,
      sentCount: 0,
      retryScheduledCount: 0,
      finalFailureCount: 1,
      orchestrationErrorCount: 0,
      outcomes: [
        {
          deliveryId: 'delivery_email_final',
          provider: NotificationProvider.POSTMARK,
          channel: NotificationChannel.EMAIL,
          result: 'FAILED_FINAL',
        },
      ],
    })
  })

  it('marks final failure on non-retryable send result', async () => {
    const now = new Date('2026-04-09T12:00:00.000Z')
    const { providers, emailSend } = makeProviders()

    mockClaimDeliveries.mockResolvedValue({
      now,
      claimedAt: now,
      leaseExpiresAt: new Date(now.getTime() + 60_000),
      deliveries: [
        makeClaimedDelivery({
          id: 'delivery_email_invalid',
          channel: NotificationChannel.EMAIL,
          provider: NotificationProvider.POSTMARK,
          destination: 'client@example.com',
          templateKey: 'booking_confirmed',
          attemptCount: 0,
          maxAttempts: 6,
        }),
      ],
    })

    emailSend.mockResolvedValue({
      ok: false,
      retryable: false,
      code: 'EMAIL_REQUEST_INVALID',
      message: 'sendEmail: missing content.subject',
      providerStatus: 'invalid_request',
      responseMeta: {
        source: 'sendEmail',
      },
    })

    const result = await processDueDeliveries({
      providers,
      claim: { now },
    })

    expect(mockCompleteDeliveryAttempt).toHaveBeenCalledWith({
      kind: 'FINAL_FAILURE',
      deliveryId: 'delivery_email_invalid',
      leaseToken: 'lease_token_1',
      attemptedAt: now,
      code: 'EMAIL_REQUEST_INVALID',
      message: 'sendEmail: missing content.subject',
      providerStatus: 'invalid_request',
      responseMeta: {
        source: 'sendEmail',
      },
    })

    expect(result).toEqual({
      claimedCount: 1,
      processedCount: 1,
      sentCount: 0,
      retryScheduledCount: 0,
      finalFailureCount: 1,
      orchestrationErrorCount: 0,
      outcomes: [
        {
          deliveryId: 'delivery_email_invalid',
          provider: NotificationProvider.POSTMARK,
          channel: NotificationChannel.EMAIL,
          result: 'FAILED_FINAL',
        },
      ],
    })
  })

  it('marks orchestration error when provider send throws', async () => {
    const now = new Date('2026-04-09T12:00:00.000Z')
    const { providers, inAppSend } = makeProviders()

    mockClaimDeliveries.mockResolvedValue({
      now,
      claimedAt: now,
      leaseExpiresAt: new Date(now.getTime() + 60_000),
      deliveries: [
        makeClaimedDelivery({
          id: 'delivery_throw_1',
          channel: NotificationChannel.IN_APP,
          provider: NotificationProvider.INTERNAL_REALTIME,
          destination: 'client_1',
          templateKey: 'booking_confirmed',
        }),
      ],
    })

    inAppSend.mockRejectedValue(new Error('redis offline'))

    const result = await processDueDeliveries({
      providers,
      claim: { now },
    })

    expect(mockCompleteDeliveryAttempt).toHaveBeenCalledWith({
      kind: 'FINAL_FAILURE',
      deliveryId: 'delivery_throw_1',
      leaseToken: 'lease_token_1',
      attemptedAt: now,
      code: 'DELIVERY_ORCHESTRATION_ERROR',
      message: 'redis offline',
      providerStatus: 'orchestration_error',
      responseMeta: {
        source: 'processDueDeliveries',
        provider: NotificationProvider.INTERNAL_REALTIME,
        channel: NotificationChannel.IN_APP,
      },
    })

    expect(result).toEqual({
      claimedCount: 1,
      processedCount: 1,
      sentCount: 0,
      retryScheduledCount: 0,
      finalFailureCount: 0,
      orchestrationErrorCount: 1,
      outcomes: [
        {
          deliveryId: 'delivery_throw_1',
          provider: NotificationProvider.INTERNAL_REALTIME,
          channel: NotificationChannel.IN_APP,
          result: 'ORCHESTRATION_ERROR',
          message: 'redis offline',
        },
      ],
    })
  })

  it('returns orchestration error when claimed delivery is missing leaseToken', async () => {
    const now = new Date('2026-04-09T12:00:00.000Z')
    const { providers, inAppSend, smsSend, emailSend } = makeProviders()

    mockClaimDeliveries.mockResolvedValue({
      now,
      claimedAt: now,
      leaseExpiresAt: new Date(now.getTime() + 60_000),
      deliveries: [
        makeClaimedDelivery({
          id: 'delivery_missing_lease',
          leaseToken: null,
          channel: NotificationChannel.SMS,
          provider: NotificationProvider.TWILIO,
          destination: '+15551234567',
          templateKey: 'booking_confirmed',
        }),
      ],
    })

    const result = await processDueDeliveries({
      providers,
      claim: { now },
    })

    expect(inAppSend).not.toHaveBeenCalled()
    expect(smsSend).not.toHaveBeenCalled()
    expect(emailSend).not.toHaveBeenCalled()
    expect(mockCompleteDeliveryAttempt).not.toHaveBeenCalled()

    expect(result).toEqual({
      claimedCount: 1,
      processedCount: 1,
      sentCount: 0,
      retryScheduledCount: 0,
      finalFailureCount: 0,
      orchestrationErrorCount: 1,
      outcomes: [
        {
          deliveryId: 'delivery_missing_lease',
          provider: NotificationProvider.TWILIO,
          channel: NotificationChannel.SMS,
          result: 'ORCHESTRATION_ERROR',
          message:
            'Claimed delivery is missing leaseToken. Delivery could not be finalized because lease ownership is required.',
        },
      ],
    })
  })

  it('marks orchestration error and finalizes when delivery templateKey mismatches the event definition', async () => {
    const now = new Date('2026-04-09T12:00:00.000Z')
    const { providers, inAppSend } = makeProviders()

    mockClaimDeliveries.mockResolvedValue({
      now,
      claimedAt: now,
      leaseExpiresAt: new Date(now.getTime() + 60_000),
      deliveries: [
        makeClaimedDelivery({
          id: 'delivery_bad_template',
          templateKey: 'totally_invalid_template_key',
          channel: NotificationChannel.IN_APP,
          provider: NotificationProvider.INTERNAL_REALTIME,
          destination: 'client_1',
          eventKey: NotificationEventKey.BOOKING_CONFIRMED,
        }),
      ],
    })

    const result = await processDueDeliveries({
      providers,
      claim: { now },
    })

    expect(inAppSend).not.toHaveBeenCalled()

    expect(mockCompleteDeliveryAttempt).toHaveBeenCalledWith({
      kind: 'FINAL_FAILURE',
      deliveryId: 'delivery_bad_template',
      leaseToken: 'lease_token_1',
      attemptedAt: now,
      code: 'DELIVERY_ORCHESTRATION_ERROR',
      message:
        'processDueDeliveries: delivery templateKey totally_invalid_template_key does not match event BOOKING_CONFIRMED (booking_confirmed)',
      providerStatus: 'orchestration_error',
      responseMeta: {
        source: 'processDueDeliveries',
        provider: NotificationProvider.INTERNAL_REALTIME,
        channel: NotificationChannel.IN_APP,
      },
    })

    expect(result).toEqual({
      claimedCount: 1,
      processedCount: 1,
      sentCount: 0,
      retryScheduledCount: 0,
      finalFailureCount: 0,
      orchestrationErrorCount: 1,
      outcomes: [
        {
          deliveryId: 'delivery_bad_template',
          provider: NotificationProvider.INTERNAL_REALTIME,
          channel: NotificationChannel.IN_APP,
          result: 'ORCHESTRATION_ERROR',
          message:
            'processDueDeliveries: delivery templateKey totally_invalid_template_key does not match event BOOKING_CONFIRMED (booking_confirmed)',
        },
      ],
    })
  })

  it('appends finalization failure detail to the orchestration error message', async () => {
    const now = new Date('2026-04-09T12:00:00.000Z')
    const { providers, inAppSend } = makeProviders()

    mockClaimDeliveries.mockResolvedValue({
      now,
      claimedAt: now,
      leaseExpiresAt: new Date(now.getTime() + 60_000),
      deliveries: [
        makeClaimedDelivery({
          id: 'delivery_finalize_fail',
          channel: NotificationChannel.IN_APP,
          provider: NotificationProvider.INTERNAL_REALTIME,
          destination: 'client_1',
          templateKey: 'booking_confirmed',
        }),
      ],
    })

    inAppSend.mockRejectedValue(new Error('redis offline'))
    mockCompleteDeliveryAttempt.mockRejectedValueOnce(
      new Error('db finalize failed'),
    )

    const result = await processDueDeliveries({
      providers,
      claim: { now },
    })

    expect(result).toEqual({
      claimedCount: 1,
      processedCount: 1,
      sentCount: 0,
      retryScheduledCount: 0,
      finalFailureCount: 0,
      orchestrationErrorCount: 1,
      outcomes: [
        {
          deliveryId: 'delivery_finalize_fail',
          provider: NotificationProvider.INTERNAL_REALTIME,
          channel: NotificationChannel.IN_APP,
          result: 'ORCHESTRATION_ERROR',
          message:
            'redis offline Finalization also failed: db finalize failed',
        },
      ],
    })
  })

  it('returns empty counts when no deliveries are claimed', async () => {
    const now = new Date('2026-04-09T12:00:00.000Z')
    const { providers } = makeProviders()

    mockClaimDeliveries.mockResolvedValue({
      now,
      claimedAt: now,
      leaseExpiresAt: new Date(now.getTime() + 60_000),
      deliveries: [],
    })

    const result = await processDueDeliveries({
      providers,
      claim: { now, batchSize: 20 },
    })

    expect(mockClaimDeliveries).toHaveBeenCalledWith({
      now,
      batchSize: 20,
    })

    expect(result).toEqual({
      claimedCount: 0,
      processedCount: 0,
      sentCount: 0,
      retryScheduledCount: 0,
      finalFailureCount: 0,
      orchestrationErrorCount: 0,
      outcomes: [],
    })
  })

  it('throws for invalid now', async () => {
    const { providers } = makeProviders()

    await expect(
      processDueDeliveries({
        providers,
        claim: {
          now: new Date('invalid'),
        },
      }),
    ).rejects.toThrow('processDueDeliveries: invalid now')
  })
})