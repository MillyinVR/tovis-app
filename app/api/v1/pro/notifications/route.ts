import { NotificationEventKey } from '@prisma/client'
import { jsonFail, jsonOk, requirePro } from '@/app/api/_utils'
import { listProNotifications } from '@/lib/notifications/proNotificationQueries'

export const dynamic = 'force-dynamic'

const NOTIFICATION_EVENT_KEY_VALUES = new Set<string>(
  Object.values(NotificationEventKey),
)

function asInt(value: unknown, fallback: number): number {
  const parsed =
    typeof value === 'string'
      ? Number.parseInt(value, 10)
      : typeof value === 'number'
        ? Math.trunc(value)
        : Number.NaN

  return Number.isFinite(parsed) ? parsed : fallback
}

function parseUnreadOnly(value: unknown): boolean {
  const raw = typeof value === 'string' ? value.trim().toLowerCase() : ''
  return raw === '1' || raw === 'true' || raw === 'yes'
}

function parseNotificationEventKey(
  value: unknown,
): NotificationEventKey | null {
  if (typeof value !== 'string') return null

  const raw = value.trim()
  if (!raw) return null

  return NOTIFICATION_EVENT_KEY_VALUES.has(raw)
    ? (raw as NotificationEventKey)
    : null
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
  const rawEventKey = url.searchParams.get('eventKey')
  const eventKey = parseNotificationEventKey(rawEventKey)

  if (rawEventKey && !eventKey) {
    return jsonFail(400, 'Invalid notification event key.')
  }

  const result = await listProNotifications({
    professionalId: auth.professionalId,
    take,
    cursorId,
    unreadOnly,
    eventKey,
  })

  return jsonOk(
    {
      items: result.items,
      nextCursor: result.nextCursor,
    },
    200,
  )
}