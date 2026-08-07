// lib/privacy/deleteRules.ts

import {
  BookingSeriesStatus,
  Prisma,
  type PrismaClient,
} from '@prisma/client'

/**
 * The typed rule table `deleteUserData` executes, and the thing
 * `deleteBoundary.test.ts` measures coverage against.
 *
 * Keeping the rules as DATA rather than fifty hand-written functions is what
 * makes the completeness guard meaningful: the set of models the executor
 * actually touches is `RULES.map(r => r.model)`, so it cannot drift from the
 * registry's claims without the guard noticing. It is also the house
 * no-duplicate-logic rule applied to what was otherwise the same
 * count-then-deleteMany block copied once per model.
 *
 * Every rule is generic over its own `where` type, so a wrong field name is a
 * typecheck failure rather than a runtime surprise.
 */

export type DeleteDispositionStatus = 'DELETE' | 'ANONYMIZE' | 'RETAIN'

export type PrivacyDb = PrismaClient | Prisma.TransactionClient

export type DeleteSubject = {
  readonly userId: string
  readonly clientProfileId: string | null
  readonly professionalProfileId: string | null
}

export type DeleteRule = {
  readonly model: string
  readonly action: 'DELETE' | 'ANONYMIZE'
  readonly notes?: string
  /** `null` when the rule does not apply to this subject at all. */
  count(db: PrivacyDb, subject: DeleteSubject): Promise<number | null>
  apply(db: PrivacyDb, subject: DeleteSubject): Promise<number | null>
}

type CountingDelegate<W> = {
  count(args: { where: W }): Promise<number>
}

type DeletingDelegate<W> = CountingDelegate<W> & {
  deleteMany(args: { where: W }): Promise<{ count: number }>
}

type UpdatingDelegate<W, D> = CountingDelegate<W> & {
  updateMany(args: { where: W; data: D }): Promise<{ count: number }>
}

/**
 * A step that must run BEFORE the rule's own write.
 *
 * Exists for one reason: several models are referenced without a cascade, so
 * the delete raises a foreign-key violation unless the referencing rows go
 * first. See `ProfessionalLocation` in `deleteBoundary.ts` for what happens
 * when that is missed.
 */
type PreStep = (db: PrivacyDb, subject: DeleteSubject) => Promise<void>

function deleteRule<W>(args: {
  model: string
  notes?: string
  delegate: (db: PrivacyDb) => DeletingDelegate<W>
  where: (subject: DeleteSubject) => W | null
  before?: PreStep
}): DeleteRule {
  return {
    model: args.model,
    action: 'DELETE',
    ...(args.notes ? { notes: args.notes } : {}),
    async count(db, subject) {
      const where = args.where(subject)
      if (where === null) return null
      return args.delegate(db).count({ where })
    },
    async apply(db, subject) {
      const where = args.where(subject)
      if (where === null) return null
      if (args.before) await args.before(db, subject)
      const result = await args.delegate(db).deleteMany({ where })
      return result.count
    },
  }
}

function anonymizeRule<W, D>(args: {
  model: string
  notes?: string
  delegate: (db: PrivacyDb) => UpdatingDelegate<W, D>
  where: (subject: DeleteSubject) => W | null
  data: D
}): DeleteRule {
  return {
    model: args.model,
    action: 'ANONYMIZE',
    ...(args.notes ? { notes: args.notes } : {}),
    async count(db, subject) {
      const where = args.where(subject)
      if (where === null) return null
      return args.delegate(db).count({ where })
    },
    async apply(db, subject) {
      const where = args.where(subject)
      if (where === null) return null
      const result = await args.delegate(db).updateMany({ where, data: args.data })
      return result.count
    },
  }
}

/** Drop the `null` arms of an OR so an absent profile never widens the match. */
function orArms<T>(...items: Array<T | null>): T[] {
  return items.filter((item): item is T => item !== null)
}

const STORAGE_BYTES_NOTE =
  'Database rows only. Storage object deletion runs through the media/storage write boundary.'

