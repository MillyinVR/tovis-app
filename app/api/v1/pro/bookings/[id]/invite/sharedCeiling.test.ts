// The claim-invite ceiling, driven through the REAL limiter.
//
// Every other test around this change mocks `enforceRateLimit`, which proves
// the route CALLS a limiter but not that a limiter ever REFUSES anything. That
// distinction is load-bearing here for two reasons:
//
//   1. `pro:client-claim-invite` is a `redis-only` bucket, so with no Redis
//      configured the real limiter fails OPEN. A test that "passes" against a
//      mock says nothing about whether the ceiling exists in a running system.
//   2. The whole point of the fix is that the two doors share ONE budget. Two
//      doors that each call a limiter, but derive different keys, would land in
//      different slots of the same bucket — 5 sends each instead of 5 between
//      them. No mock-based assertion can see that; only the key that actually
//      reaches Redis can.
//
// So this file stands up a fake Upstash REST server (the client is REST-based,
// so this is a real network round trip through the real `lib/redis` +
// `lib/rateLimit/enforce` code path) and drives BOTH doors against it.
//
// Deliberately not pointed at a real Upstash: the only credentials on this
// machine are production's, and spending a production rate-limit budget from a
// test could throttle a real professional.

import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { ContactMethod, ClientClaimStatus, ProClientInviteStatus } from '@prisma/client'
import http from 'node:http'
import type { AddressInfo } from 'node:net'

const mocks = vi.hoisted(() => ({
  requirePro: vi.fn(),
  bookingFindFirst: vi.fn(),
  bookingCount: vi.fn(),
  clientProfileFindUnique: vi.fn(),
  upsertClientClaimLink: vi.fn(),
  issueClaimLinkForClient: vi.fn(),
  createClientClaimInviteDelivery: vi.fn(),
}))

vi.mock('@/app/api/_utils', () => ({
  requirePro: mocks.requirePro,
  jsonFail: (status: number, error: string, extra?: unknown) => ({
    ok: false,
    status,
    error,
    ...(extra && typeof extra === 'object' ? extra : {}),
  }),
  jsonOk: (data: unknown, status = 200) => ({ ok: true, status, data }),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    booking: { findFirst: mocks.bookingFindFirst, count: mocks.bookingCount },
    clientProfile: { findUnique: mocks.clientProfileFindUnique },
  },
}))

vi.mock('@/lib/clients/clientClaimLinks', () => ({
  upsertClientClaimLink: mocks.upsertClientClaimLink,
  issueClaimLinkForClient: mocks.issueClaimLinkForClient,
}))

vi.mock('@/lib/clientActions/createClientClaimInviteDelivery', () => ({
  createClientClaimInviteDelivery: mocks.createClientClaimInviteDelivery,
}))

vi.mock('@/lib/notifications/delivery/kickNotificationDrain', () => ({
  kickNotificationDrain: vi.fn(),
}))

vi.mock('@/lib/tenant/requestContext', () => ({
  resolveTenantContextForRequest: vi.fn(async () => ({
    isRoot: true,
    tenantId: 'tenant_root',
    slug: 'tovis-root',
  })),
}))

vi.mock('@/lib/security/logging', () => ({
  safeError: (error: unknown) => ({ message: String(error) }),
  safeLogMeta: (meta: unknown) => meta,
}))

// The booking-less sibling is behind ENABLE_BOOKINGLESS_CLAIM, which production
// leaves unset. Forced ON here precisely so BOTH doors can be driven: the point
// of the test is what the pair does to one shared budget.
vi.mock('@/lib/clients/bookinglessClaimFlag', () => ({
  bookinglessClaimEnabled: () => true,
}))

// ── fake Upstash REST server ────────────────────────────────────────────────
// Two shapes, because this client auto-pipelines: a single command POSTs to `/`
// as `["incr","k"]` and reads back `{ result }`, while a batch POSTs to
// `/pipeline` as `[["incr","k"],…]` and reads back an ARRAY of `{ result }`.
// Answering the single shape to a /pipeline request fails inside the client
// with "res.map is not a function", which `enforceRateLimit` swallows into a
// silent fail-open — i.e. it looks exactly like an endpoint with no limit.
const store = new Map<string, number>()
/** Every key INCR'd, in order — this is the instrument the assertions read. */
const incrementedKeys: string[] = []

function runCommand(command: unknown[]): { result: number | null } {
  const verb = String(command[0] ?? '').toUpperCase()
  const key = String(command[1] ?? '')

  if (verb === 'INCR') {
    const next = (store.get(key) ?? 0) + 1
    store.set(key, next)
    incrementedKeys.push(key)
    return { result: next }
  }
  if (verb === 'EXPIRE') return { result: 1 }
  // A positive TTL; the limiter only uses it to compute Retry-After.
  if (verb === 'TTL') return { result: 60 }
  return { result: null }
}

const server = http.createServer((req, res) => {
  let body = ''
  req.on('data', (chunk) => {
    body += chunk
  })
  req.on('end', () => {
    let parsed: unknown = []
    try {
      parsed = JSON.parse(body || '[]')
    } catch {
      parsed = []
    }

    const isPipeline =
      Array.isArray(parsed) && parsed.every((entry) => Array.isArray(entry))

    const payload = isPipeline
      ? (parsed as unknown[][]).map(runCommand)
      : runCommand(parsed as unknown[])

    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify(payload))
  })
})

await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
const { port } = server.address() as AddressInfo

