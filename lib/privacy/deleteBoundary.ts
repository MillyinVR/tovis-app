// lib/privacy/deleteBoundary.ts

import type { DeleteDispositionStatus } from '@/lib/privacy/deleteRules'

/**
 * Privacy DELETION completeness boundary.
 *
 * The sibling of `lib/privacy/exportBoundary.ts`, and deliberately stricter.
 *
 * The export boundary can afford a `PENDING` bucket: a model nobody has
 * assessed yet is simply missing from a download, which is a disclosure gap.
 * Deletion has no such neutral state. A model with no disposition is personal
 * data that SURVIVES a user pressing "Delete my account" — so this registry has
 * no PENDING status at all. Every subject-linked model is one of:
 *
 * - `DELETE`    — rows are hard-deleted
 * - `ANONYMIZE` — the row survives (another party or a foreign key needs it)
 *                 but every identifying field on it is cleared
 * - `RETAIN`    — the row survives as-is, with the reason it must
 *
 * ⚠️ `RETAIN` is the dangerous one, because it is indistinguishable from
 * "nobody thought about it". Every RETAIN therefore carries a reason, and the
 * ones that are a genuine product/legal call rather than a mechanical
 * consequence are marked `needsProductReview` so they can be listed and
 * settled rather than quietly inherited.
 *
 * Coverage is proved, not asserted: `deleteRules.ts` holds the typed rule table
 * the executor actually runs, and `deleteBoundary.test.ts` fails if any model
 * dispositioned DELETE or ANONYMIZE is absent from it (or vice versa). The
 * model list itself is derived from the generated Prisma client via
 * `subjectLinkedModelNames()` — shared with the export boundary rather than
 * re-implemented — so a new model cannot join the schema without failing here.
 *
 * ⚠️ Inherited limitation: like the export boundary, subject detection is
 * DIRECT foreign keys only. A model that reaches the subject transitively is
 * invisible to the guard and must be added to the registry by hand.
 */

export type DeleteDisposition = {
  readonly status: DeleteDispositionStatus
  readonly reason: string
  /**
   * Set on a RETAIN whose justification is a product/legal judgement rather
   * than a mechanical consequence of the schema. Listed by the guard so the
   * set stays small and deliberate.
   */
  readonly needsProductReview?: true
}

// ---------------------------------------------------------------- reasons

const R_FINANCIAL =
  'Financial record. Retained for accounting, refunds/chargebacks, disputes and tax; the subject is de-identified through the User/profile anonymization instead.'

const R_AUDIT =
  'Audit/security record. Retaining the event is the point of writing it; payloads are already redacted at write time (lib/admin/auditLog.ts).'

const R_MODERATION =
  'Safety/moderation record. Deleting it would let a reported account erase the report by leaving.'

const R_OTHER_PARTY =
  "Belongs to the other party's legitimate history, not the subject's. Guiding rule 6 of docs/privacy/retention-policy.md: prefer anonymization or unlinking over deletion that damages another user's record."

const R_PRO_AUTHORED =
  'Pro-authored record about a client. It is the clinical/service continuity record for the OTHER party, so it survives the author leaving.'

const R_CONVENIENCE =
  'User-owned convenience record with no other party and no retention reason.'

const R_CREDENTIAL = 'Single-use auth credential; deleted outright.'

const R_ENGAGEMENT =
  "The subject's own engagement signal. Nothing else depends on it and it names a user directly."

const R_DERIVED_DROP =
  'Derived projection rebuilt from source rows. Dropping it removes the deleted account from the surface it feeds.'

