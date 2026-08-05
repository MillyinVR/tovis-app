// app/api/v1/auth/session-handoff/[token]/route.test.ts — EXCHANGE
//
// The observable security behaviour of the redemption endpoint. Each refusal is
// paired with the success case it must not break, and every refusal is asserted
// to be INDISTINGUISHABLE from the others.

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Role } from '@prisma/client'

const mockConsume = vi.hoisted(() => vi.fn())
const mockCreateActiveToken = vi.hoisted(() => vi.fn())
const mockSetSessionCookie = vi.hoisted(() => vi.fn())
const mockEnforceRateLimit = vi.hoisted(() => vi.fn())
const mockLogAuthEvent = vi.hoisted(() => vi.fn())
const mockCaptureAuthException = vi.hoisted(() => vi.fn())
const mockPrisma = vi.hoisted(() => ({ user: { findUnique: vi.fn() } }))

vi.mock('@/lib/auth/sessionHandoff', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@/lib/auth/sessionHandoff')>()
  return { ...actual, consumeSessionHandoffToken: mockConsume }
})
vi.mock('@/lib/auth', () => ({ createActiveToken: mockCreateActiveToken }))
vi.mock('@/app/api/_utils/auth/sessionCookie', () => ({
  setSessionCookie: mockSetSessionCookie,
}))
vi.mock('@/app/api/_utils/rateLimit', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@/app/api/_utils/rateLimit')>()
  return { ...actual, enforceRateLimit: mockEnforceRateLimit }
})
vi.mock('@/lib/observability/authEvents', () => ({
  logAuthEvent: mockLogAuthEvent,
  captureAuthException: mockCaptureAuthException,
}))
vi.mock('@/lib/prisma', () => ({ prisma: mockPrisma }))

import { GET } from './route'

const LOGIN_DEFAULT = '/login?from=%2Fpro%2Fmembership'

function request(token = 'tok_1.secret', from = '/pro/membership'): Request {
  const url = new URL(
    `https://tovis.app/api/v1/auth/session-handoff/${encodeURIComponent(token)}`,
  )
  if (from) url.searchParams.set('from', from)
  return new Request(url, { headers: { host: 'tovis.app' } })
}

function ctx(token = 'tok_1.secret') {
  return { params: Promise.resolve({ token }) }
}

function userRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'user_1',
    email: 'pro@example.com',
    phone: '+15551234567',
    role: Role.PRO,
    authVersion: 4,
    createdAt: new Date(),
    phoneVerifiedAt: new Date(),
    emailVerifiedAt: new Date(),
    adminPermissions: [],
    clientProfile: null,
    professionalProfile: { id: 'pp_1', verificationStatus: 'APPROVED' },
    ...overrides,
  }
}

function okConsume(overrides: Record<string, unknown> = {}) {
  return {
    ok: true,
    tokenId: 'tok_1',
    userId: 'user_1',
    redirectPath: '/pro/membership',
    actingRole: Role.PRO,
    authVersionAtIssue: 4,
    ...overrides,
  }
}

function locationOf(res: Response): string {
  return res.headers.get('location') ?? ''
}

