// lib/security/contactLookup.test.ts
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  buildClientProfileContactLookupData,
  buildEmailLookupHashV2ForContactInput,
  buildPhoneLookupHashV2ForContactInput,
  buildUserContactLookupData,
  buildVerificationPhoneLookupValue,
} from './contactLookup'
import {
  clearContactLookupHmacKeyringCacheForTests,
  CONTACT_LOOKUP_HMAC_KEY_VERSION,
  emailLookupHashV2,
  phoneLookupHashV2,
} from './crypto/hashLookup'

const TEST_HMAC_KEY = Buffer.alloc(32, 7).toString('base64')

beforeEach(() => {
  process.env.PII_LOOKUP_HMAC_KEYS_JSON = JSON.stringify({
    [CONTACT_LOOKUP_HMAC_KEY_VERSION]: TEST_HMAC_KEY,
  })

  clearContactLookupHmacKeyringCacheForTests()
})

afterEach(() => {
  delete process.env.PII_LOOKUP_HMAC_KEYS_JSON
  clearContactLookupHmacKeyringCacheForTests()
})

describe('buildUserContactLookupData', () => {
  it('builds v2 email and phone hashes and clears legacy hashes from normalized values', () => {
    const emailHashV2 = emailLookupHashV2('tori@example.com')
    const phoneHashV2 = phoneLookupHashV2('+15551234567')

    expect(emailHashV2).not.toBeNull()
    expect(phoneHashV2).not.toBeNull()

    expect(
      buildUserContactLookupData({
        email: ' Tori@Example.COM ',
        phone: '(555) 123-4567',
      }),
    ).toEqual({
      emailHash: null,
      emailHashV2: emailHashV2?.hash,
      emailHashKeyVersion: emailHashV2?.keyVersion,
      phoneHash: null,
      phoneHashV2: phoneHashV2?.hash,
      phoneHashKeyVersion: phoneHashV2?.keyVersion,
    })
  })

  it('preserves omitted fields for partial updates', () => {
    const phoneHashV2 = phoneLookupHashV2('+15551234567')

    expect(phoneHashV2).not.toBeNull()

    expect(
      buildUserContactLookupData({
        phone: '(555) 123-4567',
      }),
    ).toEqual({
      phoneHash: null,
      phoneHashV2: phoneHashV2?.hash,
      phoneHashKeyVersion: phoneHashV2?.keyVersion,
    })
  })

  it('preserves explicitly undefined fields for partial updates', () => {
    const phoneHashV2 = phoneLookupHashV2('+15551234567')

    expect(phoneHashV2).not.toBeNull()

    expect(
      buildUserContactLookupData({
        email: undefined,
        phone: '(555) 123-4567',
      }),
    ).toEqual({
      phoneHash: null,
      phoneHashV2: phoneHashV2?.hash,
      phoneHashKeyVersion: phoneHashV2?.keyVersion,
    })
  })

  it('returns null hashes and key versions for invalid provided values', () => {
    expect(
      buildUserContactLookupData({
        email: 'not-an-email',
        phone: '123',
      }),
    ).toEqual({
      emailHash: null,
      emailHashV2: null,
      emailHashKeyVersion: null,
      phoneHash: null,
      phoneHashV2: null,
      phoneHashKeyVersion: null,
    })
  })

  it('returns null hashes and key versions for null provided values', () => {
    expect(
      buildUserContactLookupData({
        email: null,
        phone: null,
      }),
    ).toEqual({
      emailHash: null,
      emailHashV2: null,
      emailHashKeyVersion: null,
      phoneHash: null,
      phoneHashV2: null,
      phoneHashKeyVersion: null,
    })
  })

  it('returns an empty object when no contact fields are provided', () => {
    expect(buildUserContactLookupData({})).toEqual({})
  })
})

