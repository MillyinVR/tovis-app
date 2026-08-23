// lib/clients/claimLinkChannel.test.ts

import { describe, expect, it } from 'vitest'
import { ContactMethod } from '@prisma/client'

import {
  appendClaimChannelParams,
  signClaimLinkChannel,
  verifyClaimLinkChannel,
} from './claimLinkChannel'

const RAW_TOKEN = 'tok_abc123-XYZ'

describe('signClaimLinkChannel / verifyClaimLinkChannel', () => {
  it('round-trips each channel', () => {
    const email = signClaimLinkChannel(RAW_TOKEN, ContactMethod.EMAIL)
    expect(email.via).toBe('email')
    expect(
      verifyClaimLinkChannel({
        rawToken: RAW_TOKEN,
        via: email.via,
        sig: email.sig,
      }),
    ).toBe(ContactMethod.EMAIL)

    const sms = signClaimLinkChannel(RAW_TOKEN, ContactMethod.SMS)
    expect(sms.via).toBe('sms')
    expect(
      verifyClaimLinkChannel({ rawToken: RAW_TOKEN, via: sms.via, sig: sms.sig }),
    ).toBe(ContactMethod.SMS)
  })

  it('rejects a via swapped to the other channel (SMS holder cannot claim email)', () => {
    const sms = signClaimLinkChannel(RAW_TOKEN, ContactMethod.SMS)
    expect(
      verifyClaimLinkChannel({
        rawToken: RAW_TOKEN,
        via: 'email',
        sig: sms.sig,
      }),
    ).toBeNull()
  })

  it('rejects a signature carried to a different token (rotation kills old sigs)', () => {
    const email = signClaimLinkChannel(RAW_TOKEN, ContactMethod.EMAIL)
    expect(
      verifyClaimLinkChannel({
        rawToken: 'tok_rotated',
        via: email.via,
        sig: email.sig,
      }),
    ).toBeNull()
  })

  it('rejects tampered, unknown, and missing inputs without throwing', () => {
    const email = signClaimLinkChannel(RAW_TOKEN, ContactMethod.EMAIL)

    expect(
      verifyClaimLinkChannel({
        rawToken: RAW_TOKEN,
        via: email.via,
        sig: `${email.sig}x`,
      }),
    ).toBeNull()
    expect(
      verifyClaimLinkChannel({
        rawToken: RAW_TOKEN,
        via: 'carrier-pigeon',
        sig: email.sig,
      }),
    ).toBeNull()
    expect(
      verifyClaimLinkChannel({ rawToken: RAW_TOKEN, via: null, sig: email.sig }),
    ).toBeNull()
    expect(
      verifyClaimLinkChannel({ rawToken: null, via: 'email', sig: email.sig }),
    ).toBeNull()
    expect(
      verifyClaimLinkChannel({ rawToken: RAW_TOKEN, via: 'email', sig: null }),
    ).toBeNull()
  })
})

describe('appendClaimChannelParams', () => {
  it('stamps a claim href per channel with a signature that verifies', () => {
    const href = `/claim/${encodeURIComponent(RAW_TOKEN)}`

    const stamped = appendClaimChannelParams(href, ContactMethod.EMAIL)
    expect(stamped.startsWith(`${href}?`)).toBe(true)

    const url = new URL(stamped, 'https://app.invalid')
    expect(
      verifyClaimLinkChannel({
        rawToken: RAW_TOKEN,
        via: url.searchParams.get('via'),
        sig: url.searchParams.get('vsig'),
      }),
    ).toBe(ContactMethod.EMAIL)
  })

  it('leaves non-claim hrefs and channel-less deliveries untouched', () => {
    expect(
      appendClaimChannelParams('/client/bookings/b1', ContactMethod.EMAIL),
    ).toBe('/client/bookings/b1')
    expect(appendClaimChannelParams('/claim/tok_1', null)).toBe('/claim/tok_1')
    // A claim href that already carries a query is not this stamp's shape —
    // never double-stamp it.
    expect(
      appendClaimChannelParams('/claim/tok_1?via=email', ContactMethod.EMAIL),
    ).toBe('/claim/tok_1?via=email')
  })
})
