import { prisma } from '@/lib/prisma'
import {
  NotificationEventKey,
  NotificationRecipientKind,
  Prisma,
} from '@prisma/client'

import { enqueueDispatch } from './dispatch/enqueueDispatch'

export type ClientNotificationDbClient = Prisma.TransactionClient | typeof prisma

const MAX_ID = 64
const MAX_TITLE = 160
const MAX_BODY = 4000
const MAX_HREF = 2048
const MAX_DEDUPE_KEY = 256
const MAX_TIME_ZONE = 64

const clientNotificationIdSelect = {
  id: true,
} satisfies Prisma.ClientNotificationSelect

const scheduledClientNotificationIdSelect = {
  id: true,
} satisfies Prisma.ScheduledClientNotificationSelect

const clientDispatchRecipientSelect = {
  id: true,
  userId: true,
  phone: true,
  phoneVerifiedAt: true,
  user: {
    select: {
      email: true,
      emailVerifiedAt: true,
      phone: true,
      phoneVerifiedAt: true,
    },
  },
} satisfies Prisma.ClientProfileSelect

const clientNotificationPreferenceSelect = {
  inAppEnabled: true,
  smsEnabled: true,
  emailEnabled: true,
  quietHoursStartMinutes: true,
  quietHoursEndMinutes: true,
} satisfies Prisma.ClientNotificationPreferenceSelect

const clientDispatchBookingTimeZoneSelect = {
  locationTimeZone: true,
  clientTimeZoneAtBooking: true,
} satisfies Prisma.BookingSelect

const clientDispatchAftercareTimeZoneSelect = {
  booking: {
    select: {
      locationTimeZone: true,
      clientTimeZoneAtBooking: true,
    },
  },
} satisfies Prisma.AftercareSummarySelect

export type CreateClientNotificationArgs = {
  clientId: string
  eventKey: NotificationEventKey
  title: string
  body?: string | null
  href?: string | null
  data?: Prisma.InputJsonValue | null
  dedupeKey?: string | null

  bookingId?: string | null
  aftercareId?: string | null

  tx?: Prisma.TransactionClient
}

export type UpsertClientNotificationArgs = Omit<
  CreateClientNotificationArgs,
  'dedupeKey'
> & {
  dedupeKey: string
}

export type ScheduleClientNotificationArgs = {
  clientId: string
  eventKey: NotificationEventKey
  runAt: Date
  href?: string | null
  data?: Prisma.InputJsonValue | null
  dedupeKey?: string | null

  bookingId?: string | null

  tx?: Prisma.TransactionClient
}

export type CancelScheduledClientNotificationsForBookingArgs = {
  bookingId: string
  clientId?: string | null
  eventKeys?: NotificationEventKey[]
  onlyPending?: boolean
  tx?: Prisma.TransactionClient
}

export type MarkClientNotificationsReadArgs = {
  clientId: string
  ids?: string[]
  before?: Date
  eventKeys?: NotificationEventKey[]
  tx?: Prisma.TransactionClient
}

export type GetUnreadClientNotificationCountArgs = {
  clientId: string
  eventKeys?: NotificationEventKey[]
  tx?: Prisma.TransactionClient
}

type DbClient = Prisma.TransactionClient | typeof prisma

type NormalizedCreateClientNotificationArgs = ReturnType<
  typeof normalizeCreateClientNotificationArgs
>

type ClientDispatchRecipientRow = Prisma.ClientProfileGetPayload<{
  select: typeof clientDispatchRecipientSelect
}>

type ClientNotificationPreferenceRow =
  Prisma.ClientNotificationPreferenceGetPayload<{
    select: typeof clientNotificationPreferenceSelect
  }>

function getDb(tx?: Prisma.TransactionClient): DbClient {
  return tx ?? prisma
}

function normRequired(value: unknown, max: number): string {
  const s = typeof value === 'string' ? value.trim() : ''
  return s.slice(0, max)
}

function normDefaultString(value: unknown, max: number): string {
  const s = typeof value === 'string' ? value.trim() : ''
  return s.slice(0, max)
}

