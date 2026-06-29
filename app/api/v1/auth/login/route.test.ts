// app/api/v1/auth/login/route.test.ts

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Prisma, Role } from '@prisma/client'

import {
  CONTACT_LOOKUP_HMAC_KEY_VERSION,
  clearContactLookupHmacKeyringCacheForTests,
  emailLookupHashV2,
} from '@/lib/security/crypto/hashLookup'

const mockVerifyPassword = vi.hoisted(() => vi.fn())
const mockCreateActiveToken = vi.hoisted(() => vi.fn())
const mockCreateVerificationToken = vi.hoisted(() => vi.fn())

const mockConsumeTapIntent = vi.hoisted(() => vi.fn())

const mockEnforceRateLimit = vi.hoisted(() => vi.fn())
const mockRateLimitIdentity = vi.hoisted(() => vi.fn())

const mockCaptureAuthException = vi.hoisted(() => vi.fn())

const mockPrisma = vi.hoisted(() => ({
  user: {
    findMany: vi.fn(),
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

    enforceRateLimit: mockEnforceRateLimit,
    rateLimitIdentity: mockRateLimitIdentity,
    emailRateLimitKeySuffix: (email: string) => `emailhash:${email}`,
  }
})

import { POST } from './route'

const TEST_HMAC_KEY = Buffer.alloc(32, 7).toString('base64')

const clearedUserSelect = {
  id: true,
  email: true,
  role: true,
  authVersion: true,
  phoneVerifiedAt: true,
  emailVerifiedAt: true,
} as const

function resetMockGroup(group: Record<string, ReturnType<typeof vi.fn>>) {
  for (const fn of Object.values(group)) {
    fn.mockReset()
  }
}

function makeRequest(
  body: unknown,
  extras?: { url?: string; headers?: Record<string, string> },
) {
  return new Request(extras?.url ?? 'http://localhost/api/v1/auth/login', {
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
  id?: string
  email?: string
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
    id: args?.id ?? 'user_1',
    email: args?.email ?? 'user@example.com',
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

function expectedEmailLookupV2Data(email: string) {
  const hmac = emailLookupHashV2(email)

  return {
    emailHashV2: hmac?.hash ?? null,
    emailHashKeyVersion: hmac?.keyVersion ?? null,
  }
}

function mockUserLookupByWhere(users: ReturnType<typeof makeUser>[]) {
  mockPrisma.user.findMany.mockImplementation(
    async (args: { where?: { OR?: Record<string, unknown>[] } }) => {
      const conditions = args.where?.OR ?? []

      return users
        .filter((user) => {
          const lookup = expectedEmailLookupV2Data(user.email)

          return conditions.some((condition) => {
            return (
              condition.emailHashV2 === lookup.emailHashV2 &&
              condition.emailHashKeyVersion === lookup.emailHashKeyVersion
            )
          })
        })
        .slice(0, 2)
    },
  )
}

describe('app/api/v1/auth/login/route', () => {
  beforeEach(() => {
    process.env.PII_LOOKUP_HMAC_KEYS_JSON = JSON.stringify({
      [CONTACT_LOOKUP_HMAC_KEY_VERSION]: TEST_HMAC_KEY,
    })
    clearContactLookupHmacKeyringCacheForTests()

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

    mockPrisma.user.findMany.mockResolvedValue([])

    mockCreateActiveToken.mockReturnValue('active_token')
    mockCreateVerificationToken.mockReturnValue('verification_token')

    mockConsumeTapIntent.mockResolvedValue({
      nextUrl: '/looks?from=tap',
    })
  })

  afterEach(() => {
    delete process.env.PII_LOOKUP_HMAC_KEYS_JSON
    clearContactLookupHmacKeyringCacheForTests()

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
    expect(mockPrisma.user.findMany).not.toHaveBeenCalled()
    expect(mockVerifyPassword).not.toHaveBeenCalled()
    expect(mockPrisma.$queryRaw).not.toHaveBeenCalled()
    expect(mockPrisma.user.update).not.toHaveBeenCalled()
    expect(mockConsumeTapIntent).not.toHaveBeenCalled()
    expect(mockCaptureAuthException).not.toHaveBeenCalled()
  })

  it('enforces the per-account IP+email bucket and short-circuits before password work', async () => {
    const identityRateLimitRes = new Response(null, { status: 429 })
    // Coarse IP bucket allows; the composite per-account bucket blocks.
    mockEnforceRateLimit
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(identityRateLimitRes)

    const result = await POST(
      makeRequest({
        email: 'user@example.com',
        password: 'Secret123!',
      }),
    )

    expect(mockEnforceRateLimit).toHaveBeenNthCalledWith(1, {
      bucket: 'auth:login',
      identity: { kind: 'ip', id: '198.51.100.10' },
    })
    expect(mockEnforceRateLimit).toHaveBeenNthCalledWith(2, {
      bucket: 'auth:login:identity',
      identity: { kind: 'ip', id: '198.51.100.10' },
      keySuffix: 'emailhash:user@example.com',
    })
    expect(result).toBe(identityRateLimitRes)
    expect(result.status).toBe(429)
    // The composite guard fires before any credential lookup / bcrypt work.
    expect(mockPrisma.user.findMany).not.toHaveBeenCalled()
    expect(mockVerifyPassword).not.toHaveBeenCalled()
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

    expect(mockPrisma.user.findMany).not.toHaveBeenCalled()
    expect(mockCaptureAuthException).not.toHaveBeenCalled()
  })

  it('returns 401 when the user is not found and still burns dummy bcrypt time', async () => {
    mockPrisma.user.findMany.mockResolvedValue([])
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

    expect(mockPrisma.user.findMany).toHaveBeenCalledTimes(1)
    expect(mockVerifyPassword).toHaveBeenCalledWith('Secret123!', 'dummy_hash')
    expect(mockPrisma.$queryRaw).not.toHaveBeenCalled()
    expect(mockCaptureAuthException).not.toHaveBeenCalled()
  })

  it('increments loginAttempts and returns 401 before the lock threshold', async () => {
    mockUserLookupByWhere([
      makeUser({
        loginAttempts: 3,
      }),
    ])
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

  it('retries the failed-attempt write once on a transient DB error, then returns 401', async () => {
    mockUserLookupByWhere([makeUser({ loginAttempts: 3 })])
    mockVerifyPassword.mockResolvedValue(false)

    const transient = new Prisma.PrismaClientKnownRequestError(
      'Timed out fetching a new connection from the connection pool',
      { code: 'P2024', clientVersion: 'test' },
    )
    mockPrisma.$queryRaw
      .mockRejectedValueOnce(transient)
      .mockResolvedValueOnce([{ loginAttempts: 4, lockedUntil: null }])

    const result = await POST(
      makeRequest({ email: 'user@example.com', password: 'WrongPassword' }),
    )
    const body = await result.json()

    expect(result.status).toBe(401)
    expect(body.code).toBe('INVALID_CREDENTIALS')
    // First call threw a transient error; the retry succeeded.
    expect(mockPrisma.$queryRaw).toHaveBeenCalledTimes(2)
    expect(mockCaptureAuthException).not.toHaveBeenCalled()
  })

  it('degrades to 401 (not 500) and captures when the failed-attempt write keeps failing transiently', async () => {
    mockUserLookupByWhere([makeUser({ loginAttempts: 3 })])
    mockVerifyPassword.mockResolvedValue(false)

    const transient = new Prisma.PrismaClientKnownRequestError(
      'deadlock detected',
      { code: 'P2034', clientVersion: 'test' },
    )
    mockPrisma.$queryRaw.mockRejectedValue(transient)

    const result = await POST(
      makeRequest({ email: 'user@example.com', password: 'WrongPassword' }),
    )
    const body = await result.json()

    // The rejected credential must NOT escalate into a 500 just because the
    // best-effort brute-force counter could not be written.
    expect(result.status).toBe(401)
    expect(body.code).toBe('INVALID_CREDENTIALS')
    expect(mockPrisma.$queryRaw).toHaveBeenCalledTimes(2)
    expect(mockCaptureAuthException).toHaveBeenCalledTimes(1)
    expect(mockCaptureAuthException).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'auth.login.attempt_record_failed',
        code: 'ATTEMPT_RECORD_DEGRADED',
        userId: 'user_1',
      }),
    )
  })

  it('does not retry a non-transient failed-attempt write but still degrades to 401', async () => {
    mockUserLookupByWhere([makeUser({ loginAttempts: 3 })])
    mockVerifyPassword.mockResolvedValue(false)

    mockPrisma.$queryRaw.mockRejectedValue(new Error('unexpected failure'))

    const result = await POST(
      makeRequest({ email: 'user@example.com', password: 'WrongPassword' }),
    )
    const body = await result.json()

    expect(result.status).toBe(401)
    expect(body.code).toBe('INVALID_CREDENTIALS')
    // Non-transient → no retry, but caught and degraded rather than 500.
    expect(mockPrisma.$queryRaw).toHaveBeenCalledTimes(1)
    expect(mockCaptureAuthException).toHaveBeenCalledTimes(1)
  })

  it('locks the account on the 10th failed attempt', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-04-16T12:00:00.000Z'))

    mockUserLookupByWhere([
      makeUser({
        loginAttempts: 9,
      }),
    ])
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

  it('locks the account when failed login state returns lockedUntil as a string timestamp', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-04-16T12:00:00.000Z'))

    mockUserLookupByWhere([
      makeUser({
        loginAttempts: 9,
      }),
    ])
    mockVerifyPassword.mockResolvedValue(false)
    mockPrisma.$queryRaw.mockResolvedValue([
      {
        loginAttempts: 10,
        lockedUntil: '2026-04-16T12:30:00.000Z',
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

    mockUserLookupByWhere([
      makeUser({
        loginAttempts: 10,
        lockedUntil: new Date('2026-04-16T12:30:00.000Z'),
      }),
    ])
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

  it('uses bcrypt verification work in both failure branches and returns the same failure response', async () => {
    mockVerifyPassword.mockResolvedValue(false)

    mockPrisma.user.findMany.mockResolvedValueOnce([])
    const missingUserResult = await POST(
      makeRequest({
        email: 'missing@example.com',
        password: 'Secret123!',
      }),
    )
    const missingUserBody = await missingUserResult.json()

    expect(mockVerifyPassword).toHaveBeenNthCalledWith(
      1,
      'Secret123!',
      'dummy_hash',
    )

    expect(missingUserResult.status).toBe(401)
    expect(missingUserBody).toEqual({
      ok: false,
      error: 'Invalid credentials',
      code: 'INVALID_CREDENTIALS',
    })

    mockUserLookupByWhere([
      makeUser({
        loginAttempts: 3,
      }),
    ])
    mockPrisma.$queryRaw.mockResolvedValueOnce([
      {
        loginAttempts: 4,
        lockedUntil: null,
      },
    ])

    const wrongPasswordResult = await POST(
      makeRequest({
        email: 'user@example.com',
        password: 'WrongPassword',
      }),
    )
    const wrongPasswordBody = await wrongPasswordResult.json()

    expect(mockVerifyPassword).toHaveBeenNthCalledWith(
      2,
      'WrongPassword',
      'stored_hash',
    )

    expect(wrongPasswordResult.status).toBe(401)
    expect(wrongPasswordBody).toEqual({
      ok: false,
      error: 'Invalid credentials',
      code: 'INVALID_CREDENTIALS',
    })

    expect(wrongPasswordResult.status).toBe(missingUserResult.status)
    expect(wrongPasswordBody).toEqual(missingUserBody)
  })

  it('returns 403 when expectedRole does not match the user role and still clears lock state', async () => {
    mockUserLookupByWhere([
      makeUser({
        role: Role.CLIENT,
        loginAttempts: 4,
      }),
    ])
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
    mockUserLookupByWhere([
      makeUser({
        role: Role.PRO,
        loginAttempts: 2,
        professionalProfileId: null,
      }),
    ])
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

  it('looks up users by HMAC emailHashV2 only', async () => {
    const user = makeUser({
      loginAttempts: 0,
    })
    const lookup = expectedEmailLookupV2Data('user@example.com')

    mockUserLookupByWhere([user])
    mockVerifyPassword.mockResolvedValue(true)
    mockPrisma.user.update.mockResolvedValue({
      id: 'user_1',
      email: 'user@example.com',
      role: Role.CLIENT,
      authVersion: 1,
      phoneVerifiedAt: new Date('2026-04-08T10:00:00.000Z'),
      emailVerifiedAt: new Date('2026-04-08T10:05:00.000Z'),
    })

    const result = await POST(
      makeRequest({
        email: ' User@Example.COM ',
        password: 'Secret123!',
      }),
    )

    expect(result.status).toBe(200)

    expect(mockPrisma.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          OR: [
            {
              emailHashV2: lookup.emailHashV2,
              emailHashKeyVersion: lookup.emailHashKeyVersion,
            },
          ],
        },
        take: 2,
      }),
    )
  })

  it('does not include legacy or plaintext fallback in the login lookup', async () => {
    const lookup = expectedEmailLookupV2Data('user@example.com')

    mockPrisma.user.findMany.mockResolvedValueOnce([])
    mockVerifyPassword.mockResolvedValue(false)

    const result = await POST(
      makeRequest({
        email: 'user@example.com',
        password: 'Secret123!',
      }),
    )

    expect(result.status).toBe(401)

    expect(mockPrisma.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          OR: [
            {
              emailHashV2: lookup.emailHashV2,
              emailHashKeyVersion: lookup.emailHashKeyVersion,
            },
          ],
        },
        take: 2,
      }),
    )

    const call = mockPrisma.user.findMany.mock.calls[0]?.[0] as {
      where: { OR: Array<Record<string, unknown>> }
    }

    expect(call.where.OR).not.toContainEqual({
      emailHash: expect.any(String),
    })

    expect(call.where.OR).not.toContainEqual({
      email: 'user@example.com',
    })
  })

  it('fails closed as invalid credentials when lookup conditions match multiple users', async () => {
    mockPrisma.user.findMany.mockResolvedValueOnce([
      makeUser({
        id: 'user_1',
        email: 'user@example.com',
      }),
      makeUser({
        id: 'user_2',
        email: 'user@example.com',
      }),
    ])

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

    expect(mockVerifyPassword).toHaveBeenCalledWith('Secret123!', 'dummy_hash')
    expect(mockPrisma.user.update).not.toHaveBeenCalled()
    expect(mockCaptureAuthException).not.toHaveBeenCalled()
  })

  it('issues a verification token when the user is not fully verified', async () => {
    mockUserLookupByWhere([
      makeUser({
        role: Role.CLIENT,
        loginAttempts: 4,
        lockedUntil: null,
        phoneVerifiedAt: new Date('2026-04-08T10:00:00.000Z'),
        emailVerifiedAt: null,
      }),
    ])
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
      token: 'verification_token',
      nextUrl: '/looks?from=tap',
      isPhoneVerified: true,
      isEmailVerified: false,
      isFullyVerified: false,
    })

    expect(mockCreateVerificationToken).toHaveBeenCalledWith({
      userId: 'user_1',
      role: Role.CLIENT,
      authVersion: 1,
      deviceId: null,
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
    mockUserLookupByWhere([
      makeUser({
        role: Role.PRO,
        phoneVerifiedAt: new Date('2026-04-08T10:00:00.000Z'),
        emailVerifiedAt: new Date('2026-04-08T10:05:00.000Z'),
      }),
    ])
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
          url: 'https://app.tovis.app/api/v1/auth/login',
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
      token: 'active_token',
      nextUrl: '/looks?from=tap',
      isPhoneVerified: true,
      isEmailVerified: true,
      isFullyVerified: true,
    })

    expect(mockCreateActiveToken).toHaveBeenCalledWith({
      userId: 'user_1',
      role: Role.PRO,
      authVersion: 1,
      deviceId: null,
    })
    expect(mockCreateVerificationToken).not.toHaveBeenCalled()

    const setCookie = result.headers.get('set-cookie')
    expect(setCookie).toContain('tovis_token=active_token')
    expect(setCookie).toContain('Domain=.tovis.app')
    expect(setCookie).toContain('Secure')
    expect(mockCaptureAuthException).not.toHaveBeenCalled()
  })

  it('binds the session to a native deviceId supplied in the body', async () => {
    mockUserLookupByWhere([
      makeUser({
        role: Role.PRO,
        phoneVerifiedAt: new Date('2026-04-08T10:00:00.000Z'),
        emailVerifiedAt: new Date('2026-04-08T10:05:00.000Z'),
      }),
    ])
    mockVerifyPassword.mockResolvedValue(true)
    mockPrisma.user.update.mockResolvedValue({
      id: 'user_1',
      email: 'user@example.com',
      role: Role.PRO,
      authVersion: 1,
      phoneVerifiedAt: new Date('2026-04-08T10:00:00.000Z'),
      emailVerifiedAt: new Date('2026-04-08T10:05:00.000Z'),
    })

    await POST(
      makeRequest({
        email: 'user@example.com',
        password: 'Secret123!',
        deviceId: 'device_abc',
      }),
    )

    expect(mockCreateActiveToken).toHaveBeenCalledWith({
      userId: 'user_1',
      role: Role.PRO,
      authVersion: 1,
      deviceId: 'device_abc',
    })
  })

  it('auto-unlocks an expired lock and clears state on successful login', async () => {
    mockUserLookupByWhere([
      makeUser({
        role: Role.CLIENT,
        loginAttempts: 10,
        lockedUntil: new Date('2026-04-16T11:29:59.000Z'),
        phoneVerifiedAt: new Date('2026-04-08T10:00:00.000Z'),
        emailVerifiedAt: null,
      }),
    ])
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
      token: 'verification_token',
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
    const error = new Error('db blew up')
    mockPrisma.user.findMany.mockRejectedValue(error)

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
      error,
    })
  })
})