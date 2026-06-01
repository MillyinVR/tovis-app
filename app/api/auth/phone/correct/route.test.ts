// app/api/auth/phone/correct/route.test.ts

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Prisma, Role } from '@prisma/client'
import {
  clearContactLookupHmacKeyringCacheForTests,
  CONTACT_LOOKUP_HMAC_KEY_VERSION,
  phoneLookupHashV2,
} from '@/lib/security/crypto/hashLookup'

const mockRequireUser = vi.hoisted(() => vi.fn())
const mockEnforceRateLimit = vi.hoisted(() => vi.fn())
const mockPhoneRateLimitIdentity = vi.hoisted(() => vi.fn())
const mockIsRuntimeFlagEnabled = vi.hoisted(() => vi.fn())
const mockValidateSmsDestinationCountry = vi.hoisted(() => vi.fn())
const mockStartTwilioVerifyPhoneVerification = vi.hoisted(() => vi.fn())

const mockLogAuthEvent = vi.hoisted(() => vi.fn())
const mockCaptureAuthException = vi.hoisted(() => vi.fn())

const mockTxUserUpdate = vi.hoisted(() => vi.fn())
const mockTxClientProfileUpdateMany = vi.hoisted(() => vi.fn())
const mockTxProfessionalProfileUpdateMany = vi.hoisted(() => vi.fn())

const mockPrismaTransaction = vi.hoisted(() => vi.fn())
const TEST_HMAC_KEY = Buffer.alloc(32, 7).toString('base64')

const mockPrisma = vi.hoisted(() => ({
  $transaction: mockPrismaTransaction,
}))

vi.mock('@/app/api/_utils/auth/requireUser', () => ({
  requireUser: mockRequireUser,
}))

vi.mock('@/app/api/_utils', async () => {
  const actual = await vi.importActual<typeof import('@/app/api/_utils')>(
    '@/app/api/_utils',
  )

  return {
    ...actual,
    enforceRateLimit: mockEnforceRateLimit,
    phoneRateLimitIdentity: mockPhoneRateLimitIdentity,
  }
})

vi.mock('@/lib/runtimeFlags', () => ({
  isRuntimeFlagEnabled: mockIsRuntimeFlagEnabled,
}))

vi.mock('@/lib/smsCountryPolicy', () => ({
  validateSmsDestinationCountry: mockValidateSmsDestinationCountry,
}))

