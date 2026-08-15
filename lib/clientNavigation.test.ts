// lib/clientNavigation.test.ts
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  currentPathWithQuery,
  loginHrefFromHere,
  sanitizeInternalPath,
} from '@/lib/clientNavigation'

/**
 * These run in the `node` environment (no `window`), so the browser branch is
 * driven by stubbing a minimal `window.location`. That also lets us assert the
 * SSR branch, which a jsdom test could not reach.
 */
function stubLocation(parts: {
  pathname: string
  search?: string
  hash?: string
}): void {
  vi.stubGlobal('window', {
    location: {
      pathname: parts.pathname,
      search: parts.search ?? '',
      hash: parts.hash ?? '',
    },
  })
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('currentPathWithQuery', () => {
  it('returns the fallback when there is no window (SSR)', () => {
    expect(currentPathWithQuery('/pro')).toBe('/pro')
    expect(currentPathWithQuery('/looks')).toBe('/looks')
  })

  it('joins pathname, search and hash', () => {
    stubLocation({ pathname: '/pro/clients', search: '?q=jane', hash: '#notes' })
    expect(currentPathWithQuery('/pro')).toBe('/pro/clients?q=jane#notes')
  })

  it('omits absent search and hash', () => {
    stubLocation({ pathname: '/looks' })
    expect(currentPathWithQuery('/pro')).toBe('/looks')
  })
})

describe('sanitizeInternalPath', () => {
  it('keeps an app-relative path', () => {
    expect(sanitizeInternalPath('/pro/calendar?day=3')).toBe('/pro/calendar?day=3')
  })

  it('returns null for blank or absent input', () => {
    expect(sanitizeInternalPath('')).toBeNull()
    expect(sanitizeInternalPath('   ')).toBeNull()
    expect(sanitizeInternalPath(null)).toBeNull()
    expect(sanitizeInternalPath(undefined)).toBeNull()
  })

  it('returns null for anything not starting with a slash', () => {
    expect(sanitizeInternalPath('https://evil.example/x')).toBeNull()
    expect(sanitizeInternalPath('javascript:alert(1)')).toBeNull()
    expect(sanitizeInternalPath('pro/clients')).toBeNull()
  })

  // The one that matters: `//evil.example` is a PROTOCOL-RELATIVE URL. It looks
  // like a path and passes a naive `startsWith('/')` check, but navigating to it
  // leaves the site — an open redirect.
  it('rejects a protocol-relative URL', () => {
    expect(sanitizeInternalPath('//evil.example/phish')).toBeNull()
    expect(sanitizeInternalPath('  //evil.example')).toBeNull()
  })
})

describe('loginHrefFromHere', () => {
  it('round-trips the current location as ?from', () => {
    stubLocation({ pathname: '/pro/clients/abc', search: '?tab=notes' })
    expect(loginHrefFromHere('/pro')).toBe(
      '/login?from=%2Fpro%2Fclients%2Fabc%3Ftab%3Dnotes',
    )
  })

  it('adds ?reason when given one', () => {
    stubLocation({ pathname: '/looks' })
    expect(loginHrefFromHere('/looks', 'like')).toBe('/login?from=%2Flooks&reason=like')
  })

  it('omits ?reason for an empty reason', () => {
    stubLocation({ pathname: '/looks' })
    expect(loginHrefFromHere('/looks', '')).toBe('/login?from=%2Flooks')
  })

  it('uses the fallback rather than an off-site location', () => {
    stubLocation({ pathname: '//evil.example' })
    expect(loginHrefFromHere('/pro', 'pro-session')).toBe(
      '/login?from=%2Fpro&reason=pro-session',
    )
  })

  it('uses the fallback under SSR', () => {
    expect(loginHrefFromHere('/pro/calendar', 'working-hours')).toBe(
      '/login?from=%2Fpro%2Fcalendar&reason=working-hours',
    )
  })
})
