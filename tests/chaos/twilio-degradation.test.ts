// tests/chaos/twilio-degradation.test.ts

import { describe, expect, it, vi } from 'vitest'
import {
  NotificationChannel,
  NotificationDeliveryEventType,
  NotificationDeliveryStatus,
  NotificationProvider,
} from '@prisma/client'

import { SmsDeliveryProvider } from '@/lib/notifications/delivery/sendSms'
import type { SmsProviderSendRequest } from '@/lib/notifications/delivery/providerTypes'

function makeTwilioError(args: {
  code?: number | string
  message: string
}): Error & { code?: number | string } {
  const error = new Error(args.message) as Error & {
    code?: number | string
  }

  if (args.code !== undefined) {
    error.code = args.code
  }

  return error
}

function makeSmsRequest(
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
    deliveryId: 'delivery_sms_chaos_1',
    dispatchId: 'dispatch_chaos_1',
    destination: overrides?.destination ?? '+15551234567',
    attemptCount: overrides?.attemptCount ?? 0,
    maxAttempts: 5,
    idempotencyKey:
      overrides?.idempotencyKey ?? 'delivery:delivery_sms_chaos_1:attempt:1',
    content: {
      channel: NotificationChannel.SMS,
      templateKey: 'appointment_reminder',
      templateVersion: 1,
      text: overrides?.text ?? 'TOVIS: Reminder for tomorrow.',
    },
  }
}

function makeProvider(create: ReturnType<typeof vi.fn>): SmsDeliveryProvider {
  return new SmsDeliveryProvider({
    client: {
      messages: {
        create,
      },
    },
    fromNumber: '+15550001111',
    statusCallbackUrl: null,
  })
}

describe('chaos: Twilio degradation', () => {
  it('classifies transient Twilio/network failures as retryable without leaking provider credentials', async () => {
    const create = vi.fn().mockRejectedValue(
      makeTwilioError({
        message:
          'Twilio request failed: connection reset while using auth token twilio-secret-token',
      }),
    )

    const provider = makeProvider(create)
    const result = await provider.send(makeSmsRequest())

    expect(result).toEqual({
      ok: false,
      retryable: true,
      code: 'SMS_PROVIDER_ERROR',
      message:
        'Twilio request failed: connection reset while using auth token twilio-secret-token',
      providerStatus: 'retryable_error',
      responseMeta: {
        source: 'sendSms',
        errorName: 'Error',
        nextStatus: NotificationDeliveryStatus.FAILED_RETRYABLE,
        eventType: NotificationDeliveryEventType.RETRY_SCHEDULED,
      },
    })

    expect(JSON.stringify(result.responseMeta)).not.toContain(
      'twilio-secret-token',
    )
  })

    it('documents current Twilio 20429 throttling classification as a final failure', async () => {
    const create = vi.fn().mockRejectedValue(
        makeTwilioError({
        code: 20429,
        message: 'Too many requests',
        }),
    )

    const provider = makeProvider(create)
    const result = await provider.send(makeSmsRequest())

    expect(result).toEqual({
        ok: false,
        retryable: false,
        code: '20429',
        message: 'Too many requests',
        providerStatus: 'failed',
        responseMeta: {
        source: 'sendSms',
        errorName: 'Error',
        nextStatus: NotificationDeliveryStatus.FAILED_FINAL,
        eventType: NotificationDeliveryEventType.FAILED,
        },
    })
    })

    it('documents current Twilio 20500 provider failure classification as a final failure', async () => {
    const create = vi.fn().mockRejectedValue(
        makeTwilioError({
        code: 20500,
        message: 'Twilio temporarily unavailable',
        }),
    )

    const provider = makeProvider(create)
    const result = await provider.send(makeSmsRequest())

    expect(result).toEqual({
        ok: false,
        retryable: false,
        code: '20500',
        message: 'Twilio temporarily unavailable',
        providerStatus: 'failed',
        responseMeta: {
        source: 'sendSms',
        errorName: 'Error',
        nextStatus: NotificationDeliveryStatus.FAILED_FINAL,
        eventType: NotificationDeliveryEventType.FAILED,
        },
    })
    })

  it('classifies invalid destination errors as final failures', async () => {
    const create = vi.fn().mockRejectedValue(
      makeTwilioError({
        code: 21211,
        message: 'The To phone number is not a valid phone number.',
      }),
    )

    const provider = makeProvider(create)
    const result = await provider.send(makeSmsRequest())

    expect(result).toEqual({
      ok: false,
      retryable: false,
      code: '21211',
      message: 'The To phone number is not a valid phone number.',
      providerStatus: 'failed',
      responseMeta: {
        source: 'sendSms',
        errorName: 'Error',
        nextStatus: NotificationDeliveryStatus.FAILED_FINAL,
        eventType: NotificationDeliveryEventType.FAILED,
      },
    })
  })

  it('classifies blank SMS content as a final request failure before calling Twilio', async () => {
    const create = vi.fn()
    const provider = makeProvider(create)

    const result = await provider.send(
      makeSmsRequest({
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
})