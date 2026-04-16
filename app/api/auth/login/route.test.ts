import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Role } from '@prisma/client'

const mockVerifyPassword = vi.hoisted(() => vi.fn())
const mockCreateActiveToken = vi.hoisted(() => vi.fn())
const mockCreateVerificationToken = vi.hoisted(() => vi.fn())

const mockConsumeTapIntent = vi.hoisted(() => vi.fn())

const mockEnforceRateLimit = vi.hoisted(() => vi.fn())
const mockRateLimitIdentity = vi.hoisted(() => vi.fn())

const mockCaptureAuthException = vi.hoisted(() => vi.fn())

const mockPrisma = vi.hoisted(() => ({
  user: {
    findUnique: vi.fn(),
    update: vi.fn(),
  },
  $queryRaw: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: mockPrisma,
}))

vi.mock('@/lib/auth', () => ({
  DUMMY_PASSWORD_HASH: 'dummy_hash',
  verifyPassword: mockVerifyPassword,
  createActiveToken: mockCreateActiveToken,
  createVerificationToken: mockCreateVerificationToken,
}))

vi.mock('@/lib/tapIntentConsume', () => ({
  consumeTapIntent: mockConsumeTapIntent,
}))

vi.mock('@/lib/observability/authEvents', () => ({
  captureAuthException: mockCaptureAuthException,
}))

vi.mock('@/app/api/_utils', () => {
  function attachCookies(response: Response) {
    const res = response as Response & {
      cookies: {
        set: (
          name: string,
          value: string,
          options?: {
            httpOnly?: boolean
            secure?: boolean
            sameSite?: 'lax' | 'strict' | 'none'
            path?: string
            maxAge?: number
            domain?: string
          },
        ) => void
      }
    }

    res.cookies = {
      set(name, value, options) {
        const parts = [`${name}=${value}`]

        if (options?.path) parts.push(`Path=${options.path}`)
        if (options?.domain) parts.push(`Domain=${options.domain}`)
        if (options?.maxAge != null) parts.push(`Max-Age=${options.maxAge}`)
        if (options?.httpOnly) parts.push('HttpOnly')
        if (options?.secure) parts.push('Secure')
        if (options?.sameSite) parts.push(`SameSite=${options.sameSite}`)

        res.headers.append('set-cookie', parts.join('; '))
      },
    }

    return res
  }

  return {
    jsonFail: (
      status: number,
      error: string,
      extra?: Record<string, unknown>,
      init?: { headers?: Record<string, string> },
    ) =>
      new Response(
        JSON.stringify({
          ok: false,
          error,
          ...(extra ?? {}),
        }),
        {
          status,
          headers: {
            'Content-Type': 'application/json',
            ...(init?.headers ?? {}),
          },
        },
      ),

    jsonOk: (body: Record<string, unknown>, status = 200) =>
      attachCookies(
        new Response(
          JSON.stringify({
            ok: true,
            ...body,
          }),
          {
            status,
            headers: {
              'Content-Type': 'application/json',
            },
          },
        ),
      ),

    pickString: (value: unknown) => (typeof value === 'string' ? value : null),

    normalizeEmail: (value: unknown) => {
      if (typeof value !== 'string') return null
      const normalized = value.trim().toLowerCase()
      return normalized || null
    },

    enforceRateLimit: mockEnforceRateLimit,
    rateLimitIdentity: mockRateLimitIdentity,
  }
})

import { POST } from './route'

function resetMockGroup(group: Record<string, ReturnType<typeof vi.fn>>) {
  for (const fn of Object.values(group)) {
    fn.mockReset()
  }
}

function makeRequest(
  body: unknown,
  extras?: { url?: string; headers?: Record<string, string> },
) {
  return new Request(extras?.url ?? 'http://localhost/api/auth/login', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      host: 'localhost:3000',
      ...(extras?.headers ?? {}),
    },
    body: JSON.stringify(body),
  })
}

