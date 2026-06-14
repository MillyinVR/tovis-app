// app/api/client/footer/route.ts
import { requireClient } from '@/app/api/_utils/auth/requireClient'
import { jsonFail, jsonOk } from '@/app/api/_utils'
import { getUnreadClientNotificationCount } from '@/lib/notifications/clientNotifications'

export const dynamic = 'force-dynamic'

function clampSmallCount(n: number): string | null {
  if (!Number.isFinite(n) || n <= 0) return null
  return n > 99 ? '99+' : String(n)
}

export async function GET() {
  try {
    const auth = await requireClient()
    if (!auth.ok) return auth.res

    const unreadNotificationCount = await getUnreadClientNotificationCount({
      clientId: auth.clientId,
    })

    const inboxBadge = clampSmallCount(unreadNotificationCount)
    return inboxBadge ? jsonOk({ inboxBadge }) : jsonOk({})
  } catch (err: unknown) {
    console.error('GET /api/client/footer error', err)
    const message = err instanceof Error ? err.message : 'Internal server error'
    return jsonFail(500, message)
  }
}