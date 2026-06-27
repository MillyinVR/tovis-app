import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NotificationChannel, NotificationProvider } from '@prisma/client'

const NOW = new Date('2026-04-13T18:30:00.000Z')

const mocks = vi.hoisted(() => ({
  processDueDeliveries: vi.fn(),

  createInAppDeliveryProvider: vi.fn(),
  createSmsDeliveryProvider: vi.fn(),
  createEmailDeliveryProvider: vi.fn(),

  getRedis: vi.fn(),
  redisPublish: vi.fn(),
  redisIncr: vi.fn(),

  twilioFactory: vi.fn(),
  twilioMessageCreate: vi.fn(),
}))

vi.mock('@/lib/tenant/resolveTenant', () => ({
  getRootTenantId: vi.fn(async () => 'tenant_root'),
}))

vi.mock('@/lib/notifications/delivery/processDueDeliveries', () => ({
  processDueDeliveries: mocks.processDueDeliveries,
}))

vi.mock('@/lib/notifications/delivery/sendInApp', () => ({
  createInAppDeliveryProvider: mocks.createInAppDeliveryProvider,
}))

vi.mock('@/lib/notifications/delivery/sendSms', () => ({
  createSmsDeliveryProvider: mocks.createSmsDeliveryProvider,
}))

vi.mock('@/lib/notifications/delivery/sendEmail', () => ({
  createEmailDeliveryProvider: mocks.createEmailDeliveryProvider,
}))

vi.mock('@/lib/redis', () => ({
  getRedis: mocks.getRedis,
}))

vi.mock('twilio', () => ({
  default: mocks.twilioFactory,
}))

import { drainDueNotifications } from './runNotificationDrain'

function setRequiredEnv(): void {
  process.env.TWILIO_ACCOUNT_SID = 'twilio_sid_1'
  process.env.TWILIO_AUTH_TOKEN = 'twilio_token_1'
  process.env.TWILIO_FROM_NUMBER = '+15550001111'
  process.env.POSTMARK_SERVER_TOKEN = 'postmark_token_1'
  process.env.POSTMARK_FROM_EMAIL = 'hello@example.com'
  process.env.POSTMARK_MESSAGE_STREAM = 'outbound'
}

function clearEnv(): void {
  delete process.env.TWILIO_ACCOUNT_SID
  delete process.env.TWILIO_AUTH_TOKEN
  delete process.env.TWILIO_FROM_NUMBER
  delete process.env.POSTMARK_SERVER_TOKEN
  delete process.env.POSTMARK_FROM_EMAIL
  delete process.env.POSTMARK_MESSAGE_STREAM
}