function normNullableString(value: unknown, max: number): string | null {
  const s = typeof value === 'string' ? value.trim() : ''
  const clipped = s.slice(0, max)
  return clipped.length > 0 ? clipped : null
}

function normId(value: unknown): string | null {
  return normNullableString(value, MAX_ID)
}

/**
 * Only allow internal app paths.
 * This keeps notification href values as safe deep links.
 */
function normInternalHref(value: unknown, max: number): string {
  const s = typeof value === 'string' ? value.trim().slice(0, max) : ''
  if (!s) return ''
  if (!s.startsWith('/')) return ''
  if (s.startsWith('//')) return ''
  return s
}

function normStringArray(
  values: unknown,
  maxItems: number,
  maxLen: number,
): string[] {
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

function isUniqueConstraintError(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002'
  )
}

function canFastPathClientNotificationDedupe(db: DbClient): boolean {
  return (
    typeof db.clientNotification.updateMany === 'function' &&
    typeof db.clientNotification.findFirst === 'function'
  )
}

function canFastPathScheduledClientNotificationDedupe(db: DbClient): boolean {
  return (
    typeof db.scheduledClientNotification.updateMany === 'function' &&
    typeof db.scheduledClientNotification.findFirst === 'function'
  )
}

function normalizeCreateClientNotificationArgs(
  args: CreateClientNotificationArgs,
) {
  const clientId = normRequired(args.clientId, MAX_ID)
  const title = normRequired(args.title, MAX_TITLE)

  if (!clientId) {
    throw new Error('createClientNotification: missing clientId')
  }

  if (!title) {
    throw new Error('createClientNotification: missing title')
  }

  return {
    clientId,
    eventKey: args.eventKey,
    title,
    body: normDefaultString(args.body, MAX_BODY),
    href: normInternalHref(args.href, MAX_HREF),
    data: args.data,
    dedupeKey: normNullableString(args.dedupeKey, MAX_DEDUPE_KEY),
    bookingId: normId(args.bookingId),
    aftercareId: normId(args.aftercareId),
  }
}

function buildClientNotificationCreateData(
  normalized: NormalizedCreateClientNotificationArgs,
): Prisma.ClientNotificationUncheckedCreateInput {
  const data = normalizeJsonField(normalized.data)

  return {
    clientId: normalized.clientId,
    eventKey: normalized.eventKey,
    title: normalized.title,
    body: normalized.body,
    href: normalized.href,
    bookingId: normalized.bookingId,
    aftercareId: normalized.aftercareId,
    dedupeKey: normalized.dedupeKey,
    readAt: null,
    ...(data !== undefined ? { data } : {}),
  }
}

function buildClientNotificationUpdateData(
  normalized: NormalizedCreateClientNotificationArgs,
): Prisma.ClientNotificationUncheckedUpdateManyInput {
  const data = normalizeJsonField(normalized.data)

  const update: Prisma.ClientNotificationUncheckedUpdateManyInput = {
    eventKey: normalized.eventKey,
    title: normalized.title,
    body: normalized.body,
    href: normalized.href,
    bookingId: normalized.bookingId,
    aftercareId: normalized.aftercareId,
    dedupeKey: normalized.dedupeKey,
    readAt: null,
  }

  if (data !== undefined) {
    update.data = data
  }

  return update
}

async function findClientNotificationIdByDedupe(args: {
  clientId: string
  dedupeKey: string
  tx?: Prisma.TransactionClient
}) {
  const db = getDb(args.tx)

  const found = await db.clientNotification.findFirst({
    where: {
      clientId: args.clientId,
      dedupeKey: args.dedupeKey,
    },
    select: clientNotificationIdSelect,
  })

  if (!found) {
    throw new Error(
      'createClientNotification: notification not found after dedupe update/create',
    )
  }

  return found
}