function makeUser(args?: {
  role?: Role
  authVersion?: number
  loginAttempts?: number
  lockedUntil?: Date | null
  phoneVerifiedAt?: Date | null
  emailVerifiedAt?: Date | null
  professionalProfileId?: string | null
  clientProfileId?: string | null
}) {
  const role = args?.role ?? Role.CLIENT

  return {
    id: 'user_1',
    email: 'user@example.com',
    password: 'stored_hash',
    role,
    authVersion: args?.authVersion ?? 1,
    loginAttempts: args?.loginAttempts ?? 0,
    lockedUntil: args?.lockedUntil === undefined ? null : args.lockedUntil,
    phoneVerifiedAt:
      args?.phoneVerifiedAt === undefined ? null : args.phoneVerifiedAt,
    emailVerifiedAt:
      args?.emailVerifiedAt === undefined ? null : args.emailVerifiedAt,
    professionalProfile:
      role === Role.PRO
        ? {
            id:
              args?.professionalProfileId === undefined
                ? 'pro_1'
                : args.professionalProfileId,
          }
        : null,
    clientProfile:
      role === Role.CLIENT
        ? {
            id:
              args?.clientProfileId === undefined
                ? 'client_1'
                : args.clientProfileId,
          }
        : null,
  }
}

const clearedUserSelect = {
  id: true,
  email: true,
  role: true,
  authVersion: true,
  phoneVerifiedAt: true,
  emailVerifiedAt: true,
} as const

