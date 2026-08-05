// lib/auth/sessionHandoff.test.ts
//
// Red-proof for the one-time sign-in hand-off. Every security property is
// asserted in BOTH directions — the refusal AND the case that must still work —
// because a guard that refuses everything passes a one-sided test happily.

import crypto from 'crypto'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockPrisma = vi.hoisted(() => ({
  sessionHandoffToken: {
    updateMany: vi.fn(),
    create: vi.fn(),
    findUnique: vi.fn(),
  },
}))

vi.mock('@/lib/prisma', () => ({ prisma: mockPrisma }))

import {
  DEFAULT_SESSION_HANDOFF_PATH,
  SESSION_HANDOFF_EXCHANGE_PATH,
  SESSION_HANDOFF_TTL_MS,
  buildSessionHandoffExchangeUrl,
  buildSessionHandoffLoginPath,
  consumeSessionHandoffToken,
  createSessionHandoffToken,
  sanitizeSessionHandoffPath,
} from './sessionHandoff'

function sha256(input: string): string {
  return crypto.createHash('sha256').update(input).digest('hex')
}

/** The `data` payload of the Nth `create` call, or a clear failure. */
function createdData(index = 0): Record<string, unknown> {
  const call = mockPrisma.sessionHandoffToken.create.mock.calls[index]
  if (!call) throw new Error(`create was not called (index ${index})`)
  return call[0].data
}

/** The secret half of an issued token, or a clear failure. */
function secretOf(token: string): string {
  const secret = token.split('.')[1]
  if (!secret) throw new Error(`token has no secret half: ${token}`)
  return secret
}

const NOW = new Date('2026-08-04T12:00:00.000Z')

beforeEach(() => {
  for (const fn of Object.values(mockPrisma.sessionHandoffToken)) fn.mockReset()
  mockPrisma.sessionHandoffToken.updateMany.mockResolvedValue({ count: 1 })
})

// ───────────────────────────── redirect allowlist ─────────────────────────────

describe('sanitizeSessionHandoffPath — open redirect', () => {
  // The POSITIVE half. Without these, a sanitizer that returns null for
  // everything would pass every refusal test below and break the feature.
  it.each([
    ['/pro/membership', '/pro/membership'],
    ['/pro', '/pro'],
    ['/pro/calendar', '/pro/calendar'],
    ['/pro/settings?tab=billing', '/pro/settings?tab=billing'],
    ['/pro/clients#recent', '/pro/clients#recent'],
    ['  /pro/membership  ', '/pro/membership'],
  ])('allows %s', (input, expected) => {
    expect(sanitizeSessionHandoffPath(input)).toBe(expected)
  })

  it.each([
    // Absolute URLs to another origin.
    ['https://evil.example/pro/membership'],
    ['http://evil.example'],
    // Scheme-relative — the classic open redirect.
    ['//evil.example'],
    ['//evil.example/pro/membership'],
    ['///evil.example'],
    // Backslash variants browsers normalise to `/`.
    ['/\\evil.example'],
    ['\\\\evil.example'],
    ['/pro\\..\\admin'],
    // ⚠️ This one ISOLATES the backslash guard, and mutation testing is why it
    // is here. The three above are each also caught by a later layer (the
    // origin re-parse, or the `..` check), so removing the backslash check left
    // them all still refused. This input is not: Node's URL parser turns
    // `/pro\evil` into pathname `/pro//evil`, which stays on-origin, contains
    // no `..`, and starts with `/pro/` — so with the backslash check gone it
    // would be ALLOWED. Deleting that line now turns this suite red.
    ['/pro\\evil'],
    // Traversal out of the allowlisted subtree.
    ['/pro/../admin'],
    ['/pro/..%2fadmin'],
    ['/pro/%2e%2e/admin'],
    // Other workspaces, including the near-misses that a naive
    // `startsWith('/pro')` would wave through.
    ['/admin'],
    ['/admin/permissions'],
    ['/client'],
    ['/login'],
    ['/professionals'],
    ['/pros'],
    ['/proxy'],
    // Non-paths and injection shapes.
    ['pro/membership'],
    ['javascript:alert(1)'],
    ['data:text/html,<script>'],
    [''],
    ['   '],
  ])('refuses %s', (input) => {
    expect(sanitizeSessionHandoffPath(input)).toBeNull()
  })

  it('refuses CR/LF and other control characters (header splitting)', () => {
    expect(
      sanitizeSessionHandoffPath('/pro/membership\r\nSet-Cookie: a=b'),
    ).toBeNull()
    expect(
      sanitizeSessionHandoffPath(`/pro/mem${String.fromCharCode(0)}bership`),
    ).toBeNull()
    expect(sanitizeSessionHandoffPath('/pro/mem\tbership')).toBeNull()
    expect(sanitizeSessionHandoffPath('/pro/mem bership')).toBeNull()
    expect(
      sanitizeSessionHandoffPath(`/pro/membership${String.fromCharCode(127)}`),
    ).toBeNull()
  })

  it('refuses null/undefined/non-strings without throwing', () => {
    expect(sanitizeSessionHandoffPath(null)).toBeNull()
    expect(sanitizeSessionHandoffPath(undefined)).toBeNull()
  })

  it('refuses a path longer than the column can hold', () => {
    expect(sanitizeSessionHandoffPath(`/pro/${'a'.repeat(600)}`)).toBeNull()
    // …and still allows one just under the cap, so the check is a cap and not
    // an accidental blanket refusal.
    expect(sanitizeSessionHandoffPath(`/pro/${'a'.repeat(400)}`)).toBe(
      `/pro/${'a'.repeat(400)}`,
    )
  })
})