vi.mock('@/lib/twilio/verify', () => ({
  startTwilioVerifyPhoneVerification: mockStartTwilioVerifyPhoneVerification,
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
  sessionKind?: 'ACTIVE' | 'VERIFICATION'
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
    sessionKind: args?.sessionKind ?? 'VERIFICATION',
    phoneVerifiedAt,
    emailVerifiedAt,
    authVersion: 1,
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

function makeRequest(phone?: unknown) {
  return new Request('http://localhost/api/auth/phone/correct', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(
      phone === undefined
        ? {}
        : {
            phone,
          },
    ),
  })
}

function makeUniqueConstraintError(): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError(
    'Unique constraint failed on the fields: (`phone`)',
    {
      code: 'P2002',
      clientVersion: 'test',
    },
  )
}

function expectedPhoneLookupData(phone: string | null) {
  const phoneHashV2 = phoneLookupHashV2(phone)

  return {
    phoneHashV2: phoneHashV2?.hash ?? null,
    phoneHashKeyVersion: phoneHashV2?.keyVersion ?? null,
  }
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

describe('app/api/auth/phone/correct/route', () => {
  beforeEach(() => {
    mockRequireUser.mockReset()
    mockEnforceRateLimit.mockReset()
    mockPhoneRateLimitIdentity.mockReset()
    mockIsRuntimeFlagEnabled.mockReset()
    mockValidateSmsDestinationCountry.mockReset()
    mockStartTwilioVerifyPhoneVerification.mockReset()
    mockLogAuthEvent.mockReset()
    mockCaptureAuthException.mockReset()
    mockTxUserUpdate.mockReset()
    mockTxClientProfileUpdateMany.mockReset()
    mockTxProfessionalProfileUpdateMany.mockReset()
    mockPrismaTransaction.mockReset()

    process.env.PII_LOOKUP_HMAC_KEYS_JSON = JSON.stringify({
      [CONTACT_LOOKUP_HMAC_KEY_VERSION]: TEST_HMAC_KEY,
    })
    clearContactLookupHmacKeyringCacheForTests()

    arrangeTransaction()

    mockIsRuntimeFlagEnabled.mockResolvedValue(false)
    mockPhoneRateLimitIdentity.mockImplementation((phone: string) => ({
      kind: 'phone',
      id: phone,
    }))
    mockEnforceRateLimit.mockResolvedValue(null)
    mockValidateSmsDestinationCountry.mockReturnValue({
      ok: true,
      phone: '+15557654321',
      countryCode: 'US',
    })

    mockTxUserUpdate.mockResolvedValue({
      id: 'user_1',
      phone: '+15557654321',
      phoneVerifiedAt: null,
    })
    mockTxClientProfileUpdateMany.mockResolvedValue({ count: 1 })
    mockTxProfessionalProfileUpdateMany.mockResolvedValue({ count: 0 })

    mockStartTwilioVerifyPhoneVerification.mockResolvedValue({
      ok: true,
      sid: 'VE123456789',
      status: 'pending',
    })
  })

  afterEach(() => {
    clearContactLookupHmacKeyringCacheForTests()
    vi.restoreAllMocks()
  })

  it('passes through a failed auth result unchanged', async () => {
    const res = new Response(null, { status: 401 })

    mockRequireUser.mockResolvedValue({
      ok: false,
      res,
    })

    const result = await POST(makeRequest('+15557654321'))

    expect(mockRequireUser).toHaveBeenCalledWith({
      allowVerificationSession: true,
    })
    expect(result).toBe(res)
    expect(result.status).toBe(401)
    expect(mockCaptureAuthException).not.toHaveBeenCalled()
  })

  it('returns alreadyVerified when the phone is already verified', async () => {
    mockRequireUser.mockResolvedValue({
      ok: true,
      user: makeUser({
        phoneVerifiedAt: new Date('2026-04-08T10:00:00.000Z'),
      }),
    })

    const result = await POST(makeRequest('+15557654321'))
    const body = await result.json()

    expect(result.status).toBe(200)
    expect(body).toEqual({
      ok: true,
      alreadyVerified: true,
      sent: false,
      isPhoneVerified: true,
      isEmailVerified: false,
      isFullyVerified: false,
      requiresEmailVerification: true,
    })

    expect(mockIsRuntimeFlagEnabled).not.toHaveBeenCalled()
    expect(mockValidateSmsDestinationCountry).not.toHaveBeenCalled()
    expect(mockPrismaTransaction).not.toHaveBeenCalled()
    expect(mockStartTwilioVerifyPhoneVerification).not.toHaveBeenCalled()
    expect(mockCaptureAuthException).not.toHaveBeenCalled()
  })

  it('returns 400 when the phone number is missing', async () => {
    mockRequireUser.mockResolvedValue({
      ok: true,
      user: makeUser(),
    })

    const result = await POST(makeRequest('   '))
    const body = await result.json()

    expect(result.status).toBe(400)
    expect(body).toEqual({
      ok: false,
      error: 'Phone number missing.',
      code: 'PHONE_REQUIRED',
    })

    expect(mockIsRuntimeFlagEnabled).not.toHaveBeenCalled()
    expect(mockValidateSmsDestinationCountry).not.toHaveBeenCalled()
    expect(mockPrismaTransaction).not.toHaveBeenCalled()
    expect(mockStartTwilioVerifyPhoneVerification).not.toHaveBeenCalled()
    expect(mockCaptureAuthException).not.toHaveBeenCalled()
  })

  it('returns 503 when SMS is disabled', async () => {
    mockRequireUser.mockResolvedValue({
      ok: true,
      user: makeUser(),
    })
    mockIsRuntimeFlagEnabled.mockImplementation(async (name: string) => {
      return name === 'sms_disabled'
    })

    const result = await POST(makeRequest('+15557654321'))
    const body = await result.json()

    expect(result.status).toBe(503)
    expect(body).toEqual({
      ok: false,
      error: 'SMS verification is temporarily unavailable.',
      code: 'SMS_DISABLED',
    })

    expect(mockIsRuntimeFlagEnabled).toHaveBeenCalledWith('sms_disabled')
    expect(mockValidateSmsDestinationCountry).not.toHaveBeenCalled()
    expect(mockEnforceRateLimit).not.toHaveBeenCalled()
    expect(mockPrismaTransaction).not.toHaveBeenCalled()
    expect(mockStartTwilioVerifyPhoneVerification).not.toHaveBeenCalled()
    expect(mockCaptureAuthException).not.toHaveBeenCalled()
  })

  it('returns 400 when the phone format is invalid', async () => {
    mockRequireUser.mockResolvedValue({
      ok: true,
      user: makeUser(),
    })
    mockValidateSmsDestinationCountry.mockReturnValue({
      ok: false,
      code: 'INVALID_PHONE_FORMAT',
      message: 'Enter a valid phone number.',
      countryCode: null,
    })

    const result = await POST(makeRequest('not-a-phone'))
    const body = await result.json()

    expect(result.status).toBe(400)
    expect(body).toEqual({
      ok: false,
      error: 'Enter a valid phone number.',
      code: 'INVALID_PHONE_FORMAT',
      countryCode: null,
    })

    expect(mockIsRuntimeFlagEnabled).toHaveBeenCalledWith('sms_disabled')
    expect(mockValidateSmsDestinationCountry).toHaveBeenCalledWith(
      'not-a-phone',
    )
    expect(mockEnforceRateLimit).not.toHaveBeenCalled()
    expect(mockPrismaTransaction).not.toHaveBeenCalled()
    expect(mockStartTwilioVerifyPhoneVerification).not.toHaveBeenCalled()
    expect(mockCaptureAuthException).not.toHaveBeenCalled()
  })

  it('returns 400 when the SMS destination country is unsupported', async () => {
    mockRequireUser.mockResolvedValue({
      ok: true,
      user: makeUser(),
    })
    mockValidateSmsDestinationCountry.mockReturnValue({
      ok: false,
      code: 'SMS_COUNTRY_UNSUPPORTED',
      message: 'SMS verification is not available for this country yet.',
      countryCode: 'GB',
    })

    const result = await POST(makeRequest('+442079460123'))
    const body = await result.json()

    expect(result.status).toBe(400)
    expect(body).toEqual({
      ok: false,
      error: 'SMS verification is not available for this country yet.',
      code: 'SMS_COUNTRY_UNSUPPORTED',
      countryCode: 'GB',
    })

    expect(mockIsRuntimeFlagEnabled).toHaveBeenCalledWith('sms_disabled')
    expect(mockValidateSmsDestinationCountry).toHaveBeenCalledWith(
      '+442079460123',
    )
    expect(mockEnforceRateLimit).not.toHaveBeenCalled()
    expect(mockPrismaTransaction).not.toHaveBeenCalled()
    expect(mockStartTwilioVerifyPhoneVerification).not.toHaveBeenCalled()
    expect(mockCaptureAuthException).not.toHaveBeenCalled()
  })

  it('returns the shared per-phone quota response unchanged when SMS quota blocks correction', async () => {
    mockRequireUser.mockResolvedValue({
      ok: true,
      user: makeUser(),
    })

    const quotaRes = new Response(null, { status: 429 })
    mockEnforceRateLimit
      .mockResolvedValueOnce(quotaRes)
      .mockResolvedValueOnce(null)

    const result = await POST(makeRequest('+15557654321'))

    expect(mockIsRuntimeFlagEnabled).toHaveBeenCalledWith('sms_disabled')
    expect(mockValidateSmsDestinationCountry).toHaveBeenCalledWith(
      '+15557654321',
    )
    expect(mockPhoneRateLimitIdentity).toHaveBeenCalledWith('+15557654321')
    expect(mockEnforceRateLimit).toHaveBeenNthCalledWith(1, {
      bucket: 'auth:sms-phone-hour',
      identity: { kind: 'phone', id: '+15557654321' },
    })

    expect(result).toBe(quotaRes)
    expect(result.status).toBe(429)
    expect(mockPrismaTransaction).not.toHaveBeenCalled()
    expect(mockStartTwilioVerifyPhoneVerification).not.toHaveBeenCalled()
    expect(mockCaptureAuthException).not.toHaveBeenCalled()
  })

  it('returns a generic 400 and logs internally when the corrected phone number hits a duplicate constraint', async () => {
    mockRequireUser.mockResolvedValue({
      ok: true,
      user: makeUser(),
    })
    mockTxUserUpdate.mockRejectedValue(makeUniqueConstraintError())

    const result = await POST(makeRequest('+15557654321'))
    const body = await result.json()

    expect(result.status).toBe(400)
    expect(body).toEqual({
      ok: false,
      error:
        "We couldn't update to that phone number. Please try a different number.",
      code: 'PHONE_UPDATE_FAILED',
    })

    expect(JSON.stringify(body)).not.toContain('PHONE_IN_USE')
    expect(JSON.stringify(body)).not.toContain('already in use')

    expect(mockPrismaTransaction).toHaveBeenCalledTimes(1)

    expect(mockTxUserUpdate).toHaveBeenCalledWith({
      where: { id: 'user_1' },
      data: {
        phone: '+15557654321',
        ...expectedPhoneLookupData('+15557654321'),
        phoneVerifiedAt: null,
      },
    })

    expect(mockLogAuthEvent).toHaveBeenCalledWith({
      level: 'warn',
      event: 'auth.phone.correct.duplicate',
      route: 'auth.phone.correct',
      code: 'PHONE_UPDATE_FAILED',
      userId: 'user_1',
      phone: '+15557654321',
      meta: {
        prismaCode: 'P2002',
      },
    })

    expect(mockStartTwilioVerifyPhoneVerification).not.toHaveBeenCalled()
    expect(mockCaptureAuthException).not.toHaveBeenCalled()
  })

  it('updates a client user/profile phone and starts Twilio Verify when allowed', async () => {
    mockRequireUser.mockResolvedValue({
      ok: true,
      user: makeUser({
        role: Role.CLIENT,
        emailVerifiedAt: new Date('2026-04-08T10:05:00.000Z'),
      }),
    })

    const result = await POST(makeRequest(' +1 (555) 765-4321 '))
    const body = await result.json()

    expect(result.status).toBe(200)
    expect(body).toEqual({
      ok: true,
      sent: true,
      phone: '+15557654321',
      isPhoneVerified: false,
      isEmailVerified: true,
      isFullyVerified: false,
      requiresEmailVerification: false,
    })

    expect(mockValidateSmsDestinationCountry).toHaveBeenCalledWith(
      '+1 (555) 765-4321',
    )
    expect(mockPhoneRateLimitIdentity).toHaveBeenCalledWith('+15557654321')

    expect(mockTxUserUpdate).toHaveBeenCalledWith({
      where: { id: 'user_1' },
      data: {
        phone: '+15557654321',
        ...expectedPhoneLookupData('+15557654321'),
        phoneVerifiedAt: null,
      },
    })

    expect(mockTxClientProfileUpdateMany).toHaveBeenCalledWith({
      where: { userId: 'user_1' },
      data: {
        phone: '+15557654321',
        ...expectedPhoneLookupData('+15557654321'),
        phoneVerifiedAt: null,
      },
    })

    expect(mockTxProfessionalProfileUpdateMany).not.toHaveBeenCalled()

    expect(mockStartTwilioVerifyPhoneVerification).toHaveBeenCalledWith({
      to: '+15557654321',
    })

    expect(
      mockPrismaTransaction.mock.invocationCallOrder[0],
    ).toBeLessThan(
      mockStartTwilioVerifyPhoneVerification.mock.invocationCallOrder[0],
    )

    expect(mockLogAuthEvent).toHaveBeenCalledWith({
      level: 'info',
      event: 'auth.phone.correct.success',
      route: 'auth.phone.correct',
      provider: 'twilio_verify',
      userId: 'user_1',
      phone: '+15557654321',
      meta: {
        sid: 'VE123456789',
        status: 'pending',
      },
    })

    expect(mockCaptureAuthException).not.toHaveBeenCalled()
  })

  it('updates a pro user/profile phone and starts Twilio Verify when allowed', async () => {
    mockTxClientProfileUpdateMany.mockResolvedValue({ count: 0 })
    mockTxProfessionalProfileUpdateMany.mockResolvedValue({ count: 1 })

    mockRequireUser.mockResolvedValue({
      ok: true,
      user: makeUser({
        role: Role.PRO,
        emailVerifiedAt: new Date('2026-04-08T10:05:00.000Z'),
      }),
    })

    const result = await POST(makeRequest(' +1 (555) 765-4321 '))
    const body = await result.json()

    expect(result.status).toBe(200)
    expect(body).toEqual({
      ok: true,
      sent: true,
      phone: '+15557654321',
      isPhoneVerified: false,
      isEmailVerified: true,
      isFullyVerified: false,
      requiresEmailVerification: false,
    })

    expect(mockTxUserUpdate).toHaveBeenCalledWith({
      where: { id: 'user_1' },
      data: {
        phone: '+15557654321',
        ...expectedPhoneLookupData('+15557654321'),
        phoneVerifiedAt: null,
      },
    })

    expect(mockTxClientProfileUpdateMany).not.toHaveBeenCalled()

    expect(mockTxProfessionalProfileUpdateMany).toHaveBeenCalledWith({
      where: { userId: 'user_1' },
      data: {
        phone: '+15557654321',
        phoneVerifiedAt: null,
      },
    })

    expect(mockStartTwilioVerifyPhoneVerification).toHaveBeenCalledWith({
      to: '+15557654321',
    })

    expect(mockCaptureAuthException).not.toHaveBeenCalled()
  })

  it('returns 503 when Twilio Verify is not configured after updating the phone', async () => {
    mockRequireUser.mockResolvedValue({
      ok: true,
      user: makeUser(),
    })

    mockStartTwilioVerifyPhoneVerification.mockResolvedValue({
      ok: false,
      code: 'TWILIO_VERIFY_NOT_CONFIGURED',
      message:
        'Missing TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, or TWILIO_VERIFY_SERVICE_SID.',
    })

    const result = await POST(makeRequest('+15557654321'))
    const body = await result.json()

    expect(result.status).toBe(503)
    expect(body).toEqual({
      ok: false,
      error:
        'Phone number was updated, but we could not send a verification code. Please try resending the code.',
      code: 'TWILIO_VERIFY_NOT_CONFIGURED',
      phone: '+15557654321',
      sent: false,
      isPhoneVerified: false,
    })

    expect(mockTxUserUpdate).toHaveBeenCalled()
    expect(mockStartTwilioVerifyPhoneVerification).toHaveBeenCalledWith({
      to: '+15557654321',
    })

    expect(mockLogAuthEvent).toHaveBeenCalledWith({
      level: 'error',
      event: 'auth.phone.correct.verify_start_failed',
      route: 'auth.phone.correct',
      provider: 'twilio_verify',
      code: 'TWILIO_VERIFY_NOT_CONFIGURED',
      userId: 'user_1',
      phone: '+15557654321',
      meta: {
        message:
          'Missing TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, or TWILIO_VERIFY_SERVICE_SID.',
      },
    })

    expect(mockCaptureAuthException).not.toHaveBeenCalled()
  })

  it('returns 502 when Twilio Verify fails after updating the phone', async () => {
    mockRequireUser.mockResolvedValue({
      ok: true,
      user: makeUser(),
    })

    mockStartTwilioVerifyPhoneVerification.mockResolvedValue({
      ok: false,
      code: 'TWILIO_VERIFY_SEND_FAILED',
      message: 'Twilio Verify failed.',
    })

    const result = await POST(makeRequest('+15557654321'))
    const body = await result.json()

    expect(result.status).toBe(502)
    expect(body).toEqual({
      ok: false,
      error:
        'Phone number was updated, but we could not send a verification code. Please try resending the code.',
      code: 'TWILIO_VERIFY_SEND_FAILED',
      phone: '+15557654321',
      sent: false,
      isPhoneVerified: false,
    })

    expect(mockTxUserUpdate).toHaveBeenCalled()
    expect(mockStartTwilioVerifyPhoneVerification).toHaveBeenCalledWith({
      to: '+15557654321',
    })

    expect(mockLogAuthEvent).toHaveBeenCalledWith({
      level: 'warn',
      event: 'auth.phone.correct.verify_start_failed',
      route: 'auth.phone.correct',
      provider: 'twilio_verify',
      code: 'TWILIO_VERIFY_SEND_FAILED',
      userId: 'user_1',
      phone: '+15557654321',
      meta: {
        message: 'Twilio Verify failed.',
      },
    })

    expect(mockCaptureAuthException).not.toHaveBeenCalled()
  })

  it('writes v2 phone lookup hash when correcting a client phone', async () => {
    mockRequireUser.mockResolvedValue({
      ok: true,
      user: makeUser({
        role: Role.CLIENT,
        emailVerifiedAt: new Date('2026-04-08T10:05:00.000Z'),
      }),
    })

    const result = await POST(makeRequest(' +1 (555) 765-4321 '))

    expect(result.status).toBe(200)

    expect(mockTxUserUpdate).toHaveBeenCalledWith({
      where: { id: 'user_1' },
      data: {
        phone: '+15557654321',
        ...expectedPhoneLookupData('+15557654321'),
        phoneVerifiedAt: null,
      },
    })

    expect(mockTxClientProfileUpdateMany).toHaveBeenCalledWith({
      where: { userId: 'user_1' },
      data: {
        phone: '+15557654321',
        ...expectedPhoneLookupData('+15557654321'),
        phoneVerifiedAt: null,
      },
    })
  })

  it('returns 500 for unexpected internal failures', async () => {
    mockRequireUser.mockResolvedValue({
      ok: true,
      user: makeUser(),
    })

    mockPrismaTransaction.mockRejectedValue(new Error('Unexpected failure'))

    const result = await POST(makeRequest('+15557654321'))
    const body = await result.json()

    expect(result.status).toBe(500)
    expect(body).toEqual({
      ok: false,
      error: 'Internal server error',
      code: 'INTERNAL',
    })

    expect(mockCaptureAuthException).toHaveBeenCalledWith({
      event: 'auth.phone.correct.internal_error',
      route: 'auth.phone.correct',
      provider: 'twilio_verify',
      code: 'INTERNAL',
      userId: 'user_1',
      phone: '+15557654321',
      error: expect.any(Error),
    })
  })
})