// app/api/pro/notifications/route.ts
import { NotificationType } from '@prisma/client'
import { jsonFail, jsonOk, requirePro } from '@/app/api/_utils'
import { listProNotifications } from '@/lib/notifications/proNotificationQueries'

export const dynamic = 'force-dynamic'

function asInt(value: unknown, fallback: number): number {
  const parsed =
    typeof value === 'string'
      ? parseInt(value, 10)
      : typeof value === 'number'
        ? Math.trunc(value)
        : Number.NaN

  return Number.isFinite(parsed) ? parsed : fallback
}

function parseUnreadOnly(value: unknown): boolean {
  const raw = typeof value === 'string' ? value.trim().toLowerCase() : ''
  return raw === '1' || raw === 'true' || raw === 'yes'
}

function parseNotificationType(value: unknown): NotificationType | null {
  const raw = typeof value === 'string' ? value.trim().toUpperCase() : ''

  if (raw === NotificationType.BOOKING_REQUEST) {
    return NotificationType.BOOKING_REQUEST
  }

  if (raw === NotificationType.BOOKING_UPDATE) {
    return NotificationType.BOOKING_UPDATE
  }

  if (raw === NotificationType.BOOKING_CANCELLED) {
    return NotificationType.BOOKING_CANCELLED
  }

  if (raw === NotificationType.REVIEW) {
    return NotificationType.REVIEW
  }

  return null
}

export async function GET(req: Request) {
  const auth = await requirePro()
  if (!auth.ok) return auth.res

  const url = new URL(req.url)

  const take = Math.max(
    1,
    Math.min(100, asInt(url.searchParams.get('take'), 60)),
  )

  const cursorId = (url.searchParams.get('cursor') || '').trim() || null
  const unreadOnly = parseUnreadOnly(url.searchParams.get('unread'))
  const type = parseNotificationType(url.searchParams.get('type'))

  if (url.searchParams.get('type') && !type) {
    return jsonFail(400, 'Invalid notification type.')
  }

  const result = await listProNotifications({
    professionalId: auth.professionalId,
    take,
    cursorId,
    unreadOnly,
    type,
  })

  return jsonOk(
    {
      items: result.items,
      nextCursor: result.nextCursor,
    },
    200,
  )
}