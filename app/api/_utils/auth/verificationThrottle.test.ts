// app/api/_utils/auth/verificationThrottle.test.ts

import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockEnforceRateLimit = vi.hoisted(() => vi.fn())
const mockPhoneRateLimitIdentity = vi.hoisted(() => vi.fn())
const mockRateLimitIdentity = vi.hoisted(() => vi.fn())
const mockTokenRateLimitIdentity = vi.hoisted(() => vi.fn())
const mockGetTrustedClientIpFromRequest = vi.hoisted(() => vi.fn())

vi.mock('@/app/api/_utils/rateLimit', () => ({
  enforceRateLimit: mockEnforceRateLimit,
  phoneRateLimitIdentity: mockPhoneRateLimitIdentity,
  rateLimitIdentity: mockRateLimitIdentity,
  tokenRateLimitIdentity: mockTokenRateLimitIdentity,
}))

vi.mock('@/lib/trustedClientIp', () => ({
  getTrustedClientIpFromRequest: mockGetTrustedClientIpFromRequest,
}))

import {
  enforceVerificationSendThrottle,
  enforceVerificationVerifyThrottle,
} from './verificationThrottle'

function makeRateLimitResponse() {
  return new Response(
    JSON.stringify({
      ok: false,
      error: 'Too many requests. Please slow down.',
      code: 'RATE_LIMITED',
    }),
    {
      status: 429,
      headers: {
        'Content-Type': 'application/json',
        'Retry-After': '45',
      },
    },
  )
}

function makeRequest(path: string, ip = '198.51.100.10') {
  return new Request(`http://localhost${path}`, {
    method: 'POST',
    headers: {
      'x-forwarded-for': ip,
    },
  })
}