describe('lib/notifications/delivery/runNotificationDrain', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    vi.setSystemTime(NOW)

    clearEnv()
    setRequiredEnv()

    mocks.redisPublish.mockResolvedValue(2)
    mocks.redisIncr.mockResolvedValue(7)
    mocks.getRedis.mockReturnValue({
      publish: mocks.redisPublish,
      incr: mocks.redisIncr,
    })

    mocks.twilioMessageCreate.mockResolvedValue({
      to: '+15550002222',
      body: 'Reminder text',
      status: 'queued',
      sid: 'SM_1',
    })

    mocks.twilioFactory.mockReturnValue({
      messages: {
        create: mocks.twilioMessageCreate,
      },
    })

    mocks.createInAppDeliveryProvider.mockImplementation(
      (args: { publish: (envelope: Record<string, unknown>) => Promise<unknown> }) => ({
        send: vi.fn((request: Record<string, unknown>) =>
          args.publish({
            idempotencyKey: 'inapp_idem_1',
            recipientInAppTargetId: 'client_1',
            ...request,
          }),
        ),
      }),
    )

    mocks.createSmsDeliveryProvider.mockImplementation(
      (args: {
        fromNumber: string
        client: {
          messages: {
            create: (params: Record<string, unknown>) => Promise<unknown>
          }
        }
      }) => ({
        send: vi.fn((request: Record<string, unknown>) =>
          args.client.messages.create({
            from: args.fromNumber,
            to: request.to ?? '+15550002222',
            body: request.body ?? 'Reminder text',
            statusCallback: request.statusCallback,
          }),
        ),
      }),
    )

    mocks.createEmailDeliveryProvider.mockImplementation(
      (args: Record<string, unknown>) => ({
        send: vi.fn(async (request: Record<string, unknown>) => ({
          accepted: true,
          providerMessageId: 'email_1',
          providerStatus: 'sent',
          responseMeta: { args, request },
        })),
      }),
    )

    mocks.processDueDeliveries.mockResolvedValue({
      claimedCount: 0,
      sentCount: 0,
      failedCount: 0,
      skippedCount: 0,
    })
  })

  afterEach(() => {
    vi.useRealTimers()
    clearEnv()
  })

  it('builds the configured providers and drains with the clamped batch size', async () => {
    const result = await drainDueNotifications({ batchSize: 999 })

    expect(mocks.twilioFactory).toHaveBeenCalledWith(
      'twilio_sid_1',
      'twilio_token_1',
    )

    expect(mocks.createSmsDeliveryProvider).toHaveBeenCalledWith({
      fromNumber: '+15550001111',
      client: { messages: { create: expect.any(Function) } },
    })

    expect(mocks.createEmailDeliveryProvider).toHaveBeenCalledWith({
      apiToken: 'postmark_token_1',
      fromEmail: 'hello@example.com',
      messageStream: 'outbound',
    })

    expect(mocks.createInAppDeliveryProvider).toHaveBeenCalledWith({
      publish: expect.any(Function),
    })

    expect(mocks.processDueDeliveries).toHaveBeenCalledWith({
      tenantContext: { isRoot: true, tenantId: 'tenant_root', slug: 'tovis-root' },
      providers: {
        inApp: {
          provider: NotificationProvider.INTERNAL_REALTIME,
          channel: NotificationChannel.IN_APP,
          send: expect.any(Function),
        },
        sms: {
          provider: NotificationProvider.TWILIO,
          channel: NotificationChannel.SMS,
          send: expect.any(Function),
        },
        email: {
          provider: NotificationProvider.POSTMARK,
          channel: NotificationChannel.EMAIL,
          send: expect.any(Function),
        },
        // PR2a: no APNs/FCM clients yet, so the push providers are null.
        apns: null,
        fcm: null,
      },
      claim: {
        now: NOW,
        batchSize: 250,
        leaseMs: 120_000,
      },
    })

    expect(result).toEqual({
      claimedCount: 0,
      sentCount: 0,
      failedCount: 0,
      skippedCount: 0,
    })
  })

  it('defaults the batch size to 100 when not provided', async () => {
    await drainDueNotifications()

    expect(mocks.processDueDeliveries).toHaveBeenCalledWith(
      expect.objectContaining({
        claim: { now: NOW, batchSize: 100, leaseMs: 120_000 },
      }),
    )
  })

  it('in-app sender publishes realtime notification and increments version', async () => {
    await drainDueNotifications()

    const call = mocks.processDueDeliveries.mock.calls[0]?.[0]
    const providers = call.providers

    const result = await providers.inApp.send({
      id: 'delivery_1',
      idempotencyKey: 'inapp_idem_from_request',
      recipientInAppTargetId: 'client_123',
      payload: { hello: 'world' },
    })

    expect(mocks.redisPublish).toHaveBeenCalledWith(
      'notifications:in-app:client_123',
      JSON.stringify({
        idempotencyKey: 'inapp_idem_from_request',
        recipientInAppTargetId: 'client_123',
        id: 'delivery_1',
        payload: { hello: 'world' },
      }),
    )

    expect(mocks.redisIncr).toHaveBeenCalledWith(
      'notifications:in-app:client_123:version',
    )

    expect(result).toEqual({
      accepted: true,
      providerMessageId: 'inapp_idem_from_request',
      providerStatus: 'published',
      responseMeta: {
        source: 'lib/notifications/delivery/runNotificationDrain',
        channel: 'notifications:in-app:client_123',
        version: 7,
        subscriberCount: 2,
      },
    })
  })

  it('in-app sender throws when Redis is not configured', async () => {
    mocks.getRedis.mockReturnValueOnce(null)

    await drainDueNotifications()

    const call = mocks.processDueDeliveries.mock.calls[0]?.[0]
    const providers = call.providers

    await expect(
      providers.inApp.send({
        idempotencyKey: 'inapp_idem_1',
        recipientInAppTargetId: 'client_1',
      }),
    ).rejects.toThrow('Redis is not configured.')
  })

  it('sms sender delegates through the Twilio client wrapper', async () => {
    await drainDueNotifications()

    const call = mocks.processDueDeliveries.mock.calls[0]?.[0]
    const providers = call.providers

    const result = await providers.sms.send({
      to: '+15550003333',
      body: 'SMS body',
      statusCallback: 'https://example.com/twilio/status',
    })

    expect(mocks.twilioMessageCreate).toHaveBeenCalledWith({
      from: '+15550001111',
      to: '+15550003333',
      body: 'SMS body',
      statusCallback: 'https://example.com/twilio/status',
    })

    expect(result).toEqual({
      to: '+15550002222',
      body: 'Reminder text',
      status: 'queued',
      sid: 'SM_1',
    })
  })

  it('omits the SMS provider (no crash) when Twilio is not configured', async () => {
    delete process.env.TWILIO_AUTH_TOKEN

    await drainDueNotifications()

    expect(mocks.twilioFactory).not.toHaveBeenCalled()
    expect(mocks.createSmsDeliveryProvider).not.toHaveBeenCalled()

    expect(mocks.processDueDeliveries).toHaveBeenCalledWith(
      expect.objectContaining({
        providers: expect.objectContaining({ sms: null }),
      }),
    )
  })

  it('omits the email provider (no crash) when Postmark is not configured', async () => {
    delete process.env.POSTMARK_SERVER_TOKEN

    await drainDueNotifications()

    expect(mocks.createEmailDeliveryProvider).not.toHaveBeenCalled()

    expect(mocks.processDueDeliveries).toHaveBeenCalledWith(
      expect.objectContaining({
        providers: expect.objectContaining({ email: null }),
      }),
    )
  })

  it('still drains in-app deliveries when neither SMS nor email is configured', async () => {
    delete process.env.TWILIO_ACCOUNT_SID
    delete process.env.TWILIO_AUTH_TOKEN
    delete process.env.TWILIO_FROM_NUMBER
    delete process.env.POSTMARK_SERVER_TOKEN
    delete process.env.POSTMARK_FROM_EMAIL

    await drainDueNotifications()

    expect(mocks.processDueDeliveries).toHaveBeenCalledWith(
      expect.objectContaining({
        providers: {
          inApp: {
            provider: NotificationProvider.INTERNAL_REALTIME,
            channel: NotificationChannel.IN_APP,
            send: expect.any(Function),
          },
          sms: null,
          email: null,
          apns: null,
          fcm: null,
        },
      }),
    )
  })
})
