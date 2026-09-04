import { describe, expect, it } from 'vitest'

import {
  resolvePostAuthNavigation,
  sanitizeInternalPath,
  sanitizeRedirectTarget,
} from './postAuthRedirect'

const base = { nextSafe: null, fromSafe: null }

function data(overrides: Record<string, unknown> = {}) {
  return {
    user: { id: 'u', email: 'a@b.com', role: 'CLIENT' },
    nextUrl: null,
    isPhoneVerified: true,
    isEmailVerified: true,
    isFullyVerified: true,
    ...overrides,
  }
}

describe('resolvePostAuthNavigation', () => {
  it('returns missing-role when the response has no usable role', () => {
    expect(resolvePostAuthNavigation({ user: {} }, base)).toEqual({
      kind: 'missing-role',
    })
  })

  it('sends a fully-verified client to their role home (/looks)', () => {
    expect(resolvePostAuthNavigation(data(), base)).toEqual({
      kind: 'navigate',
      url: '/looks',
    })
  })

  it('honors a safe nextUrl from the response body', () => {
    expect(
      resolvePostAuthNavigation(data({ nextUrl: '/client/offers' }), base),
    ).toEqual({ kind: 'navigate', url: '/client/offers' })
  })

  it('ignores an auth-path nextUrl and falls back to the query next', () => {
    expect(
      resolvePostAuthNavigation(data({ nextUrl: '/login' }), {
        nextSafe: '/looks/abc',
        fromSafe: null,
      }),
    ).toEqual({ kind: 'navigate', url: '/looks/abc' })
  })

  it('diverts an un-verified client to phone verification, preserving dest', () => {
    expect(
      resolvePostAuthNavigation(
        data({ isPhoneVerified: false, isFullyVerified: false }),
        base,
      ),
    ).toEqual({
      kind: 'navigate',
      url: '/verify-phone?next=%2Flooks',
    })
  })

  it('blocks a not-fully-verified admin with an error', () => {
    const result = resolvePostAuthNavigation(
      {
        user: { id: 'a', role: 'ADMIN' },
        isPhoneVerified: false,
        isEmailVerified: false,
        isFullyVerified: false,
      },
      base,
    )
    expect(result.kind).toBe('error')
  })

  it('normalizes a bare /pro landing for pros to the calendar home', () => {
    expect(
      resolvePostAuthNavigation(
        { user: { role: 'PRO' }, isFullyVerified: true },
        { nextSafe: '/pro', fromSafe: null },
      ),
    ).toEqual({ kind: 'navigate', url: '/pro/calendar' })
  })
})

/**
 * `/\` starts with exactly ONE slash, so the old `startsWith('//')` rule let it
 * through — and the URL parser resolves it to a different HOST, which made
 * `/login?from=/\evil.example` a live open redirect. Asserted at the login
 * screen, not only on the shared helper, because this is the sink that mattered.
 */
describe('post-auth redirect refuses off-origin `from` values', () => {
  function landingFor(loginUrl: string): string | null {
    const fromRaw = new URL(loginUrl, 'https://app.tovis.app').searchParams.get(
      'from',
    )
    const fromSafe = sanitizeRedirectTarget(sanitizeInternalPath(fromRaw))
    const nav = resolvePostAuthNavigation(
      {
        user: { role: 'CLIENT' },
        isPhoneVerified: true,
        isEmailVerified: true,
        isFullyVerified: true,
      },
      { nextSafe: null, fromSafe },
    )
    return nav.kind === 'navigate' ? nav.url : null
  }

  it('a backslash path resolves off-origin, and is now refused', () => {
    expect(new URL('/\\evil.example/x', 'https://app.tovis.app').host).toBe(
      'evil.example',
    )
    expect(sanitizeInternalPath('/\\evil.example/x')).toBeNull()
    expect(landingFor('/login?from=%2F%5Cevil.example%2Fx')).toBe('/looks')
  })

  it('still refuses the shapes it always did', () => {
    expect(landingFor('/login?from=%2F%2Fevil.example%2Fx')).toBe('/looks')
    expect(landingFor('/login?from=https%3A%2F%2Fevil.example')).toBe('/looks')
    expect(landingFor('/login?from=%2Flogin%3Ffrom%3D%2Fclient')).toBe('/looks')
  })

  it('still lets a genuine internal path through', () => {
    expect(landingFor('/login?from=%2Fclient%2Fbookings%2Fb1%3Fstep%3Daftercare')).toBe(
      '/client/bookings/b1?step=aftercare',
    )
  })
})
