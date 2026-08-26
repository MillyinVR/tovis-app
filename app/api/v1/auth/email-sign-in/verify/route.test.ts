// app/api/v1/auth/email-sign-in/verify/route.test.ts
//
// Two contracts under test.
//
// 1. UNIFORM REJECTION. Every failure mode — malformed, unknown, wrong secret,
//    wrong code, expired, already used, wrong purpose, attempts exhausted —
//    must produce one identical response. If "that code was wrong" can be told
//    apart from "that address has no account", the code path becomes the
//    account oracle the request route works so hard not to be.
//
// 2. POST-ONLY. There must be no GET handler. A single-use token consumed on
//    GET is burned by a mail scanner or a link-preview bot before the human
//    clicks, and the person is told their link is invalid. This is asserted on
//    the module's exports, not on a comment.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mockRateLimitIdentity = vi.hoisted(() => vi.fn())
const mockEnforceRateLimit = vi.hoisted(() => vi.fn())

const mockConsumeLink = vi.hoisted(() => vi.fn())
const mockConsumeCode = vi.hoisted(() => vi.fn())
const mockMarkUserEmailVerified = vi.hoisted(() => vi.fn())
const mockCreateActiveToken = vi.hoisted(() => vi.fn())
const mockCreateVerificationToken = vi.hoisted(() => vi.fn())
const mockSetSessionCookie = vi.hoisted(() => vi.fn())

const mockLogAuthEvent = vi.hoisted(() => vi.fn())
const mockCaptureAuthException = vi.hoisted(() => vi.fn())

