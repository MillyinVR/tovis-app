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
import { inboxThreadRowSelect, serializeInboxThreadRow } from '@/lib/messages/threadRow'

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
      select: inboxThreadRowSelect(user.id),
    })

    // Resolve each row's context eyebrow once, server-side (booking time /
    // waitlist status / service name), so web + iOS render identical copy.
    const eyebrowById = await resolveInboxEyebrows(threads)

    return jsonOk({
      threads: threads.map((row) =>
        serializeInboxThreadRow({
          row,
          viewerUserId: user.id,
          eyebrow: eyebrowById.get(row.id) ?? {
            eyebrow: 'Message',
            isAccentContext: false,
          },
        }),
      ),
    } satisfies MessagesThreadsListResponseDTO)
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Internal error'
    console.error('GET /api/v1/messages/threads', msg)
    return jsonFail(500, msg)
  }
}