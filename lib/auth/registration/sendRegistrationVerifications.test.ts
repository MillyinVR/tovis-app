// lib/auth/registration/sendRegistrationVerifications.test.ts
//
// The background tail is best-effort and returns nothing, so the only way to
// see what it did is the calls it makes. These cover the destination-country
// gate specifically: it is the one piece of this module that is NOT a verbatim
// move out of the register route, and the register route can never reach it
// (it refuses a disallowed country upstream, long before the tail runs).
//
// The country policy is NOT mocked. It defaults to US-only and is driven with
// real numbers, so this asserts the actual allowlist rather than a stub of it.

import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.hoisted(() => {
  process.env.JWT_SECRET ||= 'unit-test-jwt-secret'
})

const mockStartTwilioVerifyPhoneVerification = vi.hoisted(() => vi.fn())
const mockIssueAndSendEmailVerification = vi.hoisted(() => vi.fn())
const mockConsumeTapIntent = vi.hoisted(() => vi.fn())
const mockLogAuthEvent = vi.hoisted(() => vi.fn())
const mockCaptureAuthException = vi.hoisted(() => vi.fn())

vi.mock('@/lib/twilio/verify', () => ({
  startTwilioVerifyPhoneVerification: mockStartTwilioVerifyPhoneVerification,
}))
vi.mock('@/lib/auth/emailVerification', () => ({
  issueAndSendEmailVerification: mockIssueAndSendEmailVerification,
}))
vi.mock('@/lib/tapIntentConsume', () => ({
  consumeTapIntent: mockConsumeTapIntent,
}))
vi.mock('@/lib/observability/authEvents', () => ({
  logAuthEvent: mockLogAuthEvent,
  captureAuthException: mockCaptureAuthException,
}))

import { sendRegistrationVerifications } from './sendRegistrationVerifications'
import { rootTenantContext } from '@/lib/tenant/context'

const tenantContext = rootTenantContext('tenant-root-id')

const US_PHONE = '+16195550147'
// Ofcom's reserved-for-drama London range (020 7946 0xxx): a VALID GB number
// that cannot belong to a real person. It has to be valid, or the gate would
// refuse it as INVALID_PHONE_FORMAT and prove nothing about the country rule —
// which is exactly what the mobile drama range (+447700 900xxx) does, since
// libphonenumber treats it as invalid.
const NON_US_PHONE = '+442079460000'

function args(overrides: Partial<Parameters<typeof sendRegistrationVerifications>[0]> = {}) {
  return {
    route: 'auth.register',
    userId: 'user-1',
    email: 'person@example.com',
    phone: US_PHONE,
    appUrl: 'https://app.tovis.app',
    tenantContext,
    tapIntentId: null,
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  mockStartTwilioVerifyPhoneVerification.mockResolvedValue({
    ok: true,
    sid: 'VE123',
    status: 'pending',
  })
  mockIssueAndSendEmailVerification.mockResolvedValue(undefined)
  mockConsumeTapIntent.mockResolvedValue({ ok: true, nextUrl: null })
})

describe('sendRegistrationVerifications', () => {
  it('sends the OTP for an allowed (US) destination', async () => {
    await sendRegistrationVerifications(args())

    expect(mockStartTwilioVerifyPhoneVerification).toHaveBeenCalledWith({
      to: US_PHONE,
    })
    expect(mockIssueAndSendEmailVerification).toHaveBeenCalledTimes(1)
  })

  it('does NOT send the OTP to a disallowed country, and says so at error level', async () => {
    await sendRegistrationVerifications(args({ phone: NON_US_PHONE }))

    expect(mockStartTwilioVerifyPhoneVerification).not.toHaveBeenCalled()

    const blocked = mockLogAuthEvent.mock.calls.find(
      ([entry]) => entry.event === 'auth.phone.verify.start.blocked',
    )
    expect(blocked).toBeDefined()
    expect(blocked?.[0]).toMatchObject({
      level: 'error',
      code: 'SMS_COUNTRY_UNSUPPORTED',
      route: 'auth.register',
      userId: 'user-1',
    })
  })

  it('still sends the email and consumes the tap intent when the SMS is blocked', async () => {
    // Regression guard: the country gate must skip the SMS only. An early
    // return here would silently cost a blocked-country signup its email
    // verification too, and there is no response to notice it in.
    await sendRegistrationVerifications(
      args({ phone: NON_US_PHONE, tapIntentId: 'tap-1' }),
    )

    expect(mockStartTwilioVerifyPhoneVerification).not.toHaveBeenCalled()
    expect(mockIssueAndSendEmailVerification).toHaveBeenCalledTimes(1)
    expect(mockConsumeTapIntent).toHaveBeenCalledWith({
      tapIntentId: 'tap-1',
      userId: 'user-1',
    })
  })

  it('skips the OTP entirely when a claim click already verified the phone', async () => {
    await sendRegistrationVerifications(args({ skipPhoneVerification: true }))

    expect(mockStartTwilioVerifyPhoneVerification).not.toHaveBeenCalled()
    // Skipping is not blocking — nothing is logged as refused.
    const blocked = mockLogAuthEvent.mock.calls.find(
      ([entry]) => entry.event === 'auth.phone.verify.start.blocked',
    )
    expect(blocked).toBeUndefined()
  })

  it('never rejects when the email send throws, and still consumes the tap intent', async () => {
    mockIssueAndSendEmailVerification.mockRejectedValue(new Error('postmark down'))

    await expect(
      sendRegistrationVerifications(args({ tapIntentId: 'tap-2' })),
    ).resolves.toBeUndefined()

    expect(mockCaptureAuthException).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'auth.email.send.failed' }),
    )
    expect(mockConsumeTapIntent).toHaveBeenCalledTimes(1)
  })

  it('never rejects when the OTP send throws', async () => {
    mockStartTwilioVerifyPhoneVerification.mockRejectedValue(
      new Error('twilio exploded'),
    )

    await expect(
      sendRegistrationVerifications(args()),
    ).resolves.toBeUndefined()

    expect(mockCaptureAuthException).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'auth.register.background_tail.failed',
      }),
    )
  })
})
