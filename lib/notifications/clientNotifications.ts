// lib/notifications/clientNotifications.ts
import { prisma } from '@/lib/prisma'
import { Prisma, type ClientNotificationType } from '@prisma/client'

export type ClientNotificationDbClient = Prisma.TransactionClient | typeof prisma

type CreateClientNotificationArgs = {
  clientId: string
  type: ClientNotificationType
  title: string
  body?: string | null
  href?: string | null
  data?: Prisma.InputJsonValue | null
  dedupeKey?: string | null

  bookingId?: string | null
  aftercareId?: string | null

  tx?: Prisma.TransactionClient
}

type UpsertClientNotificationArgs = Omit<CreateClientNotificationArgs, 'dedupeKey'> & {
  dedupeKey: string
}

type ScheduleClientNotificationArgs = {
  clientId: string
  type: ClientNotificationType
  runAt: Date
  href?: string | null
  data?: Prisma.InputJsonValue | null
  dedupeKey?: string | null

  bookingId?: string | null

  tx?: Prisma.TransactionClient
}

type CancelScheduledClientNotificationsForBookingArgs = {
  bookingId: string
  clientId?: string | null
  types?: ClientNotificationType[]
  onlyPending?: boolean
  tx?: Prisma.TransactionClient
}

type MarkClientNotificationsReadArgs = {
  clientId: string
  ids?: string[]
  before?: Date
  types?: ClientNotificationType[]
  tx?: Prisma.TransactionClient
}

type GetUnreadClientNotificationCountArgs = {
  clientId: string
  types?: ClientNotificationType[]
  tx?: Prisma.TransactionClient
}

function getDb(tx?: Prisma.TransactionClient): ClientNotificationDbClient {
  return tx ?? prisma
}

function normRequired(v: unknown, max: number): string {
  const s = typeof v === 'string' ? v.trim() : ''
  return s.slice(0, max)
}

function normDefaultString(v: unknown, max: number): string {
  const s = typeof v === 'string' ? v.trim() : ''
  return s.slice(0, max)
}

function normNullableString(v: unknown, max: number): string | null {
  const s = typeof v === 'string' ? v.trim() : ''
  const clipped = s.slice(0, max)
  return clipped ? clipped : null
}

function normId(v: unknown): string | null {
  return normNullableString(v, 64)
}

function normStringArray(values: unknown, maxItems: number, maxLen: number): string[] {
  if (!Array.isArray(values)) return []

  return values
    .map((value) => normNullableString(value, maxLen))
    .filter((value): value is string => Boolean(value))
    .slice(0, maxItems)
}

function normalizeJsonField(value: Prisma.InputJsonValue | null | undefined) {
  if (value === undefined) return undefined
  return value === null ? Prisma.JsonNull : value
}

function normalizeDate(value: unknown, fieldName: string): Date {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    throw new Error(`clientNotifications: invalid ${fieldName}`)
  }
  return value
}

/**
 * Optional realtime publish hook.
 * Safe default for now: no-op.
 *
 * Later:
 * - websocket / SSE
 * - Ably / Pusher
 * - invalidation event bus
 */
async function publishClientNotificationEvent(_args: {
  clientId: string
  notificationId: string
}) {
  return
}

/**
 * Creates a client notification.
 *
 * Contract:
 * - If dedupeKey is provided: behaves like an idempotent upsert and resets readAt to null
 * - If no dedupeKey: always creates a new notification
 */
export async function createClientNotification(args: CreateClientNotificationArgs) {
  const db = getDb(args.tx)

  const clientId = normRequired(args.clientId, 64)
  const title = normRequired(args.title, 160)
  const body = normDefaultString(args.body, 4000)
  const href = normDefaultString(args.href, 2048)
  const dedupeKey = normNullableString(args.dedupeKey, 256)

  if (!clientId) throw new Error('createClientNotification: missing clientId')
  if (!title) throw new Error('createClientNotification: missing title')

  const bookingId = normId(args.bookingId)
  const aftercareId = normId(args.aftercareId)
  const data = normalizeJsonField(args.data)

  const baseWrite = {
    type: args.type,
    title,
    body,
    href,
    bookingId,
    aftercareId,
    readAt: null as Date | null,
    ...(data !== undefined ? { data } : {}),
  }

  // No dedupe: always create a new row
  if (!dedupeKey) {
    const created = await db.clientNotification.create({
      data: {
        clientId,
        dedupeKey: null,
        ...baseWrite,
      },
      select: { id: true },
    })

    await publishClientNotificationEvent({
      clientId,
      notificationId: created.id,
    })

    return created
  }

  // Update-first (fast path)
  const updated = await db.clientNotification.updateMany({
    where: { clientId, dedupeKey },
    data: {
      ...baseWrite,
    },
  })

  if (updated.count > 0) {
    const found = await db.clientNotification.findFirst({
      where: { clientId, dedupeKey },
      select: { id: true },
    })

    if (found?.id) {
      await publishClientNotificationEvent({
        clientId,
        notificationId: found.id,
      })
    }

    return found
  }

  // Create; if a race happens, unique constraint will throw — retry update
  try {
    const created = await db.clientNotification.create({
      data: {
        clientId,
        dedupeKey,
        ...baseWrite,
      },
      select: { id: true },
    })

    await publishClientNotificationEvent({
      clientId,
      notificationId: created.id,
    })

    return created
  } catch {
    await db.clientNotification.updateMany({
      where: { clientId, dedupeKey },
      data: {
        ...baseWrite,
      },
    })

    const found = await db.clientNotification.findFirst({
      where: { clientId, dedupeKey },
      select: { id: true },
    })

    if (found?.id) {
      await publishClientNotificationEvent({
        clientId,
        notificationId: found.id,
      })
    }

    return found
  }
}

