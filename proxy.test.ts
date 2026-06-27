import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mockVerifyMiddlewareToken = vi.hoisted(() => vi.fn())

vi.mock('@/lib/auth/middlewareToken', () => ({
  verifyMiddlewareToken: mockVerifyMiddlewareToken,
}))

import { proxy } from './proxy'

const ORIGINAL_APP_URL = process.env.NEXT_PUBLIC_APP_URL

function makeRequest(
  url: string,
  args?: {
    headers?: Record<string, string>
    cookie?: string | null
  },
) {
  const parsed = new URL(url)
  const headers = new Headers(args?.headers ?? {})

  if (!headers.has('host')) {
    headers.set('host', parsed.host)
  }

  if (args?.cookie) {
    headers.set('cookie', args.cookie)
  }

  if (!headers.has('x-request-id')) {
    headers.set('x-request-id', 'req_test_123')
  }

  return new NextRequest(url, { headers })
}

describe('proxy', () => {
  beforeEach(() => {
    process.env.NEXT_PUBLIC_APP_URL = 'https://app.tovis.app'
    mockVerifyMiddlewareToken.mockReset()
    mockVerifyMiddlewareToken.mockResolvedValue(null)
  })

  afterAll(() => {
    if (ORIGINAL_APP_URL === undefined) {
      delete process.env.NEXT_PUBLIC_APP_URL
    } else {
      process.env.NEXT_PUBLIC_APP_URL = ORIGINAL_APP_URL
    }
  })

  it('redirects VERIFICATION sessions away from normal app pages', async () => {
    mockVerifyMiddlewareToken.mockResolvedValue({
      userId: 'user_1',
      role: 'CLIENT',
      sessionKind: 'VERIFICATION',
      authVersion: 1,
    })

    const req = makeRequest('https://app.tovis.app/looks?tab=saved', {
      cookie: 'tovis_token=test_verification_token',
    })

    const res = await proxy(req)

    expect(mockVerifyMiddlewareToken).toHaveBeenCalledWith(
      'test_verification_token',
    )
    expect(res.status).toBe(307)
    expect(res.headers.get('location')).toBe(
      'https://app.tovis.app/verify-phone?next=%2Flooks%3Ftab%3Dsaved',
    )
    expect(res.headers.get('x-request-id')).toBe('req_test_123')
  })

  it('keeps the request port in verification redirects when NEXT_PUBLIC_APP_URL is unset', async () => {
    delete process.env.NEXT_PUBLIC_APP_URL

    mockVerifyMiddlewareToken.mockResolvedValue({
      userId: 'user_1',
      role: 'CLIENT',
      sessionKind: 'VERIFICATION',
      authVersion: 1,
    })

    const req = makeRequest('http://127.0.0.1:3000/signup/client', {
      cookie: 'tovis_token=test_verification_token',
    })

    const res = await proxy(req)

    expect(res.status).toBe(307)
    expect(res.headers.get('location')).toBe(
      'http://127.0.0.1:3000/verify-phone?next=%2Fsignup%2Fclient',
    )
  })

  it('returns 403 JSON for VERIFICATION sessions hitting non-verification API routes', async () => {
    mockVerifyMiddlewareToken.mockResolvedValue({
      userId: 'user_1',
      role: 'PRO',
      sessionKind: 'VERIFICATION',
      authVersion: 1,
    })

    const req = makeRequest('https://app.tovis.app/api/v1/pro/profile', {
      cookie: 'tovis_token=test_verification_token',
    })

    const res = await proxy(req)
    const body = await res.json()

    expect(res.status).toBe(403)
    expect(body).toEqual({
      ok: false,
      error: 'Account verification is required.',
      code: 'VERIFICATION_REQUIRED',
    })
    expect(res.headers.get('x-request-id')).toBe('req_test_123')
  })

  it('allows VERIFICATION sessions to reach verify-phone', async () => {
    mockVerifyMiddlewareToken.mockResolvedValue({
      userId: 'user_1',
      role: 'CLIENT',
      sessionKind: 'VERIFICATION',
      authVersion: 1,
    })

    const req = makeRequest('https://app.tovis.app/verify-phone?next=/looks', {
      cookie: 'tovis_token=test_verification_token',
    })

    const res = await proxy(req)

    expect(res.status).toBe(200)
    expect(res.headers.get('location')).toBeNull()
    expect(res.headers.get('x-middleware-rewrite')).toBeNull()
    expect(res.headers.get('x-request-id')).toBe('req_test_123')
  })

  it('allows VERIFICATION sessions to reach verification status API', async () => {
    mockVerifyMiddlewareToken.mockResolvedValue({
      userId: 'user_1',
      role: 'CLIENT',
      sessionKind: 'VERIFICATION',
      authVersion: 1,
    })

    const req = makeRequest(
      'https://app.tovis.app/api/v1/auth/verification/status',
      {
        cookie: 'tovis_token=test_verification_token',
      },
    )

    const res = await proxy(req)

    expect(res.status).toBe(200)
    expect(res.headers.get('location')).toBeNull()
    expect(res.headers.get('x-middleware-rewrite')).toBeNull()
    expect(res.headers.get('x-request-id')).toBe('req_test_123')
  })

  it('allows static assets for VERIFICATION sessions', async () => {
    mockVerifyMiddlewareToken.mockResolvedValue({
      userId: 'user_1',
      role: 'CLIENT',
      sessionKind: 'VERIFICATION',
      authVersion: 1,
    })

    const req = makeRequest('https://app.tovis.app/logo.png', {
      cookie: 'tovis_token=test_verification_token',
    })

    const res = await proxy(req)

    expect(res.status).toBe(200)
    expect(res.headers.get('location')).toBeNull()
    expect(res.headers.get('x-middleware-rewrite')).toBeNull()
    expect(res.headers.get('x-request-id')).toBe('req_test_123')
  })

  it('does not let VERIFICATION sessions bypass through vanity-domain rewrite', async () => {
    mockVerifyMiddlewareToken.mockResolvedValue({
      userId: 'user_1',
      role: 'PRO',
      sessionKind: 'VERIFICATION',
      authVersion: 1,
    })

    const req = makeRequest('https://tori.tovis.me/pro/calendar', {
      headers: {
        host: 'tori.tovis.me',
      },
      cookie: 'tovis_token=test_verification_token',
    })

    const res = await proxy(req)

    expect(res.status).toBe(307)
    expect(res.headers.get('location')).toBe(
      'https://app.tovis.app/verify-phone?next=%2Fpro%2Fcalendar',
    )
    expect(res.headers.get('x-middleware-rewrite')).toBeNull()
    expect(res.headers.get('x-request-id')).toBe('req_test_123')
  })

  it('rewrites vanity domains for non-verification sessions', async () => {
    mockVerifyMiddlewareToken.mockResolvedValue({
      userId: 'user_1',
      role: 'CLIENT',
      sessionKind: 'ACTIVE',
      authVersion: 1,
    })

    const req = makeRequest('https://tori.tovis.me/services', {
      headers: {
        host: 'tori.tovis.me',
      },
      cookie: 'tovis_token=test_active_token',
    })

    const res = await proxy(req)

    expect(res.status).toBe(200)
    expect(res.headers.get('location')).toBeNull()
    expect(res.headers.get('x-middleware-rewrite')).toContain(
      '/p/tori/services',
    )
    expect(res.headers.get('x-request-id')).toBe('req_test_123')
  })

  it('does not rewrite API routes on vanity domains', async () => {
    mockVerifyMiddlewareToken.mockResolvedValue({
      userId: 'user_1',
      role: 'CLIENT',
      sessionKind: 'ACTIVE',
      authVersion: 1,
    })

    const req = makeRequest('https://tori.tovis.me/api/v1/pro/profile', {
      headers: {
        host: 'tori.tovis.me',
      },
      cookie: 'tovis_token=test_active_token',
    })

    const res = await proxy(req)

    expect(res.status).toBe(200)
    expect(res.headers.get('location')).toBeNull()
    expect(res.headers.get('x-middleware-rewrite')).toBeNull()
    expect(res.headers.get('x-request-id')).toBe('req_test_123')
  })

  it('does not treat similar root domains as vanity subdomains', async () => {
    mockVerifyMiddlewareToken.mockResolvedValue({
      userId: 'user_1',
      role: 'CLIENT',
      sessionKind: 'ACTIVE',
      authVersion: 1,
    })

    const req = makeRequest('https://notovis.me/services', {
      headers: {
        host: 'notovis.me',
      },
      cookie: 'tovis_token=test_active_token',
    })

    const res = await proxy(req)

    expect(res.status).toBe(200)
    expect(res.headers.get('location')).toBeNull()
    expect(res.headers.get('x-middleware-rewrite')).toBeNull()
    expect(res.headers.get('x-request-id')).toBe('req_test_123')
  })

  it('does not rewrite the root vanity domain', async () => {
    mockVerifyMiddlewareToken.mockResolvedValue({
      userId: 'user_1',
      role: 'CLIENT',
      sessionKind: 'ACTIVE',
      authVersion: 1,
    })

    const req = makeRequest('https://tovis.me/services', {
      headers: {
        host: 'tovis.me',
      },
      cookie: 'tovis_token=test_active_token',
    })

    const res = await proxy(req)

    expect(res.status).toBe(200)
    expect(res.headers.get('location')).toBeNull()
    expect(res.headers.get('x-middleware-rewrite')).toBeNull()
    expect(res.headers.get('x-request-id')).toBe('req_test_123')
  })

  it('passes through normal requests when there is no valid auth token', async () => {
    mockVerifyMiddlewareToken.mockResolvedValue(null)

    const req = makeRequest('https://app.tovis.app/login')

    const res = await proxy(req)

    expect(mockVerifyMiddlewareToken).toHaveBeenCalledWith(null)
    expect(res.status).toBe(200)
    expect(res.headers.get('location')).toBeNull()
    expect(res.headers.get('x-middleware-rewrite')).toBeNull()
    expect(res.headers.get('x-request-id')).toBe('req_test_123')
  })
    it('allows same-origin state-changing requests', async () => {
    mockVerifyMiddlewareToken.mockResolvedValue({
      userId: 'user_1',
      role: 'CLIENT',
      sessionKind: 'ACTIVE',
      authVersion: 1,
    })

    const req = makeRequest('https://app.tovis.app/api/v1/client/settings', {
      headers: {
        origin: 'https://app.tovis.app',
      },
      cookie: 'tovis_token=test_active_token',
    })

    Object.defineProperty(req, 'method', {
      value: 'POST',
    })

    const res = await proxy(req)

    expect(res.status).toBe(200)
    expect(res.headers.get('location')).toBeNull()
    expect(res.headers.get('x-middleware-rewrite')).toBeNull()
    expect(res.headers.get('x-request-id')).toBe('req_test_123')
  })

  it('allows state-changing requests with an allowed configured origin', async () => {
    process.env.ALLOWED_APP_ORIGINS = 'https://admin.tovis.app'

    mockVerifyMiddlewareToken.mockResolvedValue({
      userId: 'user_1',
      role: 'ADMIN',
      sessionKind: 'ACTIVE',
      authVersion: 1,
    })

    const req = makeRequest('https://app.tovis.app/api/v1/admin/services', {
      headers: {
        origin: 'https://admin.tovis.app',
      },
      cookie: 'tovis_token=test_active_token',
    })

    Object.defineProperty(req, 'method', {
      value: 'PATCH',
    })

    const res = await proxy(req)

    expect(res.status).toBe(200)
    expect(res.headers.get('x-request-id')).toBe('req_test_123')

    delete process.env.ALLOWED_APP_ORIGINS
  })

  it('allows same-site vanity subdomain state-changing requests', async () => {
    mockVerifyMiddlewareToken.mockResolvedValue({
      userId: 'user_1',
      role: 'PRO',
      sessionKind: 'ACTIVE',
      authVersion: 1,
    })

    const req = makeRequest('https://tori.tovis.me/api/v1/pro/profile', {
      headers: {
        host: 'tori.tovis.me',
        origin: 'https://app.tovis.app',
      },
      cookie: 'tovis_token=test_active_token',
    })

    Object.defineProperty(req, 'method', {
      value: 'POST',
    })

    const res = await proxy(req)

    expect(res.status).toBe(200)
    expect(res.headers.get('location')).toBeNull()
    expect(res.headers.get('x-middleware-rewrite')).toBeNull()
    expect(res.headers.get('x-request-id')).toBe('req_test_123')
  })

  it('rejects state-changing requests with a foreign origin', async () => {
    mockVerifyMiddlewareToken.mockResolvedValue({
      userId: 'user_1',
      role: 'CLIENT',
      sessionKind: 'ACTIVE',
      authVersion: 1,
    })

    const req = makeRequest('https://app.tovis.app/api/v1/client/settings', {
      headers: {
        origin: 'https://evil.example',
      },
      cookie: 'tovis_token=test_active_token',
    })

    Object.defineProperty(req, 'method', {
      value: 'POST',
    })

    const res = await proxy(req)
    const body = await res.json()

    expect(res.status).toBe(403)
    expect(body).toEqual({
      ok: false,
      error: 'Invalid request origin.',
      code: 'INVALID_ORIGIN',
    })
    expect(res.headers.get('x-request-id')).toBe('req_test_123')
  })

  it('rejects state-changing requests with no origin or referer', async () => {
    mockVerifyMiddlewareToken.mockResolvedValue({
      userId: 'user_1',
      role: 'CLIENT',
      sessionKind: 'ACTIVE',
      authVersion: 1,
    })

    const req = makeRequest('https://app.tovis.app/api/v1/client/settings', {
      cookie: 'tovis_token=test_active_token',
    })

    Object.defineProperty(req, 'method', {
      value: 'POST',
    })

    const res = await proxy(req)
    const body = await res.json()

    expect(res.status).toBe(403)
    expect(body).toEqual({
      ok: false,
      error: 'Invalid request origin.',
      code: 'INVALID_ORIGIN',
    })
    expect(res.headers.get('x-request-id')).toBe('req_test_123')
  })

  it('allows state-changing webhook requests without origin checks', async () => {
    mockVerifyMiddlewareToken.mockResolvedValue(null)

    const req = makeRequest('https://app.tovis.app/api/webhooks/stripe')

    Object.defineProperty(req, 'method', {
      value: 'POST',
    })

    const res = await proxy(req)

    expect(res.status).toBe(200)
    expect(res.headers.get('location')).toBeNull()
    expect(res.headers.get('x-middleware-rewrite')).toBeNull()
    expect(res.headers.get('x-request-id')).toBe('req_test_123')
  })

  it('allows health requests without origin checks', async () => {
    mockVerifyMiddlewareToken.mockResolvedValue(null)

    const req = makeRequest('https://app.tovis.app/api/health/ready')

    Object.defineProperty(req, 'method', {
      value: 'POST',
    })

    const res = await proxy(req)

    expect(res.status).toBe(200)
    expect(res.headers.get('x-request-id')).toBe('req_test_123')
  })

  it('uses referer origin when origin header is missing', async () => {
    mockVerifyMiddlewareToken.mockResolvedValue({
      userId: 'user_1',
      role: 'CLIENT',
      sessionKind: 'ACTIVE',
      authVersion: 1,
    })

    const req = makeRequest('https://app.tovis.app/api/v1/client/settings', {
      headers: {
        referer: 'https://app.tovis.app/client/settings',
      },
      cookie: 'tovis_token=test_active_token',
    })

    Object.defineProperty(req, 'method', {
      value: 'DELETE',
    })

    const res = await proxy(req)

    expect(res.status).toBe(200)
    expect(res.headers.get('x-request-id')).toBe('req_test_123')
  })

  it('does not origin-check GET requests', async () => {
    mockVerifyMiddlewareToken.mockResolvedValue({
      userId: 'user_1',
      role: 'CLIENT',
      sessionKind: 'ACTIVE',
      authVersion: 1,
    })

    const req = makeRequest('https://app.tovis.app/api/v1/client/settings', {
      headers: {
        origin: 'https://evil.example',
      },
      cookie: 'tovis_token=test_active_token',
    })

    const res = await proxy(req)

    expect(res.status).toBe(200)
    expect(res.headers.get('x-request-id')).toBe('req_test_123')
  })

  // --- Native bearer-token CSRF carve-out (proxy.ts:262-283) ---
  // The Origin/Referer check is the CSRF defense and only matters for the
  // cookie session. A request authenticated purely by bearer header (no auth
  // cookie) is not CSRF-able and sends no Origin/Referer, so the check is
  // skipped for it. These guard that the carve-out (a) lets native through and
  // (b) cannot be tricked into disabling the check whenever a cookie is present.

  it('allows bearer-only state-changing requests with no Origin/Referer (native carve-out)', async () => {
    mockVerifyMiddlewareToken.mockResolvedValue({
      userId: 'user_1',
      role: 'CLIENT',
      sessionKind: 'ACTIVE',
      authVersion: 1,
    })

    const req = makeRequest('https://app.tovis.app/api/v1/client/settings', {
      headers: {
        authorization: 'Bearer native_bearer_token',
      },
    })

    Object.defineProperty(req, 'method', { value: 'POST' })

    const res = await proxy(req)

    // Origin check is skipped, and the bearer token is what gets verified.
    expect(mockVerifyMiddlewareToken).toHaveBeenCalledWith('native_bearer_token')
    expect(res.status).toBe(200)
    expect(res.headers.get('x-request-id')).toBe('req_test_123')
  })

  it('allows bearer-only state-changing requests even with a foreign Origin', async () => {
    mockVerifyMiddlewareToken.mockResolvedValue({
      userId: 'user_1',
      role: 'CLIENT',
      sessionKind: 'ACTIVE',
      authVersion: 1,
    })

    const req = makeRequest('https://app.tovis.app/api/v1/client/settings', {
      headers: {
        authorization: 'Bearer native_bearer_token',
        origin: 'https://evil.example',
      },
    })

    Object.defineProperty(req, 'method', { value: 'POST' })

    const res = await proxy(req)

    // No cookie ⇒ not CSRF-able ⇒ the foreign Origin is irrelevant.
    expect(res.status).toBe(200)
    expect(res.headers.get('x-request-id')).toBe('req_test_123')
  })

  it('still origin-checks when a cookie rides along with a bearer header (cookie wins)', async () => {
    mockVerifyMiddlewareToken.mockResolvedValue({
      userId: 'user_1',
      role: 'CLIENT',
      sessionKind: 'ACTIVE',
      authVersion: 1,
    })

    const req = makeRequest('https://app.tovis.app/api/v1/client/settings', {
      headers: {
        authorization: 'Bearer attacker_supplied_token',
        origin: 'https://evil.example',
      },
      cookie: 'tovis_token=test_active_token',
    })

    Object.defineProperty(req, 'method', { value: 'POST' })

    const res = await proxy(req)
    const body = await res.json()

    // A cookie is present, so the browser is in play and the check still runs —
    // attaching a bearer header cannot disable CSRF protection.
    expect(res.status).toBe(403)
    expect(body).toEqual({
      ok: false,
      error: 'Invalid request origin.',
      code: 'INVALID_ORIGIN',
    })
    expect(res.headers.get('x-request-id')).toBe('req_test_123')
  })

  it('rejects cookie+bearer state-changing requests with no Origin/Referer', async () => {
    mockVerifyMiddlewareToken.mockResolvedValue({
      userId: 'user_1',
      role: 'CLIENT',
      sessionKind: 'ACTIVE',
      authVersion: 1,
    })

    const req = makeRequest('https://app.tovis.app/api/v1/client/settings', {
      headers: {
        authorization: 'Bearer attacker_supplied_token',
      },
      cookie: 'tovis_token=test_active_token',
    })

    Object.defineProperty(req, 'method', { value: 'POST' })

    const res = await proxy(req)
    const body = await res.json()

    expect(res.status).toBe(403)
    expect(body).toEqual({
      ok: false,
      error: 'Invalid request origin.',
      code: 'INVALID_ORIGIN',
    })
    expect(res.headers.get('x-request-id')).toBe('req_test_123')
  })

  // The login bootstrap: a native client has no cookie AND no token yet (login
  // is how it GETS one), and sends no Origin/Referer. This must pass the CSRF
  // gate — otherwise native can never sign in.
  it('allows cookieless state-changing requests with no token and no Origin/Referer (native login bootstrap)', async () => {
    mockVerifyMiddlewareToken.mockResolvedValue(null)

    const req = makeRequest('https://app.tovis.app/api/v1/auth/login')

    Object.defineProperty(req, 'method', { value: 'POST' })

    const res = await proxy(req)

    // No 403 — the request reaches the route handler.
    expect(res.status).toBe(200)
    expect(res.headers.get('x-request-id')).toBe('req_test_123')
  })

  // A browser, even with no auth cookie, is forced to attach an Origin on a
  // cross-site POST — so a cookieless request that DOES carry a foreign Origin
  // (a login-CSRF attempt) is still rejected.
  it('still rejects cookieless state-changing requests that carry a foreign Origin', async () => {
    mockVerifyMiddlewareToken.mockResolvedValue(null)

    const req = makeRequest('https://app.tovis.app/api/v1/auth/login', {
      headers: {
        origin: 'https://evil.example',
      },
    })

    Object.defineProperty(req, 'method', { value: 'POST' })

    const res = await proxy(req)
    const body = await res.json()

    expect(res.status).toBe(403)
    expect(body).toEqual({
      ok: false,
      error: 'Invalid request origin.',
      code: 'INVALID_ORIGIN',
    })
  })
})