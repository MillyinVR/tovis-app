// lib/privacy/exportBoundary.ts

import { Prisma } from '@prisma/client'

import type { ExportedUserData } from '@/lib/privacy/exportUserData'

/**
 * Privacy export completeness boundary.
 *
 * `exportUserData` tells maintainers to "update this boundary and its
 * schema-completeness test" when the schema grows a user-linked model. Until
 * K16-A that test did not exist, so 70+ models drifted outside the export with
 * nobody recording whether that was a decision or an oversight.
 *
 * This module is the decision record. Every model that carries a foreign key to
 * a subject model (User / ClientProfile / ProfessionalProfile) must appear in
 * `EXPORT_BOUNDARY` as one of:
 *
 * - `EXPORTED`  — assembled into the payload under `keys`
 * - `OMITTED`   — deliberately left out, with the reason it is left out
 * - `PENDING`   — not yet settled; counted against a baseline that may shrink
 *                 but never grow
 *
 * The registry is derived against the generated Prisma client (`Prisma.dmmf`),
 * never a hand-maintained model list, so a new model cannot join the schema
 * without failing the guard.
 *
 * ⚠️ Known limitation: detection is DIRECT foreign keys only. A model that
 * reaches the subject transitively is invisible to it — `AftercareSummary`
 * (via `Booking`) and `NotificationDelivery` (via `NotificationDispatch`) are
 * both exported today yet would never be demanded by this guard. So the guard
 * proves "no directly-linked model drifted out unrecorded"; it does not prove
 * the export is complete. Widening it to transitive links means choosing a hop
 * limit, which is a bigger decision than K16-A.
 *
 * Deletion (`lib/privacy/deleteUserData.ts`) is a separate, deliberately
 * narrower boundary that documents its own limitations. It could adopt this
 * registry later; K16-A does not change it.
 */

export const SUBJECT_MODELS = [
  'User',
  'ClientProfile',
  'ProfessionalProfile',
] as const

type ExportedDataKey = keyof ExportedUserData['data']

export type ExportDisposition =
  | {
      readonly status: 'EXPORTED'
      /** One model may land under several keys (Booking → client + pro sides). */
      readonly keys: readonly ExportedDataKey[]
    }
  | { readonly status: 'OMITTED'; readonly reason: string }
  | { readonly status: 'PENDING'; readonly note: string }

/**
 * Scalar `String` fields whose names look like a subject foreign key but are
 * not one. Kept explicit rather than pattern-excluded: a silent skip here is
 * how a real link would hide.
 */
const NON_SUBJECT_ID_FIELDS: ReadonlySet<string> = new Set([
  // Apple/Google Sign-In subject identifiers — external IdP ids, not our users.
  'User.appleUserId',
  'User.googleUserId',
])

const SUBJECT_FK_SUFFIXES = ['userid', 'clientid', 'professionalid'] as const

function isSubjectForeignKeyName(modelName: string, fieldName: string): boolean {
  if (NON_SUBJECT_ID_FIELDS.has(`${modelName}.${fieldName}`)) return false

  const normalized = fieldName.toLowerCase()
  return SUBJECT_FK_SUFFIXES.some((suffix) => normalized.endsWith(suffix))
}

/**
 * True when `model` itself carries a link to a subject model.
 *
 * Two signals, because either one alone has a hole:
 *
 * 1. An owned relation field — non-list, with `relationFromFields` set, so the
 *    FK lives on THIS model. List relations are excluded: `Tenant.homePros` is
 *    a back-reference where the professional holds the key, and treating it as
 *    a link would file `Tenant` as user data.
 * 2. A subject-shaped scalar `String` with no relation declared at all.
 *    `ConsultationApproval.clientId` and `UploadSession.clientId` are real
 *    undeclared foreign keys — a relation-only guard misses them completely,
 *    which is a hole exactly the shape of the thing this guard exists to catch.
 */
function isSubjectLinked(model: Prisma.DMMF.Model): boolean {
  if ((SUBJECT_MODELS as readonly string[]).includes(model.name)) return true

  const ownedRelationFields = model.fields.filter(
    (field) =>
      field.kind === 'object' &&
      (SUBJECT_MODELS as readonly string[]).includes(field.type) &&
      !field.isList &&
      (field.relationFromFields?.length ?? 0) > 0,
  )

  if (ownedRelationFields.length > 0) return true

  // Reached only when no owned relation to a subject exists, so every
  // subject-shaped scalar here is by definition an undeclared foreign key.
  return model.fields.some(
    (field) =>
      field.kind === 'scalar' &&
      field.type === 'String' &&
      isSubjectForeignKeyName(model.name, field.name),
  )
}