/**
 * Same behavior as createClientNotification, but forces callers
 * to provide a dedupeKey explicitly.
 */
export async function upsertClientNotification(args: UpsertClientNotificationArgs) {
  const dedupeKey = normRequired(args.dedupeKey, 256)
  if (!dedupeKey) {
    throw new Error('upsertClientNotification: missing dedupeKey')
  }

  return createClientNotification({
    ...args,
    dedupeKey,
  })
}

/**
 * Schedules a future client notification.
 *
 * Contract:
 * - If dedupeKey is provided: behaves like an idempotent upsert
 * - If no dedupeKey: always creates a new scheduled row
 * - Scheduling again with the same dedupeKey re-arms the row
 */
export async function scheduleClientNotification(args: ScheduleClientNotificationArgs) {
  const db = getDb(args.tx)

  const clientId = normRequired(args.clientId, 64)
  const href = normDefaultString(args.href, 2048)
  const dedupeKey = normNullableString(args.dedupeKey, 256)
  const bookingId = normId(args.bookingId)
  const runAt = normalizeDate(args.runAt, 'runAt')
  const data = normalizeJsonField(args.data)

  if (!clientId) throw new Error('scheduleClientNotification: missing clientId')

  const baseWrite = {
    type: args.type,
    runAt,
    href,
    bookingId,
    processedAt: null as Date | null,
    cancelledAt: null as Date | null,
    failedAt: null as Date | null,
    lastError: null as string | null,
    ...(data !== undefined ? { data } : {}),
  }

  if (!dedupeKey) {
    return db.scheduledClientNotification.create({
      data: {
        clientId,
        dedupeKey: null,
        ...baseWrite,
      },
      select: { id: true },
    })
  }

  const updated = await db.scheduledClientNotification.updateMany({
    where: { clientId, dedupeKey },
    data: {
      ...baseWrite,
    },
  })

  if (updated.count > 0) {
    return db.scheduledClientNotification.findFirst({
      where: { clientId, dedupeKey },
      select: { id: true },
    })
  }

  try {
    return await db.scheduledClientNotification.create({
      data: {
        clientId,
        dedupeKey,
        ...baseWrite,
      },
      select: { id: true },
    })
  } catch {
    await db.scheduledClientNotification.updateMany({
      where: { clientId, dedupeKey },
      data: {
        ...baseWrite,
      },
    })

    return db.scheduledClientNotification.findFirst({
      where: { clientId, dedupeKey },
      select: { id: true },
    })
  }
}

/**
 * Cancels scheduled notifications tied to a booking.
 *
 * Default behavior:
 * - only cancels rows that have not been processed yet
 */
export async function cancelScheduledClientNotificationsForBooking(
  args: CancelScheduledClientNotificationsForBookingArgs,
) {
  const db = getDb(args.tx)

  const bookingId = normRequired(args.bookingId, 64)
  if (!bookingId) {
    throw new Error('cancelScheduledClientNotificationsForBooking: missing bookingId')
  }

  const clientId = normId(args.clientId)
  const types = Array.isArray(args.types) && args.types.length > 0 ? args.types : undefined
  const onlyPending = args.onlyPending ?? true

  return db.scheduledClientNotification.updateMany({
    where: {
      bookingId,
      ...(clientId ? { clientId } : {}),
      ...(types ? { type: { in: types } } : {}),
      cancelledAt: null,
      ...(onlyPending ? { processedAt: null } : {}),
    },
    data: {
      cancelledAt: new Date(),
      failedAt: null,
      lastError: null,
    },
  })
}

/**
 * Marks one or more client notifications as read.
 *
 * Safety behavior:
 * - if ids is provided but sanitizes to an empty list, this becomes a no-op
 * - if ids is omitted, it marks the matching unread notifications read
 */
export async function markClientNotificationsRead(args: MarkClientNotificationsReadArgs) {
  const db = getDb(args.tx)

  const clientId = normRequired(args.clientId, 64)
  if (!clientId) {
    throw new Error('markClientNotificationsRead: missing clientId')
  }

  const idsProvided = Array.isArray(args.ids)
  const ids = normStringArray(args.ids, 1000, 64)
  const before =
    args.before instanceof Date && !Number.isNaN(args.before.getTime()) ? args.before : undefined
  const types = Array.isArray(args.types) && args.types.length > 0 ? args.types : undefined

  if (idsProvided && ids.length === 0) {
    return { count: 0 }
  }

  return db.clientNotification.updateMany({
    where: {
      clientId,
      readAt: null,
      ...(ids.length > 0 ? { id: { in: ids } } : {}),
      ...(before ? { createdAt: { lte: before } } : {}),
      ...(types ? { type: { in: types } } : {}),
    },
    data: {
      readAt: new Date(),
    },
  })
}

export async function getUnreadClientNotificationCount(
  args: GetUnreadClientNotificationCountArgs,
) {
  const db = getDb(args.tx)

  const clientId = normRequired(args.clientId, 64)
  if (!clientId) {
    throw new Error('getUnreadClientNotificationCount: missing clientId')
  }

  const types = Array.isArray(args.types) && args.types.length > 0 ? args.types : undefined

  return db.clientNotification.count({
    where: {
      clientId,
      readAt: null,
      ...(types ? { type: { in: types } } : {}),
    },
  })
}