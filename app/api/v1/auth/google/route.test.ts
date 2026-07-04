import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/app/api/_utils/rateLimit', () => ({
  rateLimitIdentity: vi.fn(async () => ({})),
  enforceRateLimit: vi.fn(async () => null),
}))
vi.mock('@/lib/auth/googleIdentity', () => ({
  verifyGoogleIdentityToken: vi.fn(),
}))
vi.mock('@/lib/auth/findOrCreateGoogleUser', () => ({
  findOrCreateGoogleUser: vi.fn(),
}))
vi.mock('@/lib/tenant/requestContext', () => ({
  resolveTenantContextForRequest: vi.fn(async () => ({ tenantId: 'tovis-root' })),
}))
vi.mock('@/lib/legal', () => ({
  getCurrentTosVersion: vi.fn(() => 'v1'),
}))
vi.mock('@/app/api/_utils/auth/sessionCookie', () => ({
  setSessionCookie: vi.fn(),
}))
vi.mock('@/lib/observability/authEvents', () => ({
  captureAuthException: vi.fn(),
}))

import { POST } from './route'
import { verifyGoogleIdentityToken } from '@/lib/auth/googleIdentity'
import { findOrCreateGoogleUser } from '@/lib/auth/findOrCreateGoogleUser'

const mockVerify = vi.mocked(verifyGoogleIdentityToken)
const mockFindOrCreate = vi.mocked(findOrCreateGoogleUser)

function req(body: unknown): Request {
  return new Request('https://app.tovis.app/api/v1/auth/google', {
    method: 'POST',
    headers: { 'content-type': 'application/json', host: 'app.tovis.app' },
    body: JSON.stringify(body),
  })
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
  })

  it('returns 409 when an unverified same-email account exists', async () => {
    mockVerify.mockResolvedValue({
      sub: 's',
      email: 'a@b.com',
      emailVerified: true,
      firstName: null,
      lastName: null,
    })
    mockFindOrCreate.mockResolvedValue({
      ok: false,
      code: 'ACCOUNT_EXISTS_UNVERIFIED',
    })
    const res = await POST(req({ identityToken: 'tok' }))
    expect(res.status).toBe(409)
    expect((await res.json()).code).toBe('ACCOUNT_EXISTS_UNVERIFIED')
  })

  it('returns 200 with the session payload on success', async () => {
    mockVerify.mockResolvedValue({
      sub: 's',
      email: 'a@b.com',
      emailVerified: true,
      firstName: 'Ada',
      lastName: 'Lovelace',
    })
    mockFindOrCreate.mockResolvedValue({
      ok: true,
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
    expect(json.user).toEqual({ id: 'u1', email: 'a@b.com', role: 'CLIENT' })
    expect(typeof json.token).toBe('string')
    expect(json.isEmailVerified).toBe(true)
    expect(json.isPhoneVerified).toBe(false)
    // Phone not verified yet → a VERIFICATION session, not fully verified.
    expect(json.isFullyVerified).toBe(false)

    expect(mockFindOrCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        googleUserId: 's',
        email: 'a@b.com',
        firstName: 'Ada',
        lastName: 'Lovelace',
        tenantId: 'tovis-root',
        tosVersion: 'v1',
      }),
    )
  })
})