describe('app/api/_utils/auth/verificationThrottle', () => {
  beforeEach(() => {
    mockEnforceRateLimit.mockReset()
    mockPhoneRateLimitIdentity.mockReset()
    mockRateLimitIdentity.mockReset()
    mockTokenRateLimitIdentity.mockReset()
    mockGetTrustedClientIpFromRequest.mockReset()

    mockEnforceRateLimit.mockResolvedValue(null)

    mockRateLimitIdentity.mockResolvedValue({
      kind: 'ip',
      id: '198.51.100.10',
    })

    mockPhoneRateLimitIdentity.mockImplementation((phone: string) => ({
      kind: 'phone',
      id: phone,
    }))

    mockTokenRateLimitIdentity.mockImplementation((tokenPrefix: string) => ({
      kind: 'token',
      id: tokenPrefix,
    }))

    mockGetTrustedClientIpFromRequest.mockReturnValue('198.51.100.10')
  })

  it('returns ok when all verification send limits allow the request', async () => {
    const result = await enforceVerificationSendThrottle({
      userId: 'user_1',
      phone: '+15551234567',
    })

    expect(result).toEqual({ ok: true })

    expect(mockRateLimitIdentity).toHaveBeenCalledWith('user_1')

    expect(mockEnforceRateLimit).toHaveBeenNthCalledWith(1, {
      bucket: 'auth:email:send',
      identity: {
        kind: 'ip',
        id: '198.51.100.10',
      },
    })

    expect(mockPhoneRateLimitIdentity).toHaveBeenCalledWith('+15551234567')

    expect(mockEnforceRateLimit).toHaveBeenNthCalledWith(2, {
      bucket: 'auth:sms-phone-hour',
      identity: {
        kind: 'phone',
        id: '+15551234567',
      },
    })

    expect(mockEnforceRateLimit).toHaveBeenNthCalledWith(3, {
      bucket: 'auth:sms-phone-day',
      identity: {
        kind: 'phone',
        id: '+15551234567',
      },
    })
  })

  it('returns blocked response when the identity-level send limit blocks', async () => {
    const blockedResponse = makeRateLimitResponse()

    mockEnforceRateLimit.mockResolvedValueOnce(blockedResponse)

    const result = await enforceVerificationSendThrottle({
      userId: 'user_1',
      phone: '+15551234567',
    })

    expect(result).toEqual({
      ok: false,
      response: blockedResponse,
    })

    expect(mockEnforceRateLimit).toHaveBeenCalledTimes(1)
    expect(mockPhoneRateLimitIdentity).not.toHaveBeenCalled()
  })

  it('returns blocked response when the hourly phone SMS limit blocks', async () => {
    const blockedResponse = makeRateLimitResponse()

    mockEnforceRateLimit
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(blockedResponse)

    const result = await enforceVerificationSendThrottle({
      userId: 'user_1',
      phone: '+15551234567',
    })

    expect(result).toEqual({
      ok: false,
      response: blockedResponse,
    })

    expect(mockEnforceRateLimit).toHaveBeenCalledTimes(2)
    expect(mockEnforceRateLimit).toHaveBeenNthCalledWith(2, {
      bucket: 'auth:sms-phone-hour',
      identity: {
        kind: 'phone',
        id: '+15551234567',
      },
    })
  })

  it('returns blocked response when the daily phone SMS limit blocks', async () => {
    const blockedResponse = makeRateLimitResponse()

    mockEnforceRateLimit
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(blockedResponse)

    const result = await enforceVerificationSendThrottle({
      userId: 'user_1',
      phone: '+15551234567',
    })

    expect(result).toEqual({
      ok: false,
      response: blockedResponse,
    })

    expect(mockEnforceRateLimit).toHaveBeenCalledTimes(3)
    expect(mockEnforceRateLimit).toHaveBeenNthCalledWith(3, {
      bucket: 'auth:sms-phone-day',
      identity: {
        kind: 'phone',
        id: '+15551234567',
      },
    })
  })

  it('skips phone SMS buckets when no phone is provided', async () => {
    const result = await enforceVerificationSendThrottle({
      userId: 'user_1',
      phone: null,
    })

    expect(result).toEqual({ ok: true })

    expect(mockEnforceRateLimit).toHaveBeenCalledTimes(1)
    expect(mockEnforceRateLimit).toHaveBeenCalledWith({
      bucket: 'auth:email:send',
      identity: {
        kind: 'ip',
        id: '198.51.100.10',
      },
    })

    expect(mockPhoneRateLimitIdentity).not.toHaveBeenCalled()
  })

  it('trims phone before building phone rate-limit identity', async () => {
    const result = await enforceVerificationSendThrottle({
      userId: 'user_1',
      phone: '  +15551234567  ',
    })

    expect(result).toEqual({ ok: true })

    expect(mockPhoneRateLimitIdentity).toHaveBeenCalledWith('+15551234567')
  })

  it('returns null when the phone verification attempt limiter allows the request', async () => {
    const result = await enforceVerificationVerifyThrottle({
      request: makeRequest('/api/v1/auth/phone/verify'),
      scope: 'phone-verify',
      subjectKey: 'user_1',
    })

    expect(result).toBeNull()

    expect(mockGetTrustedClientIpFromRequest).toHaveBeenCalledWith(
      expect.any(Request),
    )

    expect(mockTokenRateLimitIdentity).toHaveBeenCalledWith(
      'phone-verify:user_1:ip:198.51.100.10',
    )

    expect(mockEnforceRateLimit).toHaveBeenCalledWith({
      bucket: 'auth:phone:verify',
      identity: {
        kind: 'token',
        id: 'phone-verify:user_1:ip:198.51.100.10',
      },
    })
  })

  it('returns null when the email verification attempt limiter allows the request', async () => {
    mockGetTrustedClientIpFromRequest.mockReturnValue('198.51.100.20')

    const result = await enforceVerificationVerifyThrottle({
      request: makeRequest('/api/v1/auth/email/verify', '198.51.100.20'),
      scope: 'email-verify',
      subjectKey: 'evt_1',
    })

    expect(result).toBeNull()

    expect(mockTokenRateLimitIdentity).toHaveBeenCalledWith(
      'email-verify:evt_1:ip:198.51.100.20',
    )

    expect(mockEnforceRateLimit).toHaveBeenCalledWith({
      bucket: 'auth:email:verify',
      identity: {
        kind: 'token',
        id: 'email-verify:evt_1:ip:198.51.100.20',
      },
    })
  })

  it('uses unknown IP when verification request has no trusted IP', async () => {
    mockGetTrustedClientIpFromRequest.mockReturnValue(null)

    const result = await enforceVerificationVerifyThrottle({
      request: makeRequest('/api/v1/auth/phone/verify'),
      scope: 'phone-verify',
      subjectKey: 'user_1',
    })

    expect(result).toBeNull()

    expect(mockTokenRateLimitIdentity).toHaveBeenCalledWith(
      'phone-verify:user_1:ip:unknown',
    )

    expect(mockEnforceRateLimit).toHaveBeenCalledWith({
      bucket: 'auth:phone:verify',
      identity: {
        kind: 'token',
        id: 'phone-verify:user_1:ip:unknown',
      },
    })
  })

  it('returns the canonical blocked response when verification attempt limiter blocks', async () => {
    const blockedResponse = makeRateLimitResponse()
    mockEnforceRateLimit.mockResolvedValue(blockedResponse)

    const result = await enforceVerificationVerifyThrottle({
      request: makeRequest('/api/v1/auth/phone/verify'),
      scope: 'phone-verify',
      subjectKey: 'user_1',
    })

    expect(result).toBe(blockedResponse)
  })

  it('throws when verification subjectKey is blank', async () => {
    await expect(
      enforceVerificationVerifyThrottle({
        request: makeRequest('/api/v1/auth/phone/verify'),
        scope: 'phone-verify',
        subjectKey: '   ',
      }),
    ).rejects.toThrow(
      'enforceVerificationVerifyThrottle requires a non-empty subjectKey.',
    )

    expect(mockEnforceRateLimit).not.toHaveBeenCalled()
  })
})