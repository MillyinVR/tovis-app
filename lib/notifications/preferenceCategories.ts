import {
  NotificationChannel,
  NotificationEventKey,
  NotificationRecipientKind,
} from '@prisma/client'

import {
  CLIENT_NOTIFICATION_EVENT_KEYS,
  PRO_NOTIFICATION_EVENT_KEYS,
  getDefaultChannelsForRecipient,
} from './eventKeys'

/**
 * Read/write surface metadata for the notification-preferences settings page.
 *
 * This module is presentation-only: it groups the engine's per-eventKey
 * definitions into friendly, user-facing categories and derives which channels
 * a given event actually supports (from the policy engine's default channel
 * map — never re-declared here). It does NOT change any policy default or touch
 * the delivery engine; it only decides what toggles the settings UI exposes.
 */

export type NotificationAudience = 'client' | 'pro'

/** UI-presented quiet-hours default window (10:00 PM → 08:00 AM local). */
export const DEFAULT_QUIET_HOURS_START_MINUTES = 22 * 60 // 1320
export const DEFAULT_QUIET_HOURS_END_MINUTES = 8 * 60 // 480

/** Valid minute-of-day bounds (inclusive). */
export const MIN_MINUTE_OF_DAY = 0
export const MAX_MINUTE_OF_DAY = 1439

export type NotificationCategoryKey =
  | 'BOOKINGS'
  | 'REMINDERS'
  | 'PAYMENTS'
  | 'LAST_MINUTE'
  | 'SOCIAL'

/** Stable display order for the three channels. */
export const CHANNEL_DISPLAY_ORDER: readonly NotificationChannel[] = [
  NotificationChannel.IN_APP,
  NotificationChannel.SMS,
  NotificationChannel.EMAIL,
]

export function recipientKindForAudience(
  audience: NotificationAudience,
): NotificationRecipientKind {
  return audience === 'pro'
    ? NotificationRecipientKind.PRO
    : NotificationRecipientKind.CLIENT
}

/** Curated, user-manageable event keys for each audience. */
export function getAudienceEventKeys(
  audience: NotificationAudience,
): readonly NotificationEventKey[] {
  return audience === 'pro'
    ? PRO_NOTIFICATION_EVENT_KEYS
    : CLIENT_NOTIFICATION_EVENT_KEYS
}

const EVENT_LABELS: Record<NotificationEventKey, string> = {
  [NotificationEventKey.BOOKING_REQUEST_CREATED]: 'New booking request',
  [NotificationEventKey.BOOKING_CONFIRMED]: 'Booking confirmed',
  [NotificationEventKey.BOOKING_STARTED]: 'Appointment started',
  [NotificationEventKey.BOOKING_RESCHEDULED]: 'Booking rescheduled',
  [NotificationEventKey.BOOKING_CANCELLED_BY_CLIENT]: 'Booking cancelled by client',
  [NotificationEventKey.BOOKING_CANCELLED_BY_PRO]: 'Booking cancelled by pro',
  [NotificationEventKey.BOOKING_CANCELLED_BY_ADMIN]: 'Booking cancelled by support',
  [NotificationEventKey.CLIENT_CLAIM_INVITE]: 'Claim your account',
  [NotificationEventKey.CONSULTATION_PROPOSAL_SENT]: 'Consultation proposal',
  [NotificationEventKey.CONSULTATION_APPROVED]: 'Consultation approved',
  [NotificationEventKey.CONSULTATION_REJECTED]: 'Consultation declined',
  [NotificationEventKey.REVIEW_RECEIVED]: 'New review',
  [NotificationEventKey.APPOINTMENT_REMINDER]: 'Appointment reminder',
  [NotificationEventKey.AFTERCARE_READY]: 'Aftercare ready',
  [NotificationEventKey.LAST_MINUTE_OPENING_AVAILABLE]: 'Last-minute opening',
  [NotificationEventKey.VIRAL_REQUEST_APPROVED]: 'Feature request approved',
  [NotificationEventKey.PAYMENT_COLLECTED]: 'Payment receipt',
  [NotificationEventKey.PAYMENT_ACTION_REQUIRED]: 'Payment action needed',
  [NotificationEventKey.PAYMENT_REFUNDED]: 'Refund issued',
  [NotificationEventKey.LOOK_FOLLOWER_NEW]: 'New look follower',
  [NotificationEventKey.CLIENT_FOLLOW]: 'New follower',
  [NotificationEventKey.REFERRAL_TAP_RECEIVED]: 'Referral tap',
  [NotificationEventKey.REFERRAL_CONFIRMED]: 'Referral confirmed',
  [NotificationEventKey.REFERRAL_CONVERTED]: 'Referral converted',
  // Admin operational alerts are not user-manageable preferences (admins have no
  // preference surface), so these never appear in a category — labels exist only
  // to keep this map exhaustive over NotificationEventKey.
  [NotificationEventKey.ADMIN_VERIFICATION_REVIEW_NEEDED]: 'Verification review needed',
  [NotificationEventKey.ADMIN_SUPPORT_TICKET_CREATED]: 'New support ticket',
  [NotificationEventKey.ADMIN_VIRAL_REQUEST_PENDING]: 'Viral request pending',
}

