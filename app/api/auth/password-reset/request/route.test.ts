import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockRateLimitIdentity = vi.hoisted(() => vi.fn())
const mockEnforceRateLimit = vi.hoisted(() => vi.fn())

const mockGetPasswordResetAppUrlFromRequest = vi.hoisted(() => vi.fn())
const mockGetPasswordResetRequestIp = vi.hoisted(() => vi.fn())
const mockIssueAndSendPasswordReset = vi.hoisted(() => vi.fn())

const mockPrisma = vi.hoisted(() => ({
  user: {
    findUnique: vi.fn(),
  },
}))

vi.mock('@/lib/prisma', () => ({
  prisma: mockPrisma,
}))

vi.mock('@/lib/auth/passwordReset', () => ({
  getPasswordResetAppUrlFromRequest: mockGetPasswordResetAppUrlFromRequest,
  getPasswordResetRequestIp: mockGetPasswordResetRequestIp,
  issueAndSendPasswordReset: mockIssueAndSendPasswordReset,
}))

vi.mock('@/app/api/_utils', () => ({
  jsonOk(payload: unknown, status = 200) {
    return new Response(JSON.stringify(payload), {
      status,
      headers: { 'Content-Type': 'application/json' },
    })
  },
  normalizeEmail(value: unknown) {
    return typeof value === 'string' && value.trim()
      ? value.trim().toLowerCase()
      : null
  },
  enforceRateLimit: mockEnforceRateLimit,
  rateLimitIdentity: mockRateLimitIdentity,
}))

import { POST } from './route'

function makeRequest(
  body: Record<string, unknown>,
  headers?: Record<string, string>,
) {
  return new Request('http://localhost/api/auth/password-reset/request', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      host: 'localhost:3000',
      ...(headers ?? {}),
    },
    body: JSON.stringify(body),
  })
}

describe('app/api/auth/password-reset/request/route', () => {
  beforeEach(() => {
    mockRateLimitIdentity.mockReset()
    mockEnforceRateLimit.mockReset()

    mockGetPasswordResetAppUrlFromRequest.mockReset()
    mockGetPasswordResetRequestIp.mockReset()
    mockIssueAndSendPasswordReset.mockReset()

    mockPrisma.user.findUnique.mockReset()

    mockRateLimitIdentity.mockResolvedValue('ip:test')
    mockEnforceRateLimit.mockResolvedValue(null)
    mockGetPasswordResetAppUrlFromRequest.mockReturnValue(
      'http://localhost:3000',
    )
    mockGetPasswordResetRequestIp.mockReturnValue('203.0.113.10')
  })

  it('passes through the rate-limit response unchanged', async () => {
    const rateLimitRes = new Response(null, { status: 429 })
    mockEnforceRateLimit.mockResolvedValue(rateLimitRes)

    const result = await POST(
      makeRequest({
        email: 'user@example.com',
      }),
    )

    expect(mockRateLimitIdentity).toHaveBeenCalledTimes(1)
    expect(mockEnforceRateLimit).toHaveBeenCalledWith({
      bucket: 'auth:password-reset-request',
      identity: 'ip:test',
    })

    expect(result).toBe(rateLimitRes)
    expect(result.status).toBe(429)
  })

  it('returns ok and skips lookup when email is missing', async () => {
    const result = await POST(
      makeRequest({
        email: '',
      }),
    )
    const body = await result.json()

    expect(result.status).toBe(200)
    expect(body).toEqual({ ok: true })

    expect(mockPrisma.user.findUnique).not.toHaveBeenCalled()
    expect(mockIssueAndSendPasswordReset).not.toHaveBeenCalled()
  })

  it('returns ok when the user is not found', async () => {
    mockPrisma.user.findUnique.mockResolvedValue(null)

    const result = await POST(
      makeRequest({
        email: 'missing@example.com',
      }),
    )
    const body = await result.json()

    expect(result.status).toBe(200)
    expect(body).toEqual({ ok: true })

    expect(mockPrisma.user.findUnique).toHaveBeenCalledWith({
      where: { email: 'missing@example.com' },
      select: { id: true, email: true },
    })

    expect(mockIssueAndSendPasswordReset).not.toHaveBeenCalled()
  })

  it('returns ok when app URL resolution fails', async () => {
    mockPrisma.user.findUnique.mockResolvedValue({
      id: 'user_1',
      email: 'user@example.com',
    })
    mockGetPasswordResetAppUrlFromRequest.mockReturnValue(null)

    const result = await POST(
      makeRequest({
        email: 'user@example.com',
      }),
    )
    const body = await result.json()

    expect(result.status).toBe(200)
    expect(body).toEqual({ ok: true })

    expect(mockIssueAndSendPasswordReset).not.toHaveBeenCalled()
  })

  it('issues and sends a password reset when the user exists', async () => {
    mockPrisma.user.findUnique.mockResolvedValue({
      id: 'user_1',
      email: 'user@example.com',
    })

    const result = await POST(
      makeRequest(
        {
          email: 'user@example.com',
        },
        {
          'user-agent': 'Vitest Browser',
          'x-forwarded-for': '203.0.113.10',
          'x-forwarded-host': 'app.tovis.app',
          'x-forwarded-proto': 'https',
        },
      ),
    )
    const body = await result.json()

    expect(result.status).toBe(200)
    expect(body).toEqual({ ok: true })

    expect(mockGetPasswordResetAppUrlFromRequest).toHaveBeenCalledTimes(1)
    expect(mockGetPasswordResetRequestIp).toHaveBeenCalledTimes(1)

    expect(mockIssueAndSendPasswordReset).toHaveBeenCalledWith({
      userId: 'user_1',
      email: 'user@example.com',
      appUrl: 'http://localhost:3000',
      ip: '203.0.113.10',
      userAgent: 'Vitest Browser',
    })
  })

  it('still returns ok when password reset issuance or email sending fails', async () => {
    mockPrisma.user.findUnique.mockResolvedValue({
      id: 'user_1',
      email: 'user@example.com',
    })
    mockIssueAndSendPasswordReset.mockRejectedValue(
      new Error('Postmark timeout'),
    )

    const result = await POST(
      makeRequest({
        email: 'user@example.com',
      }),
    )
    const body = await result.json()

    expect(result.status).toBe(200)
    expect(body).toEqual({ ok: true })
  })
})