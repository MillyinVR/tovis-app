import {
  NotificationChannel,
  NotificationEventKey,
  NotificationPriority,
  NotificationRecipientKind,
} from '@prisma/client'

export type NotificationTemplateKey =
  | 'booking_request_created'
  | 'booking_confirmed'
  | 'booking_started'
  | 'booking_rescheduled'
  | 'booking_cancelled_by_client'
  | 'booking_cancelled_by_pro'
  | 'booking_cancelled_by_admin'
  | 'client_claim_invite'
  | 'consultation_proposal_sent'
  | 'consultation_approved'
  | 'consultation_rejected'
  | 'review_received'
  | 'appointment_reminder'
  | 'aftercare_ready'
  | 'last_minute_opening_available'
  | 'viral_request_approved'
  | 'payment_collected'
  | 'payment_action_required'
  | 'payment_refunded'
  | 'look_follower_new'
  | 'client_follow'
  | 'referral_tap_received'
  | 'referral_confirmed'
  | 'referral_converted'
  | 'pro_handle_reservation_expiring'
  | 'admin_verification_review_needed'
  | 'admin_support_ticket_created'
  | 'admin_viral_request_pending'

export type NotificationEventDefinition = {
  key: NotificationEventKey
  defaultPriority: NotificationPriority
  transactional: boolean
  allowQuietHoursBypass: boolean
  templateKey: NotificationTemplateKey
  supportedRecipients: readonly NotificationRecipientKind[]
  defaultChannelsByRecipient: Partial<
    Record<NotificationRecipientKind, readonly NotificationChannel[]>
  >
  // Critical events whose EMAIL channel can never be turned off by a recipient
  // preference (e.g. payment receipts / refunds / action-required). The channel
  // policy forces email through even when the recipient disabled it, and the
  // preferences UI shows the email toggle locked on. Capability still applies —
  // a recipient with no email address still can't receive email.
  emailAlwaysOn?: boolean
}

const PRO_ALL_CHANNELS: readonly NotificationChannel[] = [
  NotificationChannel.IN_APP,
  NotificationChannel.SMS,
  NotificationChannel.EMAIL,
]

const CLIENT_ALL_CHANNELS: readonly NotificationChannel[] = [
  NotificationChannel.IN_APP,
  NotificationChannel.SMS,
  NotificationChannel.EMAIL,
]

const PRO_IN_APP_EMAIL_CHANNELS: readonly NotificationChannel[] = [
  NotificationChannel.IN_APP,
  NotificationChannel.EMAIL,
]

const CLIENT_IN_APP_EMAIL_CHANNELS: readonly NotificationChannel[] = [
  NotificationChannel.IN_APP,
  NotificationChannel.EMAIL,
]

const PRO_IN_APP_ONLY_CHANNELS: readonly NotificationChannel[] = [
  NotificationChannel.IN_APP,
]

const CLIENT_IN_APP_ONLY_CHANNELS: readonly NotificationChannel[] = [
  NotificationChannel.IN_APP,
]

const CLIENT_EMAIL_SMS_CHANNELS: readonly NotificationChannel[] = [
  NotificationChannel.SMS,
  NotificationChannel.EMAIL,
]

// Admin operational alerts: in-app inbox + email only. Admins never receive SMS.
const ADMIN_IN_APP_EMAIL_CHANNELS: readonly NotificationChannel[] = [
  NotificationChannel.IN_APP,
  NotificationChannel.EMAIL,
]

