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
  | 'review_requested'
  | 'appointment_reminder'
  | 'appointment_confirmation_declined'
  | 'aftercare_ready'
  | 'last_minute_opening_available'
  | 'waitlist_time_offered'
  | 'saved_look_availability_opened'
  | 'event_date_countdown'
  | 'rebook_cadence_due'
  | 'saved_look_consult_nudge'
  | 'ai_consult_invitation'
  | 'ai_consult_analysis_ready'
  | 'ai_consult_analysis_failed'
  | 'saved_look_price_alternative'
  | 'viral_request_approved'
  | 'payment_collected'
  | 'payment_action_required'
  | 'payment_confirmation_required'
  | 'payment_refunded'
  | 'no_show_fee_charged'
  | 'no_show_deposit_kept'
  | 'deposit_reminder'
  | 'deposit_payment_link'
  | 'consent_signature_request'
  | 'chart_access_requested'
  | 'chart_access_granted'
  | 'look_follower_new'
  | 'client_follow'
  | 'look_commented'
  | 'look_comment_replied'
  | 'look_liked'
  | 'look_saved'
  | 'look_new_from_followed_pro'
  | 'look_milestone'
  | 'referral_tap_received'
  | 'referral_confirmed'
  | 'referral_converted'
  | 'message_received'
  | 'waitlist_joined'
  | 'waitlist_offer_expired'
  | 'waitlist_client_left'
  | 'pro_handle_reservation_expiring'
  | 'pro_license_expiring_soon'
  | 'pro_license_expired'
  | 'admin_verification_review_needed'
  | 'admin_support_ticket_created'
  | 'admin_viral_request_pending'
  // Not tied to a single NotificationEventKey — the weekly social digest email
  // (social-first C3) batches many unread social events and renders its own
  // body, so it never flows through the per-event render pipeline. It carries a
  // template key only to satisfy the email content type when reusing
  // EmailDeliveryProvider.send(); the standard renderer below is a fallback and
  // is not invoked for the digest.
  | 'social_digest'

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

