// app/api/messages/threads/[id]/read/route.ts

import { prisma } from '@/lib/prisma'
import { getCurrentUser } from '@/lib/currentUser'
import { jsonFail, jsonOk } from '@/app/api/_utils'

export const dynamic = 'force-dynamic'

export async function POST(_req: Request, ctx: { params: { id: string } | Promise<{ id: string }> }) {
  try {
    const user = await getCurrentUser().catch(() => null)
    if (!user) return jsonFail(401, 'Unauthorized.')

    const { id } = await Promise.resolve(ctx.params)
    if (!id) return jsonFail(400, 'Missing id.')

    // Ensure participant
    const p = await prisma.messageThreadParticipant.findUnique({
      where: { threadId_userId: { threadId: id, userId: user.id } },
      select: { id: true },
    })
    if (!p) return jsonFail(403, 'Forbidden.')

    await prisma.messageThreadParticipant.update({
      where: { threadId_userId: { threadId: id, userId: user.id } },
      data: { lastReadAt: new Date() },
    })

    return jsonOk({ ok: true })
  } catch (e: any) {
    console.error('POST /api/messages/threads/[id]/read', e)
    return jsonFail(500, e?.message || 'Internal error')
  }
}
