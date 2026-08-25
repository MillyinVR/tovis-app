import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/app/api/_utils/rateLimit', () => ({
  rateLimitIdentity: vi.fn(async () => ({})),
  enforceRateLimit: vi.fn(async () => null),
}))
vi.mock('@/lib/auth/googleIdentity', () => ({
  verifyGoogleIdentityToken: vi.fn(),
}))
vi.mock('@/lib/auth/resolveSocialAccount', () => ({
  resolveSocialAccount: vi.fn(),
}))
vi.mock('@/lib/auth/socialSignupTicket', () => ({
  createSocialSignupTicket: vi.fn(),
}))
vi.mock('@/lib/tenant/requestContext', () => ({
  resolveTenantContextForRequest: vi.fn(async () => ({
    tenantId: 'tovis-root',
  })),
}))
vi.mock('@/app/api/_utils/auth/sessionCookie', () => ({
  setSessionCookie: vi.fn(),
}))
vi.mock('@/lib/observability/authEvents', () => ({
  captureAuthException: vi.fn(),
}))

import { POST } from './route'
import { verifyGoogleIdentityToken } from '@/lib/auth/googleIdentity'
import { resolveSocialAccount } from '@/lib/auth/resolveSocialAccount'
import { createSocialSignupTicket } from '@/lib/auth/socialSignupTicket'

const mockVerify = vi.mocked(verifyGoogleIdentityToken)
const mockResolve = vi.mocked(resolveSocialAccount)
const mockCreateTicket = vi.mocked(createSocialSignupTicket)

function req(body: unknown): Request {
  return new Request('https://app.tovis.app/api/v1/auth/google', {
    method: 'POST',
    headers: { 'content-type': 'application/json', host: 'app.tovis.app' },
    body: JSON.stringify(body),
  })
}

const VERIFIED = {
  sub: 's',
  email: 'a@b.com',
  emailVerified: true,
  firstName: 'Ada',
  lastName: 'Lovelace',
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('POST /api/v1/auth/google', () => {
  it('returns 400 when the identity token is missing', async () => {
    const res = await POST(req({}))
    expect(res.status).toBe(400)
    expect((await res.json()).code).toBe('MISSING_TOKEN')
  })

  it('returns 401 when the Google token cannot be verified', async () => {
    mockVerify.mockResolvedValue(null)
    const res = await POST(req({ identityToken: 'bad' }))
    expect(res.status).toBe(401)
    expect((await res.json()).code).toBe('INVALID_GOOGLE_TOKEN')
    // Nothing is resolved, and above all nothing is created, on a bad token.
    expect(mockResolve).not.toHaveBeenCalled()
    expect(mockCreateTicket).not.toHaveBeenCalled()
  })

  it('returns 409 when an unverified same-email account exists', async () => {
    mockVerify.mockResolvedValue(VERIFIED)
    mockResolve.mockResolvedValue({ outcome: 'ACCOUNT_EXISTS_UNVERIFIED' })

    const res = await POST(req({ identityToken: 'tok' }))
    expect(res.status).toBe(409)
    expect((await res.json()).code).toBe('ACCOUNT_EXISTS_UNVERIFIED')
    expect(mockCreateTicket).not.toHaveBeenCalled()
  })

  it('returns 200 with the session payload when the identity already has an account', async () => {
    mockVerify.mockResolvedValue(VERIFIED)
    mockResolve.mockResolvedValue({
      outcome: 'SIGNED_IN',
      user: {
        id: 'u1',
        email: 'a@b.com',
        role: 'CLIENT',
        authVersion: 1,
        phoneVerifiedAt: null,
        emailVerifiedAt: new Date(),
      },
    })

    const res = await POST(req({ identityToken: 'tok' }))
    expect(res.status).toBe(200)

    const json = await res.json()
    expect(json.ok).toBe(true)
    expect(json.status).toBe('SIGNED_IN')
    expect(json.user).toEqual({ id: 'u1', email: 'a@b.com', role: 'CLIENT' })
    expect(typeof json.token).toBe('string')
    expect(json.isEmailVerified).toBe(true)
    expect(json.isPhoneVerified).toBe(false)
    // Phone not verified yet → a VERIFICATION session, not fully verified.
    expect(json.isFullyVerified).toBe(false)

    expect(mockResolve).toHaveBeenCalledWith({
      provider: 'GOOGLE',
      subject: 's',
      email: 'a@b.com',
    })
    // A sign-in creates nothing.
    expect(mockCreateTicket).not.toHaveBeenCalled()
  })

  it('returns a signup ticket — and creates NO account — for an identity with no account', async () => {
    mockVerify.mockResolvedValue(VERIFIED)
    mockResolve.mockResolvedValue({ outcome: 'NEEDS_SIGNUP' })
    mockCreateTicket.mockResolvedValue({
      id: 't1',
      token: 't1.secret',
      expiresAt: new Date('2026-01-01T00:15:00.000Z'),
    })

    const res = await POST(req({ identityToken: 'tok' }))

    // 200, not 201: the point is that nothing was created.
    expect(res.status).toBe(200)

    const json = await res.json()
    expect(json.status).toBe('SIGNUP_REQUIRED')
    expect(json.signupTicket).toBe('t1.secret')
    expect(json.ticketExpiresAt).toBe('2026-01-01T00:15:00.000Z')
    expect(json.prefill).toEqual({
      email: 'a@b.com',
      firstName: 'Ada',
      lastName: 'Lovelace',
    })
    // No session is minted for someone who has no account.
    expect(json.token).toBeUndefined()
    expect(json.user).toBeUndefined()

    expect(mockCreateTicket).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: 'GOOGLE',
        subject: 's',
        email: 'a@b.com',
        firstName: 'Ada',
        lastName: 'Lovelace',
        tenantId: 'tovis-root',
      }),
    )
  })

  it('takes the name from the verified TOKEN and ignores a name in the body', async () => {
    mockVerify.mockResolvedValue(VERIFIED)
    mockResolve.mockResolvedValue({ outcome: 'NEEDS_SIGNUP' })
    mockCreateTicket.mockResolvedValue({
      id: 't1',
      token: 't1.secret',
      expiresAt: new Date('2026-01-01T00:15:00.000Z'),
    })

    await POST(
      req({ identityToken: 'tok', firstName: 'Mallory', lastName: 'Spoofer' }),
    )

    // Google puts given_name/family_name in the signed id-token, so the body's
    // claim about who this is carries no weight at all.
    expect(mockCreateTicket).toHaveBeenCalledWith(
      expect.objectContaining({ firstName: 'Ada', lastName: 'Lovelace' }),
    )
  })
})
