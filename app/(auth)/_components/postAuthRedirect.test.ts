import { describe, expect, it } from 'vitest'

import { resolvePostAuthNavigation } from './postAuthRedirect'

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
