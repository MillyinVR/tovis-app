import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NotificationDeliveryStatus, NotificationProvider } from '@prisma/client'

const mocks = vi.hoisted(() => ({
  applyDeliveryWebhookUpdate: vi.fn(),
  validateRequest: vi.fn(),
}))

vi.mock('@/app/api/_utils', () => ({
  jsonOk: (data: Record<string, unknown>, status = 200) =>
    new Response(JSON.stringify({ ok: true, ...data }), {
      status,
      headers: { 'Content-Type': 'application/json' },
    }),
  jsonFail: (
    status: number,
    error: string,
    extra?: Record<string, unknown>,
  ) =>
    new Response(JSON.stringify({ ok: false, error, ...(extra ?? {}) }), {
      status,
      headers: { 'Content-Type': 'application/json' },
    }),
}))

vi.mock('@/lib/notifications/webhooks/applyDeliveryWebhookUpdate', () => ({
  applyDeliveryWebhookUpdate: mocks.applyDeliveryWebhookUpdate,
}))

vi.mock('twilio', () => ({
  default: {
    validateRequest: mocks.validateRequest,
  },
}))

import { POST } from './route'

function makeRequest(args?: {
  headers?: Record<string, string>
  fields?: Record<string, string>
  search?: string
}) {
  const form = new FormData()

  for (const [key, value] of Object.entries(args?.fields ?? {})) {
    form.set(key, value)
  }

  return new Request(
    `http://localhost/api/internal/webhooks/twilio/notifications/status${
      args?.search ?? ''
    }`,
    {
      method: 'POST',
      headers: args?.headers,
      body: form,
    },
  )
}

