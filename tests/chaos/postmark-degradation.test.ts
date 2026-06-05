// tests/chaos/postmark-degradation.test.ts

import { describe, expect, it, vi } from 'vitest'
import {
  NotificationChannel,
  NotificationDeliveryEventType,
  NotificationDeliveryStatus,
  NotificationProvider,
} from '@prisma/client'

import { EmailDeliveryProvider } from '@/lib/notifications/delivery/sendEmail'
import type { EmailProviderSendRequest } from '@/lib/notifications/delivery/providerTypes'

function makeFetchResponse(args: {
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

function makeEmailRequest(
  overrides?: {
    destination?: string
    subject?: string
    text?: string
    html?: string
    attemptCount?: number
    idempotencyKey?: string
  },
): EmailProviderSendRequest {
  return {
    provider: NotificationProvider.POSTMARK,
    channel: NotificationChannel.EMAIL,
    deliveryId: 'delivery_email_chaos_1',
    dispatchId: 'dispatch_chaos_1',
    destination: overrides?.destination ?? 'client@example.com',
    attemptCount: overrides?.attemptCount ?? 0,
    maxAttempts: 6,
    idempotencyKey:
      overrides?.idempotencyKey ??
      'delivery:delivery_email_chaos_1:attempt:1',
    content: {
      channel: NotificationChannel.EMAIL,
      templateKey: 'booking_confirmed',
      templateVersion: 1,
      subject: overrides?.subject ?? 'TOVIS: Booking confirmed',
      text: overrides?.text ?? 'Your booking is confirmed.',
      html: overrides?.html ?? '<p>Your booking is confirmed.</p>',
    },
  }
}

function stringifyUnknown(value: unknown): string {
  return JSON.stringify(value)
}

describe('chaos: Postmark degradation', () => {
  it('classifies thrown Postmark/network failures as retryable without leaking the API token', async () => {
    const fetchImpl = vi
      .fn()
      .mockRejectedValue(new Error('Postmark connection refused'))

    const provider = new EmailDeliveryProvider({
      apiToken: 'postmark-secret-token',
      fromEmail: 'hello@tovis.com',
      messageStream: 'outbound',
      fetchImpl,
    })

    const result = await provider.send(makeEmailRequest())

    expect(result).toEqual({
      ok: false,
      retryable: true,
      code: 'EMAIL_PROVIDER_ERROR',
      message: 'Postmark connection refused',
      providerStatus: 'retryable_error',
      responseMeta: {
        source: 'sendEmail',
        errorName: 'Error',
        nextStatus: NotificationDeliveryStatus.FAILED_RETRYABLE,
        eventType: NotificationDeliveryEventType.RETRY_SCHEDULED,
      },
    })

    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect(stringifyUnknown(result)).not.toContain('postmark-secret-token')
  })

  it('classifies Postmark 503 responses as retryable degradation', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      makeFetchResponse({
        ok: false,
        status: 503,
        text: 'Postmark temporarily unavailable',
      }),
    )

    const provider = new EmailDeliveryProvider({
      apiToken: 'postmark-secret-token',
      fromEmail: 'hello@tovis.com',
      messageStream: 'outbound',
      fetchImpl,
    })

    const result = await provider.send(makeEmailRequest())

    expect(result).toEqual({
      ok: false,
      retryable: true,
      code: 'POSTMARK_HTTP_503',
      message: 'Postmark temporarily unavailable',
      providerStatus: 'http_503',
      responseMeta: {
        source: 'sendEmail',
        status: 503,
        bodyText: 'Postmark temporarily unavailable',
        nextStatus: NotificationDeliveryStatus.FAILED_RETRYABLE,
        eventType: NotificationDeliveryEventType.RETRY_SCHEDULED,
      },
    })

    expect(stringifyUnknown(result)).not.toContain('postmark-secret-token')
  })

  it('classifies Postmark 429 responses as retryable throttling', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      makeFetchResponse({
        ok: false,
        status: 429,
        text: 'Too many requests',
      }),
    )

    const provider = new EmailDeliveryProvider({
      apiToken: 'postmark-secret-token',
      fromEmail: 'hello@tovis.com',
      fetchImpl,
    })

    const result = await provider.send(makeEmailRequest())

    expect(result).toEqual({
      ok: false,
      retryable: true,
      code: 'POSTMARK_HTTP_429',
      message: 'Too many requests',
      providerStatus: 'http_429',
      responseMeta: {
        source: 'sendEmail',
        status: 429,
        bodyText: 'Too many requests',
        nextStatus: NotificationDeliveryStatus.FAILED_RETRYABLE,
        eventType: NotificationDeliveryEventType.RETRY_SCHEDULED,
      },
    })

    expect(stringifyUnknown(result)).not.toContain('postmark-secret-token')
  })

  it('classifies hard Postmark API rejections as final failures', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      makeFetchResponse({
        ok: true,
        status: 200,
        text: JSON.stringify({
          ErrorCode: 300,
          Message: 'Invalid email address.',
          SubmittedAt: '2026-06-05T20:15:00Z',
          To: 'bad-address',
        }),
      }),
    )

    const provider = new EmailDeliveryProvider({
      apiToken: 'postmark-secret-token',
      fromEmail: 'hello@tovis.com',
      fetchImpl,
    })

    const result = await provider.send(
      makeEmailRequest({
        destination: 'bad-address',
      }),
    )

    expect(result).toEqual({
      ok: false,
      retryable: false,
      code: 'POSTMARK_API_300',
      message: 'Invalid email address.',
      providerStatus: 'rejected',
      responseMeta: {
        source: 'sendEmail',
        errorCode: '300',
        to: 'bad-address',
        submittedAt: '2026-06-05T20:15:00Z',
        nextStatus: NotificationDeliveryStatus.FAILED_FINAL,
        eventType: NotificationDeliveryEventType.FAILED,
      },
    })

    expect(stringifyUnknown(result)).not.toContain('postmark-secret-token')
  })

  it('classifies unreadable Postmark responses as retryable degradation', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      makeFetchResponse({
        ok: true,
        status: 200,
        text: 'not-json',
      }),
    )

    const provider = new EmailDeliveryProvider({
      apiToken: 'postmark-secret-token',
      fromEmail: 'hello@tovis.com',
      fetchImpl,
    })

    const result = await provider.send(makeEmailRequest())

    expect(result).toEqual({
      ok: false,
      retryable: true,
      code: 'POSTMARK_INVALID_RESPONSE',
      message: 'Postmark returned an unreadable response body.',
      providerStatus: 'invalid_response',
      responseMeta: {
        source: 'sendEmail',
        bodyText: 'not-json',
        nextStatus: NotificationDeliveryStatus.FAILED_RETRYABLE,
        eventType: NotificationDeliveryEventType.RETRY_SCHEDULED,
      },
    })

    expect(stringifyUnknown(result)).not.toContain('postmark-secret-token')
  })
})