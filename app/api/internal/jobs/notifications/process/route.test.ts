import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NotificationChannel, NotificationProvider } from '@prisma/client'

const NOW = new Date('2026-04-13T18:30:00.000Z')

const mocks = vi.hoisted(() => ({
  jsonFail: vi.fn(),
  jsonOk: vi.fn(),

  processDueDeliveries: vi.fn(),

  createInAppDeliveryProvider: vi.fn(),
  createSmsDeliveryProvider: vi.fn(),
  createEmailDeliveryProvider: vi.fn(),

  getRedis: vi.fn(),
  redisPublish: vi.fn(),
  redisIncr: vi.fn(),

  twilioFactory: vi.fn(),
  twilioMessageCreate: vi.fn(),

  safeError: vi.fn((error: unknown) => ({
    name: error instanceof Error ? error.name : 'NonErrorThrown',
    message: error instanceof Error ? error.message : String(error),
  })),
}))


vi.mock('@/lib/tenant/resolveTenant', () => ({
  getRootTenantId: vi.fn(async () => 'tenant_root'),
}))

vi.mock('@/app/api/_utils', () => ({
  jsonFail: mocks.jsonFail,
  jsonOk: mocks.jsonOk,
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

vi.mock('@/lib/security/logging', () => ({
  safeError: mocks.safeError,
}))

import { GET, POST } from './route'

function makeJsonResponse(status: number, payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'content-type': 'application/json',
    },
  })
}

function makeRequest(args?: {
  method?: 'GET' | 'POST'
  url?: string
  authorization?: string
  internalSecret?: string
}): Request {
  const headers = new Headers()

  if (args?.authorization) {
    headers.set('authorization', args.authorization)
  }

  if (args?.internalSecret) {
    headers.set('x-internal-job-secret', args.internalSecret)
  }

  return new Request(
    args?.url ?? 'http://localhost/api/internal/jobs/notifications/process',
    {
      method: args?.method ?? 'GET',
      headers,
    },
  )
}

function setRequiredEnv(): void {
  process.env.INTERNAL_JOB_SECRET = 'job_secret_1'
  process.env.TWILIO_ACCOUNT_SID = 'twilio_sid_1'
  process.env.TWILIO_AUTH_TOKEN = 'twilio_token_1'
  process.env.TWILIO_FROM_NUMBER = '+15550001111'
  process.env.POSTMARK_SERVER_TOKEN = 'postmark_token_1'
  process.env.POSTMARK_FROM_EMAIL = 'hello@example.com'
  process.env.POSTMARK_MESSAGE_STREAM = 'outbound'
}

function clearEnv(): void {
  delete process.env.INTERNAL_JOB_SECRET
  delete process.env.CRON_SECRET
  delete process.env.TWILIO_ACCOUNT_SID
  delete process.env.TWILIO_AUTH_TOKEN
  delete process.env.TWILIO_FROM_NUMBER
  delete process.env.POSTMARK_SERVER_TOKEN
  delete process.env.POSTMARK_FROM_EMAIL
  delete process.env.POSTMARK_MESSAGE_STREAM
}

