// app/api/v1/auth/email-sign-in/request/route.test.ts
//
// The contract under test is ENUMERATION SAFETY: this endpoint is reachable by
// anyone, and it must answer identically whether or not an address has an
// account. Every test below is really the same assertion — "the response is
// byte-identical" — driven down a different branch.
//
// The rate-limit tests pin the TWO-DIMENSIONAL shape (Tori's decision 1): a
// loose per-IP cap plus a tight IP+email composite. The composite is what stops
// a remote attacker exhausting one victim's allowance to lock them out, so the
// test asserts the composite is keyed on the EMAIL, not just that two limiters
// were called.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  CONTACT_LOOKUP_HMAC_KEY_VERSION,
  clearContactLookupHmacKeyringCacheForTests,
  emailLookupHashV2,
} from '@/lib/security/crypto/hashLookup'

const mockRateLimitIdentity = vi.hoisted(() => vi.fn())
const mockEnforceRateLimit = vi.hoisted(() => vi.fn())

const mockGetAppUrl = vi.hoisted(() => vi.fn())
const mockGetIp = vi.hoisted(() => vi.fn())
const mockIssueAndSend = vi.hoisted(() => vi.fn())

const mockLogAuthEvent = vi.hoisted(() => vi.fn())
const mockCaptureAuthException = vi.hoisted(() => vi.fn())

const mockPrisma = vi.hoisted(() => ({
  user: {
    findMany: vi.fn(),
  },
}))

vi.mock('@/lib/tenant/requestContext', () => ({
  resolveTenantContextForRequest: vi.fn(async () => ({
    isRoot: true,
    tenantId: 'tenant_root',
    slug: 'tovis-root',
  })),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: mockPrisma,
}))

vi.mock('@/lib/auth/emailSignIn', () => ({
  getEmailSignInAppUrlFromRequest: mockGetAppUrl,
  getEmailSignInRequestIp: mockGetIp,
  issueAndSendEmailSignIn: mockIssueAndSend,
}))

vi.mock('@/lib/observability/authEvents', () => ({
  logAuthEvent: mockLogAuthEvent,
  captureAuthException: mockCaptureAuthException,
}))

vi.mock('@/app/api/_utils', () => ({
  jsonOk(payload: Record<string, unknown>, status = 200) {
    return new Response(JSON.stringify({ ok: true, ...payload }), {
      status,
      headers: { 'Content-Type': 'application/json' },
    })
  },

  normalizeEmail(value: unknown) {
    return typeof value === 'string' && value.trim()
      ? value.trim().toLowerCase()
      : null
  },

  enforceRateLimit: mockEnforceRateLimit,
  rateLimitIdentity: mockRateLimitIdentity,
  emailRateLimitKeySuffix: (email: string) => `emailhash:${email}`,
}))

import { POST } from './route'

const TEST_HMAC_KEY = Buffer.alloc(32, 7).toString('base64')

type TestUser = { id: string; email: string | null }

function makeRequest(body: Record<string, unknown>) {
  return new Request('http://localhost/api/v1/auth/email-sign-in/request', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', host: 'localhost:3000' },
    body: JSON.stringify(body),
  })
}

function expectedEmailLookupV2Data(email: string) {
  const hmac = emailLookupHashV2(email)
  expect(hmac).not.toBeNull()
  return {
    emailHashV2: hmac?.hash ?? null,
    emailHashKeyVersion: hmac?.keyVersion ?? null,
  }
}

function mockUserLookupByWhere(users: TestUser[]) {
  mockPrisma.user.findMany.mockImplementation(
    async (args: { where?: { OR?: Record<string, unknown>[] } }) => {
      const conditions = args.where?.OR ?? []
      return users
        .filter((user) => {
          if (!user.email?.trim()) return false
          const lookup = expectedEmailLookupV2Data(user.email)
          return conditions.some(
            (condition) =>
              condition.emailHashV2 === lookup.emailHashV2 &&
              condition.emailHashKeyVersion === lookup.emailHashKeyVersion,
          )
        })
        .slice(0, 2)
    },
  )
}

/** The one response every path must produce. */
async function expectGenericOk(res: Response) {
  expect(res.status).toBe(200)
  expect(await res.json()).toEqual({ ok: true })
}

