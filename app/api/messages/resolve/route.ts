// app/api/messages/resolve/route.ts
import { getCurrentUser } from '@/lib/currentUser'
import { jsonFail, jsonOk, pickString, upper } from '@/app/api/_utils'
import { resolveMessageThread } from '@/lib/messagesResolve'
import { MessageThreadContextType } from '@prisma/client'

export const dynamic = 'force-dynamic'

type JsonRecord = Record<string, unknown>

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

async function readJsonObject(req: Request): Promise<JsonRecord> {
  const raw: unknown = await req.json().catch(() => ({}))
  return isRecord(raw) ? raw : {}
}

function asContextType(value: unknown): MessageThreadContextType | null {
  const normalized = upper(value)

  if (normalized === MessageThreadContextType.BOOKING) {
    return MessageThreadContextType.BOOKING
  }

  if (normalized === MessageThreadContextType.SERVICE) {
    return MessageThreadContextType.SERVICE
  }

  if (normalized === MessageThreadContextType.OFFERING) {
    return MessageThreadContextType.OFFERING
  }

  if (normalized === MessageThreadContextType.PRO_PROFILE) {
    return MessageThreadContextType.PRO_PROFILE
  }

  if (normalized === MessageThreadContextType.WAITLIST) {
    return MessageThreadContextType.WAITLIST
  }

  return null
}

function asBool(value: unknown): boolean {
  if (typeof value === 'boolean') return value

  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase()

    return (
      normalized === '1' ||
      normalized === 'true' ||
      normalized === 'yes' ||
      normalized === 'on'
    )
  }

  if (typeof value === 'number') return value === 1

  return false
}

export async function POST(req: Request) {
  const debugId = Math.random().toString(36).slice(2, 9)

  try {
    const user = await getCurrentUser().catch(() => null)

    if (!user) {
      return jsonFail(401, 'Unauthorized.')
    }

    const body = await readJsonObject(req)

    const contextType = asContextType(body.contextType)
    const contextId = pickString(body.contextId)
    const createIfMissing = asBool(body.createIfMissing)

    if (!contextType || !contextId) {
      console.warn('[messages/resolve] missing context', {
        debugId,
        contextType,
        contextId,
      })

      return jsonFail(400, 'Missing contextType/contextId.')
    }

    const professionalId = pickString(body.professionalId)
    const clientId = pickString(body.clientId)

    const outcome = await resolveMessageThread({
      viewer: user,
      input: {
        contextType,
        contextId,
        createIfMissing,
        ...(professionalId ? { professionalId } : {}),
        ...(clientId ? { clientId } : {}),
      },
    })

    if (!outcome.ok) {
      console.warn('[messages/resolve] blocked', {
        debugId,
        status: outcome.status,
        error: outcome.error,
      })

      return outcome.details
        ? jsonFail(outcome.status, outcome.error, outcome.details)
        : jsonFail(outcome.status, outcome.error)
    }

    if (!outcome.thread) {
      console.info('[messages/resolve] no existing thread; not creating', {
        debugId,
        contextType,
        contextId,
      })

      return jsonOk({ thread: null })
    }

    return jsonOk({ thread: { id: outcome.thread.id } })
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Internal error'

    console.error('POST /api/messages/resolve', {
      debugId,
      err: message,
    })

    return jsonFail(500, message)
  }
}
