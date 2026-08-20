// lib/stripe/keyMode.test.ts

import { describe, expect, it } from 'vitest'

import { stripeKeyMode, stripeKeyModesAgree } from './keyMode'

describe('stripeKeyMode', () => {
  it('reads the mode out of every key KIND, not just publishable', () => {
    // The mode is the second segment, so a restricted key resolves like any
    // other. Matching on `pk_`/`sk_` alone would silently return
    // `unrecognized` for a perfectly valid restricted key.
    expect(stripeKeyMode('pk_test_51TTTJabc')).toBe('test')
    expect(stripeKeyMode('sk_test_51TTTJabc')).toBe('test')
    expect(stripeKeyMode('rk_test_51TTTJabc')).toBe('test')
    expect(stripeKeyMode('pk_live_51TTTJabc')).toBe('live')
    expect(stripeKeyMode('sk_live_51TTTJabc')).toBe('live')
    expect(stripeKeyMode('rk_live_51TTTJabc')).toBe('live')
  })

  it('separates "unset" from "set to nonsense"', () => {
    expect(stripeKeyMode(undefined)).toBe('missing')
    expect(stripeKeyMode(null)).toBe('missing')
    expect(stripeKeyMode('')).toBe('missing')
    expect(stripeKeyMode('   ')).toBe('missing')
    expect(stripeKeyMode('not-a-stripe-key')).toBe('unrecognized')
    // A truncated/placeholder value is configured-wrong, not unconfigured.
    expect(stripeKeyMode('pk_')).toBe('unrecognized')
    expect(stripeKeyMode('your-key-here')).toBe('unrecognized')
  })

  it('tolerates surrounding whitespace from a pasted env value', () => {
    expect(stripeKeyMode('  sk_live_51TTTJabc\n')).toBe('live')
  })
})

describe('stripeKeyModesAgree', () => {
  it('is true only when both keys resolved to the SAME mode', () => {
    expect(stripeKeyModesAgree('test', 'test')).toBe(true)
    expect(stripeKeyModesAgree('live', 'live')).toBe(true)
  })

  it('is false for a mismatched pair — the case that cannot take a payment', () => {
    expect(stripeKeyModesAgree('test', 'live')).toBe(false)
    expect(stripeKeyModesAgree('live', 'test')).toBe(false)
  })

  it('is null — not false — when either side never resolved', () => {
    // `false` would read as "these disagree", which is a different and much
    // more alarming fact than "one of them is not configured".
    for (const unresolved of ['missing', 'unrecognized'] as const) {
      expect(stripeKeyModesAgree(unresolved, 'live')).toBeNull()
      expect(stripeKeyModesAgree('live', unresolved)).toBeNull()
      expect(stripeKeyModesAgree(unresolved, unresolved)).toBeNull()
    }
  })
})
