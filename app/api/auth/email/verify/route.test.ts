import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AuthVerificationPurpose, Role } from '@prisma/client'

const mockCookies = vi.hoisted(() => vi.fn())
const mockVerifyToken = vi.hoisted(() => vi.fn())
const mockCreateActiveToken = vi.hoisted(() => vi.fn())
const mockCreateVerificationToken = vi.hoisted(() => vi.fn())

const mockPrisma = vi.hoisted(() => ({
  emailVerificationToken: {
    findFirst: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
  },
  user: {
    update: vi.fn(),
  },
  $transaction: vi.fn(),
}))

vi.mock('next/headers', () => ({
  cookies: mockCookies,
}))

vi.mock('@/lib/auth', () => ({
  verifyToken: mockVerifyToken,
  createActiveToken: mockCreateActiveToken,
  createVerificationToken: mockCreateVerificationToken,
}))

vi.mock('@/lib/prisma', () => ({
  prisma: mockPrisma,
}))

import { POST } from './route'

function resetMockGroup(group: Record<string, ReturnType<typeof vi.fn>>) {
  for (const fn of Object.values(group)) {
    fn.mockReset()
  }
}

function makeRequest(args: {
  url?: string
  body?: Record<string, unknown>
  headers?: Record<string, string>
}) {
  return new Request(args.url ?? 'http://localhost/api/auth/email/verify', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(args.headers ?? {}),
    },
    body: JSON.stringify(args.body ?? {}),
  })
}

function makeRecord(args?: {
  userId?: string
  role?: Role
  authVersion?: number
  usedAt?: Date | null
  expiresAt?: Date
  phoneVerifiedAt?: Date | null
  emailVerifiedAt?: Date | null
}) {
  return {
    id: 'evt_1',
    userId: args?.userId ?? 'user_1',
    email: 'user@example.com',
    expiresAt: args?.expiresAt ?? new Date('2099-04-08T12:00:00.000Z'),
    usedAt: args?.usedAt === undefined ? null : args.usedAt,
    user: {
      id: args?.userId ?? 'user_1',
      role: args?.role ?? Role.CLIENT,
      authVersion: args?.authVersion ?? 1,
      phoneVerifiedAt:
        args?.phoneVerifiedAt === undefined ? null : args.phoneVerifiedAt,
      emailVerifiedAt:
        args?.emailVerifiedAt === undefined ? null : args.emailVerifiedAt,
    },
  }
}

