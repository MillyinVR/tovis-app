// app/api/admin/notifications/route.ts
import { Role } from '@prisma/client'

import { jsonOk, requireUser } from '@/app/api/_utils'
import { listAdminNotifications } from '@/lib/notifications/adminNotificationQueries'

export const dynamic = 'force-dynamic'

function asInt(value: unknown, fallback: number): number {
  const parsed =
    typeof value === 'string' ? Number.parseInt(value, 10) : Number.NaN
  return Number.isFinite(parsed) ? parsed : fallback
}

function parseUnreadOnly(value: unknown): boolean {
  const raw = typeof value === 'string' ? value.trim().toLowerCase() : ''
  return raw === '1' || raw === 'true' || raw === 'yes'
}

export async function GET(req: Request) {
  const auth = await requireUser({ roles: [Role.ADMIN] })
  if (!auth.ok) return auth.res

  const url = new URL(req.url)
  const take = Math.max(1, Math.min(100, asInt(url.searchParams.get('take'), 60)))
  const cursorId = (url.searchParams.get('cursor') || '').trim() || null
  const unreadOnly = parseUnreadOnly(url.searchParams.get('unread'))

  const result = await listAdminNotifications({
    adminUserId: auth.user.id,
    take,
    cursorId,
    unreadOnly,
  })

  return jsonOk(
    {
      items: result.items,
      nextCursor: result.nextCursor,
    },
    200,
  )
}
