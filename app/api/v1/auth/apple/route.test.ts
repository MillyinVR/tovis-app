import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/app/api/_utils/rateLimit', () => ({
  rateLimitIdentity: vi.fn(async () => ({})),
  enforceRateLimit: vi.fn(async () => null),
}))
vi.mock('@/lib/auth/appleIdentity', () => ({
  verifyAppleIdentityToken: vi.fn(),
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
import { verifyAppleIdentityToken } from '@/lib/auth/appleIdentity'
import { resolveSocialAccount } from '@/lib/auth/resolveSocialAccount'
import { createSocialSignupTicket } from '@/lib/auth/socialSignupTicket'

const mockVerify = vi.mocked(verifyAppleIdentityToken)
const mockResolve = vi.mocked(resolveSocialAccount)
const mockCreateTicket = vi.mocked(createSocialSignupTicket)

function req(body: unknown): Request {
  return new Request('https://app.tovis.app/api/v1/auth/apple', {
    method: 'POST',
    headers: { 'content-type': 'application/json', host: 'app.tovis.app' },
    body: JSON.stringify(body),
  })
}

// Apple's identity token carries no name — only sub/email.
const VERIFIED = { sub: 's', email: 'a@b.com', emailVerified: true }

const TICKET = {
  id: 't1',
  token: 't1.secret',
  expiresAt: new Date('2026-01-01T00:15:00.000Z'),
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('POST /api/v1/auth/apple', () => {
  it('returns 400 when the identity token is missing', async () => {
    const res = await POST(req({}))
    expect(res.status).toBe(400)
    expect((await res.json()).code).toBe('MISSING_TOKEN')
  })

  it('returns 401 when the Apple token cannot be verified', async () => {
    mockVerify.mockResolvedValue(null)
    const res = await POST(req({ identityToken: 'bad' }))
    expect(res.status).toBe(401)
    expect((await res.json()).code).toBe('INVALID_APPLE_TOKEN')
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
    expect(json.status).toBe('SIGNED_IN')
    expect(json.user).toEqual({ id: 'u1', email: 'a@b.com', role: 'CLIENT' })
    expect(typeof json.token).toBe('string')
    expect(json.isFullyVerified).toBe(false)

    expect(mockResolve).toHaveBeenCalledWith({
      provider: 'APPLE',
      subject: 's',
      email: 'a@b.com',
    })
    expect(mockCreateTicket).not.toHaveBeenCalled()
  })

  it('returns a signup ticket — and creates NO account — for an identity with no account', async () => {
    mockVerify.mockResolvedValue(VERIFIED)
    mockResolve.mockResolvedValue({ outcome: 'NEEDS_SIGNUP' })
    mockCreateTicket.mockResolvedValue(TICKET)

    const res = await POST(
      req({ identityToken: 'tok', firstName: 'Ada', lastName: 'Lovelace' }),
    )

    expect(res.status).toBe(200)

    const json = await res.json()
    expect(json.status).toBe('SIGNUP_REQUIRED')
    expect(json.signupTicket).toBe('t1.secret')
    expect(json.token).toBeUndefined()
    expect(json.user).toBeUndefined()

    // 🔴 Apple's name comes from the BODY, not the token — Apple releases it
    // exactly once, in the first authorization response, so the client has to
    // forward it. Capturing it on the ticket at issuance is the only chance to
    // keep it: a later sign-in for the same subject gets nothing.
    expect(mockCreateTicket).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: 'APPLE',
        subject: 's',
        email: 'a@b.com',
        firstName: 'Ada',
        lastName: 'Lovelace',
        tenantId: 'tovis-root',
      }),
    )
  })

  it('carries null names when Apple withholds them and the client sends none', async () => {
    mockVerify.mockResolvedValue(VERIFIED)
    mockResolve.mockResolvedValue({ outcome: 'NEEDS_SIGNUP' })
    mockCreateTicket.mockResolvedValue(TICKET)

    await POST(req({ identityToken: 'tok' }))

    // The repeat-sign-in case, which is the common one. The completion form
    // asks for a name rather than inventing one.
    expect(mockCreateTicket).toHaveBeenCalledWith(
      expect.objectContaining({ firstName: null, lastName: null }),
    )
  })
})