describe('app/api/auth/login/route', () => {
  beforeEach(() => {
    resetMockGroup(mockPrisma.user)

    mockPrisma.$queryRaw.mockReset()

    mockVerifyPassword.mockReset()
    mockCreateActiveToken.mockReset()
    mockCreateVerificationToken.mockReset()

    mockConsumeTapIntent.mockReset()

    mockEnforceRateLimit.mockReset()
    mockRateLimitIdentity.mockReset()

    mockCaptureAuthException.mockReset()

    mockRateLimitIdentity.mockResolvedValue({
      kind: 'ip',
      id: '198.51.100.10',
    })
    mockEnforceRateLimit.mockResolvedValue(null)

    mockCreateActiveToken.mockReturnValue('active_token')
    mockCreateVerificationToken.mockReturnValue('verification_token')

    mockConsumeTapIntent.mockResolvedValue({
      nextUrl: '/looks?from=tap',
    })
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('passes through the rate-limit response unchanged', async () => {
    const rateLimitRes = new Response(null, { status: 429 })
    mockEnforceRateLimit.mockResolvedValue(rateLimitRes)

    const result = await POST(
      makeRequest({
        email: 'user@example.com',
        password: 'Secret123!',
      }),
    )

    expect(mockRateLimitIdentity).toHaveBeenCalledTimes(1)
    expect(mockEnforceRateLimit).toHaveBeenCalledWith({
      bucket: 'auth:login',
      identity: { kind: 'ip', id: '198.51.100.10' },
    })
    expect(result).toBe(rateLimitRes)
    expect(result.status).toBe(429)
    expect(mockCaptureAuthException).not.toHaveBeenCalled()
  })

  it('returns 400 when credentials are missing', async () => {
    const result = await POST(
      makeRequest({
        email: '',
        password: '',
      }),
    )
    const body = await result.json()

    expect(result.status).toBe(400)
    expect(body).toEqual({
      ok: false,
      error: 'Missing email or password',
      code: 'MISSING_CREDENTIALS',
    })

    expect(mockPrisma.user.findUnique).not.toHaveBeenCalled()
    expect(mockCaptureAuthException).not.toHaveBeenCalled()
  })

  it('returns 401 when the user is not found and still burns dummy bcrypt time', async () => {
    mockPrisma.user.findUnique.mockResolvedValue(null)
    mockVerifyPassword.mockResolvedValue(false)

    const result = await POST(
      makeRequest({
        email: 'user@example.com',
        password: 'Secret123!',
      }),
    )
    const body = await result.json()

    expect(result.status).toBe(401)
    expect(body).toEqual({
      ok: false,
      error: 'Invalid credentials',
      code: 'INVALID_CREDENTIALS',
    })

    expect(mockVerifyPassword).toHaveBeenCalledWith(
      'Secret123!',
      'dummy_hash',
    )
    expect(mockPrisma.$queryRaw).not.toHaveBeenCalled()
    expect(mockCaptureAuthException).not.toHaveBeenCalled()
  })

  it('increments loginAttempts and returns 401 before the lock threshold', async () => {
    mockPrisma.user.findUnique.mockResolvedValue(
      makeUser({
        loginAttempts: 3,
      }),
    )
    mockVerifyPassword.mockResolvedValue(false)
    mockPrisma.$queryRaw.mockResolvedValue([
      {
        loginAttempts: 4,
        lockedUntil: null,
      },
    ])

    const result = await POST(
      makeRequest({
        email: 'user@example.com',
        password: 'WrongPassword',
      }),
    )
    const body = await result.json()

    expect(result.status).toBe(401)
    expect(body).toEqual({
      ok: false,
      error: 'Invalid credentials',
      code: 'INVALID_CREDENTIALS',
    })

    expect(mockVerifyPassword).toHaveBeenCalledWith(
      'WrongPassword',
      'stored_hash',
    )
    expect(mockPrisma.$queryRaw).toHaveBeenCalledTimes(1)
    expect(mockPrisma.user.update).not.toHaveBeenCalled()
    expect(mockCaptureAuthException).not.toHaveBeenCalled()
  })

  it('locks the account on the 10th failed attempt', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-04-16T12:00:00.000Z'))

    mockPrisma.user.findUnique.mockResolvedValue(
      makeUser({
        loginAttempts: 9,
      }),
    )
    mockVerifyPassword.mockResolvedValue(false)
    mockPrisma.$queryRaw.mockResolvedValue([
      {
        loginAttempts: 10,
        lockedUntil: new Date('2026-04-16T12:30:00.000Z'),
      },
    ])

    const result = await POST(
      makeRequest({
        email: 'user@example.com',
        password: 'WrongPassword',
      }),
    )
    const body = await result.json()

    expect(result.status).toBe(400)
    expect(body).toEqual({
      ok: false,
      error: 'Too many login attempts. Try again later.',
      code: 'ACCOUNT_LOCKED',
      retryAfter: 1800,
    })

    expect(mockVerifyPassword).toHaveBeenCalledWith(
      'WrongPassword',
      'stored_hash',
    )
    expect(mockPrisma.$queryRaw).toHaveBeenCalledTimes(1)
    expect(mockPrisma.user.update).not.toHaveBeenCalled()
    expect(mockCaptureAuthException).not.toHaveBeenCalled()
  })

  it('returns ACCOUNT_LOCKED for a locked account even when the password is correct', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-04-16T12:00:00.000Z'))

    mockPrisma.user.findUnique.mockResolvedValue(
      makeUser({
        loginAttempts: 10,
        lockedUntil: new Date('2026-04-16T12:30:00.000Z'),
      }),
    )
    mockVerifyPassword.mockResolvedValue(true)

    const result = await POST(
      makeRequest({
        email: 'user@example.com',
        password: 'Secret123!',
      }),
    )
    const body = await result.json()

    expect(result.status).toBe(400)
    expect(body).toEqual({
      ok: false,
      error: 'Too many login attempts. Try again later.',
      code: 'ACCOUNT_LOCKED',
      retryAfter: 1800,
    })

    expect(mockVerifyPassword).toHaveBeenCalledWith(
      'Secret123!',
      'stored_hash',
    )
    expect(mockPrisma.$queryRaw).not.toHaveBeenCalled()
    expect(mockPrisma.user.update).not.toHaveBeenCalled()
    expect(mockCaptureAuthException).not.toHaveBeenCalled()
  })

  it('returns 403 when expectedRole does not match the user role and still clears lock state', async () => {
    mockPrisma.user.findUnique.mockResolvedValue(
      makeUser({
        role: Role.CLIENT,
        loginAttempts: 4,
      }),
    )
    mockVerifyPassword.mockResolvedValue(true)
    mockPrisma.user.update.mockResolvedValue({
      id: 'user_1',
      email: 'user@example.com',
      role: Role.CLIENT,
      authVersion: 1,
      phoneVerifiedAt: null,
      emailVerifiedAt: null,
    })

    const result = await POST(
      makeRequest({
        email: 'user@example.com',
        password: 'Secret123!',
        expectedRole: 'PRO',
      }),
    )
    const body = await result.json()

    expect(result.status).toBe(403)
    expect(body).toEqual({
      ok: false,
      error: 'That account is not a pro account.',
      code: 'ROLE_MISMATCH',
      expectedRole: 'PRO',
      actualRole: 'CLIENT',
    })

    expect(mockPrisma.user.update).toHaveBeenCalledWith({
      where: { id: 'user_1' },
      data: {
        loginAttempts: 0,
        lockedUntil: null,
      },
      select: clearedUserSelect,
    })
    expect(mockCaptureAuthException).not.toHaveBeenCalled()
  })

  it('returns 409 when a PRO account is missing its professional profile and still clears lock state', async () => {
    mockPrisma.user.findUnique.mockResolvedValue(
      makeUser({
        role: Role.PRO,
        loginAttempts: 2,
        professionalProfileId: null,
      }),
    )
    mockVerifyPassword.mockResolvedValue(true)
    mockPrisma.user.update.mockResolvedValue({
      id: 'user_1',
      email: 'user@example.com',
      role: Role.PRO,
      authVersion: 1,
      phoneVerifiedAt: null,
      emailVerifiedAt: null,
    })

    const result = await POST(
      makeRequest({
        email: 'user@example.com',
        password: 'Secret123!',
      }),
    )
    const body = await result.json()

    expect(result.status).toBe(409)
    expect(body).toEqual({
      ok: false,
      error: 'Professional setup is not complete yet.',
      code: 'PRO_SETUP_REQUIRED',
    })

    expect(mockPrisma.user.update).toHaveBeenCalledWith({
      where: { id: 'user_1' },
      data: {
        loginAttempts: 0,
        lockedUntil: null,
      },
      select: clearedUserSelect,
    })
    expect(mockCaptureAuthException).not.toHaveBeenCalled()
  })

  it('issues a verification token when the user is not fully verified', async () => {
    mockPrisma.user.findUnique.mockResolvedValue(
      makeUser({
        role: Role.CLIENT,
        loginAttempts: 4,
        lockedUntil: null,
        phoneVerifiedAt: new Date('2026-04-08T10:00:00.000Z'),
        emailVerifiedAt: null,
      }),
    )
    mockVerifyPassword.mockResolvedValue(true)
    mockPrisma.user.update.mockResolvedValue({
      id: 'user_1',
      email: 'user@example.com',
      role: Role.CLIENT,
      authVersion: 1,
      phoneVerifiedAt: new Date('2026-04-08T10:00:00.000Z'),
      emailVerifiedAt: null,
    })

    const result = await POST(
      makeRequest({
        email: 'user@example.com',
        password: 'Secret123!',
        tapIntentId: 'tap_1',
      }),
    )
    const body = await result.json()

    expect(result.status).toBe(200)
    expect(body).toEqual({
      ok: true,
      user: {
        id: 'user_1',
        email: 'user@example.com',
        role: 'CLIENT',
      },
      nextUrl: '/looks?from=tap',
      isPhoneVerified: true,
      isEmailVerified: false,
      isFullyVerified: false,
    })

    expect(mockCreateVerificationToken).toHaveBeenCalledWith({
      userId: 'user_1',
      role: Role.CLIENT,
      authVersion: 1,
    })
    expect(mockCreateActiveToken).not.toHaveBeenCalled()

    expect(mockPrisma.user.update).toHaveBeenCalledWith({
      where: { id: 'user_1' },
      data: {
        loginAttempts: 0,
        lockedUntil: null,
      },
      select: clearedUserSelect,
    })

    const setCookie = result.headers.get('set-cookie')
    expect(setCookie).toContain('tovis_token=verification_token')
    expect(mockCaptureAuthException).not.toHaveBeenCalled()
  })

  it('issues an active token when the user is fully verified', async () => {
    mockPrisma.user.findUnique.mockResolvedValue(
      makeUser({
        role: Role.PRO,
        phoneVerifiedAt: new Date('2026-04-08T10:00:00.000Z'),
        emailVerifiedAt: new Date('2026-04-08T10:05:00.000Z'),
      }),
    )
    mockVerifyPassword.mockResolvedValue(true)
    mockPrisma.user.update.mockResolvedValue({
      id: 'user_1',
      email: 'user@example.com',
      role: Role.PRO,
      authVersion: 1,
      phoneVerifiedAt: new Date('2026-04-08T10:00:00.000Z'),
      emailVerifiedAt: new Date('2026-04-08T10:05:00.000Z'),
    })

    const result = await POST(
      makeRequest(
        {
          email: 'user@example.com',
          password: 'Secret123!',
        },
        {
          url: 'https://app.tovis.app/api/auth/login',
          headers: {
            host: 'app.tovis.app',
            'x-forwarded-host': 'app.tovis.app',
            'x-forwarded-proto': 'https',
          },
        },
      ),
    )
    const body = await result.json()

    expect(result.status).toBe(200)
    expect(body).toEqual({
      ok: true,
      user: {
        id: 'user_1',
        email: 'user@example.com',
        role: 'PRO',
      },
      nextUrl: '/looks?from=tap',
      isPhoneVerified: true,
      isEmailVerified: true,
      isFullyVerified: true,
    })

    expect(mockCreateActiveToken).toHaveBeenCalledWith({
      userId: 'user_1',
      role: Role.PRO,
      authVersion: 1,
    })
    expect(mockCreateVerificationToken).not.toHaveBeenCalled()

    const setCookie = result.headers.get('set-cookie')
    expect(setCookie).toContain('tovis_token=active_token')
    expect(mockCaptureAuthException).not.toHaveBeenCalled()
  })

  it('auto-unlocks an expired lock and clears state on successful login', async () => {
    mockPrisma.user.findUnique.mockResolvedValue(
      makeUser({
        role: Role.CLIENT,
        loginAttempts: 10,
        lockedUntil: new Date('2026-04-16T11:29:59.000Z'),
        phoneVerifiedAt: new Date('2026-04-08T10:00:00.000Z'),
        emailVerifiedAt: null,
      }),
    )
    mockVerifyPassword.mockResolvedValue(true)
    mockPrisma.user.update.mockResolvedValue({
      id: 'user_1',
      email: 'user@example.com',
      role: Role.CLIENT,
      authVersion: 1,
      phoneVerifiedAt: new Date('2026-04-08T10:00:00.000Z'),
      emailVerifiedAt: null,
    })

    const result = await POST(
      makeRequest({
        email: 'user@example.com',
        password: 'Secret123!',
      }),
    )
    const body = await result.json()

    expect(result.status).toBe(200)
    expect(body).toEqual({
      ok: true,
      user: {
        id: 'user_1',
        email: 'user@example.com',
        role: 'CLIENT',
      },
      nextUrl: '/looks?from=tap',
      isPhoneVerified: true,
      isEmailVerified: false,
      isFullyVerified: false,
    })

    expect(mockVerifyPassword).toHaveBeenCalledWith(
      'Secret123!',
      'stored_hash',
    )
    expect(mockPrisma.user.update).toHaveBeenCalledWith({
      where: { id: 'user_1' },
      data: {
        loginAttempts: 0,
        lockedUntil: null,
      },
      select: clearedUserSelect,
    })
    expect(mockCaptureAuthException).not.toHaveBeenCalled()
  })

  it('returns 500 and captures the exception when login throws unexpectedly', async () => {
    mockPrisma.user.findUnique.mockRejectedValue(new Error('db blew up'))

    const result = await POST(
      makeRequest({
        email: 'user@example.com',
        password: 'Secret123!',
      }),
    )
    const body = await result.json()

    expect(result.status).toBe(500)
    expect(body).toEqual({
      ok: false,
      error: 'Internal server error',
      code: 'INTERNAL',
    })

    expect(mockCaptureAuthException).toHaveBeenCalledWith({
      event: 'auth.login.failed',
      route: 'auth.login',
      code: 'INTERNAL',
      userId: null,
      email: 'user@example.com',
      error: expect.any(Error),
    })
  })
})