export const NOTIFICATION_EVENT_KEYS: readonly NotificationEventKey[] = [
  NotificationEventKey.BOOKING_REQUEST_CREATED,
  NotificationEventKey.BOOKING_CONFIRMED,
  NotificationEventKey.BOOKING_STARTED,
  NotificationEventKey.BOOKING_RESCHEDULED,
  NotificationEventKey.BOOKING_CANCELLED_BY_CLIENT,
  NotificationEventKey.BOOKING_CANCELLED_BY_PRO,
  NotificationEventKey.BOOKING_CANCELLED_BY_ADMIN,
  NotificationEventKey.CLIENT_CLAIM_INVITE,
  NotificationEventKey.CONSULTATION_PROPOSAL_SENT,
  NotificationEventKey.CONSULTATION_APPROVED,
  NotificationEventKey.CONSULTATION_REJECTED,
  NotificationEventKey.REVIEW_RECEIVED,
  NotificationEventKey.APPOINTMENT_REMINDER,
  NotificationEventKey.AFTERCARE_READY,
  NotificationEventKey.LAST_MINUTE_OPENING_AVAILABLE,
  NotificationEventKey.VIRAL_REQUEST_APPROVED,
  NotificationEventKey.PAYMENT_COLLECTED,
  NotificationEventKey.PAYMENT_ACTION_REQUIRED,
  NotificationEventKey.PAYMENT_REFUNDED,
  NotificationEventKey.LOOK_FOLLOWER_NEW,
  NotificationEventKey.CLIENT_FOLLOW,
  NotificationEventKey.REFERRAL_TAP_RECEIVED,
  NotificationEventKey.REFERRAL_CONFIRMED,
  NotificationEventKey.REFERRAL_CONVERTED,
  NotificationEventKey.ADMIN_VERIFICATION_REVIEW_NEEDED,
  NotificationEventKey.ADMIN_SUPPORT_TICKET_CREATED,
  NotificationEventKey.ADMIN_VIRAL_REQUEST_PENDING,
]

export const NOTIFICATION_EVENT_DEFINITIONS: Record<
  NotificationEventKey,
  NotificationEventDefinition
