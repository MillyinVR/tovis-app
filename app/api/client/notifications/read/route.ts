// app/api/client/notifications/read/route.ts
import { jsonFail, jsonOk } from '@/app/api/_utils'
import { requireClient } from '@/app/api/_utils/auth/requireClient'
import { markClientNotificationsRead } from '@/lib/notifications/clientNotifications'
import { NotificationEventKey } from '@prisma/client'

export const dynamic = 'force-dynamic'

const NOTIFICATION_EVENT_KEY_VALUES = new Set<string>(
  Object.values(NotificationEventKey),
)

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function parseIdList(value: unknown): string[] {
  if (!Array.isArray(value)) return []

  return value
    .map((entry) => (typeof entry === 'string' ? entry.trim() : ''))
    .filter((entry) => entry.length > 0)
    .slice(0, 1000)
}

function parseDate(value: unknown): Date | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  if (!trimmed) return undefined

  const parsed = new Date(trimmed)
  if (Number.isNaN(parsed.getTime())) return undefined
  return parsed
}

function parseEventKey(value: unknown): NotificationEventKey | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!trimmed) return null

  return NOTIFICATION_EVENT_KEY_VALUES.has(trimmed)
    ? (trimmed as NotificationEventKey)
    : null
}

function parseEventKeys(value: unknown): NotificationEventKey[] | null {
  if (!Array.isArray(value)) return null

  const parsed = value
    .map((entry) => parseEventKey(entry))
    .filter((entry): entry is NotificationEventKey => entry !== null)

  return Array.from(new Set(parsed))
}

export async function POST(req: Request) {
  try {
    const auth = await requireClient()
    if (!auth.ok) return auth.res

    const body: unknown = await req.json().catch(() => ({}))
    if (!isRecord(body)) {
      return jsonFail(400, 'Invalid request body.')
    }

    const ids = parseIdList(body.ids)
    const before = parseDate(body.before)

    const singleEventKey =
      body.eventKey !== undefined ? parseEventKey(body.eventKey) : null
    if (body.eventKey !== undefined && singleEventKey === null) {
      return jsonFail(400, 'Invalid notification event key.')
    }

    const multiEventKeys =
      body.eventKeys !== undefined ? parseEventKeys(body.eventKeys) : null
    if (body.eventKeys !== undefined && multiEventKeys === null) {
      return jsonFail(400, 'Invalid notification event keys.')
    }

    const eventKeys =
      multiEventKeys !== null
        ? multiEventKeys
        : singleEventKey
          ? [singleEventKey]
          : undefined

    const result = await markClientNotificationsRead({
      clientId: auth.clientId,
      ...(ids.length > 0 ? { ids } : {}),
      ...(before ? { before } : {}),
      ...(eventKeys && eventKeys.length > 0 ? { eventKeys } : {}),
    })

    return jsonOk(
      {
        count: result.count,
      },
      200,
    )
  } catch (err: unknown) {
    console.error('POST /api/client/notifications/read error', err)
    const message = err instanceof Error ? err.message : 'Internal server error'
    return jsonFail(500, message)
  }
}