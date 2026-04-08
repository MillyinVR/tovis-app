import { describe, expect, it, vi } from 'vitest'
import { NotificationChannel, NotificationProvider } from '@prisma/client'

import {
  SmsDeliveryProvider,
  createSmsDeliveryProvider,
} from './sendSms'

describe('lib/notifications/delivery/sendSms', () => {
  it('creates a provider instance from the factory', () => {
    const client = {
      messages: {
        create: vi.fn(),
      },
    }

    const provider = createSmsDeliveryProvider({ client })

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

    const provider = new SmsDeliveryProvider({
      client: {
        messages: {
          create,
        },
      },
    })

    const result = await provider.send({
      provider: NotificationProvider.TWILIO,
      channel: NotificationChannel.SMS,
      deliveryId: 'delivery_sms_1',
      dispatchId: 'dispatch_1',
      destination: '+15551234567',
      attemptCount: 0,
      maxAttempts: 5,
      idempotencyKey: 'delivery:delivery_sms_1:attempt:1',
      content: {
        channel: NotificationChannel.SMS,
        templateKey: 'appointment_reminder',
        templateVersion: 1,
        text: 'TOVIS: Reminder for tomorrow.',
      },
    })

    expect(create).toHaveBeenCalledWith({
      to: '+15551234567',
      body: 'TOVIS: Reminder for tomorrow.',
    })

    expect(result).toEqual({
      ok: true,
      providerMessageId: 'SM123',
      providerStatus: 'queued',
      responseMeta: {
        source: 'sendSms',
        to: '+15551234567',
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

    const provider = new SmsDeliveryProvider({
      client: {
        messages: {
          create,
        },
      },
    })

    const result = await provider.send({
      provider: NotificationProvider.TWILIO,
      channel: NotificationChannel.SMS,
      deliveryId: 'delivery_sms_1',
      dispatchId: 'dispatch_1',
      destination: '+15551234567',
      attemptCount: 1,
      maxAttempts: 5,
      idempotencyKey: 'delivery:delivery_sms_1:attempt:2',
      content: {
        channel: NotificationChannel.SMS,
        templateKey: 'appointment_reminder',
        templateVersion: 1,
        text: 'TOVIS: Reminder',
      },
    })

    expect(result).toEqual({
      ok: true,
      providerMessageId: 'delivery:delivery_sms_1:attempt:2',
      providerStatus: 'accepted',
      responseMeta: {
        source: 'sendSms',
        to: '+15551234567',
      },
    })
  })

  it('returns non-retryable failure when destination is blank', async () => {
    const create = vi.fn()

    const provider = new SmsDeliveryProvider({
      client: {
        messages: {
          create,
        },
      },
    })

    const result = await provider.send({
      provider: NotificationProvider.TWILIO,
      channel: NotificationChannel.SMS,
      deliveryId: 'delivery_sms_1',
      dispatchId: 'dispatch_1',
      destination: '   ',
      attemptCount: 0,
      maxAttempts: 5,
      idempotencyKey: 'delivery:delivery_sms_1:attempt:1',
      content: {
        channel: NotificationChannel.SMS,
        templateKey: 'appointment_reminder',
        templateVersion: 1,
        text: 'TOVIS: Reminder',
      },
    })

    expect(result).toEqual({
      ok: false,
      retryable: false,
      code: 'SMS_REQUEST_INVALID',
      message: 'sendSms: missing destination',
      providerStatus: 'invalid_request',
      responseMeta: {
        source: 'sendSms',
      },
    })

    expect(create).not.toHaveBeenCalled()
  })

  it('returns non-retryable failure when message body is blank', async () => {
    const create = vi.fn()

    const provider = new SmsDeliveryProvider({
      client: {
        messages: {
          create,
        },
      },
    })

    const result = await provider.send({
      provider: NotificationProvider.TWILIO,
      channel: NotificationChannel.SMS,
      deliveryId: 'delivery_sms_1',
      dispatchId: 'dispatch_1',
      destination: '+15551234567',
      attemptCount: 0,
      maxAttempts: 5,
      idempotencyKey: 'delivery:delivery_sms_1:attempt:1',
      content: {
        channel: NotificationChannel.SMS,
        templateKey: 'appointment_reminder',
        templateVersion: 1,
        text: '   ',
      },
    })

    expect(result).toEqual({
      ok: false,
      retryable: false,
      code: 'SMS_REQUEST_INVALID',
      message: 'sendSms: missing content.text',
      providerStatus: 'invalid_request',
      responseMeta: {
        source: 'sendSms',
      },
    })

    expect(create).not.toHaveBeenCalled()
  })

  it('returns retryable failure when twilio throws', async () => {
    const create = vi.fn().mockRejectedValue(new Error('twilio timeout'))

    const provider = new SmsDeliveryProvider({
      client: {
        messages: {
          create,
        },
      },
    })

    const result = await provider.send({
      provider: NotificationProvider.TWILIO,
      channel: NotificationChannel.SMS,
      deliveryId: 'delivery_sms_1',
      dispatchId: 'dispatch_1',
      destination: '+15551234567',
      attemptCount: 0,
      maxAttempts: 5,
      idempotencyKey: 'delivery:delivery_sms_1:attempt:1',
      content: {
        channel: NotificationChannel.SMS,
        templateKey: 'appointment_reminder',
        templateVersion: 1,
        text: 'TOVIS: Reminder',
      },
    })

    expect(result).toEqual({
      ok: false,
      retryable: true,
      code: 'SMS_PROVIDER_ERROR',
      message: 'twilio timeout',
      providerStatus: 'error',
      responseMeta: {
        source: 'sendSms',
        errorName: 'Error',
      },
    })
  })

  it('throws at construction time when client is missing', () => {
    expect(
      () =>
        new SmsDeliveryProvider({
          client: null as never,
        }),
    ).toThrow('sendSms: client must be provided')
  })

  it('throws at construction time when client.messages.create is missing', () => {
    expect(
      () =>
        new SmsDeliveryProvider({
          client: {
            messages: {} as never,
          },
        }),
    ).toThrow('sendSms: client.messages.create must be a function')
  })
})