> = {
  [NotificationEventKey.BOOKING_REQUEST_CREATED]: {
    key: NotificationEventKey.BOOKING_REQUEST_CREATED,
    defaultPriority: NotificationPriority.HIGH,
    transactional: true,
    allowQuietHoursBypass: true,
    templateKey: 'booking_request_created',
    supportedRecipients: [NotificationRecipientKind.PRO],
    defaultChannelsByRecipient: {
      [NotificationRecipientKind.PRO]: PRO_ALL_CHANNELS,
    },
  },

  [NotificationEventKey.BOOKING_CONFIRMED]: {
    key: NotificationEventKey.BOOKING_CONFIRMED,
    defaultPriority: NotificationPriority.NORMAL,
    transactional: true,
    allowQuietHoursBypass: false,
    // A booking confirmation must always reach the recipient by email — it's the
    // record of the appointment and can't be silenced by a channel preference.
    emailAlwaysOn: true,
    templateKey: 'booking_confirmed',
    supportedRecipients: [
      NotificationRecipientKind.PRO,
      NotificationRecipientKind.CLIENT,
    ],
    defaultChannelsByRecipient: {
      [NotificationRecipientKind.PRO]: PRO_IN_APP_EMAIL_CHANNELS,
      // Tier B confirmation: in-app + email (push later). No SMS for app users.
      [NotificationRecipientKind.CLIENT]: CLIENT_IN_APP_EMAIL_CHANNELS,
    },
  },

  [NotificationEventKey.BOOKING_STARTED]: {
    key: NotificationEventKey.BOOKING_STARTED,
    defaultPriority: NotificationPriority.HIGH,
    transactional: true,
    allowQuietHoursBypass: true,
    templateKey: 'booking_started',
    supportedRecipients: [NotificationRecipientKind.CLIENT],
    defaultChannelsByRecipient: {
      // In-app only now (push later) — booking-started is a low-urgency nudge,
      // not worth SMS or email.
      [NotificationRecipientKind.CLIENT]: CLIENT_IN_APP_ONLY_CHANNELS,
    },
  },

  [NotificationEventKey.BOOKING_RESCHEDULED]: {
    key: NotificationEventKey.BOOKING_RESCHEDULED,
    defaultPriority: NotificationPriority.HIGH,
    transactional: true,
    allowQuietHoursBypass: true,
    templateKey: 'booking_rescheduled',
    supportedRecipients: [
      NotificationRecipientKind.PRO,
      NotificationRecipientKind.CLIENT,
    ],
    defaultChannelsByRecipient: {
      [NotificationRecipientKind.PRO]: PRO_ALL_CHANNELS,
      [NotificationRecipientKind.CLIENT]: CLIENT_ALL_CHANNELS,
    },
  },

  [NotificationEventKey.BOOKING_CANCELLED_BY_CLIENT]: {
    key: NotificationEventKey.BOOKING_CANCELLED_BY_CLIENT,
    defaultPriority: NotificationPriority.HIGH,
    transactional: true,
    allowQuietHoursBypass: true,
    emailAlwaysOn: true,
    templateKey: 'booking_cancelled_by_client',
    supportedRecipients: [
      NotificationRecipientKind.PRO,
      NotificationRecipientKind.CLIENT,
    ],
    defaultChannelsByRecipient: {
      [NotificationRecipientKind.PRO]: PRO_ALL_CHANNELS,
      [NotificationRecipientKind.CLIENT]: CLIENT_IN_APP_EMAIL_CHANNELS,
    },
  },

  [NotificationEventKey.BOOKING_CANCELLED_BY_PRO]: {
    key: NotificationEventKey.BOOKING_CANCELLED_BY_PRO,
    defaultPriority: NotificationPriority.HIGH,
    transactional: true,
    allowQuietHoursBypass: true,
    emailAlwaysOn: true,
    templateKey: 'booking_cancelled_by_pro',
    supportedRecipients: [
      NotificationRecipientKind.PRO,
      NotificationRecipientKind.CLIENT,
    ],
    defaultChannelsByRecipient: {
      // Pro is the actor here → calm in-app + email confirmation.
      [NotificationRecipientKind.PRO]: PRO_IN_APP_EMAIL_CHANNELS,
      // Client is the affected party → urgent in-app + email + SMS.
      [NotificationRecipientKind.CLIENT]: CLIENT_ALL_CHANNELS,
    },
  },

  [NotificationEventKey.BOOKING_CANCELLED_BY_ADMIN]: {
    key: NotificationEventKey.BOOKING_CANCELLED_BY_ADMIN,
    defaultPriority: NotificationPriority.HIGH,
    transactional: true,
    allowQuietHoursBypass: true,
    emailAlwaysOn: true,
    templateKey: 'booking_cancelled_by_admin',
    supportedRecipients: [
      NotificationRecipientKind.PRO,
      NotificationRecipientKind.CLIENT,
    ],
    defaultChannelsByRecipient: {
      [NotificationRecipientKind.PRO]: PRO_ALL_CHANNELS,
      [NotificationRecipientKind.CLIENT]: CLIENT_ALL_CHANNELS,
    },
  },

  [NotificationEventKey.CLIENT_CLAIM_INVITE]: {
    key: NotificationEventKey.CLIENT_CLAIM_INVITE,
    defaultPriority: NotificationPriority.HIGH,
    transactional: true,
    allowQuietHoursBypass: true,
    templateKey: 'client_claim_invite',
    supportedRecipients: [NotificationRecipientKind.CLIENT],
    defaultChannelsByRecipient: {
      [NotificationRecipientKind.CLIENT]: CLIENT_EMAIL_SMS_CHANNELS,
    },
  },

  [NotificationEventKey.CONSULTATION_PROPOSAL_SENT]: {
    key: NotificationEventKey.CONSULTATION_PROPOSAL_SENT,
    defaultPriority: NotificationPriority.NORMAL,
    transactional: true,
    allowQuietHoursBypass: false,
    templateKey: 'consultation_proposal_sent',
    supportedRecipients: [NotificationRecipientKind.CLIENT],
    defaultChannelsByRecipient: {
      // SMS included so phone-only (often unclaimed) clients receive the
      // secure consultation magic link. Email-preferred clients still get email.
      [NotificationRecipientKind.CLIENT]: CLIENT_ALL_CHANNELS,
    },
  },

  [NotificationEventKey.CONSULTATION_APPROVED]: {
    key: NotificationEventKey.CONSULTATION_APPROVED,
    defaultPriority: NotificationPriority.NORMAL,
    transactional: true,
    allowQuietHoursBypass: false,
    templateKey: 'consultation_approved',
    supportedRecipients: [
      NotificationRecipientKind.PRO,
      NotificationRecipientKind.CLIENT,
    ],
    defaultChannelsByRecipient: {
      [NotificationRecipientKind.PRO]: PRO_IN_APP_EMAIL_CHANNELS,
      // Tier B confirmation: in-app + email (push later). No SMS for app users.
      [NotificationRecipientKind.CLIENT]: CLIENT_IN_APP_EMAIL_CHANNELS,
    },
  },

  [NotificationEventKey.CONSULTATION_REJECTED]: {
    key: NotificationEventKey.CONSULTATION_REJECTED,
    defaultPriority: NotificationPriority.NORMAL,
    transactional: true,
    allowQuietHoursBypass: false,
    templateKey: 'consultation_rejected',
    supportedRecipients: [
      NotificationRecipientKind.PRO,
      NotificationRecipientKind.CLIENT,
    ],
    defaultChannelsByRecipient: {
      [NotificationRecipientKind.PRO]: PRO_IN_APP_EMAIL_CHANNELS,
      // Tier B confirmation: in-app + email (push later). No SMS for app users.
      [NotificationRecipientKind.CLIENT]: CLIENT_IN_APP_EMAIL_CHANNELS,
    },
  },

  [NotificationEventKey.REVIEW_RECEIVED]: {
    key: NotificationEventKey.REVIEW_RECEIVED,
    defaultPriority: NotificationPriority.LOW,
    transactional: true,
    allowQuietHoursBypass: false,
    templateKey: 'review_received',
    supportedRecipients: [NotificationRecipientKind.PRO],
    defaultChannelsByRecipient: {
      // Tier C social: in-app only (push later). No email — reviews are not a
      // durable-record event worth an inbox message.
      [NotificationRecipientKind.PRO]: PRO_IN_APP_ONLY_CHANNELS,
    },
  },

  [NotificationEventKey.APPOINTMENT_REMINDER]: {
    key: NotificationEventKey.APPOINTMENT_REMINDER,
    defaultPriority: NotificationPriority.HIGH,
    transactional: true,
    allowQuietHoursBypass: false,
    templateKey: 'appointment_reminder',
    supportedRecipients: [
      NotificationRecipientKind.PRO,
      NotificationRecipientKind.CLIENT,
    ],
    defaultChannelsByRecipient: {
      [NotificationRecipientKind.PRO]: PRO_IN_APP_ONLY_CHANNELS,
      [NotificationRecipientKind.CLIENT]: CLIENT_ALL_CHANNELS,
    },
  },

  [NotificationEventKey.AFTERCARE_READY]: {
    key: NotificationEventKey.AFTERCARE_READY,
    defaultPriority: NotificationPriority.NORMAL,
    transactional: true,
    allowQuietHoursBypass: false,
    templateKey: 'aftercare_ready',
    supportedRecipients: [NotificationRecipientKind.CLIENT],
    defaultChannelsByRecipient: {
      // SMS included so phone-only (often unclaimed) clients receive the
      // secure aftercare magic link. Email-preferred clients still get email.
      [NotificationRecipientKind.CLIENT]: CLIENT_ALL_CHANNELS,
    },
  },

  [NotificationEventKey.LAST_MINUTE_OPENING_AVAILABLE]: {
    key: NotificationEventKey.LAST_MINUTE_OPENING_AVAILABLE,
    defaultPriority: NotificationPriority.NORMAL,
    transactional: false,
    allowQuietHoursBypass: false,
    templateKey: 'last_minute_opening_available',
    supportedRecipients: [NotificationRecipientKind.CLIENT],
    defaultChannelsByRecipient: {
      [NotificationRecipientKind.CLIENT]: CLIENT_IN_APP_ONLY_CHANNELS,
    },
  },

  [NotificationEventKey.VIRAL_REQUEST_APPROVED]: {
    key: NotificationEventKey.VIRAL_REQUEST_APPROVED,
    defaultPriority: NotificationPriority.NORMAL,
    transactional: false,
    allowQuietHoursBypass: false,
    templateKey: 'viral_request_approved',
    supportedRecipients: [NotificationRecipientKind.PRO],
    defaultChannelsByRecipient: {
      [NotificationRecipientKind.PRO]: PRO_IN_APP_ONLY_CHANNELS,
    },
  },

  [NotificationEventKey.PAYMENT_COLLECTED]: {
    key: NotificationEventKey.PAYMENT_COLLECTED,
    defaultPriority: NotificationPriority.NORMAL,
    transactional: true,
    allowQuietHoursBypass: false,
    emailAlwaysOn: true,
    templateKey: 'payment_collected',
    supportedRecipients: [
      NotificationRecipientKind.PRO,
      NotificationRecipientKind.CLIENT,
    ],
    defaultChannelsByRecipient: {
      [NotificationRecipientKind.PRO]: PRO_IN_APP_EMAIL_CHANNELS,
      [NotificationRecipientKind.CLIENT]: CLIENT_IN_APP_EMAIL_CHANNELS,
    },
  },

  [NotificationEventKey.PAYMENT_ACTION_REQUIRED]: {
    key: NotificationEventKey.PAYMENT_ACTION_REQUIRED,
    defaultPriority: NotificationPriority.HIGH,
    transactional: true,
    // Tier A urgent: a payment that needs action (e.g. failed/3DS) is
    // time-critical, so it bypasses quiet hours.
    allowQuietHoursBypass: true,
    emailAlwaysOn: true,
    templateKey: 'payment_action_required',
    supportedRecipients: [
      NotificationRecipientKind.PRO,
      NotificationRecipientKind.CLIENT,
    ],
    defaultChannelsByRecipient: {
      [NotificationRecipientKind.PRO]: PRO_IN_APP_EMAIL_CHANNELS,
      [NotificationRecipientKind.CLIENT]: CLIENT_ALL_CHANNELS,
    },
  },

  [NotificationEventKey.PAYMENT_REFUNDED]: {
    key: NotificationEventKey.PAYMENT_REFUNDED,
    defaultPriority: NotificationPriority.NORMAL,
    transactional: true,
    allowQuietHoursBypass: false,
    emailAlwaysOn: true,
    templateKey: 'payment_refunded',
    supportedRecipients: [
      NotificationRecipientKind.PRO,
      NotificationRecipientKind.CLIENT,
    ],
    defaultChannelsByRecipient: {
      // Tier B receipt: in-app + email (push later). No SMS.
      [NotificationRecipientKind.PRO]: PRO_IN_APP_EMAIL_CHANNELS,
      [NotificationRecipientKind.CLIENT]: CLIENT_IN_APP_EMAIL_CHANNELS,
    },
  },

  [NotificationEventKey.LOOK_FOLLOWER_NEW]: {
    key: NotificationEventKey.LOOK_FOLLOWER_NEW,
    defaultPriority: NotificationPriority.NORMAL,
    transactional: false,
    allowQuietHoursBypass: false,
    templateKey: 'look_follower_new',
    supportedRecipients: [NotificationRecipientKind.PRO],
    defaultChannelsByRecipient: {
      [NotificationRecipientKind.PRO]: PRO_IN_APP_ONLY_CHANNELS,
    },
  },

  // Client→client follow. In-app only (the activity feed) — a follow should
  // never trigger SMS/email. Non-transactional, no quiet-hours bypass.
  [NotificationEventKey.CLIENT_FOLLOW]: {
    key: NotificationEventKey.CLIENT_FOLLOW,
    defaultPriority: NotificationPriority.NORMAL,
    transactional: false,
    allowQuietHoursBypass: false,
    templateKey: 'client_follow',
    supportedRecipients: [NotificationRecipientKind.CLIENT],
    defaultChannelsByRecipient: {
      [NotificationRecipientKind.CLIENT]: CLIENT_IN_APP_ONLY_CHANNELS,
    },
  },

  [NotificationEventKey.REFERRAL_TAP_RECEIVED]: {
    key: NotificationEventKey.REFERRAL_TAP_RECEIVED,
    defaultPriority: NotificationPriority.NORMAL,
    transactional: false,
    allowQuietHoursBypass: false,
    templateKey: 'referral_tap_received',
    supportedRecipients: [NotificationRecipientKind.CLIENT],
    defaultChannelsByRecipient: {
      [NotificationRecipientKind.CLIENT]: CLIENT_IN_APP_ONLY_CHANNELS,
    },
  },

  [NotificationEventKey.REFERRAL_CONFIRMED]: {
    key: NotificationEventKey.REFERRAL_CONFIRMED,
    defaultPriority: NotificationPriority.NORMAL,
    transactional: false,
    allowQuietHoursBypass: false,
    templateKey: 'referral_confirmed',
    supportedRecipients: [NotificationRecipientKind.CLIENT],
    defaultChannelsByRecipient: {
      [NotificationRecipientKind.CLIENT]: CLIENT_IN_APP_ONLY_CHANNELS,
    },
  },

  [NotificationEventKey.REFERRAL_CONVERTED]: {
    key: NotificationEventKey.REFERRAL_CONVERTED,
    defaultPriority: NotificationPriority.NORMAL,
    transactional: false,
    allowQuietHoursBypass: false,
    templateKey: 'referral_converted',
    supportedRecipients: [NotificationRecipientKind.CLIENT],
    defaultChannelsByRecipient: {
      [NotificationRecipientKind.CLIENT]: CLIENT_IN_APP_ONLY_CHANNELS,
    },
  },

  // Vanity-handle reservation about to expire. In-app + email so the pro has a real
  // chance to upgrade (or knows the handle is freeing up). Transactional; no bypass.
  [NotificationEventKey.PRO_HANDLE_RESERVATION_EXPIRING]: {
    key: NotificationEventKey.PRO_HANDLE_RESERVATION_EXPIRING,
    defaultPriority: NotificationPriority.NORMAL,
    transactional: true,
    allowQuietHoursBypass: false,
    templateKey: 'pro_handle_reservation_expiring',
    supportedRecipients: [NotificationRecipientKind.PRO],
    defaultChannelsByRecipient: {
      [NotificationRecipientKind.PRO]: PRO_IN_APP_EMAIL_CHANNELS,
    },
  },

  // Admin operational alerts. Tier B (in-app + email; never SMS). Transactional
  // so they are durable inbox records, but no quiet-hours bypass — admins are an
  // internal audience and these are not time-critical pages.
  [NotificationEventKey.ADMIN_VERIFICATION_REVIEW_NEEDED]: {
    key: NotificationEventKey.ADMIN_VERIFICATION_REVIEW_NEEDED,
    defaultPriority: NotificationPriority.HIGH,
    transactional: true,
    allowQuietHoursBypass: false,
    templateKey: 'admin_verification_review_needed',
    supportedRecipients: [NotificationRecipientKind.ADMIN],
    defaultChannelsByRecipient: {
      [NotificationRecipientKind.ADMIN]: ADMIN_IN_APP_EMAIL_CHANNELS,
    },
  },

  [NotificationEventKey.ADMIN_SUPPORT_TICKET_CREATED]: {
    key: NotificationEventKey.ADMIN_SUPPORT_TICKET_CREATED,
    defaultPriority: NotificationPriority.NORMAL,
    transactional: true,
    allowQuietHoursBypass: false,
    templateKey: 'admin_support_ticket_created',
    supportedRecipients: [NotificationRecipientKind.ADMIN],
    defaultChannelsByRecipient: {
      [NotificationRecipientKind.ADMIN]: ADMIN_IN_APP_EMAIL_CHANNELS,
    },
  },

  [NotificationEventKey.ADMIN_VIRAL_REQUEST_PENDING]: {
    key: NotificationEventKey.ADMIN_VIRAL_REQUEST_PENDING,
    defaultPriority: NotificationPriority.NORMAL,
    transactional: true,
    allowQuietHoursBypass: false,
    templateKey: 'admin_viral_request_pending',
    supportedRecipients: [NotificationRecipientKind.ADMIN],
    defaultChannelsByRecipient: {
      [NotificationRecipientKind.ADMIN]: ADMIN_IN_APP_EMAIL_CHANNELS,
    },
  },
}