// Must be set BEFORE the route modules are imported: `lib/redis` memoizes the
// client on first use and reads these at that moment.
process.env.UPSTASH_REDIS_REST_URL = `http://127.0.0.1:${port}`
process.env.UPSTASH_REDIS_REST_TOKEN = 'fake-token-for-test'

const { POST: bookingInvitePost } = await import('./route')
const { POST: clientInvitePost } = await import(
  '../../../clients/[id]/invite/route'
)

afterAll(() => {
  server.close()
})

const PRO_ID = 'pro_shared'
const CLIENT_ID = 'client_shared'

function bookingInviteRequest(): Request {
  return new Request('http://localhost/api/v1/pro/bookings/booking_1/invite', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Tori Morales', phone: '+15551234567' }),
  })
}

function callBookingInvite() {
  return bookingInvitePost(bookingInviteRequest(), {
    params: Promise.resolve({ id: 'booking_1' }),
  })
}

function callClientInvite() {
  return clientInvitePost(
    new Request('http://localhost/api/v1/pro/clients/client_shared/invite', {
      method: 'POST',
    }),
    { params: Promise.resolve({ id: CLIENT_ID }) },
  )
}

/** The limiter answers with a 429 Response; the routes' own successes do not. */
function isRefusal(result: unknown): boolean {
  return result instanceof Response && result.status === 429
}

describe('claim-invite ceiling, through the real limiter', () => {
  // Every mock implementation is (re)installed per test on purpose: the project's
  // vitest config sets `mockReset: true`, which strips implementations before
  // each test. Setting these in beforeAll leaves requirePro() returning
  // undefined, and the routes 500 before they ever reach the limiter — which
  // reads exactly like "the limit did not fire".
  beforeEach(() => {
    mocks.requirePro.mockResolvedValue({
      ok: true,
      user: { id: 'user_shared' },
      userId: 'user_shared',
      professionalId: PRO_ID,
      proId: PRO_ID,
    })

    mocks.bookingFindFirst.mockResolvedValue({
      id: 'booking_1',
      clientId: CLIENT_ID,
      client: { userId: null },
    })
    mocks.bookingCount.mockResolvedValue(1)
    mocks.clientProfileFindUnique.mockResolvedValue({
      id: CLIENT_ID,
      userId: null,
      claimStatus: ClientClaimStatus.UNCLAIMED,
      createdByProfessionalId: PRO_ID,
    })

    const invite = {
      id: 'invite_1',
      clientId: CLIENT_ID,
      rawToken: 'token_1',
      status: ProClientInviteStatus.PENDING,
      acceptedAt: null,
      revokedAt: null,
      invitedName: 'Tori Morales',
      invitedEmail: null,
      invitedPhone: '+15551234567',
      preferredContactMethod: ContactMethod.SMS,
    }

    mocks.upsertClientClaimLink.mockResolvedValue(invite)
    mocks.issueClaimLinkForClient.mockResolvedValue({
      kind: 'issued',
      rawToken: 'token_1',
      invite,
    })
    mocks.createClientClaimInviteDelivery.mockResolvedValue({
      plan: { idempotency: { baseKey: 'b', sendKey: 's' } },
      link: { target: 'CLAIM', href: '/claim/token_1', tokenIncluded: true },
      dispatch: { created: true, selectedChannels: [], evaluations: [], dispatch: { id: 'd' } },
    })
  })

  it('spends ONE budget across both doors and refuses the 6th send', async () => {
    store.clear()
    incrementedKeys.length = 0
    mocks.createClientClaimInviteDelivery.mockClear()

    // Alternate the doors. If each door had its own key, five sends per door
    // would all succeed and nothing would ever be refused.
    const results = [
      await callBookingInvite(),
      await callClientInvite(),
      await callBookingInvite(),
      await callClientInvite(),
      await callBookingInvite(),
      // 6th — over the 5/hour ceiling however the calls were split.
      await callClientInvite(),
      await callBookingInvite(),
    ]

    // Positive control FIRST: if the limiter had fallen open (no Redis, wrong
    // env, server not reached), zero keys would have been incremented and every
    // assertion below would pass vacuously against an unlimited endpoint.
    expect(incrementedKeys.length).toBe(7)

    // Every door landed in the SAME slot. This is the assertion the whole fix
    // rests on.
    expect(new Set(incrementedKeys).size).toBe(1)
    expect(incrementedKeys[0]).toBe(
      `rl:pro:client-claim-invite:token:${PRO_ID}:${CLIENT_ID}`,
    )

    expect(results.slice(0, 5).map(isRefusal)).toEqual([
      false,
      false,
      false,
      false,
      false,
    ])
    expect(isRefusal(results[5])).toBe(true)
    expect(isRefusal(results[6])).toBe(true)

    // The refusals cost nothing: five sends were queued, not seven.
    expect(mocks.createClientClaimInviteDelivery).toHaveBeenCalledTimes(5)
  })

  it('gives a DIFFERENT client its own budget, so batch-inviting still works', async () => {
    store.clear()
    incrementedKeys.length = 0

    for (let i = 0; i < 5; i += 1) await callBookingInvite()
    expect(isRefusal(await callBookingInvite())).toBe(true)

    // A different client on the same pro is a different slot, per the bucket's
    // stated intent: "a pro can batch-invite many DIFFERENT clients while no
    // single client can be spammed."
    mocks.bookingFindFirst.mockResolvedValue({
      id: 'booking_2',
      clientId: 'client_other',
      client: { userId: null },
    })

    expect(isRefusal(await callBookingInvite())).toBe(false)
    expect(new Set(incrementedKeys).size).toBe(2)
  })
})