describe('app/api/auth/email/verify/route', () => {
  beforeEach(() => {
    resetMockGroup(mockPrisma.emailVerificationToken)
    resetMockGroup(mockPrisma.user)
    mockPrisma.$transaction.mockReset()

    mockCookies.mockReset()
    mockVerifyToken.mockReset()
    mockCreateActiveToken.mockReset()
    mockCreateVerificationToken.mockReset()

    mockCookies.mockResolvedValue({
      get: vi.fn(() => undefined),
    })

    mockVerifyToken.mockReturnValue(null)
    mockCreateActiveToken.mockReturnValue('active_token')
    mockCreateVerificationToken.mockReturnValue('verification_token')
  })

  it('returns 400 when no verification token is provided', async () => {
    const result = await POST(
      makeRequest({
        body: {},
      }),
    )
    const body = await result.json()

    expect(result.status).toBe(400)
    expect(body.code).toBe('TOKEN_REQUIRED')
    expect(mockPrisma.emailVerificationToken.findFirst).not.toHaveBeenCalled()
  })

  it('returns 400 when the token is invalid', async () => {
    mockPrisma.emailVerificationToken.findFirst.mockResolvedValue(null)

    const result = await POST(
      makeRequest({
        url: 'http://localhost/api/auth/email/verify?token=bad_token',
      }),
    )
    const body = await result.json()

    expect(result.status).toBe(400)
    expect(body.code).toBe('TOKEN_INVALID')

    expect(mockPrisma.emailVerificationToken.findFirst).toHaveBeenCalledWith({
      where: {
        purpose: AuthVerificationPurpose.EMAIL_VERIFY,
        tokenHash: expect.any(String),
      },
      select: {
        id: true,
        userId: true,
        email: true,
        expiresAt: true,
        usedAt: true,
        user: {
          select: {
            id: true,
            role: true,
            authVersion: true,
            phoneVerifiedAt: true,
            emailVerifiedAt: true,
          },
        },
      },
    })
  })

  it('returns 400 when the token has already been used', async () => {
    mockPrisma.emailVerificationToken.findFirst.mockResolvedValue(
      makeRecord({
        usedAt: new Date('2026-04-08T10:00:00.000Z'),
      }),
    )

    const result = await POST(
      makeRequest({
        url: 'http://localhost/api/auth/email/verify?token=used_token',
      }),
    )
    const body = await result.json()

    expect(result.status).toBe(400)
    expect(body.code).toBe('TOKEN_USED')
    expect(mockPrisma.emailVerificationToken.update).not.toHaveBeenCalled()
  })

  it('returns 400 and marks the token used when it is expired', async () => {
    mockPrisma.emailVerificationToken.findFirst.mockResolvedValue(
      makeRecord({
        expiresAt: new Date('2000-01-01T00:00:00.000Z'),
      }),
    )

    const result = await POST(
      makeRequest({
        url: 'http://localhost/api/auth/email/verify?token=expired_token',
      }),
    )
    const body = await result.json()

    expect(result.status).toBe(400)
    expect(body.code).toBe('TOKEN_EXPIRED')

    expect(mockPrisma.emailVerificationToken.update).toHaveBeenCalledWith({
      where: { id: 'evt_1' },
      data: { usedAt: expect.any(Date) },
    })
  })

  it('verifies email and returns partial verification state when phone is still unverified', async () => {
    mockPrisma.emailVerificationToken.findFirst.mockResolvedValue(
      makeRecord({
        role: Role.CLIENT,
        phoneVerifiedAt: null,
        emailVerifiedAt: null,
      }),
    )

    const tx = {
      emailVerificationToken: {
        update: vi.fn().mockResolvedValue({}),
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
      },
      user: {
        update: vi.fn().mockResolvedValue({
          id: 'user_1',
          email: 'user@example.com',
          role: Role.CLIENT,
          authVersion: 1,
          phoneVerifiedAt: null,
          emailVerifiedAt: new Date('2026-04-08T12:00:00.000Z'),
        }),
      },
    }

    mockPrisma.$transaction.mockImplementation(
      async (fn: (txArg: typeof tx) => Promise<unknown>) => fn(tx),
    )

    const result = await POST(
      makeRequest({
        body: { token: 'body_token' },
      }),
    )
    const body = await result.json()

    expect(result.status).toBe(200)
    expect(body).toEqual({
      ok: true,
      alreadyVerified: false,
      isPhoneVerified: false,
      isEmailVerified: true,
      isFullyVerified: false,
      requiresPhoneVerification: true,
    })

    expect(tx.emailVerificationToken.update).toHaveBeenCalledWith({
      where: { id: 'evt_1' },
      data: { usedAt: expect.any(Date) },
    })

    expect(tx.emailVerificationToken.updateMany).toHaveBeenCalledWith({
      where: {
        userId: 'user_1',
        purpose: AuthVerificationPurpose.EMAIL_VERIFY,
        usedAt: null,
      },
      data: { usedAt: expect.any(Date) },
    })

    expect(tx.user.update).toHaveBeenCalledWith({
      where: { id: 'user_1' },
      data: {
        emailVerifiedAt: expect.any(Date),
      },
      select: {
        id: true,
        email: true,
        role: true,
        authVersion: true,
        phoneVerifiedAt: true,
        emailVerifiedAt: true,
      },
    })

    expect(mockCreateActiveToken).not.toHaveBeenCalled()
    expect(mockCreateVerificationToken).not.toHaveBeenCalled()
  })

  it('refreshes the cookie to an ACTIVE session when the authenticated user becomes fully verified', async () => {
    mockPrisma.emailVerificationToken.findFirst.mockResolvedValue(
      makeRecord({
        userId: 'user_1',
        role: Role.PRO,
        phoneVerifiedAt: new Date('2026-04-08T11:00:00.000Z'),
        emailVerifiedAt: null,
      }),
    )

    const getCookie = vi.fn(() => ({ value: 'existing_cookie_token' }))
    mockCookies.mockResolvedValue({
      get: getCookie,
    })
    mockVerifyToken.mockReturnValue({
      userId: 'user_1',
      role: Role.PRO,
      sessionKind: 'VERIFICATION',
      authVersion: 1,
    })

    const tx = {
      emailVerificationToken: {
        update: vi.fn().mockResolvedValue({}),
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
      },
      user: {
        update: vi.fn().mockResolvedValue({
          id: 'user_1',
          email: 'user@example.com',
          role: Role.PRO,
          authVersion: 1,
          phoneVerifiedAt: new Date('2026-04-08T11:00:00.000Z'),
          emailVerifiedAt: new Date('2026-04-08T12:00:00.000Z'),
        }),
      },
    }

    mockPrisma.$transaction.mockImplementation(
      async (fn: (txArg: typeof tx) => Promise<unknown>) => fn(tx),
    )

    const result = await POST(
      makeRequest({
        url: 'https://app.tovis.app/api/auth/email/verify?token=good_token',
        headers: {
          host: 'app.tovis.app',
          'x-forwarded-host': 'app.tovis.app',
          'x-forwarded-proto': 'https',
        },
      }),
    )
    const body = await result.json()

    expect(result.status).toBe(200)
    expect(body).toEqual({
      ok: true,
      alreadyVerified: false,
      isPhoneVerified: true,
      isEmailVerified: true,
      isFullyVerified: true,
      requiresPhoneVerification: false,
    })

    expect(getCookie).toHaveBeenCalledWith('tovis_token')
    expect(mockVerifyToken).toHaveBeenCalledWith('existing_cookie_token')
    expect(mockCreateActiveToken).toHaveBeenCalledWith({
      userId: 'user_1',
      role: Role.PRO,
      authVersion: 1,
    })
    expect(mockCreateVerificationToken).not.toHaveBeenCalled()

    const setCookie = result.headers.get('set-cookie')
    expect(setCookie).toContain('tovis_token=active_token')
  })

  it('refreshes the cookie to a verification session when the authenticated user is still missing phone verification', async () => {
    mockPrisma.emailVerificationToken.findFirst.mockResolvedValue(
      makeRecord({
        userId: 'user_1',
        role: Role.CLIENT,
        phoneVerifiedAt: null,
        emailVerifiedAt: null,
      }),
    )

    const getCookie = vi.fn(() => ({ value: 'existing_cookie_token' }))
    mockCookies.mockResolvedValue({
      get: getCookie,
    })
    mockVerifyToken.mockReturnValue({
      userId: 'user_1',
      role: Role.CLIENT,
      sessionKind: 'VERIFICATION',
      authVersion: 1,
    })

    const tx = {
      emailVerificationToken: {
        update: vi.fn().mockResolvedValue({}),
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
      },
      user: {
        update: vi.fn().mockResolvedValue({
          id: 'user_1',
          email: 'user@example.com',
          role: Role.CLIENT,
          authVersion: 1,
          phoneVerifiedAt: null,
          emailVerifiedAt: new Date('2026-04-08T12:00:00.000Z'),
        }),
      },
    }

    mockPrisma.$transaction.mockImplementation(
      async (fn: (txArg: typeof tx) => Promise<unknown>) => fn(tx),
    )

    const result = await POST(
      makeRequest({
        url: 'http://localhost/api/auth/email/verify?token=good_token',
        headers: {
          host: 'localhost:3000',
        },
      }),
    )
    const body = await result.json()

    expect(result.status).toBe(200)
    expect(body).toEqual({
      ok: true,
      alreadyVerified: false,
      isPhoneVerified: false,
      isEmailVerified: true,
      isFullyVerified: false,
      requiresPhoneVerification: true,
    })

    expect(mockCreateVerificationToken).toHaveBeenCalledWith({
      userId: 'user_1',
      role: Role.CLIENT,
      authVersion: 1,
    })
    expect(mockCreateActiveToken).not.toHaveBeenCalled()

    const setCookie = result.headers.get('set-cookie')
    expect(setCookie).toContain('tovis_token=verification_token')
  })

  it('does not refresh cookies when the verified token belongs to a different user than the authenticated cookie', async () => {
    mockPrisma.emailVerificationToken.findFirst.mockResolvedValue(
      makeRecord({
        userId: 'user_2',
        role: Role.CLIENT,
        phoneVerifiedAt: new Date('2026-04-08T11:00:00.000Z'),
        emailVerifiedAt: null,
      }),
    )

    mockCookies.mockResolvedValue({
      get: vi.fn(() => ({ value: 'existing_cookie_token' })),
    })
    mockVerifyToken.mockReturnValue({
      userId: 'user_1',
      role: Role.CLIENT,
      sessionKind: 'VERIFICATION',
      authVersion: 1,
    })

    const tx = {
      emailVerificationToken: {
        update: vi.fn().mockResolvedValue({}),
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
      },
      user: {
        update: vi.fn().mockResolvedValue({
          id: 'user_2',
          email: 'other@example.com',
          role: Role.CLIENT,
          authVersion: 1,
          phoneVerifiedAt: new Date('2026-04-08T11:00:00.000Z'),
          emailVerifiedAt: new Date('2026-04-08T12:00:00.000Z'),
        }),
      },
    }

    mockPrisma.$transaction.mockImplementation(
      async (fn: (txArg: typeof tx) => Promise<unknown>) => fn(tx),
    )

    const result = await POST(
      makeRequest({
        url: 'http://localhost/api/auth/email/verify?token=other_user_token',
      }),
    )
    const body = await result.json()

    expect(result.status).toBe(200)
    expect(body.isFullyVerified).toBe(true)

    expect(mockCreateActiveToken).not.toHaveBeenCalled()
    expect(mockCreateVerificationToken).not.toHaveBeenCalled()
    expect(result.headers.get('set-cookie')).toBeNull()
  })
})