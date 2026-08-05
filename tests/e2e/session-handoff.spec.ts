// tests/e2e/session-handoff.spec.ts
//
// The one-time sign-in hand-off, driven end to end against a real server.
//
// Why this exists rather than resting on the unit suites: the route-handler
// tests inspect a `Response` object before Next's header pipeline touches it,
// and that gap hid a real defect — the route set `Referrer-Policy: no-referrer`
// and `next.config.ts` rewrote it back to `strict-origin-when-cross-origin` on
// the way out, so the header never reached the wire. Only driving the endpoint
// showed it. This spec keeps that honest.
//
// No UI driving: the whole flow is HTTP (POST for a token, GET to redeem, a
// `Set-Cookie` and a redirect), so it runs on Playwright's `request` context and
// stays fast and non-flaky.

import { expect, test, type APIRequestContext } from '@playwright/test'
import { PrismaClient, Role, VerificationStatus } from '@prisma/client'

import { createActiveToken } from '@/lib/auth'

const prisma = new PrismaClient()

// This spec is about a session being MINTED, so it must start with no session
// at all — the shared client storageState would mask exactly what we assert.
test.use({ storageState: { cookies: [], origins: [] } })

const SUFFIX = `handoff-${Date.now()}`
const PRO_EMAIL = `${SUFFIX}-pro@example.invalid`

let proUserId = ''
let bearer = ''
let tenantId = ''

test.beforeAll(async () => {
  const tenant = await prisma.tenant.findFirst({
    where: { slug: 'tovis-root' },
    select: { id: true },
  })
  if (!tenant) throw new Error('root tenant missing — run the seed first')
  tenantId = tenant.id

  const user = await prisma.user.create({
    data: {
      email: PRO_EMAIL,
      password: 'x',
      role: Role.PRO,
      authVersion: 1,
      phoneVerifiedAt: new Date(),
      emailVerifiedAt: new Date(),
      professionalProfile: {
        create: {
          firstName: 'Handoff',
          lastName: 'Pro',
          handle: SUFFIX.replace(/[^a-z0-9]/g, ''),
          verificationStatus: VerificationStatus.APPROVED,
          timeZone: 'America/Los_Angeles',
          homeTenant: { connect: { id: tenantId } },
        },
      },
    },
    select: { id: true, role: true, authVersion: true },
  })

  proUserId = user.id
  // The same helper the app mints with, so this is a genuine native session
  // rather than a hand-rolled JWT that might diverge from one.
  bearer = createActiveToken({
    userId: user.id,
    role: user.role,
    authVersion: user.authVersion,
    deviceId: null,
  })
})

test.afterAll(async () => {
  if (proUserId) {
    await prisma.user.delete({ where: { id: proUserId } }).catch(() => {})
  }
  await prisma.$disconnect()
})

async function issue(request: APIRequestContext, redirectPath?: string) {
  return request.post('/api/v1/auth/session-handoff', {
    headers: { Authorization: `Bearer ${bearer}` },
    data: redirectPath === undefined ? {} : { redirectPath },
  })
}

test('hands a signed-in pro straight onto /pro/membership', async ({ request }) => {
  const issued = await issue(request)
  expect(issued.status()).toBe(200)

  const body = await issued.json()
  expect(body.redirectPath).toBe('/pro/membership')
  expect(new Date(body.expiresAt).getTime() - Date.now()).toBeLessThanOrEqual(60_000)

  const exchange = await request.get(body.url, { maxRedirects: 0 })

  expect(exchange.status()).toBe(303)
  expect(exchange.headers()['location']).toContain('/pro/membership')
  expect(exchange.headers()['set-cookie']).toContain('tovis_token=')
  // The defect this spec was written for. Asserted on the WIRE, not on the
  // handler's Response object.
  expect(exchange.headers()['referrer-policy']).toBe('no-referrer')
  expect(exchange.headers()['cache-control']).toContain('no-store')
})

test('a redeemed link is dead the second time', async ({ request }) => {
  const body = await (await issue(request)).json()

  const first = await request.get(body.url, { maxRedirects: 0 })
  expect(first.headers()['location']).toContain('/pro/membership')
  expect(first.headers()['set-cookie']).toContain('tovis_token=')

  const second = await request.get(body.url, { maxRedirects: 0 })
  expect(second.status()).toBe(303)
  expect(second.headers()['location']).toContain('/login?from=')
  // The half that matters: a reused link must not hand out a session.
  expect(second.headers()['set-cookie'] ?? '').not.toContain('tovis_token=')
})

test('a session revoked inside the window kills the hand-off', async ({ request }) => {
  const body = await (await issue(request)).json()

  // Sign out everywhere / password reset — both bump authVersion.
  const revoked = await prisma.user.update({
    where: { id: proUserId },
    data: { authVersion: { increment: 1 } },
    select: { authVersion: true },
  })

  const exchange = await request.get(body.url, { maxRedirects: 0 })
  expect(exchange.headers()['location']).toContain('/login?from=')
  expect(exchange.headers()['set-cookie'] ?? '').not.toContain('tovis_token=')

  // Re-mint the bearer at whatever the authVersion NOW is, read back from the
  // update rather than hardcoded. A literal here would silently rot the moment
  // this file gained a second bump or was run with --repeat-each.
  bearer = createActiveToken({
    userId: proUserId,
    role: Role.PRO,
    authVersion: revoked.authVersion,
    deviceId: null,
  })
})

test('refuses a destination outside the /pro allowlist', async ({ request }) => {
  for (const bad of ['//evil.example', 'https://evil.example/pro', '/admin']) {
    const res = await issue(request, bad)
    expect(res.status(), `expected 400 for ${bad}`).toBe(400)
    expect((await res.json()).code).toBe('REDIRECT_NOT_ALLOWED')
  }

  // The other direction — an allowlisted destination still works, so the check
  // above is a filter and not a blanket refusal.
  const ok = await issue(request, '/pro/calendar')
  expect(ok.status()).toBe(200)
  expect((await ok.json()).redirectPath).toBe('/pro/calendar')
})

test('a hostile ?from on the failure path cannot redirect off-site', async ({
  request,
}) => {
  for (const bad of ['//evil.example', 'https://evil.example', '/admin']) {
    const res = await request.get(
      `/api/v1/auth/session-handoff/garbage?from=${encodeURIComponent(bad)}`,
      { maxRedirects: 0 },
    )

    const location = new URL(
      res.headers()['location'] ?? '',
      'http://localhost:3000',
    )
    expect(location.pathname).toBe('/login')
    expect(location.searchParams.get('from')).toBe('/pro/membership')
    expect(location.host).not.toContain('evil.example')
  }
})

test('issuance requires an authenticated PRO', async ({ request }) => {
  const anon = await request.post('/api/v1/auth/session-handoff', { data: {} })
  expect(anon.status()).toBe(401)
})