export const DELETE_RULES: readonly DeleteRule[] = [
  // ------------------------------------------------- credentials & tokens
  deleteRule({
    model: 'PasswordResetToken',
    delegate: (db) => db.passwordResetToken,
    where: (s) => ({ userId: s.userId }),
  }),
  deleteRule({
    model: 'EmailVerificationToken',
    delegate: (db) => db.emailVerificationToken,
    where: (s) => ({ userId: s.userId }),
  }),
  deleteRule({
    model: 'PhoneVerification',
    delegate: (db) => db.phoneVerification,
    where: (s) => ({ userId: s.userId }),
  }),
  deleteRule({
    model: 'SessionHandoffToken',
    delegate: (db) => db.sessionHandoffToken,
    where: (s) => ({ userId: s.userId }),
  }),
  deleteRule({
    model: 'ClientActionToken',
    delegate: (db) => db.clientActionToken,
    where: (s) => {
      const or = orArms(
        s.clientProfileId ? { clientId: s.clientProfileId } : null,
        s.professionalProfileId
          ? { professionalId: s.professionalProfileId }
          : null,
      )
      return or.length > 0 ? { OR: or } : null
    },
  }),
  deleteRule({
    model: 'DeviceToken',
    notes:
      'Push credentials. A surviving token keeps delivering to a deleted account.',
    delegate: (db) => db.deviceToken,
    where: (s) => ({ userId: s.userId }),
  }),
  deleteRule({
    model: 'CalendarFeedSubscription',
    notes: 'Holds the secret calendar-feed token.',
    delegate: (db) => db.calendarFeedSubscription,
    where: (s) =>
      s.professionalProfileId
        ? { professionalId: s.professionalProfileId }
        : null,
  }),
  deleteRule({
    model: 'HandleRegistration',
    notes: 'Releases the global @handle so it can be claimed again.',
    delegate: (db) => db.handleRegistration,
    where: (s) => {
      const or = orArms(
        s.professionalProfileId
          ? { professionalId: s.professionalProfileId }
          : null,
        s.clientProfileId ? { clientProfileId: s.clientProfileId } : null,
      )
      return or.length > 0 ? { OR: or } : null
    },
  }),

  // ------------------------------------------------------ contact & money
  deleteRule({
    model: 'ClientAddress',
    delegate: (db) => db.clientAddress,
    where: (s) => (s.clientProfileId ? { clientId: s.clientProfileId } : null),
  }),
  deleteRule({
    model: 'ClientPaymentMethod',
    notes:
      'Removes our row. Detaching the payment method at Stripe is a separate provider-side boundary.',
    delegate: (db) => db.clientPaymentMethod,
    where: (s) => (s.clientProfileId ? { clientId: s.clientProfileId } : null),
  }),

  // ----------------------------------------------------- booking scaffolding
  deleteRule({
    model: 'BookingHold',
    delegate: (db) => db.bookingHold,
    where: (s) => {
      const or = orArms(
        s.clientProfileId ? { clientId: s.clientProfileId } : null,
        s.professionalProfileId
          ? { professionalId: s.professionalProfileId }
          : null,
      )
      return or.length > 0 ? { OR: or } : null
    },
  }),
  deleteRule({
    model: 'AftercareRebookSlot',
    delegate: (db) => db.aftercareRebookSlot,
    where: (s) =>
      s.professionalProfileId
        ? { professionalId: s.professionalProfileId }
        : null,
  }),
  deleteRule({
    model: 'CalendarBlock',
    delegate: (db) => db.calendarBlock,
    where: (s) =>
      s.professionalProfileId
        ? { professionalId: s.professionalProfileId }
        : null,
  }),
  deleteRule({
    model: 'WaitlistOffer',
    delegate: (db) => db.waitlistOffer,
    where: (s) => {
      const or = orArms(
        s.clientProfileId ? { clientId: s.clientProfileId } : null,
        s.professionalProfileId
          ? { professionalId: s.professionalProfileId }
          : null,
      )
      return or.length > 0 ? { OR: or } : null
    },
  }),
  deleteRule({
    model: 'WaitlistEntry',
    delegate: (db) => db.waitlistEntry,
    where: (s) => {
      const or = orArms(
        s.clientProfileId ? { clientId: s.clientProfileId } : null,
        s.professionalProfileId
          ? { professionalId: s.professionalProfileId }
          : null,
      )
      return or.length > 0 ? { OR: or } : null
    },
  }),
  deleteRule({
    model: 'LastMinuteOpening',
    delegate: (db) => db.lastMinuteOpening,
    where: (s) =>
      s.professionalProfileId
        ? { professionalId: s.professionalProfileId }
        : null,
  }),
  deleteRule({
    model: 'LastMinuteRecipient',
    delegate: (db) => db.lastMinuteRecipient,
    where: (s) => (s.clientProfileId ? { clientId: s.clientProfileId } : null),
  }),
  deleteRule({
    model: 'LastMinuteSettings',
    notes:
      'LastMinuteServiceRule and LastMinuteBlock reference it without a cascade, so they go first.',
    delegate: (db) => db.lastMinuteSettings,
    where: (s) =>
      s.professionalProfileId
        ? { professionalId: s.professionalProfileId }
        : null,
    before: async (db, subject) => {
      if (!subject.professionalProfileId) return
      const settingsWhere = {
        settings: { professionalId: subject.professionalProfileId },
      }
      await db.lastMinuteServiceRule.deleteMany({ where: settingsWhere })
      await db.lastMinuteBlock.deleteMany({ where: settingsWhere })
    },
  }),

  // ------------------------------------------------------------ preferences
  deleteRule({
    model: 'ClientNotificationPreference',
    delegate: (db) => db.clientNotificationPreference,
    where: (s) => (s.clientProfileId ? { clientId: s.clientProfileId } : null),
  }),
  deleteRule({
    model: 'ClientNotificationSettings',
    delegate: (db) => db.clientNotificationSettings,
    where: (s) => (s.clientProfileId ? { clientId: s.clientProfileId } : null),
  }),
  deleteRule({
    model: 'ProfessionalNotificationPreference',
    delegate: (db) => db.professionalNotificationPreference,
    where: (s) =>
      s.professionalProfileId
        ? { professionalId: s.professionalProfileId }
        : null,
  }),
  deleteRule({
    model: 'ProReminderSettings',
    delegate: (db) => db.proReminderSettings,
    where: (s) =>
      s.professionalProfileId
        ? { professionalId: s.professionalProfileId }
        : null,
  }),
  deleteRule({
    model: 'ProNoShowSettings',
    delegate: (db) => db.proNoShowSettings,
    where: (s) =>
      s.professionalProfileId
        ? { professionalId: s.professionalProfileId }
        : null,
  }),

  // ---------------------------------------------------------- notifications
  deleteRule({
    model: 'ScheduledClientNotification',
    notes: 'Queued future sends must not fire at a deleted account.',
    delegate: (db) => db.scheduledClientNotification,
    where: (s) => (s.clientProfileId ? { clientId: s.clientProfileId } : null),
  }),
  deleteRule({
    model: 'ClientNotification',
    delegate: (db) => db.clientNotification,
    where: (s) => (s.clientProfileId ? { clientId: s.clientProfileId } : null),
  }),
  deleteRule({
    model: 'Notification',
    notes:
      "Deletes the subject's own feed. Rows where the subject is only the ACTOR belong to another pro's feed, so those are de-identified in place first rather than deleted.",
    delegate: (db) => db.notification,
    where: (s) =>
      s.professionalProfileId
        ? { professionalId: s.professionalProfileId }
        : null,
    before: async (db, subject) => {
      await db.notification.updateMany({
        where: { actorUserId: subject.userId },
        data: { actorUserId: null },
      })
    },
  }),
  deleteRule({
    model: 'NotificationDispatch',
    notes:
      'Carries recipient contact PII. Cascades to NotificationDelivery rows.',
    delegate: (db) => db.notificationDispatch,
    where: (s) => {
      const or = orArms<Prisma.NotificationDispatchWhereInput>(
        { userId: s.userId },
        s.clientProfileId ? { clientId: s.clientProfileId } : null,
        s.professionalProfileId
          ? { professionalId: s.professionalProfileId }
          : null,
      )
      return { OR: or }
    },
  }),
  deleteRule({
    model: 'Reminder',
    delegate: (db) => db.reminder,
    where: (s) => {
      const or = orArms(
        s.clientProfileId ? { clientId: s.clientProfileId } : null,
        s.professionalProfileId
          ? { professionalId: s.professionalProfileId }
          : null,
      )
      return or.length > 0 ? { OR: or } : null
    },
  }),

  // ------------------------------------------------------------------ media
  deleteRule({
    model: 'MediaAsset',
    notes: STORAGE_BYTES_NOTE,
    delegate: (db) => db.mediaAsset,
    where: (s) => ({
      OR: orArms<Prisma.MediaAssetWhereInput>(
        { uploadedByUserId: s.userId },
        s.clientProfileId ? { booking: { clientId: s.clientProfileId } } : null,
        s.professionalProfileId
          ? { professionalId: s.professionalProfileId }
          : null,
      ),
    }),
    // ClientIntentEvent.mediaId has no cascade, so telemetry rows pointing at
    // the subject's media — including rows belonging to OTHER users — block the
    // delete until they are cleared.
    before: async (db, subject) => {
      await db.clientIntentEvent.deleteMany({
        where: {
          media: {
            OR: orArms<Prisma.MediaAssetWhereInput>(
              { uploadedByUserId: subject.userId },
              subject.clientProfileId
                ? { booking: { clientId: subject.clientProfileId } }
                : null,
              subject.professionalProfileId
                ? { professionalId: subject.professionalProfileId }
                : null,
            ),
          },
        },
      })
    },
  }),
  deleteRule({
    model: 'PracticeShot',
    notes: STORAGE_BYTES_NOTE,
    delegate: (db) => db.practiceShot,
    where: (s) =>
      s.professionalProfileId
        ? { professionalId: s.professionalProfileId }
        : null,
  }),
  deleteRule({
    model: 'UploadSession',
    delegate: (db) => db.uploadSession,
    where: (s) => {
      const or = orArms(
        s.clientProfileId ? { clientId: s.clientProfileId } : null,
        s.professionalProfileId
          ? { professionalId: s.professionalProfileId }
          : null,
      )
      return or.length > 0 ? { OR: or } : null
    },
  }),

  // --------------------------------------------------- social & engagement
  deleteRule({
    model: 'LookPost',
    notes:
      'Public content must not stay published against a deleted account. Cascades to its assets, likes and comments.',
    delegate: (db) => db.lookPost,
    where: (s) => {
      const or = orArms(
        s.professionalProfileId
          ? { professionalId: s.professionalProfileId }
          : null,
        s.clientProfileId ? { clientAuthorId: s.clientProfileId } : null,
      )
      return or.length > 0 ? { OR: or } : null
    },
  }),
  deleteRule({
    model: 'LookComment',
    delegate: (db) => db.lookComment,
    where: (s) => ({ userId: s.userId }),
  }),
  deleteRule({
    model: 'LookCommentLike',
    delegate: (db) => db.lookCommentLike,
    where: (s) => ({ userId: s.userId }),
  }),
  deleteRule({
    model: 'LookLike',
    delegate: (db) => db.lookLike,
    where: (s) => ({ userId: s.userId }),
  }),
  deleteRule({
    model: 'LookHide',
    delegate: (db) => db.lookHide,
    where: (s) => ({ userId: s.userId }),
  }),
  deleteRule({
    model: 'LookViewerImpressionStat',
    delegate: (db) => db.lookViewerImpressionStat,
    where: (s) => ({ userId: s.userId }),
  }),
  deleteRule({
    model: 'MediaLike',
    delegate: (db) => db.mediaLike,
    where: (s) => ({ userId: s.userId }),
  }),
  deleteRule({
    model: 'MediaComment',
    delegate: (db) => db.mediaComment,
    where: (s) => ({ userId: s.userId }),
  }),
  deleteRule({
    model: 'ReviewHelpful',
    delegate: (db) => db.reviewHelpful,
    where: (s) => ({ userId: s.userId }),
  }),
  deleteRule({
    model: 'ServiceFavorite',
    delegate: (db) => db.serviceFavorite,
    where: (s) => ({ userId: s.userId }),
  }),
  deleteRule({
    model: 'ProfessionalFavorite',
    notes:
      "Both directions: the subject's favourites, and other users' favourites OF the subject.",
    delegate: (db) => db.professionalFavorite,
    where: (s) => ({
      OR: orArms<Prisma.ProfessionalFavoriteWhereInput>(
        { userId: s.userId },
        s.professionalProfileId
          ? { professionalId: s.professionalProfileId }
          : null,
      ),
    }),
  }),
  deleteRule({
    model: 'ProFollow',
    notes: 'Both directions, as with ProfessionalFavorite.',
    delegate: (db) => db.proFollow,
    where: (s) => {
      const or = orArms(
        s.clientProfileId ? { clientId: s.clientProfileId } : null,
        s.professionalProfileId
          ? { professionalId: s.professionalProfileId }
          : null,
      )
      return or.length > 0 ? { OR: or } : null
    },
  }),
  deleteRule({
    model: 'ClientFollow',
    notes: 'Both directions (follower and followed).',
    delegate: (db) => db.clientFollow,
    where: (s) =>
      s.clientProfileId
        ? {
            OR: [
              { followerClientId: s.clientProfileId },
              { followedClientId: s.clientProfileId },
            ],
          }
        : null,
  }),
  deleteRule({
    model: 'Board',
    delegate: (db) => db.board,
    where: (s) => (s.clientProfileId ? { clientId: s.clientProfileId } : null),
  }),
  deleteRule({
    model: 'ConsultSession',
    notes:
      "The client's own booking-attached AI consult. Immutable revisions, agreement evidence, and audit rows cascade; raw consult media is not durable.",
    delegate: (db) => db.consultSession,
    where: (s) => (s.clientProfileId ? { clientId: s.clientProfileId } : null),
  }),
  deleteRule({
    model: 'TapIntent',
    delegate: (db) => db.tapIntent,
    where: (s) => ({ userId: s.userId }),
  }),
  deleteRule({
    model: 'ClientIntentEvent',
    delegate: (db) => db.clientIntentEvent,
    where: (s) => (s.clientProfileId ? { clientId: s.clientProfileId } : null),
  }),
  deleteRule({
    model: 'ViralServiceRequest',
    notes:
      'Fan-out rows cascade with it; reports filed against it are retained separately.',
    delegate: (db) => db.viralServiceRequest,
    where: (s) => (s.clientProfileId ? { clientId: s.clientProfileId } : null),
  }),
  deleteRule({
    model: 'ViralRequestApprovalFanOut',
    delegate: (db) => db.viralRequestApprovalFanOut,
    where: (s) =>
      s.professionalProfileId
        ? { professionalId: s.professionalProfileId }
        : null,
  }),

  // -------------------------------------------------------- health & charts
  deleteRule({
    model: 'ClientAllergy',
    notes:
      "Deleted when the CLIENT is the subject. When the subject is the pro who recorded it, the row is the client's record and is retained.",
    delegate: (db) => db.clientAllergy,
    where: (s) => (s.clientProfileId ? { clientId: s.clientProfileId } : null),
  }),
  deleteRule({
    model: 'ClientChartShare',
    notes: 'Revokes chart access by removing the grant.',
    delegate: (db) => db.clientChartShare,
    where: (s) => {
      const or = orArms(
        s.clientProfileId ? { clientId: s.clientProfileId } : null,
        s.professionalProfileId
          ? { professionalId: s.professionalProfileId }
          : null,
      )
      return or.length > 0 ? { OR: or } : null
    },
  }),

  // ------------------------------------------------- derived pro projections
  deleteRule({
    model: 'ProfessionalSearchIndex',
    notes: 'Removes the deleted pro from discovery.',
    delegate: (db) => db.professionalSearchIndex,
    where: (s) =>
      s.professionalProfileId
        ? { professionalId: s.professionalProfileId }
        : null,
  }),
  deleteRule({
    model: 'ProfessionalBadgeStat',
    delegate: (db) => db.professionalBadgeStat,
    where: (s) =>
      s.professionalProfileId
        ? { professionalId: s.professionalProfileId }
        : null,
  }),
  deleteRule({
    model: 'ProfessionalAvailabilityStat',
    delegate: (db) => db.professionalAvailabilityStat,
    where: (s) =>
      s.professionalProfileId
        ? { professionalId: s.professionalProfileId }
        : null,
  }),
  deleteRule({
    model: 'ClientTasteVector',
    delegate: (db) => db.clientTasteVector,
    where: (s) =>
      s.clientProfileId ? { clientProfileId: s.clientProfileId } : null,
  }),

  // -------------------------------------------------------------- anonymize
  anonymizeRule({
    model: 'ProfessionalLocation',
    notes:
      'Cannot be deleted — six models reference it with onDelete: Restrict. Address PII cleared and the location archived.',
    delegate: (db) => db.professionalLocation,
    where: (s) =>
      s.professionalProfileId
        ? { professionalId: s.professionalProfileId }
        : null,
    data: {
      name: null,
      isBookable: false,
      archivedAt: new Date(),
      formattedAddress: null,
      addressLine1: null,
      addressLine2: null,
      city: null,
      state: null,
      postalCode: null,
      countryCode: null,
      placeId: null,
      lat: null,
      lng: null,
      encryptedAddressJson: Prisma.DbNull,
      addressKeyVersion: null,
      postalCodePrefix: null,
      latApprox: null,
      lngApprox: null,
    },
  }),
  anonymizeRule({
    model: 'ProfessionalServiceOffering',
    notes:
      'Deactivated rather than deleted — eight models reference it with Restrict.',
    delegate: (db) => db.professionalServiceOffering,
    where: (s) =>
      s.professionalProfileId
        ? { professionalId: s.professionalProfileId }
        : null,
    data: { isActive: false },
  }),
  anonymizeRule({
    model: 'BookingSeries',
    notes:
      'Cancelled so it stops materializing future appointments for a deleted account.',
    delegate: (db) => db.bookingSeries,
    where: (s) => {
      const or = orArms(
        s.clientProfileId ? { clientId: s.clientProfileId } : null,
        s.professionalProfileId
          ? { professionalId: s.professionalProfileId }
          : null,
      )
      return or.length > 0
        ? { OR: or, status: BookingSeriesStatus.ACTIVE }
        : null
    },
    data: {
      status: BookingSeriesStatus.CANCELLED,
      internalNotes: null,
      overrideReason: null,
    },
  }),
  anonymizeRule({
    model: 'NfcCard',
    notes: 'Unclaimed so the physical card can be reissued.',
    delegate: (db) => db.nfcCard,
    where: (s) => {
      const or = orArms<Prisma.NfcCardWhereInput>(
        { claimedByUserId: s.userId },
        s.professionalProfileId
          ? { professionalId: s.professionalProfileId }
          : null,
      )
      return { OR: or }
    },
    data: { claimedByUserId: null, claimedAt: null, professionalId: null },
  }),
  anonymizeRule({
    model: 'AttributionEvent',
    notes: 'Aggregate analytics survive without identity.',
    delegate: (db) => db.attributionEvent,
    where: (s) => ({
      OR: [{ actorUserId: s.userId }, { creditedUserId: s.userId }],
    }),
    data: { actorUserId: null, creditedUserId: null },
  }),
]

/**
 * Models `deleteUserData` anonymizes with bespoke per-row logic rather than a
 * table rule, because the replacement values depend on the row (the deleted-user
 * email is derived from the user id). Declared here so the completeness guard
 * counts them as covered.
 */
export const INLINE_HANDLED_MODELS: readonly string[] = [
  'User',
  'ClientProfile',
  'ProfessionalProfile',
]

/** Every model the executor actually touches. */
export function handledModelNames(): string[] {
  return [
    ...DELETE_RULES.map((rule) => rule.model),
    ...INLINE_HANDLED_MODELS,
  ].sort()
}
