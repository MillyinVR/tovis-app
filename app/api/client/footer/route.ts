// app/api/client/footer/route.ts
import { prisma } from '@/lib/prisma'
import { getCurrentUser } from '@/lib/currentUser'
import { jsonFail, jsonOk } from '@/app/api/_utils'
import { Role, ClientNotificationType } from '@prisma/client'

export const dynamic = 'force-dynamic'

function clampSmallCount(n: number): string | null {
  if (!Number.isFinite(n) || n <= 0) return null
  return n > 99 ? '99+' : String(n)
}

export async function GET() {
  try {
    const user = await getCurrentUser().catch(() => null)
    if (!user || user.role !== Role.CLIENT || !user.clientProfile?.id) {
      return jsonFail(401, 'Unauthorized')
    }

    const unreadAftercareCount = await prisma.clientNotification.count({
      where: {
        clientId: user.clientProfile.id,
        type: ClientNotificationType.AFTERCARE,
        readAt: null,
      },
    })

    const inboxBadge = clampSmallCount(unreadAftercareCount)
    return inboxBadge ? jsonOk({ inboxBadge }) : jsonOk({})
  } catch (err: unknown) {
    console.error('GET /api/client/footer error', err)
    const message = err instanceof Error ? err.message : 'Internal server error'
    return jsonFail(500, message)
  }
}