async function getClientDispatchRecipient(args: {
  clientId: string
  eventKey: NotificationEventKey
  tx?: Prisma.TransactionClient
}): Promise<{
  client: ClientDispatchRecipientRow
  preference: ClientNotificationPreferenceRow | null
}> {
  const db = getDb(args.tx)

  const [client, preference] = await Promise.all([
    db.clientProfile.findUnique({
      where: {
        id: args.clientId,
      },
      select: clientDispatchRecipientSelect,
    }),
    db.clientNotificationPreference.findUnique({
      where: {
        clientId_eventKey: {
          clientId: args.clientId,
          eventKey: args.eventKey,
        },
      },
      select: clientNotificationPreferenceSelect,
    }),
  ])

  if (!client) {
    throw new Error('createClientNotification: client not found for dispatch enqueue')
  }

  return {
    client,
    preference,
  }
}

function resolvePreferredClientPhone(
  client: ClientDispatchRecipientRow,
): {
  phone: string | null
  phoneVerifiedAt: Date | null
} {
  const profilePhone = normNullableString(client.phone, 64)
  if (profilePhone) {
    return {
      phone: profilePhone,
      phoneVerifiedAt: client.phoneVerifiedAt ?? null,
    }
  }

  const userPhone = normNullableString(client.user.phone, 64)
  return {
    phone: userPhone,
    phoneVerifiedAt: client.user.phoneVerifiedAt ?? null,
  }
}

function pickClientDispatchTimeZone(args: {
  clientTimeZoneAtBooking: string | null | undefined
  locationTimeZone: string | null | undefined
}): string | null {
  const clientTimeZoneAtBooking = normNullableString(
    args.clientTimeZoneAtBooking,
    MAX_TIME_ZONE,
  )

  if (clientTimeZoneAtBooking) {
    return clientTimeZoneAtBooking
  }

  return normNullableString(args.locationTimeZone, MAX_TIME_ZONE)
}

async function resolveClientDispatchTimeZone(args: {
  bookingId: string | null
  aftercareId: string | null
  tx?: Prisma.TransactionClient
}): Promise<string | null> {
  const db = getDb(args.tx)

  if (args.bookingId) {
    const booking = await db.booking.findUnique({
      where: {
        id: args.bookingId,
      },
      select: clientDispatchBookingTimeZoneSelect,
    })

    if (booking) {
      return pickClientDispatchTimeZone({
        clientTimeZoneAtBooking: booking.clientTimeZoneAtBooking,
        locationTimeZone: booking.locationTimeZone,
      })
    }
  }

  if (args.aftercareId) {
    const aftercare = await db.aftercareSummary.findUnique({
      where: {
        id: args.aftercareId,
      },
      select: clientDispatchAftercareTimeZoneSelect,
    })

    if (aftercare?.booking) {
      return pickClientDispatchTimeZone({
        clientTimeZoneAtBooking: aftercare.booking.clientTimeZoneAtBooking,
        locationTimeZone: aftercare.booking.locationTimeZone,
      })
    }
  }

  return null
}

async function enqueueClientNotificationDispatch(args: {
  notificationId: string
  normalized: NormalizedCreateClientNotificationArgs
  tx?: Prisma.TransactionClient
}): Promise<void> {
  const recipient = await getClientDispatchRecipient({
    clientId: args.normalized.clientId,
    eventKey: args.normalized.eventKey,
    tx: args.tx,
  })

  const preferredPhone = resolvePreferredClientPhone(recipient.client)

  const timeZone = await resolveClientDispatchTimeZone({
    bookingId: args.normalized.bookingId,
    aftercareId: args.normalized.aftercareId,
    tx: args.tx,
  })

  await enqueueDispatch({
    key: args.normalized.eventKey,
    sourceKey: `client-notification:${args.notificationId}`,
    recipient: {
      kind: NotificationRecipientKind.CLIENT,
      clientId: recipient.client.id,
      userId: recipient.client.userId,
      inAppTargetId: recipient.client.id,
      phone: preferredPhone.phone,
      phoneVerifiedAt: preferredPhone.phoneVerifiedAt,
      email: recipient.client.user.email,
      emailVerifiedAt: recipient.client.user.emailVerifiedAt,
      timeZone,
      preference: recipient.preference,
    },
    title: args.normalized.title,
    body: args.normalized.body,
    href: args.normalized.href,
    payload: args.normalized.data,
    clientNotificationId: args.notificationId,
    tx: args.tx,
  })
}

