import { describe, expect, it, vi } from 'vitest'
import { NotificationChannel, NotificationProvider } from '@prisma/client'

import {
  EmailDeliveryProvider,
  createEmailDeliveryProvider,
} from './sendEmail'

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

describe('lib/notifications/delivery/sendEmail', () => {
  it('creates a provider instance from the factory', () => {
    const fetchImpl = vi.fn()

    const provider = createEmailDeliveryProvider({
      apiToken: 'postmark-token',
      fromEmail: 'hello@tovis.com',
      fetchImpl,
    })

    expect(provider).toBeInstanceOf(EmailDeliveryProvider)
    expect(provider.provider).toBe(NotificationProvider.POSTMARK)
    expect(provider.channel).toBe(NotificationChannel.EMAIL)
  })

  it('sends a valid email request and returns success metadata', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      makeFetchResponse({
        ok: true,
        status: 200,
        text: JSON.stringify({
          ErrorCode: 0,
          MessageID: 'pm_123',
          SubmittedAt: '2026-04-09T12:00:00Z',
          To: 'client@example.com',
        }),
      }),
    )

    const provider = new EmailDeliveryProvider({
      apiToken: 'postmark-token',
      fromEmail: 'hello@tovis.com',
      messageStream: 'outbound',
      fetchImpl,
    })

    const result = await provider.send({
      provider: NotificationProvider.POSTMARK,
      channel: NotificationChannel.EMAIL,
      deliveryId: 'delivery_email_1',
      dispatchId: 'dispatch_1',
      destination: 'client@example.com',
      attemptCount: 0,
      maxAttempts: 6,
      idempotencyKey: 'delivery:delivery_email_1:attempt:1',
      content: {
        channel: NotificationChannel.EMAIL,
        templateKey: 'booking_confirmed',
        templateVersion: 1,
        subject: 'TOVIS: Booking confirmed',
        text: 'Your booking is confirmed.',
        html: '<p>Your booking is confirmed.</p>',
      },
    })

    expect(fetchImpl).toHaveBeenCalledWith(
      'https://api.postmarkapp.com/email',
      {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          'X-Postmark-Server-Token': 'postmark-token',
        },
        body: JSON.stringify({
          From: 'hello@tovis.com',
          To: 'client@example.com',
          Subject: 'TOVIS: Booking confirmed',
          TextBody: 'Your booking is confirmed.',
          HtmlBody: '<p>Your booking is confirmed.</p>',
          MessageStream: 'outbound',
          Metadata: {
            deliveryId: 'delivery_email_1',
            dispatchId: 'dispatch_1',
            idempotencyKey: 'delivery:delivery_email_1:attempt:1',
            provider: NotificationProvider.POSTMARK,
          },
        }),
      },
    )

    expect(result).toEqual({
      ok: true,
      providerMessageId: 'pm_123',
      providerStatus: 'accepted',
      responseMeta: {
        source: 'sendEmail',
        to: 'client@example.com',
        submittedAt: '2026-04-09T12:00:00Z',
      },
    })
  })

  it('falls back to idempotencyKey when postmark does not return a MessageID', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      makeFetchResponse({
        ok: true,
        status: 200,
        text: JSON.stringify({
          ErrorCode: 0,
          MessageID: null,
          SubmittedAt: null,
          To: null,
        }),
      }),
    )

    const provider = new EmailDeliveryProvider({
      apiToken: 'postmark-token',
      fromEmail: 'hello@tovis.com',
      fetchImpl,
    })

    const result = await provider.send({
      provider: NotificationProvider.POSTMARK,
      channel: NotificationChannel.EMAIL,
      deliveryId: 'delivery_email_1',
      dispatchId: 'dispatch_1',
      destination: 'client@example.com',
      attemptCount: 1,
      maxAttempts: 6,
      idempotencyKey: 'delivery:delivery_email_1:attempt:2',
      content: {
        channel: NotificationChannel.EMAIL,
        templateKey: 'aftercare_ready',
        templateVersion: 1,
        subject: 'TOVIS: Aftercare ready',
        text: 'Your aftercare is ready.',
        html: '<p>Your aftercare is ready.</p>',
      },
    })

    expect(result).toEqual({
      ok: true,
      providerMessageId: 'delivery:delivery_email_1:attempt:2',
      providerStatus: 'accepted',
      responseMeta: {
        source: 'sendEmail',
        to: 'client@example.com',
        submittedAt: null,
      },
    })
  })

  it('returns non-retryable failure when request data is invalid', async () => {
    const fetchImpl = vi.fn()

    const provider = new EmailDeliveryProvider({
      apiToken: 'postmark-token',
      fromEmail: 'hello@tovis.com',
      fetchImpl,
    })

    const result = await provider.send({
      provider: NotificationProvider.POSTMARK,
      channel: NotificationChannel.EMAIL,
      deliveryId: 'delivery_email_1',
      dispatchId: 'dispatch_1',
      destination: 'client@example.com',
      attemptCount: 0,
      maxAttempts: 6,
      idempotencyKey: 'delivery:delivery_email_1:attempt:1',
      content: {
        channel: NotificationChannel.EMAIL,
        templateKey: 'booking_confirmed',
        templateVersion: 1,
        subject: '   ',
        text: 'Your booking is confirmed.',
        html: '<p>Your booking is confirmed.</p>',
      },
    })

    expect(result).toEqual({
      ok: false,
      retryable: false,
      code: 'EMAIL_REQUEST_INVALID',
      message: 'sendEmail: missing content.subject',
      providerStatus: 'invalid_request',
      responseMeta: {
        source: 'sendEmail',
      },
    })

    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('maps retryable HTTP failures correctly', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      makeFetchResponse({
        ok: false,
        status: 429,
        text: 'Rate limited',
      }),
    )

    const provider = new EmailDeliveryProvider({
      apiToken: 'postmark-token',
      fromEmail: 'hello@tovis.com',
      fetchImpl,
    })

    const result = await provider.send({
      provider: NotificationProvider.POSTMARK,
      channel: NotificationChannel.EMAIL,
      deliveryId: 'delivery_email_1',
      dispatchId: 'dispatch_1',
      destination: 'client@example.com',
      attemptCount: 0,
      maxAttempts: 6,
      idempotencyKey: 'delivery:delivery_email_1:attempt:1',
      content: {
        channel: NotificationChannel.EMAIL,
        templateKey: 'booking_confirmed',
        templateVersion: 1,
        subject: 'TOVIS: Booking confirmed',
        text: 'Your booking is confirmed.',
        html: '<p>Your booking is confirmed.</p>',
      },
    })

    expect(result).toEqual({
      ok: false,
      retryable: true,
      code: 'POSTMARK_HTTP_429',
      message: 'Rate limited',
      providerStatus: 'http_429',
      responseMeta: {
        source: 'sendEmail',
        status: 429,
        bodyText: 'Rate limited',
      },
    })
  })

  it('maps non-retryable HTTP failures correctly', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      makeFetchResponse({
        ok: false,
        status: 422,
        text: 'Unprocessable entity',
      }),
    )

    const provider = new EmailDeliveryProvider({
      apiToken: 'postmark-token',
      fromEmail: 'hello@tovis.com',
      fetchImpl,
    })

    const result = await provider.send({
      provider: NotificationProvider.POSTMARK,
      channel: NotificationChannel.EMAIL,
      deliveryId: 'delivery_email_1',
      dispatchId: 'dispatch_1',
      destination: 'client@example.com',
      attemptCount: 0,
      maxAttempts: 6,
      idempotencyKey: 'delivery:delivery_email_1:attempt:1',
      content: {
        channel: NotificationChannel.EMAIL,
        templateKey: 'booking_confirmed',
        templateVersion: 1,
        subject: 'TOVIS: Booking confirmed',
        text: 'Your booking is confirmed.',
        html: '<p>Your booking is confirmed.</p>',
      },
    })

    expect(result).toEqual({
      ok: false,
      retryable: false,
      code: 'POSTMARK_HTTP_422',
      message: 'Unprocessable entity',
      providerStatus: 'http_422',
      responseMeta: {
        source: 'sendEmail',
        status: 422,
        bodyText: 'Unprocessable entity',
      },
    })
  })

  it('maps postmark API rejection correctly', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      makeFetchResponse({
        ok: true,
        status: 200,
        text: JSON.stringify({
          ErrorCode: 300,
          Message: 'Invalid email request',
          To: 'client@example.com',
          SubmittedAt: '2026-04-09T12:00:00Z',
        }),
      }),
    )

    const provider = new EmailDeliveryProvider({
      apiToken: 'postmark-token',
      fromEmail: 'hello@tovis.com',
      fetchImpl,
    })

    const result = await provider.send({
      provider: NotificationProvider.POSTMARK,
      channel: NotificationChannel.EMAIL,
      deliveryId: 'delivery_email_1',
      dispatchId: 'dispatch_1',
      destination: 'client@example.com',
      attemptCount: 0,
      maxAttempts: 6,
      idempotencyKey: 'delivery:delivery_email_1:attempt:1',
      content: {
        channel: NotificationChannel.EMAIL,
        templateKey: 'booking_confirmed',
        templateVersion: 1,
        subject: 'TOVIS: Booking confirmed',
        text: 'Your booking is confirmed.',
        html: '<p>Your booking is confirmed.</p>',
      },
    })

    expect(result).toEqual({
      ok: false,
      retryable: false,
      code: 'POSTMARK_API_300',
      message: 'Invalid email request',
      providerStatus: 'rejected',
      responseMeta: {
        source: 'sendEmail',
        errorCode: 300,
        to: 'client@example.com',
        submittedAt: '2026-04-09T12:00:00Z',
      },
    })
  })

  it('returns retryable failure when response body is unreadable JSON', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      makeFetchResponse({
        ok: true,
        status: 200,
        text: 'not-json',
      }),
    )

    const provider = new EmailDeliveryProvider({
      apiToken: 'postmark-token',
      fromEmail: 'hello@tovis.com',
      fetchImpl,
    })

    const result = await provider.send({
      provider: NotificationProvider.POSTMARK,
      channel: NotificationChannel.EMAIL,
      deliveryId: 'delivery_email_1',
      dispatchId: 'dispatch_1',
      destination: 'client@example.com',
      attemptCount: 0,
      maxAttempts: 6,
      idempotencyKey: 'delivery:delivery_email_1:attempt:1',
      content: {
        channel: NotificationChannel.EMAIL,
        templateKey: 'booking_confirmed',
        templateVersion: 1,
        subject: 'TOVIS: Booking confirmed',
        text: 'Your booking is confirmed.',
        html: '<p>Your booking is confirmed.</p>',
      },
    })

    expect(result).toEqual({
      ok: false,
      retryable: true,
      code: 'POSTMARK_INVALID_RESPONSE',
      message: 'Postmark returned an unreadable response body.',
      providerStatus: 'invalid_response',
      responseMeta: {
        source: 'sendEmail',
        bodyText: 'not-json',
      },
    })
  })

  it('returns retryable failure when fetch throws', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error('network down'))

    const provider = new EmailDeliveryProvider({
      apiToken: 'postmark-token',
      fromEmail: 'hello@tovis.com',
      fetchImpl,
    })

    const result = await provider.send({
      provider: NotificationProvider.POSTMARK,
      channel: NotificationChannel.EMAIL,
      deliveryId: 'delivery_email_1',
      dispatchId: 'dispatch_1',
      destination: 'client@example.com',
      attemptCount: 0,
      maxAttempts: 6,
      idempotencyKey: 'delivery:delivery_email_1:attempt:1',
      content: {
        channel: NotificationChannel.EMAIL,
        templateKey: 'booking_confirmed',
        templateVersion: 1,
        subject: 'TOVIS: Booking confirmed',
        text: 'Your booking is confirmed.',
        html: '<p>Your booking is confirmed.</p>',
      },
    })

    expect(result).toEqual({
      ok: false,
      retryable: true,
      code: 'EMAIL_PROVIDER_ERROR',
      message: 'network down',
      providerStatus: 'error',
      responseMeta: {
        source: 'sendEmail',
        errorName: 'Error',
      },
    })
  })

  it('throws at construction time when apiToken is blank', () => {
    expect(
      () =>
        new EmailDeliveryProvider({
          apiToken: '   ',
          fromEmail: 'hello@tovis.com',
          fetchImpl: vi.fn(),
        }),
    ).toThrow('sendEmail: missing apiToken')
  })

  it('throws at construction time when fromEmail is blank', () => {
    expect(
      () =>
        new EmailDeliveryProvider({
          apiToken: 'postmark-token',
          fromEmail: '   ',
          fetchImpl: vi.fn(),
        }),
    ).toThrow('sendEmail: missing fromEmail')
  })
})