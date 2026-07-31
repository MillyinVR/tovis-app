import { describe, expect, it } from 'vitest'

import {
  CONSENT_SIGNATURE_NAME_MAX,
  parseConsentSignatureName,
} from './signatureName'

describe('parseConsentSignatureName', () => {
  it('accepts an ordinary name and collapses whitespace', () => {
    expect(parseConsentSignatureName('  Amara   Morales ')).toBe(
      'Amara Morales',
    )
  })

  it('accepts two characters — initials are a real signature', () => {
    expect(parseConsentSignatureName('AM')).toBe('AM')
  })

  it('rejects a stray keypress', () => {
    expect(parseConsentSignatureName('a')).toBeNull()
    expect(parseConsentSignatureName('   ')).toBeNull()
    expect(parseConsentSignatureName('')).toBeNull()
  })

  it('rejects non-strings rather than coercing them', () => {
    expect(parseConsentSignatureName(null)).toBeNull()
    expect(parseConsentSignatureName(undefined)).toBeNull()
    expect(parseConsentSignatureName(42)).toBeNull()
    expect(parseConsentSignatureName({ name: 'Amara' })).toBeNull()
  })

  it('REFUSES an over-long name rather than truncating it', () => {
    // Truncating would store a signature the client did not give.
    const tooLong = 'a'.repeat(CONSENT_SIGNATURE_NAME_MAX + 1)
    expect(parseConsentSignatureName(tooLong)).toBeNull()

    const atLimit = 'a'.repeat(CONSENT_SIGNATURE_NAME_MAX)
    expect(parseConsentSignatureName(atLimit)).toBe(atLimit)
  })

  it('measures the length AFTER collapsing, so padding cannot fail a valid name', () => {
    const name = 'b'.repeat(CONSENT_SIGNATURE_NAME_MAX)
    expect(parseConsentSignatureName(`   ${name}   `)).toBe(name)
  })
})
