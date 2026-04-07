// lib/notifications/proNotifications.ts
import { prisma } from '@/lib/prisma'
import { NotificationPriority, Prisma } from '@prisma/client'
import type { NotificationType, ProNotificationReason } from '@prisma/client'

const MAX_ID = 64
const MAX_TITLE = 160
const MAX_BODY = 4000
const MAX_HREF = 2048
const MAX_DEDUPE_KEY = 256

const notificationIdSelect = {
  id: true,
} satisfies Prisma.NotificationSelect

export type CreateProNotificationArgs = {
  professionalId: string
  type: NotificationType
  reason: ProNotificationReason
  priority?: NotificationPriority | null

  title: string
  body?: string | null
  href?: string | null
  data?: Prisma.InputJsonValue

  dedupeKey?: string | null

  actorUserId?: string | null
  bookingId?: string | null
  reviewId?: string | null

  /**
   * Optional transaction client so callers can create notifications
   * inside an existing prisma.$transaction(...) block.
   */
  tx?: Prisma.TransactionClient
}

export type ProNotificationCreateResult = {
  id: string
}

function normRequiredString(value: unknown, max: number): string {
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

/**
 * Only allow internal app paths.
 * This prevents accidentally storing external or protocol-relative links
 * in notification href values.
 */
function normInternalHref(value: unknown, max: number): string {
  const s = typeof value === 'string' ? value.trim().slice(0, max) : ''
  if (!s) return ''
  if (!s.startsWith('/')) return ''
  if (s.startsWith('//')) return ''
  return s
}

function isUniqueConstraintError(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002'
}

/**
 * Optional realtime publish hook.
 * Safe default: no-op until you wire Ably / Pusher / Redis / SSE.
 */
async function publishProNotificationEvent(args: {
  professionalId: string
  notificationId: string
}): Promise<void> {
  void args
  return
}

function getDb(tx?: Prisma.TransactionClient) {
  return tx ?? prisma
}

function buildUpdateData(
  normalized: ReturnType<typeof normalizeCreateArgs>,
): Prisma.NotificationUncheckedUpdateManyInput {
  const data: Prisma.NotificationUncheckedUpdateManyInput = {
    type: normalized.type,
    reason: normalized.reason,
    priority: normalized.priority,
    title: normalized.title,
    body: normalized.body,
    href: normalized.href,
    dedupeKey: normalized.dedupeKey,
    actorUserId: normalized.actorUserId,
    bookingId: normalized.bookingId,
    reviewId: normalized.reviewId,

    // Resurface deduped items as active/unread again.
    seenAt: null,
    readAt: null,
    clickedAt: null,
    archivedAt: null,
  }

  if (normalized.data !== undefined) {
    data.data = normalized.data
  }

  return data
}

function buildCreateData(
  normalized: ReturnType<typeof normalizeCreateArgs>,
): Prisma.NotificationUncheckedCreateInput {
  return {
    professionalId: normalized.professionalId,
    type: normalized.type,
    reason: normalized.reason,
    priority: normalized.priority,
    title: normalized.title,
    body: normalized.body,
    href: normalized.href,
    dedupeKey: normalized.dedupeKey,
    actorUserId: normalized.actorUserId,
    bookingId: normalized.bookingId,
    reviewId: normalized.reviewId,

    seenAt: null,
    readAt: null,
    clickedAt: null,
    archivedAt: null,

    ...(normalized.data !== undefined ? { data: normalized.data } : {}),
  }
}

function normalizeCreateArgs(args: CreateProNotificationArgs) {
  const professionalId = normRequiredString(args.professionalId, MAX_ID)
  const title = normRequiredString(args.title, MAX_TITLE)

  if (!professionalId) {
    throw new Error('createProNotification: missing professionalId')
  }

  if (!title) {
    throw new Error('createProNotification: missing title')
  }

  return {
    professionalId,
    type: args.type,
    reason: args.reason,
    priority: args.priority ?? NotificationPriority.NORMAL,

    title,
    body: normDefaultString(args.body, MAX_BODY),
    href: normInternalHref(args.href, MAX_HREF),
    data: args.data,

    dedupeKey: normNullableString(args.dedupeKey, MAX_DEDUPE_KEY),

    actorUserId: normNullableString(args.actorUserId, MAX_ID),
    bookingId: normNullableString(args.bookingId, MAX_ID),
    reviewId: normNullableString(args.reviewId, MAX_ID),
  }
}

async function findNotificationIdByDedupe(args: {
  professionalId: string
  dedupeKey: string
  tx?: Prisma.TransactionClient
}): Promise<ProNotificationCreateResult> {
  const db = getDb(args.tx)

  const found = await db.notification.findFirst({
    where: {
      professionalId: args.professionalId,
      dedupeKey: args.dedupeKey,
    },
    select: notificationIdSelect,
  })

  if (!found) {
    throw new Error('createProNotification: notification not found after dedupe update/create')
  }

  return found
}

/**
 * Idempotent pro notification creation.
 *
 * Contract:
 * - If dedupeKey is present: behaves like upsert and resets unread state.
 * - If dedupeKey is absent: always creates a new row.
 *
 * Dedupe is scoped to:
 *   @@unique([professionalId, dedupeKey])
 */
export async function createProNotification(
  args: CreateProNotificationArgs,
): Promise<ProNotificationCreateResult> {
  const db = getDb(args.tx)
  const normalized = normalizeCreateArgs(args)

  // No dedupe key = always create a new row.
  if (!normalized.dedupeKey) {
    const created = await db.notification.create({
      data: {
        ...buildCreateData({
          ...normalized,
          dedupeKey: null,
        }),
      },
      select: notificationIdSelect,
    })

    await publishProNotificationEvent({
      professionalId: normalized.professionalId,
      notificationId: created.id,
    })

    return created
  }

  // Fast path: update existing deduped row first.
  const updated = await db.notification.updateMany({
    where: {
      professionalId: normalized.professionalId,
      dedupeKey: normalized.dedupeKey,
    },
    data: buildUpdateData(normalized),
  })

  if (updated.count > 0) {
    const found = await findNotificationIdByDedupe({
      professionalId: normalized.professionalId,
      dedupeKey: normalized.dedupeKey,
      tx: args.tx,
    })

    await publishProNotificationEvent({
      professionalId: normalized.professionalId,
      notificationId: found.id,
    })

    return found
  }

  // No existing row: create one.
  try {
    const created = await db.notification.create({
      data: buildCreateData(normalized),
      select: notificationIdSelect,
    })

    await publishProNotificationEvent({
      professionalId: normalized.professionalId,
      notificationId: created.id,
    })

    return created
  } catch (error) {
    // Race condition: another request created the same deduped row first.
    if (!isUniqueConstraintError(error)) {
      throw error
    }

    await db.notification.updateMany({
      where: {
        professionalId: normalized.professionalId,
        dedupeKey: normalized.dedupeKey,
      },
      data: buildUpdateData(normalized),
    })

    const found = await findNotificationIdByDedupe({
      professionalId: normalized.professionalId,
      dedupeKey: normalized.dedupeKey,
      tx: args.tx,
    })

    await publishProNotificationEvent({
      professionalId: normalized.professionalId,
      notificationId: found.id,
    })

    return found
  }
}