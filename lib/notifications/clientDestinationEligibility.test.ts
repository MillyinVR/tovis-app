// lib/notifications/clientDestinationEligibility.test.ts
//
// This module decides when a client's UNVERIFIED, pro-entered phone or email may
// be texted/emailed. That makes its event set the blast radius of the whole
// carve-out: one key added here silently converts a notification into something
// that can reach a phone number nobody ever confirmed. So the set is pinned to
// the promise the client actually agreed to — the transactional SMS consent copy
// — and the "real answer always wins" property is pinned beside it.

import { describe, expect, it } from 'vitest'
import { NotificationEventKey } from '@prisma/client'

import {
  BOOKING_TRANSACTIONAL_CLIENT_EVENT_KEYS,
  allowsProEnteredClientDestination,
  resolveSyntheticVerificationTimestamp,
} from './clientDestinationEligibility'
import { TRANSACTIONAL_SMS_USE_CASES } from '@/lib/transactionalSmsPolicy'

const REAL = new Date('2026-04-08T12:00:00.000Z')
const FALLBACK = new Date('2026-08-13T17:00:00.000Z')

describe('BOOKING_TRANSACTIONAL_CLIENT_EVENT_KEYS', () => {
  it('is exactly the appointment lifecycle — confirmations, reminders, reschedules, cancellations', () => {
    expect([...BOOKING_TRANSACTIONAL_CLIENT_EVENT_KEYS].sort()).toEqual(
      [
        NotificationEventKey.APPOINTMENT_REMINDER,
        NotificationEventKey.BOOKING_CANCELLED_BY_ADMIN,
        NotificationEventKey.BOOKING_CANCELLED_BY_CLIENT,
        NotificationEventKey.BOOKING_CANCELLED_BY_PRO,
        NotificationEventKey.BOOKING_CONFIRMED,
        NotificationEventKey.BOOKING_RESCHEDULED,
      ].sort(),
    )
  })

  // The ceiling is the sentence the client ticked a box next to, not our taste.
  // If someone widens the set past what that copy promises, the consent on file
  // no longer covers what we send.
  it('stays inside what the SMS consent copy promises', () => {
    expect(TRANSACTIONAL_SMS_USE_CASES).toContain('Appointment reminders')
    expect(TRANSACTIONAL_SMS_USE_CASES).toContain('Appointment confirmations')
    expect(TRANSACTIONAL_SMS_USE_CASES).toContain('Reschedules')
    expect(TRANSACTIONAL_SMS_USE_CASES).toContain('Cancellations')
  })

  // The failure that would matter most: a social or engagement event acquiring
  // the right to text an unverified number.
  it('admits no social, marketing or engagement event', () => {
    for (const key of [
      NotificationEventKey.LOOK_LIKED,
      NotificationEventKey.LOOK_COMMENTED,
      NotificationEventKey.REBOOK_CADENCE_DUE,
      NotificationEventKey.SAVED_LOOK_CONSULT_NUDGE,
      NotificationEventKey.AI_CONSULT_INVITATION,
      NotificationEventKey.REVIEW_REQUESTED,
    ]) {
      expect(BOOKING_TRANSACTIONAL_CLIENT_EVENT_KEYS.has(key)).toBe(false)
    }
  })
})

describe('allowsProEnteredClientDestination', () => {
  it('allows an appointment reminder that is tied to a booking', () => {
    expect(
      allowsProEnteredClientDestination({
        eventKey: NotificationEventKey.APPOINTMENT_REMINDER,
        bookingId: 'booking_1',
      }),
    ).toBe(true)
  })

  // The justification is "there is an appointment this person must turn up to".
  // No booking, no justification — even for the right event key.
  it('refuses the same event with no booking behind it', () => {
    for (const bookingId of [null, undefined, '']) {
      expect(
        allowsProEnteredClientDestination({
          eventKey: NotificationEventKey.APPOINTMENT_REMINDER,
          bookingId,
        }),
      ).toBe(false)
    }
  })

  it('refuses an off-list event even when it is tied to a booking', () => {
    expect(
      allowsProEnteredClientDestination({
        eventKey: NotificationEventKey.AFTERCARE_READY,
        bookingId: 'booking_1',
      }),
    ).toBe(false)
  })
})

describe('resolveSyntheticVerificationTimestamp', () => {
  // The property everything else rests on: this can only ever FILL a null. A
  // client who verified — or deliberately did not — keeps their own answer.
  it('always returns the real timestamp when there is one', () => {
    for (const allow of [true, false]) {
      expect(
        resolveSyntheticVerificationTimestamp({
          explicitVerifiedAt: REAL,
          destination: '+15551234567',
          allowUnverifiedDestination: allow,
          fallbackAt: FALLBACK,
        }),
      ).toBe(REAL)
    }
  })

  it('synthesizes an eligibility stamp for an unverified destination when allowed', () => {
    expect(
      resolveSyntheticVerificationTimestamp({
        explicitVerifiedAt: null,
        destination: '+15551234567',
        allowUnverifiedDestination: true,
        fallbackAt: FALLBACK,
      }),
    ).toBe(FALLBACK)
  })

  it('stays null when the carve-out is off', () => {
    expect(
      resolveSyntheticVerificationTimestamp({
        explicitVerifiedAt: null,
        destination: '+15551234567',
        allowUnverifiedDestination: false,
        fallbackAt: FALLBACK,
      }),
    ).toBeNull()
  })

  // Nothing to send to is not something to make eligible.
  it('stays null when there is no destination, carve-out or not', () => {
    expect(
      resolveSyntheticVerificationTimestamp({
        explicitVerifiedAt: null,
        destination: null,
        allowUnverifiedDestination: true,
        fallbackAt: FALLBACK,
      }),
    ).toBeNull()
  })
})
