// app/api/internal/cron/retry-verification-emails/route.test.ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AuthVerificationPurpose } from '@prisma/client'

const TEST_NOW = new Date('2026-04-16T12:00:00.000Z')

const mocks = vi.hoisted(() => ({
  prismaUserFindMany: vi.fn(),

  getAppUrlFromRequest: vi.fn(),
  issueAndSendEmailVerification: vi.fn(),

  captureAuthException: vi.fn(),
  logAuthEvent: vi.fn(),
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

vi.mock('@/lib/prisma', () => ({
  prisma: {
    user: {
      findMany: mocks.prismaUserFindMany,
    },
  },
}))

vi.mock('@/lib/auth/emailVerification', () => ({
  getAppUrlFromRequest: mocks.getAppUrlFromRequest,
  issueAndSendEmailVerification: mocks.issueAndSendEmailVerification,
}))

vi.mock('@/lib/observability/authEvents', () => ({
  captureAuthException: mocks.captureAuthException,
  logAuthEvent: mocks.logAuthEvent,
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
    `http://localhost/api/internal/cron/retry-verification-emails${search}`,
    {
      method,
      headers: args?.headers,
    },
  )
}

describe('app/api/internal/cron/retry-verification-emails/route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    vi.setSystemTime(TEST_NOW)

    delete process.env.CRON_SECRET
    process.env.INTERNAL_JOB_SECRET = 'test-secret'

    mocks.getAppUrlFromRequest.mockReturnValue('https://app.tovis.app')
    mocks.prismaUserFindMany.mockResolvedValue([])
    mocks.issueAndSendEmailVerification.mockResolvedValue({
      id: 'evt_1',
      expiresAt: new Date('2026-04-17T12:00:00.000Z'),
    })
  })

  afterEach(() => {
    vi.useRealTimers()
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

    expect(mocks.getAppUrlFromRequest).not.toHaveBeenCalled()
    expect(mocks.prismaUserFindMany).not.toHaveBeenCalled()
    expect(mocks.issueAndSendEmailVerification).not.toHaveBeenCalled()
  })

  it('returns 401 when the request is unauthorized', async () => {
    const response = await GET(makeRequest())
    const json = await response.json()

    expect(response.status).toBe(401)
    expect(json).toEqual({
      ok: false,
      error: 'Unauthorized',
    })

    expect(mocks.getAppUrlFromRequest).not.toHaveBeenCalled()
    expect(mocks.prismaUserFindMany).not.toHaveBeenCalled()
    expect(mocks.issueAndSendEmailVerification).not.toHaveBeenCalled()
  })

  it('returns 500 when the app URL cannot be resolved', async () => {
    mocks.getAppUrlFromRequest.mockReturnValueOnce(null)

    const response = await GET(
      makeRequest({
        headers: {
          authorization: 'Bearer test-secret',
        },
      }),
    )
    const json = await response.json()

    expect(mocks.getAppUrlFromRequest).toHaveBeenCalledTimes(1)
    expect(response.status).toBe(500)
    expect(json).toEqual({
      ok: false,
      error: 'App URL is not configured.',
      code: 'APP_URL_MISSING',
    })

    expect(mocks.prismaUserFindMany).not.toHaveBeenCalled()
    expect(mocks.issueAndSendEmailVerification).not.toHaveBeenCalled()
  })

  it('retries eligible verification emails on GET', async () => {
    mocks.prismaUserFindMany.mockResolvedValue([
      {
        id: 'user_1',
        email: 'one@example.com',
        createdAt: new Date('2026-04-16T11:40:00.000Z'),
      },
      {
        id: 'user_2',
        email: 'two@example.com',
        createdAt: new Date('2026-04-16T11:30:00.000Z'),
      },
    ])

    const response = await GET(
      makeRequest({
        search: '?take=5',
        headers: {
          authorization: 'Bearer test-secret',
        },
      }),
    )
    const json = await response.json()

    expect(mocks.getAppUrlFromRequest).toHaveBeenCalledTimes(1)

    expect(mocks.prismaUserFindMany).toHaveBeenCalledWith({
      where: {
        emailVerifiedAt: null,
        createdAt: {
          lte: new Date('2026-04-16T11:55:00.000Z'),
        },
        email: {
          not: null,
        },
        emailVerificationTokens: {
          none: {
            purpose: AuthVerificationPurpose.EMAIL_VERIFY,
            usedAt: null,
            expiresAt: {
              gt: TEST_NOW,
            },
          },
        },
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: 5,
      select: {
        id: true,
        email: true,
        createdAt: true,
      },
    })

    expect(mocks.issueAndSendEmailVerification).toHaveBeenCalledTimes(2)
    expect(mocks.issueAndSendEmailVerification).toHaveBeenNthCalledWith(1, {
      userId: 'user_1',
      email: 'one@example.com',
      appUrl: 'https://app.tovis.app',
    })
    expect(mocks.issueAndSendEmailVerification).toHaveBeenNthCalledWith(2, {
      userId: 'user_2',
      email: 'two@example.com',
      appUrl: 'https://app.tovis.app',
    })

    expect(mocks.logAuthEvent).toHaveBeenCalledTimes(2)
    expect(mocks.logAuthEvent).toHaveBeenNthCalledWith(1, {
      level: 'info',
      event: 'auth.email.retry_verification.sent',
      route: 'internal.cron.retry_verification_emails',
      provider: 'postmark',
      userId: 'user_1',
      email: 'one@example.com',
    })
    expect(mocks.logAuthEvent).toHaveBeenNthCalledWith(2, {
      level: 'info',
      event: 'auth.email.retry_verification.sent',
      route: 'internal.cron.retry_verification_emails',
      provider: 'postmark',
      userId: 'user_2',
      email: 'two@example.com',
    })

    expect(mocks.captureAuthException).not.toHaveBeenCalled()

    expect(response.status).toBe(200)
    expect(json).toEqual({
      ok: true,
      scannedCount: 2,
      attemptedCount: 2,
      sentCount: 2,
      failedCount: 0,
      skippedCount: 0,
      take: 5,
      processedAt: TEST_NOW.toISOString(),
      failed: [],
    })
  })

  it('accepts x-internal-job-secret on POST and uses the default take', async () => {
    mocks.prismaUserFindMany.mockResolvedValue([
      {
        id: 'user_10',
        email: 'ten@example.com',
        createdAt: new Date('2026-04-16T11:00:00.000Z'),
      },
    ])

    const response = await POST(
      makeRequest({
        method: 'POST',
        headers: {
          'x-internal-job-secret': 'test-secret',
        },
      }),
    )
    const json = await response.json()

    expect(mocks.prismaUserFindMany).toHaveBeenCalledWith({
      where: {
        emailVerifiedAt: null,
        createdAt: {
          lte: new Date('2026-04-16T11:55:00.000Z'),
        },
        email: {
          not: null,
        },
        emailVerificationTokens: {
          none: {
            purpose: AuthVerificationPurpose.EMAIL_VERIFY,
            usedAt: null,
            expiresAt: {
              gt: TEST_NOW,
            },
          },
        },
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: 50,
      select: {
        id: true,
        email: true,
        createdAt: true,
      },
    })

    expect(response.status).toBe(200)
    expect(json.ok).toBe(true)
    expect(json.take).toBe(50)
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
    expect(mocks.prismaUserFindMany).toHaveBeenCalledTimes(1)
  })

  it('clamps take to the max allowed value', async () => {
    const response = await GET(
      makeRequest({
        search: '?take=999',
        headers: {
          authorization: 'Bearer test-secret',
        },
      }),
    )
    const json = await response.json()

    expect(mocks.prismaUserFindMany).toHaveBeenCalledWith({
      where: {
        emailVerifiedAt: null,
        createdAt: {
          lte: new Date('2026-04-16T11:55:00.000Z'),
        },
        email: {
          not: null,
        },
        emailVerificationTokens: {
          none: {
            purpose: AuthVerificationPurpose.EMAIL_VERIFY,
            usedAt: null,
            expiresAt: {
              gt: TEST_NOW,
            },
          },
        },
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: 50,
      select: {
        id: true,
        email: true,
        createdAt: true,
      },
    })

    expect(response.status).toBe(200)
    expect(json).toEqual({
      ok: true,
      scannedCount: 0,
      attemptedCount: 0,
      sentCount: 0,
      failedCount: 0,
      skippedCount: 0,
      take: 50,
      processedAt: TEST_NOW.toISOString(),
      failed: [],
    })
  })

  it('skips rows whose email is blank after trimming', async () => {
    mocks.prismaUserFindMany.mockResolvedValue([
      {
        id: 'user_blank',
        email: '   ',
        createdAt: new Date('2026-04-16T11:20:00.000Z'),
      },
    ])

    const response = await GET(
      makeRequest({
        headers: {
          authorization: 'Bearer test-secret',
        },
      }),
    )
    const json = await response.json()

    expect(mocks.issueAndSendEmailVerification).not.toHaveBeenCalled()
    expect(mocks.logAuthEvent).not.toHaveBeenCalled()
    expect(mocks.captureAuthException).not.toHaveBeenCalled()

    expect(response.status).toBe(200)
    expect(json).toEqual({
      ok: true,
      scannedCount: 1,
      attemptedCount: 0,
      sentCount: 0,
      failedCount: 0,
      skippedCount: 1,
      take: 50,
      processedAt: TEST_NOW.toISOString(),
      failed: [],
    })
  })

  it('continues when a send fails and classifies missing Postmark config', async () => {
    mocks.prismaUserFindMany.mockResolvedValue([
      {
        id: 'user_fail',
        email: 'fail@example.com',
        createdAt: new Date('2026-04-16T11:20:00.000Z'),
      },
      {
        id: 'user_ok',
        email: 'ok@example.com',
        createdAt: new Date('2026-04-16T11:10:00.000Z'),
      },
    ])

    mocks.issueAndSendEmailVerification
      .mockRejectedValueOnce(new Error('Missing env var: POSTMARK_SERVER_TOKEN'))
      .mockResolvedValueOnce({
        id: 'evt_ok',
        expiresAt: new Date('2026-04-17T12:00:00.000Z'),
      })

    const response = await POST(
      makeRequest({
        method: 'POST',
        headers: {
          'x-internal-job-secret': 'test-secret',
        },
      }),
    )
    const json = await response.json()

    expect(mocks.issueAndSendEmailVerification).toHaveBeenCalledTimes(2)

    expect(mocks.captureAuthException).toHaveBeenCalledTimes(1)
    expect(mocks.captureAuthException).toHaveBeenCalledWith({
      event: 'auth.email.retry_verification.failed',
      route: 'internal.cron.retry_verification_emails',
      provider: 'postmark',
      code: 'EMAIL_NOT_CONFIGURED',
      userId: 'user_fail',
      email: 'fail@example.com',
      error: expect.any(Error),
    })

    expect(mocks.logAuthEvent).toHaveBeenCalledTimes(1)
    expect(mocks.logAuthEvent).toHaveBeenCalledWith({
      level: 'info',
      event: 'auth.email.retry_verification.sent',
      route: 'internal.cron.retry_verification_emails',
      provider: 'postmark',
      userId: 'user_ok',
      email: 'ok@example.com',
    })

    expect(response.status).toBe(200)
    expect(json).toEqual({
      ok: true,
      scannedCount: 2,
      attemptedCount: 2,
      sentCount: 1,
      failedCount: 1,
      skippedCount: 0,
      take: 50,
      processedAt: TEST_NOW.toISOString(),
      failed: [
        {
          userId: 'user_fail',
          error: 'Missing env var: POSTMARK_SERVER_TOKEN',
        },
      ],
    })
  })

  it('classifies generic send failures as EMAIL_SEND_FAILED', async () => {
    mocks.prismaUserFindMany.mockResolvedValue([
      {
        id: 'user_fail_generic',
        email: 'generic@example.com',
        createdAt: new Date('2026-04-16T11:15:00.000Z'),
      },
    ])

    mocks.issueAndSendEmailVerification.mockRejectedValueOnce(
      new Error('Postmark outage'),
    )

    const response = await GET(
      makeRequest({
        headers: {
          authorization: 'Bearer test-secret',
        },
      }),
    )
    const json = await response.json()

    expect(mocks.captureAuthException).toHaveBeenCalledWith({
      event: 'auth.email.retry_verification.failed',
      route: 'internal.cron.retry_verification_emails',
      provider: 'postmark',
      code: 'EMAIL_SEND_FAILED',
      userId: 'user_fail_generic',
      email: 'generic@example.com',
      error: expect.any(Error),
    })

    expect(response.status).toBe(200)
    expect(json).toEqual({
      ok: true,
      scannedCount: 1,
      attemptedCount: 1,
      sentCount: 0,
      failedCount: 1,
      skippedCount: 0,
      take: 50,
      processedAt: TEST_NOW.toISOString(),
      failed: [
        {
          userId: 'user_fail_generic',
          error: 'Postmark outage',
        },
      ],
    })
  })

  it('returns 500 when the route throws unexpectedly', async () => {
    mocks.prismaUserFindMany.mockRejectedValueOnce(new Error('db exploded'))

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
      error: 'db exploded',
    })
  })
})