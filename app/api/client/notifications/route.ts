// app/api/client/notifications/route.ts
import { prisma } from '@/lib/prisma'
import { jsonFail, jsonOk } from '@/app/api/_utils'
import { requireClient } from '@/app/api/_utils/auth/requireClient'
import {
  ClientNotificationType,
  type Prisma,
} from '@prisma/client'

export const dynamic = 'force-dynamic'

const CLIENT_NOTIFICATION_TYPE_VALUES = new Set<string>(
  Object.values(ClientNotificationType),
)

function asInt(value: unknown, fallback: number): number {
  const n =
    typeof value === 'string'
      ? parseInt(value, 10)
      : typeof value === 'number'
        ? Math.trunc(value)
        : NaN

  return Number.isFinite(n) ? n : fallback
}

function asBool(value: unknown): boolean | undefined {
  if (typeof value !== 'string') return undefined
  const normalized = value.trim().toLowerCase()

  if (normalized === 'true' || normalized === '1') return true
  if (normalized === 'false' || normalized === '0') return false

  return undefined
}

function parseClientNotificationType(
  value: unknown,
): ClientNotificationType | null {
  if (typeof value !== 'string') return null
  const normalized = value.trim()
  if (!normalized) return null

  return CLIENT_NOTIFICATION_TYPE_VALUES.has(normalized)
    ? (normalized as ClientNotificationType)
    : null
}

const notificationSelect = {
  id: true,
  type: true,
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

    const rawType = url.searchParams.get('type')
    const type = parseClientNotificationType(rawType)

    if (rawType && !type) {
      return jsonFail(400, 'Invalid notification type.')
    }

    const rows: NotificationRow[] = await prisma.clientNotification.findMany({
      where: {
        clientId,
        ...(unreadOnly ? { readAt: null } : {}),
        ...(type ? { type } : {}),
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
          type,
        },
      },
      200,
    )
  } catch (err: unknown) {
    console.error('GET /api/client/notifications error', err)
    const message = err instanceof Error ? err.message : 'Internal server error'
    return jsonFail(500, message)
  }
}