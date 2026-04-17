import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Role } from '@prisma/client'

const mockRequireUser = vi.hoisted(() => vi.fn())
const mockCreateActiveToken = vi.hoisted(() => vi.fn())
const mockCreateVerificationToken = vi.hoisted(() => vi.fn())
const mockEnforceVerificationVerifyThrottle = vi.hoisted(() => vi.fn())
const mockSha256Hex = vi.hoisted(() => vi.fn())
const mockTimingSafeEqualHex = vi.hoisted(() => vi.fn())
const mockLogAuthEvent = vi.hoisted(() => vi.fn())
const mockCaptureAuthException = vi.hoisted(() => vi.fn())

const mockPrisma = vi.hoisted(() => ({
  phoneVerification: {
    findFirst: vi.fn(),
    updateMany: vi.fn(),
  },
  $transaction: vi.fn(),
}))

vi.mock('@/app/api/_utils/auth/requireUser', () => ({
  requireUser: mockRequireUser,
}))

vi.mock('@/lib/auth', () => ({
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

function makeUser(args?: {
  role?: Role
  phone?: string | null
  phoneVerifiedAt?: Date | null
  emailVerifiedAt?: Date | null
}) {
  const role = args?.role ?? Role.CLIENT
  const phoneVerifiedAt =
    args?.phoneVerifiedAt === undefined ? null : args.phoneVerifiedAt
  const emailVerifiedAt =
    args?.emailVerifiedAt === undefined ? null : args.emailVerifiedAt

  return {
    id: 'user_1',
    email: 'user@example.com',
    phone: args?.phone === undefined ? '+15551234567' : args.phone,
    role,
    authVersion: 1,
    sessionKind: 'VERIFICATION' as const,
    phoneVerifiedAt,
    emailVerifiedAt,
    isPhoneVerified: Boolean(phoneVerifiedAt),
    isEmailVerified: Boolean(emailVerifiedAt),
    isFullyVerified: Boolean(phoneVerifiedAt && emailVerifiedAt),
    clientProfile:
      role === Role.CLIENT
        ? {
            id: 'client_1',
            firstName: 'Tori',
            lastName: 'Morales',
            avatarUrl: null,
          }
        : null,
    professionalProfile:
      role === Role.PRO
        ? {
            id: 'pro_1',
            businessName: 'TOVIS Studio',
            handle: 'tovisstudio',
            avatarUrl: null,
            timeZone: 'America/Los_Angeles',
            location: null,
          }
        : null,
  }
}

function makeRequest(body: unknown, headers?: Record<string, string>) {
  return new Request('http://localhost/api/auth/phone/verify', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(headers ?? {}),
    },
    body: JSON.stringify(body),
  })
}

describe('app/api/auth/phone/verify/route', () => {
  beforeEach(() => {
    resetMockGroup(mockPrisma.phoneVerification)
    mockPrisma.$transaction.mockReset()

    mockRequireUser.mockReset()
    mockCreateActiveToken.mockReset()
    mockCreateVerificationToken.mockReset()
    mockEnforceVerificationVerifyThrottle.mockReset()
    mockSha256Hex.mockReset()
    mockTimingSafeEqualHex.mockReset()
    mockLogAuthEvent.mockReset()
    mockCaptureAuthException.mockReset()

    mockCreateActiveToken.mockReturnValue('active_token')
    mockCreateVerificationToken.mockReturnValue('verification_token')
    mockEnforceVerificationVerifyThrottle.mockResolvedValue(null)
    mockSha256Hex.mockReturnValue('submitted_hash')
    mockTimingSafeEqualHex.mockReturnValue(true)
  })

  it('passes through a failed auth result unchanged', async () => {
    const res = new Response(null, { status: 401 })
    mockRequireUser.mockResolvedValue({
      ok: false,
      res,
    })

    const result = await POST(makeRequest({ code: '123456' }))

    expect(mockRequireUser).toHaveBeenCalledWith({
      allowVerificationSession: true,
    })
    expect(result).toBe(res)
    expect(result.status).toBe(401)
    expect(mockLogAuthEvent).not.toHaveBeenCalled()
    expect(mockCaptureAuthException).not.toHaveBeenCalled()
  })

  it('returns 400 when code is missing', async () => {
    mockRequireUser.mockResolvedValue({
      ok: true,
      user: makeUser(),
    })

    const result = await POST(makeRequest({}))
    const body = await result.json()

    expect(result.status).toBe(400)
    expect(body).toEqual({
      ok: false,
      error: 'Verification code is required.',
      code: 'CODE_REQUIRED',
    })
    expect(mockLogAuthEvent).not.toHaveBeenCalled()
    expect(mockCaptureAuthException).not.toHaveBeenCalled()
  })

  it('returns 400 when code format is invalid', async () => {
    mockRequireUser.mockResolvedValue({
      ok: true,
      user: makeUser(),
    })

    const result = await POST(makeRequest({ code: '12ab' }))
    const body = await result.json()

    expect(result.status).toBe(400)
    expect(body).toEqual({
      ok: false,
      error: 'Invalid code format.',
      code: 'CODE_INVALID',
    })
    expect(mockLogAuthEvent).not.toHaveBeenCalled()
    expect(mockCaptureAuthException).not.toHaveBeenCalled()
  })

  it('returns alreadyVerified state when phone is already verified', async () => {
    mockRequireUser.mockResolvedValue({
      ok: true,
      user: makeUser({
        phoneVerifiedAt: new Date('2026-04-08T10:00:00.000Z'),
        emailVerifiedAt: null,
      }),
    })

    const result = await POST(makeRequest({ code: '123456' }))
    const body = await result.json()

    expect(result.status).toBe(200)
    expect(body).toEqual({
      ok: true,
      alreadyVerified: true,
      isPhoneVerified: true,
      isEmailVerified: false,
      isFullyVerified: false,
    })
    expect(mockPrisma.phoneVerification.findFirst).not.toHaveBeenCalled()
    expect(mockEnforceVerificationVerifyThrottle).not.toHaveBeenCalled()
    expect(mockCreateActiveToken).not.toHaveBeenCalled()
    expect(mockCreateVerificationToken).not.toHaveBeenCalled()
    expect(result.headers.get('set-cookie')).toBeNull()
    expect(mockLogAuthEvent).not.toHaveBeenCalled()
    expect(mockCaptureAuthException).not.toHaveBeenCalled()
  })

  it('returns 400 when the user has no phone number', async () => {
    mockRequireUser.mockResolvedValue({
      ok: true,
      user: makeUser({
        phone: null,
      }),
    })

    const result = await POST(makeRequest({ code: '123456' }))
    const body = await result.json()

    expect(result.status).toBe(400)
    expect(body).toEqual({
      ok: false,
      error: 'Phone number missing.',
      code: 'PHONE_REQUIRED',
    })
    expect(mockEnforceVerificationVerifyThrottle).not.toHaveBeenCalled()
    expect(mockCreateActiveToken).not.toHaveBeenCalled()
    expect(mockCreateVerificationToken).not.toHaveBeenCalled()
    expect(mockLogAuthEvent).not.toHaveBeenCalled()
    expect(mockCaptureAuthException).not.toHaveBeenCalled()
  })

  it('returns 429 when verify throttling blocks the request', async () => {
    mockRequireUser.mockResolvedValue({
      ok: true,
      user: makeUser(),
    })

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

    const result = await POST(makeRequest({ code: '123456' }))

    expect(mockEnforceVerificationVerifyThrottle).toHaveBeenCalledWith({
      request: expect.any(Request),
      scope: 'phone-verify',
      subjectKey: 'user_1',
    })
    expect(result).toBe(throttleResponse)
    expect(result.status).toBe(429)
    expect(mockPrisma.phoneVerification.findFirst).not.toHaveBeenCalled()
    expect(mockCreateActiveToken).not.toHaveBeenCalled()
    expect(mockCreateVerificationToken).not.toHaveBeenCalled()
    expect(mockLogAuthEvent).not.toHaveBeenCalled()
    expect(mockCaptureAuthException).not.toHaveBeenCalled()
  })

  it('returns 400 when there is no active verification record', async () => {
    mockRequireUser.mockResolvedValue({
      ok: true,
      user: makeUser(),
    })
    mockPrisma.phoneVerification.findFirst.mockResolvedValue(null)

    const result = await POST(makeRequest({ code: '123456' }))
    const body = await result.json()

    expect(result.status).toBe(400)
    expect(body).toEqual({
      ok: false,
      error: 'Incorrect or expired code.',
      code: 'CODE_MISMATCH',
    })

    expect(mockSha256Hex).toHaveBeenCalledWith('123456')
    expect(mockPrisma.phoneVerification.findFirst).toHaveBeenCalledWith({
      where: expect.objectContaining({
        userId: 'user_1',
        phone: '+15551234567',
        usedAt: null,
        expiresAt: expect.objectContaining({
          gt: expect.any(Date),
        }),
      }),
      select: {
        id: true,
        codeHash: true,
        attempts: true,
      },
      orderBy: { createdAt: 'desc' },
    })
    expect(mockTimingSafeEqualHex).not.toHaveBeenCalled()
    expect(mockCreateActiveToken).not.toHaveBeenCalled()
    expect(mockCreateVerificationToken).not.toHaveBeenCalled()
    expect(mockLogAuthEvent).not.toHaveBeenCalled()
    expect(mockCaptureAuthException).not.toHaveBeenCalled()
  })

  it('increments attempts when the code is incorrect and not yet locked', async () => {
    mockRequireUser.mockResolvedValue({
      ok: true,
      user: makeUser(),
    })

    mockPrisma.phoneVerification.findFirst.mockResolvedValue({
      id: 'pv_1',
      codeHash: 'stored_hash',
      attempts: 1,
    })
    mockTimingSafeEqualHex.mockReturnValue(false)
    mockPrisma.phoneVerification.updateMany.mockResolvedValue({ count: 1 })

    const result = await POST(makeRequest({ code: '123456' }))
    const body = await result.json()

    expect(result.status).toBe(400)
    expect(body).toEqual({
      ok: false,
      error: 'Incorrect or expired code.',
      code: 'CODE_MISMATCH',
    })

    expect(mockSha256Hex).toHaveBeenCalledWith('123456')
    expect(mockTimingSafeEqualHex).toHaveBeenCalledWith(
      'submitted_hash',
      'stored_hash',
    )

    expect(mockPrisma.phoneVerification.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'pv_1',
        usedAt: null,
        attempts: 1,
      },
      data: {
        attempts: { increment: 1 },
      },
    })

    expect(mockPrisma.$transaction).not.toHaveBeenCalled()
    expect(mockCreateActiveToken).not.toHaveBeenCalled()
    expect(mockCreateVerificationToken).not.toHaveBeenCalled()
    expect(mockLogAuthEvent).not.toHaveBeenCalled()
    expect(mockCaptureAuthException).not.toHaveBeenCalled()
  })

  it('locks the current code on the fifth wrong attempt', async () => {
    mockRequireUser.mockResolvedValue({
      ok: true,
      user: makeUser(),
    })

    mockPrisma.phoneVerification.findFirst.mockResolvedValue({
      id: 'pv_lock',
      codeHash: 'stored_hash',
      attempts: 4,
    })
    mockTimingSafeEqualHex.mockReturnValue(false)
    mockPrisma.phoneVerification.updateMany.mockResolvedValue({ count: 1 })

    const result = await POST(makeRequest({ code: '123456' }))
    const body = await result.json()

    expect(result.status).toBe(429)
    expect(body).toEqual({
      ok: false,
      error:
        'Too many incorrect verification attempts. Request a new verification code.',
      code: 'CODE_LOCKED',
      resendRequired: true,
    })

    expect(mockPrisma.phoneVerification.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'pv_lock',
        usedAt: null,
        attempts: 4,
      },
      data: {
        attempts: { increment: 1 },
        usedAt: expect.any(Date),
      },
    })

    expect(mockPrisma.$transaction).not.toHaveBeenCalled()
    expect(mockCreateActiveToken).not.toHaveBeenCalled()
    expect(mockCreateVerificationToken).not.toHaveBeenCalled()
    expect(mockLogAuthEvent).not.toHaveBeenCalled()
    expect(mockCaptureAuthException).not.toHaveBeenCalled()
  })

  it('marks the phone verified and returns partial verification state when email is still unverified', async () => {
    const user = makeUser({
      role: Role.CLIENT,
      emailVerifiedAt: null,
    })

    mockRequireUser.mockResolvedValue({
      ok: true,
      user,
    })

    mockPrisma.phoneVerification.findFirst.mockResolvedValue({
      id: 'pv_1',
      codeHash: 'stored_hash',
      attempts: 0,
    })
    mockTimingSafeEqualHex.mockReturnValue(true)

    const tx = {
      phoneVerification: {
        update: vi.fn().mockResolvedValue({}),
      },
      user: {
        update: vi.fn().mockResolvedValue({}),
      },
      clientProfile: {
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      professionalProfile: {
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
      },
    }

    mockPrisma.$transaction.mockImplementation(
      async (fn: (txArg: typeof tx) => Promise<void>) => {
        return fn(tx)
      },
    )

    const result = await POST(makeRequest({ code: '123456' }))
    const body = await result.json()

    expect(result.status).toBe(200)
    expect(body).toEqual({
      ok: true,
      isPhoneVerified: true,
      isEmailVerified: false,
      isFullyVerified: false,
      requiresEmailVerification: true,
    })

    expect(mockEnforceVerificationVerifyThrottle).toHaveBeenCalledWith({
      request: expect.any(Request),
      scope: 'phone-verify',
      subjectKey: 'user_1',
    })

    expect(mockPrisma.phoneVerification.findFirst).toHaveBeenCalledWith({
      where: expect.objectContaining({
        userId: 'user_1',
        phone: '+15551234567',
        usedAt: null,
        expiresAt: expect.objectContaining({
          gt: expect.any(Date),
        }),
      }),
      select: {
        id: true,
        codeHash: true,
        attempts: true,
      },
      orderBy: { createdAt: 'desc' },
    })

    expect(tx.phoneVerification.update).toHaveBeenCalledWith({
      where: { id: 'pv_1' },
      data: { usedAt: expect.any(Date) },
    })

    expect(tx.user.update).toHaveBeenCalledWith({
      where: { id: 'user_1' },
      data: { phoneVerifiedAt: expect.any(Date) },
    })

    expect(tx.clientProfile.updateMany).toHaveBeenCalledWith({
      where: { userId: 'user_1' },
      data: { phoneVerifiedAt: expect.any(Date) },
    })

    expect(tx.professionalProfile.updateMany).toHaveBeenCalledWith({
      where: { userId: 'user_1' },
      data: { phoneVerifiedAt: expect.any(Date) },
    })

    expect(mockPrisma.phoneVerification.updateMany).not.toHaveBeenCalled()
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
      event: 'auth.phone.verify.success',
      route: 'auth.phone.verify',
      userId: 'user_1',
      phone: '+15551234567',
      meta: {
        isEmailVerified: false,
        isFullyVerified: false,
      },
    })
    expect(mockCaptureAuthException).not.toHaveBeenCalled()
  })

  it('refreshes the cookie to an ACTIVE session when email is already verified', async () => {
    mockRequireUser.mockResolvedValue({
      ok: true,
      user: makeUser({
        role: Role.PRO,
        emailVerifiedAt: new Date('2026-04-08T10:05:00.000Z'),
      }),
    })

    mockPrisma.phoneVerification.findFirst.mockResolvedValue({
      id: 'pv_2',
      codeHash: 'stored_hash',
      attempts: 0,
    })
    mockTimingSafeEqualHex.mockReturnValue(true)

    const tx = {
      phoneVerification: {
        update: vi.fn().mockResolvedValue({}),
      },
      user: {
        update: vi.fn().mockResolvedValue({}),
      },
      clientProfile: {
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
      },
      professionalProfile: {
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
    }

    mockPrisma.$transaction.mockImplementation(
      async (fn: (txArg: typeof tx) => Promise<void>) => {
        return fn(tx)
      },
    )

    const result = await POST(
      makeRequest(
        { code: '123456' },
        {
          host: 'app.tovis.app',
          'x-forwarded-host': 'app.tovis.app',
          'x-forwarded-proto': 'https',
        },
      ),
    )
    const body = await result.json()

    expect(result.status).toBe(200)
    expect(body).toEqual({
      ok: true,
      isPhoneVerified: true,
      isEmailVerified: true,
      isFullyVerified: true,
      requiresEmailVerification: false,
    })

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
      event: 'auth.phone.verify.success',
      route: 'auth.phone.verify',
      userId: 'user_1',
      phone: '+15551234567',
      meta: {
        isEmailVerified: true,
        isFullyVerified: true,
      },
    })
    expect(mockCaptureAuthException).not.toHaveBeenCalled()
  })

  it('returns 500 and captures the exception when an unexpected error occurs', async () => {
    mockRequireUser.mockResolvedValue({
      ok: true,
      user: makeUser(),
    })

    mockPrisma.phoneVerification.findFirst.mockRejectedValue(
      new Error('database blew up'),
    )

    const result = await POST(makeRequest({ code: '123456' }))
    const body = await result.json()

    expect(result.status).toBe(500)
    expect(body).toEqual({
      ok: false,
      error: 'Internal server error',
      code: 'INTERNAL',
    })

    expect(mockCaptureAuthException).toHaveBeenCalledWith({
      event: 'auth.phone.verify.failed',
      route: 'auth.phone.verify',
      userId: 'user_1',
      phone: '+15551234567',
      code: 'INTERNAL',
      error: expect.any(Error),
    })
  })
})