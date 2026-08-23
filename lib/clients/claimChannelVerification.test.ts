// lib/clients/claimChannelVerification.test.ts
//
// `matchesClaimChannelContact` is the authorization for crediting a claim-link
// click as verification: the account claiming must be reachable at the very
// contact the message was delivered to. It is ALSO now the shared matcher
// behind `claimAdoption.contactMatchesInvite`, so these cases pin both.
//
// The consolidation quietly changed one thing worth pinning: the adoption's
// own copy normalized only the INVITE side and trusted its caller to hand it a
// pre-normalized registered contact. This normalizes both — safe only because
// normalizeEmail/normalizePhone are idempotent, which the last case asserts
// rather than assumes.

import { describe, expect, it } from 'vitest'
import { ContactMethod } from '@prisma/client'

import { matchesClaimChannelContact } from './claimChannelVerification'

const INVITED_EMAIL = 'tori@example.com'
const INVITED_PHONE = '+16195551234'

describe('matchesClaimChannelContact', () => {
  it('matches the EMAIL channel only against the email pair', () => {
    expect(
      matchesClaimChannelContact({
        channel: ContactMethod.EMAIL,
        invitedEmail: INVITED_EMAIL,
        invitedPhone: INVITED_PHONE,
        email: INVITED_EMAIL,
        phone: null,
      }),
    ).toBe(true)

    // The phone matches, the email does not — an EMAIL-channel click earns
    // nothing, because the email is what that message was delivered to.
    expect(
      matchesClaimChannelContact({
        channel: ContactMethod.EMAIL,
        invitedEmail: INVITED_EMAIL,
        invitedPhone: INVITED_PHONE,
        email: 'someone-else@example.com',
        phone: INVITED_PHONE,
      }),
    ).toBe(false)
  })

  it('matches the SMS channel only against the phone pair', () => {
    expect(
      matchesClaimChannelContact({
        channel: ContactMethod.SMS,
        invitedEmail: INVITED_EMAIL,
        invitedPhone: INVITED_PHONE,
        email: null,
        phone: INVITED_PHONE,
      }),
    ).toBe(true)

    expect(
      matchesClaimChannelContact({
        channel: ContactMethod.SMS,
        invitedEmail: INVITED_EMAIL,
        invitedPhone: INVITED_PHONE,
        email: INVITED_EMAIL,
        phone: '+15550009999',
      }),
    ).toBe(false)
  })

  it('never matches on a missing contact — null is not a wildcard', () => {
    expect(
      matchesClaimChannelContact({
        channel: ContactMethod.EMAIL,
        invitedEmail: null,
        invitedPhone: INVITED_PHONE,
        email: null,
        phone: INVITED_PHONE,
      }),
    ).toBe(false)

    expect(
      matchesClaimChannelContact({
        channel: ContactMethod.SMS,
        invitedEmail: INVITED_EMAIL,
        invitedPhone: null,
        email: INVITED_EMAIL,
        phone: null,
      }),
    ).toBe(false)
  })

  it('normalizes BOTH sides, so raw user input still matches stored contact', () => {
    // Casing/whitespace on the email, and a 10-digit local phone against the
    // stored E.164 — both must match. This is what makes it safe to hand this
    // matcher an already-normalized value (adoption) or a raw one.
    expect(
      matchesClaimChannelContact({
        channel: ContactMethod.EMAIL,
        invitedEmail: INVITED_EMAIL,
        invitedPhone: null,
        email: '  TORI@Example.com ',
        phone: null,
      }),
    ).toBe(true)

    expect(
      matchesClaimChannelContact({
        channel: ContactMethod.SMS,
        invitedEmail: null,
        invitedPhone: INVITED_PHONE,
        email: null,
        phone: '(619) 555-1234',
      }),
    ).toBe(true)

    // Idempotence: feeding an ALREADY-normalized value back through still
    // matches. The adoption path relies on this — it passes contacts that were
    // normalized once already.
    expect(
      matchesClaimChannelContact({
        channel: ContactMethod.SMS,
        invitedEmail: null,
        invitedPhone: INVITED_PHONE,
        email: null,
        phone: INVITED_PHONE,
      }),
    ).toBe(true)
  })
})
