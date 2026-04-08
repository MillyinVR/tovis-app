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

function makeBasicAuth(password: string, username = 'postmark'): string {
  return `Basic ${Buffer.from(`${username}:${password}`, 'utf-8').toString('base64')}`
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
      error:
        'Missing POSTMARK_WEBHOOK_SECRET or POSTMARK_WEBHOOK_TOKEN configuration.',
    })
    expect(mocks.applyDeliveryWebhookUpdate).not.toHaveBeenCalled()
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
      error: 'Unauthorized',
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
    })
    expect(mocks.applyDeliveryWebhookUpdate).not.toHaveBeenCalled()
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
    mocks.applyDeliveryWebhookUpdate.mockRejectedValueOnce(
      new Error('postmark webhook exploded'),
    )

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
      error: 'postmark webhook exploded',
    })
  })
})