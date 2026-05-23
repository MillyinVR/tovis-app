// lib/security/crypto/hashLookup.test.ts
import { describe, expect, it } from 'vitest'

import {
  emailLookupHash,
  normalizeEmailForLookup,
  normalizePhoneForLookup,
  phoneLookupHash,
  sha256Hex,
} from './hashLookup'

describe('normalizeEmailForLookup', () => {
  it('trims and lowercases email addresses', () => {
    expect(normalizeEmailForLookup('  Tori@Example.COM  ')).toBe(
      'tori@example.com',
    )
  })

  it('preserves provider-specific local-part details', () => {
    expect(normalizeEmailForLookup('First.Last+tag@gmail.com')).toBe(
      'first.last+tag@gmail.com',
    )
  })

  it('rejects nullish and empty values', () => {
    expect(normalizeEmailForLookup(null)).toBeNull()
    expect(normalizeEmailForLookup(undefined)).toBeNull()
    expect(normalizeEmailForLookup('')).toBeNull()
    expect(normalizeEmailForLookup('   ')).toBeNull()
  })

  it('rejects malformed email values', () => {
    expect(normalizeEmailForLookup('not-an-email')).toBeNull()
    expect(normalizeEmailForLookup('@example.com')).toBeNull()
    expect(normalizeEmailForLookup('tori@')).toBeNull()
    expect(normalizeEmailForLookup('tori@@example.com')).toBeNull()
    expect(normalizeEmailForLookup('tori@example')).toBeNull()
    expect(normalizeEmailForLookup('tori@.example.com')).toBeNull()
    expect(normalizeEmailForLookup('tori@example.com ')).toBe(
      'tori@example.com',
    )
    expect(normalizeEmailForLookup('tori @example.com')).toBeNull()
  })
})

describe('normalizePhoneForLookup', () => {
  it('normalizes formatted US phone numbers to E.164', () => {
    expect(normalizePhoneForLookup('(555) 123-4567')).toBe('+15551234567')
    expect(normalizePhoneForLookup('555.123.4567')).toBe('+15551234567')
    expect(normalizePhoneForLookup('555 123 4567')).toBe('+15551234567')
  })

  it('preserves valid leading plus international-style numbers', () => {
    expect(normalizePhoneForLookup('+44 20 7946 0958')).toBe('+442079460958')
  })

  it('normalizes 11-digit NANP numbers beginning with 1', () => {
    expect(normalizePhoneForLookup('1-555-123-4567')).toBe('+15551234567')
  })

  it('normalizes other international-looking numbers without plus', () => {
    expect(normalizePhoneForLookup('442079460958')).toBe('+442079460958')
  })

  it('rejects nullish, empty, too-short, and too-long values', () => {
    expect(normalizePhoneForLookup(null)).toBeNull()
    expect(normalizePhoneForLookup(undefined)).toBeNull()
    expect(normalizePhoneForLookup('')).toBeNull()
    expect(normalizePhoneForLookup('   ')).toBeNull()
    expect(normalizePhoneForLookup('123')).toBeNull()
    expect(normalizePhoneForLookup('+1234567890123456')).toBeNull()
  })
})

describe('sha256Hex', () => {
  it('returns a stable lowercase SHA-256 hex digest', () => {
    expect(sha256Hex('tori@example.com')).toBe(
      '0c033774330f6d7cafc32205bfc9b73f86b3841154f24cc838c142d949aa4fc4',
    )
  })

  it('returns a 64-character hex string', () => {
    expect(sha256Hex('+15551234567')).toMatch(/^[a-f0-9]{64}$/)
  })
})

describe('lookup hash helpers', () => {
  it('hashes normalized emails', () => {
    expect(emailLookupHash(' Tori@Example.COM ')).toBe(
      sha256Hex('tori@example.com'),
    )
  })

  it('returns null for invalid emails', () => {
    expect(emailLookupHash('not-an-email')).toBeNull()
  })

  it('hashes normalized phones', () => {
    expect(phoneLookupHash('(555) 123-4567')).toBe(
      sha256Hex('+15551234567'),
    )
  })

  it('returns null for invalid phones', () => {
    expect(phoneLookupHash('123')).toBeNull()
  })
})