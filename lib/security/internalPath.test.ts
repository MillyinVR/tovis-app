import { describe, expect, it } from 'vitest'

import { sanitizeInternalPath } from './internalPath'

describe('sanitizeInternalPath', () => {
  it('accepts ordinary internal paths unchanged', () => {
    for (const ok of [
      '/',
      '/looks',
      '/client/bookings/booking_1',
      '/client/bookings/booking_1?step=aftercare',
      '/pro/calendar?day=2026-09-04#slot',
      '/search?q=a%20b',
      // `..` is legitimate inside a query value — only the pathname is checked.
      '/looks?range=1..5',
    ]) {
      expect(sanitizeInternalPath(ok)).toBe(ok)
    }
  })

  it('trims, and returns the trimmed form', () => {
    expect(sanitizeInternalPath('  /looks  ')).toBe('/looks')
  })

  /**
   * The reason this module exists. `/\` starts with exactly one slash, so it
   * passed the `startsWith('//')` check that was the whole rule in thirteen
   * places — and browsers normalise the backslash to `/`, which makes it
   * protocol-relative and therefore OFF-SITE.
   */
  it('refuses a backslash path, which the URL parser resolves off-origin', () => {
    // The vulnerability, stated as the parser sees it.
    expect(new URL('/\\evil.example/x', 'https://app.tovis.app').host).toBe(
      'evil.example',
    )
    // And the check that now stops it.
    expect(sanitizeInternalPath('/\\evil.example/x')).toBeNull()
    expect(sanitizeInternalPath('/\\/evil.example')).toBeNull()
    expect(sanitizeInternalPath('/looks\\..\\admin')).toBeNull()
  })

  it('refuses protocol-relative and absolute URLs', () => {
    for (const bad of [
      '//evil.example',
      '//evil.example/x',
      'https://evil.example/x',
      'http://evil.example',
      'javascript:alert(1)',
      'data:text/html,x',
      'evil.example',
    ]) {
      expect(sanitizeInternalPath(bad)).toBeNull()
    }
  })

  it('refuses control characters, so CR/LF can never reach a Location header', () => {
    for (const bad of [
      '/looks\r\nSet-Cookie: a=b',
      '/looks\nX',
      '/looks\tX',
      '/looks\u0000',
      '/looks\u007f',
      '/loo ks',
    ]) {
      expect(sanitizeInternalPath(bad)).toBeNull()
    }
  })

  /**
   * Traversal is NOT refused — `/pro/../admin` is still a path on our own site,
   * and same-origin is all this function decides. What matters is that the
   * value handed back is where the browser will actually GO, so a caller that
   * confines to a prefix cannot be fooled by a string that resolves elsewhere.
   */
  it('resolves traversal rather than returning a path the browser will not visit', () => {
    expect(sanitizeInternalPath('/pro/../admin')).toBe('/admin')
    expect(sanitizeInternalPath('/pro/%2e%2e/admin')).toBe('/admin')
    expect(sanitizeInternalPath('/pro/./calendar')).toBe('/pro/calendar')
  })

  it('refuses blanks, non-strings and over-long values', () => {
    for (const bad of ['', '   ', null, undefined, 42, {}, [], true]) {
      expect(sanitizeInternalPath(bad)).toBeNull()
    }
    expect(sanitizeInternalPath('/' + 'a'.repeat(2048))).toBeNull()
    expect(sanitizeInternalPath('/' + 'a'.repeat(2046))).not.toBeNull()
  })

  it('accepts everything the two already-correct implementations accept', () => {
    // Mirrors the shapes lib/auth/sessionHandoff.ts and lib/shortLink/allowlist.ts
    // pass through, so consolidating on this rule cannot have loosened them.
    for (const ok of ['/pro', '/pro/calendar', '/pro/clients/abc?tab=notes']) {
      expect(sanitizeInternalPath(ok)).toBe(ok)
    }
  })
})