describe('app/api/v1/auth/email-sign-in/request/route', () => {
  beforeEach(() => {
    process.env.PII_LOOKUP_HMAC_KEYS_JSON = JSON.stringify({
      [CONTACT_LOOKUP_HMAC_KEY_VERSION]: TEST_HMAC_KEY,
    })
    clearContactLookupHmacKeyringCacheForTests()

    mockRateLimitIdentity.mockResolvedValue({ kind: 'ip', id: '203.0.113.9' })
    mockEnforceRateLimit.mockResolvedValue(null)
    mockGetAppUrl.mockReturnValue('https://app.example.com')
    mockGetIp.mockReturnValue('203.0.113.9')
    mockIssueAndSend.mockResolvedValue({ id: 'tok_1', expiresAt: new Date() })
    mockPrisma.user.findMany.mockReset()
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('sends the email when the address has an account', async () => {
    mockUserLookupByWhere([{ id: 'user_1', email: 'person@example.com' }])

    const res = await POST(makeRequest({ email: 'Person@Example.com ' }))

    await expectGenericOk(res)
    expect(mockIssueAndSend).toHaveBeenCalledTimes(1)
    expect(mockIssueAndSend.mock.calls[0]?.[0]).toMatchObject({
      userId: 'user_1',
      email: 'person@example.com',
      appUrl: 'https://app.example.com',
    })
  })

  it('answers IDENTICALLY for an address with no account, and sends nothing', async () => {
    mockUserLookupByWhere([])

    const withAccountRes = await POST(makeRequest({ email: 'a@example.com' }))
    // Reset so the second call is judged on its own.
    vi.clearAllMocks()
    mockRateLimitIdentity.mockResolvedValue({ kind: 'ip', id: '203.0.113.9' })
    mockEnforceRateLimit.mockResolvedValue(null)
    mockUserLookupByWhere([])

    const noAccountRes = await POST(makeRequest({ email: 'nobody@example.com' }))

    expect(noAccountRes.status).toBe(withAccountRes.status)
    expect(await noAccountRes.json()).toEqual(await withAccountRes.json())
    expect(mockIssueAndSend).not.toHaveBeenCalled()
  })

  it('answers ok for a missing or malformed email without touching the database', async () => {
    for (const body of [{}, { email: '' }, { email: '   ' }, { email: 42 }]) {
      const res = await POST(makeRequest(body))
      await expectGenericOk(res)
    }
    expect(mockPrisma.user.findMany).not.toHaveBeenCalled()
    expect(mockIssueAndSend).not.toHaveBeenCalled()
  })

  it('fails closed — and still ok — when the address matches more than one user', async () => {
    // Two rows for one address is an ambiguous identity. Guessing which one to
    // sign in is worse than doing nothing.
    mockUserLookupByWhere([
      { id: 'user_1', email: 'dupe@example.com' },
      { id: 'user_2', email: 'dupe@example.com' },
    ])

    const res = await POST(makeRequest({ email: 'dupe@example.com' }))

    await expectGenericOk(res)
    expect(mockIssueAndSend).not.toHaveBeenCalled()
  })

  it('answers ok when the app URL cannot be resolved, and logs it', async () => {
    mockUserLookupByWhere([{ id: 'user_1', email: 'person@example.com' }])
    mockGetAppUrl.mockReturnValue(null)

    const res = await POST(makeRequest({ email: 'person@example.com' }))

    await expectGenericOk(res)
    expect(mockIssueAndSend).not.toHaveBeenCalled()
    expect(mockLogAuthEvent).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'APP_URL_MISSING' }),
    )
  })

  it('answers ok when the mailer throws — a 500 here would be an oracle too', async () => {
    mockUserLookupByWhere([{ id: 'user_1', email: 'person@example.com' }])
    mockIssueAndSend.mockRejectedValue(new Error('postmark exploded'))

    const res = await POST(makeRequest({ email: 'person@example.com' }))

    await expectGenericOk(res)
    expect(mockCaptureAuthException).toHaveBeenCalledTimes(1)
  })

  it('still answers ok when the exception REPORTER itself throws', async () => {
    // Found by driving the route for real: captureAuthException hashes the
    // email through the contact-lookup HMAC keyring and throws if that keyring
    // is missing or malformed — which made the catch block throw and the route
    // answer 500 instead of ok. The response must not depend on telemetry
    // succeeding.
    mockUserLookupByWhere([{ id: 'user_1', email: 'person@example.com' }])
    mockIssueAndSend.mockRejectedValue(new Error('postmark exploded'))
    mockCaptureAuthException.mockImplementation(() => {
      throw new Error('HMAC keyring is not configured')
    })

    const res = await POST(makeRequest({ email: 'person@example.com' }))

    await expectGenericOk(res)
  })

  it('applies the loose per-IP cap BEFORE reading the body', async () => {
    mockEnforceRateLimit.mockResolvedValueOnce(
      new Response('rate limited', { status: 429 }),
    )

    const res = await POST(makeRequest({ email: 'person@example.com' }))

    expect(res.status).toBe(429)
    expect(mockPrisma.user.findMany).not.toHaveBeenCalled()
    expect(mockEnforceRateLimit).toHaveBeenCalledTimes(1)
    expect(mockEnforceRateLimit.mock.calls[0]?.[0]).toMatchObject({
      bucket: 'auth:email-sign-in:request',
    })
  })

  it('applies a SECOND, email-keyed cap — the targeted-lockout guard', async () => {
    mockUserLookupByWhere([{ id: 'user_1', email: 'person@example.com' }])

    await POST(makeRequest({ email: 'person@example.com' }))

    expect(mockEnforceRateLimit).toHaveBeenCalledTimes(2)
    // Its own bucket, never auth:email:send — sharing that one would let
    // sign-in traffic starve a new signup's verification email.
    expect(mockEnforceRateLimit.mock.calls[1]?.[0]).toMatchObject({
      bucket: 'auth:email-sign-in:request:identity',
      keySuffix: 'emailhash:person@example.com',
    })
  })

  it('refuses on the composite cap before looking the user up', async () => {
    mockUserLookupByWhere([{ id: 'user_1', email: 'person@example.com' }])
    mockEnforceRateLimit
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(new Response('rate limited', { status: 429 }))

    const res = await POST(makeRequest({ email: 'person@example.com' }))

    expect(res.status).toBe(429)
    expect(mockPrisma.user.findMany).not.toHaveBeenCalled()
    expect(mockIssueAndSend).not.toHaveBeenCalled()
  })
})
