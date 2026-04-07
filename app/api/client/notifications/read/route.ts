// app/api/client/notifications/read/route.ts
import { jsonFail, jsonOk } from '@/app/api/_utils'
import { requireClient } from '@/app/api/_utils/auth/requireClient'
import { markClientNotificationsRead } from '@/lib/notifications/clientNotifications'
import { ClientNotificationType } from '@prisma/client'

export const dynamic = 'force-dynamic'

const CLIENT_NOTIFICATION_TYPE_VALUES = new Set<string>(
  Object.values(ClientNotificationType),
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

function parseType(value: unknown): ClientNotificationType | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!trimmed) return null

  return CLIENT_NOTIFICATION_TYPE_VALUES.has(trimmed)
    ? (trimmed as ClientNotificationType)
    : null
}

function parseTypes(value: unknown): ClientNotificationType[] | null {
  if (!Array.isArray(value)) return null

  const parsed = value
    .map((entry) => parseType(entry))
    .filter((entry): entry is ClientNotificationType => entry !== null)

  return parsed.length > 0 ? Array.from(new Set(parsed)) : []
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

    const singleType = body.type !== undefined ? parseType(body.type) : null
    if (body.type !== undefined && singleType === null) {
      return jsonFail(400, 'Invalid notification type.')
    }

    const multiTypes =
      body.types !== undefined ? parseTypes(body.types) : null
    if (body.types !== undefined && multiTypes === null) {
      return jsonFail(400, 'Invalid notification types.')
    }

    const types =
      multiTypes !== null
        ? multiTypes
        : singleType
          ? [singleType]
          : undefined

    const result = await markClientNotificationsRead({
      clientId: auth.clientId,
      ...(ids.length > 0 ? { ids } : {}),
      ...(before ? { before } : {}),
      ...(types && types.length > 0 ? { types } : {}),
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