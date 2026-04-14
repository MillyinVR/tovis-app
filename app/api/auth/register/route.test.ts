import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Role } from '@prisma/client'

const mockHashPassword = vi.hoisted(() => vi.fn())
const mockCreateVerificationToken = vi.hoisted(() => vi.fn())

const mockConsumeTapIntent = vi.hoisted(() => vi.fn())

const mockGetAppUrlFromRequest = vi.hoisted(() => vi.fn())
const mockIssueAndSendEmailVerification = vi.hoisted(() => vi.fn())

const mockIsValidIanaTimeZone = vi.hoisted(() => vi.fn())

const mockEnforceRateLimit = vi.hoisted(() => vi.fn())
const mockRateLimitIdentity = vi.hoisted(() => vi.fn())

const mockTwilioMessagesCreate = vi.hoisted(() => vi.fn())
const mockTwilio = vi.hoisted(() =>
  vi.fn(() => ({
    messages: {
      create: mockTwilioMessagesCreate,
    },
  })),
)

const mockPrisma = vi.hoisted(() => ({
  user: {
    findFirst: vi.fn(),
  },
  professionalProfile: {
    findFirst: vi.fn(),
  },
  $transaction: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: mockPrisma,
}))

vi.mock('@/lib/auth', () => ({
  hashPassword: mockHashPassword,
  createVerificationToken: mockCreateVerificationToken,
}))

vi.mock('@/lib/tapIntentConsume', () => ({
  consumeTapIntent: mockConsumeTapIntent,
}))

vi.mock('@/lib/auth/emailVerification', () => ({
  getAppUrlFromRequest: mockGetAppUrlFromRequest,
  issueAndSendEmailVerification: mockIssueAndSendEmailVerification,
}))

