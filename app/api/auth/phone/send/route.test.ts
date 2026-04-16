import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Role } from '@prisma/client'

const mockRequireUser = vi.hoisted(() => vi.fn())
const mockEnforceRateLimit = vi.hoisted(() => vi.fn())
const mockPhoneRateLimitIdentity = vi.hoisted(() => vi.fn())
const mockIsRuntimeFlagEnabled = vi.hoisted(() => vi.fn())
const mockValidateSmsDestinationCountry = vi.hoisted(() => vi.fn())

const mockEnforcePhoneVerificationOtpLimits = vi.hoisted(() => vi.fn())
const mockIssueAndSendPhoneVerificationCode = vi.hoisted(() => vi.fn())
const mockReadPhoneSendErrorCode = vi.hoisted(() => vi.fn())

const mockCaptureAuthException = vi.hoisted(() => vi.fn())

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

vi.mock('@/app/api/_utils/auth/phoneVerificationSend', () => ({
  PHONE_VERIFICATION_RESEND_COOLDOWN_SECONDS: 60,
  enforcePhoneVerificationOtpLimits: mockEnforcePhoneVerificationOtpLimits,
  issueAndSendPhoneVerificationCode: mockIssueAndSendPhoneVerificationCode,
  readPhoneSendErrorCode: mockReadPhoneSendErrorCode,
}))