/** Every model in the live schema that links to the export subject. */
export function subjectLinkedModelNames(): string[] {
  return Prisma.dmmf.datamodel.models
    .filter(isSubjectLinked)
    .map((model) => model.name)
    .sort()
}

const PENDING_NOTE =
  'Undecided: links to the subject but has never been assessed for disclosure. Settle as EXPORTED or OMITTED before relying on the export for a subject-access request.'

const OMITTED_PRO_AUTHORED_FEEDBACK =
  'Pro-authored feedback about a client is never disclosed to that client (Tori, 2026-07-31). Handled as a manual/legal workflow, not a self-serve export.'

export const EXPORT_BOUNDARY: Readonly<Record<string, ExportDisposition>> = {
  // ---------------------------------------------------------------- exported
  User: { status: 'EXPORTED', keys: ['user'] },
  ClientProfile: { status: 'EXPORTED', keys: ['clientProfile'] },
  ProfessionalProfile: { status: 'EXPORTED', keys: ['professionalProfile'] },
  // The global @handle lock (lib/handles/registry.ts). It holds no personal
  // data of its own — just "this handle belongs to this profile" — and the
  // handle itself is already disclosed on ClientProfile/ProfessionalProfile,
  // which ARE exported. Exporting the lock row would repeat that one string
  // under a second, more confusing name.
  HandleRegistration: {
    status: 'OMITTED',
    reason:
      'Uniqueness lock only; carries no data beyond the handle, which is already exported on ClientProfile/ProfessionalProfile.',
  },
  // The user's own request to delete their account. Deliberately not in the
  // export: the app shows the live request (status + scheduled date) directly
  // on the deletion screen, and the row's purpose is to EVIDENCE that a request
  // was made and honoured, not to describe the person. See
  // lib/privacy/deleteBoundary.ts, which retains it for the same reason.
  AccountDeletionRequest: {
    status: 'OMITTED',
    reason:
      'Surfaced live in the app on the account-deletion screen; the row exists as evidence the request was honoured rather than as a description of the user.',
  },
  ClientAddress: { status: 'EXPORTED', keys: ['clientAddresses'] },
  ProfessionalLocation: { status: 'EXPORTED', keys: ['professionalLocations'] },
  Booking: {
    status: 'EXPORTED',
    keys: ['bookingsAsClient', 'bookingsAsProfessional'],
  },
  BookingHold: { status: 'EXPORTED', keys: ['bookingHolds'] },
  // K18: the client's standing appointment is their arrangement as much as the
  // pro's, and every occurrence it produced is already exported as a Booking —
  // so exporting the rule that produced them costs nothing and completes the
  // picture. The select omits the pro's private free text (internalNotes,
  // overrideReason), mirroring the booking select.
  BookingSeries: { status: 'EXPORTED', keys: ['bookingSeries'] },
  // W5: the client's consent record. Exporting it is the whole point — it is the
  // durable answer to "who did I let read my chart, and when did I take it
  // back". Both parties are subjects; there is no private free text to withhold.
  ClientChartShare: { status: 'EXPORTED', keys: ['clientChartShares'] },
  ClientActionToken: { status: 'EXPORTED', keys: ['clientActionTokens'] },
  AftercareSummary: { status: 'EXPORTED', keys: ['aftercareSummaries'] },
  MediaAsset: { status: 'EXPORTED', keys: ['mediaAssets'] },
  MediaCaptureAttestation: {
    status: 'OMITTED',
    reason:
      "Technical integrity metadata about the media (hashes, server receipt time), not user content — settled out of scope for the self-serve export. Revisit alongside MediaAsset's own export entry if that changes.",
  },
  // The pro's own out-of-session camera shots. Single-subject by construction —
  // a practice shot has no booking and no client — so there is nothing to
  // withhold from the pro whose photos they are.
  PracticeShot: { status: 'EXPORTED', keys: ['practiceShots'] },
  Message: { status: 'EXPORTED', keys: ['messages'] },
  Notification: { status: 'EXPORTED', keys: ['notifications'] },
  ClientNotification: { status: 'EXPORTED', keys: ['clientNotifications'] },
  ScheduledClientNotification: {
    status: 'EXPORTED',
    keys: ['scheduledClientNotifications'],
  },
  NotificationDispatch: { status: 'EXPORTED', keys: ['notificationDispatches'] },
  NotificationDelivery: { status: 'EXPORTED', keys: ['notificationDeliveries'] },
  TapIntent: { status: 'EXPORTED', keys: ['tapIntents'] },

  // ⚠️ These two have a payload key that is ALWAYS an empty array — their
  // finders return [] unconditionally. The key's presence makes them look
  // exported; the disposition is what tells the truth.
  AttributionEvent: {
    status: 'OMITTED',
    reason:
      'Omitted pending a disclosure decision and a safe projection: attribution rows carry cross-user/admin-adjacent context. `attributionEvents` remains in the payload as an empty array for shape stability.',
  },
  AdminActionLog: {
    status: 'OMITTED',
    reason:
      'Internal operational/security record; disclosed only through an approved legal/support workflow. `adminActionLogs` remains in the payload as an empty array for shape stability.',
  },

  // K16-A — settled this phase.
  ClientConsentRecord: { status: 'EXPORTED', keys: ['clientConsentRecords'] },
  ClientAllergy: { status: 'EXPORTED', keys: ['clientAllergies'] },

  // ----------------------------------------------------- omitted, on purpose
  // K16-A — the K14–K16 chart/consent family, settled by Tori 2026-07-31.
  ClientProfessionalNote: {
    status: 'OMITTED',
    reason: OMITTED_PRO_AUTHORED_FEEDBACK,
  },
  ClientFormulaEntry: {
    status: 'OMITTED',
    reason: `${OMITTED_PRO_AUTHORED_FEEDBACK} ClientFormulaEntry is always PRIVATE_TO_AUTHOR by schema and never public.`,
  },
  ProClientPolicy: {
    status: 'OMITTED',
    reason:
      'K16 requires per-client booking requirements to be NEUTRAL to the client by construction — they feel the requirement, they never learn a policy row exists about them. Exporting it to the client would contradict the rule the feature was built on.',
  },

  // Pre-existing omissions, previously undocumented outside `limitations`.
  PasswordResetToken: {
    status: 'OMITTED',
    reason: 'Single-use auth credential; never disclosed.',
  },
  EmailVerificationToken: {
    status: 'OMITTED',
    reason: 'Single-use auth credential; never disclosed.',
  },
  SessionHandoffToken: {
    status: 'OMITTED',
    reason:
      'Single-use auth credential; never disclosed. Rows are dead within 60s of issuance and hold only a hash, so there is nothing here the subject could learn from that is not already in their own session.',
  },
  PhoneVerification: {
    status: 'OMITTED',
    reason: 'Single-use auth credential; never disclosed.',
  },
  DeviceSessionRevocation: {
    status: 'OMITTED',
    reason: 'Session-security record, not subject data.',
  },
  IdempotencyKey: {
    status: 'OMITTED',
    reason: 'Request-dedupe infrastructure; holds no subject data of its own.',
  },
  ProfessionalSearchIndex: {
    status: 'OMITTED',
    reason: 'Derived search projection; every field originates in an exported model.',
  },
  ProfessionalBadgeStat: {
    status: 'OMITTED',
    reason: 'Derived aggregate over exported bookings/reviews.',
  },
  ProfessionalAvailabilityStat: {
    status: 'OMITTED',
    reason: 'Derived aggregate over exported bookings.',
  },
  ProfessionalMonthlyAnalytics: {
    status: 'OMITTED',
    reason: 'Derived aggregate over exported bookings/payments.',
  },
  LookViewerImpressionStat: {
    status: 'OMITTED',
    reason: 'Derived aggregate; no free text or contact data.',
  },
  ClientTasteVector: {
    status: 'OMITTED',
    reason: 'Derived embedding over exported interactions; not human-readable subject data.',
  },
  // AI Consult Phase 0. ConsultRevision,
  // ConsultAgreementAcceptance, and ConsultAuditEvent are transitively owned
  // through this row and cascade with it; the direct-FK completeness detector
  // cannot see them. Export the whole family together so immutable intake and
  // its exact consent/revocation history cannot be presented partially.
  ConsultSession: {
    status: 'EXPORTED',
    keys: ['consultSessions'],
  },
  ConsultInspiration: {
    status: 'OMITTED',
    reason:
      'Exported transitively inside consultSessions with source and retention metadata only; private storage pointers and integrity/idempotency hashes are excluded.',
  },
  ConsultBriefFeedback: {
    status: 'OMITTED',
    reason:
      'Pro-authored, content-free quality annotation used for audit and evaluation; it is not client-facing consult content and is not disclosed in either party\'s user export.',
  },

  // ------------------------------------------------- undecided (K16-A backlog)
  // Recorded, not resolved. Each of these links to the subject and is neither
  // exported nor deliberately omitted — before K16-A they were simply absent,
  // which read as "handled". Settle them by moving entries up.
  AdminNotification: { status: 'PENDING', note: PENDING_NOTE },
  AdminPermission: { status: 'PENDING', note: PENDING_NOTE },
  AftercareRebookSlot: { status: 'PENDING', note: PENDING_NOTE },
  Board: { status: 'PENDING', note: PENDING_NOTE },
  BookingCloseoutAuditLog: { status: 'PENDING', note: PENDING_NOTE },
  BookingOverrideAuditLog: { status: 'PENDING', note: PENDING_NOTE },
  BookingOverridePermission: { status: 'PENDING', note: PENDING_NOTE },
  BookingRefund: { status: 'PENDING', note: PENDING_NOTE },
  CalendarBlock: { status: 'PENDING', note: PENDING_NOTE },
  CalendarFeedSubscription: { status: 'PENDING', note: PENDING_NOTE },
  // Wholly DERIVED standing: every field is an aggregate the refresh job
  // recomputes from rows that are themselves dispositioned (the client's looks,
  // their saves, the bookings attributed to them). It states nothing about the
  // person that those rows don't, and a snapshot of a percentile that moves
  // whenever anyone else publishes would be a misleading thing to hand someone
  // as "your data". The live tier is shown to the client on their own profile.
  ClientCreatorStat: {
    status: 'OMITTED',
    reason:
      'Derived aggregate of already-dispositioned rows (the client’s public looks, their saves, and bookings attributed to them); recomputed by a job and surfaced live on the profile rather than stored about the person.',
  },
  // Same reasoning as ClientCreatorStat directly above: wholly derived, rebuilt
  // hourly from the client's own looks and other people's saves — both already
  // dispositioned — and it describes a trailing seven days that will not be true
  // by the time an export is read.
  ClientLookTrendStat: {
    status: 'OMITTED',
    reason:
      'Derived weekly aggregate of already-dispositioned rows (the client’s public looks and the saves on them), rebuilt hourly and surfaced live; a snapshot of a seven-day window would be stale before it was read.',
  },
  // 🔴 NOT derived, and NOT omissible on the reasoning above: this is money the
  // client holds and money they spent. It is exactly what a person asking for
  // "my data" would expect a balance to be backed by, so it is exported rather
  // than reasoned away.
  ClientCreditEntry: { status: 'EXPORTED', keys: ['clientCreditEntries'] },
  ClientFollow: { status: 'PENDING', note: PENDING_NOTE },
  ClientIntentEvent: { status: 'PENDING', note: PENDING_NOTE },
  ClientNotificationPreference: { status: 'PENDING', note: PENDING_NOTE },
  ClientNotificationSettings: { status: 'PENDING', note: PENDING_NOTE },
  ClientPaymentMethod: { status: 'PENDING', note: PENDING_NOTE },
  ConsentForm: { status: 'PENDING', note: PENDING_NOTE },
  ConsentFormVersion: { status: 'PENDING', note: PENDING_NOTE },
  ConsultationApproval: { status: 'PENDING', note: PENDING_NOTE },
  ConsultationApprovalProof: { status: 'PENDING', note: PENDING_NOTE },
  DeviceToken: { status: 'PENDING', note: PENDING_NOTE },
  LastMinuteOpening: { status: 'PENDING', note: PENDING_NOTE },
  LastMinuteRecipient: { status: 'PENDING', note: PENDING_NOTE },
  LastMinuteSettings: { status: 'PENDING', note: PENDING_NOTE },
  LookComment: { status: 'PENDING', note: PENDING_NOTE },
  LookCommentLike: { status: 'PENDING', note: PENDING_NOTE },
  LookCommentReport: { status: 'PENDING', note: PENDING_NOTE },
  LookHide: { status: 'PENDING', note: PENDING_NOTE },
  LookLike: { status: 'PENDING', note: PENDING_NOTE },
  LookPost: { status: 'PENDING', note: PENDING_NOTE },
  LookPostReport: { status: 'PENDING', note: PENDING_NOTE },
  MediaComment: { status: 'PENDING', note: PENDING_NOTE },
  MediaLike: { status: 'PENDING', note: PENDING_NOTE },
  MessageThread: { status: 'PENDING', note: PENDING_NOTE },
  MessageThreadParticipant: { status: 'PENDING', note: PENDING_NOTE },
  NfcCard: { status: 'PENDING', note: PENDING_NOTE },
  ProClientInvite: { status: 'PENDING', note: PENDING_NOTE },
  ProFollow: { status: 'PENDING', note: PENDING_NOTE },
  ProNoShowSettings: { status: 'PENDING', note: PENDING_NOTE },
  ProReminderSettings: { status: 'PENDING', note: PENDING_NOTE },
  ProductSale: { status: 'PENDING', note: PENDING_NOTE },
  ProfessionalExpense: { status: 'PENDING', note: PENDING_NOTE },
  ProfessionalFavorite: { status: 'PENDING', note: PENDING_NOTE },
  ProfessionalNotificationPreference: { status: 'PENDING', note: PENDING_NOTE },
  ProfessionalPaymentSettings: { status: 'PENDING', note: PENDING_NOTE },
  ProfessionalReceiptInbox: { status: 'PENDING', note: PENDING_NOTE },
  // The pro's own "Before you go" copy — text they wrote, shown verbatim to
  // their clients. Straightforwardly theirs, so it is exported rather than
  // parked in the backlog. The client's ticks against these rows
  // (BookingPrepCheck) are the other party's activity and are not included.
  ProPrepItem: { status: 'EXPORTED', keys: ['proPrepItems'] },
  ProfessionalServiceOffering: { status: 'PENDING', note: PENDING_NOTE },
  ProfessionalSubscription: { status: 'PENDING', note: PENDING_NOTE },
  Referral: { status: 'PENDING', note: PENDING_NOTE },
  Reminder: { status: 'PENDING', note: PENDING_NOTE },
  Review: { status: 'PENDING', note: PENDING_NOTE },
  ReviewHelpful: { status: 'PENDING', note: PENDING_NOTE },
  ServiceFavorite: { status: 'PENDING', note: PENDING_NOTE },
  SupportTicket: { status: 'PENDING', note: PENDING_NOTE },
  UploadSession: { status: 'PENDING', note: PENDING_NOTE },
  ConsultCapture: {
    status: 'OMITTED',
    reason:
      'Ephemeral raw-processing metadata; never export storage pointers or provider provenance.',
  },
  VerificationDocument: { status: 'PENDING', note: PENDING_NOTE },
  ViralRequestApprovalFanOut: { status: 'PENDING', note: PENDING_NOTE },
  ViralServiceRequest: { status: 'PENDING', note: PENDING_NOTE },
  ViralServiceRequestReport: { status: 'PENDING', note: PENDING_NOTE },
  WaitlistEntry: { status: 'PENDING', note: PENDING_NOTE },
  WaitlistOffer: { status: 'PENDING', note: PENDING_NOTE },
}

/**
 * Models that link to a subject but have no disposition yet.
 *
 * Baseline-tracked in the same spirit as `check:no-type-escape`: the guard
 * fails if this count GROWS, so a new model must be dispositioned rather than
 * silently joining the backlog. Shrink it by settling entries above.
 */
export const PENDING_DISPOSITION_BASELINE = 60

export function pendingModelNames(): string[] {
  return subjectLinkedModelNames().filter(
    (name) => EXPORT_BOUNDARY[name]?.status !== 'EXPORTED' &&
      EXPORT_BOUNDARY[name]?.status !== 'OMITTED',
  )
}
