import { describe, expect, it } from 'vitest'

import {
  buildClientProfileContactLookupData,
  buildUserContactLookupData,
} from './contactLookup'
import { emailLookupHash, phoneLookupHash } from './crypto/hashLookup'

describe('buildUserContactLookupData', () => {
  it('builds email and phone hashes from normalized values', () => {
    expect(
      buildUserContactLookupData({
        email: ' Tori@Example.COM ',
        phone: '(555) 123-4567',
      }),
    ).toEqual({
      emailHash: emailLookupHash('tori@example.com'),
      phoneHash: phoneLookupHash('+15551234567'),
    })
  })

  it('preserves undefined fields for partial updates', () => {
    expect(
      buildUserContactLookupData({
        email: undefined,
        phone: '(555) 123-4567',
      }),
    ).toEqual({
      emailHash: undefined,
      phoneHash: phoneLookupHash('+15551234567'),
    })
  })

  it('returns null hashes for invalid provided values', () => {
    expect(
      buildUserContactLookupData({
        email: 'not-an-email',
        phone: '123',
      }),
    ).toEqual({
      emailHash: null,
      phoneHash: null,
    })
  })
})

describe('buildClientProfileContactLookupData', () => {
  it('builds email and phone hashes from normalized values', () => {
    expect(
      buildClientProfileContactLookupData({
        email: ' Client@Example.COM ',
        phone: '1-555-123-4567',
      }),
    ).toEqual({
      emailHash: emailLookupHash('client@example.com'),
      phoneHash: phoneLookupHash('+15551234567'),
    })
  })

  it('preserves undefined fields for partial updates', () => {
    expect(
      buildClientProfileContactLookupData({
        email: ' Client@Example.COM ',
        phone: undefined,
      }),
    ).toEqual({
      emailHash: emailLookupHash('client@example.com'),
      phoneHash: undefined,
    })
  })
})