// lib/notifications/delivery/sendSms.test.ts

import { describe, expect, it, vi } from 'vitest'
import {
  NotificationChannel,
  NotificationDeliveryEventType,
  NotificationDeliveryStatus,
  NotificationProvider,
} from '@prisma/client'

import { SmsDeliveryProvider, createSmsDeliveryProvider } from './sendSms'
import type { SmsProviderSendRequest } from './providerTypes'

function makeProvider(args?: {
  create?: ReturnType<typeof vi.fn>
  statusCallbackUrl?: string | null
}) {
  const create = args?.create ?? vi.fn()

  return {
    create,
    provider: new SmsDeliveryProvider({
      client: {
        messages: {
          create,
        },
      },
      fromNumber: '+15550001111',
      statusCallbackUrl: args?.statusCallbackUrl ?? null,
    }),
  }
}

function makeValidSmsRequest(
  overrides?: {
    destination?: string
    text?: string
    attemptCount?: number
    idempotencyKey?: string
  },
): SmsProviderSendRequest {
  return {
    provider: NotificationProvider.TWILIO,
    channel: NotificationChannel.SMS,
    deliveryId: 'delivery_sms_1',
    dispatchId: 'dispatch_1',
    destination: overrides?.destination ?? '+15551234567',
    attemptCount: overrides?.attemptCount ?? 0,
    maxAttempts: 5,
    idempotencyKey:
      overrides?.idempotencyKey ?? 'delivery:delivery_sms_1:attempt:1',
    content: {
      channel: NotificationChannel.SMS,
      templateKey: 'appointment_reminder',
      templateVersion: 1,
      text: overrides?.text ?? 'TOVIS: Reminder for tomorrow.',
    },
  }
}

