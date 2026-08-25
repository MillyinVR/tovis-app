// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  clearSocialSignup,
  readSocialSignup,
  stashSocialSignup,
} from './socialSignupHandoff'
import type { SocialSignupHandoff } from './submitSocialToken'

const STORAGE_KEY = 'tovis:social-signup-ticket'

function ticket(overrides: Partial<SocialSignupHandoff> = {}): SocialSignupHandoff {
  return {
    provider: 'google',
    signupTicket: 'tid.secret',
    ticketExpiresAt: '2026-08-25T12:15:00.000Z',
    prefill: { email: 'new@example.com', firstName: 'Ada', lastName: 'Lovelace' },
    ...overrides,
  }
}

/** Ten minutes before the fixture's expiry. */
const BEFORE_EXPIRY = new Date('2026-08-25T12:05:00.000Z')
const AFTER_EXPIRY = new Date('2026-08-25T12:15:00.001Z')

beforeEach(() => {
  window.sessionStorage.clear()
})

afterEach(() => {
  vi.unstubAllGlobals()
  window.sessionStorage.clear()
})

describe('socialSignupHandoff', () => {
  it('round-trips a ticket that has not expired', () => {
    expect(stashSocialSignup(ticket())).toBe(true)
    expect(readSocialSignup(BEFORE_EXPIRY)).toEqual(ticket())
  })

  it('never puts the ticket in the URL', () => {
    stashSocialSignup(ticket())
    expect(window.location.search).toBe('')
    expect(window.location.href).not.toContain('tid.secret')
  })

  // The completion form must not post a ticket the server is certain to
  // refuse: burning the round trip only to be told "start again" is strictly
  // worse than saying so before it is sent.
  it('drops a ticket whose own expiry has passed, and removes it', () => {
    stashSocialSignup(ticket())
    expect(readSocialSignup(AFTER_EXPIRY)).toBeNull()
    expect(window.sessionStorage.getItem(STORAGE_KEY)).toBeNull()
  })

  it('treats the expiry instant itself as expired', () => {
    stashSocialSignup(ticket())
    expect(readSocialSignup(new Date('2026-08-25T12:15:00.000Z'))).toBeNull()
  })

  // A refresh mid-typing must not cost a live ticket.
  it('survives being read more than once', () => {
    stashSocialSignup(ticket())
    expect(readSocialSignup(BEFORE_EXPIRY)).not.toBeNull()
    expect(readSocialSignup(BEFORE_EXPIRY)).not.toBeNull()
  })

  it('returns null and clears when the stored value is not JSON', () => {
    window.sessionStorage.setItem(STORAGE_KEY, 'not json')
    expect(readSocialSignup(BEFORE_EXPIRY)).toBeNull()
    expect(window.sessionStorage.getItem(STORAGE_KEY)).toBeNull()
  })

  it.each([
    ['provider', { provider: 'facebook' }],
    ['signupTicket', { signupTicket: '' }],
    ['ticketExpiresAt', { ticketExpiresAt: '' }],
  ])('returns null when %s is unusable', (_label, overrides) => {
    window.sessionStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ ...ticket(), ...overrides }),
    )
    expect(readSocialSignup(BEFORE_EXPIRY)).toBeNull()
  })

  it('returns null when the prefill has no email', () => {
    window.sessionStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ ...ticket(), prefill: { firstName: 'Ada' } }),
    )
    expect(readSocialSignup(BEFORE_EXPIRY)).toBeNull()
  })

  it('returns null when the expiry is not a date at all', () => {
    window.sessionStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ ...ticket(), ticketExpiresAt: 'soon' }),
    )
    expect(readSocialSignup(BEFORE_EXPIRY)).toBeNull()
  })

  it('clears on request', () => {
    stashSocialSignup(ticket())
    clearSocialSignup()
    expect(readSocialSignup(BEFORE_EXPIRY)).toBeNull()
  })

  // Private modes and "block site data" throw on the ACCESSOR, before any
  // read or write — so the caller has to be told the stash did not happen
  // rather than navigating to a form with no ticket in it.
  it('reports failure instead of throwing when storage is blocked', () => {
    const original = Object.getOwnPropertyDescriptor(window, 'sessionStorage')
    Object.defineProperty(window, 'sessionStorage', {
      configurable: true,
      get() {
        throw new Error('SecurityError')
      },
    })

    try {
      expect(stashSocialSignup(ticket())).toBe(false)
      expect(readSocialSignup(BEFORE_EXPIRY)).toBeNull()
      expect(() => clearSocialSignup()).not.toThrow()
    } finally {
      if (original) {
        Object.defineProperty(window, 'sessionStorage', original)
      } else {
        Reflect.deleteProperty(window, 'sessionStorage')
      }
    }
  })
})
