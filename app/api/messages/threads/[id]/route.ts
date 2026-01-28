// app/api/messages/threads/[id]/route.ts
import { prisma } from '@/lib/prisma'
import { getCurrentUser } from '@/lib/currentUser'
import {
  jsonFail,
  jsonOk,
  pickString,
  enforceRateLimit,
  rateLimitIdentity,
} from '@/app/api/_utils'

export const dynamic = 'force-dynamic'

export async function GET(req: Request, ctx: { params: { id: string } | Promise<{ id: string }> }) {
  try {
    const user = await getCurrentUser().catch(() => null)
    if (!user) return jsonFail(401, 'Unauthorized.')

    const { id } = await Promise.resolve(ctx.params)
    if (!id) return jsonFail(400, 'Missing id.')

    const url = new URL(req.url)
    const cursor = pickString(url.searchParams.get('cursor')) ?? null
    const take = 40

    const thread = await prisma.messageThread.findUnique({
      where: { id },
      select: {
        id: true,
        participants: { where: { userId: user.id }, select: { userId: true }, take: 1 },
      },
    })

    if (!thread) return jsonFail(404, 'Thread not found.')
    if (!thread.participants.length) return jsonFail(403, 'Forbidden.')

    const messages = await prisma.message.findMany({
      where: { threadId: id },
      orderBy: { createdAt: 'desc' },
      take,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      select: {
        id: true,
        body: true,
        createdAt: true,
        senderUserId: true,
        attachments: { select: { id: true, url: true, mediaType: true } },
      },
    })

    return jsonOk({
      thread: { id },
      messages: messages.reverse(),
      nextCursor: messages[0]?.id ?? null,
    })
  } catch (e: any) {
    console.error('GET /api/messages/threads/[id]', e)
    return jsonFail(500, e?.message || 'Internal error')
  }
}

export async function POST(req: Request, ctx: { params: { id: string } | Promise<{ id: string }> }) {
  const debugId = Math.random().toString(36).slice(2, 9)

  try {
    const user = await getCurrentUser().catch(() => null)
    if (!user) return jsonFail(401, 'Unauthorized.')

    const { id } = await Promise.resolve(ctx.params)
    if (!id) return jsonFail(400, 'Missing id.')

    // ✅ Rate limit BEFORE parsing + DB work
    const identity = await rateLimitIdentity(user.id)
    const limited = await enforceRateLimit({
      bucket: 'messages:send',
      identity,
      keySuffix: id, // per-thread protection
    })
    if (limited) return limited

    const body = await req.json().catch(() => ({} as any))

    const raw = pickString(body?.body)
    const text = (raw ?? '').trim()

    if (!text) return jsonFail(400, 'Missing body.')
    if (text.length > 4000) return jsonFail(400, 'Message too long.')

    const result = await prisma.$transaction(async (tx) => {
      const thread = await tx.messageThread.findUnique({
        where: { id },
        select: {
          id: true,
          participants: { where: { userId: user!.id }, select: { userId: true }, take: 1 },
        },
      })

      if (!thread) return { ok: false as const, status: 404, error: 'Thread not found.' }
      if (!thread.participants.length) return { ok: false as const, status: 403, error: 'Forbidden.' }

      const msg = await tx.message.create({
        data: { threadId: id, senderUserId: user!.id, body: text },
        select: { id: true, body: true, createdAt: true, senderUserId: true },
      })

      await tx.messageThread.update({
        where: { id },
        data: { lastMessageAt: msg.createdAt, lastMessagePreview: text.slice(0, 140) },
      })

      await tx.messageThreadParticipant.update({
        where: { threadId_userId: { threadId: id, userId: user!.id } },
        data: { lastReadAt: msg.createdAt },
      })

      return { ok: true as const, msg }
    })

    if (!result.ok) {
      console.warn('[messages/thread send] blocked', { debugId, status: result.status, error: result.error })
      return jsonFail(result.status, result.error)
    }

    console.log('[messages/thread send] ok', { debugId, threadId: id, msgId: result.msg.id })
    return jsonOk({ message: result.msg })
  } catch (e: any) {
    console.error('POST /api/messages/threads/[id]', { debugId, err: e?.message || e })
    return jsonFail(500, e?.message || 'Internal error')
  }
}
