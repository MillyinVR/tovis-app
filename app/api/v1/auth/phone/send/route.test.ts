// app/api/v1/auth/phone/send/route.test.ts

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Role } from '@prisma/client'

const mockRequireUser = vi.hoisted(() => vi.fn())
const mockEnforceVerificationSendThrottle = vi.hoisted(() => vi.fn())
const mockIsRuntimeFlagEnabled = vi.hoisted(() => vi.fn())
const mockValidateSmsDestinationCountry = vi.hoisted(() => vi.fn())
const mockStartTwilioVerifyPhoneVerification = vi.hoisted(() => vi.fn())

const mockLogAuthEvent = vi.hoisted(() => vi.fn())
const mockCaptureAuthException = vi.hoisted(() => vi.fn())

vi.mock('@/app/api/_utils/auth/requireUser', () => ({
  requireUser: mockRequireUser,
}))

vi.mock('@/app/api/_utils/auth/verificationThrottle', () => ({
  enforceVerificationSendThrottle: mockEnforceVerificationSendThrottle,
}))

vi.mock('@/lib/runtimeFlags', () => ({
  isRuntimeFlagEnabled: mockIsRuntimeFlagEnabled,
}))

vi.mock('@/lib/smsCountryPolicy', () => ({
  validateSmsDestinationCountry: mockValidateSmsDestinationCountry,
}))