describe('app/api/internal/jobs/notifications/process/route.ts', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    vi.setSystemTime(NOW)

    clearEnv()
    setRequiredEnv()

    mocks.jsonFail.mockImplementation((status: number, error: string) =>
      makeJsonResponse(status, {
        ok: false,
        error,
      }),
    )

    mocks.jsonOk.mockImplementation((data: Record<string, unknown>) =>
      makeJsonResponse(200, {
        ok: true,
        ...data,
      }),
    )

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
          responseMeta: {
            args,
            request,
          },
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

  it('GET returns 500 when no job secret is configured', async () => {
    delete process.env.INTERNAL_JOB_SECRET
    delete process.env.CRON_SECRET

    const result = await GET(
      makeRequest({
        authorization: 'Bearer job_secret_1',
      }),
    )

    expect(result.status).toBe(500)
    await expect(result.json()).resolves.toEqual({
      ok: false,
      error: 'Missing INTERNAL_JOB_SECRET or CRON_SECRET configuration.',
    })

    expect(mocks.processDueDeliveries).not.toHaveBeenCalled()
  })

  it('GET returns 401 when request is unauthorized', async () => {
    const result = await GET(makeRequest())

    expect(result.status).toBe(401)
    await expect(result.json()).resolves.toEqual({
      ok: false,
      error: 'Unauthorized',
    })

    expect(mocks.processDueDeliveries).not.toHaveBeenCalled()
  })

  it('GET builds providers, clamps take, processes due deliveries, and returns summary', async () => {
    const result = await GET(
      makeRequest({
        url: 'http://localhost/api/internal/jobs/notifications/process?take=999',
        authorization: 'Bearer job_secret_1',
      }),
    )

    expect(mocks.twilioFactory).toHaveBeenCalledWith(
      'twilio_sid_1',
      'twilio_token_1',
    )

    expect(mocks.createSmsDeliveryProvider).toHaveBeenCalledWith({
      fromNumber: '+15550001111',
      client: {
        messages: {
          create: expect.any(Function),
        },
      },
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
      },
      claim: {
        now: NOW,
        batchSize: 250,
      },
    })

    expect(result.status).toBe(200)
    await expect(result.json()).resolves.toEqual({
      ok: true,
      claimedCount: 0,
      sentCount: 0,
      failedCount: 0,
      skippedCount: 0,
      take: 250,
      processedAt: NOW.toISOString(),
    })
  })

  it('POST accepts x-internal-job-secret and uses default take', async () => {
    const result = await POST(
      makeRequest({
        method: 'POST',
        internalSecret: 'job_secret_1',
      }),
    )

    expect(mocks.processDueDeliveries).toHaveBeenCalledWith(
      expect.objectContaining({
        claim: {
          now: NOW,
          batchSize: 100,
        },
      }),
    )

    expect(result.status).toBe(200)
    await expect(result.json()).resolves.toEqual({
      ok: true,
      claimedCount: 0,
      sentCount: 0,
      failedCount: 0,
      skippedCount: 0,
      take: 100,
      processedAt: NOW.toISOString(),
    })
  })

  it('uses CRON_SECRET when INTERNAL_JOB_SECRET is missing', async () => {
    delete process.env.INTERNAL_JOB_SECRET
    process.env.CRON_SECRET = 'cron_secret_1'

    const result = await GET(
      makeRequest({
        authorization: 'Bearer cron_secret_1',
      }),
    )

    expect(result.status).toBe(200)
    expect(mocks.processDueDeliveries).toHaveBeenCalled()
  })

  it('provider registry in-app sender publishes realtime notification and increments version', async () => {
    await GET(
      makeRequest({
        authorization: 'Bearer job_secret_1',
      }),
    )

    const call = mocks.processDueDeliveries.mock.calls[0]?.[0]
    const providers = call.providers

    const result = await providers.inApp.send({
      id: 'delivery_1',
      idempotencyKey: 'inapp_idem_from_request',
      recipientInAppTargetId: 'client_123',
      payload: {
        hello: 'world',
      },
    })

    expect(mocks.redisPublish).toHaveBeenCalledWith(
      'notifications:in-app:client_123',
      JSON.stringify({
        idempotencyKey: 'inapp_idem_from_request',
        recipientInAppTargetId: 'client_123',
        id: 'delivery_1',
        payload: {
          hello: 'world',
        },
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
        source: 'app/api/internal/jobs/notifications/process',
        channel: 'notifications:in-app:client_123',
        version: 7,
        subscriberCount: 2,
      },
    })
  })

  it('provider registry in-app sender throws when Redis is not configured', async () => {
    mocks.getRedis.mockReturnValueOnce(null)

    await GET(
      makeRequest({
        authorization: 'Bearer job_secret_1',
      }),
    )

    const call = mocks.processDueDeliveries.mock.calls[0]?.[0]
    const providers = call.providers

    await expect(
      providers.inApp.send({
        idempotencyKey: 'inapp_idem_1',
        recipientInAppTargetId: 'client_1',
      }),
    ).rejects.toThrow(
      'Redis is not configured. Set UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN (or KV_REST_API_URL + KV_REST_API_TOKEN).',
    )
  })

  it('provider registry sms sender delegates through Twilio client wrapper', async () => {
    await GET(
      makeRequest({
        authorization: 'Bearer job_secret_1',
      }),
    )

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
    // BUG 1 regression: a missing Twilio var must NOT take down the worker. The
    // registry is built conditionally, so SMS drops to null while in-app + email
    // still process. The Twilio client is never constructed.
    delete process.env.TWILIO_AUTH_TOKEN

    const result = await GET(
      makeRequest({
        authorization: 'Bearer job_secret_1',
      }),
    )

    expect(mocks.twilioFactory).not.toHaveBeenCalled()
    expect(mocks.createSmsDeliveryProvider).not.toHaveBeenCalled()

    expect(mocks.processDueDeliveries).toHaveBeenCalledWith(
      expect.objectContaining({
        providers: {
          inApp: {
            provider: NotificationProvider.INTERNAL_REALTIME,
            channel: NotificationChannel.IN_APP,
            send: expect.any(Function),
          },
          sms: null,
          email: {
            provider: NotificationProvider.POSTMARK,
            channel: NotificationChannel.EMAIL,
            send: expect.any(Function),
          },
        },
      }),
    )

    expect(result.status).toBe(200)
  })

  it('omits the email provider (no crash) when Postmark is not configured', async () => {
    delete process.env.POSTMARK_SERVER_TOKEN

    const result = await GET(
      makeRequest({
        authorization: 'Bearer job_secret_1',
      }),
    )

    expect(mocks.createEmailDeliveryProvider).not.toHaveBeenCalled()

    expect(mocks.processDueDeliveries).toHaveBeenCalledWith(
      expect.objectContaining({
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
          email: null,
        },
      }),
    )

    expect(result.status).toBe(200)
  })

  it('still processes in-app deliveries when neither SMS nor email is configured', async () => {
    // The whole point of BUG 1: in-app needs no provider and must never be
    // blocked by missing Twilio/Postmark config.
    delete process.env.TWILIO_ACCOUNT_SID
    delete process.env.TWILIO_AUTH_TOKEN
    delete process.env.TWILIO_FROM_NUMBER
    delete process.env.POSTMARK_SERVER_TOKEN
    delete process.env.POSTMARK_FROM_EMAIL

    const result = await GET(
      makeRequest({
        authorization: 'Bearer job_secret_1',
      }),
    )

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
        },
      }),
    )

    expect(result.status).toBe(200)
  })

  it('POST logs safely and returns generic 500 when processing throws', async () => {
    const consoleErrorSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined)

    const thrown = new Error('delivery failed for tori@example.com token secret')
    mocks.processDueDeliveries.mockRejectedValueOnce(thrown)

    const result = await POST(
      makeRequest({
        method: 'POST',
        authorization: 'Bearer job_secret_1',
      }),
    )

    expect(mocks.safeError).toHaveBeenCalledWith(thrown)
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      'POST /api/internal/jobs/notifications/process error',
      {
        error: {
          name: 'Error',
          message: 'delivery failed for tori@example.com token secret',
        },
      },
    )

    expect(result.status).toBe(500)
    await expect(result.json()).resolves.toEqual({
      ok: false,
      error: 'Internal server error',
    })

    consoleErrorSpy.mockRestore()
  })
})