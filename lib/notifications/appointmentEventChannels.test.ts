// lib/notifications/appointmentEventChannels.test.ts
//
// The channel shape of the client-facing APPOINTMENT events is a PRODUCT
// decision, and it was silently wrong for the whole life of the push channel:
// APPOINTMENT_REMINDER (and a reschedule/cancellation the client did not cause)
// shipped on CLIENT_ALL_CHANNELS = in-app + SMS + email, with no PUSH. Prod bore
// that out exactly — 22 APPOINTMENT_REMINDER in-app rows, 6 SMS, 6 email, and
// ZERO push deliveries ever created, while other client events (REBOOK_CADENCE_DUE)
// were pushing successfully over the same period.
//
// The reminder is the notification a client most expects on their phone, and the
// off-app channels it did have are the two most clients cannot use: SMS needs a
// verified phone AND transactional consent, email needs a verified address. A
// client with the app and neither of those got nothing but an inbox badge.
//
// So the set is pinned here rather than left to the registry's own shape. Note
// this asserts the DEFAULT policy — what a client who has never touched their
// preferences gets. PUSH additionally stays inert until a provider is configured
// and the recipient has an active DeviceToken (channelPolicy/enqueueDispatch),
// so a DB drive that shows no push delivery cannot, on its own, distinguish
// "push not in the policy" from "push suppressed for want of a token". That is
// exactly why this pins the policy directly.

import { describe, expect, it } from 'vitest'
import {
  NotificationChannel,
  NotificationEventKey,
  NotificationRecipientKind,
} from '@prisma/client'

import {
  CLIENT_NOTIFICATION_EVENT_KEYS,
  getDefaultChannelsForRecipient,
} from './eventKeys'
import { getNotificationCategoriesForAudience } from './preferenceCategories'

/** Client-facing events about a client's own appointment. */
const CLIENT_APPOINTMENT_EVENT_KEYS = [
  NotificationEventKey.APPOINTMENT_REMINDER,
  NotificationEventKey.BOOKING_RESCHEDULED,
  NotificationEventKey.BOOKING_CANCELLED_BY_PRO,
  NotificationEventKey.BOOKING_CANCELLED_BY_ADMIN,
] as const

function clientChannels(key: NotificationEventKey): NotificationChannel[] {
  return [
    ...getDefaultChannelsForRecipient({
      key,
      recipientKind: NotificationRecipientKind.CLIENT,
    }),
  ]
}

describe('client-facing appointment notification channels', () => {
  it('sends the appointment reminder on every channel, push included', () => {
    expect(clientChannels(NotificationEventKey.APPOINTMENT_REMINDER)).toEqual([
      NotificationChannel.IN_APP,
      NotificationChannel.SMS,
      NotificationChannel.EMAIL,
      NotificationChannel.PUSH,
    ])
  })

  // The reminder is not a special case — everything that happens TO the
  // client's appointment has to be able to reach the phone the same way.
  it('reaches the phone for a reschedule or a cancellation the client did not cause', () => {
    for (const key of CLIENT_APPOINTMENT_EVENT_KEYS) {
      expect(clientChannels(key)).toContain(NotificationChannel.PUSH)
    }
  })

  // The two channels push exists to back up: both need a verification step most
  // clients never complete, so neither can be the only off-app route.
  it('keeps SMS and email alongside push rather than replacing them', () => {
    for (const key of CLIENT_APPOINTMENT_EVENT_KEYS) {
      const channels = clientChannels(key)
      expect(channels).toContain(NotificationChannel.SMS)
      expect(channels).toContain(NotificationChannel.EMAIL)
      expect(channels).toContain(NotificationChannel.IN_APP)
    }
  })

  // An event with no category is a toggle the settings page can never show — the
  // client would be unable to mute it.
  it('is manageable from the client’s notification settings', () => {
    // Reads the same shaped output the settings page renders, so this THROWS if
    // any key below is in CLIENT_NOTIFICATION_EVENT_KEYS without a category.
    const categorised = new Set(
      getNotificationCategoriesForAudience('client').flatMap((category) =>
        category.events.map((event) => event.eventKey),
      ),
    )

    for (const key of CLIENT_APPOINTMENT_EVENT_KEYS) {
      expect(CLIENT_NOTIFICATION_EVENT_KEYS).toContain(key)
      expect(categorised.has(key)).toBe(true)
    }
  })
})
