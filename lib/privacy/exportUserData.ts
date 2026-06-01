// lib/privacy/exportUserData.ts

import { Prisma, type PrismaClient } from '@prisma/client'

import { assertSafePrivacyExportPayload } from '@/lib/privacy/exportSafety'

export type ExportUserDataInput = {
  db: PrismaClient | Prisma.TransactionClient
  userId: string
}

export type ExportedUserData = {
  exportedAt: string
  subject: {
    userId: string
    clientProfileId: string | null
    professionalProfileId: string | null
  }
  data: {
    user: unknown
    clientProfile: unknown
    professionalProfile: unknown
    clientAddresses: unknown[]
    professionalLocations: unknown[]
    bookingsAsClient: unknown[]
    bookingsAsProfessional: unknown[]
    bookingHolds: unknown[]
    clientActionTokens: unknown[]
    aftercareSummaries: unknown[]
    mediaAssets: unknown[]
    messages: unknown[]
    notifications: unknown[]
    clientNotifications: unknown[]
    scheduledClientNotifications: unknown[]
    notificationDispatches: unknown[]
    notificationDeliveries: unknown[]
    attributionEvents: unknown[]
    tapIntents: unknown[]
    adminActionLogs: unknown[]
  }
  limitations: string[]
}

const EXPORT_VERSION = 1

const userExportSelect = {
  id: true,
  email: true,
  phone: true,
  role: true,
  emailVerifiedAt: true,
  phoneVerifiedAt: true,
  tosAcceptedAt: true,
  tosVersion: true,
  transactionalSmsConsentAt: true,
  transactionalSmsConsentVersion: true,
  transactionalSmsConsentSource: true,
  createdAt: true,
  updatedAt: true,
  clientProfile: {
    select: {
      id: true,
      userId: true,
      firstName: true,
      lastName: true,
      claimStatus: true,
      claimedAt: true,
      email: true,
      phone: true,
      phoneVerifiedAt: true,
      avatarUrl: true,
      dateOfBirth: true,
      preferredContactMethod: true,
      alertBanner: true,
    },
  },
  professionalProfile: {
    select: {
      id: true,
      userId: true,
      firstName: true,
      lastName: true,
      phone: true,
      phoneVerifiedAt: true,
      businessName: true,
      handle: true,
      isPremium: true,
      bio: true,
      avatarUrl: true,
      location: true,
      timeZone: true,
    },
  },
} satisfies Prisma.UserSelect

