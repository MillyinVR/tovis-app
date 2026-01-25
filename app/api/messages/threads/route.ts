// app/api/messages/threads/route.ts

import { prisma } from '@/lib/prisma'
import { getCurrentUser } from '@/lib/currentUser'
import { jsonFail, jsonOk } from '@/app/api/_utils'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const user = await getCurrentUser().catch(() => null)
    if (!user) return jsonFail(401, 'Unauthorized.')

    const threads = await prisma.messageThread.findMany({
      where: {
        participants: { some: { userId: user.id } },
      },
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

    return jsonOk({ ok: true, threads })
  } catch (e: any) {
    console.error('GET /api/messages/threads', e)
    return jsonFail(500, e?.message || 'Internal error')
  }
}