export const PRO_NOTIFICATION_EVENT_KEYS: readonly NotificationEventKey[] = [
  NotificationEventKey.BOOKING_REQUEST_CREATED,
  NotificationEventKey.BOOKING_CONFIRMED,
  NotificationEventKey.BOOKING_RESCHEDULED,
  NotificationEventKey.BOOKING_CANCELLED_BY_CLIENT,
  NotificationEventKey.BOOKING_CANCELLED_BY_PRO,
  NotificationEventKey.BOOKING_CANCELLED_BY_ADMIN,
  NotificationEventKey.CONSULTATION_APPROVED,
  NotificationEventKey.CONSULTATION_REJECTED,
  NotificationEventKey.REVIEW_RECEIVED,
  NotificationEventKey.APPOINTMENT_REMINDER,
  NotificationEventKey.VIRAL_REQUEST_APPROVED,
  NotificationEventKey.PAYMENT_COLLECTED,
  NotificationEventKey.PAYMENT_ACTION_REQUIRED,
  NotificationEventKey.PAYMENT_REFUNDED,
  NotificationEventKey.LOOK_FOLLOWER_NEW,
]

export const CLIENT_NOTIFICATION_EVENT_KEYS: readonly NotificationEventKey[] = [
  NotificationEventKey.BOOKING_CONFIRMED,
  NotificationEventKey.BOOKING_RESCHEDULED,
  NotificationEventKey.BOOKING_CANCELLED_BY_CLIENT,
  NotificationEventKey.BOOKING_CANCELLED_BY_PRO,
  NotificationEventKey.BOOKING_CANCELLED_BY_ADMIN,
  NotificationEventKey.CLIENT_CLAIM_INVITE,
  NotificationEventKey.CONSULTATION_PROPOSAL_SENT,
  NotificationEventKey.CONSULTATION_APPROVED,
  NotificationEventKey.CONSULTATION_REJECTED,
  NotificationEventKey.APPOINTMENT_REMINDER,
  NotificationEventKey.AFTERCARE_READY,
  NotificationEventKey.LAST_MINUTE_OPENING_AVAILABLE,
  NotificationEventKey.PAYMENT_COLLECTED,
  NotificationEventKey.PAYMENT_ACTION_REQUIRED,
  NotificationEventKey.PAYMENT_REFUNDED,
  NotificationEventKey.REFERRAL_TAP_RECEIVED,
  NotificationEventKey.REFERRAL_CONFIRMED,
  NotificationEventKey.REFERRAL_CONVERTED,
]