describe('lib/notifications/delivery/sendSms', () => {
  it('creates a provider instance from the factory', () => {
    const client = {
      messages: {
        create: vi.fn(),
      },
    }

    const provider = createSmsDeliveryProvider({
      client,
      fromNumber: '+15550001111',
      statusCallbackUrl: null,
    })

    expect(provider).toBeInstanceOf(SmsDeliveryProvider)
    expect(provider.provider).toBe(NotificationProvider.TWILIO)
    expect(provider.channel).toBe(NotificationChannel.SMS)
  })

  it('sends a valid sms request and returns success metadata', async () => {
    const create = vi.fn().mockResolvedValue({
      to: '+15551234567',
      body: 'TOVIS: Reminder for tomorrow.',
      status: 'queued',
      sid: 'SM123',
    })

    const { provider } = makeProvider({
      create,
      statusCallbackUrl:
        'https://api.tovis.app/api/internal/webhooks/twilio/notifications/status',
    })

    const result = await provider.send(makeValidSmsRequest())

    expect(create).toHaveBeenCalledWith({
      to: '+15551234567',
      from: '+15550001111',
      body: 'TOVIS: Reminder for tomorrow.',
      statusCallback:
        'https://api.tovis.app/api/internal/webhooks/twilio/notifications/status',
    })

    expect(result).toEqual({
      ok: true,
      providerMessageId: 'SM123',
      providerStatus: 'queued',
      responseMeta: {
        source: 'sendSms',
        to: '+15551234567',
        from: '+15550001111',
        statusCallback:
          'https://api.tovis.app/api/internal/webhooks/twilio/notifications/status',
      },
    })
  })

  it('omits statusCallback when no callback URL is configured', async () => {
    const create = vi.fn().mockResolvedValue({
      to: '+15551234567',
      body: 'TOVIS: Reminder for tomorrow.',
      status: 'queued',
      sid: 'SM123',
    })

    const { provider } = makeProvider({
      create,
      statusCallbackUrl: null,
    })

    const result = await provider.send(makeValidSmsRequest())

    expect(create).toHaveBeenCalledWith({
      to: '+15551234567',
      from: '+15550001111',
      body: 'TOVIS: Reminder for tomorrow.',
    })

    expect(result).toEqual({
      ok: true,
      providerMessageId: 'SM123',
      providerStatus: 'queued',
      responseMeta: {
        source: 'sendSms',
        to: '+15551234567',
        from: '+15550001111',
        statusCallback: null,
      },
    })
  })

  it('falls back to idempotencyKey when twilio does not return a sid', async () => {
    const create = vi.fn().mockResolvedValue({
      to: '+15551234567',
      body: 'TOVIS: Reminder',
      status: null,
      sid: null,
    })

    const { provider } = makeProvider({ create })

    const result = await provider.send(
      makeValidSmsRequest({
        attemptCount: 1,
        idempotencyKey: 'delivery:delivery_sms_1:attempt:2',
        text: 'TOVIS: Reminder',
      }),
    )

    expect(result).toEqual({
      ok: true,
      providerMessageId: 'delivery:delivery_sms_1:attempt:2',
      providerStatus: 'accepted',
      responseMeta: {
        source: 'sendSms',
        to: '+15551234567',
        from: '+15550001111',
        statusCallback: null,
      },
    })
  })

  it('returns non-retryable failure when destination is blank', async () => {
    const { create, provider } = makeProvider()

    const result = await provider.send(
      makeValidSmsRequest({
        destination: '   ',
      }),
    )

    expect(result).toEqual({
      ok: false,
      retryable: false,
      code: 'SMS_REQUEST_INVALID',
      message: 'sendSms: missing destination',
      providerStatus: 'invalid_request',
      responseMeta: {
        source: 'sendSms',
        nextStatus: NotificationDeliveryStatus.FAILED_FINAL,
        eventType: NotificationDeliveryEventType.FAILED,
      },
    })

    expect(create).not.toHaveBeenCalled()
  })

  it('returns non-retryable failure when message body is blank', async () => {
    const { create, provider } = makeProvider()

    const result = await provider.send(
      makeValidSmsRequest({
        text: '   ',
      }),
    )

    expect(result).toEqual({
      ok: false,
      retryable: false,
      code: 'SMS_REQUEST_INVALID',
      message: 'sendSms: missing content.text',
      providerStatus: 'invalid_request',
      responseMeta: {
        source: 'sendSms',
        nextStatus: NotificationDeliveryStatus.FAILED_FINAL,
        eventType: NotificationDeliveryEventType.FAILED,
      },
    })

    expect(create).not.toHaveBeenCalled()
  })

  it('returns non-retryable configuration failure when provider is not Twilio', async () => {
    const { create, provider } = makeProvider()

    const request = {
      ...makeValidSmsRequest(),
      provider: NotificationProvider.POSTMARK,
    } as unknown as SmsProviderSendRequest

    const result = await provider.send(request)

    expect(result).toEqual({
      ok: false,
      retryable: false,
      code: 'SMS_PROVIDER_MISCONFIGURED',
      message: 'Expected TWILIO provider for SMS delivery.',
      providerStatus: 'misconfigured',
      responseMeta: {
        source: 'sendSms',
        nextStatus: NotificationDeliveryStatus.FAILED_FINAL,
        eventType: NotificationDeliveryEventType.FAILED,
      },
    })

    expect(create).not.toHaveBeenCalled()
  })

  it('returns non-retryable configuration failure when channel is not SMS', async () => {
    const { create, provider } = makeProvider()

    const request = {
      ...makeValidSmsRequest(),
      channel: NotificationChannel.EMAIL,
      content: {
        channel: NotificationChannel.EMAIL,
        templateKey: 'appointment_reminder',
        templateVersion: 1,
        subject: 'Reminder',
        html: '<p>TOVIS reminder</p>',
        text: 'TOVIS reminder',
      },
    } as unknown as SmsProviderSendRequest

    const result = await provider.send(request)

    expect(result).toEqual({
      ok: false,
      retryable: false,
      code: 'SMS_PROVIDER_MISCONFIGURED',
      message: 'Expected SMS channel for SMS delivery.',
      providerStatus: 'misconfigured',
      responseMeta: {
        source: 'sendSms',
        nextStatus: NotificationDeliveryStatus.FAILED_FINAL,
        eventType: NotificationDeliveryEventType.FAILED,
      },
    })

    expect(create).not.toHaveBeenCalled()
  })

  it('returns retryable failure when Twilio throws a retryable provider error', async () => {
    const error = new Error('Twilio queue overflow')
    Object.defineProperty(error, 'code', {
      value: 30001,
      enumerable: true,
    })

    const create = vi.fn().mockRejectedValue(error)
    const { provider } = makeProvider({ create })

    const result = await provider.send(
      makeValidSmsRequest({
        text: 'TOVIS: Reminder',
      }),
    )

    expect(result).toEqual({
      ok: false,
      retryable: true,
      code: '30001',
      message: 'Twilio queue overflow',
      providerStatus: 'retryable_error',
      responseMeta: {
        source: 'sendSms',
        errorName: 'Error',
        nextStatus: NotificationDeliveryStatus.FAILED_RETRYABLE,
        eventType: NotificationDeliveryEventType.RETRY_SCHEDULED,
      },
    })
  })

  it('returns final failure when Twilio throws a final provider error', async () => {
    const error = new Error('Unreachable destination handset')
    Object.defineProperty(error, 'code', {
      value: 30003,
      enumerable: true,
    })

    const create = vi.fn().mockRejectedValue(error)
    const { provider } = makeProvider({ create })

    const result = await provider.send(
      makeValidSmsRequest({
        text: 'TOVIS: Reminder',
      }),
    )

    expect(result).toEqual({
      ok: false,
      retryable: false,
      code: '30003',
      message: 'Unreachable destination handset',
      providerStatus: 'failed',
      responseMeta: {
        source: 'sendSms',
        errorName: 'Error',
        nextStatus: NotificationDeliveryStatus.FAILED_FINAL,
        eventType: NotificationDeliveryEventType.FAILED,
      },
    })
  })

  it('returns retryable failure when Twilio throws without a provider code', async () => {
    const create = vi.fn().mockRejectedValue(new Error('twilio timeout'))
    const { provider } = makeProvider({ create })

    const result = await provider.send(
      makeValidSmsRequest({
        text: 'TOVIS: Reminder',
      }),
    )

    expect(result).toEqual({
      ok: false,
      retryable: true,
      code: 'SMS_PROVIDER_ERROR',
      message: 'twilio timeout',
      providerStatus: 'retryable_error',
      responseMeta: {
        source: 'sendSms',
        errorName: 'Error',
        nextStatus: NotificationDeliveryStatus.FAILED_RETRYABLE,
        eventType: NotificationDeliveryEventType.RETRY_SCHEDULED,
      },
    })
  })

  it('throws at construction time when injected client is missing', () => {
    expect(
      () =>
        new SmsDeliveryProvider({
          client: null as never,
          fromNumber: '+15550001111',
          statusCallbackUrl: null,
        }),
    ).toThrow()
  })

  it('throws at construction time when fromNumber is missing for injected client', () => {
    expect(
      () =>
        new SmsDeliveryProvider({
          client: {
            messages: {
              create: vi.fn(),
            },
          },
          statusCallbackUrl: null,
        }),
    ).toThrow(
      'sendSms: fromNumber must be provided when using an injected client',
    )
  })

  it('throws at construction time when client.messages.create is missing', () => {
    expect(
      () =>
        new SmsDeliveryProvider({
          client: {
            messages: {} as never,
          },
          fromNumber: '+15550001111',
          statusCallbackUrl: null,
        }),
    ).toThrow('sendSms: client.messages.create must be a function')
  })
})