describe('buildSessionHandoffLoginPath — the failure landing', () => {
  it('carries an allowlisted target through', () => {
    expect(buildSessionHandoffLoginPath('/pro/calendar')).toBe(
      '/login?from=%2Fpro%2Fcalendar',
    )
  })

  it('falls back to the default rather than obeying a hostile target', () => {
    // This is the one place a caller-supplied value reaches a redirect, so it
    // gets its own proof: an attacker-chosen `?from=` must not survive.
    for (const hostile of ['//evil.example', 'https://evil.example', '/admin']) {
      expect(buildSessionHandoffLoginPath(hostile)).toBe(
        `/login?from=${encodeURIComponent(DEFAULT_SESSION_HANDOFF_PATH)}`,
      )
    }
    expect(buildSessionHandoffLoginPath(null)).toBe(
      `/login?from=${encodeURIComponent(DEFAULT_SESSION_HANDOFF_PATH)}`,
    )
  })
})

describe('buildSessionHandoffExchangeUrl', () => {
  it('builds an absolute URL on the app origin with the token in the path', () => {
    const url = buildSessionHandoffExchangeUrl({
      appUrl: 'https://tovis.app',
      token: 'row_1.secret',
      fallbackPath: '/pro/membership',
    })

    const parsed = new URL(url)
    expect(parsed.origin).toBe('https://tovis.app')
    expect(parsed.pathname).toBe(`${SESSION_HANDOFF_EXCHANGE_PATH}/row_1.secret`)
    expect(parsed.searchParams.get('from')).toBe('/pro/membership')
  })
})

// ───────────────────────────────── issuance ──────────────────────────────────

