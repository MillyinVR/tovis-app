// app/api/v1/auth/session-handoff/route.test.ts — ISSUANCE

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Role } from '@prisma/client'

const mockGetCurrentUser = vi.hoisted(() => vi.fn())
const mockEnforceRateLimit = vi.hoisted(() => vi.fn())
const mockCreateToken = vi.hoisted(() => vi.fn())
const mockLogAuthEvent = vi.hoisted(() => vi.fn())

vi.mock('@/lib/currentUser', () => ({ getCurrentUser: mockGetCurrentUser }))
vi.mock('@/app/api/_utils/rateLimit', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@/app/api/_utils/rateLimit')>()
  return {
    ...actual,
    enforceRateLimit: mockEnforceRateLimit,
    rateLimitIdentity: vi.fn(async (id?: string | null) =>
      id ? { kind: 'user', id } : null,
    ),
  }
})
vi.mock('@/lib/observability/authEvents', () => ({
  logAuthEvent: mockLogAuthEvent,
  captureAuthException: vi.fn(),
}))
vi.mock('@/lib/auth/sessionHandoff', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@/lib/auth/sessionHandoff')>()
  return { ...actual, createSessionHandoffToken: mockCreateToken }
})

import { POST } from './route'

const EXPIRES = new Date('2026-08-04T12:01:00.000Z')