describe('buildClientProfileContactLookupData', () => {
  it('builds v2 email and phone hashes and clears legacy hashes from normalized values', () => {
    const emailHashV2 = emailLookupHashV2('client@example.com')
    const phoneHashV2 = phoneLookupHashV2('+15551234567')

    expect(emailHashV2).not.toBeNull()
    expect(phoneHashV2).not.toBeNull()

    expect(
      buildClientProfileContactLookupData({
        email: ' Client@Example.COM ',
        phone: '1-555-123-4567',
      }),
    ).toEqual({
      emailHash: null,
      emailHashV2: emailHashV2?.hash,
      emailHashKeyVersion: emailHashV2?.keyVersion,
      phoneHash: null,
      phoneHashV2: phoneHashV2?.hash,
      phoneHashKeyVersion: phoneHashV2?.keyVersion,
    })
  })

  it('preserves omitted fields for partial updates', () => {
    const emailHashV2 = emailLookupHashV2('client@example.com')

    expect(emailHashV2).not.toBeNull()

    expect(
      buildClientProfileContactLookupData({
        email: ' Client@Example.COM ',
      }),
    ).toEqual({
      emailHash: null,
      emailHashV2: emailHashV2?.hash,
      emailHashKeyVersion: emailHashV2?.keyVersion,
    })
  })

  it('preserves explicitly undefined fields for partial updates', () => {
    const emailHashV2 = emailLookupHashV2('client@example.com')

    expect(emailHashV2).not.toBeNull()

    expect(
      buildClientProfileContactLookupData({
        email: ' Client@Example.COM ',
        phone: undefined,
      }),
    ).toEqual({
      emailHash: null,
      emailHashV2: emailHashV2?.hash,
      emailHashKeyVersion: emailHashV2?.keyVersion,
    })
  })

  it('returns null hashes and key versions for invalid provided values', () => {
    expect(
      buildClientProfileContactLookupData({
        email: 'client',
        phone: 'abc',
      }),
    ).toEqual({
      emailHash: null,
      emailHashV2: null,
      emailHashKeyVersion: null,
      phoneHash: null,
      phoneHashV2: null,
      phoneHashKeyVersion: null,
    })
  })

  it('returns null hashes and key versions for null provided values', () => {
    expect(
      buildClientProfileContactLookupData({
        email: null,
        phone: null,
      }),
    ).toEqual({
      emailHash: null,
      emailHashV2: null,
      emailHashKeyVersion: null,
      phoneHash: null,
      phoneHashV2: null,
      phoneHashKeyVersion: null,
    })
  })

  it('returns an empty object when no contact fields are provided', () => {
    expect(buildClientProfileContactLookupData({})).toEqual({})
  })
})

describe('v2 contact lookup hash delegates', () => {
  it('builds v2 email lookup hashes from contact input', () => {
    const result = buildEmailLookupHashV2ForContactInput(' Tori@Example.COM ')

    expect(result).toEqual({
      hash: expect.stringMatching(/^[a-f0-9]{64}$/u),
      keyVersion: CONTACT_LOOKUP_HMAC_KEY_VERSION,
    })

    expect(result?.hash).toBe(emailLookupHashV2('tori@example.com')?.hash)
  })

  it('returns null for invalid email contact input', () => {
    expect(buildEmailLookupHashV2ForContactInput('not-an-email')).toBeNull()
  })

  it('builds v2 phone lookup hashes from contact input', () => {
    const result = buildPhoneLookupHashV2ForContactInput('(555) 123-4567')

    expect(result).toEqual({
      hash: expect.stringMatching(/^[a-f0-9]{64}$/u),
      keyVersion: CONTACT_LOOKUP_HMAC_KEY_VERSION,
    })

    expect(result?.hash).toBe(phoneLookupHashV2('+15551234567')?.hash)
  })

  it('returns null for invalid phone contact input', () => {
    expect(buildPhoneLookupHashV2ForContactInput('123')).toBeNull()
  })
})

describe('buildVerificationPhoneLookupValue', () => {
  it('returns the canonical verification phone value', () => {
    expect(buildVerificationPhoneLookupValue('(555) 123-4567')).toBe(
      '+15551234567',
    )
  })

  it('returns an empty string for invalid or missing phone values', () => {
    expect(buildVerificationPhoneLookupValue('123')).toBe('')
    expect(buildVerificationPhoneLookupValue(null)).toBe('')
    expect(buildVerificationPhoneLookupValue(undefined)).toBe('')
  })
})