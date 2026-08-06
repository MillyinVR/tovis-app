// app/api/_utils/rateLimit.identityBuckets.test.ts
//
// Regression coverage for the 2026-08-06 audit finding: "production login
// rate-limiting has been falling into one shared bucket since June 25."
//
// Unlike rateLimit.test.ts (which mocks the canonical limiter and only
// asserts the key string it was CALLED with), this suite leaves
// rateLimitIdentity / enforceRateLimit / emailRateLimitKeySuffix and the real
// lib/rateLimit/enforce.ts counting logic in place, and mocks only the
// network boundary (getRedis) with a fake in-memory Redis. It proves the
// auth:login:identity bucket actually separates counters per IP+email, not
// just that the right string gets built.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mockGetTrustedClientIpFromNextHeaders = vi.hoisted(() => vi.fn())
const mockLogAuthEvent = vi.hoisted(() => vi.fn())
const mockGetRedis = vi.hoisted(() => vi.fn())

vi.mock('@/lib/trustedClientIp', () => ({
  getTrustedClientIpFromNextHeaders: mockGetTrustedClientIpFromNextHeaders,
  getTrustedClientIpFromRequest: vi.fn(),
}))

vi.mock('@/lib/observability/authEvents', () => ({
  logAuthEvent: mockLogAuthEvent,
}))

vi.mock('@/lib/redis', () => ({
  getRedis: mockGetRedis,
}))

vi.mock('./responses', () => ({
  jsonFail: (
    status: number,
    error: string,
    extra?: Record<string, unknown>,
    init?: { headers?: Record<string, string> },
  ) =>
    new Response(
      JSON.stringify({ ok: false, error, ...(extra ?? {}) }),
      { status, headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) } },
    ),
}))

type FakeRecord = { count: number; expiresAtMs: number | null }

/** Minimal fake of the @upstash/redis surface enforce.ts actually calls. */
function createFakeRedis(store: Map<string, FakeRecord>) {
  return {
    async incr(key: string) {
      const now = Date.now()
      const existing = store.get(key)
      if (!existing || (existing.expiresAtMs !== null && existing.expiresAtMs <= now)) {
        store.set(key, { count: 1, expiresAtMs: null })
        return 1
      }
      existing.count += 1
      return existing.count
    },
    async expire(key: string, seconds: number) {
      const existing = store.get(key)
      if (existing) existing.expiresAtMs = Date.now() + seconds * 1000
      return 1
    },
    async ttl(key: string) {
      const existing = store.get(key)
      if (!existing || existing.expiresAtMs === null) return -1
      return Math.max(0, Math.ceil((existing.expiresAtMs - Date.now()) / 1000))
    },
  }
}

async function loadSubject() {
  vi.resetModules()
  return await import('./rateLimit')
}

describe('auth:login:identity bucket — real per-identity separation', () => {
  let store: Map<string, FakeRecord>

  beforeEach(() => {
    store = new Map()
    mockGetTrustedClientIpFromNextHeaders.mockReset()
    mockGetRedis.mockReset()
    mockGetRedis.mockReturnValue(createFakeRedis(store))
    mockLogAuthEvent.mockReset()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('pins the composite bucket key shape to rl:auth:login:id:ip:<ip>:<emailHash>', async () => {
    const { rateLimitIdentity, enforceRateLimit, emailRateLimitKeySuffix } =
      await loadSubject()

    mockGetTrustedClientIpFromNextHeaders.mockResolvedValue('203.0.113.10')
    const identity = await rateLimitIdentity()
    const suffix = emailRateLimitKeySuffix('user@example.com')

    expect(identity).toEqual({ kind: 'ip', id: '203.0.113.10' })
    expect(suffix).toMatch(/^[0-9a-f]{32}$/)

    await enforceRateLimit({
      bucket: 'auth:login:identity',
      identity,
      keySuffix: suffix,
    })

    expect([...store.keys()]).toEqual([
      `rl:auth:login:id:ip:203.0.113.10:${suffix}`,
    ])
  })

  it('gives two different accounts on the SAME IP independent counters (no shared bucket)', async () => {
    const { rateLimitIdentity, enforceRateLimit, emailRateLimitKeySuffix } =
      await loadSubject()

    mockGetTrustedClientIpFromNextHeaders.mockResolvedValue('203.0.113.10')
    const identity = await rateLimitIdentity()

    const attemptAlice = () =>
      enforceRateLimit({
        bucket: 'auth:login:identity',
        identity,
        keySuffix: emailRateLimitKeySuffix('alice@example.com'),
      })
    const attemptBob = () =>
      enforceRateLimit({
        bucket: 'auth:login:identity',
        identity,
        keySuffix: emailRateLimitKeySuffix('bob@example.com'),
      })

    // Exhaust Alice's 8/15min ceiling (RATE_LIMITS['auth:login:identity'].limit).
    for (let i = 0; i < 8; i++) {
      expect(await attemptAlice()).toBeNull()
    }
    expect(await attemptAlice()).not.toBeNull() // Alice is now blocked

    // Bob, same IP, is untouched — if this were one shared bucket Bob would
    // already be blocked too.
    expect(await attemptBob()).toBeNull()
    expect(store.size).toBe(2)
  })

  it('gives the SAME account from two different IPs independent counters (no cross-IP lockout DoS)', async () => {
    const { rateLimitIdentity, enforceRateLimit, emailRateLimitKeySuffix } =
      await loadSubject()

    const suffix = emailRateLimitKeySuffix('victim@example.com')

    mockGetTrustedClientIpFromNextHeaders.mockResolvedValue('203.0.113.10')
    const attackerIdentity = await rateLimitIdentity()

    for (let i = 0; i < 8; i++) {
      expect(
        await enforceRateLimit({
          bucket: 'auth:login:identity',
          identity: attackerIdentity,
          keySuffix: suffix,
        }),
      ).toBeNull()
    }
    expect(
      await enforceRateLimit({
        bucket: 'auth:login:identity',
        identity: attackerIdentity,
        keySuffix: suffix,
      }),
    ).not.toBeNull() // the attacker's own bucket is exhausted

    // The victim, logging in for real from their own IP with the same email,
    // is unaffected — a remote attacker can never exhaust a victim's bucket.
    mockGetTrustedClientIpFromNextHeaders.mockResolvedValue('198.51.100.99')
    const victimIdentity = await rateLimitIdentity()

    expect(
      await enforceRateLimit({
        bucket: 'auth:login:identity',
        identity: victimIdentity,
        keySuffix: suffix,
      }),
    ).toBeNull()
    expect(store.size).toBe(2)
  })
})
