import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Role } from '@prisma/client'

const mockVerifyPassword = vi.hoisted(() => vi.fn())
const mockCreateActiveToken = vi.hoisted(() => vi.fn())
const mockCreateVerificationToken = vi.hoisted(() => vi.fn())

const mockConsumeTapIntent = vi.hoisted(() => vi.fn())

const mockEnforceRateLimit = vi.hoisted(() => vi.fn())
const mockRateLimitIdentity = vi.hoisted(() => vi.fn())

const mockPrisma = vi.hoisted(() => ({
  user: {
    findUnique: vi.fn(),
  },
}))

vi.mock('@/lib/prisma', () => ({
  prisma: mockPrisma,
}))

vi.mock('@/lib/auth', () => ({
  verifyPassword: mockVerifyPassword,
  createActiveToken: mockCreateActiveToken,
  createVerificationToken: mockCreateVerificationToken,
}))

vi.mock('@/lib/tapIntentConsume', () => ({
  consumeTapIntent: mockConsumeTapIntent,
}))

vi.mock('@/app/api/_utils', async () => {
  const actual = await vi.importActual<typeof import('@/app/api/_utils')>(
    '@/app/api/_utils',
  )

  return {
    ...actual,
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

function makeRequest(body: unknown, extras?: { url?: string; headers?: Record<string, string> }) {
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
    phoneVerifiedAt:
      args?.phoneVerifiedAt === undefined
        ? null
        : args.phoneVerifiedAt,
    emailVerifiedAt:
      args?.emailVerifiedAt === undefined
        ? null
        : args.emailVerifiedAt,
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

describe('app/api/auth/login/route', () => {
  beforeEach(() => {
    resetMockGroup(mockPrisma.user)

    mockVerifyPassword.mockReset()
    mockCreateActiveToken.mockReset()
    mockCreateVerificationToken.mockReset()

    mockConsumeTapIntent.mockReset()

    mockEnforceRateLimit.mockReset()
    mockRateLimitIdentity.mockReset()

    mockRateLimitIdentity.mockResolvedValue('ip:test')
    mockEnforceRateLimit.mockResolvedValue(null)

    mockCreateActiveToken.mockReturnValue('active_token')
    mockCreateVerificationToken.mockReturnValue('verification_token')

    mockConsumeTapIntent.mockResolvedValue({
      nextUrl: '/looks?from=tap',
    })
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
      identity: 'ip:test',
    })
    expect(result).toBe(rateLimitRes)
    expect(result.status).toBe(429)
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
  })

  it('returns 401 when the user is not found', async () => {
    mockPrisma.user.findUnique.mockResolvedValue(null)

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
  })

  it('returns 401 when the password does not match', async () => {
    mockPrisma.user.findUnique.mockResolvedValue(makeUser())
    mockVerifyPassword.mockResolvedValue(false)

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
  })

  it('returns 403 when expectedRole does not match the user role', async () => {
    mockPrisma.user.findUnique.mockResolvedValue(
      makeUser({
        role: Role.CLIENT,
      }),
    )
    mockVerifyPassword.mockResolvedValue(true)

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
  })

  it('returns 409 when a PRO account is missing its professional profile', async () => {
    mockPrisma.user.findUnique.mockResolvedValue(
      makeUser({
        role: Role.PRO,
        professionalProfileId: null,
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

    expect(result.status).toBe(409)
    expect(body).toEqual({
      ok: false,
      error: 'Professional setup is not complete yet.',
      code: 'PRO_SETUP_REQUIRED',
    })
  })

  it('issues a verification token when the user is not fully verified', async () => {
    mockPrisma.user.findUnique.mockResolvedValue(
      makeUser({
        role: Role.CLIENT,
        phoneVerifiedAt: new Date('2026-04-08T10:00:00.000Z'),
        emailVerifiedAt: null,
      }),
    )
    mockVerifyPassword.mockResolvedValue(true)

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
    })
    expect(mockCreateActiveToken).not.toHaveBeenCalled()

    expect(mockConsumeTapIntent).toHaveBeenCalledWith({
      tapIntentId: 'tap_1',
      userId: 'user_1',
    })

    const setCookie = result.headers.get('set-cookie')
    expect(setCookie).toContain('tovis_token=verification_token')
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
    })
    expect(mockCreateVerificationToken).not.toHaveBeenCalled()

    const setCookie = result.headers.get('set-cookie')
    expect(setCookie).toContain('tovis_token=active_token')
  })
})