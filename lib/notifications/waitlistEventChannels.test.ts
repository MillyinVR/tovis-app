// lib/notifications/waitlistEventChannels.test.ts
//
// The channel shape of the three pro-facing waitlist events is a PRODUCT
// decision, not an implementation detail — and it is one line of config away
// from being silently wrong in the direction that hurts most (a pro's phone
// buzzing for a non-event, or a re-offerable slot arriving only as an inbox row
// nobody opens).
//
// So it is pinned here rather than left to the registry's own shape:
//
//   WAITLIST_JOINED        in-app + push + email  — a LEAD; email survives a
//                                                   missed push.
//   WAITLIST_CLIENT_LEFT   in-app + push          — a concrete slot just
//                                                   reopened: worth a tap now,
//                                                   stale by the time an email
//                                                   is read.
//   WAITLIST_OFFER_EXPIRED in-app ONLY            — nobody did anything. The
//                                                   quietest event we ship.
//
// Note this asserts the DEFAULT policy, which is what a pro who has never
// touched their preferences gets. PUSH additionally stays inert until a provider
// is configured and the recipient has a registered device token
// (channelPolicy/enqueueDispatch), which is why a real DB drive of the expiry
// sweep shows one IN_APP delivery and cannot, on its own, distinguish
// "push not in the policy" from "push suppressed for want of a token".

import { describe, expect, it } from 'vitest'
import {
  NotificationChannel,
  NotificationEventKey,
  NotificationRecipientKind,
} from '@prisma/client'

import {
  getDefaultChannelsForRecipient,
  getNotificationEventDefinition,
  isRecipientSupportedForEvent,
  PRO_NOTIFICATION_EVENT_KEYS,
} from './eventKeys'
import { getNotificationCategoriesForAudience } from './preferenceCategories'

function proChannels(key: NotificationEventKey): NotificationChannel[] {
  return [
    ...getDefaultChannelsForRecipient({
      key,
      recipientKind: NotificationRecipientKind.PRO,
    }),
  ]
}

describe('pro-facing waitlist notification channels', () => {
  it('keeps an expired offer in-app ONLY — no push, no email, no SMS', () => {
    expect(proChannels(NotificationEventKey.WAITLIST_OFFER_EXPIRED)).toEqual([
      NotificationChannel.IN_APP,
    ])
  })

  it('gives a client leaving a live offer in-app + push, and no email', () => {
    const channels = proChannels(NotificationEventKey.WAITLIST_CLIENT_LEFT)

    expect(channels).toEqual([
      NotificationChannel.IN_APP,
      NotificationChannel.PUSH,
    ])
    expect(channels).not.toContain(NotificationChannel.EMAIL)
  })

  // The contrast is the point: the loud one stays loud.
  it('leaves WAITLIST_JOINED as the loudest of the three', () => {
    expect(proChannels(NotificationEventKey.WAITLIST_JOINED)).toContain(
      NotificationChannel.EMAIL,
    )
  })

  it('never sends any of the three by SMS', () => {
    for (const key of [
      NotificationEventKey.WAITLIST_JOINED,
      NotificationEventKey.WAITLIST_CLIENT_LEFT,
      NotificationEventKey.WAITLIST_OFFER_EXPIRED,
    ]) {
      expect(proChannels(key)).not.toContain(NotificationChannel.SMS)
    }
  })

  // A pro-only event that a CLIENT could receive would leak the pro's view of
  // their own waitlist to the person it is about.
  it('supports the PRO recipient and nobody else', () => {
    for (const key of [
      NotificationEventKey.WAITLIST_CLIENT_LEFT,
      NotificationEventKey.WAITLIST_OFFER_EXPIRED,
    ]) {
      expect(getNotificationEventDefinition(key).supportedRecipients).toEqual([
        NotificationRecipientKind.PRO,
      ])
      expect(
        isRecipientSupportedForEvent(key, NotificationRecipientKind.CLIENT),
      ).toBe(false)
    }
  })

  // A manageable event with no category is a toggle the settings page can never
  // show — the pro would be unable to mute it (see DEPOSIT_PAYMENT_LINK, which
  // is deliberately in NEITHER list). These two are in both, on purpose.
  it('is manageable from the pro’s notification settings', () => {
    // Reads the same shaped output the settings page renders — which also means
    // this call THROWS if either key were added to PRO_NOTIFICATION_EVENT_KEYS
    // without a category, before any assertion below runs.
    const categorised = new Set(
      getNotificationCategoriesForAudience('pro').flatMap((category) =>
        category.events.map((event) => event.eventKey),
      ),
    )

    for (const key of [
      NotificationEventKey.WAITLIST_CLIENT_LEFT,
      NotificationEventKey.WAITLIST_OFFER_EXPIRED,
    ]) {
      expect(PRO_NOTIFICATION_EVENT_KEYS).toContain(key)
      expect(categorised.has(key)).toBe(true)
    }
  })
})
