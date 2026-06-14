// app/api/messages/threads/route.ts
import { prisma } from '@/lib/prisma'
import { requireUser } from '@/app/api/_utils/auth/requireUser'
import { jsonFail, jsonOk } from '@/app/api/_utils'

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

    return jsonOk({ threads })
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Internal error'
    console.error('GET /api/messages/threads', msg)
    return jsonFail(500, msg)
  }
}