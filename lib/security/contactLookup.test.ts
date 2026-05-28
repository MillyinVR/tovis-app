// lib/security/contactLookup.test.ts
import { beforeEach, describe, expect, it } from 'vitest'

import {
  buildClientProfileContactLookupData,
  buildUserContactLookupData,
} from './contactLookup'
import {
  clearContactLookupHmacKeyringCacheForTests,
  CONTACT_LOOKUP_HMAC_KEY_VERSION,
  emailLookupHash,
  emailLookupHashV2,
  phoneLookupHash,
  phoneLookupHashV2,
} from './crypto/hashLookup'

const TEST_HMAC_KEY = Buffer.alloc(32, 7).toString('base64')

beforeEach(() => {
  process.env.PII_LOOKUP_HMAC_KEYS_JSON = JSON.stringify({
    [CONTACT_LOOKUP_HMAC_KEY_VERSION]: TEST_HMAC_KEY,
  })

  clearContactLookupHmacKeyringCacheForTests()
})

describe('buildUserContactLookupData', () => {
  it('builds legacy and v2 email and phone hashes from normalized values', () => {
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
      emailHash: emailLookupHash('tori@example.com'),
      emailHashV2: emailHashV2?.hash,
      emailHashKeyVersion: emailHashV2?.keyVersion,
      phoneHash: phoneLookupHash('+15551234567'),
      phoneHashV2: phoneHashV2?.hash,
      phoneHashKeyVersion: phoneHashV2?.keyVersion,
    })
  })

  it('preserves undefined fields for partial updates', () => {
    const phoneHashV2 = phoneLookupHashV2('+15551234567')

    expect(phoneHashV2).not.toBeNull()

    expect(
      buildUserContactLookupData({
        email: undefined,
        phone: '(555) 123-4567',
      }),
    ).toEqual({
      emailHash: undefined,
      emailHashV2: undefined,
      emailHashKeyVersion: undefined,
      phoneHash: phoneLookupHash('+15551234567'),
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
})

describe('buildClientProfileContactLookupData', () => {
  it('builds legacy and v2 email and phone hashes from normalized values', () => {
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
      emailHash: emailLookupHash('client@example.com'),
      emailHashV2: emailHashV2?.hash,
      emailHashKeyVersion: emailHashV2?.keyVersion,
      phoneHash: phoneLookupHash('+15551234567'),
      phoneHashV2: phoneHashV2?.hash,
      phoneHashKeyVersion: phoneHashV2?.keyVersion,
    })
  })

  it('preserves undefined fields for partial updates', () => {
    const emailHashV2 = emailLookupHashV2('client@example.com')

    expect(emailHashV2).not.toBeNull()

    expect(
      buildClientProfileContactLookupData({
        email: ' Client@Example.COM ',
        phone: undefined,
      }),
    ).toEqual({
      emailHash: emailLookupHash('client@example.com'),
      emailHashV2: emailHashV2?.hash,
      emailHashKeyVersion: emailHashV2?.keyVersion,
      phoneHash: undefined,
      phoneHashV2: undefined,
      phoneHashKeyVersion: undefined,
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
})