function request(body?: unknown): Request {
  return new Request('https://tovis.app/api/v1/auth/session-handoff', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      host: 'tovis.app',
      'x-forwarded-proto': 'https',
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
}

function proUser(overrides: Record<string, unknown> = {}) {
  return {
    id: 'user_1',
    email: 'pro@example.com',
    phone: '+15551234567',
    authVersion: 4,
    role: Role.PRO,
    homeRole: Role.PRO,
    canAccessAdmin: false,
    sessionKind: 'ACTIVE',
    isFullyVerified: true,
    clientProfile: null,
    professionalProfile: { id: 'pp_1', verificationStatus: 'APPROVED' },
    ...overrides,
  }
}

describe('POST /api/v1/auth/session-handoff', () => {
  beforeEach(() => {
    mockGetCurrentUser.mockReset().mockResolvedValue(proUser())
    mockEnforceRateLimit.mockReset().mockResolvedValue(null)
    mockLogAuthEvent.mockReset()
    mockCreateToken.mockReset().mockImplementation(
      async (args: { redirectPath: string }) => ({
        id: 'tok_1',
        token: 'tok_1.secret',
        redirectPath: args.redirectPath,
        expiresAt: EXPIRES,
      }),
    )
  })

  it('issues an exchange URL for an authenticated pro, defaulting to /pro/membership', async () => {
    const res = await POST(request({}))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.redirectPath).toBe('/pro/membership')
    expect(body.expiresAt).toBe(EXPIRES.toISOString())

    const url = new URL(body.url)
    expect(url.origin).toBe('https://tovis.app')
    expect(url.pathname).toBe('/api/v1/auth/session-handoff/tok_1.secret')
    expect(url.searchParams.get('from')).toBe('/pro/membership')
  })

  it('binds the token to the CALLER — never to anything in the body', async () => {
    // The decisive user-binding assertion: a body naming another user changes
    // nothing about who the token is minted for.
    await POST(request({ userId: 'user_victim', redirectPath: '/pro/calendar' }))

    expect(mockCreateToken).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user_1',
        actingRole: Role.PRO,
        authVersion: 4,
      }),
    )
  })

  it('never returns a Set-Cookie — issuance does not mint a session', async () => {
    const res = await POST(request({}))
    expect(res.headers.get('set-cookie')).toBeNull()
  })

  it('marks the response no-store (the body is a live credential)', async () => {
    const res = await POST(request({}))
    expect(res.headers.get('cache-control')).toContain('no-store')
  })

  it('accepts an allowlisted custom destination', async () => {
    const res = await POST(request({ redirectPath: '/pro/calendar' }))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.redirectPath).toBe('/pro/calendar')
  })

  it.each([
    ['//evil.example'],
    ['https://evil.example/pro'],
    ['/admin'],
    ['/client'],
    ['/pro/../admin'],
    [''],
    [42],
    [null],
  ])('400s on a destination outside the allowlist: %s', async (redirectPath) => {
    const res = await POST(request({ redirectPath }))
    const body = await res.json()

    expect(res.status).toBe(400)
    expect(body.code).toBe('REDIRECT_NOT_ALLOWED')
    // A refusal must not quietly become a working link to somewhere else.
    expect(mockCreateToken).not.toHaveBeenCalled()
  })

  it('401s when unauthenticated, and mints nothing', async () => {
    mockGetCurrentUser.mockResolvedValue(null)

    const res = await POST(request({}))

    expect(res.status).toBe(401)
    expect(mockCreateToken).not.toHaveBeenCalled()
  })

  it('403s a session acting as CLIENT — the allowlist is the pro workspace', async () => {
    mockGetCurrentUser.mockResolvedValue(
      proUser({ role: Role.CLIENT, homeRole: Role.CLIENT }),
    )

    const res = await POST(request({}))

    expect(res.status).toBe(403)
    expect(mockCreateToken).not.toHaveBeenCalled()
  })

  it('403s a VERIFICATION-kind session', async () => {
    mockGetCurrentUser.mockResolvedValue(
      proUser({ sessionKind: 'VERIFICATION' }),
    )

    const res = await POST(request({}))

    expect(res.status).toBe(403)
    expect(mockCreateToken).not.toHaveBeenCalled()
  })

  it('403s a not-fully-verified pro', async () => {
    mockGetCurrentUser.mockResolvedValue(proUser({ isFullyVerified: false }))

    const res = await POST(request({}))

    expect(res.status).toBe(403)
    expect(mockCreateToken).not.toHaveBeenCalled()
  })

  it('is rate limited, and mints nothing when the limiter refuses', async () => {
    const { NextResponse } = await import('next/server')
    mockEnforceRateLimit.mockResolvedValue(
      NextResponse.json({ ok: false }, { status: 429 }),
    )

    const res = await POST(request({}))

    expect(res.status).toBe(429)
    expect(mockCreateToken).not.toHaveBeenCalled()
    expect(mockEnforceRateLimit).toHaveBeenCalledWith(
      expect.objectContaining({ bucket: 'auth:session-handoff:issue' }),
    )
  })

  it('logs issuance with the row id but never the secret', async () => {
    await POST(request({}))

    const call = mockLogAuthEvent.mock.calls.find(
      ([e]) => e.event === 'auth.session_handoff.issued',
    )

    expect(call).toBeDefined()
    expect(call?.[0].verificationId).toBe('tok_1')
    expect(call?.[0].userId).toBe('user_1')
    expect(JSON.stringify(call?.[0])).not.toContain('secret')
  })

  it('logs a rejected destination', async () => {
    await POST(request({ redirectPath: '/admin' }))

    expect(mockLogAuthEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'auth.session_handoff.issue.rejected',
        code: 'REDIRECT_NOT_ALLOWED',
      }),
    )
  })

  it('KILL SWITCH: 404s and mints nothing while DISABLE_SESSION_HANDOFF is set', async () => {
    process.env.DISABLE_SESSION_HANDOFF = '1'
    try {
      const res = await POST(request({}))

      expect(res.status).toBe(404)
      expect(mockCreateToken).not.toHaveBeenCalled()
      // Checked before auth, so flipping it costs nothing.
      expect(mockGetCurrentUser).not.toHaveBeenCalled()
    } finally {
      delete process.env.DISABLE_SESSION_HANDOFF
    }
  })

  it('…and works again the moment the switch is cleared', async () => {
    // The other direction. Without this the 404 above would also pass if the
    // route were simply broken.
    delete process.env.DISABLE_SESSION_HANDOFF

    const res = await POST(request({}))

    expect(res.status).toBe(200)
    expect(mockCreateToken).toHaveBeenCalled()
  })

  it('tolerates a missing/unparseable body by using the default destination', async () => {
    const res = await POST(request())
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.redirectPath).toBe('/pro/membership')
  })
})
