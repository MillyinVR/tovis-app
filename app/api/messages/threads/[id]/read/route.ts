// app/api/messages/threads/[id]/read/route.ts
import { prisma } from '@/lib/prisma'
import { requireUser } from '@/app/api/_utils/auth/requireUser'
import { jsonFail, jsonOk, enforceRateLimit, rateLimitIdentity } from '@/app/api/_utils'
import {
  resolveRouteParams,
  type RouteContext,
} from '@/app/api/_utils/routeContext'

export const dynamic = 'force-dynamic'

function trimId(v: unknown) {
  return typeof v === 'string' ? v.trim() : ''
}

export async function POST(_req: Request, ctx: RouteContext) {
  const debugId = Math.random().toString(36).slice(2, 9)

  try {
    const auth = await requireUser()
    if (!auth.ok) return auth.res
    const user = auth.user

    const { id } = await resolveRouteParams(ctx)
    const threadId = trimId(id)
    if (!threadId) return jsonFail(400, 'Missing id.')

    // ✅ Rate limit read receipts too (cheap endpoint, but easy to spam)
    const identity = await rateLimitIdentity(user.id)
    const limited = await enforceRateLimit({
      bucket: 'messages:read',
      identity,
      keySuffix: threadId,
    })
    if (limited) return limited

    const p = await prisma.messageThreadParticipant.findUnique({
      where: { threadId_userId: { threadId, userId: user.id } },
      select: { id: true, lastReadAt: true },
    })
    if (!p) return jsonFail(403, 'Forbidden.')

    const thread = await prisma.messageThread.findUnique({
      where: { id: threadId },
      select: { lastMessageAt: true },
    })

    const stamp = thread?.lastMessageAt ?? new Date()

    // ✅ Don’t move read time backwards
    const prev = p.lastReadAt ?? new Date(0)
    if (stamp.getTime() <= prev.getTime()) {
      return jsonOk({})
    }

    await prisma.messageThreadParticipant.update({
      where: { threadId_userId: { threadId, userId: user.id } },
      data: { lastReadAt: stamp },
    })

    console.log('[messages/read] ok', { debugId, threadId, at: stamp.toISOString() })
    return jsonOk({})
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Internal error'
    console.error('POST /api/messages/threads/[id]/read', { debugId, err: msg })
    return jsonFail(500, msg)
  }
}