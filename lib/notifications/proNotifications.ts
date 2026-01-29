// lib/notifications/proNotifications.ts
import { prisma } from '@/lib/prisma'
import type { NotificationType } from '@prisma/client'

type CreateProNotificationArgs = {
  professionalId: string
  type: NotificationType
  title: string
  body?: string | null
  href?: string | null
  dedupeKey?: string | null

  actorUserId?: string | null
  bookingId?: string | null
  reviewId?: string | null
}

function normRequired(v: unknown, max: number) {
  const s = typeof v === 'string' ? v.trim() : ''
  return s.slice(0, max)
}

/**
 * For non-nullable prisma string fields with @default(""):
 * - always return a string (possibly empty)
 */
function normDefaultString(v: unknown, max: number) {
  const s = typeof v === 'string' ? v.trim() : ''
  return s.slice(0, max)
}

/**
 * For nullable fields (like dedupeKey String?):
 * - return trimmed string or null
 */
function normNullableString(v: unknown, max: number) {
  const s = typeof v === 'string' ? v.trim() : ''
  const clipped = s.slice(0, max)
  return clipped ? clipped : null
}

/**
 * Optional realtime publish hook.
 * Safe on Vercel: if not configured, it no-ops.
 *
 * Later you can swap this to Ably/Pusher/Redis gateway without touching callers.
 */
async function publishProNotificationEvent(_args: { professionalId: string; notificationId: string }) {
  // Intentionally a no-op unless you wire Ably/Pusher.
  // Example later:
  // if (!process.env.ABLY_API_KEY) return
  // await ably.channels.get(`pro:${_args.professionalId}`).publish('notification', { id: _args.notificationId })
  return
}

/**
 * Idempotent pro notifications.
 *
 * Contract:
 * - If dedupeKey is provided: behaves like upsert and resets readAt to null (unread)
 * - If no dedupeKey: always creates a new notification
 *
 * IMPORTANT:
 * - Dedupe is scoped to (professionalId + dedupeKey), not just dedupeKey.
 *   Enforce this in Prisma:
 *     @@unique([professionalId, dedupeKey])
 */
export async function createProNotification(args: CreateProNotificationArgs) {
  const professionalId = normRequired(args.professionalId, 64)
  const title = normRequired(args.title, 160)

  // Prisma schema: body/href are NOT nullable (String @default(""))
  const body = normDefaultString(args.body, 4000)
  const href = normDefaultString(args.href, 2048)

  // Prisma schema: dedupeKey is nullable
  const dedupeKey = normNullableString(args.dedupeKey, 256)

  if (!professionalId) throw new Error('createProNotification: missing professionalId')
  if (!title) throw new Error('createProNotification: missing title')

  const actorUserId = args.actorUserId ?? null
  const bookingId = args.bookingId ?? null
  const reviewId = args.reviewId ?? null

  // No dedupe: always create a new row
  if (!dedupeKey) {
    const created = await prisma.notification.create({
      data: {
        professionalId,
        type: args.type,
        title,
        body,
        href,
        dedupeKey: null,
        actorUserId,
        bookingId,
        reviewId,
        readAt: null,
      },
      select: { id: true },
    })

    await publishProNotificationEvent({ professionalId, notificationId: created.id })
    return created
  }

  // Update-first (fast path)
  const updated = await prisma.notification.updateMany({
    where: { professionalId, dedupeKey },
    data: {
      type: args.type,
      title,
      body,
      href,
      actorUserId,
      bookingId,
      reviewId,
      readAt: null,
    },
  })

  if (updated.count > 0) {
    const found = await prisma.notification.findFirst({
      where: { professionalId, dedupeKey },
      select: { id: true },
    })

    if (found?.id) {
      await publishProNotificationEvent({ professionalId, notificationId: found.id })
    }
    return found
  }

  // Create; if a race happens, unique constraint will throw — retry update
  try {
    const created = await prisma.notification.create({
      data: {
        professionalId,
        type: args.type,
        title,
        body,
        href,
        dedupeKey,
        actorUserId,
        bookingId,
        reviewId,
        readAt: null,
      },
      select: { id: true },
    })

    await publishProNotificationEvent({ professionalId, notificationId: created.id })
    return created
  } catch {
    await prisma.notification.updateMany({
      where: { professionalId, dedupeKey },
      data: {
        type: args.type,
        title,
        body,
        href,
        actorUserId,
        bookingId,
        reviewId,
        readAt: null,
      },
    })

    const found = await prisma.notification.findFirst({
      where: { professionalId, dedupeKey },
      select: { id: true },
    })

    if (found?.id) {
      await publishProNotificationEvent({ professionalId, notificationId: found.id })
    }
    return found
  }
}
