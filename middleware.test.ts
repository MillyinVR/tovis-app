import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mockVerifyMiddlewareToken = vi.hoisted(() => vi.fn())

vi.mock('@/lib/auth/middlewareToken', () => ({
  verifyMiddlewareToken: mockVerifyMiddlewareToken,
}))

import { middleware } from './middleware'

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

describe('middleware', () => {
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

    const res = await middleware(req)

    expect(mockVerifyMiddlewareToken).toHaveBeenCalledWith(
      'test_verification_token',
    )
    expect(res.status).toBe(307)
    expect(res.headers.get('location')).toBe(
      'https://app.tovis.app/verify-phone?next=%2Flooks%3Ftab%3Dsaved',
    )
    expect(res.headers.get('x-request-id')).toBe('req_test_123')
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

    const res = await middleware(req)
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

    const res = await middleware(req)

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

    const res = await middleware(req)

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

    const res = await middleware(req)

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

    const res = await middleware(req)

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

    const res = await middleware(req)

    expect(res.status).toBe(200)
    expect(res.headers.get('location')).toBeNull()
    expect(res.headers.get('x-middleware-rewrite')).toContain(
      '/p/tori/services',
    )
    expect(res.headers.get('x-request-id')).toBe('req_test_123')
  })

  it('passes through normal requests when there is no valid auth token', async () => {
    mockVerifyMiddlewareToken.mockResolvedValue(null)

    const req = makeRequest('https://app.tovis.app/login')

    const res = await middleware(req)

    expect(mockVerifyMiddlewareToken).toHaveBeenCalledWith(null)
    expect(res.status).toBe(200)
    expect(res.headers.get('location')).toBeNull()
    expect(res.headers.get('x-middleware-rewrite')).toBeNull()
    expect(res.headers.get('x-request-id')).toBe('req_test_123')
  })
})