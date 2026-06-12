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

    const req = makeRequest('https://app.tovis.app/api/pro/profile', {
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
      'https://app.tovis.app/api/auth/verification/status',
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

    const req = makeRequest('https://tori.tovis.me/api/pro/profile', {
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

    const req = makeRequest('https://app.tovis.app/api/client/settings', {
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

    const req = makeRequest('https://app.tovis.app/api/admin/services', {
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

    const req = makeRequest('https://tori.tovis.me/api/pro/profile', {
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

    const req = makeRequest('https://app.tovis.app/api/client/settings', {
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

    const req = makeRequest('https://app.tovis.app/api/client/settings', {
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

    const req = makeRequest('https://app.tovis.app/api/client/settings', {
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

    const req = makeRequest('https://app.tovis.app/api/client/settings', {
      headers: {
        origin: 'https://evil.example',
      },
      cookie: 'tovis_token=test_active_token',
    })

    const res = await proxy(req)

    expect(res.status).toBe(200)
    expect(res.headers.get('x-request-id')).toBe('req_test_123')
  })
})