// app/api/client/notifications/route.ts
import { prisma } from '@/lib/prisma'
import { jsonFail, jsonOk } from '@/app/api/_utils'
import { requireClient } from '@/app/api/_utils/auth/requireClient'
import {
  NotificationEventKey,
  type Prisma,
} from '@prisma/client'

export const dynamic = 'force-dynamic'

const NOTIFICATION_EVENT_KEY_VALUES = new Set<string>(
  Object.values(NotificationEventKey),
)

function asInt(value: unknown, fallback: number): number {
  const n =
    typeof value === 'string'
      ? Number.parseInt(value, 10)
      : typeof value === 'number'
        ? Math.trunc(value)
        : Number.NaN

  return Number.isFinite(n) ? n : fallback
}

function asBool(value: unknown): boolean | undefined {
  if (typeof value !== 'string') return undefined
  const normalized = value.trim().toLowerCase()

  if (normalized === 'true' || normalized === '1') return true
  if (normalized === 'false' || normalized === '0') return false

  return undefined
}

function parseNotificationEventKey(
  value: unknown,
): NotificationEventKey | null {
  if (typeof value !== 'string') return null

  const normalized = value.trim()
  if (!normalized) return null

  return NOTIFICATION_EVENT_KEY_VALUES.has(normalized)
    ? (normalized as NotificationEventKey)
    : null
}

const notificationSelect = {
  id: true,
  eventKey: true,
  title: true,
  body: true,
  href: true,
  data: true,
  createdAt: true,
  updatedAt: true,
  readAt: true,
  bookingId: true,
  aftercareId: true,
} satisfies Prisma.ClientNotificationSelect

type NotificationRow = Prisma.ClientNotificationGetPayload<{
  select: typeof notificationSelect
}>

export async function GET(req: Request) {
  try {
    const auth = await requireClient()
    if (!auth.ok) return auth.res

    const clientId = auth.clientId
    const url = new URL(req.url)

    const take = Math.max(
      1,
      Math.min(100, asInt(url.searchParams.get('take'), 50)),
    )

    const cursor = (url.searchParams.get('cursor') || '').trim() || null
    const unreadOnly = asBool(url.searchParams.get('unread')) === true

    const rawEventKey = url.searchParams.get('eventKey')
    const eventKey = parseNotificationEventKey(rawEventKey)

    if (rawEventKey && !eventKey) {
      return jsonFail(400, 'Invalid notification event key.')
    }

    const rows: NotificationRow[] = await prisma.clientNotification.findMany({
      where: {
        clientId,
        ...(unreadOnly ? { readAt: null } : {}),
        ...(eventKey ? { eventKey } : {}),
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: take + 1,
      ...(cursor
        ? {
            cursor: { id: cursor },
            skip: 1,
          }
        : {}),
      select: notificationSelect,
    })

    const hasMore = rows.length > take
    const items = hasMore ? rows.slice(0, take) : rows
    const nextCursor = hasMore ? items[items.length - 1]?.id ?? null : null

    return jsonOk(
      {
        items,
        nextCursor,
        filters: {
          unreadOnly,
          eventKey,
        },
      },
      200,
    )
  } catch (err: unknown) {
    console.error('GET /api/client/notifications error', err)
    const message =
      err instanceof Error ? err.message : 'Internal server error'
    return jsonFail(500, message)
  }
}