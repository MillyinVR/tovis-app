// app/api/messages/unread-count/route.ts
import { getCurrentUser } from '@/lib/currentUser'
import { jsonFail, jsonOk } from '@/app/api/_utils'
import { clampSmallCount, getUnreadThreadCountForUser } from '@/lib/messagesUnread'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const user = await getCurrentUser().catch(() => null)
    if (!user) return jsonFail(401, 'Unauthorized.')

    const count = await getUnreadThreadCountForUser(user.id)
    return jsonOk({ count, badge: clampSmallCount(count) })
  } catch (e: any) {
    console.error('GET /api/messages/unread-count', e)
    return jsonFail(500, e?.message || 'Internal error')
  }
}