const clientAddressExportSelect = {
  id: true,
  clientId: true,
  kind: true,
  label: true,
  isDefault: true,
  formattedAddress: true,
  addressLine1: true,
  addressLine2: true,
  city: true,
  state: true,
  postalCode: true,
  countryCode: true,
  radiusMiles: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.ClientAddressSelect

const professionalLocationExportSelect = {
  id: true,
  professionalId: true,
  type: true,
  name: true,
  isPrimary: true,
  isBookable: true,
  formattedAddress: true,
  addressLine1: true,
  addressLine2: true,
  city: true,
  state: true,
  postalCode: true,
  countryCode: true,
  timeZone: true,
  bufferMinutes: true,
  stepMinutes: true,
  advanceNoticeMinutes: true,
  maxDaysAhead: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.ProfessionalLocationSelect

const bookingExportSelect = {
  id: true,
  clientId: true,
  professionalId: true,
  serviceId: true,
  offeringId: true,
  scheduledFor: true,
  status: true,
  locationType: true,
  locationId: true,
  clientAddressId: true,
  clientTimeZoneAtBooking: true,
  subtotalSnapshot: true,
  totalAmount: true,
  depositAmount: true,
  tipAmount: true,
  taxAmount: true,
  discountAmount: true,
  serviceSubtotalSnapshot: true,
  productSubtotalSnapshot: true,
  checkoutStatus: true,
  selectedPaymentMethod: true,
  paymentCollectedAt: true,
  paymentAuthorizedAt: true,
  paymentProvider: true,
  totalDurationMinutes: true,
  bufferMinutes: true,
  source: true,
  rebookOfBookingId: true,
  clientNotes: true,
  startedAt: true,
  finishedAt: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.BookingSelect

const bookingHoldExportSelect = {
  id: true,
  offeringId: true,
  professionalId: true,
  clientId: true,
  scheduledFor: true,
  expiresAt: true,
  locationType: true,
  locationId: true,
  locationTimeZone: true,
  clientAddressId: true,
  durationMinutesSnapshot: true,
  bufferMinutesSnapshot: true,
  endsAtSnapshot: true,
  createdAt: true,
} satisfies Prisma.BookingHoldSelect

const clientActionTokenExportSelect = {
  id: true,
  kind: true,
  singleUse: true,
  bookingId: true,
  consultationApprovalId: true,
  aftercareSummaryId: true,
  clientId: true,
  professionalId: true,
  deliveryMethod: true,
  issuedByUserId: true,
  expiresAt: true,
  firstUsedAt: true,
  lastUsedAt: true,
  useCount: true,
  revokedAt: true,
  revokeReason: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.ClientActionTokenSelect

const mediaAssetExportSelect = {
  id: true,
  professionalId: true,
  bookingId: true,
  reviewId: true,
  uploadedByUserId: true,
  uploadedByRole: true,
  url: true,
  thumbUrl: true,
  mediaType: true,
  caption: true,
  visibility: true,
  isFeaturedInPortfolio: true,
  isEligibleForLooks: true,
  reviewLocked: true,
  phase: true,
  createdAt: true,
} satisfies Prisma.MediaAssetSelect

const messageExportSelect = {
  id: true,
  threadId: true,
  senderUserId: true,
  body: true,
  createdAt: true,
} satisfies Prisma.MessageSelect

const notificationExportSelect = {
  id: true,
  eventKey: true,
  priority: true,
  professionalId: true,
  actorUserId: true,
  bookingId: true,
  reviewId: true,
  title: true,
  body: true,
  href: true,
  seenAt: true,
  readAt: true,
  clickedAt: true,
  archivedAt: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.NotificationSelect

const clientNotificationExportSelect = {
  id: true,
  clientId: true,
  eventKey: true,
  title: true,
  body: true,
  href: true,
  bookingId: true,
  aftercareId: true,
  readAt: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.ClientNotificationSelect

const scheduledClientNotificationExportSelect = {
  id: true,
  clientId: true,
  bookingId: true,
  eventKey: true,
  runAt: true,
  href: true,
  processedAt: true,
  cancelledAt: true,
  failedAt: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.ScheduledClientNotificationSelect

const notificationDispatchExportSelect = {
  id: true,
  sourceKey: true,
  eventKey: true,
  recipientKind: true,
  priority: true,
  userId: true,
  professionalId: true,
  clientId: true,
  notificationId: true,
  clientNotificationId: true,
  title: true,
  body: true,
  href: true,
  scheduledFor: true,
  cancelledAt: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.NotificationDispatchSelect

const notificationDeliveryExportSelect = {
  id: true,
  dispatchId: true,
  channel: true,
  provider: true,
  status: true,
  templateKey: true,
  templateVersion: true,
  attemptCount: true,
  maxAttempts: true,
  nextAttemptAt: true,
  lastAttemptAt: true,
  sentAt: true,
  deliveredAt: true,
  failedAt: true,
  suppressedAt: true,
  cancelledAt: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.NotificationDeliverySelect

const tapIntentExportSelect = {
  id: true,
  cardId: true,
  userId: true,
  intentType: true,
  expiresAt: true,
  createdAt: true,
} satisfies Prisma.TapIntentSelect

const aftercareSummaryExportSelect = {
  id: true,
  bookingId: true,
  notes: true,
  rebookMode: true,
  rebookedFor: true,
  rebookWindowStart: true,
  rebookWindowEnd: true,
  draftSavedAt: true,
  sentToClientAt: true,
  lastEditedAt: true,
  version: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.AftercareSummarySelect

/**
 * Canonical user data export boundary.
 *
 * This function should be the only place that assembles a user-level privacy
 * export. Routes/admin tools should call this rather than re-creating model
 * traversal logic.
 *
 * Keep this intentionally explicit. Privacy export code should be boring,
 * reviewable, and easy to diff when Prisma schema changes.
 */
export async function exportUserData(
  input: ExportUserDataInput,
): Promise<ExportedUserData> {
  const user = await input.db.user.findUnique({
    where: { id: input.userId },
    select: userExportSelect,
  })

  if (!user) {
    throw new Error(`Cannot export user data: user not found (${input.userId})`)
  }

  const clientProfileId = user.clientProfile?.id ?? null
  const professionalProfileId = user.professionalProfile?.id ?? null

  const [
    clientAddresses,
    professionalLocations,
    bookingsAsClient,
    bookingsAsProfessional,
    bookingHolds,
    clientActionTokens,
    aftercareSummaries,
    mediaAssets,
    messages,
    notifications,
    clientNotifications,
    scheduledClientNotifications,
    notificationDispatches,
    notificationDeliveries,
    attributionEvents,
    tapIntents,
    adminActionLogs,
  ] = await Promise.all([
    findClientAddresses(input.db, clientProfileId),
    findProfessionalLocations(input.db, professionalProfileId),
    findBookingsAsClient(input.db, clientProfileId),
    findBookingsAsProfessional(input.db, professionalProfileId),
    findBookingHolds(input.db, clientProfileId, professionalProfileId),
    findClientActionTokens(input.db, clientProfileId),
    findAftercareSummaries(input.db, clientProfileId, professionalProfileId),
    findMediaAssets(
      input.db,
      input.userId,
      clientProfileId,
      professionalProfileId,
    ),
    findMessages(input.db, input.userId, clientProfileId, professionalProfileId),
    findNotifications(input.db, professionalProfileId),
    findClientNotifications(input.db, clientProfileId),
    findScheduledClientNotifications(input.db, clientProfileId),
    findNotificationDispatches(
      input.db,
      input.userId,
      clientProfileId,
      professionalProfileId,
    ),
    findNotificationDeliveries(
      input.db,
      input.userId,
      clientProfileId,
      professionalProfileId,
    ),
    findAttributionEvents(
      input.db,
      input.userId,
      clientProfileId,
      professionalProfileId,
    ),
    findTapIntents(input.db, input.userId),
    findAdminActionLogs(input.db, input.userId),
  ])

  const exported: ExportedUserData = {
    exportedAt: new Date().toISOString(),
    subject: {
      userId: input.userId,
      clientProfileId,
      professionalProfileId,
    },
    data: {
      user: normalizeJson({
        id: user.id,
        email: user.email,
        phone: user.phone,
        role: user.role,
        emailVerifiedAt: user.emailVerifiedAt,
        phoneVerifiedAt: user.phoneVerifiedAt,
        tosAcceptedAt: user.tosAcceptedAt,
        tosVersion: user.tosVersion,
        transactionalSmsConsentAt: user.transactionalSmsConsentAt,
        transactionalSmsConsentVersion: user.transactionalSmsConsentVersion,
        transactionalSmsConsentSource: user.transactionalSmsConsentSource,
        createdAt: user.createdAt,
        updatedAt: user.updatedAt,
      }),
      clientProfile: normalizeJson(user.clientProfile),
      professionalProfile: normalizeJson(user.professionalProfile),
      clientAddresses: normalizeJsonArray(clientAddresses),
      professionalLocations: normalizeJsonArray(professionalLocations),
      bookingsAsClient: normalizeJsonArray(bookingsAsClient),
      bookingsAsProfessional: normalizeJsonArray(bookingsAsProfessional),
      bookingHolds: normalizeJsonArray(bookingHolds),
      clientActionTokens: normalizeJsonArray(clientActionTokens),
      aftercareSummaries: normalizeJsonArray(aftercareSummaries),
      mediaAssets: normalizeJsonArray(mediaAssets),
      messages: normalizeJsonArray(messages),
      notifications: normalizeJsonArray(notifications),
      clientNotifications: normalizeJsonArray(clientNotifications),
      scheduledClientNotifications: normalizeJsonArray(
        scheduledClientNotifications,
      ),
      notificationDispatches: normalizeJsonArray(notificationDispatches),
      notificationDeliveries: normalizeJsonArray(notificationDeliveries),
      attributionEvents: normalizeJsonArray(attributionEvents),
      tapIntents: normalizeJsonArray(tapIntents),
      adminActionLogs: normalizeJsonArray(adminActionLogs),
    },
    limitations: [
      'This export covers user-linked records known to the privacy export boundary.',
      'Tenant-level exports, aggregate analytics, provider-side records, and storage object bytes are separate workflows.',
      'If Prisma schema adds new user-linked models, update this boundary and its schema-completeness test.',
      'MediaAsset export includes product-facing URLs and metadata but excludes storage bucket/path internals.',
      'Notification exports include safe inbox/schedule/dispatch/delivery fields and exclude recipient contact snapshots, structured payload/data fields, provider payloads, lease tokens, destination snapshots, provider message details, dedupe keys, and delivery error details.',
      'AttributionEvent export is omitted pending a disclosure decision for attribution/admin-adjacent records.',
      'AdminActionLog export is omitted from the default user export because it is an internal security/operational record.',
    ],
  }

  assertSafePrivacyExportPayload(exported)

  return exported
}

async function findClientAddresses(
  db: PrismaClient | Prisma.TransactionClient,
  clientProfileId: string | null,
): Promise<unknown[]> {
  if (!clientProfileId) return []

  return db.clientAddress.findMany({
    where: { clientId: clientProfileId },
    orderBy: { createdAt: 'asc' },
    select: clientAddressExportSelect,
  })
}

async function findProfessionalLocations(
  db: PrismaClient | Prisma.TransactionClient,
  professionalProfileId: string | null,
): Promise<unknown[]> {
  if (!professionalProfileId) return []

  return db.professionalLocation.findMany({
    where: { professionalId: professionalProfileId },
    orderBy: { createdAt: 'asc' },
    select: professionalLocationExportSelect,
  })
}

async function findBookingsAsClient(
  db: PrismaClient | Prisma.TransactionClient,
  clientProfileId: string | null,
): Promise<unknown[]> {
  if (!clientProfileId) return []

  return db.booking.findMany({
    where: { clientId: clientProfileId },
    orderBy: { createdAt: 'asc' },
    select: bookingExportSelect,
  })
}

async function findBookingsAsProfessional(
  db: PrismaClient | Prisma.TransactionClient,
  professionalProfileId: string | null,
): Promise<unknown[]> {
  if (!professionalProfileId) return []

  return db.booking.findMany({
    where: { professionalId: professionalProfileId },
    orderBy: { createdAt: 'asc' },
    select: bookingExportSelect,
  })
}

async function findBookingHolds(
  db: PrismaClient | Prisma.TransactionClient,
  clientProfileId: string | null,
  professionalProfileId: string | null,
): Promise<unknown[]> {
  if (!clientProfileId && !professionalProfileId) return []

  return db.bookingHold.findMany({
    where: {
      OR: compactWhere([
        clientProfileId ? { clientId: clientProfileId } : null,
        professionalProfileId ? { professionalId: professionalProfileId } : null,
      ]),
    },
    orderBy: { createdAt: 'asc' },
    select: bookingHoldExportSelect,
  })
}

async function findClientActionTokens(
  db: PrismaClient | Prisma.TransactionClient,
  clientProfileId: string | null,
): Promise<unknown[]> {
  if (!clientProfileId) return []

  return db.clientActionToken.findMany({
    where: { clientId: clientProfileId },
    orderBy: { createdAt: 'asc' },
    select: clientActionTokenExportSelect,
  })
}

async function findAftercareSummaries(
  db: PrismaClient | Prisma.TransactionClient,
  clientProfileId: string | null,
  professionalProfileId: string | null,
): Promise<unknown[]> {
  if (!clientProfileId && !professionalProfileId) return []

  return db.aftercareSummary.findMany({
    where: {
      booking: {
        OR: compactWhere([
          clientProfileId ? { clientId: clientProfileId } : null,
          professionalProfileId ? { professionalId: professionalProfileId } : null,
        ]),
      },
    },
    orderBy: { createdAt: 'asc' },
    select: aftercareSummaryExportSelect,
  })
}

async function findMediaAssets(
  db: PrismaClient | Prisma.TransactionClient,
  userId: string,
  clientProfileId: string | null,
  professionalProfileId: string | null,
): Promise<unknown[]> {
  return db.mediaAsset.findMany({
    where: {
      OR: compactWhere([
        { uploadedByUserId: userId },
        clientProfileId
          ? {
              booking: {
                clientId: clientProfileId,
              },
            }
          : null,
        professionalProfileId ? { professionalId: professionalProfileId } : null,
      ]),
    },
    orderBy: { createdAt: 'asc' },
    select: mediaAssetExportSelect,
  })
}

async function findMessages(
  db: PrismaClient | Prisma.TransactionClient,
  userId: string,
  clientProfileId: string | null,
  professionalProfileId: string | null,
): Promise<unknown[]> {
  return db.message.findMany({
    where: {
      OR: compactWhere([
        { senderUserId: userId },
        clientProfileId
          ? {
              thread: {
                clientId: clientProfileId,
              },
            }
          : null,
        professionalProfileId
          ? {
              thread: {
                professionalId: professionalProfileId,
              },
            }
          : null,
      ]),
    },
    orderBy: { createdAt: 'asc' },
    select: messageExportSelect,
  })
}

async function findNotifications(
  db: PrismaClient | Prisma.TransactionClient,
  professionalProfileId: string | null,
): Promise<unknown[]> {
  if (!professionalProfileId) return []

  return db.notification.findMany({
    where: { professionalId: professionalProfileId },
    orderBy: { createdAt: 'asc' },
    select: notificationExportSelect,
  })
}


async function findClientNotifications(
  db: PrismaClient | Prisma.TransactionClient,
  clientProfileId: string | null,
): Promise<unknown[]> {
  if (!clientProfileId) return []

  return db.clientNotification.findMany({
    where: { clientId: clientProfileId },
    orderBy: { createdAt: 'asc' },
    select: clientNotificationExportSelect,
  })
}

async function findScheduledClientNotifications(
  db: PrismaClient | Prisma.TransactionClient,
  clientProfileId: string | null,
): Promise<unknown[]> {
  if (!clientProfileId) return []

  return db.scheduledClientNotification.findMany({
    where: { clientId: clientProfileId },
    orderBy: { createdAt: 'asc' },
    select: scheduledClientNotificationExportSelect,
  })
}

async function findNotificationDispatches(
  db: PrismaClient | Prisma.TransactionClient,
  userId: string,
  clientProfileId: string | null,
  professionalProfileId: string | null,
): Promise<unknown[]> {
  return db.notificationDispatch.findMany({
    where: {
      OR: compactWhere([
        { userId },
        clientProfileId ? { clientId: clientProfileId } : null,
        professionalProfileId ? { professionalId: professionalProfileId } : null,
      ]),
    },
    orderBy: { createdAt: 'asc' },
    select: notificationDispatchExportSelect,
  })
}

async function findNotificationDeliveries(
  db: PrismaClient | Prisma.TransactionClient,
  userId: string,
  clientProfileId: string | null,
  professionalProfileId: string | null,
): Promise<unknown[]> {
  return db.notificationDelivery.findMany({
    where: {
      dispatch: {
        OR: compactWhere([
          { userId },
          clientProfileId ? { clientId: clientProfileId } : null,
          professionalProfileId ? { professionalId: professionalProfileId } : null,
        ]),
      },
    },
    orderBy: { createdAt: 'asc' },
    select: notificationDeliveryExportSelect,
  })
}

async function findAttributionEvents(
  _db: PrismaClient | Prisma.TransactionClient,
  _userId: string,
  _clientProfileId: string | null,
  _professionalProfileId: string | null,
): Promise<unknown[]> {
  // Attribution records can contain cross-user/admin-adjacent attribution
  // context. Keep omitted from the default Phase 1 user export until the
  // disclosure policy and safe projection are explicitly defined.
  return []
}

async function findTapIntents(
  db: PrismaClient | Prisma.TransactionClient,
  userId: string,
): Promise<unknown[]> {
  return db.tapIntent.findMany({
    where: { userId },
    orderBy: { createdAt: 'asc' },
    select: tapIntentExportSelect,
  })
}

async function findAdminActionLogs(
  _db: PrismaClient | Prisma.TransactionClient,
  _userId: string,
): Promise<unknown[]> {
  // AdminActionLog is an internal operational/security record. It is omitted
  // from the default user export unless a separate legal/support disclosure
  // workflow explicitly approves a safe projection.
  return []
}

function compactWhere<T>(items: Array<T | null>): T[] {
  return items.filter((item): item is T => item !== null)
}

function normalizeJson(value: unknown): unknown {
  return JSON.parse(
    JSON.stringify(value, (_key, childValue: unknown) => {
      if (childValue instanceof Prisma.Decimal) {
        return childValue.toString()
      }

      if (childValue instanceof Date) {
        return childValue.toISOString()
      }

      if (typeof childValue === 'bigint') {
        return childValue.toString()
      }

      return childValue
    }),
  )
}

function normalizeJsonArray(value: unknown[]): unknown[] {
  return value.map(normalizeJson)
}

export const USER_DATA_EXPORT_VERSION = EXPORT_VERSION