// app/api/v1/messages/unread-count/route.ts
import { getCurrentUser } from '@/lib/currentUser'
import { jsonFail, jsonOk } from '@/app/api/_utils'
import { clampSmallCount, getUnreadThreadCountForUser } from '@/lib/messagesUnread'
import type { MessagesUnreadCountResponseDTO } from '@/lib/dto/messaging'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const user = await getCurrentUser()
    if (!user) return jsonFail(401, 'Unauthorized')

    const count = await getUnreadThreadCountForUser(user.id)
    const badge = clampSmallCount(count)

    return badge
      ? jsonOk({ count, badge } satisfies MessagesUnreadCountResponseDTO)
      : jsonOk({ count } satisfies MessagesUnreadCountResponseDTO)
  } catch (err: unknown) {
    console.error('GET /api/v1/messages/unread-count', err)
    const message = err instanceof Error ? err.message : 'Internal error'
    return jsonFail(500, message)
  }
}