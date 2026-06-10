// tests/chaos/db-degradation.test.ts

import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  NotificationChannel,
  NotificationProvider,
} from '@prisma/client'

const mocks = vi.hoisted(() => ({
  jsonOk: vi.fn(),
  jsonFail: vi.fn(),

  processDueDeliveries: vi.fn(),

  getRedis: vi.fn(),

  createInAppDeliveryProvider: vi.fn(),
  createSmsDeliveryProvider: vi.fn(),
  createEmailDeliveryProvider: vi.fn(),

  twilioMessagesCreate: vi.fn(),

  safeError: vi.fn((error: unknown) => ({
    name: error instanceof Error ? error.name : 'NonErrorThrown',
    message: error instanceof Error ? error.message : String(error),
  })),
}))

vi.mock('@/app/api/_utils', () => ({
  jsonOk: mocks.jsonOk,
  jsonFail: mocks.jsonFail,
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

vi.mock('@/lib/security/logging', () => ({
  safeError: mocks.safeError,
}))

vi.mock('@/lib/tenant/resolveTenant', () => ({
  getRootTenantId: vi.fn(async () => 'tenant_root'),
}))

vi.mock('twilio', () => ({
  default: vi.fn(() => ({
    messages: {
      create: mocks.twilioMessagesCreate,
    },
  })),
}))

import { GET, POST } from '@/app/api/internal/jobs/notifications/process/route'

function makeJsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function makeAuthorizedRequest(method: 'GET' | 'POST' = 'POST'): Request {
  return new Request(
    'http://localhost/api/internal/jobs/notifications/process?take=10',
    {
      method,
      headers: {
        authorization: 'Bearer test-job-secret',
      },
    },
  )
}

describe('chaos: DB degradation', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    process.env.INTERNAL_JOB_SECRET = 'test-job-secret'
    process.env.CRON_SECRET = ''

    process.env.TWILIO_ACCOUNT_SID = 'AC_test'
    process.env.TWILIO_AUTH_TOKEN = 'twilio-auth-token'
    process.env.TWILIO_FROM_NUMBER = '+15550001111'

    process.env.POSTMARK_SERVER_TOKEN = 'postmark-token'
    process.env.POSTMARK_FROM_EMAIL = 'hello@tovis.app'
    process.env.POSTMARK_MESSAGE_STREAM = 'outbound'

    mocks.jsonOk.mockImplementation((body: unknown, status = 200) =>
      makeJsonResponse(body, status),
    )

    mocks.jsonFail.mockImplementation(
      (status: number, message: string, extra?: Record<string, unknown>) =>
        makeJsonResponse({ error: message, ...(extra ?? {}) }, status),
    )

    mocks.createInAppDeliveryProvider.mockReturnValue({
      provider: NotificationProvider.INTERNAL_REALTIME,
      channel: NotificationChannel.IN_APP,
      send: vi.fn(),
    })

    mocks.createSmsDeliveryProvider.mockReturnValue({
      provider: NotificationProvider.TWILIO,
      channel: NotificationChannel.SMS,
      send: vi.fn(),
    })

    mocks.createEmailDeliveryProvider.mockReturnValue({
      provider: NotificationProvider.POSTMARK,
      channel: NotificationChannel.EMAIL,
      send: vi.fn(),
    })
  })

  it('returns a controlled 500 instead of leaking database failure details from POST', async () => {
    mocks.processDueDeliveries.mockRejectedValue(
      new Error(
        'PrismaClientInitializationError: database connection refused at postgres://secret-host',
      ),
    )

    const response = await POST(makeAuthorizedRequest('POST'))
    const body = await response.json()

    expect(response.status).toBe(500)
    expect(body).toEqual({
      error: 'Internal server error',
    })

    expect(mocks.jsonFail).toHaveBeenCalledWith(
      500,
      'Internal server error',
    )

    expect(mocks.processDueDeliveries).toHaveBeenCalledWith({
      tenantContext: { isRoot: true, tenantId: 'tenant_root', slug: 'tovis-root' },
      providers: {
        inApp: expect.objectContaining({
          provider: NotificationProvider.INTERNAL_REALTIME,
          channel: NotificationChannel.IN_APP,
        }),
        sms: expect.objectContaining({
          provider: NotificationProvider.TWILIO,
          channel: NotificationChannel.SMS,
        }),
        email: expect.objectContaining({
          provider: NotificationProvider.POSTMARK,
          channel: NotificationChannel.EMAIL,
        }),
      },
      claim: {
        now: expect.any(Date),
        batchSize: 10,
      },
    })

    expect(JSON.stringify(body)).not.toContain('postgres://secret-host')
    expect(JSON.stringify(body)).not.toContain(
      'PrismaClientInitializationError',
    )
  })

  it('returns a controlled 500 instead of leaking database failure details from GET', async () => {
    mocks.processDueDeliveries.mockRejectedValue(
      new Error('database timeout while claiming notification deliveries'),
    )

    const response = await GET(makeAuthorizedRequest('GET'))
    const body = await response.json()

    expect(response.status).toBe(500)
    expect(body).toEqual({
      error: 'Internal server error',
    })

    expect(mocks.jsonFail).toHaveBeenCalledWith(
      500,
      'Internal server error',
    )

    expect(JSON.stringify(body)).not.toContain('database timeout')
  })
})