vi.mock('@/lib/timeZone', () => ({
  isValidIanaTimeZone: mockIsValidIanaTimeZone,
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

vi.mock('twilio', () => ({
  default: mockTwilio,
}))

import { POST } from './route'

function resetMockGroup(group: Record<string, ReturnType<typeof vi.fn>>) {
  for (const fn of Object.values(group)) {
    fn.mockReset()
  }
}

function makeClientSignupBody() {
  return {
    email: 'client@example.com',
    password: 'SuperSecret123!',
    role: 'CLIENT',
    firstName: 'Tori',
    lastName: 'Morales',
    phone: '(555) 123-4567',
    tapIntentId: 'tap_1',
    signupLocation: {
      kind: 'CLIENT_ZIP',
      postalCode: '92101',
      city: 'San Diego',
      state: 'CA',
      countryCode: 'US',
      lat: 32.7157,
      lng: -117.1611,
      timeZoneId: 'America/Los_Angeles',
    },
  }
}

function makeRequest(body: unknown) {
  return new Request('http://localhost/api/auth/register', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      host: 'localhost:3000',
    },
    body: JSON.stringify(body),
  })
}

describe('app/api/auth/register/route', () => {
  beforeEach(() => {
    resetMockGroup(mockPrisma.user)
    resetMockGroup(mockPrisma.professionalProfile)
    mockPrisma.$transaction.mockReset()

    mockHashPassword.mockReset()
    mockCreateVerificationToken.mockReset()

    mockConsumeTapIntent.mockReset()

    mockGetAppUrlFromRequest.mockReset()
    mockIssueAndSendEmailVerification.mockReset()

    mockIsValidIanaTimeZone.mockReset()

    mockEnforceRateLimit.mockReset()
    mockRateLimitIdentity.mockReset()

    mockTwilio.mockReset()
    mockTwilioMessagesCreate.mockReset()

    mockRateLimitIdentity.mockResolvedValue('ip:test')
    mockEnforceRateLimit.mockResolvedValue(null)

    mockHashPassword.mockResolvedValue('hashed_password')
    mockCreateVerificationToken.mockReturnValue('verification_token')

    mockGetAppUrlFromRequest.mockReturnValue('http://localhost:3000')
    mockIssueAndSendEmailVerification.mockResolvedValue({
      id: 'evt_1',
      expiresAt: new Date('2026-04-09T12:00:00.000Z'),
    })

    mockIsValidIanaTimeZone.mockReturnValue(true)

    mockConsumeTapIntent.mockResolvedValue({
      nextUrl: '/looks?from=tap',
    })

    mockPrisma.user.findFirst.mockResolvedValue(null)
    mockPrisma.professionalProfile.findFirst.mockResolvedValue(null)

    mockTwilioMessagesCreate.mockResolvedValue({
      sid: 'SM123456789',
    })

    process.env.TWILIO_ACCOUNT_SID = 'AC_test_sid'
    process.env.TWILIO_AUTH_TOKEN = 'test_auth_token'
    process.env.TWILIO_FROM_NUMBER = '+15550001111'
  })

  it('passes through the rate-limit response unchanged', async () => {
    const rateLimitRes = new Response(null, { status: 429 })
    mockEnforceRateLimit.mockResolvedValue(rateLimitRes)

    const result = await POST(makeRequest(makeClientSignupBody()))

    expect(mockRateLimitIdentity).toHaveBeenCalledTimes(1)
    expect(mockEnforceRateLimit).toHaveBeenCalledWith({
      bucket: 'auth:register',
      identity: 'ip:test',
    })

    expect(result).toBe(rateLimitRes)
    expect(result.status).toBe(429)
  })

  it('creates an unverified client account, sends verification artifacts, and issues a verification-only session', async () => {
    const tx = {
      user: {
        create: vi.fn().mockResolvedValue({
          id: 'user_1',
          email: 'client@example.com',
          role: Role.CLIENT,
          phone: '+15551234567',
          authVersion: 1,
        }),
      },
      phoneVerification: {
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
        create: vi.fn().mockResolvedValue({ id: 'pv_1' }),
      },
    }

    mockPrisma.$transaction.mockImplementation(
      async (fn: (txArg: typeof tx) => Promise<unknown>) => fn(tx),
    )

    const result = await POST(makeRequest(makeClientSignupBody()))
    const body = await result.json()

    expect(result.status).toBe(201)
    expect(body).toEqual({
      ok: true,
      user: {
        id: 'user_1',
        email: 'client@example.com',
        role: Role.CLIENT,
      },
      nextUrl: '/looks?from=tap',
      requiresPhoneVerification: true,
      requiresEmailVerification: true,
      isPhoneVerified: false,
      isEmailVerified: false,
      isFullyVerified: false,
      phoneVerificationSent: true,
      phoneVerificationErrorCode: null,
      emailVerificationSent: true,
      needsManualLicenseUpload: false,
      manualLicensePendingReview: false,
    })

    expect(mockHashPassword).toHaveBeenCalledWith('SuperSecret123!')
    expect(mockCreateVerificationToken).toHaveBeenCalledWith({
      userId: 'user_1',
      role: Role.CLIENT,
      authVersion: 1,
    })

    expect(tx.user.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        email: 'client@example.com',
        phone: '+15551234567',
        phoneVerifiedAt: null,
        emailVerifiedAt: null,
        password: 'hashed_password',
        role: 'CLIENT',
        clientProfile: {
          create: {
            firstName: 'Tori',
            lastName: 'Morales',
            phone: '+15551234567',
            phoneVerifiedAt: null,
          },
        },
      }),
      select: {
        id: true,
        email: true,
        role: true,
        phone: true,
        authVersion: true,
      },
    })

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
      select: { id: true },
    })

    expect(mockIssueAndSendEmailVerification).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user_1',
        email: 'client@example.com',
        appUrl: 'http://localhost:3000',
        next: null,
        intent: null,
        inviteToken: null,
      }),
    )

    expect(mockConsumeTapIntent).toHaveBeenCalledWith({
      tapIntentId: 'tap_1',
      userId: 'user_1',
    })

    expect(mockTwilio).toHaveBeenCalledWith(
      'AC_test_sid',
      'test_auth_token',
    )
    expect(mockTwilioMessagesCreate).toHaveBeenCalledTimes(1)

    const setCookie = result.headers.get('set-cookie')
    expect(setCookie).toContain('tovis_token=verification_token')
    expect(setCookie).toContain('tovis_client_zip=92101')
  })

  it('still creates the verification flow when email send fails, but reports emailVerificationSent=false', async () => {
    const tx = {
      user: {
        create: vi.fn().mockResolvedValue({
          id: 'user_2',
          email: 'client@example.com',
          role: Role.CLIENT,
          phone: '+15551234567',
          authVersion: 1,
        }),
      },
      phoneVerification: {
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
        create: vi.fn().mockResolvedValue({ id: 'pv_2' }),
      },
    }

    mockPrisma.$transaction.mockImplementation(
      async (fn: (txArg: typeof tx) => Promise<unknown>) => fn(tx),
    )

    mockIssueAndSendEmailVerification.mockRejectedValue(
      new Error('Postmark timeout'),
    )

    const result = await POST(makeRequest(makeClientSignupBody()))
    const body = await result.json()

    expect(result.status).toBe(201)
    expect(body.ok).toBe(true)
    expect(body.requiresPhoneVerification).toBe(true)
    expect(body.requiresEmailVerification).toBe(true)
    expect(body.isFullyVerified).toBe(false)
    expect(body.phoneVerificationSent).toBe(true)
    expect(body.phoneVerificationErrorCode).toBe(null)
    expect(body.emailVerificationSent).toBe(false)

    expect(mockCreateVerificationToken).toHaveBeenCalledWith({
      userId: 'user_2',
      role: Role.CLIENT,
      authVersion: 1,
    })

    const setCookie = result.headers.get('set-cookie')
    expect(setCookie).toContain('tovis_token=verification_token')
  })

  it('still creates the verification flow when sms send fails, but reports phoneVerificationSent=false with an error code', async () => {
    const tx = {
      user: {
        create: vi.fn().mockResolvedValue({
          id: 'user_3',
          email: 'client@example.com',
          role: Role.CLIENT,
          phone: '+15551234567',
          authVersion: 1,
        }),
      },
      phoneVerification: {
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
        create: vi.fn().mockResolvedValue({ id: 'pv_3' }),
      },
    }

    mockPrisma.$transaction.mockImplementation(
      async (fn: (txArg: typeof tx) => Promise<unknown>) => fn(tx),
    )

    mockTwilioMessagesCreate.mockRejectedValue(new Error('Twilio timeout'))

    const result = await POST(makeRequest(makeClientSignupBody()))
    const body = await result.json()

    expect(result.status).toBe(201)
    expect(body.ok).toBe(true)
    expect(body.requiresPhoneVerification).toBe(true)
    expect(body.requiresEmailVerification).toBe(true)
    expect(body.isFullyVerified).toBe(false)
    expect(body.phoneVerificationSent).toBe(false)
    expect(body.phoneVerificationErrorCode).toBe('SMS_SEND_FAILED')
    expect(body.emailVerificationSent).toBe(true)

    expect(mockCreateVerificationToken).toHaveBeenCalledWith({
      userId: 'user_3',
      role: Role.CLIENT,
      authVersion: 1,
    })

    const setCookie = result.headers.get('set-cookie')
    expect(setCookie).toContain('tovis_token=verification_token')
  })

  it('still creates the verification flow when twilio env is missing, but reports phoneVerificationSent=false with SMS_NOT_CONFIGURED', async () => {
    const tx = {
      user: {
        create: vi.fn().mockResolvedValue({
          id: 'user_4',
          email: 'client@example.com',
          role: Role.CLIENT,
          phone: '+15551234567',
          authVersion: 1,
        }),
      },
      phoneVerification: {
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
        create: vi.fn().mockResolvedValue({ id: 'pv_4' }),
      },
    }

    mockPrisma.$transaction.mockImplementation(
      async (fn: (txArg: typeof tx) => Promise<unknown>) => fn(tx),
    )

    delete process.env.TWILIO_ACCOUNT_SID

    const result = await POST(makeRequest(makeClientSignupBody()))
    const body = await result.json()

    expect(result.status).toBe(201)
    expect(body.ok).toBe(true)
    expect(body.phoneVerificationSent).toBe(false)
    expect(body.phoneVerificationErrorCode).toBe('SMS_NOT_CONFIGURED')
    expect(body.emailVerificationSent).toBe(true)
  })

  it('returns 500 when the app URL cannot be resolved', async () => {
    mockGetAppUrlFromRequest.mockReturnValue(null)

    const result = await POST(makeRequest(makeClientSignupBody()))
    const body = await result.json()

    expect(result.status).toBe(500)
    expect(body).toEqual({
      ok: false,
      error: 'App URL is not configured.',
      code: 'APP_URL_MISSING',
    })

    expect(mockPrisma.$transaction).not.toHaveBeenCalled()
    expect(mockIssueAndSendEmailVerification).not.toHaveBeenCalled()
  })
})
