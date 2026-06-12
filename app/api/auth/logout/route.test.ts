// app/api/auth/logout/route.test.ts

import { describe, expect, it } from 'vitest'

import { POST } from './route'

function makeRequest(headers: Record<string, string> = {}): Request {
  return new Request('http://localhost/api/auth/logout', {
    method: 'POST',
    headers,
  })
}

function setCookieHeader(res: Response): string {
  return res.headers.get('set-cookie') ?? ''
}

describe('POST /api/auth/logout', () => {
  it('clears the auth token cookie', async () => {
    const res = await POST(makeRequest())
    const body = (await res.json()) as { ok: boolean }

    expect(res.status).toBe(200)
    expect(body.ok).toBe(true)

    const cookie = setCookieHeader(res)

    expect(cookie).toContain('tovis_token=')
    expect(cookie.toLowerCase()).toContain('max-age=0')
    expect(cookie.toLowerCase()).toContain('httponly')
    expect(cookie.toLowerCase()).toContain('path=/')
  })

  it('clears with the apex domain on tovis.app subdomains', async () => {
    const res = await POST(
      makeRequest({ host: 'www.tovis.app', 'x-forwarded-proto': 'https' }),
    )

    const cookie = setCookieHeader(res)

    expect(cookie.toLowerCase()).toContain('domain=.tovis.app')
    expect(cookie.toLowerCase()).toContain('secure')
  })

  it('clears with the apex domain on tovis.me', async () => {
    const res = await POST(makeRequest({ host: 'pro.tovis.me' }))

    expect(setCookieHeader(res).toLowerCase()).toContain('domain=.tovis.me')
  })

  it('uses a host-only cookie on localhost without the secure flag', async () => {
    const res = await POST(
      makeRequest({ host: 'localhost:3000', 'x-forwarded-proto': 'http' }),
    )

    const cookie = setCookieHeader(res)

    expect(cookie.toLowerCase()).not.toContain('domain=')
    expect(cookie.toLowerCase()).not.toContain('secure')
  })

  it('prefers x-forwarded-host over host', async () => {
    const res = await POST(
      makeRequest({
        host: 'internal-proxy:8080',
        'x-forwarded-host': 'app.tovis.app',
      }),
    )

    expect(setCookieHeader(res).toLowerCase()).toContain('domain=.tovis.app')
  })

  it('handles IPv6 host headers without crashing', async () => {
    const res = await POST(makeRequest({ host: '[::1]:3000' }))

    expect(res.status).toBe(200)
    expect(setCookieHeader(res).toLowerCase()).not.toContain('domain=')
  })
})
