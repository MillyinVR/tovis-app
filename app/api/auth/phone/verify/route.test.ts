// app/api/auth/phone/verify/route.test.ts

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Role } from '@prisma/client'

const mockRequireUser = vi.hoisted(() => vi.fn())
const mockCreateActiveToken = vi.hoisted(() => vi.fn())
const mockCreateVerificationToken = vi.hoisted(() => vi.fn())
const mockEnforceVerificationVerifyThrottle = vi.hoisted(() => vi.fn())
const mockCheckTwilioVerifyPhoneCode = vi.hoisted(() => vi.fn())
const mockLogAuthEvent = vi.hoisted(() => vi.fn())
const mockCaptureAuthException = vi.hoisted(() => vi.fn())

const mockTxUserUpdate = vi.hoisted(() => vi.fn())
const mockTxClientProfileUpdateMany = vi.hoisted(() => vi.fn())
const mockTxProfessionalProfileUpdateMany = vi.hoisted(() => vi.fn())

const mockPrismaTransaction = vi.hoisted(() => vi.fn())

const mockPrisma = vi.hoisted(() => ({
  $transaction: mockPrismaTransaction,
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

vi.mock('@/lib/twilio/verify', () => ({
  checkTwilioVerifyPhoneCode: mockCheckTwilioVerifyPhoneCode,
}))

vi.mock('@/lib/prisma', () => ({
  prisma: mockPrisma,
}))

vi.mock('@/lib/observability/authEvents', () => ({
  logAuthEvent: mockLogAuthEvent,
  captureAuthException: mockCaptureAuthException,
}))

import { POST } from './route'

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

function arrangeTransaction() {
  const tx = {
    user: {
      update: mockTxUserUpdate,
    },
    clientProfile: {
      updateMany: mockTxClientProfileUpdateMany,
    },
    professionalProfile: {
      updateMany: mockTxProfessionalProfileUpdateMany,
    },
  }

  mockPrismaTransaction.mockImplementation(
    async (
      run: (transactionClient: typeof tx) => Promise<unknown>,
    ): Promise<unknown> => run(tx),
  )
}

describe('app/api/auth/phone/verify/route', () => {
  beforeEach(() => {
    mockRequireUser.mockReset()
    mockCreateActiveToken.mockReset()
    mockCreateVerificationToken.mockReset()
    mockEnforceVerificationVerifyThrottle.mockReset()
    mockCheckTwilioVerifyPhoneCode.mockReset()
    mockLogAuthEvent.mockReset()
    mockCaptureAuthException.mockReset()

    mockPrismaTransaction.mockReset()
    mockTxUserUpdate.mockReset()
    mockTxClientProfileUpdateMany.mockReset()
    mockTxProfessionalProfileUpdateMany.mockReset()

    arrangeTransaction()

    mockCreateActiveToken.mockReturnValue('active_token')
    mockCreateVerificationToken.mockReturnValue('verification_token')
    mockEnforceVerificationVerifyThrottle.mockResolvedValue(null)

    mockCheckTwilioVerifyPhoneCode.mockResolvedValue({
      ok: true,
      approved: true,
      sid: 'VE123456789',
      status: 'approved',
    })

    mockTxUserUpdate.mockResolvedValue({
      id: 'user_1',
      phoneVerifiedAt: new Date('2026-04-08T10:00:00.000Z'),
    })
    mockTxClientProfileUpdateMany.mockResolvedValue({ count: 1 })
    mockTxProfessionalProfileUpdateMany.mockResolvedValue({ count: 0 })
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
    expect(mockCheckTwilioVerifyPhoneCode).not.toHaveBeenCalled()
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

    expect(mockCheckTwilioVerifyPhoneCode).not.toHaveBeenCalled()
    expect(mockLogAuthEvent).not.toHaveBeenCalled()
    expect(mockCaptureAuthException).not.toHaveBeenCalled()

    expect(mockEnforceVerificationVerifyThrottle).not.toHaveBeenCalled()
    expect(mockCheckTwilioVerifyPhoneCode).not.toHaveBeenCalled()
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

    expect(mockCheckTwilioVerifyPhoneCode).not.toHaveBeenCalled()
    expect(mockLogAuthEvent).not.toHaveBeenCalled()
    expect(mockCaptureAuthException).not.toHaveBeenCalled()

    expect(mockEnforceVerificationVerifyThrottle).not.toHaveBeenCalled()
    expect(mockCheckTwilioVerifyPhoneCode).not.toHaveBeenCalled()
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
      requiresEmailVerification: true,
    })

    expect(mockEnforceVerificationVerifyThrottle).not.toHaveBeenCalled()
    expect(mockCheckTwilioVerifyPhoneCode).not.toHaveBeenCalled()
    expect(mockPrismaTransaction).not.toHaveBeenCalled()
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
    expect(mockCheckTwilioVerifyPhoneCode).not.toHaveBeenCalled()
    expect(mockPrismaTransaction).not.toHaveBeenCalled()
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
    expect(mockCheckTwilioVerifyPhoneCode).not.toHaveBeenCalled()
    expect(mockPrismaTransaction).not.toHaveBeenCalled()
    expect(mockCreateActiveToken).not.toHaveBeenCalled()
    expect(mockCreateVerificationToken).not.toHaveBeenCalled()
    expect(mockLogAuthEvent).not.toHaveBeenCalled()
    expect(mockCaptureAuthException).not.toHaveBeenCalled()
  })

  it('returns 503 when Twilio Verify is not configured', async () => {
    mockRequireUser.mockResolvedValue({
      ok: true,
      user: makeUser(),
    })

    mockCheckTwilioVerifyPhoneCode.mockResolvedValue({
      ok: false,
      code: 'TWILIO_VERIFY_NOT_CONFIGURED',
      message:
        'Missing TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, or TWILIO_VERIFY_SERVICE_SID.',
    })

    const result = await POST(makeRequest({ code: '123456' }))
    const body = await result.json()

    expect(result.status).toBe(503)
    expect(body).toEqual({
      ok: false,
      error: 'Phone verification is unavailable.',
      code: 'TWILIO_VERIFY_NOT_CONFIGURED',
    })

    expect(mockCheckTwilioVerifyPhoneCode).toHaveBeenCalledWith({
      to: '+15551234567',
      code: '123456',
    })

    expect(mockLogAuthEvent).toHaveBeenCalledWith({
      level: 'error',
      event: 'auth.phone.verify.twilio_check_failed',
      route: 'auth.phone.verify',
      provider: 'twilio_verify',
      code: 'TWILIO_VERIFY_NOT_CONFIGURED',
      userId: 'user_1',
      phone: '+15551234567',
      meta: {
        message:
          'Missing TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, or TWILIO_VERIFY_SERVICE_SID.',
      },
    })

    expect(mockPrismaTransaction).not.toHaveBeenCalled()
    expect(mockCreateActiveToken).not.toHaveBeenCalled()
    expect(mockCreateVerificationToken).not.toHaveBeenCalled()
    expect(mockCaptureAuthException).not.toHaveBeenCalled()
  })

  it('returns 502 when Twilio Verify check fails', async () => {
    mockRequireUser.mockResolvedValue({
      ok: true,
      user: makeUser(),
    })

    mockCheckTwilioVerifyPhoneCode.mockResolvedValue({
      ok: false,
      code: 'TWILIO_VERIFY_CHECK_FAILED',
      message: 'Twilio Verify failed.',
    })

    const result = await POST(makeRequest({ code: '123456' }))
    const body = await result.json()

    expect(result.status).toBe(502)
    expect(body).toEqual({
      ok: false,
      error: 'Phone verification is unavailable.',
      code: 'TWILIO_VERIFY_CHECK_FAILED',
    })

    expect(mockCheckTwilioVerifyPhoneCode).toHaveBeenCalledWith({
      to: '+15551234567',
      code: '123456',
    })

    expect(mockLogAuthEvent).toHaveBeenCalledWith({
      level: 'warn',
      event: 'auth.phone.verify.twilio_check_failed',
      route: 'auth.phone.verify',
      provider: 'twilio_verify',
      code: 'TWILIO_VERIFY_CHECK_FAILED',
      userId: 'user_1',
      phone: '+15551234567',
      meta: {
        message: 'Twilio Verify failed.',
      },
    })

    expect(mockPrismaTransaction).not.toHaveBeenCalled()
    expect(mockCreateActiveToken).not.toHaveBeenCalled()
    expect(mockCreateVerificationToken).not.toHaveBeenCalled()
    expect(mockCaptureAuthException).not.toHaveBeenCalled()
  })

  it('returns 400 when Twilio Verify rejects the code', async () => {
    mockRequireUser.mockResolvedValue({
      ok: true,
      user: makeUser(),
    })

    mockCheckTwilioVerifyPhoneCode.mockResolvedValue({
      ok: true,
      approved: false,
      sid: 'VE123456789',
      status: 'pending',
    })

    const result = await POST(makeRequest({ code: '123456' }))
    const body = await result.json()

    expect(result.status).toBe(400)
    expect(body).toEqual({
      ok: false,
      error: 'Incorrect or expired code.',
      code: 'CODE_MISMATCH',
    })

    expect(mockCheckTwilioVerifyPhoneCode).toHaveBeenCalledWith({
      to: '+15551234567',
      code: '123456',
    })

    expect(mockLogAuthEvent).toHaveBeenCalledWith({
      level: 'warn',
      event: 'auth.phone.verify.code_rejected',
      route: 'auth.phone.verify',
      provider: 'twilio_verify',
      userId: 'user_1',
      phone: '+15551234567',
      meta: {
        sid: 'VE123456789',
        status: 'pending',
      },
    })

    expect(mockPrismaTransaction).not.toHaveBeenCalled()
    expect(mockCreateActiveToken).not.toHaveBeenCalled()
    expect(mockCreateVerificationToken).not.toHaveBeenCalled()
    expect(mockCaptureAuthException).not.toHaveBeenCalled()
  })

  it('marks a client phone verified and returns partial verification state when email is still unverified', async () => {
    mockRequireUser.mockResolvedValue({
      ok: true,
      user: makeUser({
        role: Role.CLIENT,
        emailVerifiedAt: null,
      }),
    })

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

    expect(mockCheckTwilioVerifyPhoneCode).toHaveBeenCalledWith({
      to: '+15551234567',
      code: '123456',
    })

    expect(mockTxUserUpdate).toHaveBeenCalledWith({
      where: { id: 'user_1' },
      data: { phoneVerifiedAt: expect.any(Date) },
    })

    expect(mockTxClientProfileUpdateMany).toHaveBeenCalledWith({
      where: { userId: 'user_1' },
      data: { phoneVerifiedAt: expect.any(Date) },
    })

    expect(mockTxProfessionalProfileUpdateMany).not.toHaveBeenCalled()

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
      provider: 'twilio_verify',
      userId: 'user_1',
      phone: '+15551234567',
      meta: {
        sid: 'VE123456789',
        status: 'approved',
        isEmailVerified: false,
        isFullyVerified: false,
      },
    })

    expect(mockCaptureAuthException).not.toHaveBeenCalled()
  })

  it('marks a pro phone verified and refreshes the cookie to an ACTIVE session when email is already verified', async () => {
    mockTxClientProfileUpdateMany.mockResolvedValue({ count: 0 })
    mockTxProfessionalProfileUpdateMany.mockResolvedValue({ count: 1 })

    mockRequireUser.mockResolvedValue({
      ok: true,
      user: makeUser({
        role: Role.PRO,
        emailVerifiedAt: new Date('2026-04-08T10:05:00.000Z'),
      }),
    })

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

    expect(mockTxUserUpdate).toHaveBeenCalledWith({
      where: { id: 'user_1' },
      data: { phoneVerifiedAt: expect.any(Date) },
    })

    expect(mockTxClientProfileUpdateMany).not.toHaveBeenCalled()

    expect(mockTxProfessionalProfileUpdateMany).toHaveBeenCalledWith({
      where: { userId: 'user_1' },
      data: { phoneVerifiedAt: expect.any(Date) },
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
      provider: 'twilio_verify',
      userId: 'user_1',
      phone: '+15551234567',
      meta: {
        sid: 'VE123456789',
        status: 'approved',
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

    mockCheckTwilioVerifyPhoneCode.mockRejectedValue(
      new Error('Twilio SDK exploded'),
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
      provider: 'twilio_verify',
      userId: 'user_1',
      phone: '+15551234567',
      code: 'INTERNAL',
      error: expect.any(Error),
    })
  })
})