type CategoryDef = {
  key: NotificationCategoryKey
  label: string
  description: string
  // The full superset of event keys for this category. Filtered per audience.
  eventKeys: readonly NotificationEventKey[]
}

const CATEGORY_DEFS: readonly CategoryDef[] = [
  {
    key: 'BOOKINGS',
    label: 'Bookings',
    description:
      'Requests, confirmations, reschedules, cancellations, consultations, and aftercare.',
    eventKeys: [
      NotificationEventKey.BOOKING_REQUEST_CREATED,
      NotificationEventKey.BOOKING_CONFIRMED,
      NotificationEventKey.BOOKING_RESCHEDULED,
      NotificationEventKey.BOOKING_CANCELLED_BY_CLIENT,
      NotificationEventKey.BOOKING_CANCELLED_BY_PRO,
      NotificationEventKey.BOOKING_CANCELLED_BY_ADMIN,
      NotificationEventKey.CLIENT_CLAIM_INVITE,
      NotificationEventKey.CONSULTATION_PROPOSAL_SENT,
      NotificationEventKey.CONSULTATION_APPROVED,
      NotificationEventKey.CONSULTATION_REJECTED,
      NotificationEventKey.AFTERCARE_READY,
    ],
  },
  {
    key: 'REMINDERS',
    label: 'Reminders',
    description: 'Upcoming appointment reminders.',
    eventKeys: [NotificationEventKey.APPOINTMENT_REMINDER],
  },
  {
    key: 'PAYMENTS',
    label: 'Payments',
    description: 'Receipts and payments that need your action.',
    eventKeys: [
      NotificationEventKey.PAYMENT_COLLECTED,
      NotificationEventKey.PAYMENT_ACTION_REQUIRED,
      NotificationEventKey.PAYMENT_REFUNDED,
    ],
  },
  {
    key: 'LAST_MINUTE',
    label: 'Last-minute openings',
    description: 'Newly available openings that match what you want.',
    eventKeys: [NotificationEventKey.LAST_MINUTE_OPENING_AVAILABLE],
  },
  {
    key: 'SOCIAL',
    label: 'Social',
    description: 'Reviews, followers, features, and referrals.',
    eventKeys: [
      NotificationEventKey.REVIEW_RECEIVED,
      NotificationEventKey.VIRAL_REQUEST_APPROVED,
      NotificationEventKey.LOOK_FOLLOWER_NEW,
      NotificationEventKey.REFERRAL_TAP_RECEIVED,
      NotificationEventKey.REFERRAL_CONFIRMED,
      NotificationEventKey.REFERRAL_CONVERTED,
    ],
  },
]

export type NotificationCategoryEventMeta = {
  eventKey: NotificationEventKey
  label: string
  /** Channels this event can use for this audience (the only toggles shown). */
  supportedChannels: NotificationChannel[]
}

export type NotificationCategoryMeta = {
  key: NotificationCategoryKey
  label: string
  description: string
  events: NotificationCategoryEventMeta[]
}

function supportedChannelsFor(
  eventKey: NotificationEventKey,
  recipientKind: NotificationRecipientKind,
): NotificationChannel[] {
  const defaults = getDefaultChannelsForRecipient({
    key: eventKey,
    recipientKind,
  })
  return CHANNEL_DISPLAY_ORDER.filter((channel) => defaults.includes(channel))
}

/**
 * Grouped, audience-scoped category metadata for the settings UI. Only includes
 * event keys that are user-manageable for the audience, and only non-empty
 * categories. Throws if the category map fails to cover an audience event key —
 * a build-time guard so a newly added event can never silently vanish from the
 * settings surface.
 */
export function getNotificationCategoriesForAudience(
  audience: NotificationAudience,
): NotificationCategoryMeta[] {
  const recipientKind = recipientKindForAudience(audience)
  const allowed = new Set(getAudienceEventKeys(audience))
  const covered = new Set<NotificationEventKey>()

  const categories: NotificationCategoryMeta[] = []

  for (const def of CATEGORY_DEFS) {
    const events: NotificationCategoryEventMeta[] = []

    for (const eventKey of def.eventKeys) {
      if (!allowed.has(eventKey)) continue
      covered.add(eventKey)
      events.push({
        eventKey,
        label: EVENT_LABELS[eventKey],
        supportedChannels: supportedChannelsFor(eventKey, recipientKind),
      })
    }

    if (events.length > 0) {
      categories.push({
        key: def.key,
        label: def.label,
        description: def.description,
        events,
      })
    }
  }

  for (const eventKey of allowed) {
    if (!covered.has(eventKey)) {
      throw new Error(
        `preferenceCategories: event ${eventKey} is not assigned to any category for audience ${audience}`,
      )
    }
  }

  return categories
}
