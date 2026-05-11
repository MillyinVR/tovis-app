// app/api/internal/webhooks/postmark/notifications/route.test.ts

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NotificationDeliveryStatus, NotificationProvider } from '@prisma/client'

const mocks = vi.hoisted(() => ({
  applyDeliveryWebhookUpdate: vi.fn(),
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

import { POST } from './route'

const ORIGINAL_ENV = { ...process.env }

function makeBasicAuth(password: string, username = 'postmark'): string {
  return `Basic ${Buffer.from(`${username}:${password}`, 'utf-8').toString(
    'base64',
  )}`
}

function makeRequest(args?: {
  headers?: Record<string, string>
  body?: Record<string, unknown> | unknown
  search?: string
}) {
  return new Request(
    `http://localhost/api/internal/webhooks/postmark/notifications${
      args?.search ?? ''
    }`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(args?.headers ?? {}),
      },
      body: JSON.stringify(args?.body ?? {}),
    },
  )
}

describe('app/api/internal/webhooks/postmark/notifications/route', () => {
  beforeEach(() => {
    process.env = { ...ORIGINAL_ENV }
    vi.clearAllMocks()

    process.env.POSTMARK_WEBHOOK_SECRET = 'postmark-secret'
    delete process.env.POSTMARK_WEBHOOK_TOKEN

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

  it('returns 500 when the postmark webhook secret is not configured', async () => {
    delete process.env.POSTMARK_WEBHOOK_SECRET
    delete process.env.POSTMARK_WEBHOOK_TOKEN

    const response = await POST(
      makeRequest({
        headers: {
          authorization: 'Bearer postmark-secret',
        },
        body: {
          RecordType: 'Delivery',
          MessageID: 'pm_123',
        },
      }),
    )
    const json = await response.json()

    expect(response.status).toBe(500)
    expect(json).toEqual({
      ok: false,
      error: 'Postmark webhook authentication is not configured.',
      code: 'POSTMARK_WEBHOOK_SECRET_MISSING',
    })
    expect(mocks.applyDeliveryWebhookUpdate).not.toHaveBeenCalled()
  })

  it('accepts POSTMARK_WEBHOOK_TOKEN as fallback secret', async () => {
    delete process.env.POSTMARK_WEBHOOK_SECRET
    process.env.POSTMARK_WEBHOOK_TOKEN = 'postmark-token'

    const response = await POST(
      makeRequest({
        headers: {
          authorization: 'Bearer postmark-token',
        },
        body: {
          RecordType: 'Delivery',
          MessageID: 'pm_token_1',
          DeliveredAt: '2026-04-10T12:00:00.000Z',
        },
      }),
    )
    const json = await response.json()

    expect(response.status).toBe(200)
    expect(json).toMatchObject({
      ok: true,
      matched: true,
      provider: NotificationProvider.POSTMARK,
      providerMessageId: 'pm_token_1',
      providerStatus: 'delivered',
      kind: 'DELIVERED',
    })

    expect(mocks.applyDeliveryWebhookUpdate).toHaveBeenCalledWith({
      provider: NotificationProvider.POSTMARK,
      providerMessageId: 'pm_token_1',
      providerStatus: 'delivered',
      kind: 'DELIVERED',
      occurredAt: new Date('2026-04-10T12:00:00.000Z'),
      errorCode: null,
      errorMessage: null,
      payload: {
        RecordType: 'Delivery',
        MessageID: 'pm_token_1',
        DeliveredAt: '2026-04-10T12:00:00.000Z',
      },
    })
  })

  it('returns 401 when the webhook request is unauthorized', async () => {
    const response = await POST(
      makeRequest({
        body: {
          RecordType: 'Delivery',
          MessageID: 'pm_123',
        },
      }),
    )
    const json = await response.json()

    expect(response.status).toBe(401)
    expect(json).toEqual({
      ok: false,
      error: 'Unauthorized.',
      code: 'POSTMARK_WEBHOOK_UNAUTHORIZED',
    })
    expect(mocks.applyDeliveryWebhookUpdate).not.toHaveBeenCalled()
  })

  it('returns 401 when bearer auth is wrong', async () => {
    const response = await POST(
      makeRequest({
        headers: {
          authorization: 'Bearer wrong-secret',
        },
        body: {
          RecordType: 'Delivery',
          MessageID: 'pm_unauthorized_1',
        },
      }),
    )
    const json = await response.json()

    expect(response.status).toBe(401)
    expect(json).toEqual({
      ok: false,
      error: 'Unauthorized.',
      code: 'POSTMARK_WEBHOOK_UNAUTHORIZED',
    })
    expect(mocks.applyDeliveryWebhookUpdate).not.toHaveBeenCalled()
  })

  it('accepts bearer auth and maps Delivery to DELIVERED', async () => {
    const response = await POST(
      makeRequest({
        headers: {
          authorization: 'Bearer postmark-secret',
        },
        body: {
          RecordType: 'Delivery',
          MessageID: 'pm_delivery_1',
          DeliveredAt: '2026-04-10T12:00:00.000Z',
          Recipient: 'client@example.com',
          MessageStream: 'outbound',
        },
      }),
    )
    const json = await response.json()

    expect(mocks.applyDeliveryWebhookUpdate).toHaveBeenCalledWith({
      provider: NotificationProvider.POSTMARK,
      providerMessageId: 'pm_delivery_1',
      providerStatus: 'delivered',
      kind: 'DELIVERED',
      occurredAt: new Date('2026-04-10T12:00:00.000Z'),
      errorCode: null,
      errorMessage: null,
      payload: {
        RecordType: 'Delivery',
        MessageID: 'pm_delivery_1',
        DeliveredAt: '2026-04-10T12:00:00.000Z',
        Recipient: 'client@example.com',
        MessageStream: 'outbound',
      },
    })

    expect(response.status).toBe(200)
    expect(json).toEqual({
      ok: true,
      matched: true,
      provider: NotificationProvider.POSTMARK,
      providerMessageId: 'pm_delivery_1',
      providerStatus: 'delivered',
      kind: 'DELIVERED',
      deliveryId: 'delivery_1',
      previousStatus: NotificationDeliveryStatus.SENT,
      nextStatus: NotificationDeliveryStatus.DELIVERED,
      statusChanged: true,
    })
  })

  it('accepts basic auth and maps Bounce to FAILED_FINAL', async () => {
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
          authorization: makeBasicAuth('postmark-secret'),
        },
        body: {
          RecordType: 'Bounce',
          MessageID: 'pm_bounce_1',
          Type: 'HardBounce',
          TypeCode: 1,
          Description: 'The server was unable to deliver your message.',
          Details: '550 Requested action not taken: mailbox unavailable.',
          BouncedAt: '2026-04-10T12:05:00.000Z',
          Email: 'client@example.com',
        },
      }),
    )
    const json = await response.json()

    expect(mocks.applyDeliveryWebhookUpdate).toHaveBeenCalledWith({
      provider: NotificationProvider.POSTMARK,
      providerMessageId: 'pm_bounce_1',
      providerStatus: 'bounce:HardBounce',
      kind: 'FAILED_FINAL',
      occurredAt: new Date('2026-04-10T12:05:00.000Z'),
      errorCode: '1',
      errorMessage: 'The server was unable to deliver your message.',
      payload: {
        RecordType: 'Bounce',
        MessageID: 'pm_bounce_1',
        Type: 'HardBounce',
        TypeCode: 1,
        Description: 'The server was unable to deliver your message.',
        Details: '550 Requested action not taken: mailbox unavailable.',
        BouncedAt: '2026-04-10T12:05:00.000Z',
        Email: 'client@example.com',
      },
    })

    expect(response.status).toBe(200)
    expect(json).toEqual({
      ok: true,
      matched: true,
      provider: NotificationProvider.POSTMARK,
      providerMessageId: 'pm_bounce_1',
      providerStatus: 'bounce:HardBounce',
      kind: 'FAILED_FINAL',
      deliveryId: 'delivery_2',
      previousStatus: NotificationDeliveryStatus.SENT,
      nextStatus: NotificationDeliveryStatus.FAILED_FINAL,
      statusChanged: true,
    })
  })

  it('accepts x-postmark-webhook-secret and maps Open to STATUS_UPDATE', async () => {
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
          'x-postmark-webhook-secret': 'postmark-secret',
        },
        body: {
          RecordType: 'Open',
          MessageID: 'pm_open_1',
          FirstOpen: '2026-04-10T12:10:00.000Z',
          Recipient: 'client@example.com',
        },
      }),
    )
    const json = await response.json()

    expect(mocks.applyDeliveryWebhookUpdate).toHaveBeenCalledWith({
      provider: NotificationProvider.POSTMARK,
      providerMessageId: 'pm_open_1',
      providerStatus: 'open',
      kind: 'STATUS_UPDATE',
      occurredAt: new Date('2026-04-10T12:10:00.000Z'),
      errorCode: null,
      errorMessage: null,
      payload: {
        RecordType: 'Open',
        MessageID: 'pm_open_1',
        FirstOpen: '2026-04-10T12:10:00.000Z',
        Recipient: 'client@example.com',
      },
    })

    expect(response.status).toBe(200)
    expect(json).toEqual({
      ok: true,
      matched: true,
      provider: NotificationProvider.POSTMARK,
      providerMessageId: 'pm_open_1',
      providerStatus: 'open',
      kind: 'STATUS_UPDATE',
      deliveryId: 'delivery_3',
      previousStatus: NotificationDeliveryStatus.SENT,
      nextStatus: NotificationDeliveryStatus.SENT,
      statusChanged: false,
    })
  })

  it('maps SpamComplaint to FAILED_FINAL', async () => {
    mocks.applyDeliveryWebhookUpdate.mockResolvedValueOnce({
      matched: true,
      delivery: {
        id: 'delivery_spam_1',
      },
      previousStatus: NotificationDeliveryStatus.SENT,
      nextStatus: NotificationDeliveryStatus.FAILED_FINAL,
      statusChanged: true,
    })

    const response = await POST(
      makeRequest({
        headers: {
          authorization: 'Bearer postmark-secret',
        },
        body: {
          RecordType: 'SpamComplaint',
          MessageID: 'pm_spam_1',
          ReceivedAt: '2026-04-10T12:15:00.000Z',
          Description: 'Recipient marked the email as spam.',
        },
      }),
    )
    const json = await response.json()

    expect(mocks.applyDeliveryWebhookUpdate).toHaveBeenCalledWith({
      provider: NotificationProvider.POSTMARK,
      providerMessageId: 'pm_spam_1',
      providerStatus: 'spam_complaint',
      kind: 'FAILED_FINAL',
      occurredAt: new Date('2026-04-10T12:15:00.000Z'),
      errorCode: null,
      errorMessage: 'Recipient marked the email as spam.',
      payload: {
        RecordType: 'SpamComplaint',
        MessageID: 'pm_spam_1',
        ReceivedAt: '2026-04-10T12:15:00.000Z',
        Description: 'Recipient marked the email as spam.',
      },
    })

    expect(response.status).toBe(200)
    expect(json).toEqual({
      ok: true,
      matched: true,
      provider: NotificationProvider.POSTMARK,
      providerMessageId: 'pm_spam_1',
      providerStatus: 'spam_complaint',
      kind: 'FAILED_FINAL',
      deliveryId: 'delivery_spam_1',
      previousStatus: NotificationDeliveryStatus.SENT,
      nextStatus: NotificationDeliveryStatus.FAILED_FINAL,
      statusChanged: true,
    })
  })

  it('maps Click to STATUS_UPDATE', async () => {
    mocks.applyDeliveryWebhookUpdate.mockResolvedValueOnce({
      matched: true,
      delivery: {
        id: 'delivery_click_1',
      },
      previousStatus: NotificationDeliveryStatus.SENT,
      nextStatus: NotificationDeliveryStatus.SENT,
      statusChanged: false,
    })

    const response = await POST(
      makeRequest({
        headers: {
          authorization: 'Bearer postmark-secret',
        },
        body: {
          RecordType: 'Click',
          MessageID: 'pm_click_1',
          ClickedAt: '2026-04-10T12:20:00.000Z',
        },
      }),
    )
    const json = await response.json()

    expect(mocks.applyDeliveryWebhookUpdate).toHaveBeenCalledWith({
      provider: NotificationProvider.POSTMARK,
      providerMessageId: 'pm_click_1',
      providerStatus: 'click',
      kind: 'STATUS_UPDATE',
      occurredAt: new Date('2026-04-10T12:20:00.000Z'),
      errorCode: null,
      errorMessage: null,
      payload: {
        RecordType: 'Click',
        MessageID: 'pm_click_1',
        ClickedAt: '2026-04-10T12:20:00.000Z',
      },
    })

    expect(response.status).toBe(200)
    expect(json).toEqual({
      ok: true,
      matched: true,
      provider: NotificationProvider.POSTMARK,
      providerMessageId: 'pm_click_1',
      providerStatus: 'click',
      kind: 'STATUS_UPDATE',
      deliveryId: 'delivery_click_1',
      previousStatus: NotificationDeliveryStatus.SENT,
      nextStatus: NotificationDeliveryStatus.SENT,
      statusChanged: false,
    })
  })

  it('returns 400 for invalid json body shape', async () => {
    const response = await POST(
      makeRequest({
        headers: {
          authorization: 'Bearer postmark-secret',
        },
        body: ['not', 'an', 'object'],
      }),
    )
    const json = await response.json()

    expect(response.status).toBe(400)
    expect(json).toEqual({
      ok: false,
      error: 'Invalid JSON body.',
      code: 'POSTMARK_INVALID_JSON',
    })
    expect(mocks.applyDeliveryWebhookUpdate).not.toHaveBeenCalled()
  })

  it('returns 400 when MessageID is missing', async () => {
    const response = await POST(
      makeRequest({
        headers: {
          authorization: 'Bearer postmark-secret',
        },
        body: {
          RecordType: 'Delivery',
          DeliveredAt: '2026-04-10T12:00:00.000Z',
        },
      }),
    )
    const json = await response.json()

    expect(response.status).toBe(400)
    expect(json).toEqual({
      ok: false,
      error: 'Missing MessageID.',
      code: 'POSTMARK_MESSAGE_ID_MISSING',
    })
    expect(mocks.applyDeliveryWebhookUpdate).not.toHaveBeenCalled()
  })

  it('accepts MessageId as a provider message id fallback', async () => {
    const response = await POST(
      makeRequest({
        headers: {
          authorization: 'Bearer postmark-secret',
        },
        body: {
          RecordType: 'Delivery',
          MessageId: 'pm_lower_d_1',
          DeliveredAt: '2026-04-10T12:00:00.000Z',
        },
      }),
    )
    const json = await response.json()

    expect(response.status).toBe(200)
    expect(json).toMatchObject({
      ok: true,
      matched: true,
      provider: NotificationProvider.POSTMARK,
      providerMessageId: 'pm_lower_d_1',
      providerStatus: 'delivered',
      kind: 'DELIVERED',
    })

    expect(mocks.applyDeliveryWebhookUpdate).toHaveBeenCalledWith({
      provider: NotificationProvider.POSTMARK,
      providerMessageId: 'pm_lower_d_1',
      providerStatus: 'delivered',
      kind: 'DELIVERED',
      occurredAt: new Date('2026-04-10T12:00:00.000Z'),
      errorCode: null,
      errorMessage: null,
      payload: {
        RecordType: 'Delivery',
        MessageId: 'pm_lower_d_1',
        DeliveredAt: '2026-04-10T12:00:00.000Z',
      },
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
          authorization: 'Bearer postmark-secret',
        },
        body: {
          RecordType: 'Click',
          MessageID: 'pm_missing_1',
          ClickedAt: '2026-04-10T12:20:00.000Z',
        },
      }),
    )
    const json = await response.json()

    expect(response.status).toBe(200)
    expect(json).toEqual({
      ok: true,
      matched: false,
      provider: NotificationProvider.POSTMARK,
      providerMessageId: 'pm_missing_1',
      providerStatus: 'click',
      kind: 'STATUS_UPDATE',
    })
  })

  it('returns 500 when the webhook helper throws', async () => {
    const consoleErrorSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined)

    mocks.applyDeliveryWebhookUpdate.mockRejectedValueOnce(
      new Error('postmark webhook exploded'),
    )

    try {
      const response = await POST(
        makeRequest({
          headers: {
            authorization: 'Bearer postmark-secret',
          },
          body: {
            RecordType: 'Delivery',
            MessageID: 'pm_err_1',
            DeliveredAt: '2026-04-10T12:00:00.000Z',
          },
        }),
      )
      const json = await response.json()

      expect(response.status).toBe(500)
      expect(json).toEqual({
        ok: false,
        error: 'Internal server error',
        code: 'INTERNAL',
      })

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        'POST /api/internal/webhooks/postmark/notifications error',
        expect.any(Error),
      )
    } finally {
      consoleErrorSpy.mockRestore()
    }
  })
})