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
    templateKey: 'booking_confirmed',
    supportedRecipients: [
      NotificationRecipientKind.PRO,
      NotificationRecipientKind.CLIENT,
    ],
    defaultChannelsByRecipient: {
      [NotificationRecipientKind.PRO]: PRO_IN_APP_EMAIL_CHANNELS,
      [NotificationRecipientKind.CLIENT]: CLIENT_ALL_CHANNELS,
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
      [NotificationRecipientKind.CLIENT]: CLIENT_ALL_CHANNELS,
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
    templateKey: 'booking_cancelled_by_pro',
    supportedRecipients: [
      NotificationRecipientKind.PRO,
      NotificationRecipientKind.CLIENT,
    ],
    defaultChannelsByRecipient: {
      [NotificationRecipientKind.PRO]: PRO_ALL_CHANNELS,
      [NotificationRecipientKind.CLIENT]: CLIENT_ALL_CHANNELS,
    },
  },

  [NotificationEventKey.BOOKING_CANCELLED_BY_ADMIN]: {
    key: NotificationEventKey.BOOKING_CANCELLED_BY_ADMIN,
    defaultPriority: NotificationPriority.HIGH,
    transactional: true,
    allowQuietHoursBypass: true,
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
      [NotificationRecipientKind.CLIENT]: CLIENT_IN_APP_EMAIL_CHANNELS,
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
      [NotificationRecipientKind.CLIENT]: CLIENT_ALL_CHANNELS,
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
      [NotificationRecipientKind.CLIENT]: CLIENT_ALL_CHANNELS,
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
      [NotificationRecipientKind.PRO]: PRO_IN_APP_EMAIL_CHANNELS,
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
      [NotificationRecipientKind.CLIENT]: CLIENT_IN_APP_EMAIL_CHANNELS,
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
    allowQuietHoursBypass: false,
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