describe('createSessionHandoffToken', () => {
  function createReturns(overrides: Record<string, unknown> = {}) {
    mockPrisma.sessionHandoffToken.create.mockImplementation(
      (args: { data: Record<string, unknown> }) =>
        Promise.resolve({
          id: 'tok_1',
          expiresAt: args.data.expiresAt,
          redirectPath: args.data.redirectPath,
          ...overrides,
        }),
    )
  }

  it('stores only the HASH — the secret never reaches the database', async () => {
    createReturns()

    const issued = await createSessionHandoffToken({
      userId: 'user_1',
      actingRole: 'PRO',
      authVersion: 3,
      redirectPath: '/pro/membership',
      now: NOW,
    })

    const data = createdData()
    const secret = secretOf(issued.token)

    expect(secret).toMatch(/^[0-9a-f]{64}$/)
    expect(data.tokenHash).toBe(sha256(secret))
    // The decisive assertion: the raw secret appears nowhere in the write.
    expect(JSON.stringify(data)).not.toContain(secret)
  })

  it('expires in 60s or less', async () => {
    createReturns()

    const issued = await createSessionHandoffToken({
      userId: 'user_1',
      actingRole: 'PRO',
      authVersion: 1,
      redirectPath: '/pro/membership',
      now: NOW,
    })

    const ttl = issued.expiresAt.getTime() - NOW.getTime()
    expect(ttl).toBe(SESSION_HANDOFF_TTL_MS)
    expect(ttl).toBeLessThanOrEqual(60_000)
  })

  it('burns the user’s previous unused tokens, scoped to that user only', async () => {
    createReturns()

    await createSessionHandoffToken({
      userId: 'user_1',
      actingRole: 'PRO',
      authVersion: 1,
      redirectPath: '/pro/membership',
      now: NOW,
    })

    expect(mockPrisma.sessionHandoffToken.updateMany).toHaveBeenCalledWith({
      where: { userId: 'user_1', usedAt: null },
      data: { usedAt: NOW },
    })
  })

  it('pins the issuing user, acting role and authVersion', async () => {
    createReturns()

    await createSessionHandoffToken({
      userId: 'user_1',
      actingRole: 'PRO',
      authVersion: 7,
      redirectPath: '/pro/membership',
      ip: '203.0.113.9',
      userAgent: 'Tovis/1.0',
      now: NOW,
    })

    const data = createdData()
    expect(data.userId).toBe('user_1')
    expect(data.actingRole).toBe('PRO')
    expect(data.authVersionAtIssue).toBe(7)
    expect(data.issuedIp).toBe('203.0.113.9')
    expect(data.issuedUserAgent).toBe('Tovis/1.0')
  })

  it('REFUSES to store a path outside the allowlist, even if a caller asks', async () => {
    // Defence in depth: the route sanitizes first, but a future caller that
    // forgets must not be able to plant an open redirect in the table.
    await expect(
      createSessionHandoffToken({
        userId: 'user_1',
        actingRole: 'PRO',
        authVersion: 1,
        redirectPath: '//evil.example',
        now: NOW,
      }),
    ).rejects.toThrow(/allowlist/i)

    expect(mockPrisma.sessionHandoffToken.create).not.toHaveBeenCalled()
  })

  it('truncates an over-long user agent rather than failing the write', async () => {
    createReturns()

    await createSessionHandoffToken({
      userId: 'user_1',
      actingRole: 'PRO',
      authVersion: 1,
      redirectPath: '/pro/membership',
      userAgent: 'x'.repeat(900),
      now: NOW,
    })

    const data = createdData()
    expect(String(data.issuedUserAgent)).toHaveLength(512)
  })
})

// ──────────────────────────────── consumption ────────────────────────────────