/**
 * Creates a client notification.
 *
 * Contract:
 * - If dedupeKey is provided: behaves like an idempotent upsert and resets readAt to null
 * - If no dedupeKey: always creates a new notification
 *
 * Notes:
 * - In production we prefer update-first for deduped rows.
 * - In some narrow unit-test transaction mocks, updateMany/findFirst may not exist.
 *   In that case we skip the fast path and fall back to create-only behavior.
 */
export async function createClientNotification(
  args: CreateClientNotificationArgs,
) {
  const db = getDb(args.tx)
  const normalized = normalizeCreateClientNotificationArgs(args)

  if (!normalized.dedupeKey) {
    const created = await db.clientNotification.create({
      data: buildClientNotificationCreateData({
        ...normalized,
        dedupeKey: null,
      }),
      select: clientNotificationIdSelect,
    })

    await enqueueClientNotificationDispatch({
      notificationId: created.id,
      normalized,
      tx: args.tx,
    })

    return created
  }

  const canFastPath = canFastPathClientNotificationDedupe(db)

  if (canFastPath) {
    const updated = await db.clientNotification.updateMany({
      where: {
        clientId: normalized.clientId,
        dedupeKey: normalized.dedupeKey,
      },
      data: buildClientNotificationUpdateData(normalized),
    })

    if (updated.count > 0) {
      const found = await findClientNotificationIdByDedupe({
        clientId: normalized.clientId,
        dedupeKey: normalized.dedupeKey,
        tx: args.tx,
      })

      await enqueueClientNotificationDispatch({
        notificationId: found.id,
        normalized,
        tx: args.tx,
      })

      return found
    }
  }

  try {
    const created = await db.clientNotification.create({
      data: buildClientNotificationCreateData(normalized),
      select: clientNotificationIdSelect,
    })

    await enqueueClientNotificationDispatch({
      notificationId: created.id,
      normalized,
      tx: args.tx,
    })

    return created
  } catch (error) {
    if (!isUniqueConstraintError(error)) {
      throw error
    }

    if (!canFastPath) {
      throw error
    }

    await db.clientNotification.updateMany({
      where: {
        clientId: normalized.clientId,
        dedupeKey: normalized.dedupeKey,
      },
      data: buildClientNotificationUpdateData(normalized),
    })

    const found = await findClientNotificationIdByDedupe({
      clientId: normalized.clientId,
      dedupeKey: normalized.dedupeKey,
      tx: args.tx,
    })

    await enqueueClientNotificationDispatch({
      notificationId: found.id,
      normalized,
      tx: args.tx,
    })

    return found
  }
}

/**
 * Same behavior as createClientNotification, but forces callers
 * to provide a dedupeKey explicitly.
 */
export async function upsertClientNotification(
  args: UpsertClientNotificationArgs,
) {
  const dedupeKey = normRequired(args.dedupeKey, MAX_DEDUPE_KEY)
  if (!dedupeKey) {
    throw new Error('upsertClientNotification: missing dedupeKey')
  }

  return createClientNotification({
    ...args,
    dedupeKey,
  })
}

/**
 * Schedules a future client notification inbox row.
 *
 * Important:
 * - This only writes the scheduled row.
 * - It does NOT enqueue delivery yet.
 * - Multi-channel dispatch should happen when the scheduled row is actually processed.
 */