describe('app/api/internal/webhooks/twilio/notifications/status/route', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    process.env.TWILIO_AUTH_TOKEN = 'twilio-auth-token'

    mocks.validateRequest.mockReturnValue(true)
    mocks.applyDeliveryWebhookUpdate.mockResolvedValue({
      matched: true,
      delivery: {
        id: 'delivery_1',
      },
      previousStatus: NotificationDeliveryStatus.SENT,
      nextStatus: NotificationDeliveryStatus.DELIVERED,
      statusChanged: true,
    })
  })

  it('returns 500 when TWILIO_AUTH_TOKEN is not configured', async () => {
    delete process.env.TWILIO_AUTH_TOKEN

    const response = await POST(
      makeRequest({
        headers: {
          'x-twilio-signature': 'sig_123',
        },
        fields: {
          MessageSid: 'SM123',
          MessageStatus: 'delivered',
        },
      }),
    )
    const json = await response.json()

    expect(response.status).toBe(500)
    expect(json).toEqual({
      ok: false,
      error: 'Missing TWILIO_AUTH_TOKEN configuration.',
    })
    expect(mocks.validateRequest).not.toHaveBeenCalled()
    expect(mocks.applyDeliveryWebhookUpdate).not.toHaveBeenCalled()
  })

  it('returns 401 when the Twilio signature header is missing', async () => {
    const response = await POST(
      makeRequest({
        fields: {
          MessageSid: 'SM123',
          MessageStatus: 'delivered',
        },
      }),
    )
    const json = await response.json()

    expect(response.status).toBe(401)
    expect(json).toEqual({
      ok: false,
      error: 'Unauthorized',
    })
    expect(mocks.validateRequest).not.toHaveBeenCalled()
    expect(mocks.applyDeliveryWebhookUpdate).not.toHaveBeenCalled()
  })

  it('returns 401 when Twilio signature validation fails', async () => {
    mocks.validateRequest.mockReturnValueOnce(false)

    const response = await POST(
      makeRequest({
        headers: {
          'x-twilio-signature': 'bad_sig',
          'x-forwarded-proto': 'https',
          'x-forwarded-host': 'api.tovis.app',
        },
        fields: {
          MessageSid: 'SM123',
          MessageStatus: 'delivered',
        },
      }),
    )
    const json = await response.json()

    expect(mocks.validateRequest).toHaveBeenCalledWith(
      'twilio-auth-token',
      'bad_sig',
      'https://api.tovis.app/api/internal/webhooks/twilio/notifications/status',
      {
        MessageSid: 'SM123',
        MessageStatus: 'delivered',
      },
    )

    expect(response.status).toBe(401)
    expect(json).toEqual({
      ok: false,
      error: 'Unauthorized',
    })
    expect(mocks.applyDeliveryWebhookUpdate).not.toHaveBeenCalled()
  })

  it('returns 400 when MessageSid and SmsSid are missing', async () => {
    const response = await POST(
      makeRequest({
        headers: {
          'x-twilio-signature': 'sig_123',
        },
        fields: {
          MessageStatus: 'delivered',
        },
      }),
    )
    const json = await response.json()

    expect(response.status).toBe(400)
    expect(json).toEqual({
      ok: false,
      error: 'Missing MessageSid or SmsSid.',
    })
    expect(mocks.applyDeliveryWebhookUpdate).not.toHaveBeenCalled()
  })

  it('returns 400 when MessageStatus and SmsStatus are missing', async () => {
    const response = await POST(
      makeRequest({
        headers: {
          'x-twilio-signature': 'sig_123',
        },
        fields: {
          MessageSid: 'SM123',
        },
      }),
    )
    const json = await response.json()

    expect(response.status).toBe(400)
    expect(json).toEqual({
      ok: false,
      error: 'Missing MessageStatus or SmsStatus.',
    })
    expect(mocks.applyDeliveryWebhookUpdate).not.toHaveBeenCalled()
  })

  it('maps delivered to DELIVERED and passes webhook data through', async () => {
    const response = await POST(
      makeRequest({
        headers: {
          'x-twilio-signature': 'sig_123',
          'x-forwarded-proto': 'https',
          'x-forwarded-host': 'api.tovis.app',
        },
        fields: {
          MessageSid: 'SM_DELIVERED_1',
          MessageStatus: 'delivered',
          ErrorCode: '',
          ErrorMessage: '',
          To: '+15551234567',
          From: '+15550000000',
        },
      }),
    )
    const json = await response.json()

    expect(mocks.applyDeliveryWebhookUpdate).toHaveBeenCalledWith({
      provider: NotificationProvider.TWILIO,
      providerMessageId: 'SM_DELIVERED_1',
      providerStatus: 'delivered',
      kind: 'DELIVERED',
      occurredAt: expect.any(Date),
      errorCode: null,
      errorMessage: null,
      payload: {
        MessageSid: 'SM_DELIVERED_1',
        MessageStatus: 'delivered',
        ErrorCode: '',
        ErrorMessage: '',
        To: '+15551234567',
        From: '+15550000000',
      },
    })

    expect(response.status).toBe(200)
    expect(json).toEqual({
      ok: true,
      matched: true,
      provider: NotificationProvider.TWILIO,
      providerMessageId: 'SM_DELIVERED_1',
      providerStatus: 'delivered',
      kind: 'DELIVERED',
      deliveryId: 'delivery_1',
      previousStatus: NotificationDeliveryStatus.SENT,
      nextStatus: NotificationDeliveryStatus.DELIVERED,
      statusChanged: true,
    })
  })

  it('maps undelivered to FAILED_FINAL', async () => {
    mocks.applyDeliveryWebhookUpdate.mockResolvedValueOnce({
      matched: true,
      delivery: {
        id: 'delivery_2',
      },
      previousStatus: NotificationDeliveryStatus.SENT,
      nextStatus: NotificationDeliveryStatus.FAILED_FINAL,
      statusChanged: true,
    })

    const response = await POST(
      makeRequest({
        headers: {
          'x-twilio-signature': 'sig_123',
        },
        fields: {
          SmsSid: 'SM_FAILED_1',
          SmsStatus: 'undelivered',
          ErrorCode: '30003',
          ErrorMessage: 'Unreachable destination handset.',
        },
      }),
    )
    const json = await response.json()

    expect(mocks.applyDeliveryWebhookUpdate).toHaveBeenCalledWith({
      provider: NotificationProvider.TWILIO,
      providerMessageId: 'SM_FAILED_1',
      providerStatus: 'undelivered',
      kind: 'FAILED_FINAL',
      occurredAt: expect.any(Date),
      errorCode: '30003',
      errorMessage: 'Unreachable destination handset.',
      payload: {
        SmsSid: 'SM_FAILED_1',
        SmsStatus: 'undelivered',
        ErrorCode: '30003',
        ErrorMessage: 'Unreachable destination handset.',
      },
    })

    expect(response.status).toBe(200)
    expect(json).toEqual({
      ok: true,
      matched: true,
      provider: NotificationProvider.TWILIO,
      providerMessageId: 'SM_FAILED_1',
      providerStatus: 'undelivered',
      kind: 'FAILED_FINAL',
      deliveryId: 'delivery_2',
      previousStatus: NotificationDeliveryStatus.SENT,
      nextStatus: NotificationDeliveryStatus.FAILED_FINAL,
      statusChanged: true,
    })
  })

  it('maps queued to STATUS_UPDATE', async () => {
    mocks.applyDeliveryWebhookUpdate.mockResolvedValueOnce({
      matched: true,
      delivery: {
        id: 'delivery_3',
      },
      previousStatus: NotificationDeliveryStatus.SENT,
      nextStatus: NotificationDeliveryStatus.SENT,
      statusChanged: false,
    })

    const response = await POST(
      makeRequest({
        headers: {
          'x-twilio-signature': 'sig_123',
        },
        fields: {
          MessageSid: 'SM_QUEUED_1',
          MessageStatus: 'queued',
        },
      }),
    )
    const json = await response.json()

    expect(mocks.applyDeliveryWebhookUpdate).toHaveBeenCalledWith({
      provider: NotificationProvider.TWILIO,
      providerMessageId: 'SM_QUEUED_1',
      providerStatus: 'queued',
      kind: 'STATUS_UPDATE',
      occurredAt: expect.any(Date),
      errorCode: null,
      errorMessage: null,
      payload: {
        MessageSid: 'SM_QUEUED_1',
        MessageStatus: 'queued',
      },
    })

    expect(response.status).toBe(200)
    expect(json).toEqual({
      ok: true,
      matched: true,
      provider: NotificationProvider.TWILIO,
      providerMessageId: 'SM_QUEUED_1',
      providerStatus: 'queued',
      kind: 'STATUS_UPDATE',
      deliveryId: 'delivery_3',
      previousStatus: NotificationDeliveryStatus.SENT,
      nextStatus: NotificationDeliveryStatus.SENT,
      statusChanged: false,
    })
  })

  it('returns matched false when no delivery row matches the provider message id', async () => {
    mocks.applyDeliveryWebhookUpdate.mockResolvedValueOnce({
      matched: false,
      delivery: null,
    })

    const response = await POST(
      makeRequest({
        headers: {
          'x-twilio-signature': 'sig_123',
        },
        fields: {
          MessageSid: 'SM_MISSING_1',
          MessageStatus: 'sent',
        },
      }),
    )
    const json = await response.json()

    expect(response.status).toBe(200)
    expect(json).toEqual({
      ok: true,
      matched: false,
      provider: NotificationProvider.TWILIO,
      providerMessageId: 'SM_MISSING_1',
      providerStatus: 'sent',
      kind: 'STATUS_UPDATE',
    })
  })

  it('returns 500 when the webhook update helper throws', async () => {
    mocks.applyDeliveryWebhookUpdate.mockRejectedValueOnce(
      new Error('webhook update exploded'),
    )

    const response = await POST(
      makeRequest({
        headers: {
          'x-twilio-signature': 'sig_123',
        },
        fields: {
          MessageSid: 'SM_ERR_1',
          MessageStatus: 'delivered',
        },
      }),
    )
    const json = await response.json()

    expect(response.status).toBe(500)
    expect(json).toEqual({
      ok: false,
      error: 'webhook update exploded',
    })
  })
})