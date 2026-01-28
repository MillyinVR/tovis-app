// app/api/messages/threads/[id]/read/route.ts
import { prisma } from '@/lib/prisma'
import { getCurrentUser } from '@/lib/currentUser'
import { jsonFail, jsonOk } from '@/app/api/_utils'

export const dynamic = 'force-dynamic'

export async function POST(_req: Request, ctx: { params: { id: string } | Promise<{ id: string }> }) {
  const debugId = Math.random().toString(36).slice(2, 9)

  try {
    const user = await getCurrentUser().catch(() => null)
    if (!user) return jsonFail(401, 'Unauthorized.')

    const { id } = await Promise.resolve(ctx.params)
    if (!id) return jsonFail(400, 'Missing id.')

    const p = await prisma.messageThreadParticipant.findUnique({
      where: { threadId_userId: { threadId: id, userId: user.id } },
      select: { id: true },
    })
    if (!p) return jsonFail(403, 'Forbidden.')

    const thread = await prisma.messageThread.findUnique({
      where: { id },
      select: { lastMessageAt: true },
    })

    const stamp = thread?.lastMessageAt ?? new Date()

    await prisma.messageThreadParticipant.update({
      where: { threadId_userId: { threadId: id, userId: user.id } },
      data: { lastReadAt: stamp },
    })

    // ✅ Quick confirmation #2: you should see this log when thread opens
    console.log('[messages/read] ok', { debugId, threadId: id, at: stamp.toISOString() })

    return jsonOk({ ok: true })
  } catch (e: any) {
    console.error('POST /api/messages/threads/[id]/read', { debugId, err: e?.message || e })
    return jsonFail(500, e?.message || 'Internal error')
  }
}
