import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AuthVerificationPurpose, Role } from '@prisma/client'

const mockCookies = vi.hoisted(() => vi.fn())
const mockVerifyToken = vi.hoisted(() => vi.fn())
const mockCreateActiveToken = vi.hoisted(() => vi.fn())
const mockCreateVerificationToken = vi.hoisted(() => vi.fn())
const mockEnforceVerificationVerifyThrottle = vi.hoisted(() => vi.fn())
const mockSha256Hex = vi.hoisted(() => vi.fn())
const mockTimingSafeEqualHex = vi.hoisted(() => vi.fn())
const mockLogAuthEvent = vi.hoisted(() => vi.fn())
const mockCaptureAuthException = vi.hoisted(() => vi.fn())

const mockPrisma = vi.hoisted(() => ({
  emailVerificationToken: {
    findUnique: vi.fn(),
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

vi.mock('@/app/api/_utils/auth/verificationThrottle', () => ({
  enforceVerificationVerifyThrottle: mockEnforceVerificationVerifyThrottle,
}))

vi.mock('@/lib/auth/timingSafe', () => ({
  sha256Hex: mockSha256Hex,
  timingSafeEqualHex: mockTimingSafeEqualHex,
}))

vi.mock('@/lib/prisma', () => ({
  prisma: mockPrisma,
}))

vi.mock('@/lib/observability/authEvents', () => ({
  logAuthEvent: mockLogAuthEvent,
  captureAuthException: mockCaptureAuthException,
}))

import { POST } from './route'

function resetMockGroup(group: Record<string, ReturnType<typeof vi.fn>>) {
  for (const fn of Object.values(group)) {
    fn.mockReset()
  }
}

function makeRequest(args?: {
  body?: Record<string, unknown>
  headers?: Record<string, string>
}) {
  return new Request('http://localhost/api/auth/email/verify', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(args?.headers ?? {}),
    },
    body: JSON.stringify(args?.body ?? {}),
  })
}

function makeRecord(args?: {
  id?: string
  userId?: string
  role?: Role
  authVersion?: number
  purpose?: AuthVerificationPurpose
  tokenHash?: string
  attempts?: number
  usedAt?: Date | null
  expiresAt?: Date
  phoneVerifiedAt?: Date | null
  emailVerifiedAt?: Date | null
  email?: string
}) {
  return {
    id: args?.id ?? 'evt_1',
    userId: args?.userId ?? 'user_1',
    purpose: args?.purpose ?? AuthVerificationPurpose.EMAIL_VERIFY,
    email: args?.email ?? 'user@example.com',
    tokenHash: args?.tokenHash ?? 'stored_hash',
    attempts: args?.attempts ?? 0,
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
    mockEnforceVerificationVerifyThrottle.mockReset()
    mockSha256Hex.mockReset()
    mockTimingSafeEqualHex.mockReset()
    mockLogAuthEvent.mockReset()
    mockCaptureAuthException.mockReset()

    mockCookies.mockResolvedValue({
      get: vi.fn(() => undefined),
    })

    mockVerifyToken.mockReturnValue(null)
    mockCreateActiveToken.mockReturnValue('active_token')
    mockCreateVerificationToken.mockReturnValue('verification_token')
    mockEnforceVerificationVerifyThrottle.mockResolvedValue(null)
    mockSha256Hex.mockReturnValue('submitted_hash')
    mockTimingSafeEqualHex.mockReturnValue(true)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('returns 400 when verificationId is missing', async () => {
    const result = await POST(
      makeRequest({
        body: { token: 'good_token' },
      }),
    )
    const body = await result.json()

    expect(result.status).toBe(400)
    expect(body).toEqual({
      ok: false,
      error: 'Verification token is required.',
      code: 'TOKEN_REQUIRED',
    })
    expect(mockPrisma.emailVerificationToken.findUnique).not.toHaveBeenCalled()
    expect(mockLogAuthEvent).not.toHaveBeenCalled()
    expect(mockCaptureAuthException).not.toHaveBeenCalled()
  })

  it('returns 400 when token is missing', async () => {
    const result = await POST(
      makeRequest({
        body: { verificationId: 'evt_1' },
      }),
    )
    const body = await result.json()

    expect(result.status).toBe(400)
    expect(body).toEqual({
      ok: false,
      error: 'Verification token is required.',
      code: 'TOKEN_REQUIRED',
    })
    expect(mockPrisma.emailVerificationToken.findUnique).not.toHaveBeenCalled()
    expect(mockLogAuthEvent).not.toHaveBeenCalled()
    expect(mockCaptureAuthException).not.toHaveBeenCalled()
  })

  it('returns 429 when verify throttling blocks the request', async () => {
    const throttleResponse = new Response(
      JSON.stringify({
        ok: false,
        error: 'Too many verification attempts. Please wait and try again.',
        code: 'RATE_LIMITED',
      }),
      {
        status: 429,
        headers: { 'Content-Type': 'application/json' },
      },
    )

    mockEnforceVerificationVerifyThrottle.mockResolvedValue(throttleResponse)

    const result = await POST(
      makeRequest({
        body: { verificationId: 'evt_1', token: 'good_token' },
      }),
    )

    expect(mockEnforceVerificationVerifyThrottle).toHaveBeenCalledWith({
      request: expect.any(Request),
      scope: 'email-verify',
      subjectKey: 'evt_1',
    })
    expect(result).toBe(throttleResponse)
    expect(mockPrisma.emailVerificationToken.findUnique).not.toHaveBeenCalled()
    expect(mockLogAuthEvent).not.toHaveBeenCalled()
    expect(mockCaptureAuthException).not.toHaveBeenCalled()
  })

  it('returns 400 when the token record is invalid', async () => {
    mockPrisma.emailVerificationToken.findUnique.mockResolvedValue(null)

    const result = await POST(
      makeRequest({
        body: { verificationId: 'evt_1', token: 'bad_token' },
      }),
    )
    const body = await result.json()

    expect(result.status).toBe(400)
    expect(body).toEqual({
      ok: false,
      error: 'Invalid verification token.',
      code: 'TOKEN_INVALID',
    })

    expect(mockPrisma.emailVerificationToken.findUnique).toHaveBeenCalledWith({
      where: { id: 'evt_1' },
      select: {
        id: true,
        userId: true,
        purpose: true,
        email: true,
        tokenHash: true,
        attempts: true,
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
    expect(mockLogAuthEvent).not.toHaveBeenCalled()
    expect(mockCaptureAuthException).not.toHaveBeenCalled()
  })

  it('returns 400 when the record purpose is not EMAIL_VERIFY', async () => {
    const nonEmailVerifyRecord = makeRecord({
      purpose: 'NOT_EMAIL_VERIFY' as AuthVerificationPurpose,
    })

    mockPrisma.emailVerificationToken.findUnique.mockResolvedValue(
      nonEmailVerifyRecord,
    )

    const result = await POST(
      makeRequest({
        body: { verificationId: 'evt_1', token: 'bad_token' },
      }),
    )
    const body = await result.json()

    expect(result.status).toBe(400)
    expect(body).toEqual({
      ok: false,
      error: 'Invalid verification token.',
      code: 'TOKEN_INVALID',
    })
    expect(mockLogAuthEvent).not.toHaveBeenCalled()
    expect(mockCaptureAuthException).not.toHaveBeenCalled()
  })

  it('returns 400 when the token has already been used', async () => {
    mockPrisma.emailVerificationToken.findUnique.mockResolvedValue(
      makeRecord({
        usedAt: new Date('2026-04-08T10:00:00.000Z'),
      }),
    )

    const result = await POST(
      makeRequest({
        body: { verificationId: 'evt_1', token: 'used_token' },
      }),
    )
    const body = await result.json()

    expect(result.status).toBe(400)
    expect(body).toEqual({
      ok: false,
      error: 'This verification link has already been used.',
      code: 'TOKEN_USED',
    })
    expect(mockPrisma.emailVerificationToken.update).not.toHaveBeenCalled()
    expect(mockLogAuthEvent).not.toHaveBeenCalled()
    expect(mockCaptureAuthException).not.toHaveBeenCalled()
  })

  it('returns 400 and marks the token used when it is expired', async () => {
    mockPrisma.emailVerificationToken.findUnique.mockResolvedValue(
      makeRecord({
        expiresAt: new Date('2000-01-01T00:00:00.000Z'),
      }),
    )

    const result = await POST(
      makeRequest({
        body: { verificationId: 'evt_1', token: 'expired_token' },
      }),
    )
    const body = await result.json()

    expect(result.status).toBe(400)
    expect(body).toEqual({
      ok: false,
      error: 'This verification link has expired.',
      code: 'TOKEN_EXPIRED',
    })

    expect(mockPrisma.emailVerificationToken.update).toHaveBeenCalledWith({
      where: { id: 'evt_1' },
      data: { usedAt: expect.any(Date) },
    })
    expect(mockLogAuthEvent).not.toHaveBeenCalled()
    expect(mockCaptureAuthException).not.toHaveBeenCalled()
  })

  it('increments attempts when the token is incorrect and not yet locked', async () => {
    mockPrisma.emailVerificationToken.findUnique.mockResolvedValue(
      makeRecord({
        attempts: 1,
        tokenHash: 'stored_hash',
      }),
    )
    mockTimingSafeEqualHex.mockReturnValue(false)
    mockPrisma.emailVerificationToken.updateMany.mockResolvedValue({ count: 1 })

    const result = await POST(
      makeRequest({
        body: { verificationId: 'evt_1', token: 'bad_token' },
      }),
    )
    const body = await result.json()

    expect(result.status).toBe(400)
    expect(body).toEqual({
      ok: false,
      error: 'Invalid verification token.',
      code: 'TOKEN_INVALID',
    })

    expect(mockSha256Hex).toHaveBeenCalledWith('bad_token')
    expect(mockTimingSafeEqualHex).toHaveBeenCalledWith(
      'submitted_hash',
      'stored_hash',
    )

    expect(mockPrisma.emailVerificationToken.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'evt_1',
        usedAt: null,
        attempts: 1,
      },
      data: {
        attempts: { increment: 1 },
      },
    })

    expect(mockPrisma.$transaction).not.toHaveBeenCalled()
    expect(mockLogAuthEvent).not.toHaveBeenCalled()
    expect(mockCaptureAuthException).not.toHaveBeenCalled()
  })

  it('locks the current token on the fifth wrong attempt', async () => {
    mockPrisma.emailVerificationToken.findUnique.mockResolvedValue(
      makeRecord({
        id: 'evt_lock',
        attempts: 4,
        tokenHash: 'stored_hash',
      }),
    )
    mockTimingSafeEqualHex.mockReturnValue(false)
    mockPrisma.emailVerificationToken.updateMany.mockResolvedValue({ count: 1 })

    const result = await POST(
      makeRequest({
        body: { verificationId: 'evt_lock', token: 'bad_token' },
      }),
    )
    const body = await result.json()

    expect(result.status).toBe(429)
    expect(body).toEqual({
      ok: false,
      error:
        'Too many incorrect verification attempts. Request a new verification email.',
      code: 'TOKEN_LOCKED',
      resendRequired: true,
    })

    expect(mockPrisma.emailVerificationToken.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'evt_lock',
        usedAt: null,
        attempts: 4,
      },
      data: {
        attempts: { increment: 1 },
        usedAt: expect.any(Date),
      },
    })

    expect(mockPrisma.$transaction).not.toHaveBeenCalled()
    expect(mockLogAuthEvent).not.toHaveBeenCalled()
    expect(mockCaptureAuthException).not.toHaveBeenCalled()
  })

  it('verifies email and returns partial verification state when phone is still unverified', async () => {
    mockPrisma.emailVerificationToken.findUnique.mockResolvedValue(
      makeRecord({
        role: Role.CLIENT,
        phoneVerifiedAt: null,
        emailVerifiedAt: null,
        attempts: 0,
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
        body: { verificationId: 'evt_1', token: 'body_token' },
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

    expect(mockEnforceVerificationVerifyThrottle).toHaveBeenCalledWith({
      request: expect.any(Request),
      scope: 'email-verify',
      subjectKey: 'evt_1',
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

    expect(mockLogAuthEvent).toHaveBeenCalledWith({
      level: 'info',
      event: 'auth.email.verify.success',
      route: 'auth.email.verify',
      userId: 'user_1',
      email: 'user@example.com',
      verificationId: 'evt_1',
      meta: {
        isPhoneVerified: false,
        isEmailVerified: true,
        isFullyVerified: false,
      },
    })
    expect(mockCaptureAuthException).not.toHaveBeenCalled()
  })

  it('refreshes the cookie to an ACTIVE session when the authenticated user becomes fully verified', async () => {
    mockPrisma.emailVerificationToken.findUnique.mockResolvedValue(
      makeRecord({
        userId: 'user_1',
        role: Role.PRO,
        phoneVerifiedAt: new Date('2026-04-08T11:00:00.000Z'),
        emailVerifiedAt: null,
        attempts: 0,
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
        body: { verificationId: 'evt_1', token: 'good_token' },
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

    expect(mockLogAuthEvent).toHaveBeenCalledWith({
      level: 'info',
      event: 'auth.email.verify.success',
      route: 'auth.email.verify',
      userId: 'user_1',
      email: 'user@example.com',
      verificationId: 'evt_1',
      meta: {
        isPhoneVerified: true,
        isEmailVerified: true,
        isFullyVerified: true,
      },
    })
    expect(mockCaptureAuthException).not.toHaveBeenCalled()
  })

  it('refreshes the cookie to a verification session when the authenticated user is still missing phone verification', async () => {
    mockPrisma.emailVerificationToken.findUnique.mockResolvedValue(
      makeRecord({
        userId: 'user_1',
        role: Role.CLIENT,
        phoneVerifiedAt: null,
        emailVerifiedAt: null,
        attempts: 0,
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
        body: { verificationId: 'evt_1', token: 'good_token' },
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

    expect(mockLogAuthEvent).toHaveBeenCalledWith({
      level: 'info',
      event: 'auth.email.verify.success',
      route: 'auth.email.verify',
      userId: 'user_1',
      email: 'user@example.com',
      verificationId: 'evt_1',
      meta: {
        isPhoneVerified: false,
        isEmailVerified: true,
        isFullyVerified: false,
      },
    })
    expect(mockCaptureAuthException).not.toHaveBeenCalled()
  })

  it('does not refresh cookies when the verified token belongs to a different user than the authenticated cookie', async () => {
    mockPrisma.emailVerificationToken.findUnique.mockResolvedValue(
      makeRecord({
        userId: 'user_2',
        role: Role.CLIENT,
        phoneVerifiedAt: new Date('2026-04-08T11:00:00.000Z'),
        emailVerifiedAt: null,
        attempts: 0,
        email: 'other@example.com',
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
        body: { verificationId: 'evt_1', token: 'other_user_token' },
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

    expect(mockCreateActiveToken).not.toHaveBeenCalled()
    expect(mockCreateVerificationToken).not.toHaveBeenCalled()
    expect(result.headers.get('set-cookie')).toBeNull()

    expect(mockLogAuthEvent).toHaveBeenCalledWith({
      level: 'info',
      event: 'auth.email.verify.success',
      route: 'auth.email.verify',
      userId: 'user_2',
      email: 'other@example.com',
      verificationId: 'evt_1',
      meta: {
        isPhoneVerified: true,
        isEmailVerified: true,
        isFullyVerified: true,
      },
    })
    expect(mockCaptureAuthException).not.toHaveBeenCalled()
  })

  it('returns 500 and captures the exception when an unexpected error occurs', async () => {
    mockPrisma.emailVerificationToken.findUnique.mockRejectedValue(
      new Error('database blew up'),
    )

    const result = await POST(
      makeRequest({
        body: { verificationId: 'evt_1', token: 'good_token' },
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
      event: 'auth.email.verify.failed',
      route: 'auth.email.verify',
      code: 'INTERNAL',
      verificationId: 'evt_1',
      userId: null,
      email: null,
      error: expect.any(Error),
    })
  })
})