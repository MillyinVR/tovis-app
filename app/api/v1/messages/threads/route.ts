// app/api/v1/messages/threads/route.ts
import { prisma } from '@/lib/prisma'
import { requireUser } from '@/app/api/_utils/auth/requireUser'
import { jsonFail, jsonOk } from '@/app/api/_utils'
import type { MessagesThreadsListResponseDTO } from '@/lib/dto/messaging'
import {
  INBOX_THREADS_PAGE_SIZE,
  parseInboxFilter,
  resolveInboxEyebrows,
  whereForInboxFilter,
} from '@/lib/messages/inboxContext'

export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  try {
    const auth = await requireUser()
    if (!auth.ok) return auth.res
    const user = auth.user

    // Mirror the SSR inbox's filter tabs (All / Bookings / Waitlists / Pros) so
    // the native app and the web page return the same filtered set.
    const filter = parseInboxFilter(new URL(req.url).searchParams.get('filter'))

    const threads = await prisma.messageThread.findMany({
      where: whereForInboxFilter({ userId: user.id, filter }),
      orderBy: [{ lastMessageAt: 'desc' }, { updatedAt: 'desc' }],
      take: INBOX_THREADS_PAGE_SIZE,
      select: {
        id: true,
        contextType: true,
        contextId: true,
        bookingId: true,
        serviceId: true,
        offeringId: true,
        waitlistEntryId: true,
        lastMessageAt: true,
        lastMessagePreview: true,
        updatedAt: true,
        client: { select: { id: true, firstName: true, lastName: true, avatarUrl: true } },
        professional: { select: { id: true, userId: true, businessName: true, avatarUrl: true } },
        participants: {
          where: { userId: user.id },
          select: { lastReadAt: true },
          take: 1,
        },
        _count: { select: { messages: true } },
      },
    })

    // Resolve each row's context eyebrow once, server-side (booking time /
    // waitlist status / service name), so web + iOS render identical copy.
    const eyebrowById = await resolveInboxEyebrows(threads)

    return jsonOk({
      threads: threads.map((t) => {
        // Counterparty is derived from the viewer's user id, not their acting
        // role — the list payload deliberately omits participant user ids, so
        // this boolean is the client's only signal for whose name to show.
        const { userId: proUserId, ...professional } = t.professional
        const isViewerPro = proUserId != null && proUserId === user.id
        const eyebrow = eyebrowById.get(t.id) ?? {
          eyebrow: 'Message',
          isAccentContext: false,
        }
        return {
          id: t.id,
          contextType: t.contextType,
          contextId: t.contextId,
          bookingId: t.bookingId,
          serviceId: t.serviceId,
          offeringId: t.offeringId,
          waitlistEntryId: t.waitlistEntryId,
          lastMessageAt: t.lastMessageAt?.toISOString() ?? null,
          lastMessagePreview: t.lastMessagePreview,
          updatedAt: t.updatedAt.toISOString(),
          client: t.client,
          professional,
          participants: t.participants.map((p) => ({
            lastReadAt: p.lastReadAt?.toISOString() ?? null,
          })),
          isViewerPro,
          eyebrow: eyebrow.eyebrow,
          isAccentContext: eyebrow.isAccentContext,
          _count: t._count,
        }
      }),
    } satisfies MessagesThreadsListResponseDTO)
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Internal error'
    console.error('GET /api/v1/messages/threads', msg)
    return jsonFail(500, msg)
  }
}