export async function scheduleClientNotification(
  args: ScheduleClientNotificationArgs,
) {
  const db = getDb(args.tx)

  const clientId = normRequired(args.clientId, MAX_ID)
  const href = normInternalHref(args.href, MAX_HREF)
  const dedupeKey = normNullableString(args.dedupeKey, MAX_DEDUPE_KEY)
  const bookingId = normId(args.bookingId)
  const runAt = normalizeDate(args.runAt, 'runAt')
  const data = normalizeJsonField(args.data)

  if (!clientId) {
    throw new Error('scheduleClientNotification: missing clientId')
  }

  const baseWrite = {
    eventKey: args.eventKey,
    runAt,
    href,
    bookingId,
    processedAt: null,
    cancelledAt: null,
    failedAt: null,
    lastError: null,
    ...(data !== undefined ? { data } : {}),
  }

  if (!dedupeKey) {
    return db.scheduledClientNotification.create({
      data: {
        clientId,
        dedupeKey: null,
        ...baseWrite,
      },
      select: scheduledClientNotificationIdSelect,
    })
  }

  const canFastPath = canFastPathScheduledClientNotificationDedupe(db)

  if (canFastPath) {
    const updated = await db.scheduledClientNotification.updateMany({
      where: {
        clientId,
        dedupeKey,
      },
      data: baseWrite,
    })

    if (updated.count > 0) {
      const found = await db.scheduledClientNotification.findFirst({
        where: {
          clientId,
          dedupeKey,
        },
        select: scheduledClientNotificationIdSelect,
      })

      if (!found) {
        throw new Error(
          'scheduleClientNotification: scheduled notification not found after update',
        )
      }

      return found
    }
  }

  try {
    return await db.scheduledClientNotification.create({
      data: {
        clientId,
        dedupeKey,
        ...baseWrite,
      },
      select: scheduledClientNotificationIdSelect,
    })
  } catch (error) {
    if (!isUniqueConstraintError(error)) {
      throw error
    }

    if (!canFastPath) {
      throw error
    }

    await db.scheduledClientNotification.updateMany({
      where: {
        clientId,
        dedupeKey,
      },
      data: baseWrite,
    })

    const found = await db.scheduledClientNotification.findFirst({
      where: {
        clientId,
        dedupeKey,
      },
      select: scheduledClientNotificationIdSelect,
    })

    if (!found) {
      throw new Error(
        'scheduleClientNotification: scheduled notification not found after race retry',
      )
    }

    return found
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

  const bookingId = normRequired(args.bookingId, MAX_ID)
  if (!bookingId) {
    throw new Error('cancelScheduledClientNotificationsForBooking: missing bookingId')
  }

  const clientId = normId(args.clientId)
  const eventKeys =
    Array.isArray(args.eventKeys) && args.eventKeys.length > 0
      ? args.eventKeys
      : undefined
  const onlyPending = args.onlyPending ?? true

  return db.scheduledClientNotification.updateMany({
    where: {
      bookingId,
      ...(clientId ? { clientId } : {}),
      ...(eventKeys ? { eventKey: { in: eventKeys } } : {}),
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
export async function markClientNotificationsRead(
  args: MarkClientNotificationsReadArgs,
) {
  const db = getDb(args.tx)

  const clientId = normRequired(args.clientId, MAX_ID)
  if (!clientId) {
    throw new Error('markClientNotificationsRead: missing clientId')
  }

  const idsProvided = Array.isArray(args.ids)
  const ids = normStringArray(args.ids, 1000, MAX_ID)
  const before =
    args.before instanceof Date && !Number.isNaN(args.before.getTime())
      ? args.before
      : undefined
  const eventKeys =
    Array.isArray(args.eventKeys) && args.eventKeys.length > 0
      ? args.eventKeys
      : undefined

  if (idsProvided && ids.length === 0) {
    return { count: 0 }
  }

  return db.clientNotification.updateMany({
    where: {
      clientId,
      readAt: null,
      ...(ids.length > 0 ? { id: { in: ids } } : {}),
      ...(before ? { createdAt: { lte: before } } : {}),
      ...(eventKeys ? { eventKey: { in: eventKeys } } : {}),
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

  const clientId = normRequired(args.clientId, MAX_ID)
  if (!clientId) {
    throw new Error('getUnreadClientNotificationCount: missing clientId')
  }

  const eventKeys =
    Array.isArray(args.eventKeys) && args.eventKeys.length > 0
      ? args.eventKeys
      : undefined

  return db.clientNotification.count({
    where: {
      clientId,
      readAt: null,
      ...(eventKeys ? { eventKey: { in: eventKeys } } : {}),
    },
  })
}