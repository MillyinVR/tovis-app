// lib/notifications/clientDestinationEligibility.ts
//
// Whether a client's PRO-ENTERED contact details count as a usable destination
// for one notification — and the synthetic eligibility stamp that expresses it.
//
// Account-level capability (channelPolicy) asks two questions before it will use
// a phone or an email: is it verified, and (for SMS) is there transactional
// consent on file. That is right for the general case and wrong for a booking a
// pro made on someone's behalf. A pro-created client has no account at all: no
// verification, no consent row, and no way to open the in-app inbox the
// notification is written to. Every channel refuses, so the reminder for an
// appointment they are expected to turn up to reaches nobody.
//
// Prod, at the time this was written: of the 32 suppressed APPOINTMENT_REMINDER
// deliveries, 24 (12 SMS + 12 email) belonged to UNCLAIMED clients, and every
// one of those 24 had a phone AND an email on file. The other 8 belonged to
// claimed clients who verified a few days after the reminder went out — timing,
// not policy. Meanwhile the aftercare link, the deposit link and the consent
// signature for those same bookings all texted those same clients successfully,
// because lib/clientActions already grants this exact carve-out. The reminder
// was simply never given it.
//
// So this is the same rule the client-action magic links have always used
// (UNVERIFIED_DESTINATION_ACTION_TYPES), stated once and shared, rather than a
// second copy that can drift from it. The stamp it produces is an ENQUEUE-TIME
// ELIGIBILITY timestamp, not an account-level claim that anyone verified
// anything — nothing here writes to User or ClientProfile.
//
// Scope is deliberately narrow: booking-linked events, and only the four use
// cases the SMS consent copy itself enumerates (see lib/transactionalSmsPolicy —
// "appointment confirmations, reminders, reschedules, and cancellations"). The
// text a client agrees to at signup is the ceiling on what may be sent this way,
// so the set is derived from that promise rather than chosen freely. A social or
// marketing-shaped event must never appear here.
//
// ⚠️ This relaxes VERIFICATION, not opt-out. Nothing in this repo ever clears
// transactionalSmsConsentAt — there is no in-app STOP handler — so SMS opt-out
// lives at the carrier, where Twilio blocks a number that replied STOP no matter
// what we enqueue. This carve-out therefore cannot resurrect an opt-out.

import { NotificationEventKey } from '@prisma/client'

/**
 * The client-facing booking events that may reach a pro-entered destination.
 * Mirrors TRANSACTIONAL_SMS_USE_CASES in lib/transactionalSmsPolicy: appointment
 * confirmations, reminders, reschedules, cancellations. Nothing else belongs
 * here — see the header.
 */
export const BOOKING_TRANSACTIONAL_CLIENT_EVENT_KEYS: ReadonlySet<NotificationEventKey> =
  new Set<NotificationEventKey>([
    NotificationEventKey.BOOKING_CONFIRMED,
    NotificationEventKey.APPOINTMENT_REMINDER,
    NotificationEventKey.BOOKING_RESCHEDULED,
    NotificationEventKey.BOOKING_CANCELLED_BY_CLIENT,
    NotificationEventKey.BOOKING_CANCELLED_BY_PRO,
    NotificationEventKey.BOOKING_CANCELLED_BY_ADMIN,
  ])

/**
 * True when this notification may treat the client's pro-entered phone/email as
 * a usable destination.
 *
 * Requires a linked booking, not just a matching event key: the justification is
 * "there is an appointment this person is expected to turn up to", so an event of
 * the right kind with no booking behind it does NOT qualify.
 */
export function allowsProEnteredClientDestination(args: {
  eventKey: NotificationEventKey
  bookingId: string | null | undefined
}): boolean {
  if (!args.bookingId) return false
  return BOOKING_TRANSACTIONAL_CLIENT_EVENT_KEYS.has(args.eventKey)
}

/**
 * The verification timestamp to hand the dispatch layer for one destination.
 *
 * A real timestamp always wins — this only ever FILLS a null, never overrides an
 * account's own answer. With the carve-out off, or with no destination to send
 * to, it stays null and the channel is suppressed exactly as before.
 *
 * Shared with lib/clientActions/enqueueClientActionDispatch, which had the only
 * copy of this rule before the booking-notification path needed it too.
 */
export function resolveSyntheticVerificationTimestamp(args: {
  explicitVerifiedAt: Date | null
  destination: string | null
  allowUnverifiedDestination: boolean
  fallbackAt: Date
}): Date | null {
  if (args.explicitVerifiedAt) {
    return args.explicitVerifiedAt
  }

  if (!args.allowUnverifiedDestination) {
    return null
  }

  if (!args.destination) {
    return null
  }

  /**
   * This is an enqueue-time eligibility timestamp, not a user-account claim
   * about ownership verification.
   *
   * We only synthesize it for flows where the business action itself is "send
   * this to the destination the pro entered" — a magic-link delivery, or a
   * transactional message about a booking that already exists.
   */
  return args.fallbackAt
}
