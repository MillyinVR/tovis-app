// app/api/v1/messages/resolve/route.ts
import { requireUser } from '@/app/api/_utils/auth/requireUser'
import { jsonFail, jsonOk, pickString, upper } from '@/app/api/_utils'
import { readJsonRecord } from '@/app/api/_utils/readJsonRecord'
import { resolveMessageThread } from '@/lib/messagesResolve'
import { loadInboxThreadRow } from '@/lib/messages/threadRow'
import { MessageThreadContextType } from '@prisma/client'
import type { ResolveThreadResponseDTO } from '@/lib/dto/messaging'

export const dynamic = 'force-dynamic'

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
    const auth = await requireUser()
    if (!auth.ok) return auth.res
    const user = auth.user

    const body = await readJsonRecord(req)

    const contextType = asContextType(body.contextType)
    const contextId = pickString(body.contextId)
    const createIfMissing = asBool(body.createIfMissing)

    if (!contextType || !contextId) {
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
      return outcome.details
        ? jsonFail(outcome.status, outcome.error, outcome.details)
        : jsonFail(outcome.status, outcome.error)
    }

    if (!outcome.thread) {
      return jsonOk({ thread: null } satisfies ResolveThreadResponseDTO)
    }

    // Return the whole row, not just the id, so the caller can open the thread
    // without a second lookup. That second lookup used to be "find it in the
    // inbox list", which silently failed for every NEW thread: the inbox hides
    // message-less threads, so the first message to a client never opened.
    const thread = await loadInboxThreadRow({
      threadId: outcome.thread.id,
      viewerUserId: user.id,
    })

    if (!thread) {
      // The row was upserted moments ago and nothing in the app deletes
      // threads, so this is an invariant violation rather than a race worth
      // papering over — reporting "no thread resolved" would hide it.
      console.error('POST /api/v1/messages/resolve: resolved thread vanished', {
        debugId,
        threadId: outcome.thread.id,
      })
      return jsonFail(500, 'Thread could not be loaded.')
    }

    return jsonOk({ thread } satisfies ResolveThreadResponseDTO)
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Internal error'

    console.error('POST /api/v1/messages/resolve', {
      debugId,
      err: message,
    })

    return jsonFail(500, message)
  }
}
