// lib/security/crypto/hashLookup.test.ts
import { beforeEach, describe, expect, it } from 'vitest'

import {
  normalizeEmailForLookup,
  normalizePhoneForLookup,
} from '@/lib/security/contactNormalization'

import {
  clearContactLookupHmacKeyringCacheForTests,
  CONTACT_LOOKUP_HMAC_KEY_VERSION,
  contactLookupHmacHex,
  emailLookupHash,
  emailLookupHashV2,
  legacySha256Hex,
  phoneLookupHash,
  phoneLookupHashV2,
  sha256Hex,
} from './hashLookup'

const TEST_HMAC_KEY = Buffer.alloc(32, 7).toString('base64')

beforeEach(() => {
  process.env.PII_LOOKUP_HMAC_KEYS_JSON = JSON.stringify({
    [CONTACT_LOOKUP_HMAC_KEY_VERSION]: TEST_HMAC_KEY,
  })

  clearContactLookupHmacKeyringCacheForTests()
})

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

  it('normalizes valid leading plus international-style numbers', () => {
    expect(normalizePhoneForLookup('+44 20 7946 0958')).toBe('+442079460958')
  })

  it('normalizes 11-digit NANP numbers beginning with 1', () => {
    expect(normalizePhoneForLookup('1-555-123-4567')).toBe('+15551234567')
  })

  it('normalizes other international-looking numbers without plus', () => {
    expect(normalizePhoneForLookup('442079460958')).toBe('+442079460958')
  })

  it('rejects nullish, empty, too-short, too-long, and all-zero values', () => {
    expect(normalizePhoneForLookup(null)).toBeNull()
    expect(normalizePhoneForLookup(undefined)).toBeNull()
    expect(normalizePhoneForLookup('')).toBeNull()
    expect(normalizePhoneForLookup('   ')).toBeNull()
    expect(normalizePhoneForLookup('123')).toBeNull()
    expect(normalizePhoneForLookup('+1234567890123456')).toBeNull()
    expect(normalizePhoneForLookup('0000000000')).toBeNull()
  })

  it('rejects alphabetic and extension-bearing values', () => {
    expect(normalizePhoneForLookup('555-FLOWERS')).toBeNull()
    expect(normalizePhoneForLookup('555-123-4567 ext 9')).toBeNull()
    expect(normalizePhoneForLookup('555-123-4567 x9')).toBeNull()
  })
})

describe('legacy SHA-256 helpers', () => {
  it('returns a stable lowercase SHA-256 hex digest', () => {
    expect(sha256Hex('tori@example.com')).toBe(
      '0c033774330f6d7cafc32205bfc9b73f86b3841154f24cc838c142d949aa4fc4',
    )
  })

  it('keeps sha256Hex as an alias for legacySha256Hex', () => {
    expect(sha256Hex('+15551234567')).toBe(
      legacySha256Hex('+15551234567'),
    )
  })

  it('returns a 64-character hex string', () => {
    expect(sha256Hex('+15551234567')).toMatch(/^[a-f0-9]{64}$/u)
  })
})

describe('legacy lookup hash helpers', () => {
  it('hashes normalized emails with legacy SHA-256', () => {
    expect(emailLookupHash(' Tori@Example.COM ')).toBe(
      sha256Hex('tori@example.com'),
    )
  })

  it('returns null for invalid emails', () => {
    expect(emailLookupHash('not-an-email')).toBeNull()
  })

  it('hashes normalized phones with legacy SHA-256', () => {
    expect(phoneLookupHash('(555) 123-4567')).toBe(
      sha256Hex('+15551234567'),
    )
  })

  it('returns null for invalid phones', () => {
    expect(phoneLookupHash('123')).toBeNull()
  })
})

describe('contactLookupHmacHex', () => {
  it('returns a stable v2 HMAC hash with key version', () => {
    const first = contactLookupHmacHex({
      normalizedValue: 'tori@example.com',
    })
    const second = contactLookupHmacHex({
      normalizedValue: 'tori@example.com',
    })

    expect(first).toEqual(second)
    expect(first).toEqual({
      hash: expect.stringMatching(/^[a-f0-9]{64}$/u),
      keyVersion: CONTACT_LOOKUP_HMAC_KEY_VERSION,
    })
  })

  it('does not match the legacy SHA-256 hash', () => {
    const v2 = contactLookupHmacHex({
      normalizedValue: 'tori@example.com',
    })

    expect(v2.hash).not.toBe(sha256Hex('tori@example.com'))
  })

  it('throws when the HMAC key env is missing', () => {
    delete process.env.PII_LOOKUP_HMAC_KEYS_JSON
    clearContactLookupHmacKeyringCacheForTests()

    expect(() =>
      contactLookupHmacHex({
        normalizedValue: 'tori@example.com',
      }),
    ).toThrow('Missing required env PII_LOOKUP_HMAC_KEYS_JSON')
  })

  it('throws when the HMAC key is not 32 bytes', () => {
    process.env.PII_LOOKUP_HMAC_KEYS_JSON = JSON.stringify({
      [CONTACT_LOOKUP_HMAC_KEY_VERSION]: Buffer.alloc(16, 7).toString('base64'),
    })
    clearContactLookupHmacKeyringCacheForTests()

    expect(() =>
      contactLookupHmacHex({
        normalizedValue: 'tori@example.com',
      }),
    ).toThrow('must decode to 32 bytes')
  })
})

describe('v2 lookup hash helpers', () => {
  it('hashes normalized emails with HMAC v2', () => {
    const result = emailLookupHashV2(' Tori@Example.COM ')

    expect(result).toEqual({
      hash: expect.stringMatching(/^[a-f0-9]{64}$/u),
      keyVersion: CONTACT_LOOKUP_HMAC_KEY_VERSION,
    })

    expect(result?.hash).toBe(
      contactLookupHmacHex({ normalizedValue: 'tori@example.com' }).hash,
    )
  })

  it('returns null for invalid emails', () => {
    expect(emailLookupHashV2('not-an-email')).toBeNull()
  })

  it('hashes normalized phones with HMAC v2', () => {
    const result = phoneLookupHashV2('(555) 123-4567')

    expect(result).toEqual({
      hash: expect.stringMatching(/^[a-f0-9]{64}$/u),
      keyVersion: CONTACT_LOOKUP_HMAC_KEY_VERSION,
    })

    expect(result?.hash).toBe(
      contactLookupHmacHex({ normalizedValue: '+15551234567' }).hash,
    )
  })

  it('returns null for invalid phones', () => {
    expect(phoneLookupHashV2('123')).toBeNull()
  })
})