vi.mock('@/lib/twilio/verify', () => ({
  startTwilioVerifyPhoneVerification: mockStartTwilioVerifyPhoneVerification,
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

function makeRequest() {
  return new Request('http://localhost/api/v1/auth/phone/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  })
}

describe('app/api/v1/auth/phone/send/route', () => {
  beforeEach(() => {
    mockRequireUser.mockReset()
    mockEnforceVerificationSendThrottle.mockReset()
    mockIsRuntimeFlagEnabled.mockReset()
    mockValidateSmsDestinationCountry.mockReset()
    mockStartTwilioVerifyPhoneVerification.mockReset()
    mockLogAuthEvent.mockReset()
    mockCaptureAuthException.mockReset()

    mockIsRuntimeFlagEnabled.mockResolvedValue(false)
    mockEnforceVerificationSendThrottle.mockResolvedValue({ ok: true })
    mockValidateSmsDestinationCountry.mockReturnValue({
      ok: true,
      phone: '+15551234567',
      countryCode: 'US',
    })
    mockStartTwilioVerifyPhoneVerification.mockResolvedValue({
      ok: true,
      sid: 'VE123456789',
      status: 'pending',
    })
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
    expect(mockEnforceVerificationSendThrottle).not.toHaveBeenCalled()
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
      isPhoneVerified: true,
      isEmailVerified: false,
      isFullyVerified: false,
      requiresEmailVerification: true,
    })

    expect(mockIsRuntimeFlagEnabled).not.toHaveBeenCalled()
    expect(mockValidateSmsDestinationCountry).not.toHaveBeenCalled()
    expect(mockEnforceVerificationSendThrottle).not.toHaveBeenCalled()
    expect(mockStartTwilioVerifyPhoneVerification).not.toHaveBeenCalled()
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
    expect(mockEnforceVerificationSendThrottle).not.toHaveBeenCalled()
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
    expect(mockEnforceVerificationSendThrottle).not.toHaveBeenCalled()
    expect(mockStartTwilioVerifyPhoneVerification).not.toHaveBeenCalled()
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
    expect(mockEnforceVerificationSendThrottle).not.toHaveBeenCalled()
    expect(mockStartTwilioVerifyPhoneVerification).not.toHaveBeenCalled()
    expect(mockCaptureAuthException).not.toHaveBeenCalled()
  })

  it('returns the shared verification-send throttle response unchanged when throttle blocks resend', async () => {
    mockRequireUser.mockResolvedValue({
      ok: true,
      user: makeUser(),
    })

    const quotaRes = new Response(null, { status: 429 })

    mockEnforceVerificationSendThrottle.mockResolvedValue({
      ok: false,
      response: quotaRes,
    })

    const result = await POST(makeRequest())

    expect(mockIsRuntimeFlagEnabled).toHaveBeenCalledWith('sms_disabled')
    expect(mockValidateSmsDestinationCountry).toHaveBeenCalledWith(
      '+15551234567',
    )

    expect(mockEnforceVerificationSendThrottle).toHaveBeenCalledWith({
      userId: 'user_1',
      phone: '+15551234567',
    })

    expect(result).toBe(quotaRes)
    expect(result.status).toBe(429)
    expect(mockStartTwilioVerifyPhoneVerification).not.toHaveBeenCalled()
    expect(mockCaptureAuthException).not.toHaveBeenCalled()
  })

  it('starts Twilio Verify when resend is allowed', async () => {
    mockRequireUser.mockResolvedValue({
      ok: true,
      user: makeUser({
        role: Role.CLIENT,
        phone: '+15551234567',
      }),
    })

    const result = await POST(makeRequest())
    const body = await result.json()

    expect(result.status).toBe(200)
    expect(body).toEqual({
      ok: true,
      sent: true,
      isPhoneVerified: false,
      isEmailVerified: false,
      isFullyVerified: false,
      requiresEmailVerification: true,
    })

    expect(mockIsRuntimeFlagEnabled).toHaveBeenCalledWith('sms_disabled')
    expect(mockValidateSmsDestinationCountry).toHaveBeenCalledWith(
      '+15551234567',
    )

    expect(mockEnforceVerificationSendThrottle).toHaveBeenCalledWith({
      userId: 'user_1',
      phone: '+15551234567',
    })

    expect(mockStartTwilioVerifyPhoneVerification).toHaveBeenCalledWith({
      to: '+15551234567',
    })

    expect(mockLogAuthEvent).toHaveBeenCalledWith({
      level: 'info',
      event: 'auth.phone.send.success',
      route: 'auth.phone.send',
      provider: 'twilio_verify',
      userId: 'user_1',
      phone: '+15551234567',
      meta: {
        sid: 'VE123456789',
        status: 'pending',
      },
    })

    expect(mockCaptureAuthException).not.toHaveBeenCalled()
  })

  it('returns 503 when Twilio Verify is not configured', async () => {
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

    const result = await POST(makeRequest())
    const body = await result.json()

    expect(result.status).toBe(503)
    expect(body).toEqual({
      ok: false,
      error: 'Could not send verification code. Please try again.',
      code: 'TWILIO_VERIFY_NOT_CONFIGURED',
    })

    expect(mockEnforceVerificationSendThrottle).toHaveBeenCalledWith({
      userId: 'user_1',
      phone: '+15551234567',
    })

    expect(mockStartTwilioVerifyPhoneVerification).toHaveBeenCalledWith({
      to: '+15551234567',
    })

    expect(mockLogAuthEvent).toHaveBeenCalledWith({
      level: 'error',
      event: 'auth.phone.send.failed',
      route: 'auth.phone.send',
      provider: 'twilio_verify',
      code: 'TWILIO_VERIFY_NOT_CONFIGURED',
      userId: 'user_1',
      phone: '+15551234567',
      meta: {
        message:
          'Missing TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, or TWILIO_VERIFY_SERVICE_SID.',
      },
    })

    expect(mockCaptureAuthException).not.toHaveBeenCalled()
  })

  it('returns 502 when Twilio Verify send fails', async () => {
    mockRequireUser.mockResolvedValue({
      ok: true,
      user: makeUser(),
    })

    mockStartTwilioVerifyPhoneVerification.mockResolvedValue({
      ok: false,
      code: 'TWILIO_VERIFY_SEND_FAILED',
      message: 'Twilio Verify failed.',
    })

    const result = await POST(makeRequest())
    const body = await result.json()

    expect(result.status).toBe(502)
    expect(body).toEqual({
      ok: false,
      error: 'Could not send verification code. Please try again.',
      code: 'TWILIO_VERIFY_SEND_FAILED',
    })

    expect(mockEnforceVerificationSendThrottle).toHaveBeenCalledWith({
      userId: 'user_1',
      phone: '+15551234567',
    })

    expect(mockStartTwilioVerifyPhoneVerification).toHaveBeenCalledWith({
      to: '+15551234567',
    })

    expect(mockLogAuthEvent).toHaveBeenCalledWith({
      level: 'warn',
      event: 'auth.phone.send.failed',
      route: 'auth.phone.send',
      provider: 'twilio_verify',
      code: 'TWILIO_VERIFY_SEND_FAILED',
      userId: 'user_1',
      phone: '+15551234567',
      meta: {
        message: 'Twilio Verify failed.',
      },
    })

    expect(mockCaptureAuthException).not.toHaveBeenCalled()
  })

  it('returns 500 for unexpected internal failures', async () => {
    mockRequireUser.mockResolvedValue({
      ok: true,
      user: makeUser(),
    })

    mockStartTwilioVerifyPhoneVerification.mockRejectedValue(
      new Error('Unexpected failure'),
    )

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
      provider: 'twilio_verify',
      code: 'INTERNAL',
      userId: 'user_1',
      phone: '+15551234567',
      error: expect.any(Error),
    })
  })
})