// CLIENT_ALL_CHANNELS with the "push later" channel added (see the note on the
// *_PUSH sets below).
//
// This is the set for anything that happens TO a client's appointment — the
// reminder itself, a reschedule, a cancellation they did not initiate. Those are
// the notifications a client expects on their phone; on CLIENT_ALL_CHANNELS they
// could only ever reach a client who had verified a phone or an email, and never
// reached the app at all (prod: zero PUSH deliveries for APPOINTMENT_REMINDER,
// against 22 in-app rows).
//
// Also used by AFTERCARE_READY, which has TWO emitters that split the channel set
// via per-emit requestedChannels: the magic-link delivery owns EMAIL+SMS (secure
// /client/rebook token link), the inbox notification owns IN_APP+PUSH. PUSH must
// be in the default set for the inbox emit's requested [IN_APP, PUSH] to survive
// the channel-policy intersection.
//
// PUSH is capability-gated end to end (no provider configured, or no active
// DeviceToken → the row is suppressed at enqueue, never created un-sendable), so
// widening a default set is safe for recipients who have no push destination.
const CLIENT_IN_APP_SMS_EMAIL_PUSH_CHANNELS: readonly NotificationChannel[] = [
  NotificationChannel.IN_APP,
  NotificationChannel.SMS,
  NotificationChannel.EMAIL,
  NotificationChannel.PUSH,
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

// "Push later" channel sets — the same audiences as the *_EMAIL / *_ONLY sets
// above, now WITH the PUSH channel. PUSH stays fully inert until a provider is
// configured and the recipient has registered device tokens (the capability gate
// in channelPolicy/enqueueDispatch suppresses it otherwise), so adding it to the
// default channel list is safe and is what makes PUSH fan out once it's live.
const CLIENT_IN_APP_EMAIL_PUSH_CHANNELS: readonly NotificationChannel[] = [
  NotificationChannel.IN_APP,
  NotificationChannel.EMAIL,
  NotificationChannel.PUSH,
]

const CLIENT_IN_APP_PUSH_CHANNELS: readonly NotificationChannel[] = [
  NotificationChannel.IN_APP,
  NotificationChannel.PUSH,
]

const PRO_IN_APP_EMAIL_PUSH_CHANNELS: readonly NotificationChannel[] = [
  NotificationChannel.IN_APP,
  NotificationChannel.EMAIL,
  NotificationChannel.PUSH,
]

const PRO_IN_APP_PUSH_CHANNELS: readonly NotificationChannel[] = [
  NotificationChannel.IN_APP,
  NotificationChannel.PUSH,
]

const CLIENT_EMAIL_SMS_CHANNELS: readonly NotificationChannel[] = [
  NotificationChannel.SMS,
  NotificationChannel.EMAIL,
]

// Admin operational alerts: in-app inbox + email + push. Admins never receive
// SMS. PUSH stays inert until APNs creds land and the admin has a registered
// device token, so adding it here is safe and lights up once push goes live
// (§12 NC2 admin +PUSH).
const ADMIN_IN_APP_EMAIL_PUSH_CHANNELS: readonly NotificationChannel[] = [
  NotificationChannel.IN_APP,
  NotificationChannel.EMAIL,
  NotificationChannel.PUSH,
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
  NotificationEventKey.REVIEW_REQUESTED,
  NotificationEventKey.APPOINTMENT_REMINDER,
  NotificationEventKey.AFTERCARE_READY,
  NotificationEventKey.LAST_MINUTE_OPENING_AVAILABLE,
  NotificationEventKey.WAITLIST_TIME_OFFERED,
  NotificationEventKey.SAVED_LOOK_AVAILABILITY_OPENED,
  NotificationEventKey.EVENT_DATE_COUNTDOWN,
  NotificationEventKey.REBOOK_CADENCE_DUE,
  NotificationEventKey.SAVED_LOOK_CONSULT_NUDGE,
  NotificationEventKey.AI_CONSULT_INVITATION,
  NotificationEventKey.AI_CONSULT_ANALYSIS_READY,
  NotificationEventKey.AI_CONSULT_ANALYSIS_FAILED,
  NotificationEventKey.SAVED_LOOK_PRICE_ALTERNATIVE,
  NotificationEventKey.VIRAL_REQUEST_APPROVED,
  NotificationEventKey.PAYMENT_COLLECTED,
  NotificationEventKey.PAYMENT_ACTION_REQUIRED,
  NotificationEventKey.PAYMENT_CONFIRMATION_REQUIRED,
  NotificationEventKey.PAYMENT_REFUNDED,
  NotificationEventKey.NO_SHOW_FEE_CHARGED,
  NotificationEventKey.NO_SHOW_DEPOSIT_KEPT,
  NotificationEventKey.DEPOSIT_REMINDER,
  NotificationEventKey.LOOK_FOLLOWER_NEW,
  NotificationEventKey.CLIENT_FOLLOW,
  NotificationEventKey.LOOK_COMMENTED,
  NotificationEventKey.LOOK_COMMENT_REPLIED,
  NotificationEventKey.LOOK_LIKED,
  NotificationEventKey.LOOK_SAVED,
  NotificationEventKey.LOOK_NEW_FROM_FOLLOWED_PRO,
  NotificationEventKey.LOOK_MILESTONE_REACHED,
  NotificationEventKey.REFERRAL_TAP_RECEIVED,
  NotificationEventKey.REFERRAL_CONFIRMED,
  NotificationEventKey.REFERRAL_CONVERTED,
  NotificationEventKey.MESSAGE_RECEIVED,
  NotificationEventKey.CHART_ACCESS_REQUESTED,
  NotificationEventKey.CHART_ACCESS_GRANTED,
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
    // Bypass quiet hours: a confirmation is a transactional receipt for an action
    // the recipient JUST took, so it must arrive immediately — not be deferred to
    // 08:00 (which reads as "I booked and never got a confirmation"). This matches
    // every sibling booking-lifecycle event (request/rescheduled/started/cancelled
    // all bypass); BOOKING_CONFIRMED was the lone exception.
    allowQuietHoursBypass: true,
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
      // Tier B confirmation: in-app + email + push. No SMS for app users.
      [NotificationRecipientKind.CLIENT]: CLIENT_IN_APP_EMAIL_PUSH_CHANNELS,
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
      // In-app + push — booking-started is a low-urgency nudge, not worth SMS or
      // email, but a good fit for a push tap.
      [NotificationRecipientKind.CLIENT]: CLIENT_IN_APP_PUSH_CHANNELS,
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
      // The client's appointment moved without them acting — same urgency as the
      // reminder, so it reaches the phone too.
      [NotificationRecipientKind.CLIENT]: CLIENT_IN_APP_SMS_EMAIL_PUSH_CHANNELS,
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
      // Client is the affected party → urgent in-app + email + SMS + push.
      [NotificationRecipientKind.CLIENT]: CLIENT_IN_APP_SMS_EMAIL_PUSH_CHANNELS,
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
      // Client is the affected party → same set as a pro-side cancellation.
      [NotificationRecipientKind.CLIENT]: CLIENT_IN_APP_SMS_EMAIL_PUSH_CHANNELS,
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
    // Pro-initiated, in-session approval the client is actively waiting on —
    // must reach them immediately even during quiet hours (mirrors
    // CLIENT_CLAIM_INVITE). Otherwise a late-evening consultation is deferred
    // to morning and the pro is stuck mid-session.
    allowQuietHoursBypass: true,
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
      // Pro side is in-app only (§12 NC2): the pro is mid-session and watching
      // the app — an email receipt for their own client's approval is noise.
      [NotificationRecipientKind.PRO]: PRO_IN_APP_ONLY_CHANNELS,
      // Tier B confirmation: in-app + email + push. No SMS for app users.
      [NotificationRecipientKind.CLIENT]: CLIENT_IN_APP_EMAIL_PUSH_CHANNELS,
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
      // Pro side is in-app only (§12 NC2): a declined proposal is a live
      // in-session signal for the pro, not an inbox receipt.
      [NotificationRecipientKind.PRO]: PRO_IN_APP_ONLY_CHANNELS,
      // Tier B confirmation: in-app + email + push. No SMS for app users.
      [NotificationRecipientKind.CLIENT]: CLIENT_IN_APP_EMAIL_PUSH_CHANNELS,
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
      // Tier C social: in-app + push. No email — reviews are not a durable-record
      // event worth an inbox message, but a push tap fits.
      [NotificationRecipientKind.PRO]: PRO_IN_APP_PUSH_CHANNELS,
    },
  },

  [NotificationEventKey.REVIEW_REQUESTED]: {
    key: NotificationEventKey.REVIEW_REQUESTED,
    defaultPriority: NotificationPriority.LOW,
    // Promotional-adjacent nudge, NOT transactional: review requests are not
    // in the approved transactional SMS use cases (lib/transactionalSmsPolicy)
    // — so no SMS channel, no quiet-hours bypass.
    transactional: false,
    allowQuietHoursBypass: false,
    templateKey: 'review_requested',
    supportedRecipients: [NotificationRecipientKind.CLIENT],
    defaultChannelsByRecipient: {
      [NotificationRecipientKind.CLIENT]: CLIENT_IN_APP_EMAIL_PUSH_CHANNELS,
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
      // The client's own reminder about their own appointment — the one
      // notification that most needs to reach the phone, so PUSH is in the set.
      [NotificationRecipientKind.CLIENT]: CLIENT_IN_APP_SMS_EMAIL_PUSH_CHANNELS,
    },
  },

  [NotificationEventKey.APPOINTMENT_CONFIRMATION_DECLINED]: {
    key: NotificationEventKey.APPOINTMENT_CONFIRMATION_DECLINED,
    defaultPriority: NotificationPriority.HIGH,
    transactional: true,
    // No quiet-hours bypass ON PURPOSE (K12): D5 means the slot stays occupied
    // whether the pro reads this at 3am or 8am — nothing time-critical changes
    // overnight, so the decline defers like any other non-urgent notice
    // (unlike the cancel events, which are bypass:true because the slot has
    // ALREADY been freed and may be resellable).
    allowQuietHoursBypass: false,
    templateKey: 'appointment_confirmation_declined',
    supportedRecipients: [NotificationRecipientKind.PRO],
    defaultChannelsByRecipient: {
      [NotificationRecipientKind.PRO]: PRO_IN_APP_EMAIL_PUSH_CHANNELS,
    },
  },

  [NotificationEventKey.AFTERCARE_READY]: {
    key: NotificationEventKey.AFTERCARE_READY,
    defaultPriority: NotificationPriority.NORMAL,
    transactional: true,
    // Pro-initiated at end of session (client pays / rebooks via the magic
    // link) — deliver immediately rather than deferring to morning quiet-hours
    // end. Mirrors CLIENT_CLAIM_INVITE / CONSULTATION_PROPOSAL_SENT.
    allowQuietHoursBypass: true,
    templateKey: 'aftercare_ready',
    supportedRecipients: [NotificationRecipientKind.CLIENT],
    defaultChannelsByRecipient: {
      // AFTERCARE_READY has two emitters that split these channels via per-emit
      // requestedChannels (§23): the magic-link delivery
      // (createAftercareAccessDelivery) owns EMAIL+SMS and carries the secure
      // /client/rebook token link (works with no login, reaches phone-only /
      // unclaimed clients); the inbox notification
      // (createUpdateClientNotification) owns IN_APP+PUSH and deep-links the
      // login-gated in-app booking view (fine for an authenticated tap). Both
      // channels live here; neither emit sends the full set. PUSH stays inert
      // until APNs is live.
      [NotificationRecipientKind.CLIENT]: CLIENT_IN_APP_SMS_EMAIL_PUSH_CHANNELS,
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
      // §12 NC2 #26: in-app + push + email for both variants (broadcast and the
      // 1:1 priority offer). PUSH stays inert until APNs creds land; EMAIL honors
      // the per-event preference toggle. The additional +SMS on the 1:1 PRIORITY
      // offer only (never the mass broadcast — Twilio cost + promo-consent/TCPA)
      // is deferred: it needs a per-variant channel override (a new event key or
      // a channel-override on the emit) plus promotional-SMS consent verification.
      [NotificationRecipientKind.CLIENT]: CLIENT_IN_APP_EMAIL_PUSH_CHANNELS,
    },
  },

  [NotificationEventKey.WAITLIST_TIME_OFFERED]: {
    // A pro proposed a specific appointment time to a waitlisted client, who
    // must Confirm before it books. Time-sensitive (the slot can be taken), so
    // it pushes as well as landing in-app — but stays a non-transactional,
    // quiet-hours-respecting nudge like the sibling last-minute opening.
    key: NotificationEventKey.WAITLIST_TIME_OFFERED,
    defaultPriority: NotificationPriority.HIGH,
    transactional: false,
    allowQuietHoursBypass: false,
    templateKey: 'waitlist_time_offered',
    supportedRecipients: [NotificationRecipientKind.CLIENT],
    defaultChannelsByRecipient: {
      [NotificationRecipientKind.CLIENT]: CLIENT_IN_APP_PUSH_CHANNELS,
    },
  },

  [NotificationEventKey.SAVED_LOOK_AVAILABILITY_OPENED]: {
    // §6.8 saved-not-booked activation, pooled under the §8.1 re-engagement
    // budget. A gentle, promotional-adjacent nudge (NOT transactional — no SMS,
    // no quiet-hours bypass, mirrors REVIEW_REQUESTED / LAST_MINUTE_OPENING): the
    // pro whose look you saved but never booked now has a near-term opening.
    key: NotificationEventKey.SAVED_LOOK_AVAILABILITY_OPENED,
    defaultPriority: NotificationPriority.LOW,
    transactional: false,
    allowQuietHoursBypass: false,
    templateKey: 'saved_look_availability_opened',
    supportedRecipients: [NotificationRecipientKind.CLIENT],
    defaultChannelsByRecipient: {
      // In-app inbox + email + push (push inert until APNs is live). No SMS —
      // re-engagement nudges are not an approved transactional SMS use case.
      [NotificationRecipientKind.CLIENT]: CLIENT_IN_APP_EMAIL_PUSH_CHANNELS,
    },
  },

  [NotificationEventKey.EVENT_DATE_COUNTDOWN]: {
    // §8 event-date countdown — the HIGHEST-priority re-engagement trigger under
    // the §8.1 budget. Like SAVED_LOOK_AVAILABILITY_OPENED it is a gentle,
    // promotional-adjacent nudge (NOT transactional — no SMS, no quiet-hours
    // bypass): a client's dated bridal/prom board is approaching a milestone, so
    // remind them to book their looks while there's still time.
    key: NotificationEventKey.EVENT_DATE_COUNTDOWN,
    defaultPriority: NotificationPriority.LOW,
    transactional: false,
    allowQuietHoursBypass: false,
    templateKey: 'event_date_countdown',
    supportedRecipients: [NotificationRecipientKind.CLIENT],
    defaultChannelsByRecipient: {
      // In-app inbox + email + push (push inert until APNs is live). No SMS —
      // re-engagement nudges are not an approved transactional SMS use case.
      [NotificationRecipientKind.CLIENT]: CLIENT_IN_APP_EMAIL_PUSH_CHANNELS,
    },
  },

  [NotificationEventKey.REBOOK_CADENCE_DUE]: {
    // §6.7 cadence-timed rebook prompt — the third re-engagement trigger under
    // the §8.1 budget (below event countdowns and saved-look openings). Like its
    // siblings it is a gentle, promotional-adjacent nudge (NOT transactional — no
    // SMS, no quiet-hours bypass): a client is now due for a refresh with a pro
    // they've visited before, and that pro has a near-term opening.
    key: NotificationEventKey.REBOOK_CADENCE_DUE,
    defaultPriority: NotificationPriority.LOW,
    transactional: false,
    allowQuietHoursBypass: false,
    templateKey: 'rebook_cadence_due',
    supportedRecipients: [NotificationRecipientKind.CLIENT],
    defaultChannelsByRecipient: {
      // In-app inbox + email + push (push inert until APNs is live). No SMS —
      // re-engagement nudges are not an approved transactional SMS use case.
      [NotificationRecipientKind.CLIENT]: CLIENT_IN_APP_EMAIL_PUSH_CHANNELS,
    },
  },

  [NotificationEventKey.SAVED_LOOK_CONSULT_NUDGE]: {
    // §6.8 hesitation blocker response — the fourth (lowest-priority) re-engagement
    // trigger under the §8.1 budget. Like its siblings it is a gentle,
    // promotional-adjacent nudge (NOT transactional — no SMS, no quiet-hours
    // bypass): a client saved a high-/medium-commitment look but never booked, so
    // invite them to ask questions / book a consult — information, never urgency.
    key: NotificationEventKey.SAVED_LOOK_CONSULT_NUDGE,
    defaultPriority: NotificationPriority.LOW,
    transactional: false,
    allowQuietHoursBypass: false,
    templateKey: 'saved_look_consult_nudge',
    supportedRecipients: [NotificationRecipientKind.CLIENT],
    defaultChannelsByRecipient: {
      // In-app inbox + email + push (push inert until APNs is live). No SMS —
      // re-engagement nudges are not an approved transactional SMS use case.
      [NotificationRecipientKind.CLIENT]: CLIENT_IN_APP_EMAIL_PUSH_CHANNELS,
    },
  },

  [NotificationEventKey.AI_CONSULT_INVITATION]: {
    // C6 booking-confirmation invitation. This is a gentle optional preparation
    // nudge, never part of the transactional booking receipt: it draws from the
    // pooled re-engagement budget and external channels respect quiet hours.
    key: NotificationEventKey.AI_CONSULT_INVITATION,
    defaultPriority: NotificationPriority.LOW,
    transactional: false,
    allowQuietHoursBypass: false,
    templateKey: 'ai_consult_invitation',
    supportedRecipients: [NotificationRecipientKind.CLIENT],
    defaultChannelsByRecipient: {
      [NotificationRecipientKind.CLIENT]: CLIENT_IN_APP_EMAIL_PUSH_CHANNELS,
    },
  },

  [NotificationEventKey.AI_CONSULT_ANALYSIS_READY]: {
    // P4b. TRANSACTIONAL, unlike its AI_CONSULT_INVITATION sibling above, and
    // the difference is who started it: the invitation is the app suggesting
    // something, this is the answer to a thing the client explicitly asked for
    // and is waiting on. It draws no re-engagement budget and it bypasses
    // quiet hours — a client who tapped "run my analysis" at 22:30 and closed
    // the app is owed the result, not a nine-hour silence.
    key: NotificationEventKey.AI_CONSULT_ANALYSIS_READY,
    defaultPriority: NotificationPriority.NORMAL,
    transactional: true,
    allowQuietHoursBypass: true,
    templateKey: 'ai_consult_analysis_ready',
    supportedRecipients: [NotificationRecipientKind.CLIENT],
    defaultChannelsByRecipient: {
      // No SMS. The result lives behind a login and says nothing useful in 160
      // characters; in-app + email + push is the whole audience that can act
      // on it.
      [NotificationRecipientKind.CLIENT]: CLIENT_IN_APP_EMAIL_PUSH_CHANNELS,
    },
  },

  [NotificationEventKey.AI_CONSULT_ANALYSIS_FAILED]: {
    // P4b. Also transactional — the client is sitting on a promise the app
    // made and cannot otherwise learn it was broken. The copy carries no
    // failure detail: the code is for the client app to map, and what the
    // client is told is that it did not finish and can be tried again.
    key: NotificationEventKey.AI_CONSULT_ANALYSIS_FAILED,
    defaultPriority: NotificationPriority.NORMAL,
    transactional: true,
    allowQuietHoursBypass: true,
    templateKey: 'ai_consult_analysis_failed',
    supportedRecipients: [NotificationRecipientKind.CLIENT],
    defaultChannelsByRecipient: {
      [NotificationRecipientKind.CLIENT]: CLIENT_IN_APP_EMAIL_PUSH_CHANNELS,
    },
  },

  [NotificationEventKey.SAVED_LOOK_PRICE_ALTERNATIVE]: {
    // §6.8 price blocker response — the fifth re-engagement trigger under the §8.1
    // budget. Like its siblings it is a gentle, promotional-adjacent nudge (NOT
    // transactional — no SMS, no quiet-hours bypass): a client saved a look priced
    // well above their learned price band but never booked, so point them at a
    // similar look from a pro whose price is in their range — help, never a judgment
    // (the copy never names price).
    key: NotificationEventKey.SAVED_LOOK_PRICE_ALTERNATIVE,
    defaultPriority: NotificationPriority.LOW,
    transactional: false,
    allowQuietHoursBypass: false,
    templateKey: 'saved_look_price_alternative',
    supportedRecipients: [NotificationRecipientKind.CLIENT],
    defaultChannelsByRecipient: {
      // In-app inbox + email + push (push inert until APNs is live). No SMS —
      // re-engagement nudges are not an approved transactional SMS use case.
      [NotificationRecipientKind.CLIENT]: CLIENT_IN_APP_EMAIL_PUSH_CHANNELS,
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

  [NotificationEventKey.PAYMENT_CONFIRMATION_REQUIRED]: {
    key: NotificationEventKey.PAYMENT_CONFIRMATION_REQUIRED,
    defaultPriority: NotificationPriority.HIGH,
    transactional: true,
    // Action-required for the pro: a client attested an off-platform payment and
    // is (potentially) waiting on a coupled next appointment. Must arrive
    // promptly rather than be deferred to morning — mirrors the other
    // booking-lifecycle asks (request/confirmed all bypass).
    allowQuietHoursBypass: true,
    templateKey: 'payment_confirmation_required',
    supportedRecipients: [NotificationRecipientKind.PRO],
    defaultChannelsByRecipient: {
      [NotificationRecipientKind.PRO]: PRO_IN_APP_EMAIL_CHANNELS,
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
      // Tier B receipt: in-app + email + push. No SMS.
      [NotificationRecipientKind.PRO]: PRO_IN_APP_EMAIL_PUSH_CHANNELS,
      [NotificationRecipientKind.CLIENT]: CLIENT_IN_APP_EMAIL_PUSH_CHANNELS,
    },
  },

  [NotificationEventKey.NO_SHOW_FEE_CHARGED]: {
    key: NotificationEventKey.NO_SHOW_FEE_CHARGED,
    defaultPriority: NotificationPriority.NORMAL,
    transactional: true,
    allowQuietHoursBypass: false,
    emailAlwaysOn: true,
    templateKey: 'no_show_fee_charged',
    // Client-only: the receipt goes to the client whose card was charged.
    supportedRecipients: [NotificationRecipientKind.CLIENT],
    defaultChannelsByRecipient: {
      // Tier B receipt: in-app + email + push. No SMS.
      [NotificationRecipientKind.CLIENT]: CLIENT_IN_APP_EMAIL_PUSH_CHANNELS,
    },
  },

  [NotificationEventKey.NO_SHOW_DEPOSIT_KEPT]: {
    key: NotificationEventKey.NO_SHOW_DEPOSIT_KEPT,
    defaultPriority: NotificationPriority.NORMAL,
    transactional: true,
    allowQuietHoursBypass: false,
    emailAlwaysOn: true,
    templateKey: 'no_show_deposit_kept',
    // Client-only: the disclosure goes to the client whose deposit was kept. This
    // is the sibling of NO_SHOW_FEE_CHARGED — the other no-show money outcome (a
    // kept deposit suppresses the fee), so it carries the same channel policy.
    supportedRecipients: [NotificationRecipientKind.CLIENT],
    defaultChannelsByRecipient: {
      // Tier B disclosure: in-app + email + push. No SMS.
      [NotificationRecipientKind.CLIENT]: CLIENT_IN_APP_EMAIL_PUSH_CHANNELS,
    },
  },

  [NotificationEventKey.DEPOSIT_REMINDER]: {
    key: NotificationEventKey.DEPOSIT_REMINDER,
    defaultPriority: NotificationPriority.NORMAL,
    // A nudge to finish an unpaid deposit before the hold is auto-released (M5),
    // NOT a transactional receipt — so no SMS, and it RESPECTS quiet hours (a
    // payment nudge at 3am is bad form; the deadline gives ample daytime room).
    transactional: false,
    allowQuietHoursBypass: false,
    templateKey: 'deposit_reminder',
    supportedRecipients: [NotificationRecipientKind.CLIENT],
    defaultChannelsByRecipient: {
      [NotificationRecipientKind.CLIENT]: CLIENT_IN_APP_EMAIL_PUSH_CHANNELS,
    },
  },

  [NotificationEventKey.DEPOSIT_PAYMENT_LINK]: {
    key: NotificationEventKey.DEPOSIT_PAYMENT_LINK,
    defaultPriority: NotificationPriority.HIGH,
    transactional: true,
    // Pro-initiated at booking-create time, often with the client standing
    // right there — the secure pay link must arrive immediately (mirrors
    // CLIENT_CLAIM_INVITE / CONSULTATION_PROPOSAL_SENT).
    allowQuietHoursBypass: true,
    templateKey: 'deposit_payment_link',
    supportedRecipients: [NotificationRecipientKind.CLIENT],
    defaultChannelsByRecipient: {
      // EMAIL/SMS only, like CLIENT_CLAIM_INVITE: snapshot-based delivery for
      // often-unclaimed clients. Claimed clients already have the login-gated
      // deposit surface via BOOKING_CONFIRMED's in-app row.
      [NotificationRecipientKind.CLIENT]: CLIENT_EMAIL_SMS_CHANNELS,
    },
  },

  [NotificationEventKey.CONSENT_SIGNATURE_REQUEST]: {
    key: NotificationEventKey.CONSENT_SIGNATURE_REQUEST,
    defaultPriority: NotificationPriority.HIGH,
    transactional: true,
    // Pro-initiated, often with the client standing right there or on their way
    // in — the signing link must arrive immediately (the DEPOSIT_PAYMENT_LINK
    // precedent). A waiver that turns up tomorrow is a waiver signed on paper.
    allowQuietHoursBypass: true,
    templateKey: 'consent_signature_request',
    supportedRecipients: [NotificationRecipientKind.CLIENT],
    defaultChannelsByRecipient: {
      // EMAIL/SMS only, like DEPOSIT_PAYMENT_LINK: snapshot-based delivery for
      // often-unclaimed clients, who have no in-app inbox to receive it in.
      [NotificationRecipientKind.CLIENT]: CLIENT_EMAIL_SMS_CHANNELS,
    },
  },

  // W5 follow-up: a pro asked to read this client's chart. Client-facing.
  //
  // IN_APP + PUSH, deliberately no SMS/EMAIL. The ask is not urgent and carries
  // no deadline — nothing expires if the client answers next week, and the pro
  // is rate-limited to one open ask — so it does not earn a text message. The
  // in-app row and the push both land on `/client/settings/chart-sharing`,
  // which is the surface that can actually answer it.
  //
  // Non-transactional and no quiet-hours bypass: a request to read someone's
  // medical-adjacent record is exactly the thing that should wait until morning.
  [NotificationEventKey.CHART_ACCESS_REQUESTED]: {
    key: NotificationEventKey.CHART_ACCESS_REQUESTED,
    defaultPriority: NotificationPriority.NORMAL,
    transactional: false,
    allowQuietHoursBypass: false,
    templateKey: 'chart_access_requested',
    supportedRecipients: [NotificationRecipientKind.CLIENT],
    defaultChannelsByRecipient: {
      [NotificationRecipientKind.CLIENT]: CLIENT_IN_APP_PUSH_CHANNELS,
    },
  },

  // W5 follow-up: the client granted. Pro-facing, IN_APP + PUSH on the same
  // reasoning. Emitted only on GRANT — see the enum comment: a decline is
  // never an event in the asker's inbox.
  [NotificationEventKey.CHART_ACCESS_GRANTED]: {
    key: NotificationEventKey.CHART_ACCESS_GRANTED,
    defaultPriority: NotificationPriority.NORMAL,
    transactional: false,
    allowQuietHoursBypass: false,
    templateKey: 'chart_access_granted',
    supportedRecipients: [NotificationRecipientKind.PRO],
    defaultChannelsByRecipient: {
      [NotificationRecipientKind.PRO]: PRO_IN_APP_PUSH_CHANNELS,
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

  // Someone commented on your look. Social engagement → in-app + PUSH (A4
  // decision: push+in-app now; PUSH stays inert until APNs/FCM creds land, so
  // this is safe until then). Email is deferred to the future digest. The
  // recipient is whichever identity authored the look — the pro, or the client
  // author for client-shared looks. Non-transactional, no quiet-hours bypass
  // (mirrors LOOK_FOLLOWER_NEW / CLIENT_FOLLOW).
  [NotificationEventKey.LOOK_COMMENTED]: {
    key: NotificationEventKey.LOOK_COMMENTED,
    defaultPriority: NotificationPriority.NORMAL,
    transactional: false,
    allowQuietHoursBypass: false,
    templateKey: 'look_commented',
    supportedRecipients: [
      NotificationRecipientKind.PRO,
      NotificationRecipientKind.CLIENT,
    ],
    defaultChannelsByRecipient: {
      [NotificationRecipientKind.PRO]: PRO_IN_APP_PUSH_CHANNELS,
      [NotificationRecipientKind.CLIENT]: CLIENT_IN_APP_PUSH_CHANNELS,
    },
  },

  // Someone replied to your comment on a look. Same policy as LOOK_COMMENTED
  // (in-app + PUSH); the recipient is the parent comment's author (pro or client).
  [NotificationEventKey.LOOK_COMMENT_REPLIED]: {
    key: NotificationEventKey.LOOK_COMMENT_REPLIED,
    defaultPriority: NotificationPriority.NORMAL,
    transactional: false,
    allowQuietHoursBypass: false,
    templateKey: 'look_comment_replied',
    supportedRecipients: [
      NotificationRecipientKind.PRO,
      NotificationRecipientKind.CLIENT,
    ],
    defaultChannelsByRecipient: {
      [NotificationRecipientKind.PRO]: PRO_IN_APP_PUSH_CHANNELS,
      [NotificationRecipientKind.CLIENT]: CLIENT_IN_APP_PUSH_CHANNELS,
    },
  },

  // Batched "your look got liked" — one windowed inbox row per look per day
  // (the emit helper's dedupeKey carries the window; a refresh updates the
  // count and re-marks unread without re-dispatching). In-app + PUSH, like the
  // sibling social events; the windowed dedupe means at most one push per look
  // per day, so it never becomes spammy. Recipient is the look's author.
  [NotificationEventKey.LOOK_LIKED]: {
    key: NotificationEventKey.LOOK_LIKED,
    defaultPriority: NotificationPriority.NORMAL,
    transactional: false,
    allowQuietHoursBypass: false,
    templateKey: 'look_liked',
    supportedRecipients: [
      NotificationRecipientKind.PRO,
      NotificationRecipientKind.CLIENT,
    ],
    defaultChannelsByRecipient: {
      [NotificationRecipientKind.PRO]: PRO_IN_APP_PUSH_CHANNELS,
      [NotificationRecipientKind.CLIENT]: CLIENT_IN_APP_PUSH_CHANNELS,
    },
  },

  // Batched "your look got saved to a board" — same windowed-dedupe policy as
  // LOOK_LIKED (in-app + PUSH, at most one push per look per day).
  [NotificationEventKey.LOOK_SAVED]: {
    key: NotificationEventKey.LOOK_SAVED,
    defaultPriority: NotificationPriority.NORMAL,
    transactional: false,
    allowQuietHoursBypass: false,
    templateKey: 'look_saved',
    supportedRecipients: [
      NotificationRecipientKind.PRO,
      NotificationRecipientKind.CLIENT,
    ],
    defaultChannelsByRecipient: {
      [NotificationRecipientKind.PRO]: PRO_IN_APP_PUSH_CHANNELS,
      [NotificationRecipientKind.CLIENT]: CLIENT_IN_APP_PUSH_CHANNELS,
    },
  },

  // A pro you follow published a new look — the FAN_OUT_NEW_LOOK_NOTIFICATIONS
  // job writes one per follower. In-app + PUSH (A4 decision; the future digest
  // handles email). This is the strongest "come back and scroll" pull.
  [NotificationEventKey.LOOK_NEW_FROM_FOLLOWED_PRO]: {
    key: NotificationEventKey.LOOK_NEW_FROM_FOLLOWED_PRO,
    defaultPriority: NotificationPriority.NORMAL,
    transactional: false,
    allowQuietHoursBypass: false,
    templateKey: 'look_new_from_followed_pro',
    supportedRecipients: [NotificationRecipientKind.CLIENT],
    defaultChannelsByRecipient: {
      [NotificationRecipientKind.CLIENT]: CLIENT_IN_APP_PUSH_CHANNELS,
    },
  },

  // "Your look hit N likes / N saves" — a one-time supply-side growth nudge to
  // the look's author each time a like/save threshold is crossed (fires once per
  // look+metric+threshold). In-app + PUSH like the sibling social events; the
  // permanent per-threshold dedupe means at most a handful ever per look, so it
  // never becomes spammy. Recipient is the look's author (pro or client).
  [NotificationEventKey.LOOK_MILESTONE_REACHED]: {
    key: NotificationEventKey.LOOK_MILESTONE_REACHED,
    defaultPriority: NotificationPriority.NORMAL,
    transactional: false,
    allowQuietHoursBypass: false,
    templateKey: 'look_milestone',
    supportedRecipients: [
      NotificationRecipientKind.PRO,
      NotificationRecipientKind.CLIENT,
    ],
    defaultChannelsByRecipient: {
      [NotificationRecipientKind.PRO]: PRO_IN_APP_PUSH_CHANNELS,
      [NotificationRecipientKind.CLIENT]: CLIENT_IN_APP_PUSH_CHANNELS,
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

  // License-expiry lifecycle: 30 days before ProfessionalProfile.licenseExpiry.
  // In-app + email, like PRO_HANDLE_RESERVATION_EXPIRING (same shape of
  // heads-up: a durable account-standing warning, not a live-session nudge).
  // Transactional; no quiet-hours bypass — a license renewal reminder is not
  // an emergency and the 30-day window gives ample daytime room.
  [NotificationEventKey.PRO_LICENSE_EXPIRING_SOON]: {
    key: NotificationEventKey.PRO_LICENSE_EXPIRING_SOON,
    defaultPriority: NotificationPriority.NORMAL,
    transactional: true,
    allowQuietHoursBypass: false,
    templateKey: 'pro_license_expiring_soon',
    supportedRecipients: [NotificationRecipientKind.PRO],
    defaultChannelsByRecipient: {
      [NotificationRecipientKind.PRO]: PRO_IN_APP_EMAIL_CHANNELS,
    },
  },

  // Fires once the license has actually expired — the verified badge is now
  // paused (derived; lib/licensing/currentlyLicensed.ts). Same channel policy
  // as the warning; this is the more important of the two, so it stays
  // in-app + email rather than escalating to SMS (renewing a license is
  // never a same-day fix, so urgency doesn't buy anything here).
  [NotificationEventKey.PRO_LICENSE_EXPIRED]: {
    key: NotificationEventKey.PRO_LICENSE_EXPIRED,
    defaultPriority: NotificationPriority.HIGH,
    transactional: true,
    allowQuietHoursBypass: false,
    templateKey: 'pro_license_expired',
    supportedRecipients: [NotificationRecipientKind.PRO],
    defaultChannelsByRecipient: {
      [NotificationRecipientKind.PRO]: PRO_IN_APP_EMAIL_CHANNELS,
    },
  },

  // A new message in a thread → the OTHER participant (client or pro). In-app +
  // PUSH (no email/SMS — the inbox is the durable record; a chat message isn't a
  // receipt). Non-transactional, honors quiet hours (a message is never an
  // emergency). The emit helper debounces per thread per recipient via a windowed
  // dedupeKey, so a rapid burst refreshes one inbox row / fires one push.
  [NotificationEventKey.MESSAGE_RECEIVED]: {
    key: NotificationEventKey.MESSAGE_RECEIVED,
    defaultPriority: NotificationPriority.NORMAL,
    transactional: false,
    allowQuietHoursBypass: false,
    templateKey: 'message_received',
    supportedRecipients: [
      NotificationRecipientKind.PRO,
      NotificationRecipientKind.CLIENT,
    ],
    defaultChannelsByRecipient: {
      [NotificationRecipientKind.PRO]: PRO_IN_APP_PUSH_CHANNELS,
      [NotificationRecipientKind.CLIENT]: CLIENT_IN_APP_PUSH_CHANNELS,
    },
  },

  // W2: a client JOINED this pro's waitlist. In-app + PUSH + EMAIL — Tori's
  // call, and the reason is the asymmetry with MESSAGE_RECEIVED above: a chat
  // message is chatter the inbox already keeps, whereas a new waitlister is a
  // LEAD, and email is what survives a missed push and a pro who was not in the
  // app. Non-transactional and honors quiet hours: somebody joining a list at
  // 2am is not worth waking a pro for.
  //
  // Deduped per waitlist ENTRY at the call site, so a client who edits or
  // re-submits their preferences refreshes one inbox row instead of stacking.
  [NotificationEventKey.WAITLIST_JOINED]: {
    key: NotificationEventKey.WAITLIST_JOINED,
    defaultPriority: NotificationPriority.NORMAL,
    transactional: false,
    allowQuietHoursBypass: false,
    templateKey: 'waitlist_joined',
    supportedRecipients: [NotificationRecipientKind.PRO],
    defaultChannelsByRecipient: {
      [NotificationRecipientKind.PRO]: PRO_IN_APP_EMAIL_PUSH_CHANNELS,
    },
  },

  // An offered time lapsed unanswered. Deliberately the QUIETEST pro event in
  // the registry — in-app only, no push, no email (Tori's call). The others
  // report that somebody DID something; this one reports that nobody did, and a
  // buzz for a non-event is exactly the noise that trains a pro to mute the app.
  // Its value is the explanation waiting in the inbox when the pro next looks at
  // their waitlist and wonders why that client is back on it.
  //
  // Transactional: it is the durable record of a state transition the sweep
  // performed on the pro's behalf, not a nudge. Quiet hours are moot with IN_APP
  // as the only channel, and are left un-bypassed so that stays true if a
  // channel is ever added.
  //
  // Deduped per OFFER, so a re-run of the sweep over the same row refreshes one
  // inbox entry instead of stacking.
  [NotificationEventKey.WAITLIST_OFFER_EXPIRED]: {
    key: NotificationEventKey.WAITLIST_OFFER_EXPIRED,
    defaultPriority: NotificationPriority.LOW,
    transactional: true,
    allowQuietHoursBypass: false,
    templateKey: 'waitlist_offer_expired',
    supportedRecipients: [NotificationRecipientKind.PRO],
    defaultChannelsByRecipient: {
      [NotificationRecipientKind.PRO]: PRO_IN_APP_ONLY_CHANNELS,
    },
  },

  // A waitlisted client left while a live offer was out to them. In-app + push,
  // NOT email: unlike WAITLIST_JOINED (a lead, worth an inbox record that
  // survives a missed push), this is a time-boxed opportunity — a concrete slot
  // that just reopened and is worth a tap now, but is stale by the time an email
  // gets read. No email also keeps it from reading as a scolding receipt.
  //
  // Transactional, and no quiet-hours bypass: the slot is in the pro's calendar
  // either way, so this is not worth a 3am buzz.
  //
  // Deduped per ENTRY — leaving is terminal for an entry, so at most one.
  [NotificationEventKey.WAITLIST_CLIENT_LEFT]: {
    key: NotificationEventKey.WAITLIST_CLIENT_LEFT,
    defaultPriority: NotificationPriority.NORMAL,
    transactional: true,
    allowQuietHoursBypass: false,
    templateKey: 'waitlist_client_left',
    supportedRecipients: [NotificationRecipientKind.PRO],
    defaultChannelsByRecipient: {
      [NotificationRecipientKind.PRO]: PRO_IN_APP_PUSH_CHANNELS,
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
      [NotificationRecipientKind.ADMIN]: ADMIN_IN_APP_EMAIL_PUSH_CHANNELS,
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
      [NotificationRecipientKind.ADMIN]: ADMIN_IN_APP_EMAIL_PUSH_CHANNELS,
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
      [NotificationRecipientKind.ADMIN]: ADMIN_IN_APP_EMAIL_PUSH_CHANNELS,
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
  NotificationEventKey.APPOINTMENT_CONFIRMATION_DECLINED,
  NotificationEventKey.VIRAL_REQUEST_APPROVED,
  NotificationEventKey.PAYMENT_COLLECTED,
  NotificationEventKey.PAYMENT_ACTION_REQUIRED,
  NotificationEventKey.PAYMENT_CONFIRMATION_REQUIRED,
  NotificationEventKey.PAYMENT_REFUNDED,
  NotificationEventKey.LOOK_FOLLOWER_NEW,
  NotificationEventKey.LOOK_COMMENTED,
  NotificationEventKey.LOOK_COMMENT_REPLIED,
  NotificationEventKey.LOOK_LIKED,
  NotificationEventKey.LOOK_SAVED,
  NotificationEventKey.LOOK_MILESTONE_REACHED,
  NotificationEventKey.MESSAGE_RECEIVED,
  NotificationEventKey.WAITLIST_JOINED,
  NotificationEventKey.CHART_ACCESS_GRANTED,
  NotificationEventKey.WAITLIST_OFFER_EXPIRED,
  NotificationEventKey.WAITLIST_CLIENT_LEFT,
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
  NotificationEventKey.REVIEW_REQUESTED,
  NotificationEventKey.APPOINTMENT_REMINDER,
  NotificationEventKey.AFTERCARE_READY,
  NotificationEventKey.LAST_MINUTE_OPENING_AVAILABLE,
  NotificationEventKey.WAITLIST_TIME_OFFERED,
  NotificationEventKey.SAVED_LOOK_AVAILABILITY_OPENED,
  NotificationEventKey.EVENT_DATE_COUNTDOWN,
  NotificationEventKey.REBOOK_CADENCE_DUE,
  NotificationEventKey.SAVED_LOOK_CONSULT_NUDGE,
  NotificationEventKey.AI_CONSULT_INVITATION,
  NotificationEventKey.AI_CONSULT_ANALYSIS_READY,
  NotificationEventKey.AI_CONSULT_ANALYSIS_FAILED,
  NotificationEventKey.SAVED_LOOK_PRICE_ALTERNATIVE,
  NotificationEventKey.PAYMENT_COLLECTED,
  NotificationEventKey.PAYMENT_ACTION_REQUIRED,
  NotificationEventKey.PAYMENT_REFUNDED,
  NotificationEventKey.NO_SHOW_FEE_CHARGED,
  NotificationEventKey.NO_SHOW_DEPOSIT_KEPT,
  NotificationEventKey.DEPOSIT_REMINDER,
  NotificationEventKey.REFERRAL_TAP_RECEIVED,
  NotificationEventKey.REFERRAL_CONFIRMED,
  NotificationEventKey.REFERRAL_CONVERTED,
  NotificationEventKey.LOOK_COMMENTED,
  NotificationEventKey.LOOK_COMMENT_REPLIED,
  NotificationEventKey.LOOK_LIKED,
  NotificationEventKey.LOOK_SAVED,
  NotificationEventKey.LOOK_NEW_FROM_FOLLOWED_PRO,
  NotificationEventKey.LOOK_MILESTONE_REACHED,
  NotificationEventKey.MESSAGE_RECEIVED,
  NotificationEventKey.CHART_ACCESS_REQUESTED,
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
