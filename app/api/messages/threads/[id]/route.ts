// app/api/messages/threads/[id]/route.ts

import { prisma } from '@/lib/prisma'
import { getCurrentUser } from '@/lib/currentUser'
import { jsonFail, jsonOk, pickString } from '@/app/api/_utils'

export const dynamic = 'force-dynamic'

export async function GET(req: Request, ctx: { params: { id: string } | Promise<{ id: string }> }) {
  try {
    const user = await getCurrentUser().catch(() => null)
    if (!user) return jsonFail(401, 'Unauthorized.')

    const { id } = await Promise.resolve(ctx.params)
    if (!id) return jsonFail(400, 'Missing id.')

    const url = new URL(req.url)
    const cursor = pickString(url.searchParams.get('cursor'))
    const take = 40

    const thread = await prisma.messageThread.findUnique({
      where: { id },
      select: {
        id: true,
        contextType: true,
        contextId: true,
        bookingId: true,
        serviceId: true,
        offeringId: true,
        clientId: true,
        professionalId: true,
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

    // return newest-last for UI rendering
    return jsonOk({ ok: true, thread, messages: messages.reverse(), nextCursor: messages[0]?.id ?? null })
  } catch (e: any) {
    console.error('GET /api/messages/threads/[id]', e)
    return jsonFail(500, e?.message || 'Internal error')
  }
}

export async function POST(req: Request, ctx: { params: { id: string } | Promise<{ id: string }> }) {
  try {
    const user = await getCurrentUser().catch(() => null)
    if (!user) return jsonFail(401, 'Unauthorized.')

    const { id } = await Promise.resolve(ctx.params)
    if (!id) return jsonFail(400, 'Missing id.')

    const body = await req.json().catch(() => ({}))
    const text = pickString(body?.body)
    if (!text) return jsonFail(400, 'Missing body.')

    const thread = await prisma.messageThread.findUnique({
      where: { id },
      select: { id: true, participants: { where: { userId: user.id }, select: { userId: true }, take: 1 } },
    })
    if (!thread) return jsonFail(404, 'Thread not found.')
    if (!thread.participants.length) return jsonFail(403, 'Forbidden.')

    const msg = await prisma.message.create({
      data: {
        threadId: id,
        senderUserId: user.id,
        body: text,
      },
      select: { id: true, body: true, createdAt: true, senderUserId: true },
    })

    await prisma.messageThread.update({
      where: { id },
      data: {
        lastMessageAt: msg.createdAt,
        lastMessagePreview: (text || '').slice(0, 140),
      },
    })

    return jsonOk({ ok: true, message: msg })
  } catch (e: any) {
    console.error('POST /api/messages/threads/[id]', e)
    return jsonFail(500, e?.message || 'Internal error')
  }
}
