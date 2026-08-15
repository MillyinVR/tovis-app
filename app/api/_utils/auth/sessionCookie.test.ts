// app/api/_utils/auth/sessionCookie.test.ts
import { describe, expect, it } from 'vitest'

import {
  clearSessionCookie,
  getRequestHostname,
  resolveCookieDomain,
  resolveIsHttps,
  setSessionCookie,
} from '@/app/api/_utils/auth/sessionCookie'

type RecordedCookie = {
  name: string
  value: string
  options: {
    httpOnly: boolean
    secure: boolean
    sameSite: 'lax'
    path: string
    maxAge: number
    domain?: string
  }
}

function fakeResponse() {
  const written: RecordedCookie[] = []

  return {
    written,
    cookies: {
      set: (
        name: string,
        value: string,
        options: RecordedCookie['options'],
      ) => {
        written.push({ name, value, options })
      },
    },
  }
}

function req(
  url: string,
  headers: Record<string, string> = {},
): Request {
  return new Request(url, { headers })
}

describe('resolveCookieDomain', () => {
  it('scopes tovis.app and its subdomains to .tovis.app', () => {
    expect(resolveCookieDomain('tovis.app')).toBe('.tovis.app')
    expect(resolveCookieDomain('www.tovis.app')).toBe('.tovis.app')
    expect(resolveCookieDomain('book.staging.tovis.app')).toBe('.tovis.app')
  })

  it('scopes tovis.me and its subdomains to .tovis.me', () => {
    expect(resolveCookieDomain('tovis.me')).toBe('.tovis.me')
    expect(resolveCookieDomain('jane.tovis.me')).toBe('.tovis.me')
  })

  it('returns undefined (host-only cookie) for anything else', () => {
    expect(resolveCookieDomain('localhost')).toBeUndefined()
    expect(resolveCookieDomain('tovis-app.vercel.app')).toBeUndefined()
    expect(resolveCookieDomain(null)).toBeUndefined()
    expect(resolveCookieDomain('')).toBeUndefined()
  })

  // A look-alike host must NOT be handed a cookie scoped to the real domain.
  it('does not match a host that merely ends in the same letters', () => {
    expect(resolveCookieDomain('nottovis.app')).toBeUndefined()
    expect(resolveCookieDomain('eviltovis.me')).toBeUndefined()
    expect(resolveCookieDomain('tovis.app.evil.example')).toBeUndefined()
  })
})

describe('getRequestHostname', () => {
  it('prefers x-forwarded-host over host', () => {
    expect(
      getRequestHostname(
        req('https://internal/x', {
          host: 'internal',
          'x-forwarded-host': 'tovis.app',
        }),
      ),
    ).toBe('tovis.app')
  })

  it('strips the port', () => {
    expect(getRequestHostname(req('http://x/', { host: 'localhost:3000' }))).toBe(
      'localhost',
    )
  })

  it('takes the first entry of a comma-separated list and lowercases it', () => {
    expect(
      getRequestHostname(req('http://x/', { host: 'TOVIS.app, proxy.internal' })),
    ).toBe('tovis.app')
  })

  it('unwraps an IPv6 literal', () => {
    expect(getRequestHostname(req('http://x/', { host: '[::1]:3000' }))).toBe('::1')
  })

  it('returns null when there is no host header', () => {
    expect(getRequestHostname(req('http://x/'))).toBeNull()
  })
})

describe('resolveIsHttps', () => {
  it('trusts x-forwarded-proto when present', () => {
    expect(
      resolveIsHttps(req('http://x/', { 'x-forwarded-proto': 'https' })),
    ).toBe(true)
    expect(
      resolveIsHttps(req('https://x/', { 'x-forwarded-proto': 'http' })),
    ).toBe(false)
  })

  it('falls back to the request URL protocol', () => {
    expect(resolveIsHttps(req('https://tovis.app/api'))).toBe(true)
    expect(resolveIsHttps(req('http://localhost:3000/api'))).toBe(false)
  })
})

describe('setSessionCookie', () => {
  it('writes tovis_token with the host-derived domain and protocol-derived secure flag', () => {
    const response = fakeResponse()

    setSessionCookie({
      response,
      request: req('https://tovis.app/api/v1/auth/login', {
        host: 'tovis.app',
        'x-forwarded-proto': 'https',
      }),
      token: 'tok_123',
    })

    expect(response.written).toHaveLength(1)
    expect(response.written[0]).toEqual({
      name: 'tovis_token',
      value: 'tok_123',
      options: {
        httpOnly: true,
        secure: true,
        sameSite: 'lax',
        path: '/',
        maxAge: 60 * 60 * 24 * 7,
        domain: '.tovis.app',
      },
    })
  })

  it('omits the domain entirely on localhost', () => {
    const response = fakeResponse()

    setSessionCookie({
      response,
      request: req('http://localhost:3000/api/v1/auth/login', {
        host: 'localhost:3000',
      }),
      token: 'tok_123',
    })

    expect(response.written[0]?.options).not.toHaveProperty('domain')
    expect(response.written[0]?.options.secure).toBe(false)
  })
})

describe('clearSessionCookie', () => {
  it('expires the cookie', () => {
    const response = fakeResponse()

    clearSessionCookie({
      response,
      request: req('https://tovis.app/api/v1/auth/logout', {
        host: 'tovis.app',
      }),
    })

    expect(response.written[0]?.name).toBe('tovis_token')
    expect(response.written[0]?.value).toBe('')
    expect(response.written[0]?.options.maxAge).toBe(0)
  })

  // The reason set and clear live in one module: a browser keys a cookie by
  // (name, domain, path). Clear it with a different Domain and the original
  // survives — the user stays logged in after pressing log out.
  it('matches setSessionCookie on every attribute except maxAge', () => {
    const request = req('https://jane.tovis.me/api/v1/auth/logout', {
      host: 'jane.tovis.me',
      'x-forwarded-proto': 'https',
    })

    const setRes = fakeResponse()
    const clearRes = fakeResponse()

    setSessionCookie({ response: setRes, request, token: 'tok_123' })
    clearSessionCookie({ response: clearRes, request })

    const { maxAge: setMaxAge, ...setRest } = setRes.written[0]!.options
    const { maxAge: clearMaxAge, ...clearRest } = clearRes.written[0]!.options

    expect(clearRest).toEqual(setRest)
    expect(setRest.domain).toBe('.tovis.me')
    expect(setMaxAge).toBe(60 * 60 * 24 * 7)
    expect(clearMaxAge).toBe(0)
  })
})