export const ADMIN_NOTIFICATION_EVENT_KEYS: readonly NotificationEventKey[] = [
  NotificationEventKey.ADMIN_VERIFICATION_REVIEW_NEEDED,
  NotificationEventKey.ADMIN_SUPPORT_TICKET_CREATED,
  NotificationEventKey.ADMIN_VIRAL_REQUEST_PENDING,
]

export function getNotificationEventDefinition(
  key: NotificationEventKey,
): NotificationEventDefinition {
  return NOTIFICATION_EVENT_DEFINITIONS[key]
}

export function isRecipientSupportedForEvent(
  key: NotificationEventKey,
  recipientKind: NotificationRecipientKind,
): boolean {
  return getNotificationEventDefinition(key).supportedRecipients.includes(
    recipientKind,
  )
}

/**
 * Whether the EMAIL channel for this event is mandatory — it can never be turned
 * off by a recipient preference (critical events like payment receipts). Used by
 * the channel policy to force email through and by the preferences UI to lock
 * the email toggle on.
 */
export function isEmailAlwaysOnEvent(key: NotificationEventKey): boolean {
  return getNotificationEventDefinition(key).emailAlwaysOn === true
}

export function getDefaultChannelsForRecipient(args: {
  key: NotificationEventKey
  recipientKind: NotificationRecipientKind
}): readonly NotificationChannel[] {
  const definition = getNotificationEventDefinition(args.key)

  if (!definition.supportedRecipients.includes(args.recipientKind)) {
    throw new Error(
      `eventKeys: recipient ${args.recipientKind} is not supported for event ${args.key}`,
    )
  }

  const channels = definition.defaultChannelsByRecipient[args.recipientKind]

  if (!channels || channels.length === 0) {
    throw new Error(
      `eventKeys: missing default channels for recipient ${args.recipientKind} on event ${args.key}`,
    )
  }

  return channels
}

export function listSupportedNotificationEventKeys(
  recipientKind: NotificationRecipientKind,
): NotificationEventKey[] {
  return NOTIFICATION_EVENT_KEYS.filter((key) =>
    isRecipientSupportedForEvent(key, recipientKind),
  )
}