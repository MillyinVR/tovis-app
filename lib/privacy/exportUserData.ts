// lib/privacy/exportUserData.ts

import { Prisma, type PrismaClient } from '@prisma/client'

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
    notificationDispatches: unknown[]
    notificationDeliveries: unknown[]
    attributionEvents: unknown[]
    tapIntents: unknown[]
    adminActionLogs: unknown[]
  }
  limitations: string[]
}

const EXPORT_VERSION = 1

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
    include: {
      clientProfile: true,
      professionalProfile: true,
    },
  })

  if (!user) {
    throw new Error(`Cannot export user data: user not found (${input.userId})`)
  }

  const clientProfileId = readId(user.clientProfile)
  const professionalProfileId = readId(user.professionalProfile)

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
    findMediaAssets(input.db, input.userId, clientProfileId, professionalProfileId),
    findMessages(input.db, input.userId, clientProfileId, professionalProfileId),
    findNotifications(input.db, input.userId, clientProfileId, professionalProfileId),
    findNotificationDispatches(input.db, input.userId, clientProfileId, professionalProfileId),
    findNotificationDeliveries(input.db, input.userId, clientProfileId, professionalProfileId),
    findAttributionEvents(input.db, input.userId, clientProfileId, professionalProfileId),
    findTapIntents(input.db, input.userId, clientProfileId, professionalProfileId),
    findAdminActionLogs(input.db, input.userId),
  ])

  return {
    exportedAt: new Date().toISOString(),
    subject: {
      userId: input.userId,
      clientProfileId,
      professionalProfileId,
    },
    data: {
      user: normalizeJson(user),
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
    'AftercareSummary export is temporarily omitted until wired through the real Booking/Aftercare relation.',
    'NotificationDelivery export is temporarily omitted until wired through the real dispatch/recipient relation.',
    'AttributionEvent export is temporarily omitted until wired through the real attribution identity fields.',
    'AdminActionLog export is temporarily omitted until wired through the real admin audit schema fields.',
    ],
  }
}

async function findClientAddresses(
  db: PrismaClient | Prisma.TransactionClient,
  clientProfileId: string | null,
): Promise<unknown[]> {
  if (!clientProfileId) return []

  return db.clientAddress.findMany({
    where: { clientId: clientProfileId },
    orderBy: { createdAt: 'asc' },
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
  })
}

async function findAftercareSummaries(
  _db: PrismaClient | Prisma.TransactionClient,
  _clientProfileId: string | null,
  _professionalProfileId: string | null,
): Promise<unknown[]> {
  // Schema note:
  // AftercareSummary is not directly keyed by clientId/professionalId in the
  // current Prisma client. Wire this through the real Booking/Aftercare relation
  // after inspecting schema.prisma instead of guessing relation names.
  return []
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
        { ownerUserId: userId },
        clientProfileId ? { clientId: clientProfileId } : null,
        professionalProfileId ? { professionalId: professionalProfileId } : null,
      ]),
    },
    orderBy: { createdAt: 'asc' },
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
        { recipientUserId: userId },
        clientProfileId ? { clientId: clientProfileId } : null,
        professionalProfileId ? { professionalId: professionalProfileId } : null,
      ]),
    },
    orderBy: { createdAt: 'asc' },
  })
}

async function findNotifications(
  db: PrismaClient | Prisma.TransactionClient,
  userId: string,
  clientProfileId: string | null,
  professionalProfileId: string | null,
): Promise<unknown[]> {
  return db.notification.findMany({
    where: {
      OR: compactWhere([
        { recipientUserId: userId },
        clientProfileId ? { clientId: clientProfileId } : null,
        professionalProfileId ? { professionalId: professionalProfileId } : null,
      ]),
    },
    orderBy: { createdAt: 'asc' },
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
        { recipientUserId: userId },
        clientProfileId ? { clientId: clientProfileId } : null,
        professionalProfileId ? { professionalId: professionalProfileId } : null,
      ]),
    },
    orderBy: { createdAt: 'asc' },
  })
}

async function findNotificationDeliveries(
  _db: PrismaClient | Prisma.TransactionClient,
  _userId: string,
  _clientProfileId: string | null,
  _professionalProfileId: string | null,
): Promise<unknown[]> {
  // Schema note:
  // NotificationDelivery is not directly keyed by recipientUserId/clientId/
  // professionalId in the current Prisma client. Wire this through the real
  // dispatch/recipient relation after inspecting schema.prisma.
  return []
}

async function findAttributionEvents(
  _db: PrismaClient | Prisma.TransactionClient,
  _userId: string,
  _clientProfileId: string | null,
  _professionalProfileId: string | null,
): Promise<unknown[]> {
  // Schema note:
  // AttributionEvent is not directly keyed by userId/clientId/professionalId in
  // the current Prisma client. Wire this through the real attribution identity
  // fields after inspecting schema.prisma.
  return []
}

async function findTapIntents(
  db: PrismaClient | Prisma.TransactionClient,
  userId: string,
  clientProfileId: string | null,
  professionalProfileId: string | null,
): Promise<unknown[]> {
  return db.tapIntent.findMany({
    where: {
      OR: compactWhere([
        { userId },
        clientProfileId ? { clientId: clientProfileId } : null,
        professionalProfileId ? { professionalId: professionalProfileId } : null,
      ]),
    },
    orderBy: { createdAt: 'asc' },
  })
}

async function findAdminActionLogs(
  _db: PrismaClient | Prisma.TransactionClient,
  _userId: string,
): Promise<unknown[]> {
  // Schema note:
  // AdminActionLog does not currently expose actorUserId/targetUserId in the
  // Prisma client. Wire this through the real admin audit fields after inspecting
  // schema.prisma.
  return []
}

function compactWhere<T>(items: Array<T | null>): T[] {
  return items.filter((item): item is T => item !== null)
}

function readId(value: unknown): string | null {
  if (!isRecord(value)) return null

  const id = value.id
  return typeof id === 'string' ? id : null
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export const USER_DATA_EXPORT_VERSION = EXPORT_VERSION