const mockPrisma = vi.hoisted(() => ({
  user: { findUniqueOrThrow: vi.fn() },
  $transaction: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({ prisma: mockPrisma }))

vi.mock('@/lib/auth/emailSignIn', () => ({
  consumeEmailSignInLinkToken: mockConsumeLink,
  consumeEmailSignInCode: mockConsumeCode,
}))

vi.mock('@/lib/auth/contactVerification', () => ({
  markUserEmailVerified: mockMarkUserEmailVerified,
}))

vi.mock('@/lib/auth', () => ({
  createActiveToken: mockCreateActiveToken,
  createVerificationToken: mockCreateVerificationToken,
}))

vi.mock('@/app/api/_utils/auth/sessionCookie', () => ({
  setSessionCookie: mockSetSessionCookie,
}))

vi.mock('@/lib/observability/authEvents', () => ({
  logAuthEvent: mockLogAuthEvent,
  captureAuthException: mockCaptureAuthException,
}))

vi.mock('@/app/api/_utils', () => ({
  jsonOk(payload: Record<string, unknown>, status = 200) {
    return new Response(JSON.stringify(payload), {
      status,
      headers: { 'Content-Type': 'application/json' },
    })
  },
  jsonFail(status: number, error: string, extra?: Record<string, unknown>) {
    return new Response(JSON.stringify({ ok: false, error, ...(extra ?? {}) }), {
      status,
      headers: { 'Content-Type': 'application/json' },
    })
  },
  pickString(value: unknown) {
    return typeof value === 'string' && value.trim() ? value : undefined
  },
  normalizeEmail(value: unknown) {
    return typeof value === 'string' && value.trim()
      ? value.trim().toLowerCase()
      : null
  },
  enforceRateLimit: mockEnforceRateLimit,
  rateLimitIdentity: mockRateLimitIdentity,
}))

import * as routeModule from './route'

const { POST } = routeModule

function makeRequest(body: Record<string, unknown>) {
  return new Request('http://localhost/api/v1/auth/email-sign-in/verify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

const USER = {
  id: 'user_1',
  email: 'person@example.com',
  role: 'CLIENT',
  authVersion: 3,
  phoneVerifiedAt: new Date('2026-01-01T00:00:00Z'),
  emailVerifiedAt: new Date('2026-01-01T00:00:00Z'),
}

describe('app/api/v1/auth/email-sign-in/verify/route', () => {
  beforeEach(() => {
    mockRateLimitIdentity.mockResolvedValue({ kind: 'ip', id: '203.0.113.9' })
    mockEnforceRateLimit.mockResolvedValue(null)
    mockCreateActiveToken.mockReturnValue('active-token')
    mockCreateVerificationToken.mockReturnValue('verification-token')
    mockMarkUserEmailVerified.mockResolvedValue(undefined)
    mockPrisma.user.findUniqueOrThrow.mockResolvedValue(USER)
    mockPrisma.$transaction.mockImplementation(
      async (fn: (tx: unknown) => Promise<unknown>) => fn(mockPrisma),
    )
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('🔴 exports NO GET handler — a scanner must not be able to burn the token', () => {
    expect(routeModule).not.toHaveProperty('GET')
    expect(typeof POST).toBe('function')
  })

  it('signs in with a link token and sets the session cookie', async () => {
    mockConsumeLink.mockResolvedValue({
      ok: true,
      tokenId: 'tok_1',
      userId: 'user_1',
    })

    const res = await POST(makeRequest({ token: 'tok_1.fixture-value' }))

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toMatchObject({
      user: { id: 'user_1', role: 'CLIENT' },
      token: 'active-token',
      isFullyVerified: true,
    })
    expect(mockSetSessionCookie).toHaveBeenCalledTimes(1)
    expect(mockConsumeCode).not.toHaveBeenCalled()
  })

  it('signs in with an email + 6-digit code', async () => {
    mockConsumeCode.mockResolvedValue({
      ok: true,
      tokenId: 'tok_1',
      userId: 'user_1',
    })

    const res = await POST(
      makeRequest({ email: 'Person@Example.com', code: '123456' }),
    )

    expect(res.status).toBe(200)
    expect(mockConsumeCode).toHaveBeenCalledWith({
      email: 'person@example.com',
      code: '123456',
    })
    expect(mockConsumeLink).not.toHaveBeenCalled()
  })

  it('marks the address verified — redeeming proves control of the mailbox', async () => {
    mockConsumeLink.mockResolvedValue({
      ok: true,
      tokenId: 'tok_1',
      userId: 'user_1',
    })

    await POST(makeRequest({ token: 'tok_1.fixture-value' }))

    expect(mockMarkUserEmailVerified).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ userId: 'user_1' }),
    )
  })

  it('mints a VERIFICATION-scoped session when the phone is still unverified', async () => {
    mockConsumeLink.mockResolvedValue({
      ok: true,
      tokenId: 'tok_1',
      userId: 'user_1',
    })
    mockPrisma.user.findUniqueOrThrow.mockResolvedValue({
      ...USER,
      phoneVerifiedAt: null,
    })

    const res = await POST(makeRequest({ token: 'tok_1.fixture-value' }))
    const body = await res.json()

    expect(body.token).toBe('verification-token')
    expect(body.isFullyVerified).toBe(false)
    expect(mockCreateActiveToken).not.toHaveBeenCalled()
  })

  it('answers IDENTICALLY for every rejection reason', async () => {
    const reasons = [
      'malformed',
      'not_found',
      'secret_mismatch',
      'expired',
      'already_used',
      'wrong_purpose',
      'too_many_attempts',
    ] as const

    const seen = new Set<string>()

    for (const reason of reasons) {
      mockConsumeLink.mockResolvedValue({ ok: false, reason, tokenId: null })
      const res = await POST(makeRequest({ token: 'tok_1.fixture-value' }))
      seen.add(`${res.status}:${await res.text()}`)
    }

    // One distinct response across all seven reasons, or the endpoint leaks
    // which one it was.
    expect(seen.size).toBe(1)
    expect([...seen][0]).toContain('SIGN_IN_REJECTED')
    expect(mockSetSessionCookie).not.toHaveBeenCalled()
  })

  it('rejects a wrong CODE the same way it rejects an unknown ADDRESS', async () => {
    mockConsumeCode.mockResolvedValueOnce({
      ok: false,
      reason: 'secret_mismatch',
      tokenId: 'tok_1',
    })
    const wrongCode = await POST(
      makeRequest({ email: 'person@example.com', code: '000000' }),
    )

    mockConsumeCode.mockResolvedValueOnce({
      ok: false,
      reason: 'not_found',
      tokenId: null,
    })
    const unknownAddress = await POST(
      makeRequest({ email: 'nobody@example.com', code: '000000' }),
    )

    expect(unknownAddress.status).toBe(wrongCode.status)
    expect(await unknownAddress.text()).toBe(await wrongCode.text())
  })

  it('asks for a credential when neither a token nor an email+code is given', async () => {
    const res = await POST(makeRequest({}))

    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({ code: 'MISSING_FIELDS' })
    expect(mockConsumeLink).not.toHaveBeenCalled()
    expect(mockConsumeCode).not.toHaveBeenCalled()
  })

  it('rate-limits before consuming anything', async () => {
    mockEnforceRateLimit.mockResolvedValue(
      new Response('rate limited', { status: 429 }),
    )

    const res = await POST(makeRequest({ token: 'tok_1.fixture-value' }))

    expect(res.status).toBe(429)
    expect(mockConsumeLink).not.toHaveBeenCalled()
    expect(mockEnforceRateLimit.mock.calls[0]?.[0]).toMatchObject({
      bucket: 'auth:email-sign-in:verify',
    })
  })

  it('does not mint a session when the transaction throws', async () => {
    mockConsumeLink.mockResolvedValue({
      ok: true,
      tokenId: 'tok_1',
      userId: 'user_1',
    })
    mockPrisma.$transaction.mockRejectedValue(new Error('db down'))

    const res = await POST(makeRequest({ token: 'tok_1.fixture-value' }))

    expect(res.status).toBe(500)
    expect(mockSetSessionCookie).not.toHaveBeenCalled()
    expect(mockCaptureAuthException).toHaveBeenCalledTimes(1)
  })
})
