import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/app/api/_utils/rateLimit', () => ({
  rateLimitIdentity: vi.fn(async () => ({})),
  enforceRateLimit: vi.fn(async () => null),
}))
vi.mock('@/app/api/_utils/auth/verificationThrottle', () => ({
  enforceVerificationSendThrottle: vi.fn(async () => ({ ok: true })),
}))
vi.mock('@/lib/smsCountryPolicy', () => ({
  validateSmsDestinationCountry: vi.fn(() => ({
    ok: true,
    phone: '+15555550123',
    countryCode: 'US',
  })),
}))
vi.mock('@/lib/auth/verification', () => ({
  getVerificationPhoneLookupValue: vi.fn(() => '+15555550123'),
}))
vi.mock('@/lib/twilio/verify', () => ({
  startTwilioVerifyPhoneVerification: vi.fn(async () => ({
    ok: true,
    sid: 's',
    status: 'pending',
  })),
  checkTwilioVerifyPhoneCode: vi.fn(async () => ({
    ok: true,
    approved: true,
    sid: 's',
    status: 'approved',
  })),
}))
vi.mock('@/lib/auth/findUserByPhone', () => ({
  findUserByPhoneForLogin: vi.fn(),
}))
vi.mock('@/app/api/_utils/auth/sessionCookie', () => ({
  setSessionCookie: vi.fn(),
}))
vi.mock('@/lib/observability/authEvents', () => ({
  captureAuthException: vi.fn(),
  logAuthEvent: vi.fn(),
}))
vi.mock('@/lib/prisma', () => ({
  prisma: { user: { update: vi.fn(async () => ({})) } },
}))

import { POST as sendPOST } from './send/route'
import { POST as verifyPOST } from './verify/route'
import { validateSmsDestinationCountry } from '@/lib/smsCountryPolicy'
import {
  startTwilioVerifyPhoneVerification,
  checkTwilioVerifyPhoneCode,
} from '@/lib/twilio/verify'
import { findUserByPhoneForLogin } from '@/lib/auth/findUserByPhone'
import { prisma } from '@/lib/prisma'

const mockCountry = vi.mocked(validateSmsDestinationCountry)
const mockStart = vi.mocked(startTwilioVerifyPhoneVerification)
const mockCheck = vi.mocked(checkTwilioVerifyPhoneCode)
const mockFindUser = vi.mocked(findUserByPhoneForLogin)
const mockUpdate = vi.mocked(prisma.user.update)

function req(body: unknown): Request {
  return new Request('https://app.tovis.app/api/v1/auth/phone-login', {
    method: 'POST',
    headers: { 'content-type': 'application/json', host: 'app.tovis.app' },
    body: JSON.stringify(body),
  })
}

const verifiedUser = {
  id: 'u1',
  email: 'a@b.com',
  role: 'CLIENT' as const,
  authVersion: 1,
  phoneVerifiedAt: new Date(),
  emailVerifiedAt: new Date(),
}

beforeEach(() => {
  vi.clearAllMocks()
  mockCountry.mockReturnValue({
    ok: true,
    phone: '+15555550123',
    countryCode: 'US',
  })
})

describe('POST /api/v1/auth/phone-login/send', () => {
  it('400 when phone is missing', async () => {
    const res = await sendPOST(req({}))
    expect(res.status).toBe(400)
    expect((await res.json()).code).toBe('PHONE_REQUIRED')
  })

  it('400 for a disallowed country', async () => {
    mockCountry.mockReturnValueOnce({
      ok: false,
      code: 'SMS_COUNTRY_UNSUPPORTED',
      message: 'Not supported.',
      countryCode: 'XX',
    })
    const res = await sendPOST(req({ phone: '+440000' }))
    expect(res.status).toBe(400)
    expect((await res.json()).code).toBe('SMS_COUNTRY_UNSUPPORTED')
  })

  it('returns a generic message and does NOT send when no account exists', async () => {
    mockFindUser.mockResolvedValue(null)
    const res = await sendPOST(req({ phone: '+15555550123' }))
    expect(res.status).toBe(200)
    expect((await res.json()).message).toMatch(/if an account exists/i)
    expect(mockStart).not.toHaveBeenCalled()
  })

  it('sends a code (same generic body) when an account exists', async () => {
    mockFindUser.mockResolvedValue(verifiedUser)
    const res = await sendPOST(req({ phone: '+15555550123' }))
    expect(res.status).toBe(200)
    expect((await res.json()).message).toMatch(/if an account exists/i)
    expect(mockStart).toHaveBeenCalledWith({ to: '+15555550123' })
  })

  it('503 when Twilio is not configured', async () => {
    mockFindUser.mockResolvedValue(verifiedUser)
    mockStart.mockResolvedValueOnce({
      ok: false,
      code: 'TWILIO_VERIFY_NOT_CONFIGURED',
      message: 'nope',
    })
    const res = await sendPOST(req({ phone: '+15555550123' }))
    expect(res.status).toBe(503)
  })
})

describe('POST /api/v1/auth/phone-login/verify', () => {
  it('400 when fields are missing', async () => {
    const res = await verifyPOST(req({ phone: '+15555550123' }))
    expect(res.status).toBe(400)
    expect((await res.json()).code).toBe('MISSING_FIELDS')
  })

  it('400 for a non-6-digit code', async () => {
    const res = await verifyPOST(req({ phone: '+15555550123', code: '12' }))
    expect(res.status).toBe(400)
    expect((await res.json()).code).toBe('CODE_INVALID')
  })

  it('rejects uniformly when no account exists (no existence leak)', async () => {
    mockFindUser.mockResolvedValue(null)
    const res = await verifyPOST(req({ phone: '+15555550123', code: '123456' }))
    expect(res.status).toBe(400)
    expect((await res.json()).code).toBe('CODE_REJECTED')
    expect(mockCheck).not.toHaveBeenCalled()
  })

  it('rejects when the code is wrong', async () => {
    mockFindUser.mockResolvedValue(verifiedUser)
    mockCheck.mockResolvedValueOnce({
      ok: true,
      approved: false,
      sid: 's',
      status: 'pending',
    })
    const res = await verifyPOST(req({ phone: '+15555550123', code: '000000' }))
    expect(res.status).toBe(400)
    expect((await res.json()).code).toBe('CODE_REJECTED')
  })

  it('returns the session payload on a correct code', async () => {
    mockFindUser.mockResolvedValue(verifiedUser)
    const res = await verifyPOST(req({ phone: '+15555550123', code: '123456' }))
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.ok).toBe(true)
    expect(json.user).toEqual({ id: 'u1', email: 'a@b.com', role: 'CLIENT' })
    expect(typeof json.token).toBe('string')
    expect(json.isPhoneVerified).toBe(true)
    expect(json.isFullyVerified).toBe(true)
  })

  it('marks an unverified phone as verified on success', async () => {
    mockFindUser.mockResolvedValue({ ...verifiedUser, phoneVerifiedAt: null })
    const res = await verifyPOST(req({ phone: '+15555550123', code: '123456' }))
    expect(res.status).toBe(200)
    expect(mockUpdate).toHaveBeenCalledWith({
      where: { id: 'u1' },
      data: { phoneVerifiedAt: expect.any(Date) },
    })
  })
})
