import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Role } from '@prisma/client'

const mockRequireUser = vi.hoisted(() => vi.fn())
const mockSafeJson = vi.hoisted(() => vi.fn())
const mockFetch = vi.hoisted(() => vi.fn())

const mockEnforceRateLimit = vi.hoisted(() => vi.fn())
const mockPhoneRateLimitIdentity = vi.hoisted(() => vi.fn())
const mockIsRuntimeFlagEnabled = vi.hoisted(() => vi.fn())
const mockValidateSmsDestinationCountry = vi.hoisted(() => vi.fn())

const mockPrisma = vi.hoisted(() => ({
  phoneVerification: {
    findFirst: vi.fn(),
    count: vi.fn(),
  },
  $transaction: vi.fn(),
}))

const ORIGINAL_ENV = { ...process.env }

vi.mock('@/app/api/_utils/auth/requireUser', () => ({
  requireUser: mockRequireUser,
}))

vi.mock('@/lib/http', () => ({
  safeJson: mockSafeJson,
}))

vi.mock('@/lib/prisma', () => ({
  prisma: mockPrisma,
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

function makeRequest() {
  return new Request('http://localhost/api/auth/phone/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  })
}

function makeTx() {
  return {
    phoneVerification: {
      updateMany: vi.fn().mockResolvedValue({ count: 2 }),
      create: vi.fn().mockResolvedValue({ id: 'pv_new' }),
    },
  }
}

describe('app/api/auth/phone/send/route', () => {
  beforeEach(() => {
    process.env = { ...ORIGINAL_ENV }

    resetMockGroup(mockPrisma.phoneVerification)
    mockPrisma.$transaction.mockReset()

    mockRequireUser.mockReset()
    mockSafeJson.mockReset()
    mockFetch.mockReset()

    mockEnforceRateLimit.mockReset()
    mockPhoneRateLimitIdentity.mockReset()
    mockIsRuntimeFlagEnabled.mockReset()
    mockValidateSmsDestinationCountry.mockReset()

    vi.stubGlobal('fetch', mockFetch)

    mockIsRuntimeFlagEnabled.mockResolvedValue(false)
    mockPhoneRateLimitIdentity.mockReturnValue({
      kind: 'phone',
      id: '+15551234567',
    })
    mockEnforceRateLimit.mockResolvedValue(null)
    mockValidateSmsDestinationCountry.mockReturnValue({
      ok: true,
      phone: '+15551234567',
      countryCode: 'US',
    })

    process.env.TWILIO_ACCOUNT_SID = 'AC_test_sid'
    process.env.TWILIO_AUTH_TOKEN = 'test_auth_token'
    process.env.TWILIO_FROM_NUMBER = '+15550001111'
  })

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV }
    vi.restoreAllMocks()
  })

  it('passes through a failed auth result unchanged', async () => {
    const res = new Response(null, { status: 401 })
    mockRequireUser.mockResolvedValue({
      ok: false,
      res,
    })

    const result = await POST(makeRequest())

    expect(mockRequireUser).toHaveBeenCalledWith({
      allowVerificationSession: true,
    })
    expect(result).toBe(res)
    expect(result.status).toBe(401)
  })

  it('returns alreadyVerified when the phone is already verified', async () => {
    mockRequireUser.mockResolvedValue({
      ok: true,
      user: makeUser({
        phoneVerifiedAt: new Date('2026-04-08T10:00:00.000Z'),
      }),
    })

    const result = await POST(makeRequest())
    const body = await result.json()

    expect(result.status).toBe(200)
    expect(body).toEqual({
      ok: true,
      alreadyVerified: true,
      sent: false,
    })

    expect(mockIsRuntimeFlagEnabled).not.toHaveBeenCalled()
    expect(mockValidateSmsDestinationCountry).not.toHaveBeenCalled()
    expect(mockPrisma.phoneVerification.findFirst).not.toHaveBeenCalled()
    expect(mockFetch).not.toHaveBeenCalled()
    expect(mockPrisma.$transaction).not.toHaveBeenCalled()
  })

  it('returns 400 when the phone number is missing', async () => {
    mockRequireUser.mockResolvedValue({
      ok: true,
      user: makeUser({
        phone: '   ',
      }),
    })

    const result = await POST(makeRequest())
    const body = await result.json()

    expect(result.status).toBe(400)
    expect(body).toEqual({
      ok: false,
      error: 'Phone number missing.',
      code: 'PHONE_REQUIRED',
    })

    expect(mockIsRuntimeFlagEnabled).not.toHaveBeenCalled()
    expect(mockValidateSmsDestinationCountry).not.toHaveBeenCalled()
    expect(mockFetch).not.toHaveBeenCalled()
    expect(mockPrisma.$transaction).not.toHaveBeenCalled()
  })

  it('returns 503 when SMS is disabled', async () => {
    mockRequireUser.mockResolvedValue({
      ok: true,
      user: makeUser(),
    })
    mockIsRuntimeFlagEnabled.mockImplementation(async (name: string) => {
      return name === 'sms_disabled'
    })

    const result = await POST(makeRequest())
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
    expect(mockPrisma.phoneVerification.findFirst).not.toHaveBeenCalled()
    expect(mockPrisma.$transaction).not.toHaveBeenCalled()
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('returns 400 when the SMS destination country is unsupported', async () => {
    mockRequireUser.mockResolvedValue({
      ok: true,
      user: makeUser({
        phone: '+442079460123',
      }),
    })
    mockValidateSmsDestinationCountry.mockReturnValue({
      ok: false,
      code: 'SMS_COUNTRY_UNSUPPORTED',
      message: 'SMS verification is not available for this country yet.',
      countryCode: 'GB',
    })

    const result = await POST(makeRequest())
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
    expect(mockPrisma.phoneVerification.findFirst).not.toHaveBeenCalled()
    expect(mockPrisma.$transaction).not.toHaveBeenCalled()
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('returns the shared per-phone quota response unchanged when SMS quota blocks resend', async () => {
    mockRequireUser.mockResolvedValue({
      ok: true,
      user: makeUser(),
    })

    const quotaRes = new Response(null, { status: 429 })
    mockEnforceRateLimit
      .mockResolvedValueOnce(quotaRes)
      .mockResolvedValueOnce(null)

    const result = await POST(makeRequest())

    expect(mockIsRuntimeFlagEnabled).toHaveBeenCalledWith('sms_disabled')
    expect(mockValidateSmsDestinationCountry).toHaveBeenCalledWith(
      '+15551234567',
    )
    expect(mockPhoneRateLimitIdentity).toHaveBeenCalledWith('+15551234567')
    expect(mockEnforceRateLimit).toHaveBeenNthCalledWith(1, {
      bucket: 'auth:sms-phone-hour',
      identity: { kind: 'phone', id: '+15551234567' },
    })

    expect(result).toBe(quotaRes)
    expect(result.status).toBe(429)
    expect(mockPrisma.phoneVerification.findFirst).not.toHaveBeenCalled()
    expect(mockPrisma.$transaction).not.toHaveBeenCalled()
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('returns 429 and Retry-After when resend is rate limited by cooldown', async () => {
    mockRequireUser.mockResolvedValue({
      ok: true,
      user: makeUser(),
    })

    mockPrisma.phoneVerification.findFirst.mockResolvedValue({
      id: 'pv_recent',
    })

    const result = await POST(makeRequest())
    const body = await result.json()

    expect(result.status).toBe(429)
    expect(result.headers.get('Retry-After')).toBe('60')
    expect(body).toEqual({
      ok: false,
      error: 'Too many requests. Try again shortly.',
      code: 'RATE_LIMITED',
      retryAfterSeconds: 60,
    })

    expect(mockIsRuntimeFlagEnabled).toHaveBeenCalledWith('sms_disabled')
    expect(mockValidateSmsDestinationCountry).toHaveBeenCalledWith(
      '+15551234567',
    )
    expect(mockPhoneRateLimitIdentity).toHaveBeenCalledWith('+15551234567')
    expect(mockEnforceRateLimit).toHaveBeenNthCalledWith(1, {
      bucket: 'auth:sms-phone-hour',
      identity: { kind: 'phone', id: '+15551234567' },
    })
    expect(mockEnforceRateLimit).toHaveBeenNthCalledWith(2, {
      bucket: 'auth:sms-phone-day',
      identity: { kind: 'phone', id: '+15551234567' },
    })

    expect(mockPrisma.phoneVerification.count).not.toHaveBeenCalled()
    expect(mockFetch).not.toHaveBeenCalled()
    expect(mockPrisma.$transaction).not.toHaveBeenCalled()
  })

  it('returns 429 and Retry-After when hourly cap is exceeded', async () => {
    mockRequireUser.mockResolvedValue({
      ok: true,
      user: makeUser(),
    })

    mockPrisma.phoneVerification.findFirst.mockResolvedValue(null)
    mockPrisma.phoneVerification.count.mockResolvedValue(5)

    const result = await POST(makeRequest())
    const body = await result.json()

    expect(result.status).toBe(429)
    expect(result.headers.get('Retry-After')).toBe('600')
    expect(body).toEqual({
      ok: false,
      error: 'Too many requests. Try again shortly.',
      code: 'RATE_LIMITED',
      retryAfterSeconds: 600,
    })

    expect(mockIsRuntimeFlagEnabled).toHaveBeenCalledWith('sms_disabled')
    expect(mockValidateSmsDestinationCountry).toHaveBeenCalledWith(
      '+15551234567',
    )
    expect(mockPhoneRateLimitIdentity).toHaveBeenCalledWith('+15551234567')
    expect(mockEnforceRateLimit).toHaveBeenNthCalledWith(1, {
      bucket: 'auth:sms-phone-hour',
      identity: { kind: 'phone', id: '+15551234567' },
    })
    expect(mockEnforceRateLimit).toHaveBeenNthCalledWith(2, {
      bucket: 'auth:sms-phone-day',
      identity: { kind: 'phone', id: '+15551234567' },
    })

    expect(mockFetch).not.toHaveBeenCalled()
    expect(mockPrisma.$transaction).not.toHaveBeenCalled()
  })

  it('rotates old codes and stores the new code before attempting Twilio SMS', async () => {
    mockRequireUser.mockResolvedValue({
      ok: true,
      user: makeUser({
        role: Role.CLIENT,
        phone: '+15551234567',
      }),
    })

    mockPrisma.phoneVerification.findFirst.mockResolvedValue(null)
    mockPrisma.phoneVerification.count.mockResolvedValue(0)

    const tx = makeTx()

    mockPrisma.$transaction.mockImplementation(
      async (fn: (txArg: typeof tx) => Promise<unknown>) => fn(tx),
    )

    mockFetch.mockResolvedValue(
      new Response('', {
        status: 201,
      }),
    )
    mockSafeJson.mockResolvedValue({
      sid: 'SM123456789',
    })

    const result = await POST(makeRequest())
    const body = await result.json()

    expect(result.status).toBe(200)
    expect(body).toEqual({
      ok: true,
      sent: true,
    })

    expect(mockIsRuntimeFlagEnabled).toHaveBeenCalledWith('sms_disabled')
    expect(mockValidateSmsDestinationCountry).toHaveBeenCalledWith(
      '+15551234567',
    )
    expect(mockPhoneRateLimitIdentity).toHaveBeenCalledWith('+15551234567')
    expect(mockEnforceRateLimit).toHaveBeenNthCalledWith(1, {
      bucket: 'auth:sms-phone-hour',
      identity: { kind: 'phone', id: '+15551234567' },
    })
    expect(mockEnforceRateLimit).toHaveBeenNthCalledWith(2, {
      bucket: 'auth:sms-phone-day',
      identity: { kind: 'phone', id: '+15551234567' },
    })

    expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1)
    expect(tx.phoneVerification.updateMany).toHaveBeenCalledWith({
      where: {
        userId: 'user_1',
        usedAt: null,
      },
      data: {
        usedAt: expect.any(Date),
      },
    })

    expect(tx.phoneVerification.create).toHaveBeenCalledWith({
      data: {
        userId: 'user_1',
        phone: '+15551234567',
        codeHash: expect.any(String),
        expiresAt: expect.any(Date),
      },
    })

    expect(mockFetch).toHaveBeenCalledTimes(1)
    expect(mockFetch).toHaveBeenCalledWith(
      'https://api.twilio.com/2010-04-01/Accounts/AC_test_sid/Messages.json',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: expect.stringContaining('Basic '),
          'Content-Type': 'application/x-www-form-urlencoded',
        }),
        body: expect.stringContaining('To=%2B15551234567'),
        cache: 'no-store',
      }),
    )

    const fetchArgs = mockFetch.mock.calls[0]?.[1]
    expect(String(fetchArgs?.body)).toContain('From=%2B15550001111')
    expect(String(fetchArgs?.body)).toContain(
      'Body=TOVIS%3A+Your+verification+code+is+',
    )
    expect(String(fetchArgs?.body)).toContain('Expires+in+10+minutes.')

    expect(mockPrisma.$transaction.mock.invocationCallOrder[0]).toBeLessThan(
      mockFetch.mock.invocationCallOrder[0],
    )
  })

  it('returns 500 with SMS_NOT_CONFIGURED when Twilio env is missing, after storing a fresh code', async () => {
    mockRequireUser.mockResolvedValue({
      ok: true,
      user: makeUser(),
    })

    mockPrisma.phoneVerification.findFirst.mockResolvedValue(null)
    mockPrisma.phoneVerification.count.mockResolvedValue(0)

    const tx = makeTx()

    mockPrisma.$transaction.mockImplementation(
      async (fn: (txArg: typeof tx) => Promise<unknown>) => fn(tx),
    )

    delete process.env.TWILIO_ACCOUNT_SID

    const result = await POST(makeRequest())
    const body = await result.json()

    expect(result.status).toBe(500)
    expect(body).toEqual({
      ok: false,
      error: 'SMS provider is not configured.',
      code: 'SMS_NOT_CONFIGURED',
    })

    expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1)
    expect(tx.phoneVerification.updateMany).toHaveBeenCalledTimes(1)
    expect(tx.phoneVerification.create).toHaveBeenCalledTimes(1)
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('returns 502 with SMS_SEND_FAILED when Twilio send fails, after storing a fresh code', async () => {
    mockRequireUser.mockResolvedValue({
      ok: true,
      user: makeUser(),
    })

    mockPrisma.phoneVerification.findFirst.mockResolvedValue(null)
    mockPrisma.phoneVerification.count.mockResolvedValue(0)

    const tx = makeTx()

    mockPrisma.$transaction.mockImplementation(
      async (fn: (txArg: typeof tx) => Promise<unknown>) => fn(tx),
    )

    mockFetch.mockResolvedValue(
      new Response('', {
        status: 400,
      }),
    )
    mockSafeJson.mockResolvedValue({
      message: 'The To phone number is not a valid mobile number.',
      code: 21211,
      status: 400,
    })

    const result = await POST(makeRequest())
    const body = await result.json()

    expect(result.status).toBe(502)
    expect(body).toEqual({
      ok: false,
      error: 'Could not send verification code. Please try again.',
      code: 'SMS_SEND_FAILED',
    })

    expect(mockFetch).toHaveBeenCalledTimes(1)
    expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1)
    expect(tx.phoneVerification.updateMany).toHaveBeenCalledTimes(1)
    expect(tx.phoneVerification.create).toHaveBeenCalledTimes(1)
  })
})