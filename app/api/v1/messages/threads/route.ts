// app/api/v1/messages/threads/route.ts
import { prisma } from '@/lib/prisma'
import { requireUser } from '@/app/api/_utils/auth/requireUser'
import { jsonFail, jsonOk } from '@/app/api/_utils'
import type { MessagesThreadsListResponseDTO } from '@/lib/dto/messaging'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const auth = await requireUser()
    if (!auth.ok) return auth.res
    const user = auth.user

    const threads = await prisma.messageThread.findMany({
      where: { participants: { some: { userId: user.id } } },
      orderBy: [{ lastMessageAt: 'desc' }, { updatedAt: 'desc' }],
      take: 50,
      select: {
        id: true,
        contextType: true,
        contextId: true,
        bookingId: true,
        serviceId: true,
        offeringId: true,
        lastMessageAt: true,
        lastMessagePreview: true,
        updatedAt: true,
        client: { select: { id: true, firstName: true, lastName: true, avatarUrl: true } },
        professional: { select: { id: true, businessName: true, avatarUrl: true } },
        participants: {
          where: { userId: user.id },
          select: { lastReadAt: true },
          take: 1,
        },
        _count: { select: { messages: true } },
      },
    })

    return jsonOk({
      threads: threads.map((t) => ({
        id: t.id,
        contextType: t.contextType,
        contextId: t.contextId,
        bookingId: t.bookingId,
        serviceId: t.serviceId,
        offeringId: t.offeringId,
        lastMessageAt: t.lastMessageAt?.toISOString() ?? null,
        lastMessagePreview: t.lastMessagePreview,
        updatedAt: t.updatedAt.toISOString(),
        client: t.client,
        professional: t.professional,
        participants: t.participants.map((p) => ({
          lastReadAt: p.lastReadAt?.toISOString() ?? null,
        })),
        _count: t._count,
      })),
    } satisfies MessagesThreadsListResponseDTO)
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Internal error'
    console.error('GET /api/v1/messages/threads', msg)
    return jsonFail(500, msg)
  }
}