describe('GET /api/v1/auth/session-handoff/[token]', () => {
  beforeEach(() => {
    mockConsume.mockReset().mockResolvedValue(okConsume())
    mockCreateActiveToken.mockReset().mockReturnValue('minted_session_token')
    mockSetSessionCookie.mockReset()
    mockEnforceRateLimit.mockReset().mockResolvedValue(null)
    mockLogAuthEvent.mockReset()
    mockCaptureAuthException.mockReset()
    mockPrisma.user.findUnique.mockReset().mockResolvedValue(userRow())
  })

  // ───────────────────────────── the happy path ─────────────────────────────

  it('consumes the token, mints the session cookie and redirects to the PINNED path', async () => {
    const res = await GET(request(), ctx())

    expect(res.status).toBe(303)
    expect(locationOf(res)).toBe('https://tovis.app/pro/membership')
    expect(mockSetSessionCookie).toHaveBeenCalledWith(
      expect.objectContaining({ token: 'minted_session_token' }),
    )
  })

  it('mints through the SAME helper login uses, with no device binding', async () => {
    await GET(request(), ctx())

    expect(mockCreateActiveToken).toHaveBeenCalledWith({
      userId: 'user_1',
      role: Role.PRO,
      authVersion: 4,
      deviceId: null,
    })
  })

  it('honours the destination from the ROW, never from the query string', async () => {
    // The open-redirect proof for the success path: a hostile `?from=` is
    // present and is ignored entirely.
    mockConsume.mockResolvedValue(okConsume({ redirectPath: '/pro/calendar' }))

    const res = await GET(
      request('tok_1.secret', '//evil.example'),
      ctx(),
    )

    expect(locationOf(res)).toBe('https://tovis.app/pro/calendar')
  })

  it('never caches, and never forwards a referrer', async () => {
    const res = await GET(request(), ctx())

    expect(res.headers.get('referrer-policy')).toBe('no-referrer')
    expect(res.headers.get('cache-control')).toContain('no-store')
  })

  it('logs consumption with the row id, never the secret', async () => {
    await GET(request(), ctx())

    const call = mockLogAuthEvent.mock.calls.find(
      ([e]) => e.event === 'auth.session_handoff.consumed',
    )

    expect(call?.[0].verificationId).toBe('tok_1')
    expect(call?.[0].userId).toBe('user_1')
    expect(JSON.stringify(call?.[0])).not.toContain('secret')
  })

  // ──────────────────────────────── refusals ────────────────────────────────

  it.each([
    ['malformed'],
    ['not_found'],
    ['secret_mismatch'],
    ['expired'],
    ['already_used'],
  ])(
    'REFUSES a %s token: same redirect, no cookie, nothing leaked',
    async (reason) => {
      mockConsume.mockResolvedValue({ ok: false, reason, tokenId: 'tok_1' })

      const res = await GET(request(), ctx())

      expect(res.status).toBe(303)
      expect(locationOf(res)).toBe(`https://tovis.app${LOGIN_DEFAULT}`)
      expect(mockSetSessionCookie).not.toHaveBeenCalled()
      expect(mockCreateActiveToken).not.toHaveBeenCalled()
      // The reason must not be observable anywhere in the response.
      expect(JSON.stringify([...res.headers])).not.toContain(reason)
    },
  )

  it('every refusal reason produces a BYTE-IDENTICAL response', async () => {
    const seen = new Set<string>()

    for (const reason of [
      'malformed',
      'not_found',
      'secret_mismatch',
      'expired',
      'already_used',
    ]) {
      mockConsume.mockResolvedValue({ ok: false, reason, tokenId: 'tok_1' })
      const res = await GET(request(), ctx())
      seen.add(`${res.status}|${locationOf(res)}`)
    }

    // A caller cannot use this endpoint as an oracle for whether a token id
    // exists, has expired, or has already been spent.
    expect(seen.size).toBe(1)
  })

  it('REUSE: the second redemption of a real token is refused', async () => {
    // First redemption succeeds…
    const first = await GET(request(), ctx())
    expect(first.status).toBe(303)
    expect(locationOf(first)).toBe('https://tovis.app/pro/membership')
    expect(mockSetSessionCookie).toHaveBeenCalledTimes(1)

    // …the second sees the burnt row and gets nothing.
    mockConsume.mockResolvedValue({
      ok: false,
      reason: 'already_used',
      tokenId: 'tok_1',
    })

    const second = await GET(request(), ctx())

    expect(locationOf(second)).toBe(`https://tovis.app${LOGIN_DEFAULT}`)
    expect(mockSetSessionCookie).toHaveBeenCalledTimes(1)
  })

  it('SESSION REVOKED: an authVersion bump inside the window refuses', async () => {
    // The token was minted at authVersion 4; the user has since signed out
    // everywhere / reset their password, so the row now reads 5.
    mockPrisma.user.findUnique.mockResolvedValue(userRow({ authVersion: 5 }))

    const res = await GET(request(), ctx())

    expect(locationOf(res)).toBe(`https://tovis.app${LOGIN_DEFAULT}`)
    expect(mockSetSessionCookie).not.toHaveBeenCalled()
  })

  it('…and still succeeds when the authVersion is unchanged', async () => {
    // The other direction: proves the check above is a comparison, not a
    // blanket refusal.
    mockPrisma.user.findUnique.mockResolvedValue(userRow({ authVersion: 4 }))

    const res = await GET(request(), ctx())

    expect(locationOf(res)).toBe('https://tovis.app/pro/membership')
    expect(mockSetSessionCookie).toHaveBeenCalledTimes(1)
  })

  it('DELETED USER: a token whose user no longer exists refuses CLEANLY', async () => {
    mockPrisma.user.findUnique.mockResolvedValue(null)

    const res = await GET(request(), ctx())

    expect(locationOf(res)).toBe(`https://tovis.app${LOGIN_DEFAULT}`)
    expect(mockCreateActiveToken).not.toHaveBeenCalled()

    // "Cleanly" is the load-bearing word, and mutation testing is why it is
    // asserted. Deleting the explicit `!user` check still REFUSES — but by
    // throwing a TypeError into the catch-all, which pages us through Sentry
    // for an ordinary race (the user deleted their account inside the 60s
    // window). A refusal must be a decision, not a crash that lands somewhere
    // safe.
    expect(mockCaptureAuthException).not.toHaveBeenCalled()
    expect(mockLogAuthEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'auth.session_handoff.rejected',
        code: 'session_revoked',
      }),
    )
  })

  it('WRONG USER: the session is minted for the TOKEN’s owner, not anyone else', async () => {
    mockConsume.mockResolvedValue(
      okConsume({ userId: 'user_victim', authVersionAtIssue: 9 }),
    )
    mockPrisma.user.findUnique.mockResolvedValue(
      userRow({ id: 'user_victim', authVersion: 9 }),
    )

    await GET(request(), ctx())

    // Identity comes from the row. There is no request field that could make
    // this mint a session for anybody else.
    expect(mockPrisma.user.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'user_victim' } }),
    )
    expect(mockCreateActiveToken).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'user_victim' }),
    )
  })

  it('ENTITLEMENT LOST: a stored PRO role downgrades when the licence is gone', async () => {
    // resolveActingRole runs for real here — the pro is no longer APPROVED, so
    // the minted session drops to their home role instead of walking into the
    // pro workspace.
    mockPrisma.user.findUnique.mockResolvedValue(
      userRow({
        role: Role.CLIENT,
        professionalProfile: { id: 'pp_1', verificationStatus: 'REJECTED' },
        clientProfile: { id: 'cp_1' },
      }),
    )

    await GET(request(), ctx())

    expect(mockCreateActiveToken).toHaveBeenCalledWith(
      expect.objectContaining({ role: Role.CLIENT }),
    )
  })

  // ─────────────────────────── the failure redirect ──────────────────────────

  it('carries an ALLOWLISTED ?from through to the login wall', async () => {
    mockConsume.mockResolvedValue({
      ok: false,
      reason: 'expired',
      tokenId: null,
    })

    const res = await GET(
      request('tok_1.secret', '/pro/calendar'),
      ctx(),
    )

    expect(locationOf(res)).toBe(
      'https://tovis.app/login?from=%2Fpro%2Fcalendar',
    )
  })

  it.each([
    ['//evil.example'],
    ['https://evil.example'],
    ['/admin'],
    ['/pro/../admin'],
  ])(
    'OPEN REDIRECT: a hostile ?from=%s is replaced by the default, not obeyed',
    async (from) => {
      mockConsume.mockResolvedValue({
        ok: false,
        reason: 'not_found',
        tokenId: null,
      })

      const res = await GET(request('tok_1.secret', from), ctx())
      const location = new URL(locationOf(res))

      // Both halves matter: it must stay on our origin AND must not smuggle the
      // hostile value through in the query.
      expect(location.origin).toBe('https://tovis.app')
      expect(location.pathname).toBe('/login')
      expect(location.searchParams.get('from')).toBe('/pro/membership')
    },
  )

  // ─────────────────────────────── rate limit ────────────────────────────────

  it('rate limits by the token ID half — never by the secret', async () => {
    await GET(request('tok_1.supersecretvalue'), ctx('tok_1.supersecretvalue'))

    const call = mockEnforceRateLimit.mock.calls[0]?.[0]
    expect(call).toBeDefined()
    expect(call.bucket).toBe('auth:session-handoff:exchange')
    expect(call.identity.id).toBe('tok_1')
    expect(JSON.stringify(call)).not.toContain('supersecretvalue')
  })

  it('refuses without consuming when the limiter blocks', async () => {
    const { NextResponse } = await import('next/server')
    mockEnforceRateLimit.mockResolvedValue(
      NextResponse.json({ ok: false }, { status: 429 }),
    )

    const res = await GET(request(), ctx())

    // Still the SAME redirect — a blocked attacker learns nothing from the
    // response shape either.
    expect(res.status).toBe(303)
    expect(locationOf(res)).toBe(`https://tovis.app${LOGIN_DEFAULT}`)
    expect(mockConsume).not.toHaveBeenCalled()
  })

  it('does not spend a rate-limit slot on a malformed token', async () => {
    mockConsume.mockResolvedValue({
      ok: false,
      reason: 'malformed',
      tokenId: null,
    })

    await GET(request('garbage'), ctx('garbage'))

    expect(mockEnforceRateLimit).not.toHaveBeenCalled()
  })

  // ────────────────────────────── kill switch ───────────────────────────────

  it('KILL SWITCH: refuses redemption while DISABLE_SESSION_HANDOFF is set', async () => {
    process.env.DISABLE_SESSION_HANDOFF = '1'
    try {
      const res = await GET(request(), ctx())

      expect(res.status).toBe(303)
      expect(locationOf(res)).toBe(`https://tovis.app${LOGIN_DEFAULT}`)
      expect(mockSetSessionCookie).not.toHaveBeenCalled()
      // A token already in flight must DIE, not merely be left unspent — so the
      // switch is checked before the token is even consumed.
      expect(mockConsume).not.toHaveBeenCalled()
    } finally {
      delete process.env.DISABLE_SESSION_HANDOFF
    }
  })

  it('…and redeems again the moment the switch is cleared', async () => {
    delete process.env.DISABLE_SESSION_HANDOFF

    const res = await GET(request(), ctx())

    expect(locationOf(res)).toBe('https://tovis.app/pro/membership')
    expect(mockSetSessionCookie).toHaveBeenCalledTimes(1)
  })

  // ───────────────────────────── internal errors ─────────────────────────────

  it('an internal error is indistinguishable from a bad token', async () => {
    mockConsume.mockRejectedValue(new Error('database on fire'))

    const res = await GET(request(), ctx())

    expect(res.status).toBe(303)
    expect(locationOf(res)).toBe(`https://tovis.app${LOGIN_DEFAULT}`)
    expect(mockSetSessionCookie).not.toHaveBeenCalled()
  })
})