vi.mock('@/lib/observability/authEvents', () => ({
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

describe('app/api/auth/phone/send/route', () => {
  beforeEach(() => {
    mockRequireUser.mockReset()
    mockEnforceRateLimit.mockReset()
    mockPhoneRateLimitIdentity.mockReset()
    mockIsRuntimeFlagEnabled.mockReset()
    mockValidateSmsDestinationCountry.mockReset()
    mockEnforcePhoneVerificationOtpLimits.mockReset()
    mockIssueAndSendPhoneVerificationCode.mockReset()
    mockReadPhoneSendErrorCode.mockReset()
    mockCaptureAuthException.mockReset()

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
    mockEnforcePhoneVerificationOtpLimits.mockResolvedValue({
      ok: true,
      retryAfterSeconds: 0,
    })
    mockIssueAndSendPhoneVerificationCode.mockResolvedValue({
      sid: 'SM123456789',
    })
    mockReadPhoneSendErrorCode.mockReturnValue('INTERNAL')
  })

  afterEach(() => {
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
    expect(mockCaptureAuthException).not.toHaveBeenCalled()
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
    expect(mockEnforcePhoneVerificationOtpLimits).not.toHaveBeenCalled()
    expect(mockIssueAndSendPhoneVerificationCode).not.toHaveBeenCalled()
    expect(mockCaptureAuthException).not.toHaveBeenCalled()
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
    expect(mockIssueAndSendPhoneVerificationCode).not.toHaveBeenCalled()
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
    expect(mockEnforcePhoneVerificationOtpLimits).not.toHaveBeenCalled()
    expect(mockIssueAndSendPhoneVerificationCode).not.toHaveBeenCalled()
    expect(mockCaptureAuthException).not.toHaveBeenCalled()
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
    expect(mockEnforcePhoneVerificationOtpLimits).not.toHaveBeenCalled()
    expect(mockIssueAndSendPhoneVerificationCode).not.toHaveBeenCalled()
    expect(mockCaptureAuthException).not.toHaveBeenCalled()
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
    expect(mockEnforcePhoneVerificationOtpLimits).not.toHaveBeenCalled()
    expect(mockIssueAndSendPhoneVerificationCode).not.toHaveBeenCalled()
    expect(mockCaptureAuthException).not.toHaveBeenCalled()
  })

  it('returns 429 and Retry-After when resend is rate limited by cooldown', async () => {
    mockRequireUser.mockResolvedValue({
      ok: true,
      user: makeUser(),
    })

    mockEnforcePhoneVerificationOtpLimits.mockResolvedValue({
      ok: false,
      retryAfterSeconds: 60,
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
    expect(mockEnforcePhoneVerificationOtpLimits).toHaveBeenCalledWith('user_1')
    expect(mockIssueAndSendPhoneVerificationCode).not.toHaveBeenCalled()
    expect(mockCaptureAuthException).not.toHaveBeenCalled()
  })

  it('returns 429 and Retry-After when hourly cap is exceeded', async () => {
    mockRequireUser.mockResolvedValue({
      ok: true,
      user: makeUser(),
    })

    mockEnforcePhoneVerificationOtpLimits.mockResolvedValue({
      ok: false,
      retryAfterSeconds: 600,
    })

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
    expect(mockEnforcePhoneVerificationOtpLimits).toHaveBeenCalledWith('user_1')
    expect(mockIssueAndSendPhoneVerificationCode).not.toHaveBeenCalled()
    expect(mockCaptureAuthException).not.toHaveBeenCalled()
  })

  it('issues and sends a fresh verification code when allowed', async () => {
    mockRequireUser.mockResolvedValue({
      ok: true,
      user: makeUser({
        role: Role.CLIENT,
        phone: '+15551234567',
      }),
    })

    mockEnforcePhoneVerificationOtpLimits.mockResolvedValue({
      ok: true,
      retryAfterSeconds: 0,
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
    expect(mockEnforcePhoneVerificationOtpLimits).toHaveBeenCalledWith('user_1')
    expect(mockIssueAndSendPhoneVerificationCode).toHaveBeenCalledWith({
      userId: 'user_1',
      phone: '+15551234567',
    })
    expect(mockCaptureAuthException).not.toHaveBeenCalled()
  })

  it('returns 500 with SMS_NOT_CONFIGURED when the helper reports missing Twilio config', async () => {
    mockRequireUser.mockResolvedValue({
      ok: true,
      user: makeUser(),
    })

    mockIssueAndSendPhoneVerificationCode.mockRejectedValue(
      new Error('Missing env var: TWILIO_ACCOUNT_SID'),
    )
    mockReadPhoneSendErrorCode.mockReturnValue('SMS_NOT_CONFIGURED')

    const result = await POST(makeRequest())
    const body = await result.json()

    expect(result.status).toBe(500)
    expect(body).toEqual({
      ok: false,
      error: 'SMS provider is not configured.',
      code: 'SMS_NOT_CONFIGURED',
    })

    expect(mockCaptureAuthException).toHaveBeenCalledWith({
      event: 'auth.phone.send.not_configured',
      route: 'auth.phone.send',
      provider: 'twilio',
      code: 'SMS_NOT_CONFIGURED',
      userId: 'user_1',
      phone: '+15551234567',
      error: expect.any(Error),
    })
  })

  it('returns 502 with SMS_SEND_FAILED when the helper reports SMS send failure', async () => {
    mockRequireUser.mockResolvedValue({
      ok: true,
      user: makeUser(),
    })

    mockIssueAndSendPhoneVerificationCode.mockRejectedValue(
      new Error('Twilio send failed'),
    )
    mockReadPhoneSendErrorCode.mockReturnValue('SMS_SEND_FAILED')

    const result = await POST(makeRequest())
    const body = await result.json()

    expect(result.status).toBe(502)
    expect(body).toEqual({
      ok: false,
      error: 'Could not send verification code. Please try again.',
      code: 'SMS_SEND_FAILED',
    })

    expect(mockCaptureAuthException).toHaveBeenCalledWith({
      event: 'auth.phone.send.failed',
      route: 'auth.phone.send',
      provider: 'twilio',
      code: 'SMS_SEND_FAILED',
      userId: 'user_1',
      phone: '+15551234567',
      error: expect.any(Error),
    })
  })

  it('returns 500 for unexpected helper failures', async () => {
    mockRequireUser.mockResolvedValue({
      ok: true,
      user: makeUser(),
    })

    mockIssueAndSendPhoneVerificationCode.mockRejectedValue(
      new Error('Unexpected failure'),
    )
    mockReadPhoneSendErrorCode.mockReturnValue('INTERNAL')

    const result = await POST(makeRequest())
    const body = await result.json()

    expect(result.status).toBe(500)
    expect(body).toEqual({
      ok: false,
      error: 'Internal server error',
      code: 'INTERNAL',
    })

    expect(mockCaptureAuthException).toHaveBeenCalledWith({
      event: 'auth.phone.send.internal_error',
      route: 'auth.phone.send',
      code: 'INTERNAL',
      userId: 'user_1',
      phone: '+15551234567',
      error: expect.any(Error),
    })
  })
})