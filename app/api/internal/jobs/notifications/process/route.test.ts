import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NotificationChannel, NotificationProvider } from '@prisma/client'

const mocks = vi.hoisted(() => ({
  processDueDeliveries: vi.fn(),

  createInAppDeliveryProvider: vi.fn(),
  createSmsDeliveryProvider: vi.fn(),
  createEmailDeliveryProvider: vi.fn(),

  inAppSend: vi.fn(),
  smsSend: vi.fn(),
  emailSend: vi.fn(),

  getRedis: vi.fn(),
  redisPublish: vi.fn(),
  redisIncr: vi.fn(),

  twilioCtor: vi.fn(),
  twilioMessagesCreate: vi.fn(),
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
  default: mocks.twilioCtor,
}))

import { GET, POST } from './route'

function makeRequest(args?: {
  method?: 'GET' | 'POST'
  search?: string
  headers?: Record<string, string>
}) {
  const method = args?.method ?? 'GET'
  const search = args?.search ?? ''

  return new Request(
    `http://localhost/api/internal/jobs/notifications/process${search}`,
    {
      method,
      headers: args?.headers,
    },
  )
}

describe('app/api/internal/jobs/notifications/process/route', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    process.env.INTERNAL_JOB_SECRET = 'test-secret'
    delete process.env.CRON_SECRET

    process.env.TWILIO_ACCOUNT_SID = 'twilio-sid'
    process.env.TWILIO_AUTH_TOKEN = 'twilio-token'
    process.env.TWILIO_FROM_NUMBER = '+15550000000'

    process.env.POSTMARK_SERVER_TOKEN = 'postmark-token'
    process.env.POSTMARK_FROM_EMAIL = 'support@tovis.app'
    process.env.POSTMARK_MESSAGE_STREAM = 'outbound'

    mocks.redisPublish.mockResolvedValue(1)
    mocks.redisIncr.mockResolvedValue(2)
    mocks.getRedis.mockReturnValue({
      publish: mocks.redisPublish,
      incr: mocks.redisIncr,
    })

    mocks.inAppSend.mockResolvedValue({
      ok: true,
      providerMessageId: 'in_app_msg_1',
      providerStatus: 'published',
      responseMeta: {
        source: 'sendInApp',
      },
    })
    mocks.smsSend.mockResolvedValue({
      ok: true,
      providerMessageId: 'sms_msg_1',
      providerStatus: 'queued',
      responseMeta: {
        source: 'sendSms',
      },
    })
    mocks.emailSend.mockResolvedValue({
      ok: true,
      providerMessageId: 'email_msg_1',
      providerStatus: 'accepted',
      responseMeta: {
        source: 'sendEmail',
      },
    })

    mocks.createInAppDeliveryProvider.mockReturnValue({
      send: mocks.inAppSend,
    })
    mocks.createSmsDeliveryProvider.mockReturnValue({
      send: mocks.smsSend,
    })
    mocks.createEmailDeliveryProvider.mockReturnValue({
      send: mocks.emailSend,
    })

    mocks.twilioMessagesCreate.mockResolvedValue({
      sid: 'SM123',
      to: '+15551234567',
      body: 'hello',
      status: 'queued',
    })
    mocks.twilioCtor.mockReturnValue({
      messages: {
        create: mocks.twilioMessagesCreate,
      },
    })

    mocks.processDueDeliveries.mockResolvedValue({
      claimedCount: 2,
      processedCount: 2,
      sentCount: 1,
      retryScheduledCount: 1,
      finalFailureCount: 0,
      orchestrationErrorCount: 0,
      outcomes: [
        {
          deliveryId: 'delivery_1',
          provider: NotificationProvider.INTERNAL_REALTIME,
          channel: NotificationChannel.IN_APP,
          result: 'SENT',
        },
        {
          deliveryId: 'delivery_2',
          provider: NotificationProvider.POSTMARK,
          channel: NotificationChannel.EMAIL,
          result: 'RETRY_SCHEDULED',
          nextAttemptAt: new Date('2026-04-10T12:05:00.000Z'),
        },
      ],
    })
  })

  it('returns 500 when the internal job secret is not configured', async () => {
    delete process.env.INTERNAL_JOB_SECRET
    delete process.env.CRON_SECRET

    const response = await GET(makeRequest())
    const json = await response.json()

    expect(response.status).toBe(500)
    expect(json).toEqual({
      ok: false,
      error: 'Missing INTERNAL_JOB_SECRET or CRON_SECRET configuration.',
    })
    expect(mocks.processDueDeliveries).not.toHaveBeenCalled()
  })

  it('returns 401 when the request is unauthorized', async () => {
    const response = await GET(makeRequest())
    const json = await response.json()

    expect(response.status).toBe(401)
    expect(json).toEqual({
      ok: false,
      error: 'Unauthorized',
    })
    expect(mocks.processDueDeliveries).not.toHaveBeenCalled()
  })

  it('processes deliveries on GET and builds the provider registry with configured env values', async () => {
    const response = await GET(
      makeRequest({
        method: 'GET',
        search: '?take=5',
        headers: {
          authorization: 'Bearer test-secret',
        },
      }),
    )
    const json = await response.json()

    expect(mocks.twilioCtor).toHaveBeenCalledWith('twilio-sid', 'twilio-token')

    expect(mocks.createSmsDeliveryProvider).toHaveBeenCalledWith({
      client: {
        messages: {
          create: expect.any(Function),
        },
      },
    })

    expect(mocks.createEmailDeliveryProvider).toHaveBeenCalledWith({
      apiToken: 'postmark-token',
      fromEmail: 'support@tovis.app',
      messageStream: 'outbound',
    })

    expect(mocks.createInAppDeliveryProvider).toHaveBeenCalledWith({
      publish: expect.any(Function),
    })

    expect(mocks.processDueDeliveries).toHaveBeenCalledWith({
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
      },
      claim: {
        now: expect.any(Date),
        batchSize: 5,
      },
    })

    expect(response.status).toBe(200)
    expect(json).toEqual({
      ok: true,
      claimedCount: 2,
      processedCount: 2,
      sentCount: 1,
      retryScheduledCount: 1,
      finalFailureCount: 0,
      orchestrationErrorCount: 0,
      outcomes: [
        {
          deliveryId: 'delivery_1',
          provider: NotificationProvider.INTERNAL_REALTIME,
          channel: NotificationChannel.IN_APP,
          result: 'SENT',
        },
        {
          deliveryId: 'delivery_2',
          provider: NotificationProvider.POSTMARK,
          channel: NotificationChannel.EMAIL,
          result: 'RETRY_SCHEDULED',
          nextAttemptAt: '2026-04-10T12:05:00.000Z',
        },
      ],
      take: 5,
      processedAt: expect.any(String),
    })
  })

  it('accepts x-internal-job-secret on POST', async () => {
    const response = await POST(
      makeRequest({
        method: 'POST',
        headers: {
          'x-internal-job-secret': 'test-secret',
        },
      }),
    )
    const json = await response.json()

    expect(response.status).toBe(200)
    expect(json.ok).toBe(true)
    expect(mocks.processDueDeliveries).toHaveBeenCalledTimes(1)

    const call = mocks.processDueDeliveries.mock.calls[0]?.[0]
    expect(call.claim.batchSize).toBe(100)
    expect(call.claim.now).toBeInstanceOf(Date)
  })

  it('returns 500 when postmark configuration is missing', async () => {
    delete process.env.POSTMARK_SERVER_TOKEN

    const response = await GET(
      makeRequest({
        headers: {
          authorization: 'Bearer test-secret',
        },
      }),
    )
    const json = await response.json()

    expect(response.status).toBe(500)
    expect(json).toEqual({
      ok: false,
      error: 'Missing POSTMARK_SERVER_TOKEN configuration.',
    })
    expect(mocks.processDueDeliveries).not.toHaveBeenCalled()
    expect(mocks.createEmailDeliveryProvider).not.toHaveBeenCalled()
  })

  it('returns 500 when processDueDeliveries throws', async () => {
    mocks.processDueDeliveries.mockRejectedValueOnce(
      new Error('notification worker exploded'),
    )

    const response = await GET(
      makeRequest({
        headers: {
          authorization: 'Bearer test-secret',
        },
      }),
    )
    const json = await response.json()

    expect(response.status).toBe(500)
    expect(json).toEqual({
      ok: false,
      error: 'notification worker exploded',
    })
  })

  it('falls back to CRON_SECRET when INTERNAL_JOB_SECRET is absent', async () => {
    delete process.env.INTERNAL_JOB_SECRET
    process.env.CRON_SECRET = 'cron-secret'

    const response = await GET(
      makeRequest({
        headers: {
          authorization: 'Bearer cron-secret',
        },
      }),
    )
    const json = await response.json()

    expect(response.status).toBe(200)
    expect(json.ok).toBe(true)
    expect(mocks.processDueDeliveries).toHaveBeenCalledTimes(1)
  })
})