describe('consumeSessionHandoffToken', () => {
  const SECRET = 'a'.repeat(64)

  function row(overrides: Record<string, unknown> = {}) {
    return {
      id: 'tok_1',
      userId: 'user_1',
      tokenHash: sha256(SECRET),
      redirectPath: '/pro/membership',
      actingRole: 'PRO',
      authVersionAtIssue: 3,
      expiresAt: new Date(NOW.getTime() + 30_000),
      usedAt: null,
      ...overrides,
    }
  }

  it('accepts a live, unused token and returns the PINNED destination', async () => {
    mockPrisma.sessionHandoffToken.findUnique.mockResolvedValue(row())
    mockPrisma.sessionHandoffToken.updateMany.mockResolvedValue({ count: 1 })

    const result = await consumeSessionHandoffToken({
      rawToken: `tok_1.${SECRET}`,
      now: NOW,
    })

    expect(result).toEqual({
      ok: true,
      tokenId: 'tok_1',
      userId: 'user_1',
      redirectPath: '/pro/membership',
      actingRole: 'PRO',
      authVersionAtIssue: 3,
    })
  })

  it('consumes with a conditional update that re-asserts unused AND unexpired', async () => {
    mockPrisma.sessionHandoffToken.findUnique.mockResolvedValue(row())
    mockPrisma.sessionHandoffToken.updateMany.mockResolvedValue({ count: 1 })

    await consumeSessionHandoffToken({ rawToken: `tok_1.${SECRET}`, now: NOW })

    // This predicate is what makes single-use atomic — the checks in JS above
    // it are not. Assert the WHERE clause itself, not just that it succeeded.
    expect(mockPrisma.sessionHandoffToken.updateMany).toHaveBeenCalledWith({
      where: { id: 'tok_1', usedAt: null, expiresAt: { gt: NOW } },
      data: { usedAt: NOW },
    })
  })

  it('REUSE: a second redemption is refused (the update matches 0 rows)', async () => {
    mockPrisma.sessionHandoffToken.findUnique.mockResolvedValue(
      row({ usedAt: new Date(NOW.getTime() - 1_000) }),
    )
    mockPrisma.sessionHandoffToken.updateMany.mockResolvedValue({ count: 0 })

    const result = await consumeSessionHandoffToken({
      rawToken: `tok_1.${SECRET}`,
      now: NOW,
    })

    expect(result).toEqual({
      ok: false,
      reason: 'already_used',
      tokenId: 'tok_1',
    })
  })

  it('RACE: of two concurrent redemptions only the one whose update wins succeeds', async () => {
    mockPrisma.sessionHandoffToken.findUnique.mockResolvedValue(row())
    // Both callers read the row as unused — the DB decides. Exactly one
    // conditional update matches a row.
    mockPrisma.sessionHandoffToken.updateMany
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 0 })

    const [first, second] = await Promise.all([
      consumeSessionHandoffToken({ rawToken: `tok_1.${SECRET}`, now: NOW }),
      consumeSessionHandoffToken({ rawToken: `tok_1.${SECRET}`, now: NOW }),
    ])

    expect([first.ok, second.ok].filter(Boolean)).toHaveLength(1)
  })

  it('EXPIRY: an expired token is refused', async () => {
    mockPrisma.sessionHandoffToken.findUnique.mockResolvedValue(
      row({ expiresAt: new Date(NOW.getTime() - 1) }),
    )
    mockPrisma.sessionHandoffToken.updateMany.mockResolvedValue({ count: 0 })

    const result = await consumeSessionHandoffToken({
      rawToken: `tok_1.${SECRET}`,
      now: NOW,
    })

    expect(result).toEqual({ ok: false, reason: 'expired', tokenId: 'tok_1' })
  })

  it('EXPIRY BOUNDARY: still valid one millisecond before expiry', async () => {
    const expiresAt = new Date(NOW.getTime() + 1)
    mockPrisma.sessionHandoffToken.findUnique.mockResolvedValue(row({ expiresAt }))
    mockPrisma.sessionHandoffToken.updateMany.mockResolvedValue({ count: 1 })

    const result = await consumeSessionHandoffToken({
      rawToken: `tok_1.${SECRET}`,
      now: NOW,
    })

    expect(result.ok).toBe(true)
  })

  it('WRONG SECRET: a valid row id with the wrong secret is refused…', async () => {
    mockPrisma.sessionHandoffToken.findUnique.mockResolvedValue(row())

    const result = await consumeSessionHandoffToken({
      rawToken: `tok_1.${'b'.repeat(64)}`,
      now: NOW,
    })

    expect(result).toEqual({
      ok: false,
      reason: 'secret_mismatch',
      tokenId: 'tok_1',
    })
  })

  it('…and a wrong secret does NOT burn the live token', async () => {
    // Otherwise anyone who learned a token ID could deny the real pro their
    // hand-off by guessing the secret once.
    mockPrisma.sessionHandoffToken.findUnique.mockResolvedValue(row())

    await consumeSessionHandoffToken({
      rawToken: `tok_1.${'b'.repeat(64)}`,
      now: NOW,
    })

    expect(mockPrisma.sessionHandoffToken.updateMany).not.toHaveBeenCalled()
  })

  it('WRONG USER: a token issued to another user carries THAT user’s id, never the caller’s', async () => {
    // The hand-off is user-bound by construction: the identity comes from the
    // row, so there is no request field a caller could use to redeem someone
    // else's token as themselves.
    mockPrisma.sessionHandoffToken.findUnique.mockResolvedValue(
      row({ userId: 'user_victim' }),
    )
    mockPrisma.sessionHandoffToken.updateMany.mockResolvedValue({ count: 1 })

    const result = await consumeSessionHandoffToken({
      rawToken: `tok_1.${SECRET}`,
      now: NOW,
    })

    expect(result.ok && result.userId).toBe('user_victim')
  })

  it('UNKNOWN ROW: an id that does not exist is refused without a write', async () => {
    mockPrisma.sessionHandoffToken.findUnique.mockResolvedValue(null)

    const result = await consumeSessionHandoffToken({
      rawToken: `tok_missing.${SECRET}`,
      now: NOW,
    })

    expect(result).toEqual({ ok: false, reason: 'not_found', tokenId: null })
    expect(mockPrisma.sessionHandoffToken.updateMany).not.toHaveBeenCalled()
  })

  it.each([
    ['', 'empty'],
    ['no-separator', 'no separator'],
    ['.secretonly', 'empty id half'],
    ['idonly.', 'empty secret half'],
  ])('MALFORMED (%s) is refused before touching the database', async (raw) => {
    const result = await consumeSessionHandoffToken({ rawToken: raw, now: NOW })

    expect(result).toEqual({ ok: false, reason: 'malformed', tokenId: null })
    expect(mockPrisma.sessionHandoffToken.findUnique).not.toHaveBeenCalled()
  })

  it('a null token is refused rather than throwing', async () => {
    const result = await consumeSessionHandoffToken({ rawToken: null, now: NOW })
    expect(result).toEqual({ ok: false, reason: 'malformed', tokenId: null })
  })
})