export const DELETE_BOUNDARY: Readonly<Record<string, DeleteDisposition>> = {
  // ------------------------------------------------------------- subjects
  User: {
    status: 'ANONYMIZE',
    reason:
      'Referenced by bookings, audit records and messages. docs/privacy/retention-policy.md fixes Phase 1 on anonymize-not-hard-delete: identifiers cleared, lookup hashes cleared, password replaced with a disabled sentinel.',
  },
  ClientProfile: {
    status: 'ANONYMIZE',
    reason:
      'Identity/contact fields cleared; the row survives so booking history stays referentially intact.',
  },
  ProfessionalProfile: {
    status: 'ANONYMIZE',
    reason:
      'Identity/contact fields cleared; the row survives so bookings, reviews and payouts stay referentially intact.',
  },

  // --------------------------------------------------------------- delete
  ClientAddress: { status: 'DELETE', reason: R_CONVENIENCE },
  ClientActionToken: { status: 'DELETE', reason: R_CREDENTIAL },
  PasswordResetToken: { status: 'DELETE', reason: R_CREDENTIAL },
  EmailVerificationToken: { status: 'DELETE', reason: R_CREDENTIAL },
  PhoneVerification: { status: 'DELETE', reason: R_CREDENTIAL },
  SessionHandoffToken: { status: 'DELETE', reason: R_CREDENTIAL },
  BookingHold: {
    status: 'DELETE',
    reason:
      'Temporary slot reservation. Deleting it also releases the slot back to the pro.',
  },
  MediaAsset: {
    status: 'DELETE',
    reason:
      "The subject's private photos. ⚠️ ClientIntentEvent.mediaId references it WITHOUT a cascade, so the intent events must be cleared first or the delete raises a foreign-key violation. Storage object bytes are a separate write boundary.",
  },
  PracticeShot: {
    status: 'DELETE',
    reason:
      "The pro's own out-of-session camera shots; single-subject by construction. Storage bytes are a separate write boundary.",
  },
  DeviceToken: {
    status: 'DELETE',
    reason:
      'Push credentials. These MUST die: a surviving token keeps delivering notifications to a deleted account.',
  },
  ClientPaymentMethod: {
    status: 'DELETE',
    reason:
      'Stored card references. ⚠️ Detaching the payment method at Stripe is a separate provider-side boundary; this removes our row only.',
  },
  ClientNotificationPreference: { status: 'DELETE', reason: R_CONVENIENCE },
  ClientNotificationSettings: { status: 'DELETE', reason: R_CONVENIENCE },
  ProfessionalNotificationPreference: {
    status: 'DELETE',
    reason: R_CONVENIENCE,
  },
  ProReminderSettings: { status: 'DELETE', reason: R_CONVENIENCE },
  ProNoShowSettings: { status: 'DELETE', reason: R_CONVENIENCE },
  LastMinuteSettings: {
    status: 'DELETE',
    reason: `${R_CONVENIENCE} ⚠️ LastMinuteServiceRule and LastMinuteBlock reference it without a cascade and must be cleared first.`,
  },
  LastMinuteOpening: { status: 'DELETE', reason: R_CONVENIENCE },
  LastMinuteRecipient: { status: 'DELETE', reason: R_CONVENIENCE },
  CalendarBlock: { status: 'DELETE', reason: R_CONVENIENCE },
  CalendarFeedSubscription: {
    status: 'DELETE',
    reason:
      'Holds the secret calendar-feed token. Leaving the row alive leaves a working feed URL for a deleted account.',
  },
  AftercareRebookSlot: {
    status: 'DELETE',
    reason: 'Ephemeral rebook offer; expires on its own and names both parties.',
  },
  Reminder: { status: 'DELETE', reason: R_CONVENIENCE },
  ScheduledClientNotification: {
    status: 'DELETE',
    reason:
      'Queued future sends. These MUST die, or a deleted account keeps receiving scheduled messages.',
  },
  ClientNotification: { status: 'DELETE', reason: R_CONVENIENCE },
  Notification: {
    status: 'DELETE',
    reason: `${R_CONVENIENCE} Rows where the subject is only the ACTOR belong to another pro's feed and are anonymized in place instead.`,
  },
  NotificationDispatch: {
    status: 'DELETE',
    reason:
      'Delivery record carrying contact PII (recipient address/number). Cascades to NotificationDelivery.',
  },
  ClientIntentEvent: { status: 'DELETE', reason: R_ENGAGEMENT },
  ClientTasteVector: { status: 'DELETE', reason: R_DERIVED_DROP },
  LookViewerImpressionStat: { status: 'DELETE', reason: R_ENGAGEMENT },
  LookLike: { status: 'DELETE', reason: R_ENGAGEMENT },
  LookHide: { status: 'DELETE', reason: R_ENGAGEMENT },
  LookCommentLike: { status: 'DELETE', reason: R_ENGAGEMENT },
  MediaLike: { status: 'DELETE', reason: R_ENGAGEMENT },
  ReviewHelpful: { status: 'DELETE', reason: R_ENGAGEMENT },
  ServiceFavorite: { status: 'DELETE', reason: R_ENGAGEMENT },
  ProfessionalFavorite: {
    status: 'DELETE',
    reason: `${R_ENGAGEMENT} Both directions go: the subject's favourites, and other users' favourites OF the subject, which would otherwise point at a deleted pro.`,
  },
  ProFollow: {
    status: 'DELETE',
    reason: `${R_ENGAGEMENT} Both directions, as with ProfessionalFavorite.`,
  },
  ClientFollow: {
    status: 'DELETE',
    reason: `${R_ENGAGEMENT} Both directions (follower and followed).`,
  },
  Board: {
    status: 'DELETE',
    reason: "The client's own saved boards; cascades to their saved items.",
  },
  ConsultSession: {
    status: 'DELETE',
    reason:
      "The client's own booking-attached AI consult. Deleting it cascades the transitive ConsultRevision, ConsultAgreementAcceptance and ConsultAuditEvent family. Raw consult media has no durable table. No other party's record — booking/professional are pointers only.",
  },
  LookPost: {
    status: 'DELETE',
    reason:
      'Public content authored by the subject. It must not stay published against a deleted account. Cascades to its assets, likes and comments; Booking.sourceLookPostId is SetNull.',
  },
  LookComment: { status: 'DELETE', reason: R_ENGAGEMENT },
  MediaComment: { status: 'DELETE', reason: R_ENGAGEMENT },
  TapIntent: { status: 'DELETE', reason: R_ENGAGEMENT },
  WaitlistEntry: { status: 'DELETE', reason: R_CONVENIENCE },
  WaitlistOffer: {
    status: 'DELETE',
    reason: 'Ephemeral offer naming both parties; expires on its own.',
  },
  UploadSession: { status: 'DELETE', reason: 'Transient upload scaffolding.' },
  ClientAllergy: {
    status: 'DELETE',
    reason:
      "Health data belonging to the client. Deleted when the CLIENT is the subject; when the subject is the pro who recorded it, it is the client's record and is retained.",
  },
  ClientChartShare: {
    status: 'DELETE',
    reason:
      "The client's standing grant of chart access. Deleting it revokes the pro's read — leaving it alive would keep a deleted client's chart readable.",
  },
  HandleRegistration: {
    status: 'DELETE',
    reason:
      'The global @handle uniqueness lock. It MUST be released, or the deleted account holds its handle hostage forever.',
  },
  ProfessionalSearchIndex: {
    status: 'DELETE',
    reason: `${R_DERIVED_DROP} Specifically: it carries name/bio and is what puts a pro in discovery, so a deleted pro must leave it.`,
  },
  ProfessionalBadgeStat: { status: 'DELETE', reason: R_DERIVED_DROP },
  ProfessionalAvailabilityStat: { status: 'DELETE', reason: R_DERIVED_DROP },
  ViralRequestApprovalFanOut: {
    status: 'DELETE',
    reason: 'Ephemeral fan-out row addressed to the subject.',
  },
  ViralServiceRequest: {
    status: 'DELETE',
    reason:
      "The client's own broadcast request; cascades to its fan-out rows. Reports filed against it are retained separately.",
  },

  // ------------------------------------------------------------ anonymize
  ProfessionalLocation: {
    status: 'ANONYMIZE',
    reason:
      '⚠️ CANNOT be deleted: Booking, BookingSeries, BookingHold, LastMinuteOpening, AftercareRebookSlot and WaitlistOffer all reference it with onDelete: Restrict, so a deleteMany raises a foreign-key violation for any pro who ever took a booking (proved in tests/integration/account-deletion-boundary.test.ts). Address PII is cleared and the location archived instead, which matches "preserve or anonymize locations referenced by bookings" in docs/privacy/retention-policy.md.',
  },
  ProfessionalServiceOffering: {
    status: 'ANONYMIZE',
    reason:
      'Referenced with Restrict by eight models including Booking and BookingServiceItem. Deactivated rather than deleted, which removes it from booking surfaces without breaking historical bookings.',
  },
  BookingSeries: {
    status: 'ANONYMIZE',
    reason:
      'Ended rather than deleted. A live series is a FUTURE-booking generator: left running it would keep materializing appointments for a deleted account. The historical rule stays for the bookings it already produced.',
  },
  NfcCard: {
    status: 'ANONYMIZE',
    reason:
      'Physical inventory, referenced by TapIntent, AttributionEvent and Referral without cascades. Unclaimed (owner links cleared) so the card can be reissued.',
  },
  AttributionEvent: {
    status: 'ANONYMIZE',
    reason:
      'Aggregate analytics value survives without identity: actor/credited user links are cleared, matching docs/privacy/retention-policy.md.',
  },

  // --------------------------------------------------------------- retain
  Booking: {
    status: 'RETAIN',
    reason: `${R_FINANCIAL} ⚠️ Booking-level field anonymization (address snapshots, free-text notes) is documented in docs/privacy/retention-policy.md and still deferred — the snapshots remain.`,
    needsProductReview: true,
  },
  BookingRefund: { status: 'RETAIN', reason: R_FINANCIAL },
  ProductSale: { status: 'RETAIN', reason: R_FINANCIAL },
  ProfessionalExpense: { status: 'RETAIN', reason: R_FINANCIAL },
  ProfessionalReceiptInbox: { status: 'RETAIN', reason: R_FINANCIAL },
  ProfessionalMonthlyAnalytics: { status: 'RETAIN', reason: R_FINANCIAL },
  ProfessionalSubscription: { status: 'RETAIN', reason: R_FINANCIAL },
  ProfessionalPaymentSettings: {
    status: 'RETAIN',
    reason: `${R_FINANCIAL} Holds the Stripe Connect account reference needed to reconcile past payouts.`,
    needsProductReview: true,
  },
  Referral: {
    status: 'RETAIN',
    reason: `${R_FINANCIAL} A referral names two other parties whose credit must not vanish.`,
  },

  AdminActionLog: { status: 'RETAIN', reason: R_AUDIT },
  AdminPermission: { status: 'RETAIN', reason: R_AUDIT },
  AdminNotification: { status: 'RETAIN', reason: R_AUDIT },
  BookingCloseoutAuditLog: { status: 'RETAIN', reason: R_AUDIT },
  BookingOverrideAuditLog: { status: 'RETAIN', reason: R_AUDIT },
  BookingOverridePermission: { status: 'RETAIN', reason: R_AUDIT },
  DeviceSessionRevocation: {
    status: 'RETAIN',
    reason:
      'Session-security record. Deleting it would UN-revoke sessions that were deliberately killed — the opposite of what a deletion should do.',
  },
  IdempotencyKey: {
    status: 'RETAIN',
    reason:
      'Short-lived request-dedupe infrastructure that expires on its own; the actor id is part of the dedupe scope, so clearing it would let a replay through.',
  },

  LookPostReport: { status: 'RETAIN', reason: R_MODERATION },
  LookCommentReport: { status: 'RETAIN', reason: R_MODERATION },
  ViralServiceRequestReport: { status: 'RETAIN', reason: R_MODERATION },
  SupportTicket: {
    status: 'RETAIN',
    reason:
      'Support and dispute history. Also the audit trail for privacy requests themselves.',
  },

  Review: {
    status: 'RETAIN',
    reason: `${R_OTHER_PARTY} A review is the reviewed pro's marketplace record; the author is de-identified through ClientProfile anonymization.`,
  },
  Message: {
    status: 'RETAIN',
    reason: `${R_OTHER_PARTY} docs/privacy/retention-policy.md Phase 1: preserve conversation structure, anonymize the departed participant, defer body deletion.`,
    needsProductReview: true,
  },
  MessageThread: { status: 'RETAIN', reason: R_OTHER_PARTY },
  MessageThreadParticipant: { status: 'RETAIN', reason: R_OTHER_PARTY },
  ClientConsentRecord: {
    status: 'RETAIN',
    reason:
      'Signed consent for a service that was actually performed — the legal record that it was authorized.',
  },
  ConsentForm: { status: 'RETAIN', reason: R_PRO_AUTHORED },
  ConsentFormVersion: {
    status: 'RETAIN',
    reason:
      'Immutable published form version that signed ClientConsentRecords point at.',
  },
  ClientProfessionalNote: { status: 'RETAIN', reason: R_PRO_AUTHORED },
  ClientFormulaEntry: { status: 'RETAIN', reason: R_PRO_AUTHORED },
  ProClientPolicy: { status: 'RETAIN', reason: R_PRO_AUTHORED },
  ProClientInvite: { status: 'RETAIN', reason: R_OTHER_PARTY },
  ConsultationApproval: { status: 'RETAIN', reason: R_OTHER_PARTY },
  ConsultationApprovalProof: { status: 'RETAIN', reason: R_OTHER_PARTY },
  VerificationDocument: {
    status: 'RETAIN',
    reason:
      '⚠️ UNSETTLED. docs/privacy/retention-policy.md lists verification documents under "delete where supported", but they are also the licensing evidence behind a professional profile that is anonymized rather than deleted, and behind any dispute about whether a pro was verified. Retained pending an explicit call; note this means licence/ID imagery outlives a self-serve deletion.',
    needsProductReview: true,
  },
  AccountDeletionRequest: {
    status: 'RETAIN',
    reason:
      'The record of the deletion itself. It must outlive the data it removed, or there is no evidence the request was honoured.',
  },
}

/**
 * RETAIN entries whose justification is a product/legal judgement rather than a
 * mechanical consequence of the schema. Kept small and listed deliberately.
 */
export function retainedNeedingReview(): string[] {
  return Object.entries(DELETE_BOUNDARY)
    .filter(([, disposition]) => disposition.needsProductReview === true)
    .map(([name]) => name)
    .sort()
}

export function modelsWithStatus(status: DeleteDispositionStatus): string[] {
  return Object.entries(DELETE_BOUNDARY)
    .filter(([, disposition]) => disposition.status === status)
    .map(([name]) => name)
    .sort()
}
